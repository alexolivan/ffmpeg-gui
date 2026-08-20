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
            "libmp3lame": {"pkg": "mp3lame", "type": "optional", "description": "Biblioteca LAME para codificación de audio MP3 (libmp3lame-dev)"},
            "libvorbis": {"pkg": "vorbis", "type": "optional", "description": "Biblioteca Ogg Vorbis para codificación de audio (libvorbis-dev)"},
            "libopus": {"pkg": "opus", "type": "optional", "description": "Biblioteca Opus para codificación de audio (libopus)"},
            "libvpx": {"pkg": "vpx", "type": "optional", "description": "Biblioteca VP8/VP9 (libvpx)"},
            "libfreetype": {"pkg": "freetype2", "type": "optional", "description": "Biblioteca para renderizado de fuentes de texto (libfreetype6-dev)"},
            "libharfbuzz": {"pkg": "harfbuzz", "type": "optional", "description": "Motor de formateo y modelado de texto (libharfbuzz-dev, requerido por drawtext en FFmpeg 6.1+)"},
            "libfontconfig": {"pkg": "fontconfig", "type": "optional", "description": "Gestión y selección de fuentes del sistema (libfontconfig1-dev)"},
            "libfribidi": {"pkg": "fribidi", "type": "optional", "description": "Biblioteca para algoritmos bidireccionales de texto (libfribidi-dev)"}
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

            # Fallback header checks for packages without .pc files on Debian/Ubuntu (e.g. libmp3lame-dev)
            if not installed and name == "libmp3lame":
                for h_path in ["/usr/include/lame/lame.h", "/usr/include/lame.h", "/usr/local/include/lame/lame.h"]:
                    if os.path.exists(h_path):
                        installed = True
                        break
            elif not installed and name == "libvorbis":
                for h_path in ["/usr/include/vorbis/codec.h", "/usr/local/include/vorbis/codec.h"]:
                    if os.path.exists(h_path):
                        installed = True
                        break
            
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
                        log_callback, auto_clean: bool = False, builds_root: str = None,
                        software_type: str = "ffmpeg") -> dict:
        """Execute the build pipeline using the appropriate recipe."""
        if self.is_building:
            await log_callback("ERROR: Build already in progress\n")
            return {"success": False, "error": "Build already in progress"}

        # WHIP requirement validation for FFmpeg 8.0+
        if software_type == "ffmpeg" and options.get("whip"):
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

            # Instanciar la receta modular correspondiente
            from forge.recipes import get_recipe
            recipe = get_recipe(software_type, builds_root or self.workspace_root, runner=self)
            
            # Incorporar srt_version a las opciones si es ffmpeg para la receta
            if software_type == "ffmpeg" and srt_version:
                options["srt_version"] = srt_version

            res = await recipe.compile(
                build_id=build_id,
                version_tag=ffmpeg_version,
                options=options,
                sdk_paths=sdk_paths,
                install_path=install_path,
                log_callback=log_callback
            )

            if res.get("success"):
                # ── Auto-limpieza de fuentes si está activado ────────
                if auto_clean and os.path.exists(src_path):
                    await log_callback("\n━━━ AUTO-CLEAN ENABLED ━━━\n")
                    await log_callback("Cleaning temporary build sources to save space...\n")
                    self.clean_sources(build_id, builds_root)
                    await log_callback("Sources cleaned successfully.\n")

                result = {
                    "success": True,
                    "ffmpeg_binary": res.get("binary_path") if software_type == "ffmpeg" else None,
                    "ffprobe_binary": os.path.join(install_path, "bin", "ffprobe") if software_type == "ffmpeg" and os.path.isfile(os.path.join(install_path, "bin", "ffprobe")) else None,
                    "binary_path": res.get("binary_path"),
                    "version_output": res.get("version_output"),
                    "disk_usage_mb": self.get_disk_usage(build_id, builds_root),
                    "sdk_paths": res.get("sdk_paths", sdk_paths),
                }
            else:
                result = {"success": False, "error": res.get("error", "Unknown build error")}

        except Exception as exc:
            error_msg = str(exc)
            await log_callback(f"\nERROR DURING BUILD: {error_msg}\n")
            result = {"success": False, "error": error_msg}
        finally:
            self.is_building = False
            self.active_build_id = None

        return result

    # ── Build validation ──────────────────────────────────────────

    async def validate_build(self, binary_path: str, software_type: str = "ffmpeg") -> dict:
        """Validate the compiled binary using its recipe."""
        if not binary_path or not os.path.isfile(binary_path):
            return {"valid": False, "error": f"Binary not found: {binary_path}"}

        try:
            from forge.recipes import get_recipe
            recipe = get_recipe(software_type, self.workspace_root, runner=self)
            return await recipe.validate(binary_path)
        except Exception:
            try:
                output = await self._get_command_output([binary_path, "-version"])
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
        return return_code

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
