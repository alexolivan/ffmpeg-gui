import os
import logging

class BaseRecipe:
    """Clase base para recetas de compilación e instalación de binarios de software."""
    
    def __init__(self, builds_root: str):
        self.builds_root = builds_root
        self.logger = logging.getLogger(f"forge.recipes.{self.__class__.__name__.lower()}")

    def get_dependencies(self) -> list[str]:
        """Retorna la lista de dependencias del sistema apt/dnf requeridas."""
        return []

    async def compile(self, build_id: int, version_tag: str, options: dict,
                      sdk_paths: dict | None, install_path: str, log_callback) -> dict:
        """Realiza la fase de compilación e instalación de la receta.
        
        Debe retornar un diccionario con el resultado:
        {
            "success": bool,
            "binary_path": str | None,
            "version_output": str | None,
            "error": str | None
        }
        """
        raise NotImplementedError()

    async def validate(self, binary_path: str) -> dict:
        """Realiza comprobaciones de validez sobre el binario compilado."""
        if not binary_path or not os.path.exists(binary_path):
            return {"valid": False, "error": "El binario no existe"}
        return {"valid": True}
