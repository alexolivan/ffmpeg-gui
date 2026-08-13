import os
import shutil
import asyncio
from .base import BaseRecipe

class MediaMtxRecipe(BaseRecipe):
    """Receta para descargar y configurar el binario de MediaMTX."""
    
    def __init__(self, builds_root: str, runner=None):
        super().__init__(builds_root)
        self.runner = runner

    def get_dependencies(self) -> list[str]:
        return ["curl", "tar"]

    async def compile(self, build_id: int, version_tag: str, options: dict,
                      sdk_paths: dict | None, install_path: str, log_callback) -> dict:
        src_path = self.runner.get_src_path(build_id)
        os.makedirs(src_path, exist_ok=True)
        os.makedirs(install_path, exist_ok=True)
        os.makedirs(os.path.join(install_path, "bin"), exist_ok=True)

        await log_callback("━━━ MEDIAMTX PRECOMPILED DOWNLOAD ━━━\n")
        
        clean_version = version_tag.lstrip("v").strip()
        if not clean_version:
            clean_version = "1.9.0"
        
        download_url = f"https://github.com/bluenviron/mediamtx/releases/download/v{clean_version}/mediamtx_v{clean_version}_linux_amd64.tar.gz"
        tarball_path = os.path.join(src_path, f"mediamtx_v{clean_version}.tar.gz")
        
        await log_callback(f"Descargando MediaMTX v{clean_version} de GitHub Releases...\n")
        await self.runner._run_logged_cmd(
            ["curl", "-L", "-o", tarball_path, download_url],
            log_callback
        )
        
        await log_callback("Extrayendo tarball...\n")
        temp_extract = os.path.join(src_path, "mediamtx_extracted")
        if os.path.exists(temp_extract):
            shutil.rmtree(temp_extract)
        os.makedirs(temp_extract, exist_ok=True)
        
        await self.runner._run_logged_cmd(
            ["tar", "-zxf", tarball_path, "-C", temp_extract],
            log_callback
        )
        
        mediamtx_bin_src = os.path.join(temp_extract, "mediamtx")
        mediamtx_bin_dest = os.path.join(install_path, "bin", "mediamtx")
        
        if os.path.exists(mediamtx_bin_src):
            shutil.copy2(mediamtx_bin_src, mediamtx_bin_dest)
            conf_src = os.path.join(temp_extract, "mediamtx.yml")
            conf_dest = os.path.join(install_path, "bin", "mediamtx.yml")
            if os.path.exists(conf_src):
                shutil.copy2(conf_src, conf_dest)
            
            os.chmod(mediamtx_bin_dest, 0o755)
            await log_callback("MediaMTX instalado con éxito.\n")
        else:
            raise FileNotFoundError("No se encontró el binario mediamtx dentro del tarball extraído.")
            
        version_output = f"MediaMTX v{clean_version}\n"
        
        return {
            "success": True,
            "binary_path": mediamtx_bin_dest,
            "version_output": version_output,
            "sdk_paths": sdk_paths
        }

    async def validate(self, binary_path: str) -> dict:
        if not binary_path or not os.path.exists(binary_path):
            return {"valid": False, "error": "El binario de MediaMTX no existe"}
        return {"valid": True, "output": "MediaMTX binary validation successful"}
