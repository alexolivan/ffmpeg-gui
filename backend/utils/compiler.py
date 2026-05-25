import os
import subprocess
import logging
import shlex

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("FFMPEG-Compiler")

BUILD_DIR = os.path.abspath("./build")
INSTALL_DIR = os.path.abspath("./ffmpeg_bin")

def run_cmd(cmd, cwd=None):
    logger.info(f"Running: {shlex.join(cmd)}")
    subprocess.check_call(cmd, cwd=cwd)

def setup_dirs():
    os.makedirs(BUILD_DIR, exist_ok=True)
    os.makedirs(INSTALL_DIR, exist_ok=True)

def build_libsrt():
    logger.info("Building LibSRT...")
    srt_src = os.path.join(BUILD_DIR, "srt")
    if not os.path.exists(srt_src):
        run_cmd(["git", "clone", "--depth", "1", "https://github.com/Haivision/srt.git", srt_src])
    
    os.makedirs(os.path.join(srt_src, "build"), exist_ok=True)
    run_cmd(["cmake", "..", f"-DCMAKE_INSTALL_PREFIX={INSTALL_DIR}", "-DENABLE_STATIC=ON"], cwd=os.path.join(srt_src, "build"))
    run_cmd(["make", "-j4"], cwd=os.path.join(srt_src, "build"))
    run_cmd(["make", "install"], cwd=os.path.join(srt_src, "build"))

def build_ffmpeg():
    logger.info("Starting FFMPEG Build process...")
    setup_dirs()
    
    # Example compilation flags for broadcast standards
    config_flags = [
        "--prefix=" + INSTALL_DIR,
        "--enable-gpl",
        "--enable-nonfree",
        "--enable-libx264",
        "--enable-libx265",
        "--enable-libsrt",
        # "--enable-libndi_newtek", # Requires NDI SDK
        # "--enable-decklink",      # Requires Decklink SDK
    ]
    
    # 1. Clone ffmpeg if not exists
    ffmpeg_src = os.path.join(BUILD_DIR, "ffmpeg")
    if not os.path.exists(ffmpeg_src):
        run_cmd(["git", "clone", "--depth", "1", "https://git.ffmpeg.org/ffmpeg.git", ffmpeg_src])
    
    # 2. Configure
    # Set PKG_CONFIG_PATH to find our local libsrt
    env = os.environ.copy()
    env["PKG_CONFIG_PATH"] = os.path.join(INSTALL_DIR, "lib/pkgconfig")
    
    run_cmd(["./configure"] + config_flags, cwd=ffmpeg_src)
    
    # 3. Make
    run_cmd(["make", "-j4"], cwd=ffmpeg_src)
    run_cmd(["make", "install"], cwd=ffmpeg_src)
    
    logger.info(f"FFMPEG built successfully in {INSTALL_DIR}")

if __name__ == "__main__":
    build_ffmpeg()
