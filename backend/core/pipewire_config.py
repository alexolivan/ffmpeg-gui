"""
Dynamic PipeWire Configuration Generator.

Generates isolated, secure, and daemonized PipeWire configuration files
(using PipeWire SPA/JSON format) for virtual services, isolated audio routing,
and AES67 RTP/SAP streams without probing physical ALSA devices.
"""

import json
import math
import os
import re
import socket
import uuid
from typing import Any, Dict, List, Optional, Tuple


class PipeWireConfigGenerator:
    """Generates PipeWire SPA/JSON configuration files for isolated audio server instances."""

    @staticmethod
    def _spa_val(val: Any) -> str:
        """Format a Python value to SPA/JSON compatible string."""
        if isinstance(val, bool):
            return "true" if val else "false"
        if isinstance(val, (int, float)):
            return str(val)
        if isinstance(val, str):
            return json.dumps(val)
        if isinstance(val, list):
            items = ", ".join(PipeWireConfigGenerator._spa_val(item) for item in val)
            return f"[ {items} ]"
        if isinstance(val, dict):
            parts = []
            for k, v in val.items():
                k_str = k if re.match(r"^[a-zA-Z0-9_\-]+$", k) else json.dumps(k)
                parts.append(f"{k_str} = {PipeWireConfigGenerator._spa_val(v)}")
            return "{ " + ", ".join(parts) + " }"
        return json.dumps(str(val))

    @staticmethod
    def _get_channel_positions(channels: int) -> List[str]:
        """Return standard channel positions list for a given channel count."""
        if channels == 1:
            return ["MONO"]
        if channels == 2:
            return ["FL", "FR"]
        if channels == 4:
            return ["FL", "FR", "RL", "RR"]
        if channels == 6:
            return ["FL", "FR", "FC", "LFE", "RL", "RR"]
        if channels == 8:
            return ["FL", "FR", "FC", "LFE", "RL", "RR", "SL", "SR"]
        # Default fallback for arbitrary channel count
        return [f"AUX{i}" for i in range(channels)]

    @classmethod
    def get_canonical_base_multicast_prefix(cls, nic_ip: Optional[str] = None) -> str:
        """
        Derive canonical AES67 base multicast prefix (RFC 2365 / AES67 239.69.x).
        Uses the last octet of the host NIC IP to guarantee zero collisions between
        distinct hosts in the same broadcast domain.
        Example: 192.168.99.11 -> '239.69.11'
                 192.168.99.13 -> '239.69.13'
        """
        if nic_ip and nic_ip != "0.0.0.0":
            parts = str(nic_ip).strip().split(".")
            if len(parts) == 4 and all(p.isdigit() for p in parts):
                last_octet = int(parts[3])
                if 1 <= last_octet <= 254:
                    return f"239.69.{last_octet}"
        return "239.69.1"

    @classmethod
    def get_canonical_sink_multicast_ip(cls, base_prefix: str, sink_index: int) -> str:
        """
        Derive canonical multicast IP for a specific sink index within the base prefix.
        Example: ('239.69.11', 1) -> '239.69.11.1'
        """
        clean_prefix = str(base_prefix).strip().rstrip(".")
        idx = max(1, min(254, int(sink_index)))
        return f"{clean_prefix}.{idx}"

    @classmethod
    def get_canonical_eui64(cls, mac_or_ip: Optional[str] = None) -> str:
        """
        Derive canonical EUI-64 clock identifier (IEEE 1588-2008 / RFC 7273).
        Example: '00:15:5d:11:22:33' -> '00-15-5D-FF-FE-11-22-33'
        """
        if mac_or_ip:
            clean = re.sub(r'[^a-fA-F0-9]', '', str(mac_or_ip))
            if len(clean) == 12:
                # 48-bit MAC -> EUI-64: insert FFFE in the middle
                eui = f"{clean[:6]}fffe{clean[6:]}".upper()
                return "-".join(eui[i:i+2] for i in range(0, 16, 2))
            if len(clean) == 16:
                # Already 64-bit
                return "-".join(clean[i:i+2].upper() for i in range(0, 16, 2))

        # Fallback to system node MAC address
        node = uuid.getnode()
        mac_hex = f"{node:012x}"
        eui = f"{mac_hex[:6]}fffe{mac_hex[6:]}".upper()
        return "-".join(eui[i:i+2] for i in range(0, 16, 2))

    @classmethod
    def format_sap_name(cls, raw_name: str, hostname: Optional[str] = None) -> str:
        """
        Format SAP session name with host prefix to guarantee uniqueness across nodes.
        Example: raw_name='aes_bus', hostname='test1' -> 'test1 aes_bus'
                 raw_name='test1 aes_bus', hostname='test1' -> 'test1 aes_bus'
        """
        if not hostname:
            try:
                hostname = socket.gethostname().split(".")[0]
            except Exception:
                hostname = "host"
        clean = (raw_name or "").strip()
        if not clean:
            clean = "stream"
        if not clean.startswith(f"{hostname} "):
            return f"{hostname} {clean}"
        return clean

    @classmethod
    def resolve_rtp_ptime_limits(cls, ptime_mode: Optional[str] = None) -> Tuple[int, int]:
        """
        Resolve (sess.min-ptime, sess.max-ptime) in milliseconds from user profile:
        - 'auto' (default): (2, 20) -> ~4.29ms (206 frames @ MTU 1280), ~230 pkt/s, low CPU/timer overhead.
        - '4ms': (4, 4) -> 250 pkt/s, standard broadcast / Ravenna.
        - '1ms': (1, 1) -> 1000 pkt/s, strict hardware AES67 / Dante compatibility.
        """
        mode = str(ptime_mode or "auto").strip().lower()
        if mode == "1ms":
            return (1, 1)
        if mode == "4ms":
            return (4, 4)
        return (2, 20)

    @classmethod
    def resolve_safe_jitter_latency_ms(
        cls,
        requested_latency_ms: Any,
        quantum: int,
        sample_rate: int,
        ptime_mode: Optional[str] = None
    ) -> int:
        """
        Compute safe sess.latency.msec enforcing:
        1. Mathematical quantum guardrail: effective_latency_ms >= ceil(3.0 * (quantum / sample_rate) * 1000.0).
        2. PipeWire RTP frame quantization: when a fixed ptime mode is specified (e.g. 1ms or 4ms),
           the latency is rounded up to an exact integer multiple of that packet time.
        If requested_latency_ms is 0, None, or 'auto', defaults to max(60, ceil(4.0 * quantum_ms)).
        """
        safe_rate = max(8000, int(sample_rate or 48000))
        safe_quantum = max(32, int(quantum or 1024))
        quantum_ms = (safe_quantum / float(safe_rate)) * 1000.0
        min_safe_ms = max(10, int(math.ceil(quantum_ms * 3.0)))

        req_val = 0
        if requested_latency_ms not in (None, "", "auto", 0, "0"):
            try:
                req_val = int(float(requested_latency_ms))
            except (ValueError, TypeError):
                req_val = 0

        base_ms = max(req_val if req_val > 0 else max(60, int(math.ceil(quantum_ms * 4.0))), min_safe_ms)

        if ptime_mode:
            mode = str(ptime_mode).strip().lower()
            if mode == "1ms":
                # Integer milliseconds are exact multiples of 1ms
                return int(base_ms)
            if mode == "4ms":
                # Round up to multiple of 4ms
                return int(math.ceil(base_ms / 4.0) * 4)

        return int(base_ms)

    @classmethod
    def generate_config(
        cls,
        service_id: int,
        config: Dict[str, Any],
        runtime_dir: str
    ) -> str:
        """
        Generate PipeWire SPA/JSON configuration.

        Args:
            service_id: Unique identifier of the service.
            config: Dictionary containing audio parameters and virtual sink configurations.
            runtime_dir: Path to runtime directory where sockets (e.g. pulse.sock) will be created.

        Returns:
            Formatted PipeWire SPA/JSON configuration string.
        """
        aes67_net = config.get("aes67_network", {})
        aoip_profile = str(config.get("aoip_profile") or aes67_net.get("aoip_profile") or "standalone").lower()
        sample_rate = 48000 if aoip_profile == "dante" else int(config.get("sample_rate", 48000))
        quantum = int(config.get("quantum", 1024))
        min_quantum = int(config.get("min_quantum", 128))
        max_quantum = int(config.get("max_quantum", 2048))
        debug_mode = bool(config.get("debug_mode", False))
        log_level = int(config.get("log_level", 2 if debug_mode else 1))
        nic_ip = aes67_net.get("ip", "0.0.0.0")
        nic_name = aes67_net.get("interface")
        nic_mac = aes67_net.get("mac") or aes67_net.get("interface_mac")
        base_prefix = aes67_net.get("base_multicast_prefix") or cls.get_canonical_base_multicast_prefix(nic_ip)
        eui64 = cls.get_canonical_eui64(nic_mac or nic_ip)

        if aoip_profile == "dante":
            ptime_mode = "1ms"
        else:
            ptime_mode = aes67_net.get("rtp_ptime_mode") or config.get("rtp_ptime_mode") or "auto"
        min_ptime, max_ptime = cls.resolve_rtp_ptime_limits(ptime_mode)
        raw_jitter_ms = aes67_net.get("jitter_buffer_ms", config.get("jitter_buffer_ms", "auto"))
        effective_latency_ms = cls.resolve_safe_jitter_latency_ms(raw_jitter_ms, quantum, sample_rate, ptime_mode)

        pulse_socket = os.path.join(runtime_dir, "pulse.sock")

        lines: List[str] = [
            f"# PipeWire daemon configuration for service {service_id}",
            "# Generated dynamically by PipeWireConfigGenerator",
            "",
            "context.properties = {",
            "    core.daemon = true",
            "    core.name = \"pipewire-0\"",
            f"    default.clock.rate = {sample_rate}",
            f"    default.clock.quantum = {quantum}",
            f"    default.clock.min-quantum = {min_quantum}",
            f"    default.clock.max-quantum = {max_quantum}",
            f"    log.level = {log_level}",
            "    mem.warn-mlock = false",
            "    support.dbus = false",
            "}",
            "",
            "context.spa-libs = {",
            "    audio.convert.* = audioconvert/libspa-audioconvert",
            "    audio.adapt     = audioconvert/libspa-audioconvert",
            "    support.*       = support/libspa-support",
            "}",
            "",
            "context.modules = [",
            "    { name = \"libpipewire-module-rt\"",
            "        args = {",
            "            nice.level = -11",
            "            rt.prio = 88",
            "            rt.time.soft = -1",
            "            rt.time.hard = -1",
            "            rlimits.enabled = true",
            "            rtportal.enabled = false",
            "            rtkit.enabled = false",
            "        }",
            "        flags = [ ifexists nofail ]",
            "    },",
            "    { name = \"libpipewire-module-protocol-native\" },",
            "    { name = \"libpipewire-module-metadata\" },",
            "    { name = \"libpipewire-module-spa-node-factory\" },",
            "    { name = \"libpipewire-module-client-node\" },",
            "    { name = \"libpipewire-module-access\" },",
            "    { name = \"libpipewire-module-adapter\" },",
            "    { name = \"libpipewire-module-link-factory\" },",
            "    {",
            "        name = \"libpipewire-module-protocol-pulse\",",
            "        args = {",
            f"            server.address = [ {cls._spa_val(f'unix:{pulse_socket}')} ]",
            "        }",
            "    },",
        ]

        # AES67 RTP and SAP modules in context.modules if enabled
        virtual_sinks = config.get("virtual_sinks", [])
        remote_sinks = config.get("remote_sinks", [])
        has_aes67_tx = any(sink.get("aes67_enabled", False) for sink in virtual_sinks)
        sap_ip = aes67_net.get("sap_ip") or config.get("sap_ip") or "239.255.255.255"

        if has_aes67_tx:
            sap_args = [
                f"            sap.ip = {cls._spa_val(sap_ip)}",
                "            sap.port = 9875",
                "            net.ttl = 32",
                "            net.loop = false",
            ]
            if nic_name:
                sap_args.append(f"            local.ifname = {cls._spa_val(nic_name)}")
            if nic_ip and nic_ip != "0.0.0.0":
                sap_args.append(f"            source.ip = {cls._spa_val(nic_ip)}")

            # Restrict stream.rules strictly to announce-stream.
            # CRITICAL: If create-stream is not explicitly suppressed, libpipewire-module-rtp-sap
            # matches all incoming SAP announcements and auto-spawns duplicate unmanaged rtp-source modules!
            sap_args.extend([
                "            stream.rules = [",
                "                {",
                "                    matches = [",
                "                        {",
                "                            sess.sap.announce = true",
                "                        }",
                "                    ]",
                "                    actions = {",
                "                        announce-stream = { }",
                "                    }",
                "                }",
                "            ]",
            ])

            lines.extend([
                "    {",
                "        name = \"libpipewire-module-rtp-sap\",",
                "        args = {",
                *sap_args,
                "        }",
                "    },",
            ])

        for idx, sink in enumerate(virtual_sinks, start=1):
            if sink.get("aes67_enabled", False):
                sink_id = sink.get("id", "sink")
                sink_name = sink.get("name", sink_id)
                channels = max(1, int(sink.get("channels", 2)))
                pos_list = cls._get_channel_positions(channels)
                pos_formatted = cls._spa_val(pos_list)
                dest_ip = sink.get("multicast_ip")
                if not dest_ip:
                    dest_ip = cls.get_canonical_sink_multicast_ip(base_prefix, idx)
                dest_port = int(sink.get("rtp_port", 5004))
                raw_sap = sink.get("sap_name") or sink.get("name") or sink_id
                sap_name = cls.format_sap_name(raw_sap)
                audio_fmt = "S24BE" if aoip_profile == "dante" else sink.get("format", "S24BE")

                rtp_args = []
                if nic_name:
                    rtp_args.append(f"            local.ifname = {cls._spa_val(nic_name)}")
                if nic_ip and nic_ip != "0.0.0.0":
                    rtp_args.append(f"            source.ip = {cls._spa_val(nic_ip)}")

                rtp_args.extend([
                    f"            destination.ip = {cls._spa_val(dest_ip)}",
                    f"            destination.port = {dest_port}",
                    f"            sess.name = {cls._spa_val(sap_name)}",
                    "            sess.media = \"audio\"",
                    "            sess.mediaclk = \"direct=0\"",
                    f"            sess.ts-refclk = {cls._spa_val(f'ptp=IEEE1588-2008:{eui64}:0')}",
                    f"            audio.format = {cls._spa_val(audio_fmt)}",
                    f"            audio.rate = {sample_rate}",
                    f"            audio.channels = {channels}",
                    f"            audio.position = {pos_formatted}",
                    f"            sess.min-ptime = {min_ptime}",
                    f"            sess.max-ptime = {max_ptime}",
                    f"            sess.latency.msec = {effective_latency_ms}",
                    "            net.ttl = 32",
                    "            net.loop = false",
                    "            stream.props = {",
                    f"                node.name = {cls._spa_val(f'rtp_tx_{sink_id}')}",
                    f"                node.description = {cls._spa_val(f'AES67 Tx for {sink_name}')}",
                    f"                target.object = {cls._spa_val(sink_id)}",
                    f"                sess.name = {cls._spa_val(sap_name)}",
                    f"                rtp.destination.ip = {cls._spa_val(dest_ip)}",
                    f"                rtp.destination.port = {dest_port}",
                    "                rtp.media = \"audio\"",
                    f"                rtp.mime = {cls._spa_val('L24' if '24' in audio_fmt else ('L16' if '16' in audio_fmt else 'L24'))}",
                    f"                rtp.rate = {sample_rate}",
                    f"                rtp.channels = {channels}",
                    f"                rtp.ptime = {1.0 if aoip_profile == 'dante' else float(min_ptime)}",
                    f"                rtp.ts-refclk = {cls._spa_val(f'ptp=IEEE1588-2008:{eui64}:0')}",
                    "                sess.sap.announce = true",
                    "                stream.dont-remix = true",
                    "                node.always-process = true",
                    "            }",
                ])

                lines.extend([
                    "    {",
                    "        name = \"libpipewire-module-rtp-sink\",",
                    "        args = {",
                    *rtp_args,
                    "        }",
                    "    },",
                ])

        # Remote AoIP Sinks (Receivers: libpipewire-module-rtp-source)
        for rs in remote_sinks:
            rs_id = rs.get("id", "remote_sink")
            rs_name = rs.get("name", rs_id)
            channels = max(1, int(rs.get("channels", 2)))
            pos_list = cls._get_channel_positions(channels)
            pos_formatted = cls._spa_val(pos_list)
            m_ip = rs.get("multicast_ip")
            r_port = int(rs.get("rtp_port", 5004))
            audio_format = rs.get("format", "S24BE")
            audio_rate = int(rs.get("rate") or sample_rate)
            rs_jitter = rs.get("jitter_buffer_ms", raw_jitter_ms)
            rs_latency_ms = cls.resolve_safe_jitter_latency_ms(rs_jitter, quantum, audio_rate, ptime_mode)

            rtp_rx_args = []
            if nic_name:
                rtp_rx_args.append(f"            local.ifname = {cls._spa_val(nic_name)}")
            if m_ip:
                rtp_rx_args.append(f"            source.ip = {cls._spa_val(m_ip)}")
            rtp_rx_args.extend([
                f"            source.port = {r_port}",
                "            sess.media = \"audio\"",
                "            sess.ignore-ssrc = true",
                f"            audio.format = {cls._spa_val(audio_format)}",
                f"            audio.rate = {audio_rate}",
                f"            audio.channels = {channels}",
                f"            audio.position = {pos_formatted}",
                f"            sess.min-ptime = {min_ptime}",
                f"            sess.max-ptime = {max_ptime}",
                f"            sess.latency.msec = {rs_latency_ms}",
                "            stream.props = {",
                f"                node.name = {cls._spa_val(f'rtp_rx_{rs_id}')}",
                f"                node.description = {cls._spa_val(f'AES67 Rx for {rs_name}')}",
                f"                target.object = {cls._spa_val(rs_id)}",
                "                media.class = \"Stream/Output/Audio\"",
                "                stream.dont-remix = true",
                "                node.always-process = true",
                "            }",
            ])

            lines.extend([
                "    {",
                "        name = \"libpipewire-module-rtp-source\",",
                "        args = {",
                *rtp_rx_args,
                "        }",
                "    },",
            ])

        lines.extend([
            "]",
            "",
            "stream.properties = {",
            "    adapter.auto-port-config = { mode = dsp }",
            "}",
            "",
            "context.objects = [",
            "    { factory = metadata",
            "        args = {",
            "            metadata.name = default",
            "        }",
            "    }",
            "    { factory = spa-node-factory",
            "        args = {",
            "            factory.name    = support.node.driver",
            "            node.name       = Dummy-Driver",
            "            node.group      = pipewire.dummy",
            "            priority.driver = 20000",
            "        }",
            "    }",
        ])

        # Virtual Sinks (Nodes created via adapter factory for all virtual sinks to provide playback and monitor ports)
        for sink in virtual_sinks:
            sink_id = sink.get("id", "sink")
            sink_name = sink.get("name", sink_id)
            channels = max(1, int(sink.get("channels", 2)))
            pos_list = cls._get_channel_positions(channels)
            pos_formatted = cls._spa_val(pos_list)

            lines.extend([
                "    { factory = adapter",
                "        args = {",
                "            factory.name = support.null-audio-sink",
                f"            node.name = {cls._spa_val(sink_id)}",
                f"            node.description = {cls._spa_val(sink_name)}",
                "            media.class = \"Audio/Sink\"",
                f"            audio.position = {pos_formatted}",
                f"            audio.channels = {channels}",
                f"            audio.rate = {sample_rate}",
                "            adapter.auto-port-config = {",
                "                mode = dsp",
                "                monitor = true",
                "                position = preserve",
                "            }",
                "            node.always-process = true",
                "        }",
                "    }",
            ])

        # Remote AoIP Landing Sinks (Nodes created via adapter factory for persisted remote streams)
        for rs in remote_sinks:
            rs_id = rs.get("id", "remote_sink")
            rs_name = rs.get("name", rs_id)
            channels = max(1, int(rs.get("channels", 2)))
            pos_list = cls._get_channel_positions(channels)
            pos_formatted = cls._spa_val(pos_list)

            lines.extend([
                "    { factory = adapter",
                "        args = {",
                "            factory.name = support.null-audio-sink",
                f"            node.name = {cls._spa_val(rs_id)}",
                f"            node.description = {cls._spa_val(f'Remote AoIP Sink: {rs_name}')}",
                "            media.class = \"Audio/Sink\"",
                f"            audio.position = {pos_formatted}",
                f"            audio.channels = {channels}",
                f"            audio.rate = {sample_rate}",
                "            adapter.auto-port-config = {",
                "                mode = dsp",
                "                monitor = true",
                "                position = preserve",
                "            }",
                "            node.always-process = true",
                "        }",
                "    }",
            ])

        lines.extend([
            "]",
            "",
        ])

        return "\n".join(lines)

    @classmethod
    def write_config_file(
        cls,
        service_id: int,
        config: Dict[str, Any],
        target_path: str,
        runtime_dir: str
    ) -> str:
        """
        Write generated PipeWire configuration to file atomically.

        Args:
            service_id: Unique identifier of the service.
            config: PipeWire configuration parameters.
            target_path: Destination file path.
            runtime_dir: Path to runtime directory.

        Returns:
            target_path written.
        """
        config_content = cls.generate_config(service_id, config, runtime_dir)
        target_abs = os.path.abspath(target_path)
        target_dir = os.path.dirname(target_abs)
        os.makedirs(target_dir, exist_ok=True)
        temp_path = f"{target_abs}.tmp.{os.getpid()}"
        with open(temp_path, "w", encoding="utf-8") as f:
            f.write(config_content)
        os.replace(temp_path, target_abs)
        return target_abs

    @classmethod
    def generate_ptp4l_config(
        cls,
        service_id: int,
        ptp_cfg: Dict[str, Any],
        iface: str,
        ptp_support: str = "software"
    ) -> str:
        """
        Generates ptp4l configuration file content according to IEEE 1588-2008 / AES67 standards.
        Supports hardware and software timestamping, auto-inhibition (BMCA masterOnly flag),
        priority1, domain, and transport profiles.
        """
        aoip_profile = str(ptp_cfg.get("aoip_profile") or ptp_cfg.get("profile", "")).lower()
        force_local_master = bool(ptp_cfg.get("force_local_master", False))
        profile = "aes67" if aoip_profile in ("dante", "aes67") else str(ptp_cfg.get("profile", "aes67")).lower()

        if aoip_profile == "dante":
            domain = 0
            if force_local_master:
                priority1 = 128
                priority2 = 128
                client_only = 0
                server_only = 1
            else:
                priority1 = 254
                priority2 = 254
                client_only = 1
                server_only = 0
        else:
            priority1 = int(ptp_cfg.get("priority1", 128))
            priority1 = max(0, min(255, priority1))
            priority2 = int(ptp_cfg.get("priority2", 128))
            priority2 = max(0, min(255, priority2))
            domain = int(ptp_cfg.get("domain", 0))
            domain = max(0, min(127, domain))
            auto_inhibit = bool(ptp_cfg.get("auto_inhibit", True))
            client_only = 1 if ptp_cfg.get("client_only") else 0
            server_only = 0 if auto_inhibit else 1

        is_hw = (ptp_support == "hardware")
        ts_mode = "hardware" if is_hw else "software"

        # Dedicated ephemeral UDS IPC socket paths in /dev/shm (or /tmp) to prevent permission errors in /var/run
        shm_dir = "/dev/shm" if os.path.exists("/dev/shm") and os.access("/dev/shm", os.W_OK) else "/tmp"
        uds_path = os.path.join(shm_dir, f"ptp4l_{service_id}.uds")
        uds_ro_path = os.path.join(shm_dir, f"ptp4lro_{service_id}.uds")

        # AES67 specifies 8 sync packets per second (logSyncInterval -3), logAnnounceInterval 0 (1s)
        log_sync = -3 if profile == "aes67" else 0
        log_announce = 0 if profile == "aes67" else 1
        log_delay = -3 if profile == "aes67" else 0
        dscp_event = 46 if profile == "aes67" else 0
        dscp_general = 34 if profile == "aes67" else 0

        clean_iface = re.sub(r'[^a-zA-Z0-9_.:-]', '', str(iface or "eth0"))

        lines = [
            f"# Generated ptp4l configuration for PipeWire Hub service #{service_id}",
            "# Profile: " + ("AES67 Media" if profile == "aes67" else "IEEE 1588 Default"),
            "[global]",
            f"domainNumber            {domain}",
            f"priority1               {priority1}",
            f"priority2               {priority2}",
            "clockClass              248",
            "clockAccuracy           0xFE",
            "offsetScaledLogVariance 0xFFFF",
            "free_running            0",
            "freq_est_interval       1",
            f"clientOnly              {client_only}",
            f"serverOnly              {server_only}",
            f"uds_address             {uds_path}",
            f"uds_ro_address          {uds_ro_path}",
            f"logSyncInterval         {log_sync}",
            f"logAnnounceInterval     {log_announce}",
            f"logMinDelayReqInterval  {log_delay}",
            f"dscp_event              {dscp_event}",
            f"dscp_general            {dscp_general}",
            f"time_stamping           {ts_mode}",
            "tx_timestamp_timeout    10",
            "summary_interval        1",
            "",
            f"[{clean_iface}]",
            "network_transport       UDPv4",
            "delay_mechanism         E2E",
            f"serverOnly              {server_only}",
            ""
        ]
        return "\n".join(lines)

    @classmethod
    def write_ptp4l_config_file(
        cls,
        service_id: int,
        ptp_cfg: Dict[str, Any],
        iface: str,
        target_path: str,
        ptp_support: str = "software"
    ) -> str:
        """
        Writes generated ptp4l configuration file to disk/RAM atomically with 0o600 permissions.
        """
        content = cls.generate_ptp4l_config(service_id, ptp_cfg, iface, ptp_support)
        target_abs = os.path.abspath(target_path)
        target_dir = os.path.dirname(target_abs)
        os.makedirs(target_dir, exist_ok=True)
        temp_path = f"{target_abs}.tmp.{os.getpid()}"
        with open(temp_path, "w", encoding="utf-8") as f:
            f.write(content)
        try:
            os.chmod(temp_path, 0o600)
        except Exception:
            pass
        os.replace(temp_path, target_abs)
        return target_abs
