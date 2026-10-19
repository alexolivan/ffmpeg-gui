"""
AoIP (AES67 / SAP / PTP) Discovery Supervisor
============================================
Dedicated, per-hub companion supervisor that passively discovers and monitors
network audio streams (via SAP/SDP multicast on 224.0.0.56:9875) and PTPv2 clock
status on the designated network interface.

Key Features:
- 1:1 Lifecycle binding with the parent PipeWire Hub service process.
- Passive SAP listener on 224.0.0.56:9875 (RFC 2974 / RFC 4566 SDP).
- Passive PTPv2 monitoring (224.0.1.129:319/320) & local ptp4l role inspection.
- Auto-tags local vs. remote streams and matched persistent remote sinks.
- Resilient non-blocking socket handling and safe error boundaries.
"""

import asyncio
import logging
import os
import re
import socket
import struct
import time
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("AoIpDiscoverySupervisor")


def parse_sap_packet(data: bytes, sender_ip: str = "") -> Optional[Dict[str, Any]]:
    """
    Parse a binary RFC 2974 SAP packet and extract RFC 4566 SDP session information.

    RFC 2974 Header layout:
      Byte 0:
        bits 7..5: Version (must be 1)
        bit 4: Address type (0 for IPv4, 1 for IPv6)
        bit 3: Reserved (must be 0)
        bit 2: Message type (0 for announcement, 1 for deletion)
        bit 1: Encryption (0 for unencrypted)
        bit 0: Compression (0 for uncompressed)
      Byte 1: Authentication length (number of 32-bit words)
      Bytes 2..3: Message ID hash (16-bit uint)
      Bytes 4..7: Originating IPv4 address (if IPv4)
      Bytes 8..8+auth_len*4: Auth data (if any)
      Payload: Optional payload type (null-terminated) + SDP text starting with 'v=0'
    """
    if not data or len(data) < 8:
        return None

    byte0 = data[0]
    version = (byte0 >> 5) & 0x07
    if version != 1:
        # Ignore non-SAPv1 packets
        return None

    is_ipv6 = bool((byte0 >> 4) & 0x01)
    is_deletion = bool((byte0 >> 2) & 0x01)
    is_encrypted = bool((byte0 >> 1) & 0x01)
    is_compressed = bool(byte0 & 0x01)

    # We do not support encrypted or compressed payloads
    if is_encrypted or is_compressed:
        return None

    auth_len = data[1] * 4
    # msg_id_hash = struct.unpack("!H", data[2:4])[0]

    offset = 4
    origin_ip = sender_ip
    if not is_ipv6:
        if len(data) >= offset + 4:
            origin_ip = socket.inet_ntoa(data[offset:offset + 4])
            offset += 4
    else:
        if len(data) >= offset + 16:
            try:
                origin_ip = socket.inet_ntop(socket.AF_INET6, data[offset:offset + 16])
            except Exception:
                pass
            offset += 16

    offset += auth_len
    if offset >= len(data):
        return None

    payload_bytes = data[offset:]

    # Skip optional null-terminated payload MIME type (e.g., 'application/sdp\0')
    if b"\x00" in payload_bytes[:64]:
        null_pos = payload_bytes.find(b"\x00")
        if null_pos != -1 and null_pos < len(payload_bytes) - 1:
            payload_bytes = payload_bytes[null_pos + 1:]

    try:
        sdp_text = payload_bytes.decode("utf-8", errors="replace")
    except Exception:
        return None

    if "v=0" not in sdp_text and "m=audio" not in sdp_text:
        return None

    # Parse SDP fields
    sap_name = ""
    multicast_ip = ""
    rtp_port = 5004
    channels = 2
    rate = 48000
    encoding = "L24"
    format_name = "S24BE"
    ptp_clock_id = None
    media_found = False

    for line in sdp_text.splitlines():
        line = line.strip()
        if not line or len(line) < 2 or line[1] != "=":
            continue

        prefix = line[:2]
        val = line[2:].strip()

        if prefix == "s=":
            sap_name = val
        elif prefix == "c=":
            # e.g., c=IN IP4 239.69.11.1/32 or c=IN IP4 239.69.11.1
            m_ip = re.search(r"IP4\s+([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)", val)
            if m_ip:
                multicast_ip = m_ip.group(1)
        elif prefix == "m=":
            # e.g., m=audio 5004 RTP/AVP 96
            m_m = re.match(r"audio\s+(\d+)\s+", val)
            if m_m:
                media_found = True
                try:
                    rtp_port = int(m_m.group(1))
                except ValueError:
                    pass
        elif prefix == "a=":
            # a=rtpmap:96 L24/48000/2 or a=rtpmap:96 L16/48000/2
            if val.startswith("rtpmap:"):
                m_rtp = re.search(r"rtpmap:\d+\s+([A-Za-z0-9_-]+)/(\d+)(?:/(\d+))?", val)
                if m_rtp:
                    encoding = m_rtp.group(1).upper()
                    try:
                        rate = int(m_rtp.group(2))
                    except ValueError:
                        pass
                    if m_rtp.group(3):
                        try:
                            channels = int(m_rtp.group(3))
                        except ValueError:
                            pass
            # a=ts-refclk:ptp=IEEE1588-2008:F0-2F-74-FF-FE-32-26-60:0 or ptp=IEEE1588-2008:...
            elif "ptp=" in val.lower() or "ts-refclk" in val.lower():
                m_ptp = re.search(r"(?:ptp=(?:IEEE1588-2008:)?)([0-9a-fA-F\:\-]+)", val)
                if m_ptp:
                    ptp_clock_id = m_ptp.group(1).upper()

    if not sap_name:
        sap_name = f"Stream {multicast_ip}:{rtp_port}" if multicast_ip else "Unnamed Stream"

    # Map standard AES67 / RTP encodings to PipeWire format names
    if "L24" in encoding:
        format_name = "S24BE"
    elif "L16" in encoding:
        format_name = "S16BE"
    elif "AM824" in encoding:
        format_name = "S24BE"
    else:
        format_name = "S24BE"

    if not multicast_ip:
        return None

    return {
        "sap_name": sap_name,
        "multicast_ip": multicast_ip,
        "rtp_port": rtp_port,
        "channels": max(1, channels),
        "rate": rate,
        "encoding": encoding,
        "format": format_name,
        "ptp_clock_id": ptp_clock_id,
        "origin_ip": origin_ip or sender_ip,
        "is_deletion": is_deletion,
        "sdp_raw": sdp_text,
    }


