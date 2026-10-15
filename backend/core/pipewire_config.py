"""
Dynamic PipeWire Configuration Generator.

Generates isolated, secure, and daemonized PipeWire configuration files
(using PipeWire SPA/JSON format) for virtual services, isolated audio routing,
and AES67 RTP/SAP streams without probing physical ALSA devices.
"""

import json
import os
import re
from typing import Any, Dict, List, Optional


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
        sample_rate = int(config.get("sample_rate", 48000))
        quantum = int(config.get("quantum", 1024))
        min_quantum = int(config.get("min_quantum", 128))
        max_quantum = int(config.get("max_quantum", 2048))
        aes67_net = config.get("aes67_network", {})
        nic_ip = aes67_net.get("ip", "0.0.0.0")
        nic_name = aes67_net.get("interface")

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
            "    mem.warn-mlock = false",
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
        has_aes67 = any(sink.get("aes67_enabled", False) for sink in virtual_sinks)

        if has_aes67:
            sap_args = [
                "            sap.ip = \"224.0.0.56\"",
                "            sap.port = 9875",
            ]
            if nic_name:
                sap_args.append(f"            local.ifname = {cls._spa_val(nic_name)}")
            if nic_ip and nic_ip != "0.0.0.0":
                sap_args.append(f"            source.ip = {cls._spa_val(nic_ip)}")

            lines.extend([
                "    {",
                "        name = \"libpipewire-module-rtp-sap\",",
                "        args = {",
                *sap_args,
                "        }",
                "    },",
            ])

        for sink in virtual_sinks:
            if sink.get("aes67_enabled", False):
                sink_id = sink.get("id", "sink")
                sink_name = sink.get("name", sink_id)
                channels = max(1, int(sink.get("channels", 2)))
                pos_list = cls._get_channel_positions(channels)
                pos_formatted = cls._spa_val(pos_list)
                dest_ip = sink.get("multicast_ip", "239.69.1.10")
                dest_port = int(sink.get("rtp_port", 5004))
                sap_name = sink.get("sap_name", f"PipeWire {sink_id}")

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
                    "            audio.format = \"S24BE\"",
                    f"            audio.rate = {sample_rate}",
                    f"            audio.channels = {channels}",
                    f"            audio.position = {pos_formatted}",
                    "            stream.props = {",
                    "                media.class = \"Audio/Sink\"",
                    f"                node.name = {cls._spa_val(sink_id)}",
                    f"                node.description = {cls._spa_val(sink_name)}",
                    "                sess.sap.announce = true",
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

        # Virtual Sinks (Nodes created via adapter factory for local non-AES67 sinks)
        for sink in virtual_sinks:
            if sink.get("aes67_enabled", False):
                continue
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
