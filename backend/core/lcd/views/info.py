import os
import json
import socket
from typing import List
from .base import LCDView


def get_primary_ip() -> str:
    """
    Resolve the primary routable IPv4 address.
    Tries UDP routing first; falls back to active non-loopback network interfaces
    for isolated/offline broadcast production LANs.
    """
    # 1. External routing trick (does not send real packets, resolves default route)
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        if ip and not ip.startswith("127."):
            return ip
    except Exception:
        pass

    # 2. Offline / isolated LAN fallback: inspect active OS interfaces
    try:
        import psutil
        addrs = psutil.net_if_addrs()
        preferred_prefixes = ("eth", "en", "wl", "lan", "br", "bond")
        fallback_ip = None
        for iface, if_addrs in addrs.items():
            if iface.startswith("lo"):
                continue
            for addr in if_addrs:
                if addr.family == socket.AF_INET:
                    candidate = addr.address
                    if candidate and not candidate.startswith("127."):
                        if any(iface.startswith(p) for p in preferred_prefixes):
                            return candidate
                        if not fallback_ip:
                            fallback_ip = candidate
        if fallback_ip:
            return fallback_ip
    except Exception:
        pass

    return "127.0.0.1"


def get_network_settings() -> dict:
    """
    Read active GUI HTTP / HTTPS ports and SSL state from environment or configuration file.
    """
    settings = {
        "http_port": int(os.environ.get("ACTIVE_PORT", os.environ.get("HTTP_PORT", 8000))),
        "https_port": int(os.environ.get("HTTPS_PORT", 8443)),
        "ssl_enabled": os.environ.get("SSL_ENABLED", "false").lower() in ("true", "1", "yes")
    }

    config_path = os.environ.get("CONFIG_FILE_PATH")
    if not config_path:
        for candidate in ["ffmpeg-gui.ini", "/etc/ffmpeg-gui/ffmpeg-gui.ini", os.path.expanduser("~/.config/ffmpeg-gui/ffmpeg-gui.ini")]:
            if os.path.exists(candidate):
                config_path = candidate
                break

    if config_path and os.path.exists(config_path):
        try:
            import configparser
            cp = configparser.ConfigParser()
            cp.read(config_path)
            if "server" in cp:
                settings["http_port"] = cp["server"].getint("port", fallback=settings["http_port"])
            if "network" in cp:
                net = cp["network"]
                settings["http_port"] = net.getint("http_port", fallback=net.getint("gui_port", fallback=settings["http_port"]))
                settings["https_port"] = net.getint("https_port", fallback=settings["https_port"])
                settings["ssl_enabled"] = net.getboolean("ssl_enabled", fallback=settings["ssl_enabled"])
            if "ssl" in cp:
                ssl_cfg = cp["ssl"]
                if ssl_cfg.get("mode") in ("acme", "custom") and "enabled" in ssl_cfg:
                    settings["ssl_enabled"] = ssl_cfg.getboolean("enabled", fallback=settings["ssl_enabled"])
        except Exception:
            pass

    return settings


def get_versions() -> dict:
    """
    Retrieve component versions from their respective Single Sources of Truth (SSOT).
    """
    try:
        from version import __version__ as be_ver
    except Exception:
        be_ver = "unknown"

    try:
        from database.version import __schema_version__ as sc_ver
    except Exception:
        sc_ver = "unknown"

    fe_ver = be_ver
    candidate_paths = [
        os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../frontend/package.json")),
        os.path.abspath("frontend/package.json"),
        os.path.abspath("/usr/local/src/ffmpeg-gui/frontend/package.json")
    ]
    for p in candidate_paths:
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    pkg = json.load(f)
                    if "version" in pkg:
                        fe_ver = str(pkg["version"])
                        break
            except Exception:
                pass

    return {
        "backend": be_ver,
        "frontend": fe_ver,
        "schema": sc_ver
    }


