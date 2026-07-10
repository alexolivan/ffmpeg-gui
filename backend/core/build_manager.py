import asyncio
import os
import subprocess
import logging
import shutil
import datetime
import shlex


class BuildManager:
    """Manages isolated FFmpeg compilation profiles.

    Each build lives in its own directory under `builds_root/<build_id>/`
    with separate `src/` (source code) and `install/` (compiled binaries)
    subdirectories. This isolation allows multiple FFmpeg+SDK combinations
    to coexist without interference.
    """

    FFMPEG_GIT_URL = "https://git.ffmpeg.org/ffmpeg.git"
    SRT_GIT_URL = "https://github.com/Haivision/srt.git"

    def __init__(self, builds_root: str):
        self.builds_root = os.path.abspath(builds_root)
        self.workspace_root = os.path.abspath(os.path.join(self.builds_root, ".."))
        self.is_building = False
        self.active_build_id = None
        self.logger = logging.getLogger("BuildManager")
        self.current_process = None
        self.current_task = None

    # ── Path helpers ──────────────────────────────────────────────

    def get_build_path(self, build_id: int, builds_root: str = None) -> str:
        root = os.path.abspath(builds_root) if builds_root else self.builds_root
        return os.path.join(root, str(build_id))

    def get_src_path(self, build_id: int, builds_root: str = None) -> str:
        return os.path.join(self.get_build_path(build_id, builds_root), "src")

    def get_install_path(self, build_id: int, builds_root: str = None) -> str:
        return os.path.join(self.get_build_path(build_id, builds_root), "install")

    # ── System dependency pre-flight ──────────────────────────────

    def check_dependencies(self) -> dict:
        """Check that required system build tools are available."""
        self.logger.info("Starting dependency check...")
        
        # Tools validated via shutil.which
        core_deps = {
            "cmake": {"type": "required", "description": "Sistema de generación de builds (CMake)"},
            "git": {"type": "required", "description": "Control de versiones para descargar código fuente"},
            "make": {"type": "required", "description": "Herramienta de automatización de compilación"},
            "gcc": {"type": "required", "description": "Compilador de código C/C++"},
            "pkg-config": {"type": "required", "description": "Gestor de metadatos de bibliotecas de desarrollo"},
            "clang": {"type": "optional", "description": "Compilador LLVM/Clang (requerido para filtros CUDA)"},
            "avahi-daemon": {"type": "optional", "description": "Servicio de descubrimiento mDNS/DNS-SD (requerido para runtime de NDI)"},
            "vainfo": {"type": "optional", "description": "Herramienta de diagnóstico para aceleración de vídeo VA-API (vainfo)"},
        }
        
        results = {}
        for name, info in core_deps.items():
            installed = shutil.which(name) is not None
            if name == "avahi-daemon" and not installed:
                installed = os.path.exists("/usr/sbin/avahi-daemon")
            results[name] = {
                "installed": installed,
                "type": info["type"],
                "description": info["description"]
            }

        # Check yasm/nasm assembler
        yasm_nasm_installed = (
            shutil.which("yasm") is not None
            or shutil.which("nasm") is not None
        )
        results["yasm/nasm"] = {
            "installed": yasm_nasm_installed,
            "type": "required",
            "description": "Ensamblador para optimizaciones de rendimiento x86 (yasm o nasm)"
        }

        # Libraries checked via pkg-config
        libs = {
            "libx264": {"pkg": "x264", "type": "required", "description": "Biblioteca para codificación H.264/AVC (libx264)"},
            "libx265": {"pkg": "x265", "type": "required", "description": "Biblioteca para codificación H.265/HEVC (libx265)"},
            "libssl": {"pkg": "openssl", "type": "required", "description": "Biblioteca criptográfica OpenSSL (libssl-dev)"},
            "libdrm": {"pkg": "libdrm", "type": "optional", "description": "Acceso directo al subsistema de renderizado GPU (DRI)"},
            "libopus": {"pkg": "opus", "type": "optional", "description": "Biblioteca Opus para codificación de audio (libopus)"},
            "libvpx": {"pkg": "vpx", "type": "optional", "description": "Biblioteca VP8/VP9 (libvpx)"}
        }

        has_pkg_config = results.get("pkg-config", {}).get("installed", False)

        for name, info in libs.items():
            installed = False
            if has_pkg_config:
                try:
                    cmd = ["pkg-config", "--exists", info["pkg"]]
                    subprocess.run(cmd, capture_output=True, check=True)
                    installed = True
                except Exception:
                    installed = False
            
            results[name] = {
                "installed": installed,
                "type": info["type"],
                "description": info["description"],
                "pkg_config_name": info["pkg"]
            }

        # Check libnpp (Nvidia CUDA Toolkit) via npp.h headers presence
        npp_installed = False
        for path in ["/usr/include/npp.h", "/usr/local/cuda/include/npp.h", "/usr/include/x86_64-linux-gnu/npp.h"]:
            if os.path.exists(path):
                npp_installed = True
                break
        
        results["nvidia-cuda-dev"] = {
            "installed": npp_installed,
            "type": "optional",
            "description": "Cabeceras de desarrollo de NVIDIA CUDA / NPP (nvidia-cuda-dev)"
        }

        # Calculate all_required_met
        all_required_met = all(
            item["installed"]
            for item in results.values()
            if item["type"] == "required"
        )

        payload = {
            "dependencies": results,
            "all_required_met": all_required_met
        }
        self.logger.info(f"Check results payload: {payload}")
        return payload

    # ── Tag discovery ─────────────────────────────────────────────

    async def fetch_available_tags(self, repo: str = "ffmpeg") -> list[str]:
        """Fetch available git tags from the remote repository.

        Returns a sorted list of tag names (most recent first).
        Uses `git ls-remote --tags` to avoid cloning.
        """
        if repo == "ffmpeg":
            url = self.FFMPEG_GIT_URL
        elif repo == "srt":
            url = self.SRT_GIT_URL
        elif repo in ["nvenc", "nvenc_headers"]:
            url = "https://github.com/FFmpeg/nv-codec-headers.git"
        else:
            url = repo

        try:
            proc = await asyncio.create_subprocess_exec(
                "git", "ls-remote", "--tags", "--sort=-v:refname", url,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await proc.communicate()

            tags = []
            for line in stdout.decode().strip().splitlines():
                ref = line.split("\t")[-1]
                # Skip dereferenced tag objects (^{})
                if ref.endswith("^{}"):
                    continue
                tag_name = ref.replace("refs/tags/", "")
                tags.append(tag_name)
            return tags
        except Exception as exc:
            self.logger.error(f"Failed to fetch tags for {repo}: {exc}")
            return []

    def get_ffnvcodec_tag(self, ffmpeg_version: str) -> str | None:
        """Determine correct ffnvcodec tag based on FFmpeg version."""
        if not ffmpeg_version or any(dev in ffmpeg_version.lower() for dev in ["master", "dev", "git"]):
            return None
        try:
            # Strip leading alphabetic characters (like 'n' or 'v') to support git tags (e.g. 'n6.0')
            cleaned_version = ffmpeg_version.lstrip("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")
            parts = cleaned_version.split('.')
            major = int(parts[0])
            if major >= 7:
                return "n13.0.19.0"
            elif major == 6:
                return "n12.1.14.0"
            elif major == 5:
                return "n11.1.5.3"
            elif major <= 4:
                return "n9.1.23.2"
        except Exception:
            pass
        return "n13.0.19.0"


    # ── Disk information ──────────────────────────────────────────

    def get_partition_free_space(self) -> dict:
        """Return free space (in MB and GB) on the partition hosting builds."""
        os.makedirs(self.builds_root, exist_ok=True)
        stat = os.statvfs(self.builds_root)
        free_bytes = stat.f_bavail * stat.f_frsize
        return {
            "free_mb": round(free_bytes / (1024 * 1024)),
            "free_gb": round(free_bytes / (1024 * 1024 * 1024), 1),
            "path": self.builds_root,
        }

    def get_disk_usage(self, build_id: int, builds_root: str = None) -> int:
        """Calculate disk usage in MB for a specific build."""
        build_path = self.get_build_path(build_id, builds_root)
        if not os.path.exists(build_path):
            return 0

        total_size = 0
        for dirpath, _dirnames, filenames in os.walk(build_path):
            for filename in filenames:
                filepath = os.path.join(dirpath, filename)
                if os.path.isfile(filepath):
                    total_size += os.path.getsize(filepath)
        return round(total_size / (1024 * 1024))

    # ── Build execution ───────────────────────────────────────────

    async def run_build(self, build_id: int, ffmpeg_version: str,
                        srt_version: str | None, options: dict,
                        sdk_paths: dict | None, sources_cleaned: bool,
                        log_callback, auto_clean: bool = False, builds_root: str = None) -> dict:
        """Execute the full build pipeline for a profile.

        Returns a dict with build results (binary paths, version output, etc.)
        """
        if self.is_building:
            await log_callback("ERROR: Build already in progress\n")
            return {"success": False, "error": "Build already in progress"}

        # Validation for WHIP requirement (FFmpeg 8.0+)
        if options.get("whip"):
            ver_str = ffmpeg_version.lstrip("n")
            if ver_str and ver_str[0].isdigit():
                try:
                    major_ver = int(ver_str.split(".")[0])
                    if major_ver < 8:
                        await log_callback(f"ERROR: WHIP requires FFmpeg 8.0 or newer (selected: {ffmpeg_version})\n")
                        return {"success": False, "error": f"WHIP requires FFmpeg 8.0 or newer (selected: {ffmpeg_version})"}
                except ValueError:
                    pass

        self.is_building = True
        self.active_build_id = build_id
        result = {"success": False}

        try:
            src_path = self.get_src_path(build_id, builds_root)
            install_path = self.get_install_path(build_id, builds_root)
            os.makedirs(src_path, exist_ok=True)
            os.makedirs(install_path, exist_ok=True)

            # Auto-detect VAAPI version if enabled
            if options.get("vaapi"):
                try:
                    proc = await asyncio.create_subprocess_exec(
                        "pkg-config", "--modversion", "libva",
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                    )
                    stdout, _ = await proc.communicate()
                    libva_ver = stdout.decode().strip()
                    if libva_ver:
                        if sdk_paths is None:
                            sdk_paths = {}
                        sdk_paths["vaapi"] = libva_ver
                except Exception as e:
                    self.logger.error(f"Failed to detect libva version: {e}")

            # ── 1. LibSRT (if enabled) ────────────────────────────
            if options.get("libsrt") and srt_version:
                await log_callback("━━━ STAGE 1: LIBSRT BUILD ━━━\n")
                srt_src = os.path.join(src_path, "srt")

                if not os.path.exists(srt_src) or sources_cleaned:
                    if os.path.exists(srt_src):
                        shutil.rmtree(srt_src)
                    await log_callback(
                        f"Cloning LibSRT and checking out tag {srt_version}...\n"
                    )
                    await self._run_logged_cmd(
                        ["git", "clone", self.SRT_GIT_URL, srt_src],
                        log_callback,
                    )
                    await self._run_logged_cmd(
                        ["git", "checkout", srt_version],
                        log_callback,
                        cwd=srt_src,
                    )
                else:
                    await log_callback(
                        f"SRT sources exist, checking out tag {srt_version}...\n"
                    )
                    self._clear_stale_git_locks(srt_src)
                    await self._run_logged_cmd(
                        ["git", "fetch", "--tags"], log_callback, cwd=srt_src
                    )
                    await self._run_logged_cmd(
                        ["git", "checkout", srt_version],
                        log_callback,
                        cwd=srt_src,
                    )

                srt_build_dir = os.path.join(srt_src, "build")
                os.makedirs(srt_build_dir, exist_ok=True)

                await self._run_logged_cmd(
                    [
                        "cmake", "..",
                        f"-DCMAKE_INSTALL_PREFIX={install_path}",
                        "-DENABLE_STATIC=ON",
                    ],
                    log_callback,
                    cwd=srt_build_dir,
                )
                await self._run_logged_cmd(
                    ["make", "-j4"], log_callback, cwd=srt_build_dir
                )
                await self._run_logged_cmd(
                    ["make", "install"], log_callback, cwd=srt_build_dir
                )
                await log_callback("━━━ LIBSRT BUILD COMPLETE ━━━\n\n")

            # ── 1.5 NVIDIA ffnvcodec headers (if enabled) ─────────
            if options.get("nvenc"):
                await log_callback("━━━ STAGE 1.5: NVIDIA NVENC HEADERS ━━━\n")
                nv_src = os.path.join(src_path, "nv-codec-headers")
                
                # Determine correct ffnvcodec tag based on user selection
                nv_tag = sdk_paths.get("nvenc_headers") if sdk_paths else None
                if not nv_tag:
                    nv_tag = self.get_ffnvcodec_tag(ffmpeg_version)
                    await log_callback(f"⚠️ Warning: No explicit nv-codec-headers tag selected. Falling back to auto-detected compatibility tag: {nv_tag}\n")

                if not os.path.exists(nv_src) or sources_cleaned:
                    if os.path.exists(nv_src):
                        shutil.rmtree(nv_src)
                    await log_callback("Cloning ffnvcodec headers from GitHub...\n")
                    await self._run_logged_cmd(
                        ["git", "clone", "https://github.com/FFmpeg/nv-codec-headers.git", nv_src],
                        log_callback,
                    )
                else:
                    await log_callback("Fetching updates for nv-codec-headers...\n")
                    self._clear_stale_git_locks(nv_src)
                    await self._run_logged_cmd(
                        ["git", "fetch", "--tags"], log_callback, cwd=nv_src
                    )

                if nv_tag:
                    await log_callback(f"Checking out nv-codec-headers tag: {nv_tag}...\n")
                    await self._run_logged_cmd(
                        ["git", "checkout", "-f", nv_tag],
                        log_callback,
                        cwd=nv_src,
                    )
                else:
                    await log_callback("Using latest master branch for nv-codec-headers...\n")
                    await self._run_logged_cmd(
                        ["git", "checkout", "-f", "master"],
                        log_callback,
                        cwd=nv_src,
                    )
                    await self._run_logged_cmd(
                        ["git", "pull"],
                        log_callback,
                        cwd=nv_src,
                    )

                await log_callback("Installing ffnvcodec headers to install prefix...\n")
                await self._run_logged_cmd(
                    ["make", f"PREFIX={install_path}", "install"],
                    log_callback,
                    cwd=nv_src,
                )
                await log_callback("━━━ NVIDIA HEADERS COMPLETE ━━━\n\n")

            # ── 2. FFmpeg ─────────────────────────────────────────
            await log_callback("━━━ STAGE 2: FFMPEG BUILD ━━━\n")
            ffmpeg_src = os.path.join(src_path, "ffmpeg")

            if not os.path.exists(ffmpeg_src) or sources_cleaned:
                if os.path.exists(ffmpeg_src):
                    shutil.rmtree(ffmpeg_src)
                await log_callback(
                    f"Cloning FFmpeg and checking out tag {ffmpeg_version}...\n"
                )
                await self._run_logged_cmd(
                    ["git", "clone", self.FFMPEG_GIT_URL, ffmpeg_src],
                    log_callback,
                )
                await self._run_logged_cmd(
                    ["git", "checkout", ffmpeg_version],
                    log_callback,
                    cwd=ffmpeg_src,
                )
            else:
                await log_callback(
                    f"FFmpeg sources exist, running make clean and "
                    f"checking out tag {ffmpeg_version}...\n"
                )
                # In-place recompilation: clean previous build artifacts
                await self._run_logged_cmd(
                    ["make", "clean"], log_callback, cwd=ffmpeg_src,
                    ignore_errors=True,
                )
                self._clear_stale_git_locks(ffmpeg_src)
                await self._run_logged_cmd(
                    ["git", "fetch", "--tags"], log_callback, cwd=ffmpeg_src
                )
                await self._run_logged_cmd(
                    ["git", "checkout", ffmpeg_version],
                    log_callback,
                    cwd=ffmpeg_src,
                )

            # Build configure flags
            config_flags = [
                f"--prefix={install_path}",
                "--enable-gpl",
                "--enable-nonfree",
                "--enable-libx264",
                "--enable-libx265",
                "--enable-openssl",
            ]
            # Automatically enable libopus if available on the system
            dep_check = self.check_dependencies()
            if dep_check.get("dependencies", {}).get("libopus", {}).get("installed"):
                config_flags.append("--enable-libopus")

            # Automatically enable libvpx if available on the system
            if dep_check.get("dependencies", {}).get("libvpx", {}).get("installed"):
                config_flags.append("--enable-libvpx")

            if options.get("libsrt"):
                config_flags.append("--enable-libsrt")
            if options.get("vaapi"):
                config_flags.append("--enable-vaapi")

            # DeckLink Integration (using the global versioned directory)
            if options.get("decklink") and sdk_paths and sdk_paths.get("decklink"):
                decklink_version = sdk_paths.get("decklink")
                decklink_sdk_path = os.path.join(self.workspace_root, "data", "sdks", "decklink", decklink_version)
                if not os.path.exists(decklink_sdk_path):
                    raise FileNotFoundError(
                        f"DeckLink SDK version '{decklink_version}' is not installed in the system. "
                        "Please upload this version first."
                    )
                
                decklink_include = os.path.join(decklink_sdk_path, "include")
                config_flags.append("--enable-decklink")
                config_flags.append(f"--extra-cflags=-I{decklink_include}")
                config_flags.append(f"--extra-cxxflags=-I{decklink_include}")
            
            # NVIDIA NVENC
            if options.get("nvenc"):
                config_flags.append("--enable-nvenc")
                config_flags.append("--enable-ffnvcodec")
                if options.get("cuda_filters"):
                    # Validate dependencies strictly
                    dep_check = self.check_dependencies()
                    clang_installed = dep_check["dependencies"].get("clang", {}).get("installed", False)
                    npp_installed = dep_check["dependencies"].get("nvidia-cuda-dev", {}).get("installed", False)
                    if not clang_installed or not npp_installed:
                        raise RuntimeError(
                            "Cannot compile NVIDIA CUDA Filters: missing dependencies. "
                            "Please ensure Clang ('clang') and NVIDIA CUDA/NPP development headers ('nvidia-cuda-dev') are installed on the system."
                        )
                    config_flags.append("--enable-cuda-llvm")
                    config_flags.append("--enable-libnpp")
                    config_flags.append("--enable-nvdec")

            # NDI Integration (using the global versioned directory + patch application)
            if options.get("ndi") and sdk_paths and sdk_paths.get("ndi"):
                ndi_version = sdk_paths.get("ndi")
                ndi_sdk_path = os.path.join(self.workspace_root, "data", "sdks", "ndi", ndi_version)
                if not os.path.exists(ndi_sdk_path):
                    raise FileNotFoundError(
                        f"NDI SDK version '{ndi_version}' is not installed in the system. "
                        "Please upload this version first."
                    )
                
                # Apply dynamic NDI patch
                await log_callback("━━━ APPLYING NDI COMMUNITY PATCH ━━━\n")
                custom_patch_file = sdk_paths.get("ndi_patch_file")
                if os.path.basename(self.workspace_root) == "backend":
                    system_patches_dir = os.path.join(self.workspace_root, "patches")
                    user_patches_dir = os.path.join(self.workspace_root, "data", "patches")
                else:
                    system_patches_dir = os.path.join(self.workspace_root, "backend", "patches")
                    user_patches_dir = os.path.join(self.workspace_root, "backend", "data", "patches")
                
                if custom_patch_file:
                    # Look in user uploads first, fallback to system
                    local_patch_path = os.path.join(user_patches_dir, custom_patch_file)
                    if not os.path.exists(local_patch_path):
                        local_patch_path = os.path.join(system_patches_dir, custom_patch_file)
                    await log_callback(f"Using custom NDI patch: {custom_patch_file}\n")
                else:
                    if ffmpeg_version.startswith("7."):
                        default_patch_name = "system_ffmpeg_7.patch"
                    elif ffmpeg_version.startswith("6."):
                        default_patch_name = "system_ffmpeg_6.patch"
                    else:
                        default_patch_name = "system_ffmpeg_7.patch"
                    
                    local_patch_path = os.path.join(system_patches_dir, default_patch_name)
                    await log_callback(f"Using system default NDI patch: {default_patch_name}\n")
                
                if not os.path.exists(local_patch_path):
                    raise ValueError(f"NDI patch file not found: {local_patch_path}")
                
                patch_file = os.path.join(src_path, "ndi.patch")
                try:
                    shutil.copy2(local_patch_path, patch_file)
                    await log_callback("Loaded local patch. Checking application status...\n")
                    
                    # 1. Check if the patch can be applied cleanly (means not applied yet)
                    proc_check = await asyncio.create_subprocess_exec(
                        "git", "apply", "--check", "--ignore-whitespace", "--whitespace=nowarn", patch_file,
                        cwd=ffmpeg_src,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                    )
                    await proc_check.communicate()
                    
                    if proc_check.returncode == 0:
                        await log_callback("Applying NDI community patch to FFmpeg codebase...\n")
                        await self._run_logged_cmd(
                            ["git", "apply", "--ignore-whitespace", "--whitespace=nowarn", patch_file],
                            log_callback,
                            cwd=ffmpeg_src,
                        )
                    else:
                        # 2. Check if the patch has already been applied (reverse apply check succeeds)
                        proc_rev_check = await asyncio.create_subprocess_exec(
                            "git", "apply", "--check", "--reverse", "--ignore-whitespace", "--whitespace=nowarn", patch_file,
                            cwd=ffmpeg_src,
                            stdout=asyncio.subprocess.PIPE,
                            stderr=asyncio.subprocess.PIPE,
                        )
                        await proc_rev_check.communicate()
                        
                        if proc_rev_check.returncode == 0:
                            await log_callback("NDI community patch is already applied to the codebase. Skipping application.\n")
                        else:
                            # Fallback to apply with ignore_errors if state is mixed
                            await log_callback("WARNING: Patch is not clean and doesn't seem fully applied. Attempting application anyway...\n")
                            await self._run_logged_cmd(
                                ["git", "apply", "--ignore-whitespace", "--whitespace=nowarn", patch_file],
                                log_callback,
                                cwd=ffmpeg_src,
                                ignore_errors=True,
                            )
                except Exception as patch_exc:
                    await log_callback(f"WARNING: Error downloading/applying patch: {patch_exc}\n")

                config_flags.append("--enable-libndi_newtek")
                config_flags.append(f"--extra-cflags=-I{ndi_sdk_path}/include")
                config_flags.append(f"--extra-ldflags=-L{ndi_sdk_path}/lib/x86_64-linux-gnu")
                # Add RPATH to ensure the compiled ffmpeg binary can load the dynamic libndi.so correctly
                config_flags.append(f"--extra-ldflags=-Wl,-rpath,{ndi_sdk_path}/lib/x86_64-linux-gnu")
                config_flags.append("--extra-libs=-lavahi-client -lavahi-common")

            # PKG_CONFIG_PATH for locally-compiled libs (e.g. LibSRT and ffnvcodec)
            env = os.environ.copy()
            install_lib_path = os.path.join(install_path, "lib")
            env["PKG_CONFIG_PATH"] = os.path.join(install_lib_path, "pkgconfig")
            
            # Add RPATH so ffmpeg finds our local libs (like libsrt) at runtime
            config_flags.append(f"--extra-ldflags=-Wl,-rpath,{install_lib_path}")

            await self._run_logged_cmd(
                ["./configure"] + config_flags,
                log_callback,
                cwd=ffmpeg_src,
                env=env,
            )
            await self._run_logged_cmd(
                ["make", "-j4"], log_callback, cwd=ffmpeg_src
            )
            await self._run_logged_cmd(
                ["make", "install"], log_callback, cwd=ffmpeg_src
            )
            await log_callback("\n━━━ FFMPEG BUILD SUCCESSFUL ━━━\n")

            # ── 3. Validate ───────────────────────────────────────
            ffmpeg_bin = os.path.join(install_path, "bin", "ffmpeg")
            ffprobe_bin = os.path.join(install_path, "bin", "ffprobe")

            version_output = ""
            if os.path.isfile(ffmpeg_bin):
                version_output = await self._get_command_output(
                    [ffmpeg_bin, "-version"]
                )
                await log_callback(f"\n{version_output}\n")

            # ── 4. Auto-clean sources (if enabled) ────────────────
            if auto_clean and os.path.exists(src_path):
                await log_callback("\n━━━ AUTO-CLEAN ENABLED ━━━\n")
                await log_callback("Cleaning temporary build sources to save space...\n")
                self.clean_sources(build_id, builds_root)
                await log_callback("Sources cleaned successfully.\n")

            result = {
                "success": True,
                "ffmpeg_binary": ffmpeg_bin if os.path.isfile(ffmpeg_bin) else None,
                "ffprobe_binary": ffprobe_bin if os.path.isfile(ffprobe_bin) else None,
                "version_output": version_output,
                "disk_usage_mb": self.get_disk_usage(build_id, builds_root),
                "sdk_paths": sdk_paths,
            }

        except Exception as exc:
            error_msg = str(exc)
            await log_callback(f"\nERROR DURING BUILD: {error_msg}\n")
            result = {"success": False, "error": error_msg}
        finally:
            self.is_building = False
            self.active_build_id = None

        return result

    # ── Build validation ──────────────────────────────────────────

    async def validate_build(self, ffmpeg_binary: str) -> dict:
        """Run `ffmpeg -version` and return the output."""
        if not ffmpeg_binary or not os.path.isfile(ffmpeg_binary):
            return {"valid": False, "error": "Binary not found"}

        try:
            output = await self._get_command_output([ffmpeg_binary, "-version"])
            return {"valid": True, "output": output}
        except Exception as exc:
            return {"valid": False, "error": str(exc)}

    # ── Source cleanup ────────────────────────────────────────────

    def clean_sources(self, build_id: int, builds_root: str = None) -> dict:
        """Remove source directories, keeping only compiled binaries+libs."""
        src_path = self.get_src_path(build_id, builds_root)
        if not os.path.exists(src_path):
            return {"cleaned": False, "reason": "Sources already removed"}

        shutil.rmtree(src_path)
        disk_usage = self.get_disk_usage(build_id, builds_root)
        return {"cleaned": True, "disk_usage_mb": disk_usage}

    # ── Build deletion ────────────────────────────────────────────

    def delete_build(self, build_id: int, builds_root: str = None) -> bool:
        """Remove the entire build directory from disk."""
        build_path = self.get_build_path(build_id, builds_root)
        if os.path.exists(build_path):
            shutil.rmtree(build_path)
            return True
        return False

    # ── Stop running build ────────────────────────────────────────

    async def stop_build(self) -> bool:
        """Kill the currently running build subprocess and its process group."""
        if self.current_process:
            import signal
            try:
                pgid = os.getpgid(self.current_process.pid)
                os.killpg(pgid, signal.SIGKILL)
            except Exception as e:
                self.logger.error(f"Failed to killpg process group: {e}")
                try:
                    self.current_process.kill()
                except Exception:
                    pass

            if self.current_task:
                try:
                    await self.current_task
                except Exception:
                    pass
            return True
        return False

    # ── Internal helpers ──────────────────────────────────────────

    def _clear_stale_git_locks(self, repo_path: str):
        """Remove any stale git lock files from a repository directory."""
        if not os.path.exists(repo_path):
            return
        lock_file = os.path.join(repo_path, ".git", "index.lock")
        if os.path.exists(lock_file):
            self.logger.warning(f"Found stale git index lock at {lock_file}, removing it.")
            try:
                os.remove(lock_file)
            except Exception as e:
                self.logger.error(f"Failed to remove stale git lock {lock_file}: {e}")

    async def _run_logged_cmd(self, cmd, log_callback, cwd=None, env=None,
                              ignore_errors=False):
        """Execute a command, streaming stdout lines to the log callback."""
        await log_callback(f"▶ {shlex.join(cmd)}\n")
        custom_env = os.environ.copy()
        if env:
            custom_env.update(env)
        custom_env["GIT_TERMINAL_PROMPT"] = "0"
        custom_env["GIT_ASKPASS"] = "true"
        custom_env["GIT_SSH_COMMAND"] = "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new"

        self.current_process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=cwd,
            env=custom_env,
            preexec_fn=os.setsid,
        )

        while True:
            line = await self.current_process.stdout.readline()
            if not line:
                break
            await log_callback(line.decode())

        await self.current_process.wait()
        return_code = self.current_process.returncode
        self.current_process = None

        if return_code != 0 and not ignore_errors:
            raise Exception(f"Command failed with exit code {return_code}")

    async def _get_command_output(self, cmd) -> str:
        """Run a command and return its full stdout as a string."""
        custom_env = os.environ.copy()
        custom_env["GIT_TERMINAL_PROMPT"] = "0"
        custom_env["GIT_ASKPASS"] = "true"
        custom_env["GIT_SSH_COMMAND"] = "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new"

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=custom_env,
        )
        stdout, _ = await proc.communicate()
        return stdout.decode().strip()
