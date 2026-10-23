import os
import sys
import json
import uuid
import time
import socket
import logging
import threading
from typing import Optional, Dict, Any

logger = logging.getLogger("DiscoveryBeacon")


def get_node_id() -> str:
    """
    Retrieve or derive an immutable unique machine/node identifier.
    Prioritizes Linux /etc/machine-id, falling back to dbus machine-id or persistent file.
    """
    for mid_path in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
        if os.path.exists(mid_path):
            try:
                with open(mid_path, "r", encoding="utf-8") as f:
                    raw = f.read().strip()
                    if raw and len(raw) == 32:
                        return str(uuid.UUID(raw))
                    elif raw:
                        return str(uuid.uuid5(uuid.NAMESPACE_DNS, raw))
            except Exception:
                pass

    # Persistent instance fallback in data/node_id
    fallback_dir = os.path.abspath("data")
    fallback_file = os.path.join(fallback_dir, "node_id")
    if os.path.exists(fallback_file):
        try:
            with open(fallback_file, "r", encoding="utf-8") as f:
                content = f.read().strip()
                if content:
                    return content
        except Exception:
            pass

    # Generate and persist fallback ID
    new_id = str(uuid.uuid4())
    try:
        os.makedirs(fallback_dir, exist_ok=True)
        with open(fallback_file, "w", encoding="utf-8") as f:
            f.write(new_id + "\n")
    except Exception:
        pass
    return new_id


def get_primary_ip() -> str:
    """
    Resolve the primary routable IPv4 address.
    Tries UDP routing first; falls back to active non-loopback network interfaces
    for isolated/offline broadcast production LANs.
    """
    # 1. External routing trick (does not send real packets, resolves default route)
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            if ip and not ip.startswith("127."):
                return ip
        finally:
            s.close()
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


def get_network_info() -> Dict[str, Any]:
    """
    Read active GUI HTTP / HTTPS ports and SSL configuration.
    """
    info = {
        "http_port": int(os.environ.get("ACTIVE_PORT", os.environ.get("HTTP_PORT", 8000))),
        "https_port": int(os.environ.get("HTTPS_PORT", 8443)),
        "ssl_enabled": os.environ.get("SSL_ENABLED", "false").lower() in ("true", "1", "yes")
    }

    config_path = os.environ.get("CONFIG_FILE_PATH")
    if not config_path:
        for candidate in ["ffmpeg-gui.conf", "/etc/ffmpeg-gui/ffmpeg-gui.conf", os.path.expanduser("~/.config/ffmpeg-gui/ffmpeg-gui.conf")]:
            if os.path.exists(candidate):
                config_path = candidate
                break

    if config_path and os.path.exists(config_path):
        try:
            import configparser
            cp = configparser.ConfigParser()
            cp.read(config_path)
            if "server" in cp:
                info["http_port"] = cp["server"].getint("port", fallback=info["http_port"])
            if "network" in cp:
                net = cp["network"]
                info["http_port"] = net.getint("http_port", fallback=net.getint("gui_port", fallback=info["http_port"]))
                info["https_port"] = net.getint("https_port", fallback=info["https_port"])
                info["ssl_enabled"] = net.getboolean("ssl_enabled", fallback=info["ssl_enabled"])
            if "ssl" in cp:
                ssl_cfg = cp["ssl"]
                if ssl_cfg.get("mode") in ("acme", "custom") and "enabled" in ssl_cfg:
                    info["ssl_enabled"] = ssl_cfg.getboolean("enabled", fallback=info["ssl_enabled"])
        except Exception:
            pass

    return info