class NetInfoView(LCDView):
    """
    LCD View displaying network connection details (IP address, HTTP and HTTPS ports)
    so operators can easily point their web browser to the GUI.
    """
    def __init__(self, manager):
        super().__init__(manager)
        self.current_page = 0
        self.total_pages = 2

    def _get_node_name(self) -> str:
        node_name = "Node"
        if self.manager and getattr(self.manager, "db_session_factory", None):
            db = self.manager.db_session_factory()
            try:
                from database.models import SystemSettings
                settings = db.query(SystemSettings).first()
                if settings and isinstance(getattr(settings, "lcd_alias", None), str) and settings.lcd_alias:
                    node_name = settings.lcd_alias
                elif settings and isinstance(getattr(settings, "node_name", None), str) and settings.node_name:
                    node_name = settings.node_name
            except Exception:
                pass
            finally:
                db.close()
        return node_name

    def render(self) -> List[str]:
        ip_addr = get_primary_ip()
        net = get_network_settings()
        http_port = net["http_port"]
        https_port = net["https_port"]
        ssl_enabled = net["ssl_enabled"]
        https_display = str(https_port) if ssl_enabled else "-----"

        rows = self.manager.driver.rows if (self.manager and getattr(self.manager, "driver", None)) else 4

        if rows == 2:
            if self.current_page == 0:
                # 2-line: Full IP address on line 0, compact ports on line 1
                return [
                    f"{ip_addr}",
                    f"H:{http_port:<5} S:{https_display}"
                ]
            else:
                node_name = self._get_node_name()
                return [
                    f"NODE: {node_name[:14]}",
                    "Press X: Return"
                ]
        else:
            # 4-line: Dedicated ADDRESS header, full IP line, HTTP/HTTPS headers, aligned ports
            return [
                "ADDRESS:",
                f"{ip_addr}",
                "HTTP:    HTTPS:",
                f"{http_port:<9}{https_display}"
            ]

    def handle_key(self, key: str) -> None:
        rows = self.manager.driver.rows if (self.manager and getattr(self.manager, "driver", None)) else 4
        if key == "X":
            from .menu import MainMenuView
            main_menu = MainMenuView(self.manager)
            main_menu.selected_index = 4  # Option "5. Net Info"
            self.manager.switch_to_view(main_menu)
        elif key in ("DOWN", "RIGHT"):
            if rows == 2:
                self.current_page = (self.current_page + 1) % self.total_pages
        elif key in ("UP", "LEFT"):
            if rows == 2:
                self.current_page = (self.current_page - 1) % self.total_pages


class VersionInfoView(LCDView):
    """
    LCD View displaying live software versions (Backend, Frontend, Database Schema).
    """
    def __init__(self, manager):
        super().__init__(manager)
        self.current_page = 0
        self.total_pages = 2

    def render(self) -> List[str]:
        versions = get_versions()
        be_ver = versions["backend"]
        fe_ver = versions["frontend"]
        sc_ver = versions["schema"]

        rows = self.manager.driver.rows if (self.manager and getattr(self.manager, "driver", None)) else 4
        cols = self.manager.driver.cols if (self.manager and getattr(self.manager, "driver", None)) else 20

        if rows == 2:
            if cols >= 20 and self.current_page == 0:
                # 20-col display fits FE and compact BE/SC
                return [
                    f"FE: v{fe_ver}",
                    f"BE/SC: {be_ver}/{sc_ver}"
                ]
            else:
                if self.current_page == 0:
                    return [
                        f"FE: v{fe_ver}",
                        f"BE: v{be_ver}"
                    ]
                else:
                    return [
                        f"SC: v{sc_ver}",
                        "Press X: Return"
                    ]
        else:
            # 4-line layout
            return [
                "SYSTEM VERSIONS",
                f"BE: v{be_ver}",
                f"FE: v{fe_ver}",
                f"SC: v{sc_ver}"
            ]

    def handle_key(self, key: str) -> None:
        rows = self.manager.driver.rows if (self.manager and getattr(self.manager, "driver", None)) else 4
        if key == "X":
            from .menu import MainMenuView
            main_menu = MainMenuView(self.manager)
            main_menu.selected_index = 5  # Option "6. Versions"
            self.manager.switch_to_view(main_menu)
        elif key in ("DOWN", "RIGHT"):
            if rows == 2:
                self.current_page = (self.current_page + 1) % self.total_pages
        elif key in ("UP", "LEFT"):
            if rows == 2:
                self.current_page = (self.current_page - 1) % self.total_pages


# Backward compatibility alias
SystemInfoView = NetInfoView
