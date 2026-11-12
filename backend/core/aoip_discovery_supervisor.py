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

# Multicast groups joined for SAP / SDP announcements:
# - 239.255.255.255: Dante / SAP Admin local scope
# - 239.192.255.255: AES67 Organization-Local SAP (AES67-2018 §8.2 / RFC 2365)
# - 224.0.0.56: Link-Local multicast SAP (used by default by AES67 senders)
# - 224.2.127.254: Standard global SAP (RFC 2974)
SAP_MULTICAST_GROUPS: Tuple[str, ...] = (
    "239.255.255.255",
    "239.192.255.255",
    "224.0.0.56",
    "224.2.127.254"
)

# SAP stream announcement freshness and pruning windows (seconds)
# SAP_ACTIVE_STREAM_WINDOW_SEC: Time of announcement silence before stream state transitions to 'waiting'
# SAP_STREAM_EXPIRATION_SEC: Time before unmanaged discovered streams are pruned from memory
SAP_ACTIVE_STREAM_WINDOW_SEC: float = 60.0
SAP_STREAM_EXPIRATION_SEC: float = 120.0




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
        "session_name": sap_name,
        "session_id": f"{multicast_ip}:{rtp_port}",
        "multicast_ip": multicast_ip,
        "rtp_port": rtp_port,
        "channels": max(1, channels),
        "rate": rate,
        "sample_rate": rate,
        "encoding": encoding,
        "format": format_name,
        "ptp_clock_id": ptp_clock_id,
        "origin_ip": origin_ip or sender_ip,
        "is_deletion": is_deletion,
        "sdp_raw": sdp_text,
    }


