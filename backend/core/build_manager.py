import asyncio
import os
import subprocess
import logging
import shutil

class BuildManager:
    def __init__(self, install_dir: str, build_dir: str):
        self.install_dir = os.path.abspath(install_dir)
        self.build_dir = os.path.abspath(build_dir)
        self.is_building = False
        self.logger = logging.getLogger("BuildManager")
        self.current_process = None

    def check_dependencies(self):
        self.logger.info("Starting dependency check...")
        deps = ["cmake", "git", "make", "gcc", "pkg-config"]
        results = {}
        for dep in deps:
            # Using shutil.which is more reliable and synchronous (fast enough here)
            results[dep] = shutil.which(dep) is not None
        
        results["yasm/nasm"] = (shutil.which("yasm") is not None) or (shutil.which("nasm") is not None)
        self.logger.info(f"Check results: {results}")
        return results

    async def _check_any(self, binaries):
        for b in binaries:
            try:
                p = await asyncio.create_subprocess_exec("which", b, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
                await p.wait()
                if p.returncode == 0: return True
            except:
                continue
        return False

    async def run_build(self, options: dict, log_callback):
        if self.is_building:
            await log_callback("ERROR: Build already in progress\n")
            return
        
        self.is_building = True
        try:
            os.makedirs(self.build_dir, exist_ok=True)
            os.makedirs(self.install_dir, exist_ok=True)

            # 1. LibSRT Build if enabled
            if options.get('libsrt'):
                await log_callback("--- STARTING LIBSRT BUILD ---\n")
                srt_src = os.path.join(self.build_dir, "srt")
                if not os.path.exists(srt_src):
                    await self._run_logged_cmd(["git", "clone", "--depth", "1", "https://github.com/Haivision/srt.git", srt_src], log_callback)
                
                os.makedirs(os.path.join(srt_src, "build"), exist_ok=True)
                await self._run_logged_cmd(["cmake", "..", f"-DCMAKE_INSTALL_PREFIX={self.install_dir}", "-DENABLE_STATIC=ON"], log_callback, cwd=os.path.join(srt_src, "build"))
                await self._run_logged_cmd(["make", "-j4"], log_callback, cwd=os.path.join(srt_src, "build"))
                await self._run_logged_cmd(["make", "install"], log_callback, cwd=os.path.join(srt_src, "build"))
                await log_callback("--- LIBSRT BUILD FINISHED ---\n\n")

            # 2. FFmpeg Build
            await log_callback("--- STARTING FFMPEG BUILD ---\n")
            ffmpeg_src = os.path.join(self.build_dir, "ffmpeg")
            if not os.path.exists(ffmpeg_src):
                await self._run_logged_cmd(["git", "clone", "--depth", "1", "https://git.ffmpeg.org/ffmpeg.git", ffmpeg_src], log_callback)

            config_flags = [
                f"--prefix={self.install_dir}",
                "--enable-gpl",
                "--enable-nonfree",
                "--enable-libx264",
                "--enable-libx265",
            ]
            if options.get('libsrt'): config_flags.append("--enable-libsrt")
            if options.get('vaapi'): config_flags.append("--enable-vaapi")
            
            # Environment for PKG_CONFIG
            env = os.environ.copy()
            env["PKG_CONFIG_PATH"] = os.path.join(self.install_dir, "lib/pkgconfig")

            await self._run_logged_cmd(["./configure"] + config_flags, log_callback, cwd=ffmpeg_src, env=env)
            await self._run_logged_cmd(["make", "-j4"], log_callback, cwd=ffmpeg_src)
            await self._run_logged_cmd(["make", "install"], log_callback, cwd=ffmpeg_src)
            await log_callback("\n--- FFMPEG BUILD SUCCESSFUL ---\n")

        except Exception as e:
            await log_callback(f"\nERROR DURING BUILD: {str(e)}\n")
        finally:
            self.is_building = False

    async def _run_logged_cmd(self, cmd, log_callback, cwd=None, env=None):
        await log_callback(f"EXECUTING: {' '.join(cmd)}\n")
        self.current_process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=cwd,
            env=env
        )

        while True:
            line = await self.current_process.stdout.readline()
            if not line:
                break
            await log_callback(line.decode())
        
        await self.current_process.wait()
        return_code = self.current_process.returncode
        self.current_process = None
        
        if return_code != 0:
            raise Exception(f"Command failed with exit code {return_code}")

    async def stop_build(self):
        if self.current_process:
            self.current_process.kill()
            self.is_building = False
            return True
        return False

    def clean_build(self):
        if os.path.exists(self.build_dir):
            import shutil
            shutil.rmtree(self.build_dir)
            return True
        return False
