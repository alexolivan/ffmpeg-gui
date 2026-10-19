import logging
import os
import re
import shutil
import socket
import struct
import subprocess
from typing import Any, Dict, List, Optional, Tuple
import psutil

logger = logging.getLogger("ffmpeg_gui.network_inspector")


def _get_default_gateway_interface() -> Optional[str]:
    """Inspect Linux /proc/net/route to find the network interface with default gateway (0.0.0.0 destination)."""
    try:
        route_path = "/proc/net/route"
        if os.path.exists(route_path):
            with open(route_path, "r") as f:
                lines = f.readlines()
            for line in lines[1:]:
                fields = line.strip().split()
                if len(fields) >= 4:
                    iface = fields[0]
                    dest = fields[1]
                    flags = int(fields[3], 16)
                    # Destination 00000000 and RTF_UP (0x1) + RTF_GATEWAY (0x2)
                    if dest == "00000000" and (flags & 0x2):
                        return iface
    except Exception as e:
        logger.debug("Could not inspect /proc/net/route: %s", e)
    return None


def get_network_interfaces() -> List[Dict[str, Any]]:
    """
    Enumerate all network interfaces on the host with status, addresses, and capabilities.
    """
    interfaces = []
    try:
        addrs = psutil.net_if_addrs()
        stats = psutil.net_if_stats()
        default_gw_iface = _get_default_gateway_interface()

        af_packet = getattr(psutil, 'AF_LINK', None)
        if af_packet is None and hasattr(socket, 'AF_PACKET'):
            af_packet = socket.AF_PACKET

        for iface_name, iface_addrs in addrs.items():
            iface_stat = stats.get(iface_name)
            is_up = iface_stat.isup if iface_stat else False
            speed = iface_stat.speed if iface_stat else 0

            ipv4_list = []
            ipv6_list = []
            mac = None
            is_loopback = (iface_name == "lo")

            for addr in iface_addrs:
                if addr.family == socket.AF_INET:
                    ipv4_list.append({
                        "address": addr.address,
                        "netmask": addr.netmask,
                        "broadcast": addr.broadcast
                    })
                    if addr.address.startswith("127."):
                        is_loopback = True
                elif addr.family == socket.AF_INET6:
                    # Strip %scope_id if present
                    clean_ipv6 = addr.address.split("%")[0]
                    ipv6_list.append({
                        "address": clean_ipv6,
                        "netmask": addr.netmask
                    })
                elif af_packet is not None and addr.family == af_packet:
                    mac = addr.address

            interfaces.append({
                "name": iface_name,
                "is_up": is_up,
                "speed": speed,
                "mac": mac,
                "ipv4_addresses": ipv4_list,
                "ipv6_addresses": ipv6_list,
                "is_loopback": is_loopback,
                "is_default_gateway": (iface_name == default_gw_iface)
            })

        # Sort: default gateway first, then up interfaces, then loopback, then down
        interfaces.sort(
            key=lambda x: (
                not x["is_default_gateway"],
                x["is_loopback"],
                not x["is_up"],
                x["name"]
            )
        )
    except Exception as e:
        logger.error("Error inspecting network interfaces: %s", e)

    return interfaces


