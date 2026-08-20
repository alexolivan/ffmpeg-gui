import os
import shutil
import asyncio
from .base import BaseRecipe


class DecklinkToolsRecipe(BaseRecipe):
    """Receta de compilación para la utilidad de control atómico Blackmagic DeckLink (decklink-ctl)."""

    software_type = "decklink_tools"
    supported_sdk_types = ["decklink"]

    def __init__(self, builds_root: str, runner=None):
        super().__init__(builds_root)
        self.runner = runner

    def get_dependencies(self) -> list[str]:
        return ["g++", "make"]

    async def compile(
        self,
        build_id: int,
        version_tag: str,
        options: dict,
        sdk_paths: dict | None,
        install_path: str,
        log_callback,
    ) -> dict:
        src_path = self.runner.get_src_path(build_id)
        os.makedirs(src_path, exist_ok=True)
        os.makedirs(install_path, exist_ok=True)

        await log_callback("━━━ BLACKMAGIC DECKLINK TOOLS BUILD (decklink-ctl) ━━━\n")

        # 1. Resolve DeckLink SDK headers
        sdk_include_dir = None
        if sdk_paths and "decklink" in sdk_paths:
            candidate = os.path.join(sdk_paths["decklink"], "include")
            if os.path.isdir(candidate):
                sdk_include_dir = candidate
            elif os.path.isdir(sdk_paths["decklink"]):
                sdk_include_dir = sdk_paths["decklink"]

        if not sdk_include_dir or not os.path.exists(
            os.path.join(sdk_include_dir, "DeckLinkAPI.h")
        ):
            # Fallback scan in default SDKs directory
            default_sdks_root = os.path.join("data", "sdks", "decklink")
            if os.path.isdir(default_sdks_root):
                versions = sorted(os.listdir(default_sdks_root), reverse=True)
                for v in versions:
                    test_include = os.path.join(default_sdks_root, v, "include")
                    if os.path.exists(
                        os.path.join(test_include, "DeckLinkAPI.h")
                    ):
                        sdk_include_dir = test_include
                        break

        if not sdk_include_dir:
            error_msg = "Error: No se encontró el SDK de Blackmagic DeckLink. Por favor sube un SDK en el gestor de SDKs antes de compilar."
            await log_callback(f"{error_msg}\n")
            return {
                "success": False,
                "binary_path": None,
                "version_output": None,
                "error": error_msg,
            }

        sdk_include_dir = os.path.abspath(sdk_include_dir)
        await log_callback(f"Utilizando DeckLink SDK desde: {sdk_include_dir}\n")

        # 2. Copy source files and SDK headers into build src directory
        source_dir = os.path.abspath(
            os.path.join(
                os.path.dirname(__file__), "..", "sources", "decklink-ctl"
            )
        )
        main_cpp = os.path.join(source_dir, "main.cpp")
        if not os.path.exists(main_cpp):
            error_msg = f"Error: No se encontró el código fuente {main_cpp}"
            await log_callback(f"{error_msg}\n")
            return {
                "success": False,
                "binary_path": None,
                "version_output": None,
                "error": error_msg,
            }

        shutil.copy2(main_cpp, os.path.join(src_path, "main.cpp"))

        # Copy all headers and C++ dispatch files from SDK into src directory for hermetic build
        for filename in os.listdir(sdk_include_dir):
            if filename.endswith((".h", ".idl", ".cpp")):
                shutil.copy2(
                    os.path.join(sdk_include_dir, filename),
                    os.path.join(src_path, filename),
                )

        dispatch_cpp = os.path.join(src_path, "DeckLinkAPIDispatch.cpp")
        if not os.path.exists(dispatch_cpp):
            error_msg = f"Error: 'DeckLinkAPIDispatch.cpp' no encontrado en {sdk_include_dir}"
            await log_callback(f"{error_msg}\n")
            return {
                "success": False,
                "binary_path": None,
                "version_output": None,
                "error": error_msg,
            }

        # 3. Compile with g++
        output_binary = os.path.abspath(os.path.join(install_path, "decklink-ctl"))
        cmd = [
            "g++",
            "-O2",
            "-std=c++11",
            f"-I{sdk_include_dir}",
            "-I.",
            "main.cpp",
            "DeckLinkAPIDispatch.cpp",
            "-ldl",
            "-lpthread",
            "-o",
            output_binary,
        ]

        await log_callback(f"Compilando decklink-ctl: {' '.join(cmd)}\n")
        try:
            res = await self.runner._run_logged_cmd(cmd, log_callback, cwd=src_path)
            if res is not None and res != 0:
                error_msg = f"Fallo en la compilación de decklink-ctl (código de salida {res})"
                await log_callback(f"{error_msg}\n")
                return {
                    "success": False,
                    "binary_path": None,
                    "version_output": None,
                    "error": error_msg,
                }
        except Exception as e:
            error_msg = f"Fallo en la compilación de decklink-ctl: {e}"
            await log_callback(f"{error_msg}\n")
            return {
                "success": False,
                "binary_path": None,
                "version_output": None,
                "error": error_msg,
            }

        # 4. Verify binary executable
        if not os.path.exists(output_binary):
            error_msg = "El binario decklink-ctl no se generó correctamente"
            await log_callback(f"{error_msg}\n")
            return {
                "success": False,
                "binary_path": None,
                "version_output": None,
                "error": error_msg,
            }

        os.chmod(output_binary, 0o755)
        await log_callback(f"✅ decklink-ctl compilado con éxito en: {output_binary}\n")

        return {
            "success": True,
            "binary_path": output_binary,
            "version_output": "decklink-ctl v1.0.0",
            "error": None,
        }