class AoIpDiscoverySupervisor:
    """
    Companion background supervisor that discovers network AoIP streams and monitors PTP clocks
    for a PipeWire Hub service. Runs alongside PipeWireMatrixSupervisor.
    """

    def __init__(self, hub_service_id: int, process_manager):
        self.hub_id = int(hub_service_id)
        self.pm = process_manager
        self._running = False
        self._sap_task: Optional[asyncio.Task] = None
        self._ptp_task: Optional[asyncio.Task] = None
        self._sap_socket: Optional[socket.socket] = None

        # Interface and IP configuration
        self.interface: Optional[str] = None
        self.nic_ip: Optional[str] = None

        # Discovered SAP streams cache: key = f"{multicast_ip}:{rtp_port}"
        self._streams_cache: Dict[str, Dict[str, Any]] = {}

        # PTP state cache
        self._ptp_status: Dict[str, Any] = {
            "detected": False,
            "source_ip": None,
            "clock_identity": None,
            "local_ptp4l_role": "UNKNOWN",
            "is_local": False,
            "last_seen": None,
        }

    def _resolve_hub_network_config(self) -> Tuple[Optional[str], Optional[str]]:
        """Extract configured interface and IP for this hub from database."""
        if not self.pm or not getattr(self.pm, "db_session_factory", None):
            return None, None
        try:
            with self.pm.db_session_factory() as session:
                from database.models import Service
                hub_svc = session.get(Service, self.hub_id) if hasattr(session, "get") else session.query(Service).get(self.hub_id)
                if not hub_svc:
                    return None, None
                cfg = hub_svc.config or {}
                pw_cfg = cfg.get("pipewire_config", cfg)
                aes_net = pw_cfg.get("aes67_network", {})
                if aes_net.get("enabled"):
                    iface = aes_net.get("interface")
                    ip = aes_net.get("ip")
                    return iface, ip
        except Exception as e:
            logger.debug(f"[AoIpDiscovery #{self.hub_id}] Could not query network config: {e}")
        return None, None

    def _get_persisted_remote_sinks(self) -> List[Dict[str, Any]]:
        """Retrieve persisted remote_sinks declared for this hub."""
        if not self.pm or not getattr(self.pm, "db_session_factory", None):
            return []
        try:
            with self.pm.db_session_factory() as session:
                from database.models import Service
                hub_svc = session.get(Service, self.hub_id) if hasattr(session, "get") else session.query(Service).get(self.hub_id)
                if not hub_svc:
                    return []
                cfg = hub_svc.config or {}
                pw_cfg = cfg.get("pipewire_config", cfg)
                return pw_cfg.get("remote_sinks", []) or []
        except Exception:
            return []

    async def start(self):
        """Starts background discovery loops for SAP and PTP."""
        if self._running:
            return
        self._running = True
        self.interface, self.nic_ip = self._resolve_hub_network_config()

        self._sap_task = asyncio.create_task(self._run_sap_listener())
        self._ptp_task = asyncio.create_task(self._run_ptp_monitor())
        logger.info(f"[AoIpDiscovery #{self.hub_id}] Started companion discovery supervisor on iface '{self.interface}' ({self.nic_ip}).")

    async def stop(self):
        """Stops background discovery tasks and closes sockets cleanly."""
        if not self._running:
            return
        self._running = False

        if self._sap_task and not self._sap_task.done():
            self._sap_task.cancel()
            try:
                await self._sap_task
            except asyncio.CancelledError:
                pass
        self._sap_task = None

        if self._ptp_task and not self._ptp_task.done():
            self._ptp_task.cancel()
            try:
                await self._ptp_task
            except asyncio.CancelledError:
                pass
        self._ptp_task = None

        if self._sap_socket:
            try:
                self._sap_socket.close()
            except Exception:
                pass
            self._sap_socket = None

        logger.info(f"[AoIpDiscovery #{self.hub_id}] Stopped companion discovery supervisor.")

    def _setup_sap_socket(self) -> Optional[socket.socket]:
        """Create and bind non-blocking UDP multicast listener on 224.0.0.56:9875."""
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            if hasattr(socket, "SO_REUSEPORT"):
                try:
                    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
                except Exception:
                    pass
            sock.setblocking(False)
            sock.bind(("0.0.0.0", 9875))

            if self.nic_ip and self.nic_ip not in ("0.0.0.0", "127.0.0.1"):
                try:
                    mreq = struct.pack("4s4s", socket.inet_aton("224.0.0.56"), socket.inet_aton(self.nic_ip))
                    sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
                except Exception:
                    mreq = struct.pack("4sl", socket.inet_aton("224.0.0.56"), socket.INADDR_ANY)
                    sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
            else:
                mreq = struct.pack("4sl", socket.inet_aton("224.0.0.56"), socket.INADDR_ANY)
                sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)

            return sock
        except Exception as e:
            logger.warning(f"[AoIpDiscovery #{self.hub_id}] Failed to bind SAP socket on 224.0.0.56:9875: {e}")
            return None

    async def _run_sap_listener(self):
        """Asynchronous listener loop receiving and parsing SAP announcements."""
        loop = asyncio.get_running_loop()

        while self._running:
            if not self._sap_socket:
                self._sap_socket = self._setup_sap_socket()
                if not self._sap_socket:
                    await asyncio.sleep(5.0)
                    continue

            try:
                data, addr = await loop.sock_recvfrom(self._sap_socket, 4096)
                sender_ip = addr[0] if addr else ""
                parsed = parse_sap_packet(data, sender_ip=sender_ip)
                if parsed:
                    stream_key = f"{parsed['multicast_ip']}:{parsed['rtp_port']}"
                    if parsed.get("is_deletion"):
                        self._streams_cache.pop(stream_key, None)
                    else:
                        now = time.time()
                        is_local = (parsed["origin_ip"] == self.nic_ip) if self.nic_ip else (parsed["origin_ip"] in ("127.0.0.1", "0.0.0.0"))
                        parsed["is_local"] = is_local
                        parsed["last_seen"] = now
                        self._streams_cache[stream_key] = parsed

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.debug(f"[AoIpDiscovery #{self.hub_id}] SAP socket read error: {e}")
                if self._sap_socket:
                    try:
                        self._sap_socket.close()
                    except Exception:
                        pass
                    self._sap_socket = None
                await asyncio.sleep(2.0)

    async def _run_ptp_monitor(self):
        """Periodic passive PTPv2 monitor and local ptp4l role inspector."""
        from core.network_inspector import probe_network_ptp_master

        while self._running:
            try:
                # 1. Passive PTP probe on network interface
                if self.interface:
                    probe_res = await asyncio.to_thread(
                        probe_network_ptp_master,
                        self.interface,
                        self.nic_ip,
                        0.25
                    )
                    if probe_res.get("detected"):
                        self._ptp_status["detected"] = True
                        self._ptp_status["source_ip"] = probe_res.get("source_ip")
                        self._ptp_status["is_local"] = probe_res.get("is_local", False)
                        self._ptp_status["last_seen"] = time.time()
                    else:
                        # Age out after 15 seconds without detection
                        last = self._ptp_status.get("last_seen")
                        if last and (time.time() - last > 15.0):
                            self._ptp_status["detected"] = False

                # 2. Inspect local ptp4l role from sidecar log
                role = "INACTIVE"
                cand_log_paths = [
                    f"backend/data/logs/ptp4l_{self.hub_id}.log",
                    f"data/logs/ptp4l_{self.hub_id}.log",
                    f"/tmp/ffmpeg-gui/ptp4l_{self.hub_id}.log"
                ]
                for lp in cand_log_paths:
                    if os.path.exists(lp):
                        try:
                            with open(lp, "r", errors="replace") as f:
                                # Read tail of file
                                f.seek(0, os.SEEK_END)
                                fsize = f.tell()
                                f.seek(max(0, fsize - 4096), os.SEEK_SET)
                                lines = f.readlines()
                                for line in reversed(lines):
                                    if "assuming the grand master role" in line or "MASTER on" in line:
                                        role = "MASTER"
                                        break
                                    elif "SLAVE on" in line or "LISTENING to SLAVE" in line:
                                        role = "SLAVE"
                                        break
                                    elif "LISTENING on" in line or "to LISTENING" in line:
                                        role = "LISTENING"
                                        break
                                    elif "FAULT_DETECTED" in line or "to FAULTY" in line:
                                        role = "FAULTY"
                                        break
                            if role != "INACTIVE":
                                break
                        except Exception:
                            pass

                self._ptp_status["local_ptp4l_role"] = role

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.debug(f"[AoIpDiscovery #{self.hub_id}] PTP monitor loop error: {e}")

            # Prune expired streams (no SAP announce for 120 seconds)
            now = time.time()
            expired_keys = [k for k, v in self._streams_cache.items() if now - v.get("last_seen", 0) > 120.0]
            for k in expired_keys:
                self._streams_cache.pop(k, None)

            await asyncio.sleep(5.0)

    def get_discovery_status(self) -> Dict[str, Any]:
        """
        Returns real-time discovery status, including PTP state, discovered streams,
        and live status of configured remote sinks.
        """
        now = time.time()
        persisted_remote_sinks = self._get_persisted_remote_sinks()

        # Build lookup of persisted remote sinks by multicast_ip:rtp_port
        persisted_map: Dict[str, Dict[str, Any]] = {}
        for rs in persisted_remote_sinks:
            m_ip = rs.get("multicast_ip")
            r_port = rs.get("rtp_port", 5004)
            if m_ip:
                persisted_map[f"{m_ip}:{r_port}"] = rs

        # Decorate discovered streams with persistence match
        streams_list = []
        for key, stream in sorted(self._streams_cache.items(), key=lambda x: x[1].get("sap_name", "")):
            s_copy = dict(stream)
            is_persisted = key in persisted_map
            matched_sink = persisted_map.get(key)
            s_copy["is_persisted"] = is_persisted
            s_copy["matched_sink_id"] = matched_sink.get("id") if matched_sink else None
            s_copy["matched_sink_name"] = matched_sink.get("name") if matched_sink else None
            streams_list.append(s_copy)

        # Build live status for all declared remote sinks
        remote_sinks_status = []
        for rs in persisted_remote_sinks:
            rs_id = rs.get("id", "")
            rs_name = rs.get("name") or rs_id
            m_ip = rs.get("multicast_ip", "")
            r_port = int(rs.get("rtp_port", 5004))
            k = f"{m_ip}:{r_port}"
            active_stream = self._streams_cache.get(k)
            is_active = active_stream is not None and (now - active_stream.get("last_seen", 0) <= 60.0)

            remote_sinks_status.append({
                "id": rs_id,
                "name": rs_name,
                "multicast_ip": m_ip,
                "rtp_port": r_port,
                "channels": rs.get("channels", 2),
                "format": rs.get("format", "S24BE"),
                "status": "online" if is_active else "waiting",
                "last_seen": active_stream.get("last_seen") if active_stream else None,
                "origin_ip": active_stream.get("origin_ip") if active_stream else None,
            })

        return {
            "hub_id": self.hub_id,
            "running": self._running,
            "interface": self.interface,
            "ip": self.nic_ip,
            "ptp_status": dict(self._ptp_status),
            "discovered_streams": streams_list,
            "remote_sinks_status": remote_sinks_status,
        }
