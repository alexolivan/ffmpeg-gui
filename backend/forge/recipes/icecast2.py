import os
import re
import shutil
import asyncio
from .base import BaseRecipe

class IcecastRecipe(BaseRecipe):
    """Receta para compilar Icecast2 desde el código fuente."""
    software_type = "icecast2"
    
    def __init__(self, builds_root: str, runner=None):
        super().__init__(builds_root)
        self.runner = runner

    def get_dependencies(self) -> list[str]:
        return ["curl", "make", "gcc", "libxml2-dev", "libxslt1-dev", "libssl-dev", "libvorbis-dev", "libogg-dev", "libcurl4-openssl-dev"]

    async def compile(self, build_id: int, version_tag: str, options: dict,
                      sdk_paths: dict | None, install_path: str, log_callback) -> dict:
        src_path = self.runner.get_src_path(build_id)
        os.makedirs(src_path, exist_ok=True)
        os.makedirs(install_path, exist_ok=True)

        await log_callback("━━━ ICECAST2 SOURCE BUILD ━━━\n")
        
        # Extract clean numeric version (e.g. icecast-2.5.0, v2.5.0, 2.5.0 -> 2.5.0)
        clean_version = re.sub(r'^[^\d]*', '', version_tag).strip() if version_tag else ""
        if not clean_version:
            clean_version = "2.5.0"
        download_url = f"https://downloads.xiph.org/releases/icecast/icecast-{clean_version}.tar.gz"
        
        tarball_path = os.path.join(src_path, f"icecast-{clean_version}.tar.gz")
        extracted_dir = os.path.join(src_path, f"icecast-{clean_version}")
        
        if os.path.exists(extracted_dir):
            shutil.rmtree(extracted_dir)
            
        download_ok = False
        await log_callback(f"Descargando Icecast2 v{clean_version} desde Xiph Downloads...\n")
        try:
            await self.runner._run_logged_cmd(
                ["curl", "-L", "-f", "-o", tarball_path, download_url],
                log_callback
            )
            if os.path.exists(tarball_path) and os.path.getsize(tarball_path) > 10000:
                download_ok = True
        except Exception as e:
            await log_callback(f"Aviso: Falló descarga directa del tarball ({e}). Intentando vía Git clone...\n")

        if download_ok:
            await log_callback("Extrayendo tarball de Icecast2...\n")
            await self.runner._run_logged_cmd(
                ["tar", "-zxf", tarball_path, "-C", src_path],
                log_callback
            )
        else:
            # Fallback: git clone from official Xiph GitLab
            git_tag = f"icecast-{clean_version}" if not version_tag.startswith("icecast-") else version_tag
            await log_callback(f"Clonando Icecast2 desde GitLab Xiph (tag/ref {git_tag})...\n")
            await self.runner._run_logged_cmd(
                ["git", "clone", "--depth", "1", "--branch", git_tag, "https://gitlab.xiph.org/xiph/icecast-server.git", extracted_dir],
                log_callback
            )
            autogen_sh = os.path.join(extracted_dir, "autogen.sh")
            if os.path.exists(autogen_sh):
                await log_callback("Generando scripts de configuración (autogen.sh)...\n")
                await self.runner._run_logged_cmd(["./autogen.sh"], log_callback, cwd=extracted_dir)
        
        await log_callback("Configurando Icecast2...\n")
        config_flags = [
            f"--prefix={install_path}",
            "--with-curl",
            "--with-openssl"
        ]
        
        await self.runner._run_logged_cmd(
            ["./configure"] + config_flags,
            log_callback,
            cwd=extracted_dir
        )
        
        await log_callback("Compilando...\n")
        await self.runner._run_logged_cmd(
            ["make", "-j4"],
            log_callback,
            cwd=extracted_dir
        )
        
        await log_callback("Instalando...\n")
        await self.runner._run_logged_cmd(
            ["make", "install"],
            log_callback,
            cwd=extracted_dir
        )
        
        icecast_bin = os.path.join(install_path, "bin", "icecast")
        version_output = f"Icecast {clean_version}\n"
        
        return {
            "success": True,
            "binary_path": icecast_bin if os.path.exists(icecast_bin) else None,
            "version_output": version_output,
            "sdk_paths": sdk_paths
        }

    async def validate(self, binary_path: str) -> dict:
        if not binary_path or not os.path.exists(binary_path):
            return {"valid": False, "error": "El binario de Icecast no existe"}
        return {"valid": True, "output": "Icecast binary validation successful"}