def resolve_bind_address(configured_host: str, fallback_host: str = "0.0.0.0") -> Tuple[str, bool, Optional[str]]:
    """
    Validate and resolve a configured bind host (IP or interface name) against active host interfaces.
    Returns: (effective_host, fell_back: bool, reason: Optional[str])
    """
    clean_host = (configured_host or "").strip()

    # Universal wildcard and localhost bindings are always safe and valid
    if clean_host in ("", "0.0.0.0", "::", "127.0.0.1", "localhost"):
        return (clean_host or fallback_host, False, None)

    try:
        addrs = psutil.net_if_addrs()
        stats = psutil.net_if_stats()
    except Exception as e:
        logger.warning("Could not query network interfaces via psutil: %s. Preserving configured host.", e)
        return (clean_host, False, None)

    # Case 1: Configured host is specified by Interface Name (e.g. 'eth0', 'eno1', 'wlan0')
    if clean_host in addrs:
        iface_stat = stats.get(clean_host)
        if iface_stat and not iface_stat.isup:
            return (
                fallback_host,
                True,
                f"Configured interface '{clean_host}' is DOWN. Falling back to '{fallback_host}' to prevent administrative lockout."
            )

        ipv4_addrs = [a.address for a in addrs[clean_host] if a.family == socket.AF_INET]
        if ipv4_addrs:
            return (ipv4_addrs[0], False, None)
        else:
            return (
                fallback_host,
                True,
                f"Configured interface '{clean_host}' has no active IPv4 address assigned. Falling back to '{fallback_host}' to prevent administrative lockout."
            )

    # Case 2: Configured host is an IP address (e.g. '192.168.1.50')
    found_on_iface = None
    iface_is_up = False

    for iface_name, iface_addrs in addrs.items():
        for addr in iface_addrs:
            if addr.family == socket.AF_INET and addr.address == clean_host:
                found_on_iface = iface_name
                stat = stats.get(iface_name)
                iface_is_up = stat.isup if stat else True
                break
        if found_on_iface:
            break

    if found_on_iface:
        if not iface_is_up:
            return (
                fallback_host,
                True,
                f"Interface '{found_on_iface}' with IP '{clean_host}' is DOWN. Falling back to '{fallback_host}' to prevent administrative lockout."
            )
        return (clean_host, False, None)

    # If the IP is not bound to any interface on this host (DHCP renewal, network card change, config import)
    return (
        fallback_host,
        True,
        f"Configured IP '{clean_host}' is not assigned to any active interface (DHCP renewal or hardware change). Falling back to '{fallback_host}' to prevent admin lockout."
    )


def _get_open_sockets() -> set:
    """Returns a set of (proto, port) tuples currently in LISTEN or bound state."""
    open_sockets = set()
    try:
        # Check TCP listeners
        for conn in psutil.net_connections(kind='tcp'):
            if getattr(conn, 'status', None) == psutil.CONN_LISTEN and conn.laddr:
                open_sockets.add(('tcp', conn.laddr.port))
        # Check UDP sockets
        for conn in psutil.net_connections(kind='udp'):
            if conn.laddr:
                open_sockets.add(('udp', conn.laddr.port))
    except Exception as e:
        logger.debug("psutil.net_connections inspection notice: %s", e)
    return open_sockets


