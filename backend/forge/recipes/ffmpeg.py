import os
import shutil
import asyncio
from typing import Optional
from .base import BaseRecipe

class FfmpegRecipe(BaseRecipe):
    """Receta para compilar FFmpeg con soporte opcional de LibSRT, ffnvcodec/NVENC, NDI y VAAPI."""
    
    def __init__(self, builds_root: str, runner=None):
        super().__init__(builds_root)
        self.runner = runner

    def get_dependencies(self) -> list[str]:
        return [
            "cmake", "git", "make", "gcc", "pkg-config", "yasm/nasm",
            "libx264", "libx265", "libssl", "libasound2", "libpulse", "libva", "libdrm",
            "libopus", "libvpx", "libfreetype", "libharfbuzz",
            "libfontconfig", "libfribidi", "libfdk_aac"
        ]

    async def compile(self, build_id: int, version_tag: str, options: dict,
                      sdk_paths: dict | None, install_path: str, log_callback) -> dict:
        src_path = self.runner.get_src_path(build_id)
        os.makedirs(src_path, exist_ok=True)
        os.makedirs(install_path, exist_ok=True)

        # 1. Autodetectar versión de VAAPI si está activado
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

        jobs = self.runner.get_max_jobs() if self.runner and hasattr(self.runner, "get_max_jobs") else 4
        # 2. Compilar LibSRT (si está habilitado)
        srt_version = options.get("srt_version")
        if options.get("libsrt") and srt_version:
            await log_callback("━━━ STAGE 1: LIBSRT BUILD ━━━\n")
            srt_src = os.path.join(src_path, "srt")

            if os.path.exists(srt_src):
                shutil.rmtree(srt_src)
            await log_callback(f"Cloning LibSRT and checking out tag {srt_version}...\n")
            await self.runner._run_logged_cmd(
                ["git", "clone", self.runner.SRT_GIT_URL, srt_src],
                log_callback,
            )
            await self.runner._run_logged_cmd(
                ["git", "checkout", srt_version],
                log_callback,
                cwd=srt_src,
            )

            srt_build_dir = os.path.join(srt_src, "build")
            os.makedirs(srt_build_dir, exist_ok=True)

            await self.runner._run_logged_cmd(
                [
                    "cmake", "..",
                    f"-DCMAKE_INSTALL_PREFIX={install_path}",
                    "-DENABLE_STATIC=ON",
                ],
                log_callback,
                cwd=srt_build_dir,
            )
            await self.runner._run_logged_cmd(
                ["make", f"-j{jobs}"], log_callback, cwd=srt_build_dir
            )
            await self.runner._run_logged_cmd(
                ["make", "install"], log_callback, cwd=srt_build_dir
            )
            await log_callback("━━━ LIBSRT BUILD COMPLETE ━━━\n\n")

        # 3. Compilar ffnvcodec headers (si está habilitado NVENC)
        if options.get("nvenc"):
            await log_callback("━━━ STAGE 1.5: NVIDIA NVENC HEADERS ━━━\n")
            nv_src = os.path.join(src_path, "nv-codec-headers")
            
            nv_tag = sdk_paths.get("nvenc_headers") if sdk_paths else None
            if not nv_tag:
                nv_tag = self.runner.get_ffnvcodec_tag(version_tag)
                await log_callback(f"⚠️ Warning: No explicit nv-codec-headers tag selected. Falling back to auto-detected compatibility tag: {nv_tag}\n")

            if os.path.exists(nv_src):
                shutil.rmtree(nv_src)
            await log_callback("Cloning ffnvcodec headers from GitHub...\n")
            await self.runner._run_logged_cmd(
                ["git", "clone", "https://github.com/FFmpeg/nv-codec-headers.git", nv_src],
                log_callback,
            )

            if nv_tag:
                await log_callback(f"Checking out nv-codec-headers tag: {nv_tag}...\n")
                await self.runner._run_logged_cmd(
                    ["git", "checkout", "-f", nv_tag],
                    log_callback,
                    cwd=nv_src,
                )
            else:
                await log_callback("Using latest master branch for nv-codec-headers...\n")
                await self.runner._run_logged_cmd(
                    ["git", "checkout", "-f", "master"],
                    log_callback,
                    cwd=nv_src,
                )
                await self.runner._run_logged_cmd(
                    ["git", "pull"],
                    log_callback,
                    cwd=nv_src,
                )

            await log_callback("Installing ffnvcodec headers to install prefix...\n")
            await self.runner._run_logged_cmd(
                ["make", f"PREFIX={install_path}", "install"],
                log_callback,
                cwd=nv_src,
            )
            await log_callback("━━━ NVIDIA HEADERS COMPLETE ━━━\n\n")

        # 4. Compilar FFmpeg
        await log_callback("━━━ STAGE 2: FFMPEG BUILD ━━━\n")
        ffmpeg_src = os.path.join(src_path, "ffmpeg")

        if os.path.exists(ffmpeg_src):
            shutil.rmtree(ffmpeg_src)
        await log_callback(f"Cloning FFmpeg and checking out tag {version_tag}...\n")
        await self.runner._run_logged_cmd(
            ["git", "clone", self.runner.FFMPEG_GIT_URL, ffmpeg_src],
            log_callback,
        )
        await self.runner._run_logged_cmd(
            ["git", "checkout", version_tag],
            log_callback,
            cwd=ffmpeg_src,
        )

        # Configurar banderas de compilación
        config_flags = [
            f"--prefix={install_path}",
            "--enable-gpl",
            "--enable-nonfree",
            "--enable-libx264",
            "--enable-libx265",
            "--enable-openssl",
        ]

        dep_check = self.runner.check_dependencies()
        if dep_check.get("dependencies", {}).get("libmp3lame", {}).get("installed"):
            config_flags.append("--enable-libmp3lame")
        if dep_check.get("dependencies", {}).get("libvorbis", {}).get("installed"):
            config_flags.append("--enable-libvorbis")
        if dep_check.get("dependencies", {}).get("libopus", {}).get("installed"):
            config_flags.append("--enable-libopus")
        if dep_check.get("dependencies", {}).get("libvpx", {}).get("installed"):
            config_flags.append("--enable-libvpx")
        if dep_check.get("dependencies", {}).get("libfreetype", {}).get("installed"):
            config_flags.append("--enable-libfreetype")
        if dep_check.get("dependencies", {}).get("libharfbuzz", {}).get("installed"):
            config_flags.append("--enable-libharfbuzz")
        if dep_check.get("dependencies", {}).get("libfontconfig", {}).get("installed"):
            config_flags.append("--enable-libfontconfig")
        if dep_check.get("dependencies", {}).get("libfribidi", {}).get("installed"):
            config_flags.append("--enable-libfribidi")
        if dep_check.get("dependencies", {}).get("libfdk_aac", {}).get("installed"):
            config_flags.append("--enable-libfdk-aac")
            options["libfdk_aac"] = True
        if dep_check.get("dependencies", {}).get("libpulse", {}).get("installed"):
            config_flags.append("--enable-libpulse")
            options["libpulse"] = True

        if options.get("libsrt"):
            config_flags.append("--enable-libsrt")
        if options.get("vaapi"):
            config_flags.append("--enable-vaapi")

        # Integración de DeckLink
        if options.get("decklink") and sdk_paths and sdk_paths.get("decklink"):
            decklink_version = sdk_paths.get("decklink")
            decklink_sdk_path = os.path.join(self.runner.workspace_root, "data", "sdks", "decklink", decklink_version)
            if not os.path.exists(decklink_sdk_path):
                raise FileNotFoundError(f"DeckLink SDK version '{decklink_version}' is not installed.")
            
            decklink_include = os.path.join(decklink_sdk_path, "include")
            config_flags.append("--enable-decklink")
            config_flags.append(f"--extra-cflags=-I{decklink_include}")
            config_flags.append(f"--extra-cxxflags=-I{decklink_include}")

        # Integración de NVIDIA NVENC
        if options.get("nvenc"):
            config_flags.append("--enable-nvenc")
            config_flags.append("--enable-ffnvcodec")
            if options.get("cuda_filters"):
                clang_installed = dep_check["dependencies"].get("clang", {}).get("installed", False)
                npp_installed = dep_check["dependencies"].get("nvidia-cuda-dev", {}).get("installed", False)
                if not clang_installed or not npp_installed:
                    raise RuntimeError("Missing CUDA/Clang dependencies for CUDA Filters compilation.")
                config_flags.append("--enable-cuda-llvm")
                config_flags.append("--enable-libnpp")
                config_flags.append("--enable-nvdec")

        # Integración de NDI
        if options.get("ndi") and sdk_paths and sdk_paths.get("ndi"):
            ndi_version = sdk_paths.get("ndi")
            ndi_sdk_path = os.path.join(self.runner.workspace_root, "data", "sdks", "ndi", ndi_version)
            if not os.path.exists(ndi_sdk_path):
                raise FileNotFoundError(f"NDI SDK version '{ndi_version}' is not installed.")

            await log_callback("━━━ APPLYING NDI COMMUNITY PATCH ━━━\n")
            custom_patch_file = sdk_paths.get("ndi_patch_file")
            if os.path.basename(self.runner.workspace_root) == "backend":
                system_patches_dir = os.path.join(self.runner.workspace_root, "patches")
                user_patches_dir = os.path.join(self.runner.workspace_root, "data", "patches")
            else:
                system_patches_dir = os.path.join(self.runner.workspace_root, "backend", "patches")
                user_patches_dir = os.path.join(self.runner.workspace_root, "backend", "data", "patches")

            if custom_patch_file:
                local_patch_path = os.path.join(user_patches_dir, custom_patch_file)
                if not os.path.exists(local_patch_path):
                    local_patch_path = os.path.join(system_patches_dir, custom_patch_file)
            else:
                clean_ver = str(version_tag).lstrip("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")
                try:
                    major = int(clean_ver.split('.')[0])
                except Exception:
                    major = 7
                default_patch_name = "system_ffmpeg_7.patch" if major >= 7 else "system_ffmpeg_6.patch"
                local_patch_path = os.path.join(system_patches_dir, default_patch_name)

            if os.path.exists(local_patch_path):
                patch_file = os.path.join(src_path, "ndi.patch")
                shutil.copy2(local_patch_path, patch_file)
                await log_callback(f"Applying NDI patch ({os.path.basename(local_patch_path)}) for FFmpeg version {version_tag}...\n")
                await self.runner._run_logged_cmd(
                    ["git", "apply", "--ignore-whitespace", "--whitespace=nowarn", patch_file],
                    log_callback,
                    cwd=ffmpeg_src,
                    ignore_errors=True
                )

            config_flags.append("--enable-libndi_newtek")
            config_flags.append(f"--extra-cflags=-I{ndi_sdk_path}/include")
            config_flags.append(f"--extra-ldflags=-L{ndi_sdk_path}/lib/x86_64-linux-gnu")
            config_flags.append(f"--extra-ldflags=-Wl,-rpath,{ndi_sdk_path}/lib/x86_64-linux-gnu")
            config_flags.append("--extra-libs=-lavahi-client -lavahi-common")

        env = os.environ.copy()
        install_lib_path = os.path.join(install_path, "lib")
        env["PKG_CONFIG_PATH"] = os.path.join(install_lib_path, "pkgconfig")
        config_flags.append(f"--extra-ldflags=-Wl,-rpath,{install_lib_path}")

        await self.runner._run_logged_cmd(
            ["./configure"] + config_flags,
            log_callback,
            cwd=ffmpeg_src,
            env=env,
        )
        await self.runner._run_logged_cmd(
            ["make", f"-j{jobs}"], log_callback, cwd=ffmpeg_src
        )
        await self.runner._run_logged_cmd(
            ["make", "install"], log_callback, cwd=ffmpeg_src
        )

        ffmpeg_bin = os.path.join(install_path, "bin", "ffmpeg")
        version_output = ""
        hw_checks = []
        if os.path.isfile(ffmpeg_bin):
            version_output = await self.runner._get_command_output([ffmpeg_bin, "-version"])
            hw_checks = await self.run_hw_smoke_tests(ffmpeg_bin, build_options=options)
            if hw_checks:
                await log_callback("\n━━━ RUNTIME HARDWARE SMOKE TESTS ━━━\n")
                for chk in hw_checks:
                    badge = "✅" if chk["status"] == "ok" else ("⚠️" if chk["status"] == "warning" else "ℹ️")
                    await log_callback(f"{badge} [{chk['engine'].upper()}] {chk['message']}\n")

        return {
            "success": True,
            "binary_path": ffmpeg_bin if os.path.isfile(ffmpeg_bin) else None,
            "version_output": version_output,
            "hw_checks": hw_checks,
            "sdk_paths": sdk_paths,
            "build_options": options
        }

    async def _run_smoke_cmd(self, cmd: list[str], timeout_sec: float = 6.0) -> tuple[int, str]:
        """Run a short 1-frame smoke command and return (returncode, concise output)."""
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout_sec)
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except Exception:
                pass
            return 124, f"Timed out after {timeout_sec}s"
        err_text = (stderr or b"").decode("utf-8", errors="replace").strip()
        out_text = (stdout or b"").decode("utf-8", errors="replace").strip()
        return proc.returncode or 0, err_text or out_text

    async def run_hw_smoke_tests(self, binary_path: str, build_options: Optional[dict] = None) -> list[dict]:
        """Symmetrical 1-frame runtime smoke tests for NVENC and VAAPI hardware encoders."""
        try:
            from core.hw_probe import detect_host_nvenc_api_version, detect_host_vaapi_render_node
        except ImportError:
            from backend.core.hw_probe import detect_host_nvenc_api_version, detect_host_vaapi_render_node

        if isinstance(build_options, dict):
            check_nvenc = bool(build_options.get("nvenc"))
            check_vaapi = bool(build_options.get("vaapi"))
        else:
            rc_enc, enc_out = await self._run_smoke_cmd([binary_path, "-hide_banner", "-encoders"])
            enc_text = enc_out if rc_enc == 0 else ""
            check_nvenc = "h264_nvenc" in enc_text
            check_vaapi = "h264_vaapi" in enc_text

        checks: list[dict] = []

        if check_nvenc:
            has_nvidia_gpu = shutil.which("nvidia-smi") is not None or os.path.exists("/dev/nvidia0")
            if not has_nvidia_gpu:
                checks.append({
                    "engine": "nvenc",
                    "status": "skipped",
                    "message": "No NVIDIA GPU detected on this host",
                })
            else:
                host_api = detect_host_nvenc_api_version()
                rc, output = await self._run_smoke_cmd([
                    binary_path, "-nostdin", "-hide_banner", "-loglevel", "error",
                    "-f", "lavfi", "-i", "color=c=black:s=256x256:d=0.1",
                    "-frames:v", "1", "-c:v", "h264_nvenc", "-f", "null", "-",
                ])
                if rc == 0:
                    api_suffix = f" (Host API {host_api})" if host_api else ""
                    checks.append({
                        "engine": "nvenc",
                        "status": "ok",
                        "message": f"h264_nvenc runtime encode OK{api_suffix}",
                    })
                else:
                    lines = [ln.strip() for ln in output.splitlines() if ln.strip()][:2]
                    checks.append({
                        "engine": "nvenc",
                        "status": "warning",
                        "message": " | ".join(lines) if lines else f"h264_nvenc failed with exit code {rc}",
                    })

        if check_vaapi:
            render_node = detect_host_vaapi_render_node()
            if not render_node:
                checks.append({
                    "engine": "vaapi",
                    "status": "skipped",
                    "message": "No Intel/AMD VAAPI render node detected on this host",
                })
            else:
                rc, output = await self._run_smoke_cmd([
                    binary_path, "-nostdin", "-hide_banner", "-loglevel", "error",
                    "-vaapi_device", render_node,
                    "-f", "lavfi", "-i", "color=c=black:s=256x256:d=0.1",
                    "-frames:v", "1", "-vf", "format=nv12,hwupload",
                    "-c:v", "h264_vaapi", "-f", "null", "-",
                ])
                if rc == 0:
                    checks.append({
                        "engine": "vaapi",
                        "status": "ok",
                        "message": f"h264_vaapi runtime encode OK ({render_node})",
                    })
                else:
                    lines = [ln.strip() for ln in output.splitlines() if ln.strip()][:2]
                    checks.append({
                        "engine": "vaapi",
                        "status": "warning",
                        "message": " | ".join(lines) if lines else f"h264_vaapi failed with exit code {rc}",
                    })

        return checks

    async def validate(self, binary_path: str, build_options: Optional[dict] = None) -> dict:
        if not binary_path or not os.path.isfile(binary_path):
            return {"valid": False, "error": "El binario de FFmpeg no existe"}
        try:
            output = await self.runner._get_command_output([binary_path, "-version"])
            hw_checks = await self.run_hw_smoke_tests(binary_path, build_options=build_options)
            return {
                "valid": True,
                "output": output,
                "hw_checks": hw_checks,
                "has_warnings": any(c["status"] == "warning" for c in hw_checks),
            }
        except Exception as e:
            return {"valid": False, "error": str(e)}
