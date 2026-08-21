import os
import shutil
import asyncio
from .base import BaseRecipe


class DecklinkToolsRecipe(BaseRecipe):
    """Receta de compilación para la utilidad de control atómico Blackmagic DeckLink (decklink-ctl)."""

    software_type = "decklink_tools"
    supported_sdk_types = ["decklink"]
    VERSION = "1.0.1"

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
        requested_ver = None
        if sdk_paths and sdk_paths.get("decklink"):
            requested_ver = sdk_paths["decklink"]
        elif options and options.get("decklink_sdk_version"):
            requested_ver = options["decklink_sdk_version"]
        elif options and options.get("decklink"):
            requested_ver = options["decklink"]

        # Locate SDKs root directory
        ws = getattr(self.runner, "workspace_root", os.getcwd())
        candidates_root = [
            os.path.join(ws, "data", "sdks", "decklink"),
            os.path.join(ws, "backend", "data", "sdks", "decklink"),
            os.path.join(os.getcwd(), "data", "sdks", "decklink"),
            os.path.join(os.getcwd(), "backend", "data", "sdks", "decklink"),
        ]
        sdks_root = next((p for p in candidates_root if os.path.isdir(p)), candidates_root[0])

        sdk_include_dir = None
        resolved_version = requested_ver or "16.0"

        if requested_ver:
            # Check if requested_ver is already a path
            if os.path.isdir(requested_ver):
                candidate = os.path.join(requested_ver, "include")
                if os.path.exists(os.path.join(candidate, "DeckLinkAPI.h")):
                    sdk_include_dir = candidate
                elif os.path.exists(os.path.join(requested_ver, "DeckLinkAPI.h")):
                    sdk_include_dir = requested_ver
            else:
                ver_dir = os.path.join(sdks_root, requested_ver)
                candidate = os.path.join(ver_dir, "include")
                if os.path.exists(os.path.join(candidate, "DeckLinkAPI.h")):
                    sdk_include_dir = candidate
                    resolved_version = requested_ver
                elif os.path.exists(os.path.join(ver_dir, "DeckLinkAPI.h")):
                    sdk_include_dir = ver_dir
                    resolved_version = requested_ver

        if not sdk_include_dir or not os.path.exists(
            os.path.join(sdk_include_dir, "DeckLinkAPI.h")
        ):
            # Fallback scan in default SDKs directory
            if os.path.isdir(sdks_root):
                versions = sorted(os.listdir(sdks_root), reverse=True)
                for v in versions:
                    test_include = os.path.join(sdks_root, v, "include")
                    if os.path.exists(
                        os.path.join(test_include, "DeckLinkAPI.h")
                    ):
                        sdk_include_dir = test_include
                        resolved_version = v
                        break
                    elif os.path.exists(os.path.join(sdks_root, v, "DeckLinkAPI.h")):
                        sdk_include_dir = os.path.join(sdks_root, v)
                        resolved_version = v
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
        await log_callback(f"Utilizando DeckLink SDK v{resolved_version} desde: {sdk_include_dir}\n")

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
            f'-DDECKLINK_SDK_VERSION="{resolved_version}"',
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

        version_output = "decklink-ctl v1.0.1"
        try:
            version_output = await self.runner._get_command_output([output_binary, "--version"])
            await log_callback(f"\n━━━ VERIFICACIÓN DEL BINARIO (decklink-ctl --version) ━━━\n{version_output}\n")
        except Exception as e:
            await log_callback(f"Advertencia al ejecutar test de versión: {e}\n")

        await log_callback(f"✅ decklink-ctl compilado y verificado con éxito en: {output_binary}\n")

        return {
            "success": True,
            "binary_path": output_binary,
            "version_output": version_output,
            "version_tag": self.VERSION,
            "error": None,
        }

    async def validate(self, binary_path: str) -> dict:
        """Runs a harmless dry-run version test on decklink-ctl."""
        if not binary_path or not os.path.isfile(binary_path):
            return {"valid": False, "error": f"Binary not found: {binary_path}"}
        try:
            output = await self.runner._get_command_output([binary_path, "--version"])
            return {"valid": True, "output": output}
        except Exception as exc:
            return {"valid": False, "error": str(exc)}