def get_active_port_matrix(db_session, settings: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """
    Enumerate all configured and actively bound listening ports across core GUI and auxiliary services.
    """
    open_sockets = _get_open_sockets()
    matrix = []

    # 1. Core GUI Ports
    core_settings = settings or {}
    bind_addr = core_settings.get("bind_address") or "0.0.0.0"
    gui_port = int(core_settings.get("gui_port") or core_settings.get("http_port") or 8000)
    https_port = int(core_settings.get("https_port") or 8443)
    ssl_enabled = bool(core_settings.get("ssl_enabled", False))

    matrix.append({
        "port": gui_port,
        "proto": "tcp",
        "service_id": None,
        "service_name": "ffmpeg-gui Web GUI",
        "service_type": "core",
        "category": "core",
        "description": "Web Administration Dashboard & REST API",
        "bind_address": bind_addr,
        "status": "running",
        "is_socket_open": ('tcp', gui_port) in open_sockets or True,
        "requires_inbound_firewall": bind_addr not in ("127.0.0.1", "localhost")
    })

    if ssl_enabled:
        matrix.append({
            "port": https_port,
            "proto": "tcp",
            "service_id": None,
            "service_name": "ffmpeg-gui Web GUI (HTTPS)",
            "service_type": "core",
            "category": "core",
            "description": "Encrypted Web Administration & REST API",
            "bind_address": bind_addr,
            "status": "running",
            "is_socket_open": ('tcp', https_port) in open_sockets or True,
            "requires_inbound_firewall": bind_addr not in ("127.0.0.1", "localhost")
        })

    # 2. Database Services (MediaProcess / Service)
    try:
        from database.models import Service
        services = db_session.query(Service).all()
    except Exception as e:
        logger.debug("Could not query Service model: %s", e)
        services = []

    for svc in services:
        cfg = getattr(svc, 'config', {}) or {}
        svc_type = getattr(svc, 'service_type', 'ffmpeg_stream')
        svc_status = getattr(svc, 'status', 'stopped')
        is_running = (svc_status == 'running')

        if svc_type == 'mediamtx_hub':
            mtx_cfg = cfg.get("mediamtx_config", {})
            svc_bind = mtx_cfg.get("bind_address") or "0.0.0.0"
            is_ssl = mtx_cfg.get("ssl_enabled", False)

            ports_def = [
                ("rtmp_enabled", True, "rtmp_port", 1935, "tcp", "RTMP Stream Ingest/Egress"),
                ("rtsp_enabled", True, "rtsp_port", 8554, "tcp", "RTSP Stream Ingest/Egress"),
                ("hls_enabled", True, "hls_port", 8888, "tcp", "HLS Web Distribution"),
                ("srt_enabled", False, "srt_port", 8890, "udp", "SRT Protocol Hub"),
                ("api_enabled", True, "api_port", 9997, "tcp", "Control & Telemetry API"),
            ]
            if is_ssl:
                ports_def.append(("rtmps_enabled", True, "rtmps_port", 1936, "tcp", "RTMPS Secure Ingest/Egress"))
                ports_def.append(("rtsps_enabled", True, "rtsps_port", 8322, "tcp", "RTSPS Secure Ingest/Egress"))
            if mtx_cfg.get("webrtc_enabled", False):
                ports_def.append((None, True, "webrtc_port", 8889, "tcp", "WebRTC HTTP / WHEP Signaling"))
                ports_def.append((None, True, "webrtc_udp_port", 8189, "udp", "WebRTC Media ICE / UDP"))
            if mtx_cfg.get("rtsp_enabled", True):
                ports_def.append((None, True, "rtp_port", 8000, "udp", "RTSP RTP Transport"))
                ports_def.append((None, True, "rtcp_port", 8001, "udp", "RTSP RTCP Feedback"))

            for flag_key, default_val, port_key, default_port, proto, desc in ports_def:
                enabled = mtx_cfg.get(flag_key, default_val) if flag_key else True
                if enabled:
                    p_val = int(mtx_cfg.get(port_key, default_port))
                    matrix.append({
                        "port": p_val,
                        "proto": proto,
                        "service_id": svc.id,
                        "service_name": svc.name,
                        "service_type": svc_type,
                        "category": "auxiliary",
                        "description": f"MediaMTX {desc}",
                        "bind_address": svc_bind,
                        "status": svc_status,
                        "is_socket_open": (proto, p_val) in open_sockets if is_running else False,
                        "requires_inbound_firewall": svc_bind not in ("127.0.0.1", "localhost")
                    })

        elif svc_type == 'icecast_server':
            ice_cfg = cfg.get("icecast_config", {})
            svc_bind = ice_cfg.get("bind_address") or "0.0.0.0"
            if ice_cfg.get("http_enabled", True):
                p_val = int(ice_cfg.get("port", 7000))
                matrix.append({
                    "port": p_val,
                    "proto": "tcp",
                    "service_id": svc.id,
                    "service_name": svc.name,
                    "service_type": svc_type,
                    "category": "auxiliary",
                    "description": "Icecast2 Audio Stream Server (HTTP)",
                    "bind_address": svc_bind,
                    "status": svc_status,
                    "is_socket_open": ('tcp', p_val) in open_sockets if is_running else False,
                    "requires_inbound_firewall": svc_bind not in ("127.0.0.1", "localhost")
                })
            if ice_cfg.get("ssl_enabled", False):
                ssl_p_val = int(ice_cfg.get("ssl_port", 7443))
                matrix.append({
                    "port": ssl_p_val,
                    "proto": "tcp",
                    "service_id": svc.id,
                    "service_name": svc.name,
                    "service_type": svc_type,
                    "category": "auxiliary",
                    "description": "Icecast2 Audio Stream Server (HTTPS/TLS)",
                    "bind_address": svc_bind,
                    "status": svc_status,
                    "is_socket_open": ('tcp', ssl_p_val) in open_sockets if is_running else False,
                    "requires_inbound_firewall": svc_bind not in ("127.0.0.1", "localhost")
                })

        elif svc_type == 'desktop':
            desk_cfg = cfg.get("desktop_config", {}) or cfg
            p_val = int(desk_cfg.get("vnc_port") or desk_cfg.get("port") or 6080)
            matrix.append({
                "port": p_val,
                "proto": "tcp",
                "service_id": svc.id,
                "service_name": svc.name,
                "service_type": svc_type,
                "category": "auxiliary",
                "description": "Virtual Desktop noVNC Web Viewer",
                "bind_address": "127.0.0.1",
                "status": svc_status,
                "is_socket_open": ('tcp', p_val) in open_sockets if is_running else False,
                "requires_inbound_firewall": False
            })

        elif svc_type == 'pipewire_hub':
            pw_cfg = cfg.get("pipewire_config", {}) or cfg
            aes67_net = pw_cfg.get("aes67_network", {})
            aes67_enabled = bool(aes67_net.get("enabled", False))
            iface_name = aes67_net.get("interface") or "0.0.0.0"
            iface_ip = aes67_net.get("ip") or "0.0.0.0"
            eff_bind = iface_name if iface_name != "0.0.0.0" else iface_ip

            # 1. Remote Sinks (AoIP Rx: listens on UDP RTP port for incoming multicast audio)
            for rs in pw_cfg.get("remote_sinks", []):
                r_port = int(rs.get("rtp_port") or rs.get("port") or 5004)
                rs_name = rs.get("name") or rs.get("id") or rs.get("stream_name") or "Remote Sink"
                m_ip = rs.get("multicast_ip") or ""
                matrix.append({
                    "port": r_port,
                    "proto": "udp",
                    "service_id": svc.id,
                    "service_name": svc.name,
                    "service_type": svc_type,
                    "category": "auxiliary",
                    "description": f"PipeWire AoIP Rx [{rs_name}]{f' ({m_ip})' if m_ip else ''}",
                    "bind_address": eff_bind,
                    "status": svc_status,
                    "is_socket_open": ('udp', r_port) in open_sockets if is_running else False,
                    "requires_inbound_firewall": True
                })

            # 2. Virtual Sinks with AES67 Tx (outgoing multicast RTP streams)
            for vs in pw_cfg.get("virtual_sinks", []):
                if vs.get("aes67_enabled", False):
                    v_port = int(vs.get("rtp_port", 5004))
                    vs_name = vs.get("name") or vs.get("id") or "Virtual Sink"
                    m_ip = vs.get("multicast_ip") or ""
                    matrix.append({
                        "port": v_port,
                        "proto": "udp",
                        "service_id": svc.id,
                        "service_name": svc.name,
                        "service_type": svc_type,
                        "category": "auxiliary",
                        "description": f"PipeWire AES67 Tx [{vs_name}]{f' ({m_ip})' if m_ip else ''}",
                        "bind_address": eff_bind,
                        "status": svc_status,
                        "is_socket_open": ('udp', v_port) in open_sockets if is_running else False,
                        "requires_inbound_firewall": False
                    })

            # 3. SAP Announcement/Discovery and PTPv2 Clock Sync
            if aes67_enabled:
                matrix.append({
                    "port": 9875,
                    "proto": "udp",
                    "service_id": svc.id,
                    "service_name": svc.name,
                    "service_type": svc_type,
                    "category": "auxiliary",
                    "description": "AES67 SAP Discovery & Session Announcements (RFC 2974)",
                    "bind_address": eff_bind,
                    "status": svc_status,
                    "is_socket_open": ('udp', 9875) in open_sockets if is_running else False,
                    "requires_inbound_firewall": True
                })
                matrix.append({
                    "port": 319,
                    "proto": "udp",
                    "service_id": svc.id,
                    "service_name": svc.name,
                    "service_type": svc_type,
                    "category": "auxiliary",
                    "description": "PTPv2 Event Messages & Clock Sync (IEEE 1588)",
                    "bind_address": eff_bind,
                    "status": svc_status,
                    "is_socket_open": ('udp', 319) in open_sockets if is_running else False,
                    "requires_inbound_firewall": True
                })
                matrix.append({
                    "port": 320,
                    "proto": "udp",
                    "service_id": svc.id,
                    "service_name": svc.name,
                    "service_type": svc_type,
                    "category": "auxiliary",
                    "description": "PTPv2 General Messages & Announce (IEEE 1588)",
                    "bind_address": eff_bind,
                    "status": svc_status,
                    "is_socket_open": ('udp', 320) in open_sockets if is_running else False,
                    "requires_inbound_firewall": True
                })

        elif svc_type == 'ffmpeg_stream':
            try:
                from utils.port_validator import extract_ports_from_service
                stream_ports = extract_ports_from_service(
                    service_id=svc.id,
                    service_name=svc.name,
                    service_type=svc_type,
                    config=svc.config,
                    input_config=svc.input_config,
                    output_config=svc.output_config
                )
                for p_num, p_label, _, _, proto in stream_ports:
                    matrix.append({
                        "port": p_num,
                        "proto": proto,
                        "service_id": svc.id,
                        "service_name": svc.name,
                        "service_type": svc_type,
                        "category": "pipeline",
                        "description": f"FFmpeg Stream ({p_label})",
                        "bind_address": "0.0.0.0",
                        "status": svc_status,
                        "is_socket_open": (proto, p_num) in open_sockets if is_running else False,
                        "requires_inbound_firewall": True
                    })
            except Exception as e:
                logger.debug("Could not extract stream ports for service %s: %s", svc.id, e)

    # Sort matrix by category (core first), then port number
    matrix.sort(key=lambda x: (x["category"] != "core", x["port"]))
    return matrix


def generate_firewall_rules(matrix: List[Dict[str, Any]]) -> Dict[str, List[str]]:
    """
    Generate reproducible UFW and iptables command scripts from the port matrix.
    Skips localhost-only bindings and deduplicates overlapping port/proto combinations.
    """
    ufw_rules = []
    iptables_rules = []
    seen = set()

    for item in matrix:
        port = item.get("port")
        proto = (item.get("proto") or "tcp").lower()
        bind_addr = item.get("bind_address") or "0.0.0.0"

        # Localhost bindings don't require external firewall holes
        if bind_addr in ("127.0.0.1", "localhost"):
            continue

        if not item.get("requires_inbound_firewall", True):
            continue

        key = (port, proto)
        if key in seen:
            continue
        seen.add(key)

        svc_name = item.get("service_name") or "service"
        desc = item.get("description") or svc_name
        ufw_rules.append(f"ufw allow {port}/{proto} comment '{desc} ({proto.upper()})'")
        iptables_rules.append(f"iptables -A INPUT -p {proto} --dport {port} -j ACCEPT -m comment --comment '{desc}'")

    return {
        "ufw": ufw_rules,
        "iptables": iptables_rules
    }


def find_system_binary(bin_name: str) -> Optional[str]:
    """Finds binary in PATH or standard system binary paths (/usr/sbin, /sbin, /usr/local/sbin)."""
    cand = shutil.which(bin_name)
    if cand:
        return cand
    for p in [f"/usr/sbin/{bin_name}", f"/sbin/{bin_name}", f"/usr/local/sbin/{bin_name}", f"/usr/bin/{bin_name}"]:
        if os.path.exists(p) and os.access(p, os.X_OK):
            return p
    return None


def probe_network_ptp_master(ifname: str, if_ip: Optional[str] = None, timeout: float = 0.35) -> Dict[str, Any]:
    """
    Attempts to detect an active PTPv2 Grandmaster on the local broadcast domain by listening
    briefly for PTP Sync (port 319, 8 pkts/s in AES67) or Announce (port 320, 1 pkt/s) packets
    on multicast 224.0.1.129.
    Safely handles unprivileged environments, timeouts, and permission errors without failing.
    """
    result = {
        "detected": False,
        "source_ip": None,
        "is_local": False
    }
    # Check port 319 (event/sync: 8 pkts/sec in AES67) first for instant detection, then port 320 (announce)
    for port in (319, 320):
        sock = None
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            if hasattr(socket, "SO_REUSEPORT"):
                try:
                    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
                except Exception:
                    pass
            sock.settimeout(max(0.1, min(timeout, 1.0)))
            sock.bind(('0.0.0.0', port))

            if if_ip and if_ip not in ("0.0.0.0", "127.0.0.1"):
                try:
                    mreq = struct.pack('4s4s', socket.inet_aton('224.0.1.129'), socket.inet_aton(if_ip))
                    sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
                except Exception:
                    mreq = struct.pack('4sl', socket.inet_aton('224.0.1.129'), socket.INADDR_ANY)
                    sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
            else:
                mreq = struct.pack('4sl', socket.inet_aton('224.0.1.129'), socket.INADDR_ANY)
                sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)

            data, (sender_ip, _) = sock.recvfrom(1024)
            if data and len(data) >= 34:
                msg_type = data[0] & 0x0F
                version = data[1] & 0x0F
                if version == 2 and msg_type in (0x0, 0x1, 0x8, 0x9, 0xA, 0xB):
                    result["detected"] = True
                    result["source_ip"] = sender_ip
                    result["is_local"] = (sender_ip == if_ip) if if_ip else (sender_ip in ("127.0.0.1", "0.0.0.0"))
                    break
        except (OSError, socket.timeout, Exception):
            pass
        finally:
            if sock:
                try:
                    sock.close()
                except Exception:
                    pass
    return result


