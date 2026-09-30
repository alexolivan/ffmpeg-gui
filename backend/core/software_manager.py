import os
import re
import shutil
import logging
import platform
import subprocess
import tarfile
import zipfile
import urllib.request
import urllib.error
import json
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session

logger = logging.getLogger("ffmpeg_gui.software_manager")

SUPPORTED_ENGINES: Dict[str, Dict[str, Any]] = {
    "ffmpeg": {
        "name": "FFmpeg",
        "description": "Video/audio transcoding and muxing engine with hardware codec bindings.",
        "default_binary": "ffmpeg",
        "supports_forge": True,
        "supports_installed": True,
        "supports_precompiled": False,
        "always_enabled": True,
        "version_cmd": ["-version"],
    },
    "decklink_tools": {
        "name": "DeckLink Tools (Helper)",
        "description": "Native Blackmagic DeckLink hardware probe and configuration CLI helper.",
        "default_binary": "decklink_helper",
        "supports_forge": True,
        "supports_installed": False,
        "supports_precompiled": False,
        "always_enabled": True,
        "version_cmd": ["--version"],
    },
    "mediamtx": {
        "name": "MediaMTX Hub",
        "description": "Multi-protocol zero-dependency live media hub (RTSP, RTMP, HLS, WebRTC, SRT).",
        "default_binary": "mediamtx",
        "supports_forge": False,
        "supports_installed": True,
        "supports_precompiled": True,
        "always_enabled": False,
        "version_cmd": ["--version"],
        "github_repo": "bluenviron/mediamtx",
    },
    "icecast2": {
        "name": "Icecast2 Server",
        "description": "High-performance audio streaming broadcast server.",
        "default_binary": "icecast2",
        "supports_forge": True,
        "supports_installed": True,
        "supports_precompiled": False,
        "always_enabled": False,
        "version_cmd": ["-v"],
    },
    "chromium": {
        "name": "Chromium / Google Chrome",
        "description": "High-performance Chromium browser engine for web kiosks, WebGL graphics, and live video overlays.",
        "default_binary": "chromium",
        "supports_forge": False,
        "supports_installed": True,
        "supports_precompiled": True,
        "always_enabled": False,
        "version_cmd": ["--version"],
    },
    "firefox": {
        "name": "Mozilla Firefox",
        "description": "Gecko-based web kiosk browser engine with customizable isolated profiles and hardware acceleration.",
        "default_binary": "firefox",
        "supports_forge": False,
        "supports_installed": True,
        "supports_precompiled": True,
        "always_enabled": False,
        "version_cmd": ["--version"],
    },
}


