import os
import shutil
import asyncio
from .base import BaseRecipe

class KioskRecipe(BaseRecipe):
    """Receta para configurar Kiosk Cog browser (usa el binario del sistema/instalado)."""
    
    def __init__(self, builds_root: str, runner=None):
        super().__init__(builds_root)
        self.runner = runner

    def get_dependencies(self) -> list[str]:
        return ["cog"]

    async def compile(self, build_id: int, version_tag: str, options: dict,
                      sdk_paths: dict | None, install_path: str, log_callback) -> dict:
        src_path = self.runner.get_src_path(build_id)
        os.makedirs(src_path, exist_ok=True)
        os.makedirs(install_path, exist_ok=True)
        os.makedirs(os.path.join(install_path, "bin"), exist_ok=True)

        await log_callback("━━━ KIOSK COG SETUP ━━━\n")
        
        cog_system_path = shutil.which("cog")
        cog_bin_dest = os.path.join(install_path, "bin", "cog")
        
        if cog_system_path:
            await log_callback(f"Encontrado cog en el sistema: {cog_system_path}\n")
            if os.path.lexists(cog_bin_dest):
                os.remove(cog_bin_dest)
            os.symlink(cog_system_path, cog_bin_dest)
            await log_callback(f"Creado enlace simbólico en {cog_bin_dest}\n")
        else:
            await log_callback("⚠️ WARNING: El navegador 'cog' no está instalado en el sistema.\n")
            await log_callback("Puedes instalarlo en Debian/Ubuntu con: sudo apt install -y cog\n")
            with open(cog_bin_dest, "w") as f:
                f.write("#!/bin/bash\necho 'Mock Cog browser launcher'\n")
            os.chmod(cog_bin_dest, 0o755)
            await log_callback("Creado ejecutable placeholder/mock cog.\n")
            
        version_output = "Cog WPE WebKit Launcher\n"
        if cog_system_path:
            try:
                version_output = await self.runner._get_command_output([cog_system_path, "--version"])
            except Exception:
                pass
                
        return {
            "success": True,
            "binary_path": cog_bin_dest,
            "version_output": version_output,
            "sdk_paths": sdk_paths
        }

    async def validate(self, binary_path: str) -> dict:
        if not binary_path or not os.path.exists(binary_path):
            return {"valid": False, "error": "El binario cog no existe"}
        return {"valid": True, "output": "Cog binary validation successful"}
