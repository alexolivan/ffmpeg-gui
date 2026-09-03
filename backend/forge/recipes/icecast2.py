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
        return ["curl", "make", "gcc", "pkg-config", "librhash-dev", "libxml2-dev", "libxslt1-dev", "libssl-dev", "libvorbis-dev", "libogg-dev", "libcurl4-openssl-dev", "libigloo-dev"]

    async def compile(self, build_id: int, version_tag: str, options: dict,
                      sdk_paths: dict | None, install_path: str, log_callback) -> dict:
        import subprocess

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
            if not os.path.exists(extracted_dir):
                for entry in os.listdir(src_path):
                    full_entry = os.path.join(src_path, entry)
                    if os.path.isdir(full_entry) and entry.startswith("icecast") and not entry.startswith("libigloo"):
                        extracted_dir = full_entry
                        break
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

        # ── Dependency check & auto-build: libigloo (prerequisite for Icecast >= 2.5) ──
        has_system_igloo = False
        try:
            cmd = ["pkg-config", "--exists", "igloo >= 0.9.4"]
            subprocess.run(cmd, capture_output=True, check=True)
            has_system_igloo = True
        except Exception:
            has_system_igloo = False

        igloo_pc_path = os.path.join(install_path, "lib", "pkgconfig", "igloo.pc")
        igloo_pc64_path = os.path.join(install_path, "lib64", "pkgconfig", "igloo.pc")
        has_vendored_igloo = os.path.exists(igloo_pc_path) or os.path.exists(igloo_pc64_path)

        if not has_system_igloo and not has_vendored_igloo:
            await log_callback("\n━━━ AUTO-COMPILANDO DEPENDENCIA: libigloo v0.9.5 (Requerida por Icecast 2.5+) ━━━\n")
            igloo_version = "0.9.5"
            igloo_url = f"https://downloads.xiph.org/releases/igloo/libigloo-{igloo_version}.tar.gz"
            igloo_tarball = os.path.join(src_path, f"libigloo-{igloo_version}.tar.gz")
            igloo_dir = os.path.join(src_path, f"libigloo-{igloo_version}")

            if os.path.exists(igloo_dir):
                shutil.rmtree(igloo_dir)

            igloo_dl_ok = False
            await log_callback(f"Descargando libigloo v{igloo_version} desde Xiph Downloads...\n")
            try:
                await self.runner._run_logged_cmd(
                    ["curl", "-L", "-f", "-o", igloo_tarball, igloo_url],
                    log_callback
                )
                if os.path.exists(igloo_tarball) and os.path.getsize(igloo_tarball) > 10000:
                    igloo_dl_ok = True
            except Exception as e:
                await log_callback(f"Aviso: Falló descarga directa de libigloo ({e}). Intentando Git clone...\n")

            if igloo_dl_ok:
                await log_callback("Extrayendo tarball de libigloo...\n")
                await self.runner._run_logged_cmd(
                    ["tar", "-zxf", igloo_tarball, "-C", src_path],
                    log_callback
                )
            else:
                await log_callback("Clonando libigloo desde GitLab Xiph...\n")
                await self.runner._run_logged_cmd(
                    ["git", "clone", "--depth", "1", "--branch", f"v{igloo_version}", "https://gitlab.xiph.org/xiph/icecast-libigloo.git", igloo_dir],
                    log_callback
                )
                igloo_autogen = os.path.join(igloo_dir, "autogen.sh")
                if os.path.exists(igloo_autogen):
                    await log_callback("Generando configuración de libigloo (autogen.sh)...\n")
                    await self.runner._run_logged_cmd(["./autogen.sh"], log_callback, cwd=igloo_dir)

            await log_callback("Configurando libigloo...\n")
            await self.runner._run_logged_cmd(
                ["./configure", f"--prefix={install_path}"],
                log_callback,
                cwd=igloo_dir
            )

            await log_callback("Compilando libigloo...\n")
            await self.runner._run_logged_cmd(
                ["make", "-j4"],
                log_callback,
                cwd=igloo_dir
            )

            await log_callback("Instalando libigloo en prefijo local...\n")
            await self.runner._run_logged_cmd(
                ["make", "install"],
                log_callback,
                cwd=igloo_dir
            )
            await log_callback("✓ Dependencia libigloo instalada con éxito.\n\n")

        # Configure environment variables to locate vendored and system dependencies
        build_env = os.environ.copy()
        prefix_lib = os.path.join(install_path, "lib")
        prefix_lib64 = os.path.join(install_path, "lib64")
        prefix_inc = os.path.join(install_path, "include")
        prefix_pkg = os.path.join(prefix_lib, "pkgconfig")
        prefix_pkg64 = os.path.join(prefix_lib64, "pkgconfig")

        orig_pkg = build_env.get("PKG_CONFIG_PATH", "")
        build_env["PKG_CONFIG_PATH"] = f"{prefix_pkg}:{prefix_pkg64}:{orig_pkg}".strip(":")

        orig_ld = build_env.get("LDFLAGS", "")
        build_env["LDFLAGS"] = f"-L{prefix_lib} -L{prefix_lib64} -Wl,-rpath,{prefix_lib} -Wl,-rpath,{prefix_lib64} {orig_ld}".strip()

        orig_cpp = build_env.get("CPPFLAGS", "")
        build_env["CPPFLAGS"] = f"-I{prefix_inc} {orig_cpp}".strip()

        configure_script = os.path.join(extracted_dir, "configure")
        autogen_script = os.path.join(extracted_dir, "autogen.sh")
        if not os.path.exists(configure_script) and os.path.exists(autogen_script):
            await log_callback("Generando scripts de configuración (autogen.sh)...\n")
            await self.runner._run_logged_cmd(["./autogen.sh"], log_callback, cwd=extracted_dir, env=build_env)
        
        await log_callback("Configurando Icecast2...\n")
        config_flags = [
            f"--prefix={install_path}",
            "--with-curl",
            "--with-openssl"
        ]
        
        await self.runner._run_logged_cmd(
            ["./configure"] + config_flags,
            log_callback,
            cwd=extracted_dir,
            env=build_env
        )
        
        await log_callback("Compilando Icecast2...\n")
        await self.runner._run_logged_cmd(
            ["make", "-j4"],
            log_callback,
            cwd=extracted_dir,
            env=build_env
        )
        
        await log_callback("Instalando Icecast2...\n")
        await self.runner._run_logged_cmd(
            ["make", "install"],
            log_callback,
            cwd=extracted_dir,
            env=build_env
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