class _SapDatagramProtocol(asyncio.DatagramProtocol):
    """Asyncio UDP datagram protocol callback handler for passive SAP packet reception."""

    def __init__(self, supervisor: "AoIpDiscoverySupervisor"):
        self.supervisor = supervisor
        self.transport: Optional[asyncio.DatagramTransport] = None

    def connection_made(self, transport: asyncio.DatagramTransport):
        self.transport = transport

    def datagram_received(self, data: bytes, addr: Tuple[str, int]):
        self.supervisor.handle_sap_packet(data, addr)

    def error_received(self, exc: Exception):
        logger.warning(f"[AoIpDiscovery #{self.supervisor.hub_id}] SAP socket datagram error: {exc}")

    def connection_lost(self, exc: Optional[Exception]):
        if exc:
            logger.warning(f"[AoIpDiscovery #{self.supervisor.hub_id}] SAP socket connection closed: {exc}")


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
        self._sap_transport: Optional[asyncio.DatagramTransport] = None
        self._sap_socket: Optional[socket.socket] = None

        # Interface and IP configuration
        self.interface: Optional[str] = None
        self.nic_ip: Optional[str] = None

        # Discovered SAP streams cache: key = f"{multicast_ip}:{rtp_port}"
        self._streams_cache: Dict[str, Dict[str, Any]] = {}

        # PTP state cache
        self._last_ptp4l_role: str = "UNKNOWN"
        self._ptp_status: Dict[str, Any] = {
            "detected": False,
            "source_ip": None,
            "clock_identity": None,
            "local_ptp4l_role": "UNKNOWN",
            "time_stamping": "software",
            "free_running": True,
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

    def handle_sap_packet(self, data: bytes, addr: Tuple[str, int]):
        """Callback invoked when a UDP datagram arrives on the SAP port."""
        sender_ip = addr[0] if addr else ""
        try:
            parsed = parse_sap_packet(data, sender_ip=sender_ip)
            if not parsed:
                return

            stream_key = f"{parsed['multicast_ip']}:{parsed['rtp_port']}"
            if parsed.get("is_deletion"):
                removed = self._streams_cache.pop(stream_key, None)
                if removed:
                    logger.info(f"[AoIpDiscovery #{self.hub_id}] SAP deletion received for stream '{stream_key}' ({removed.get('session_name')})")
                    try:
                        from core.websocket_subscription_hub import subscription_hub
                        subscription_hub.invalidate_pipewire_graph(self.hub_id)
                    except Exception:
                        pass
            else:
                now = time.time()
                is_local = (parsed["origin_ip"] == self.nic_ip) if self.nic_ip else (parsed["origin_ip"] in ("127.0.0.1", "0.0.0.0"))
                parsed["is_local"] = is_local
                parsed["last_seen"] = now

                existing = self._streams_cache.get(stream_key)
                is_new = existing is None
                was_inactive = existing is not None and (
                    existing.get("_state") == "waiting" or (now - existing.get("last_seen", 0) > SAP_ACTIVE_STREAM_WINDOW_SEC)
                )

                parsed["status"] = "online"
                parsed["_state"] = "online"
                self._streams_cache[stream_key] = parsed

                if is_new or was_inactive:
                    action_desc = "Discovered SAP stream" if is_new else "RECOVERED SAP stream (restored from silence)"
                    logger.info(
                        f"[AoIpDiscovery #{self.hub_id}] {action_desc} '{parsed['session_name']}' "
                        f"on {parsed['multicast_ip']}:{parsed['rtp_port']} "
                        f"({parsed['channels']}ch, {parsed['rate']}Hz, {parsed['format']}) from {parsed['origin_ip']}"
                    )
                    try:
                        from core.websocket_subscription_hub import subscription_hub
                        subscription_hub.invalidate_pipewire_graph(self.hub_id)
                    except Exception:
                        pass
        except Exception as e:
            logger.warning(f"[AoIpDiscovery #{self.hub_id}] Error processing incoming SAP packet: {e}")

    async def stop(self):
        """Stops background discovery tasks and closes transports/sockets cleanly."""
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

        if self._sap_transport:
            try:
                self._sap_transport.close()
            except Exception:
                pass
            self._sap_transport = None

        if self._sap_socket:
            try:
                self._sap_socket.close()
            except Exception:
                pass
            self._sap_socket = None

        logger.info(f"[AoIpDiscovery #{self.hub_id}] Stopped companion discovery supervisor.")

    def _setup_sap_socket(self) -> Optional[socket.socket]:
        """
        Create and bind non-blocking UDP multicast listener on port 9875.
        Uses SO_REUSEADDR exclusively (avoiding SO_REUSEPORT which causes hash load-balancing
        among multiple processes listening on the same port on Linux instead of multicast fanout).
        """
        sock = None
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

            # Bind to device if specified and permissions allow (SO_BINDTODEVICE = 25)
            if self.interface:
                try:
                    sock.setsockopt(socket.SOL_SOCKET, 25, self.interface.encode())
                except Exception:
                    pass

            sock.setblocking(False)
            sock.bind(("0.0.0.0", 9875))

            # Multicast groups to join: Dante / Admin AES67, AES67 Org-Local, Link-Local and Standard SAP
            groups = list(SAP_MULTICAST_GROUPS)
            for grp in groups:
                joined = False
                # 1. Prefer struct ip_mreqn with interface index and INADDR_ANY
                if self.interface:
                    try:
                        if_idx = socket.if_nametoindex(self.interface)
                        mreqn = struct.pack("=4s4si", socket.inet_aton(grp), socket.inet_aton("0.0.0.0"), if_idx)
                        sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreqn)
                        joined = True
                    except Exception as e:
                        logger.debug(f"[AoIpDiscovery #{self.hub_id}] ip_mreqn join {grp} on {self.interface} failed: {e}")

                # 2. Fallback to struct ip_mreq with self.nic_ip
                if not joined and self.nic_ip and self.nic_ip not in ("0.0.0.0", "127.0.0.1"):
                    try:
                        mreq = struct.pack("4s4s", socket.inet_aton(grp), socket.inet_aton(self.nic_ip))
                        sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
                        joined = True
                    except Exception as e:
                        logger.debug(f"[AoIpDiscovery #{self.hub_id}] ip_mreq IP join {grp} on {self.nic_ip} failed: {e}")

                # 3. Always ensure INADDR_ANY membership is added as baseline
                try:
                    mreq = struct.pack("4s4s", socket.inet_aton(grp), socket.inet_aton("0.0.0.0"))
                    sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
                except Exception as e:
                    logger.debug(f"[AoIpDiscovery #{self.hub_id}] INADDR_ANY join {grp} failed: {e}")

            return sock
        except Exception as e:
            if sock:
                try:
                    sock.close()
                except Exception:
                    pass
            logger.warning(f"[AoIpDiscovery #{self.hub_id}] Failed to bind SAP socket on port 9875: {e}")
            return None

    def _check_stream_timeouts_and_prune(self, now: float) -> bool:
        """
        Evaluates active streams for announcement silence (state transition to 'waiting')
        and prunes unmanaged discovered streams that exceeded SAP_STREAM_EXPIRATION_SEC.
        Returns True if any state changed or stream was pruned, triggering WebSocket invalidation.
        """
        changed = False

        # 1. Prune streams older than SAP_STREAM_EXPIRATION_SEC
        expired_keys = [
            k for k, v in self._streams_cache.items()
            if now - v.get("last_seen", 0) > SAP_STREAM_EXPIRATION_SEC
        ]
        if expired_keys:
            for k in expired_keys:
                removed = self._streams_cache.pop(k, None)
                if removed:
                    logger.info(f"[AoIpDiscovery #{self.hub_id}] Pruned expired SAP stream '{k}' ({removed.get('session_name')})")
            changed = True

        # 2. Detect transitions from online to waiting due to announcement silence
        for k, v in self._streams_cache.items():
            is_active = (now - v.get("last_seen", 0) <= SAP_ACTIVE_STREAM_WINDOW_SEC)
            prev_state = v.get("_state", "online")
            new_state = "online" if is_active else "waiting"
            if new_state != prev_state:
                v["_state"] = new_state
                v["status"] = new_state
                changed = True
                logger.info(f"[AoIpDiscovery #{self.hub_id}] SAP stream '{k}' ({v.get('session_name')}) transitioned from {prev_state} to {new_state}.")

        if changed:
            try:
                from core.websocket_subscription_hub import subscription_hub
                subscription_hub.invalidate_pipewire_graph(self.hub_id)
            except Exception:
                pass

        return changed

    def _prune_expired_streams(self, now: float) -> bool:
        """Compatibility wrapper for _check_stream_timeouts_and_prune."""
        return self._check_stream_timeouts_and_prune(now)

    async def _run_sap_listener(self):
        """Asynchronous listener loop receiving and parsing SAP announcements via DatagramProtocol."""
        loop = asyncio.get_running_loop()

        while self._running:
            sock = self._setup_sap_socket()
            if not sock:
                await asyncio.sleep(5.0)
                continue

            try:
                transport, protocol = await loop.create_datagram_endpoint(
                    lambda: _SapDatagramProtocol(self),
                    sock=sock
                )
                self._sap_transport = transport
                logger.info(
                    f"[AoIpDiscovery #{self.hub_id}] SAP multicast listener active on {self.interface or 'default'} "
                    f"({self.nic_ip or 'all'}) for {' / '.join(SAP_MULTICAST_GROUPS)} : 9875"
                )

                while self._running and not transport.is_closing():
                    await asyncio.sleep(1.0)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"[AoIpDiscovery #{self.hub_id}] SAP listener loop error: {e}")
                await asyncio.sleep(2.0)
            finally:
                if self._sap_transport:
                    try:
                        self._sap_transport.close()
                    except Exception:
                        pass
                    self._sap_transport = None

    @staticmethod
    def _parse_ptp4l_log_lines(lines: List[str]) -> Dict[str, Any]:
        """
        Parse ptp4l log lines from newest to oldest, stopping at the latest
        '--- PTP4L' launch/restart marker so prior runs never bleed into current telemetry.
        """
        best_master_clock: Optional[str] = None
        has_rms_reports = False
        detected_role: Optional[str] = None
        detected_ts_mode: Optional[str] = None

        for line in reversed(lines):
            line_clean = line.strip()
            if not line_clean:
                continue
            if "--- PTP4L" in line_clean:
                break
            if line_clean.startswith("---"):
                continue
            if line_clean.startswith("COMMAND:"):
                if detected_ts_mode is None:
                    detected_ts_mode = "software" if "-S" in line_clean else "hardware"
                continue
            if "rms " in line_clean and "freq " in line_clean:
                has_rms_reports = True
            if not best_master_clock:
                m_clock = re.search(r"selected best master clock\s+([0-9a-fA-F.]+)", line_clean)
                if not m_clock:
                    m_clock = re.search(r"new foreign master\s+([0-9a-fA-F.]+)", line_clean)
                if m_clock:
                    raw_id = m_clock.group(1).replace(".", "")
                    if len(raw_id) == 16:
                        best_master_clock = ":".join(raw_id[i:i+2] for i in range(0, 16, 2)).lower()
            if not detected_role:
                if "assuming the grand master role" in line_clean or "MASTER on" in line_clean or "to MASTER" in line_clean:
                    detected_role = "MASTER"
                elif "SLAVE on" in line_clean or "to SLAVE" in line_clean:
                    detected_role = "SLAVE"
                elif "UNCALIBRATED on" in line_clean or "to UNCALIBRATED" in line_clean:
                    detected_role = "UNCALIBRATED"
                elif "PASSIVE on" in line_clean or "to PASSIVE" in line_clean:
                    detected_role = "PASSIVE"
                elif "LISTENING on" in line_clean or "to LISTENING" in line_clean:
                    detected_role = "LISTENING"
                elif "FAULT_DETECTED" in line_clean or "to FAULTY" in line_clean:
                    detected_role = "FAULTY"
                elif "to INITIALIZING" in line_clean or "INITIALIZING on" in line_clean:
                    detected_role = "INITIALIZING"

        return {
            "role": detected_role,
            "has_rms_reports": has_rms_reports,
            "best_master_clock": best_master_clock,
            "ts_mode": detected_ts_mode,
        }

    async def _run_ptp_monitor(self):
        """Periodic passive PTPv2 monitor and local ptp4l role inspector."""
        from core.network_inspector import probe_network_ptp_master

        while self._running:
            try:
                prev_role = self._ptp_status.get("local_ptp4l_role")
                prev_src = self._ptp_status.get("source_ip")
                prev_det = self._ptp_status.get("detected")

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
                        if probe_res.get("clock_identity"):
                            self._ptp_status["clock_identity"] = probe_res.get("clock_identity")
                        self._ptp_status["is_local"] = probe_res.get("is_local", False)
                        self._ptp_status["last_seen"] = time.time()
                    else:
                        # Age out after 15 seconds without detection, but only if not actively locked in SLAVE/UNCALIBRATED/CALIBRATING
                        current_role = self._ptp_status.get("local_ptp4l_role")
                        if current_role not in ("SLAVE", "UNCALIBRATED", "CALIBRATING"):
                            last = self._ptp_status.get("last_seen")
                            if last and (time.time() - last > 15.0):
                                self._ptp_status["detected"] = False
                                self._ptp_status["source_ip"] = None
                                self._ptp_status["clock_identity"] = None

                # 2. Inspect local ptp4l role from sidecar log
                role = "INACTIVE"
                sidecars = self.pm._get_pipewire_sidecar_status(self.hub_id) if self.pm and hasattr(self.pm, "_get_pipewire_sidecar_status") else {}
                ptp4l_alive = sidecars.get("ptp4l_active", False)
                if ptp4l_alive:
                    role = self._last_ptp4l_role if self._last_ptp4l_role not in ("UNKNOWN", "INACTIVE") else "INITIALIZING"
                else:
                    self._last_ptp4l_role = "INACTIVE"

                cand_log_paths = []
                if self.pm and hasattr(self.pm, "get_process_log_storage_path"):
                    try:
                        p_dir = self.pm.get_process_log_storage_path(process_id=self.hub_id)
                        if p_dir:
                            cand_log_paths.append(os.path.join(p_dir, f"ptp4l_{self.hub_id}.log"))
                    except Exception:
                        pass
                cand_log_paths.extend([
                    f"backend/data/logs/ptp4l_{self.hub_id}.log",
                    f"data/logs/ptp4l_{self.hub_id}.log",
                    f"/tmp/ffmpeg-gui/ptp4l_{self.hub_id}.log",
                    f"/tmp/ptp4l_{self.hub_id}.log",
                    f"/var/log/ffmpeg-gui/ptp4l_{self.hub_id}.log"
                ])

                best_master_clock = None
                has_rms_reports = False
                detected_role_in_tail = None
                detected_ts_mode = None
                detected_free_running = None

                # Check generated config file for free_running / time_stamping
                conf_paths = [
                    f"/dev/shm/ptp4l_{self.hub_id}.conf",
                    f"/tmp/ptp4l_{self.hub_id}.conf"
                ]
                for cp in conf_paths:
                    if os.path.exists(cp):
                        try:
                            with open(cp, "r", errors="replace") as cf:
                                conf_text = cf.read()
                                if "time_stamping           hardware" in conf_text:
                                    detected_ts_mode = "hardware"
                                elif "time_stamping           software" in conf_text:
                                    detected_ts_mode = "software"
                                fr_m = re.search(r"free_running\s+(\d+)", conf_text)
                                if fr_m:
                                    detected_free_running = (fr_m.group(1) == "1")
                            break
                        except Exception:
                            pass

                for lp in cand_log_paths:
                    if os.path.exists(lp):
                        try:
                            with open(lp, "r", errors="replace") as f:
                                # Read tail of file (64 KB window to catch transitions even after high log volume)
                                f.seek(0, os.SEEK_END)
                                fsize = f.tell()
                                f.seek(max(0, fsize - 65536), os.SEEK_SET)
                                parsed_tail = self._parse_ptp4l_log_lines(f.readlines())
                            if parsed_tail["has_rms_reports"]:
                                has_rms_reports = True
                            if parsed_tail["ts_mode"] and detected_ts_mode is None:
                                detected_ts_mode = parsed_tail["ts_mode"]
                            if parsed_tail["best_master_clock"] and not best_master_clock:
                                best_master_clock = parsed_tail["best_master_clock"]
                                self._ptp_status["clock_identity"] = best_master_clock
                            if parsed_tail["role"]:
                                detected_role_in_tail = parsed_tail["role"]
                                break
                        except Exception:
                            pass

                if detected_ts_mode is not None:
                    self._ptp_status["time_stamping"] = detected_ts_mode
                if detected_free_running is not None:
                    self._ptp_status["free_running"] = detected_free_running
                elif detected_ts_mode == "software":
                    self._ptp_status["free_running"] = True

                is_free_running = bool(self._ptp_status.get("free_running", False))

                if ptp4l_alive:
                    if detected_role_in_tail:
                        role = detected_role_in_tail
                    elif has_rms_reports:
                        # ptp4l is actively processing delay/sync reports:
                        # if we were previously SLAVE, stay SLAVE; otherwise UNCALIBRATED (or CALIBRATING if free_running)
                        role = self._last_ptp4l_role if self._last_ptp4l_role == "SLAVE" else "UNCALIBRATED"

                    # Differentiate CALIBRATING vs UNCALIBRATED in free-running software mode:
                    # When free_running is active, UNCALIBRATED is the permanent normal state during active sync;
                    # if ptp4l is actively calibrating (rms/freq reports present or already locked), show CALIBRATING (OK/green).
                    if role == "UNCALIBRATED" and is_free_running and has_rms_reports:
                        role = "CALIBRATING"
                    elif role == "CALIBRATING" and (not is_free_running):
                        role = "UNCALIBRATED"

                    self._last_ptp4l_role = role
                else:
                    role = "INACTIVE"
                    self._last_ptp4l_role = "INACTIVE"

                self._ptp_status["local_ptp4l_role"] = role

                # 3. Dynamic change detection & immediate WebSocket broadcast
                if (role != prev_role) or (self._ptp_status.get("source_ip") != prev_src) or (self._ptp_status.get("detected") != prev_det):
                    try:
                        from core.websocket_subscription_hub import subscription_hub
                        subscription_hub.invalidate_pipewire_graph(self.hub_id)
                    except Exception:
                        pass

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.debug(f"[AoIpDiscovery #{self.hub_id}] PTP monitor loop error: {e}")

            # Prune expired streams
            now = time.time()
            self._prune_expired_streams(now)

            await asyncio.sleep(5.0)

    def get_discovery_status(self) -> Dict[str, Any]:
        """
        Returns real-time discovery status, including PTP state, discovered streams,
        and live status of configured remote sinks.
        Actively checks stream freshness on demand so immediate queries reflect current network reality.
        """
        now = time.time()
        self._check_stream_timeouts_and_prune(now)
        persisted_remote_sinks = self._get_persisted_remote_sinks()

        # Build lookup of persisted remote sinks by multicast_ip:rtp_port
        persisted_map: Dict[str, Dict[str, Any]] = {}
        for rs in persisted_remote_sinks:
            m_ip = (rs.get("multicast_ip") or "").strip()
            r_port = int(rs.get("rtp_port", 5004))
            if m_ip:
                persisted_map[f"{m_ip}:{r_port}"] = rs

        # Decorate discovered streams with persistence match and live status
        streams_list = []
        for key, stream in sorted(self._streams_cache.items(), key=lambda x: x[1].get("sap_name", "")):
            s_copy = dict(stream)
            is_active = (now - stream.get("last_seen", 0) <= SAP_ACTIVE_STREAM_WINDOW_SEC)
            s_copy["status"] = "online" if is_active else "waiting"
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
            m_ip = (rs.get("multicast_ip") or "").strip()
            r_port = int(rs.get("rtp_port", 5004))
            k = f"{m_ip}:{r_port}"
            active_stream = self._streams_cache.get(k)
            is_active = active_stream is not None and (now - active_stream.get("last_seen", 0) <= SAP_ACTIVE_STREAM_WINDOW_SEC)

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

        ptp_stat = dict(self._ptp_status)
        ptp_role = self._ptp_status.get("local_ptp4l_role") or "INACTIVE"
        ptp_stat["state"] = ptp_role
        ptp_stat["local_ptp4l_role"] = ptp_role
        gm_ip = self._ptp_status.get("source_ip")
        if not gm_ip and ptp_role == "MASTER":
            gm_ip = self.nic_ip or "Local Node"
        ptp_stat["grandmaster_ip"] = gm_ip
        ptp_stat["source_ip"] = gm_ip

        return {
            "hub_id": self.hub_id,
            "running": self._running,
            "interface": self.interface,
            "ip": self.nic_ip,
            "ptp_status": ptp_stat,
            "discovered_streams": streams_list,
            "streams_count": len(streams_list),
            "remote_sinks_status": remote_sinks_status,
        }