class DiscoveryBeaconService:
    """
    UDP Broadcast Discovery Beacon Service.
    Broadcasts node identity and status across the local network so companion scanner
    utilities can discover the appliance without manual IP discovery.
    """
    def __init__(self, db_session_factory=None, port: int = 59990, interval: float = 4.0):
        self.db_session_factory = db_session_factory
        self.port = port
        self.interval = interval
        self.node_id = get_node_id()

        self._running = False
        self._stop_event = threading.Event()
        self._sock: Optional[socket.socket] = None
        self._broadcast_thread: Optional[threading.Thread] = None
        self._listener_thread: Optional[threading.Thread] = None

    def is_running(self) -> bool:
        return self._running

    def is_enabled(self) -> bool:
        """
        Verify whether discovery beacon broadcasting is enabled in database settings.
        Guarantees that a stopped or disabled beacon will never broadcast packets or answer queries.
        """
        if not self._running or self._stop_event.is_set():
            return False

        if self.db_session_factory:
            try:
                with self.db_session_factory() as session:
                    from database.models import SystemSettings
                    settings = session.query(SystemSettings).first()
                    if settings and settings.discovery_beacon_enabled is not None:
                        return bool(settings.discovery_beacon_enabled)
            except Exception:
                pass

        return True

    def build_payload(self) -> Dict[str, Any]:
        """Construct the canonical discovery beacon JSON payload."""
        ip = get_primary_ip()
        net = get_network_info()
        http_port = net["http_port"]
        https_port = net["https_port"]
        ssl_enabled = net["ssl_enabled"]

        effective_https_port = https_port if ssl_enabled else None
        if ssl_enabled and effective_https_port:
            web_url = f"https://{ip}:{effective_https_port}"
        else:
            web_url = f"http://{ip}:{http_port}"

        node_name = "FFMPEG-GUI Standalone"
        node_alias = "NODE-01"
        running_services = 0
        active_streams = 0

        if self.db_session_factory:
            try:
                with self.db_session_factory() as session:
                    from database.models import SystemSettings, Service
                    settings = session.query(SystemSettings).first()
                    if settings:
                        if settings.node_name:
                            node_name = settings.node_name
                        if settings.lcd_alias:
                            node_alias = settings.lcd_alias

                    running_services = session.query(Service).filter(Service.status == "running").count()
                    # Active streams count: services with running status that are stream providers
                    active_streams = session.query(Service).filter(
                        Service.status == "running",
                        Service.service_type.in_(["stream", "ffmpeg", "icecast", "mediamtx_hub"])
                    ).count()
            except Exception as e:
                logger.debug(f"Telemetry query error: {e}")

        try:
            from version import __version__
            ver = __version__
        except Exception:
            ver = "2.50.0"

        return {
            "app": "ffmpeg-gui",
            "protocol_version": 1,
            "node_id": self.node_id,
            "node_name": node_name,
            "node_alias": node_alias,
            "ip": ip,
            "http_port": http_port,
            "https_port": effective_https_port,
            "web_url": web_url,
            "version": ver,
            "running_services": running_services,
            "active_streams": active_streams
        }

    def start(self) -> None:
        """Start the discovery beacon UDP sender and listener daemon threads."""
        if self._running:
            return

        try:
            self._sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            if hasattr(socket, "SO_REUSEPORT"):
                try:
                    self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
                except Exception:
                    pass
            self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            self._sock.bind(('', self.port))
            self._sock.settimeout(1.0)
        except Exception as e:
            logger.error(f"Failed to bind Discovery Beacon UDP socket on port {self.port}: {e}")
            if self._sock:
                try:
                    self._sock.close()
                except Exception:
                    pass
                self._sock = None
            return

        self._running = True
        self._stop_event.clear()

        self._broadcast_thread = threading.Thread(
            target=self._broadcast_loop,
            name="DiscoveryBeacon-Broadcaster",
            daemon=True
        )
        self._listener_thread = threading.Thread(
            target=self._listener_loop,
            name="DiscoveryBeacon-Listener",
            daemon=True
        )

        self._broadcast_thread.start()
        self._listener_thread.start()
        logger.info(f"Discovery Beacon started on UDP port {self.port} (Node ID: {self.node_id})")

    def stop(self) -> None:
        """Stop the discovery beacon and cleanly release socket."""
        if not self._running:
            return

        self._running = False
        self._stop_event.set()

        if self._sock:
            try:
                self._sock.close()
            except Exception:
                pass
            self._sock = None

        if self._broadcast_thread and self._broadcast_thread.is_alive():
            self._broadcast_thread.join(timeout=2.0)
        if self._listener_thread and self._listener_thread.is_alive():
            self._listener_thread.join(timeout=2.0)

        self._broadcast_thread = None
        self._listener_thread = None
        logger.info("Discovery Beacon service stopped.")

    def send_beacon(self, target_addr: Optional[tuple] = None) -> None:
        """Send a beacon packet. If target_addr is None, broadcasts to 255.255.255.255."""
        if not self._sock or not self.is_enabled():
            return
        try:
            payload = self.build_payload()
            raw_bytes = json.dumps(payload).encode("utf-8")
            dest = target_addr or ("255.255.255.255", self.port)
            self._sock.sendto(raw_bytes, dest)
        except Exception as e:
            logger.debug(f"Failed to send discovery beacon: {e}")

    def _broadcast_loop(self) -> None:
        """Periodic passive broadcast heartbeat."""
        while not self._stop_event.is_set():
            if not self.is_enabled():
                break
            self.send_beacon()
            # Sleep in short increments for responsive shutdown
            elapsed = 0.0
            while elapsed < self.interval and not self._stop_event.is_set():
                time.sleep(0.2)
                elapsed += 0.2

    def _listener_loop(self) -> None:
        """Listen for DISCOVER_QUERY from scanners and respond immediately."""
        while not self._stop_event.is_set():
            if not self._sock or not self.is_enabled():
                break
            try:
                data, addr = self._sock.recvfrom(4096)
                if not data:
                    continue
                try:
                    msg = json.loads(data.decode("utf-8", errors="ignore"))
                    if isinstance(msg, dict) and msg.get("cmd") == "DISCOVER_QUERY":
                        if self.is_enabled():
                            logger.debug(f"Received DISCOVER_QUERY from {addr}, replying...")
                            self.send_beacon(target_addr=addr)
                except Exception:
                    pass
            except socket.timeout:
                continue
            except Exception as e:
                if self._stop_event.is_set():
                    break
                logger.debug(f"Discovery listener socket error: {e}")
                time.sleep(0.5)
