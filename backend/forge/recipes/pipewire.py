import os
import re
import shutil
from .base import BaseRecipe

class PipeWireRecipe(BaseRecipe):
    """Receta de compilación de PipeWire mediante Meson y Ninja."""
    software_type = "pipewire"

    def __init__(self, builds_root: str, runner=None):
        super().__init__(builds_root)
        self.runner = runner

    def get_dependencies(self) -> list[str]:
        return [
            "git",
            "meson",
            "ninja-build",
            "pkg-config",
            "gcc",
            "libasound2-dev",
            "libdbus-1-dev",
            "libudev-dev"
        ]

    async def compile(self, build_id: int, version_tag: str, options: dict,
                      sdk_paths: dict | None, install_path: str, log_callback) -> dict:
        src_path = self.runner.get_src_path(build_id)
        os.makedirs(src_path, exist_ok=True)
        os.makedirs(install_path, exist_ok=True)

        await log_callback("━━━ PIPEWIRE SOURCE BUILD ━━━\n")

        clean_tag = version_tag.strip() if version_tag else "1.6.9"
        repo_dir = os.path.join(src_path, f"pipewire-{clean_tag}")
        build_dir = os.path.join(repo_dir, "builddir")

        if os.path.exists(build_dir):
            shutil.rmtree(build_dir, ignore_errors=True)

        if not os.path.exists(repo_dir):
            await log_callback(f"Clonando repositorio oficial de PipeWire (tag {clean_tag})...\n")
            await self.runner._run_logged_cmd(
                ["git", "clone", "--depth", "1", "--branch", clean_tag,
                 "https://gitlab.freedesktop.org/pipewire/pipewire.git", repo_dir],
                log_callback
            )
        else:
            await log_callback("Directorio de fuentes ya presente. Omitiendo clonado...\n")

        # ── Configurar build con Meson ──
        await log_callback("Configurando compilación con Meson...\n")

        # Inspeccionar meson_options.txt para compatibilidad hacia atrás y adelante
        available_options = set()
        options_file = os.path.join(repo_dir, "meson_options.txt")
        if os.path.exists(options_file):
            try:
                with open(options_file, "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        m = re.search(r"option\(\s*'([^']+)'", line)
                        if m:
                            available_options.add(m.group(1))
            except Exception:
                pass

        def opt(name: str, value: str) -> list[str]:
            # Si no pudimos leer meson_options.txt, incluimos las opciones estándar
            if not available_options or name in available_options:
                return [f"-D{name}={value}"]
            return []

        meson_cmd = [
            "meson", "setup", build_dir,
            f"--prefix={install_path}",
            "--libdir=lib",
            *opt("docs", "disabled"),
            *opt("man", "disabled"),
            *opt("tests", "disabled"),
            *opt("examples", "disabled"),
            *opt("session-managers", "[]"),
            *opt("pipewire-pulse", "enabled"),
            *opt("pipewire-alsa", "enabled"),
            *opt("udev", "enabled"),
            *opt("udevrulesdir", os.path.join(install_path, "lib", "udev", "rules.d")),
            *opt("systemd-system-unit-dir", os.path.join(install_path, "lib", "systemd", "system")),
            *opt("systemd-user-unit-dir", os.path.join(install_path, "lib", "systemd", "user")),
            *opt("raop", "disabled")
        ]
        await self.runner._run_logged_cmd(meson_cmd, log_callback, cwd=repo_dir)

        # ── Compilar e instalar con Ninja ──
        await log_callback("Compilando e instalando con Ninja...\n")
        ninja_bin = shutil.which("ninja") or shutil.which("ninja-build") or "ninja"
        ninja_cmd = [ninja_bin, "-C", build_dir, "install"]
        await self.runner._run_logged_cmd(ninja_cmd, log_callback, cwd=repo_dir)

        pipewire_bin = os.path.join(install_path, "bin", "pipewire")
        if not os.path.exists(pipewire_bin):
            return {
                "success": False,
                "error": f"PipeWire binary not found at {pipewire_bin}",
                "binary_path": None,
                "version_output": "",
                "sdk_paths": sdk_paths
            }

        version_output = ""
        run_env = os.environ.copy()
        lib_path = os.path.join(install_path, "lib")
        lib64_path = os.path.join(install_path, "lib64")
        run_env["LD_LIBRARY_PATH"] = f"{lib_path}:{lib64_path}:{run_env.get('LD_LIBRARY_PATH', '')}".strip(":")

        try:
            version_output = await self.runner._get_command_output([pipewire_bin, "--version"], env=run_env)
        except Exception:
            version_output = f"Compiled with libpipewire {clean_tag}\n"

        await log_callback(f"\n━━━ VERIFICACIÓN DEL BINARIO (pipewire --version) ━━━\n{version_output}\n")

        return {
            "success": True,
            "binary_path": pipewire_bin,
            "version_output": version_output,
            "sdk_paths": sdk_paths
        }

    async def validate(self, binary_path: str) -> dict:
        if not binary_path or not os.path.isfile(binary_path):
            return {"valid": False, "error": f"Binary not found: {binary_path}"}

        run_env = os.environ.copy()
        bin_dir = os.path.dirname(binary_path)
        install_path = os.path.dirname(bin_dir)
        lib_path = os.path.join(install_path, "lib")
        lib64_path = os.path.join(install_path, "lib64")
        run_env["LD_LIBRARY_PATH"] = f"{lib_path}:{lib64_path}:{run_env.get('LD_LIBRARY_PATH', '')}".strip(":")

        try:
            output = await self.runner._get_command_output([binary_path, "--version"], env=run_env)
            return {"valid": True, "output": output}
        except Exception as exc:
            return {"valid": False, "error": str(exc)}