def audit_pipewire_network_capabilities(probe_network_ptp: bool = True) -> Dict[str, Any]:
    """
    Audita interfaces de red del host y capacidades PTP de hardware/software para PipeWire.
    Clasifica cada interfaz en tri-estado PTP ('hardware' | 'software' | 'none'),
    extrae el reloj PTP de hardware (/dev/ptpX si existe) y detecta masters activos.
    """
    try:
        addrs = psutil.net_if_addrs() or {}
    except Exception:
        addrs = {}

    try:
        stats = psutil.net_if_stats() or {}
    except Exception:
        stats = {}

    ethtool_bin = find_system_binary("ethtool")
    ptp4l_bin = find_system_binary("ptp4l")

    interfaces = []
    for ifname, addr_list in addrs.items():
        if ifname == "lo" or ifname.lower() == "lo":
            continue

        stat = stats.get(ifname)
        if stat is not None and not stat.isup:
            continue
        if stat is not None and "loopback" in getattr(stat, "flags", ""):
            continue

        # Validar formato seguro de ifname antes de cualquier invocación de sistema
        if not re.match(r'^[a-zA-Z0-9_.:-]+$', ifname) or ifname.startswith('-'):
            continue

        # Primer IPv4 no-loopback
        ip = None
        for addr in addr_list:
            family = getattr(addr, "family", None)
            if family == socket.AF_INET or family == 2:
                addr_str = getattr(addr, "address", None)
                if addr_str and not addr_str.startswith("127."):
                    ip = addr_str
                    break

        is_up = bool(stat.isup) if stat is not None else True
        speed = int(stat.speed) if (stat is not None and stat.speed is not None and stat.speed >= 0) else 0

        # Chequear capacidades de timestamping PTP vía ethtool -T
        ptp_support = "none"  # "hardware" | "software" | "none"
        ptp_device = None

        ethtool_cmd = ethtool_bin or "ethtool"
        try:
            res = subprocess.run(
                [ethtool_cmd, "-T", ifname],
                capture_output=True,
                text=True,
                timeout=2.0
            )
            if res.returncode == 0:
                out = res.stdout or ""

                # Extraer dispositivo PTP de hardware (/dev/ptpX) si está presente
                clk_match = re.search(r"PTP Hardware Clock:\s*(\d+)", out)
                if clk_match:
                    ptp_device = f"/dev/ptp{clk_match.group(1)}"

                has_hw = (("hardware-transmit" in out and "hardware-receive" in out) or
                          ("SOF_TIMESTAMPING_TX_HARDWARE" in out))
                has_sw = (("software-transmit" in out and "software-receive" in out) or
                          ("SOF_TIMESTAMPING_TX_SOFTWARE" in out) or
                          ("software-system-clock" in out))

                if has_hw:
                    ptp_support = "hardware"
                elif has_sw:
                    ptp_support = "software"
                else:
                    ptp_support = "none"
        except (subprocess.TimeoutExpired, FileNotFoundError, PermissionError, subprocess.SubprocessError, Exception):
            ptp_support = "none"

        active_master = {
            "detected": False,
            "source_ip": None,
            "is_local": False
        }
        if probe_network_ptp:
            active_master = probe_network_ptp_master(ifname, ip, timeout=0.25)

        interfaces.append({
            "name": ifname,
            "ip": ip,
            "is_up": is_up,
            "speed": speed,
            "ptp_support": ptp_support,
            "ptp_device": ptp_device,
            "ptp_hardware_capable": (ptp_support == "hardware"),
            "ptp_software_capable": (ptp_support == "software"),
            "active_ptp_master": active_master
        })

    ptp4l_installed = ptp4l_bin is not None

    ptp4l_running = False
    try:
        for proc in psutil.process_iter(['name']):
            try:
                name = proc.info.get('name') if getattr(proc, 'info', None) else None
                if not name and hasattr(proc, 'name'):
                    name = proc.name()
                if name and "ptp4l" in str(name):
                    ptp4l_running = True
                    break
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue
    except Exception:
        ptp4l_running = False

    active_master_detected = ptp4l_running or any(
        bool(iface.get("active_ptp_master", {}).get("detected")) for iface in interfaces
    )

    return {
        "interfaces": interfaces,
        "host_ptp": {
            "ptp4l_installed": ptp4l_installed,
            "ptp4l_bin": ptp4l_bin,
            "ptp4l_running": ptp4l_running,
            "active_master_detected": active_master_detected
        }
    }