class SoftwareManager:
    """
    Singleton orchestrator for software engine registration, system package probing,
    custom branding icons, and binary lifecycle management.
    """
    _instance: Optional['SoftwareManager'] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(SoftwareManager, cls).__new__(cls)
            cls._instance._init_state()
        return cls._instance

    def _init_state(self):
        self.config: Dict[str, bool] = {
            "ffmpeg_forge_enabled": True,
            "ffmpeg_installed_enabled": True,
            "mediamtx_enabled": True,
            "mediamtx_installed_enabled": False,
            "mediamtx_precompiled_enabled": True,
            "icecast2_enabled": True,
            "icecast2_installed_enabled": True,
            "icecast2_forge_enabled": True,
            "chromium_enabled": True,
            "chromium_installed_enabled": True,
            "chromium_precompiled_enabled": True,
            "firefox_enabled": True,
            "firefox_installed_enabled": True,
            "firefox_precompiled_enabled": True,
        }
        self._cached_releases: Dict[str, Any] = {}
        self._cached_releases_time: Dict[str, float] = {}

    def load_config(self, section: Optional[Dict[str, Any]] = None):
        """Loads engine configuration from the [software_engines] config section."""
        if not section:
            return
        for k, v in section.items():
            if isinstance(v, str):
                val = v.strip().lower() in ("true", "1", "yes", "on")
            else:
                val = bool(v)
            self.config[k] = val

    def get_config(self) -> Dict[str, bool]:
        return dict(self.config)

    def is_engine_enabled(self, software_type: str) -> bool:
        if software_type == "ffmpeg":
            return True
        return self.config.get(f"{software_type}_enabled", False)

    def is_forge_enabled_for_engine(self, software_type: str) -> bool:
        if not self.is_engine_enabled(software_type):
            return False
        meta = SUPPORTED_ENGINES.get(software_type, {})
        if not meta.get("supports_forge"):
            return False
        return self.config.get(f"{software_type}_forge_enabled", True)

    def audit_system_binary(self, software_type: str) -> Dict[str, Any]:
        """Probes host system $PATH for the engine executable and extracts version."""
        meta = SUPPORTED_ENGINES.get(software_type)
        if not meta:
            return {"found": False, "path": None, "version": None}

        bin_name = meta.get("default_binary", software_type)
        bin_path = shutil.which(bin_name)
        if not bin_path or not os.path.isfile(bin_path):
            if software_type == "icecast2":
                bin_path = shutil.which("icecast") or shutil.which("icecast2")
            elif software_type == "chromium":
                bin_path = shutil.which("chromium") or shutil.which("google-chrome") or shutil.which("chromium-browser")
            elif software_type == "firefox":
                bin_path = shutil.which("firefox") or shutil.which("firefox-esr")
            if not bin_path or not os.path.isfile(bin_path):
                return {"found": False, "path": None, "version": None}

        version_str = None
        cmd = [bin_path] + meta.get("version_cmd", ["--version"])
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=2)
            raw_out = (res.stdout or "") + "\n" + (res.stderr or "")
            first_line = raw_out.strip().splitlines()[0] if raw_out.strip() else ""
            
            # Extract clean semver/version pattern (handles 3 or 4 segments like 130.0.6723.91, and suffixes like -esr / esr)
            v_match = re.search(r"(?:version\s*|v)?(\d+(?:\.\d+)+(?:-[a-zA-Z0-9.]+|esr)?|n\d+\.\d+)", first_line, re.IGNORECASE)
            if v_match:
                version_str = v_match.group(1)
            else:
                version_str = first_line[:30].strip() if first_line else "Unknown"
        except Exception as e:
            logger.debug(f"Error probing version for {bin_path}: {e}")
            version_str = "Detected"

        return {
            "found": True,
            "path": bin_path,
            "version": version_str
        }

    def validate_safety_invariants(self, software_type: str, proposed_config: Dict[str, bool]) -> None:
        """
        Ensures that an active software engine cannot have all its binary source types disabled simultaneously.
        """
        meta = SUPPORTED_ENGINES.get(software_type)
        if not meta:
            return

        is_enabled = True if meta.get("always_enabled") else proposed_config.get(f"{software_type}_enabled", False)
        if not is_enabled:
            return

        has_any_source = False
        if meta.get("supports_forge") and proposed_config.get(f"{software_type}_forge_enabled"):
            has_any_source = True
        if meta.get("supports_installed") and proposed_config.get(f"{software_type}_installed_enabled"):
            has_any_source = True
        if meta.get("supports_precompiled") and proposed_config.get(f"{software_type}_precompiled_enabled"):
            has_any_source = True

        if not has_any_source:
            raise ValueError(f"Engine '{meta['name']}' is active and must have at least one binary source (Forge, Installed, or Precompiled) enabled.")

    def get_engines_status(self, db_session: Session) -> Dict[str, Any]:
        """
        Aggregates complete status across all supported software engines,
        including $PATH audit, registered builds, and active dependent services.
        """
        from database.models import SoftwareBuild, Service

        engines_res = {}
        for s_type, meta in SUPPORTED_ENGINES.items():
            is_enabled = True if meta.get("always_enabled") else self.config.get(f"{s_type}_enabled", False)
            
            # System $PATH probing
            sys_audit = self.audit_system_binary(s_type)
            
            # Query registered builds for this software type
            builds = db_session.query(SoftwareBuild).filter(
                SoftwareBuild.software_type == s_type
            ).all()

            builds_list = []
            for b in builds:
                # Count services referencing this build
                ref_count = 0
                try:
                    all_services = db_session.query(Service).all()
                    for svc in all_services:
                        cfg = svc.config or {}
                        if cfg.get("ffmpeg_build_id") == b.id or cfg.get("build_id") == b.id:
                            ref_count += 1
                except Exception:
                    pass

                builds_list.append({
                    "id": b.id,
                    "name": b.name,
                    "version_tag": b.version_tag,
                    "source_type": getattr(b, "source_type", "compiled") or "compiled",
                    "binary_path": b.binary_path,
                    "system_path": getattr(b, "system_path", None),
                    "is_managed": getattr(b, "is_managed", True),
                    "status": b.status,
                    "is_default": b.is_default,
                    "disk_usage_mb": b.disk_usage_mb,
                    "created_at": b.created_at.isoformat() if b.created_at else None,
                    "referencing_services_count": ref_count
                })

            # Check if installed binary is currently registered in builds
            installed_build = next((b for b in builds_list if b["source_type"] == "installed"), None)

            engines_res[s_type] = {
                "key": s_type,
                "name": meta["name"],
                "description": meta["description"],
                "always_enabled": meta.get("always_enabled", False),
                "is_enabled": is_enabled,
                "supports_forge": meta["supports_forge"],
                "forge_enabled": self.config.get(f"{s_type}_forge_enabled", True) if meta["supports_forge"] else False,
                "supports_installed": meta["supports_installed"],
                "installed_enabled": self.config.get(f"{s_type}_installed_enabled", False),
                "supports_precompiled": meta["supports_precompiled"],
                "precompiled_enabled": self.config.get(f"{s_type}_precompiled_enabled", False) if meta["supports_precompiled"] else False,
                "system_binary": sys_audit,
                "installed_build_registered": (installed_build is not None),
                "installed_build_id": installed_build["id"] if installed_build else None,
                "builds": builds_list,
                "total_builds": len(builds_list),
            }

        return engines_res

    def toggle_installed_binary(self, software_type: str, enabled: bool, alias: Optional[str], db_session: Session) -> Dict[str, Any]:
        """
        Creates or removes the 'installed' SoftwareBuild representing the host system binary.
        """
        from database.models import SoftwareBuild, Service

        meta = SUPPORTED_ENGINES.get(software_type)
        if not meta:
            raise ValueError(f"Unknown software engine '{software_type}'")

        sys_audit = self.audit_system_binary(software_type)
        if enabled and not sys_audit.get("found"):
            raise FileNotFoundError(f"Binary '{meta['default_binary']}' was not found in host system $PATH.")

        # Find existing installed build
        existing = db_session.query(SoftwareBuild).filter(
            SoftwareBuild.software_type == software_type,
            SoftwareBuild.source_type == "installed"
        ).first()

        if enabled:
            default_name = alias.strip() if alias and alias.strip() else f"System {meta['name']} ($PATH)"
            v_tag = sys_audit.get("version") or "system"
            b_path = sys_audit.get("path")
            
            if existing:
                existing.name = default_name
                existing.version_tag = v_tag
                existing.binary_path = b_path
                existing.system_path = b_path
                existing.status = "ready"
                existing.is_managed = False
            else:
                new_build = SoftwareBuild(
                    name=default_name,
                    software_type=software_type,
                    source_type="installed",
                    version_tag=v_tag,
                    binary_path=b_path,
                    system_path=b_path,
                    is_managed=False,
                    build_options={},
                    install_path=b_path,
                    status="ready",
                    is_default=False
                )
                db_session.add(new_build)
            
            self.config[f"{software_type}_installed_enabled"] = True
            db_session.commit()
            return {"success": True, "action": "registered", "software_type": software_type}
        else:
            if existing:
                # Check for dependent services
                all_services = db_session.query(Service).all()
                active_deps = []
                for svc in all_services:
                    cfg = svc.config or {}
                    if (cfg.get("ffmpeg_build_id") == existing.id or cfg.get("build_id") == existing.id) and svc.status == "running":
                        active_deps.append(f"{svc.name} (ID: {svc.id})")
                
                if active_deps:
                    raise RuntimeError(f"Cannot unregister system binary: active running services depend on it: {', '.join(active_deps)}")

                db_session.delete(existing)
                db_session.commit()

            self.config[f"{software_type}_installed_enabled"] = False
            return {"success": True, "action": "unregistered", "software_type": software_type}

    def get_mediamtx_releases(self) -> List[Dict[str, str]]:
        """
        Scrapes available release versions for MediaMTX from GitHub.
        """
        import time
        now = time.time()
        if self._cached_releases.get("mediamtx") and (now - self._cached_releases_time.get("mediamtx", 0) < 300):
            return self._cached_releases["mediamtx"]

        releases = []
        try:
            req = urllib.request.Request(
                "https://api.github.com/repos/bluenviron/mediamtx/releases?per_page=20",
                headers={"User-Agent": "ffmpeg-gui-orchestrator"}
            )
            with urllib.request.urlopen(req, timeout=5) as response:
                if response.status == 200:
                    data = json.loads(response.read().decode("utf-8"))
                    for r in data:
                        tag = r.get("tag_name", "").lstrip("v")
                        if tag:
                            releases.append({
                                "tag": tag,
                                "name": r.get("name") or f"MediaMTX v{tag}",
                                "published_at": r.get("published_at", "")
                            })
        except Exception as e:
            logger.warning(f"Error fetching MediaMTX releases from GitHub API: {e}")
            # Fallback list of known stable releases
            releases = [
                {"tag": "1.9.3", "name": "MediaMTX v1.9.3", "published_at": "2024-10-01"},
                {"tag": "1.9.2", "name": "MediaMTX v1.9.2", "published_at": "2024-09-15"},
                {"tag": "1.9.0", "name": "MediaMTX v1.9.0", "published_at": "2024-08-01"},
                {"tag": "1.8.4", "name": "MediaMTX v1.8.4", "published_at": "2024-06-01"},
            ]

        self._cached_releases["mediamtx"] = releases
        self._cached_releases_time["mediamtx"] = now
        return releases

    def provision_mediamtx_release(self, version_tag: str, db_session: Session, builds_storage_dir: str) -> Dict[str, Any]:
        """
        Downloads, extracts, validates, and registers a standalone MediaMTX precompiled binary.
        """
        from database.models import SoftwareBuild, Storage

        clean_ver = version_tag.lstrip("v").strip()
        arch = platform.machine().lower()
        if arch in ("x86_64", "amd64"):
            tar_arch = "linux_amd64"
        elif arch in ("aarch64", "arm64", "armv8"):
            tar_arch = "linux_arm64v8"
        elif "arm" in arch:
            tar_arch = "linux_armv7"
        else:
            tar_arch = "linux_amd64"

        tar_filename = f"mediamtx_v{clean_ver}_{tar_arch}.tar.gz"
        download_url = f"https://github.com/bluenviron/mediamtx/releases/download/v{clean_ver}/{tar_filename}"

        # Resolve storage directory
        dest_dir = os.path.join(builds_storage_dir, "mediamtx", f"v{clean_ver}")
        bin_dest_dir = os.path.join(dest_dir, "bin")
        os.makedirs(bin_dest_dir, exist_ok=True)
        
        tar_path = os.path.join(dest_dir, tar_filename)
        bin_path = os.path.join(bin_dest_dir, "mediamtx")

        try:
            # Download tarball
            logger.info(f"Downloading MediaMTX v{clean_ver} from {download_url}...")
            urllib.request.urlretrieve(download_url, tar_path)

            # Extract tarball
            with tarfile.open(tar_path, "r:gz") as tar:
                tar.extractall(path=bin_dest_dir)

            # Clean tarball
            if os.path.exists(tar_path):
                os.remove(tar_path)

            if not os.path.exists(bin_path):
                raise FileNotFoundError(f"Binary 'mediamtx' was not found in extracted files at {bin_dest_dir}")

            os.chmod(bin_path, 0o755)

            # Validate execution
            v_res = subprocess.run([bin_path, "--version"], capture_output=True, text=True, timeout=3)
            ver_out = (v_res.stdout or "") + (v_res.stderr or "")

            # Calculate disk size
            total_size_mb = 0.0
            for dirpath, _, filenames in os.walk(dest_dir):
                for f in filenames:
                    fp = os.path.join(dirpath, f)
                    if os.path.isfile(fp):
                        total_size_mb += os.path.getsize(fp) / (1024 * 1024)

            # Check if default build storage exists
            default_storage = db_session.query(Storage).filter(Storage.type.in_(["build", "builds"])).first()
            storage_id = default_storage.id if default_storage else None

            # Register in software_builds
            existing = db_session.query(SoftwareBuild).filter(
                SoftwareBuild.software_type == "mediamtx",
                SoftwareBuild.version_tag == clean_ver
            ).first()

            build_name = f"MediaMTX v{clean_ver} (Official)"
            if existing:
                existing.name = build_name
                existing.binary_path = bin_path
                existing.install_path = dest_dir
                existing.status = "ready"
                existing.source_type = "precompiled"
                existing.is_managed = True
                existing.disk_usage_mb = round(total_size_mb, 2)
                existing.version_output = ver_out
            else:
                new_build = SoftwareBuild(
                    name=build_name,
                    software_type="mediamtx",
                    source_type="precompiled",
                    version_tag=clean_ver,
                    binary_path=bin_path,
                    install_path=dest_dir,
                    build_options={"download_url": download_url, "arch": tar_arch},
                    is_managed=True,
                    status="ready",
                    is_default=False,
                    disk_usage_mb=round(total_size_mb, 2),
                    version_output=ver_out,
                    storage_id=storage_id
                )
                db_session.add(new_build)

            db_session.commit()
            return {
                "success": True,
                "version": clean_ver,
                "binary_path": bin_path,
                "disk_usage_mb": round(total_size_mb, 2)
            }
        except Exception as e:
            logger.error(f"Failed to provision MediaMTX v{clean_ver}: {e}")
            if os.path.exists(dest_dir):
                shutil.rmtree(dest_dir, ignore_errors=True)
            raise

    def get_chromium_releases(self) -> List[Dict[str, str]]:
        """
        Fetches official stable and release channel versions for Chromium
        from Google's Chrome for Testing API.
        """
        import time
        now = time.time()
        if self._cached_releases.get("chromium") and (now - self._cached_releases_time.get("chromium", 0) < 300):
            return self._cached_releases["chromium"]

        releases = []
        try:
            req = urllib.request.Request(
                "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json",
                headers={"User-Agent": "ffmpeg-gui-orchestrator"}
            )
            with urllib.request.urlopen(req, timeout=5) as response:
                if response.status == 200:
                    data = json.loads(response.read().decode("utf-8"))
                    channels = data.get("channels", {})
                    for ch_name, ch_data in channels.items():
                        ver = ch_data.get("version")
                        if ver:
                            downloads = ch_data.get("downloads", {}).get("chrome", [])
                            has_linux = any("linux" in d.get("platform", "") for d in downloads)
                            if has_linux:
                                releases.append({
                                    "tag": ver,
                                    "name": f"Chromium {ch_name} (v{ver})",
                                    "published_at": ch_data.get("revision", "")
                                })
        except Exception as e:
            logger.warning(f"Error fetching Chromium releases from Chrome for Testing API: {e}")
            releases = [
                {"tag": "130.0.6723.69", "name": "Chromium Stable (v130.0.6723.69)", "published_at": "130"},
                {"tag": "129.0.6668.100", "name": "Chromium Previous Stable (v129.0.6668.100)", "published_at": "129"},
            ]

        self._cached_releases["chromium"] = releases
        self._cached_releases_time["chromium"] = now
        return releases

    def provision_chromium_release(self, version_tag: str, db_session: Session, builds_storage_dir: str) -> Dict[str, Any]:
        """
        Downloads, extracts, validates, and registers a standalone Chromium (Chrome for Testing) precompiled binary.
        """
        from database.models import SoftwareBuild, Storage

        clean_ver = version_tag.lstrip("v").strip()
        arch = platform.machine().lower()
        if arch in ("aarch64", "arm64", "armv8"):
            cf_platform = "linux-arm64"
            zip_arch = "linux-arm64"
        else:
            cf_platform = "linux64"
            zip_arch = "linux64"

        download_url = f"https://storage.googleapis.com/chrome-for-testing-public/{clean_ver}/{cf_platform}/chrome-{zip_arch}.zip"

        dest_dir = os.path.join(builds_storage_dir, "chromium", f"v{clean_ver}")
        bin_dest_dir = os.path.join(dest_dir, "bin")
        os.makedirs(bin_dest_dir, exist_ok=True)

        zip_path = os.path.join(dest_dir, f"chrome-{zip_arch}.zip")

        try:
            logger.info(f"Downloading Chromium v{clean_ver} from {download_url}...")
            urllib.request.urlretrieve(download_url, zip_path)

            with zipfile.ZipFile(zip_path, "r") as zf:
                zf.extractall(path=bin_dest_dir)

            if os.path.exists(zip_path):
                os.remove(zip_path)

            bin_path = None
            for root, _, files in os.walk(bin_dest_dir):
                for f in files:
                    fp = os.path.join(root, f)
                    if f == "chrome":
                        bin_path = fp
                    # Grant execute permissions to binaries and helper executables
                    if not f.endswith(('.pak', '.bin', '.dat', '.json', '.png', '.html', '.txt')):
                        try:
                            os.chmod(fp, 0o755)
                        except Exception:
                            pass

            if not bin_path or not os.path.exists(bin_path):
                raise FileNotFoundError(f"Binary 'chrome' was not found in extracted files at {bin_dest_dir}")

            try:
                os.chmod(bin_path, 0o755)
            except Exception:
                pass

            v_res = subprocess.run([bin_path, "--version"], capture_output=True, text=True, timeout=3)
            ver_out = (v_res.stdout or "") + (v_res.stderr or "")

            total_size_mb = 0.0
            for dirpath, _, filenames in os.walk(dest_dir):
                for f in filenames:
                    fp = os.path.join(dirpath, f)
                    if os.path.isfile(fp):
                        total_size_mb += os.path.getsize(fp) / (1024 * 1024)

            default_storage = db_session.query(Storage).filter(Storage.type.in_(["build", "builds"])).first()
            storage_id = default_storage.id if default_storage else None

            existing = db_session.query(SoftwareBuild).filter(
                SoftwareBuild.software_type == "chromium",
                SoftwareBuild.version_tag == clean_ver
            ).first()

            build_name = f"Chromium v{clean_ver} (Official)"
            if existing:
                existing.name = build_name
                existing.binary_path = bin_path
                existing.install_path = dest_dir
                existing.status = "ready"
                existing.source_type = "precompiled"
                existing.is_managed = True
                existing.disk_usage_mb = round(total_size_mb, 2)
                existing.version_output = ver_out
            else:
                new_build = SoftwareBuild(
                    name=build_name,
                    software_type="chromium",
                    source_type="precompiled",
                    version_tag=clean_ver,
                    binary_path=bin_path,
                    install_path=dest_dir,
                    build_options={"download_url": download_url, "platform": cf_platform},
                    is_managed=True,
                    status="ready",
                    is_default=False,
                    disk_usage_mb=round(total_size_mb, 2),
                    version_output=ver_out,
                    storage_id=storage_id
                )
                db_session.add(new_build)

            db_session.commit()
            return {
                "success": True,
                "version": clean_ver,
                "binary_path": bin_path,
                "disk_usage_mb": round(total_size_mb, 2)
            }
        except Exception as e:
            logger.error(f"Failed to provision Chromium v{clean_ver}: {e}")
            if os.path.exists(dest_dir):
                shutil.rmtree(dest_dir, ignore_errors=True)
            raise

    def get_firefox_releases(self) -> List[Dict[str, str]]:
        """
        Fetches official stable and ESR release versions for Mozilla Firefox.
        """
        import time
        now = time.time()
        if self._cached_releases.get("firefox") and (now - self._cached_releases_time.get("firefox", 0) < 300):
            return self._cached_releases["firefox"]

        releases = []
        try:
            req = urllib.request.Request(
                "https://product-details.mozilla.org/1.0/firefox_versions.json",
                headers={"User-Agent": "ffmpeg-gui-orchestrator"}
            )
            with urllib.request.urlopen(req, timeout=5) as response:
                if response.status == 200:
                    data = json.loads(response.read().decode("utf-8"))
                    stable_ver = data.get("LATEST_FIREFOX_VERSION")
                    esr_ver = data.get("FIREFOX_ESR")
                    if stable_ver:
                        releases.append({
                            "tag": stable_ver,
                            "name": f"Firefox Stable (v{stable_ver})",
                            "published_at": data.get("LAST_RELEASE_DATE", "")
                        })
                    if esr_ver and esr_ver != stable_ver:
                        releases.append({
                            "tag": esr_ver,
                            "name": f"Firefox ESR (v{esr_ver})",
                            "published_at": data.get("LAST_RELEASE_DATE", "")
                        })
        except Exception as e:
            logger.warning(f"Error fetching Firefox releases from Mozilla API: {e}")
            releases = [
                {"tag": "132.0", "name": "Firefox Stable (v132.0)", "published_at": "2024-10-29"},
                {"tag": "128.4.0esr", "name": "Firefox ESR (v128.4.0esr)", "published_at": "2024-10-29"},
            ]

        self._cached_releases["firefox"] = releases
        self._cached_releases_time["firefox"] = now
        return releases

    def provision_firefox_release(self, version_tag: str, db_session: Session, builds_storage_dir: str) -> Dict[str, Any]:
        """
        Downloads, extracts, validates, and registers a standalone Mozilla Firefox precompiled binary.
        """
        from database.models import SoftwareBuild, Storage

        clean_ver = version_tag.lstrip("v").strip()
        arch = platform.machine().lower()
        if arch in ("aarch64", "arm64", "armv8"):
            ff_arch = "linux-aarch64"
        else:
            ff_arch = "linux-x86_64"

        dest_dir = os.path.join(builds_storage_dir, "firefox", f"v{clean_ver}")
        bin_dest_dir = os.path.join(dest_dir, "bin")
        os.makedirs(bin_dest_dir, exist_ok=True)

        download_candidates = [
            f"https://archive.mozilla.org/pub/firefox/releases/{clean_ver}/{ff_arch}/en-US/firefox-{clean_ver}.tar.xz",
            f"https://archive.mozilla.org/pub/firefox/releases/{clean_ver}/{ff_arch}/en-US/firefox-{clean_ver}.tar.bz2",
        ]

        tar_path = None
        last_error = None
        try:
            for download_url in download_candidates:
                ext = "tar.xz" if download_url.endswith(".tar.xz") else "tar.bz2"
                candidate_path = os.path.join(dest_dir, f"firefox-{clean_ver}.{ext}")
                try:
                    logger.info(f"Downloading Firefox v{clean_ver} from {download_url}...")
                    urllib.request.urlretrieve(download_url, candidate_path)
                    tar_path = candidate_path
                    break
                except urllib.error.HTTPError as he:
                    last_error = he
                    if os.path.exists(candidate_path):
                        os.remove(candidate_path)
                    if he.code == 404:
                        continue
                    raise
                except Exception as e:
                    last_error = e
                    if os.path.exists(candidate_path):
                        os.remove(candidate_path)
                    raise

            if not tar_path:
                raise last_error or RuntimeError(f"Could not download Firefox v{clean_ver} from official releases")

            with tarfile.open(tar_path, "r:*") as tar:
                tar.extractall(path=bin_dest_dir)

            if os.path.exists(tar_path):
                os.remove(tar_path)

            bin_path = None
            for root, _, files in os.walk(bin_dest_dir):
                for f in files:
                    fp = os.path.join(root, f)
                    if f == "firefox":
                        bin_path = fp
                    if not f.endswith(('.xpi', '.so', '.bin', '.dat', '.json', '.png', '.html', '.txt')):
                        try:
                            os.chmod(fp, 0o755)
                        except Exception:
                            pass

            if not bin_path or not os.path.exists(bin_path):
                raise FileNotFoundError(f"Binary 'firefox' was not found in extracted files at {bin_dest_dir}")

            try:
                os.chmod(bin_path, 0o755)
            except Exception:
                pass

            v_res = subprocess.run([bin_path, "--version"], capture_output=True, text=True, timeout=3)
            ver_out = (v_res.stdout or "") + (v_res.stderr or "")

            total_size_mb = 0.0
            for dirpath, _, filenames in os.walk(dest_dir):
                for f in filenames:
                    fp = os.path.join(dirpath, f)
                    if os.path.isfile(fp):
                        total_size_mb += os.path.getsize(fp) / (1024 * 1024)

            default_storage = db_session.query(Storage).filter(Storage.type.in_(["build", "builds"])).first()
            storage_id = default_storage.id if default_storage else None

            existing = db_session.query(SoftwareBuild).filter(
                SoftwareBuild.software_type == "firefox",
                SoftwareBuild.version_tag == clean_ver
            ).first()

            build_name = f"Firefox v{clean_ver} (Official)"
            if existing:
                existing.name = build_name
                existing.binary_path = bin_path
                existing.install_path = dest_dir
                existing.status = "ready"
                existing.source_type = "precompiled"
                existing.is_managed = True
                existing.disk_usage_mb = round(total_size_mb, 2)
                existing.version_output = ver_out
            else:
                new_build = SoftwareBuild(
                    name=build_name,
                    software_type="firefox",
                    source_type="precompiled",
                    version_tag=clean_ver,
                    binary_path=bin_path,
                    install_path=dest_dir,
                    build_options={"download_url": download_url, "arch": ff_arch},
                    is_managed=True,
                    status="ready",
                    is_default=False,
                    disk_usage_mb=round(total_size_mb, 2),
                    version_output=ver_out,
                    storage_id=storage_id
                )
                db_session.add(new_build)

            db_session.commit()
            return {
                "success": True,
                "version": clean_ver,
                "binary_path": bin_path,
                "disk_usage_mb": round(total_size_mb, 2)
            }
        except Exception as e:
            logger.error(f"Failed to provision Firefox v{clean_ver}: {e}")
            if os.path.exists(dest_dir):
                shutil.rmtree(dest_dir, ignore_errors=True)
            raise

    def get_engine_releases(self, software_type: str) -> List[Dict[str, str]]:
        """Generic dispatcher for fetching precompiled releases for any supported engine."""
        if software_type == "mediamtx":
            return self.get_mediamtx_releases()
        elif software_type == "chromium":
            return self.get_chromium_releases()
        elif software_type == "firefox":
            return self.get_firefox_releases()
        return []

    def provision_engine_release(self, software_type: str, version_tag: str, db_session: Session, builds_storage_dir: str) -> Dict[str, Any]:
        """Generic dispatcher for downloading and provisioning precompiled releases."""
        if software_type == "mediamtx":
            return self.provision_mediamtx_release(version_tag, db_session, builds_storage_dir)
        elif software_type == "chromium":
            return self.provision_chromium_release(version_tag, db_session, builds_storage_dir)
        elif software_type == "firefox":
            return self.provision_firefox_release(version_tag, db_session, builds_storage_dir)
        raise ValueError(f"Precompiled provisioning is not supported for engine '{software_type}'")

    def save_engine_icon(self, software_type: str, image_bytes: bytes, filename: str, storage_base_dir: str) -> str:
        """Saves a custom branding icon for the given software type."""
        icons_dir = os.path.join(storage_base_dir, "branding", "engines")
        os.makedirs(icons_dir, exist_ok=True)
        ext = os.path.splitext(filename)[1].lower() or ".png"
        if ext not in (".png", ".svg", ".jpg", ".jpeg", ".webp"):
            ext = ".png"
        icon_path = os.path.join(icons_dir, f"{software_type}{ext}")
        with open(icon_path, "wb") as f:
            f.write(image_bytes)
        return icon_path

    def get_engine_icon_path(self, software_type: str, storage_base_dir: str) -> Optional[str]:
        """Returns the filesystem path of a custom icon if it exists."""
        icons_dir = os.path.join(storage_base_dir, "branding", "engines")
        for ext in (".png", ".svg", ".webp", ".jpg", ".jpeg"):
            p = os.path.join(icons_dir, f"{software_type}{ext}")
            if os.path.isfile(p):
                return p
        return None

    def delete_engine_icon(self, software_type: str, storage_base_dir: str) -> bool:
        """Deletes custom branding icon for the given software type."""
        icons_dir = os.path.join(storage_base_dir, "branding", "engines")
        deleted = False
        for ext in (".png", ".svg", ".webp", ".jpg", ".jpeg"):
            p = os.path.join(icons_dir, f"{software_type}{ext}")
            if os.path.isfile(p):
                try:
                    os.remove(p)
                    deleted = True
                except Exception as e:
                    logger.warning(f"Failed to remove icon {p}: {e}")
        return deleted


software_manager = SoftwareManager()
