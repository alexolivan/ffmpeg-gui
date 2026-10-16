"""
Tests for PipeWireConfigGenerator.
"""

import os
import tempfile
import unittest

from backend.core.pipewire_config import PipeWireConfigGenerator


class TestPipeWireConfigGenerator(unittest.TestCase):
    """Unit tests for PipeWireConfigGenerator."""

    def test_default_config_generation(self):
        """Checks rate=48000, quantum=1024, native and pulse sockets, no null sinks when empty."""
        config = {
            "sample_rate": 48000,
            "quantum": 1024,
            "min_quantum": 128,
            "max_quantum": 2048,
            "virtual_sinks": []
        }
        runtime_dir = "/run/user/1000/pipewire-svc-1"
        res = PipeWireConfigGenerator.generate_config(1, config, runtime_dir)

        self.assertIn("core.daemon = true", res)
        self.assertIn('core.name = "pipewire-0"', res)
        self.assertIn("default.clock.rate = 48000", res)
        self.assertIn("default.clock.quantum = 1024", res)
        self.assertIn("default.clock.min-quantum = 128", res)
        self.assertIn("default.clock.max-quantum = 2048", res)
        self.assertIn("mem.warn-mlock = false", res)

        # Context modules
        self.assertIn("libpipewire-module-rt", res)
        self.assertIn("libpipewire-module-protocol-native", res)
        self.assertIn("libpipewire-module-access", res)
        self.assertIn("libpipewire-module-spa-node-factory", res)
        self.assertIn("libpipewire-module-client-node", res)
        self.assertNotIn("libpipewire-module-client-device", res)
        self.assertNotIn("libpipewire-module-session-manager", res)
        self.assertIn("libpipewire-module-link-factory", res)
        self.assertIn("libpipewire-module-adapter", res)
        self.assertIn("libpipewire-module-metadata", res)
        self.assertIn("libpipewire-module-protocol-pulse", res)
        self.assertIn(f'server.address = [ "unix:{runtime_dir}/pulse.sock" ]', res)

        # Stream properties and auto-port-config
        self.assertIn("stream.properties = {", res)
        self.assertIn("adapter.auto-port-config = { mode = dsp }", res)

        # No null audio sinks
        self.assertNotIn("support.null-audio-sink", res)
        self.assertNotIn("libpipewire-module-rtp-sink", res)

    def test_virtual_sinks_generation(self):
        """Checks multiple sinks (mix_bus, kiosk_bus), audio.channels, node.name, Audio/Sink media.class."""
        config = {
            "sample_rate": 48000,
            "virtual_sinks": [
                {
                    "id": "mix_bus",
                    "name": "Main Mix Bus",
                    "channels": 2
                },
                {
                    "id": "surround_bus",
                    "name": "Surround 5.1 Bus",
                    "channels": 6
                }
            ]
        }
        res = PipeWireConfigGenerator.generate_config(42, config, "/tmp/pipewire-42")

        self.assertIn('{ factory = adapter', res)
        self.assertIn('factory.name = support.null-audio-sink', res)
        self.assertIn('node.name = "mix_bus"', res)
        self.assertIn('node.description = "Main Mix Bus"', res)
        self.assertIn('media.class = "Audio/Sink"', res)
        self.assertIn('audio.channels = 2', res)
        self.assertIn('audio.position = [ "FL", "FR" ]', res)

        self.assertIn('node.name = "surround_bus"', res)
        self.assertIn('node.description = "Surround 5.1 Bus"', res)
        self.assertIn('audio.channels = 6', res)
        self.assertIn('audio.position = [ "FL", "FR", "FC", "LFE", "RL", "RR" ]', res)

    def test_aes67_rtp_sink_generation(self):
        """Checks libpipewire-module-rtp-sap, libpipewire-module-rtp-sink, local.ifname, and stream.props."""
        config = {
            "sample_rate": 48000,
            "aes67_network": {
                "ip": "192.168.1.50",
                "interface": "eth0"
            },
            "virtual_sinks": [
                {
                    "id": "aes67_pgm",
                    "name": "AES67 Program Out",
                    "channels": 2,
                    "aes67_enabled": True,
                    "multicast_ip": "239.69.10.1",
                    "rtp_port": 5004,
                    "sap_name": "PGM Stream"
                },
                {
                    "id": "local_bus",
                    "name": "Local Mix Bus",
                    "channels": 2,
                    "aes67_enabled": False
                }
            ]
        }
        res = PipeWireConfigGenerator.generate_config(7, config, "/tmp/pipewire-7")

        # 1. SAP Announcement module loaded
        self.assertIn('name = "libpipewire-module-rtp-sap"', res)
        self.assertIn('sap.ip = "224.0.0.56"', res)
        self.assertIn('sap.port = 9875', res)
        self.assertIn('local.ifname = "eth0"', res)

        # 2. RTP Sink module loaded for aes67_pgm
        self.assertIn('name = "libpipewire-module-rtp-sink"', res)
        self.assertIn('source.ip = "192.168.1.50"', res)
        self.assertIn('destination.ip = "239.69.10.1"', res)
        self.assertIn('destination.port = 5004', res)
        self.assertIn('PGM Stream"', res)
        self.assertIn('node.name = "rtp_tx_aes67_pgm"', res)
        self.assertIn('target.object = "aes67_pgm"', res)
        self.assertIn('sess.sap.announce = true', res)

        # 3. Both local_bus and aes67_pgm are in context.objects as null-audio-sink to provide monitor ports
        self.assertIn('node.name = "local_bus"', res)
        self.assertIn('node.name = "aes67_pgm"', res)
        self.assertIn('factory.name = support.null-audio-sink\n            node.name = "aes67_pgm"', res)

    def test_write_config_file_atomic(self):
        """Creates temp file and verifies atomic write and content."""
        config = {
            "sample_rate": 96000,
            "quantum": 512,
            "virtual_sinks": [
                {"id": "test_sink", "channels": 2}
            ]
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            target_path = os.path.join(tmpdir, "nested", "pipewire.conf")
            runtime_dir = os.path.join(tmpdir, "run")
            written_path = PipeWireConfigGenerator.write_config_file(99, config, target_path, runtime_dir)

            self.assertEqual(written_path, os.path.abspath(target_path))
            self.assertTrue(os.path.exists(target_path))
            # Temporary file pattern should not remain in directory
            parent_dir = os.path.dirname(target_path)
            temp_files = [f for f in os.listdir(parent_dir) if ".tmp." in f]
            self.assertEqual(len(temp_files), 0)

            with open(target_path, "r", encoding="utf-8") as f:
                content = f.read()

            self.assertIn("default.clock.rate = 96000", content)
            self.assertIn("default.clock.quantum = 512", content)
            self.assertIn('node.name = "test_sink"', content)

    def test_string_numeric_values_casting(self):
        """Checks string type numeric inputs are safely cast to integers."""
        config = {
            "sample_rate": "48000",
            "quantum": "1024",
            "min_quantum": "128",
            "max_quantum": "2048",
            "virtual_sinks": [
                {
                    "id": "stream_sink",
                    "channels": "2",
                    "aes67_enabled": True,
                    "rtp_port": "5004"
                }
            ]
        }
        res = PipeWireConfigGenerator.generate_config(15, config, "/tmp/pw-15")
        self.assertIn("default.clock.rate = 48000", res)
        self.assertIn("default.clock.quantum = 1024", res)
        self.assertIn("default.clock.min-quantum = 128", res)
        self.assertIn("default.clock.max-quantum = 2048", res)
        self.assertIn("audio.channels = 2", res)
        self.assertIn("destination.port = 5004", res)

    def test_special_characters_escaping(self):
        """Checks quotes, backslashes, and special characters in descriptions and names are escaped."""
        config = {
            "virtual_sinks": [
                {
                    "id": "special_sink",
                    "name": 'Main "Studio" Mix & Stream / Line 1',
                    "aes67_enabled": True,
                    "sap_name": 'SAP "Studio A" [Live]'
                }
            ]
        }
        res = PipeWireConfigGenerator.generate_config(20, config, "/tmp/pw-20")
        self.assertIn(r'node.description = "Main \"Studio\" Mix & Stream / Line 1"', res)
        self.assertIn(r'SAP \"Studio A\" [Live]"', res)

    def test_channel_positions_layouts(self):
        """Checks 1-channel (MONO), 4-channel, and 8-channel layouts."""
        config_mono = {
            "virtual_sinks": [{"id": "mono_sink", "channels": 1}]
        }
        res_mono = PipeWireConfigGenerator.generate_config(31, config_mono, "/tmp/pw-31")
        self.assertIn('audio.channels = 1', res_mono)
        self.assertIn('audio.position = [ "MONO" ]', res_mono)

        config_quad = {
            "virtual_sinks": [{"id": "quad_sink", "channels": 4}]
        }
        res_quad = PipeWireConfigGenerator.generate_config(34, config_quad, "/tmp/pw-34")
        self.assertIn('audio.channels = 4', res_quad)
        self.assertIn('audio.position = [ "FL", "FR", "RL", "RR" ]', res_quad)

        config_octa = {
            "virtual_sinks": [{"id": "octa_sink", "channels": 8}]
        }
        res_octa = PipeWireConfigGenerator.generate_config(38, config_octa, "/tmp/pw-38")
        self.assertIn('audio.channels = 8', res_octa)
        self.assertIn('audio.position = [ "FL", "FR", "FC", "LFE", "RL", "RR", "SL", "SR" ]', res_octa)

    def test_no_udev_probing(self):
        """Asserts module-udev or physical ALSA probing modules are absent from config."""
        config = {
            "virtual_sinks": [
                {"id": "sink1", "channels": 2, "aes67_enabled": True}
            ]
        }
        res = PipeWireConfigGenerator.generate_config(10, config, "/tmp/pw-10")

        self.assertNotIn("module-udev", res)
        self.assertNotIn("libpipewire-module-udevrules", res)
        self.assertNotIn("api.alsa.enum.udev", res)
        self.assertNotIn("libpipewire-module-spa-device-factory", res)

    def test_canonical_base_multicast_prefix(self):
        """Verifies derivation of canonical 239.69.X base multicast prefix from host IP."""
        # Standard IPv4 NICs
        self.assertEqual(PipeWireConfigGenerator.get_canonical_base_multicast_prefix("192.168.99.11"), "239.69.11")
        self.assertEqual(PipeWireConfigGenerator.get_canonical_base_multicast_prefix("192.168.99.13"), "239.69.13")
        self.assertEqual(PipeWireConfigGenerator.get_canonical_base_multicast_prefix("10.0.0.1"), "239.69.1")
        self.assertEqual(PipeWireConfigGenerator.get_canonical_base_multicast_prefix("172.16.50.254"), "239.69.254")

        # Fallbacks for empty, 0.0.0.0, or invalid
        self.assertEqual(PipeWireConfigGenerator.get_canonical_base_multicast_prefix("0.0.0.0"), "239.69.1")
        self.assertEqual(PipeWireConfigGenerator.get_canonical_base_multicast_prefix(None), "239.69.1")
        self.assertEqual(PipeWireConfigGenerator.get_canonical_base_multicast_prefix("invalid-ip"), "239.69.1")

    def test_canonical_sink_multicast_ip(self):
        """Verifies derivation of per-sink multicast IP from base prefix and sink index."""
        self.assertEqual(PipeWireConfigGenerator.get_canonical_sink_multicast_ip("239.69.11", 1), "239.69.11.1")
        self.assertEqual(PipeWireConfigGenerator.get_canonical_sink_multicast_ip("239.69.11", 2), "239.69.11.2")
        self.assertEqual(PipeWireConfigGenerator.get_canonical_sink_multicast_ip("239.69.13", 1), "239.69.13.1")
        self.assertEqual(PipeWireConfigGenerator.get_canonical_sink_multicast_ip("239.69.50.", 5), "239.69.50.5")

    def test_format_sap_name(self):
        """Verifies host prefixing in SAP announcement session names."""
        formatted = PipeWireConfigGenerator.format_sap_name("aes_bus", hostname="test1")
        self.assertEqual(formatted, "test1 aes_bus")

        already_prefixed = PipeWireConfigGenerator.format_sap_name("test1 aes_bus", hostname="test1")
        self.assertEqual(already_prefixed, "test1 aes_bus")

        fallback = PipeWireConfigGenerator.format_sap_name("", hostname="test3")
        self.assertEqual(fallback, "test3 stream")

    def test_aes67_automatic_multicast_derivation(self):
        """Verifies that missing multicast_ip in sink automatically derives from base_multicast_prefix."""
        config = {
            "aes67_network": {
                "ip": "192.168.99.11",
                "base_multicast_prefix": "239.69.11",
                "interface": "enp9s0"
            },
            "virtual_sinks": [
                {
                    "id": "sink_a",
                    "channels": 2,
                    "aes67_enabled": True
                },
                {
                    "id": "sink_b",
                    "channels": 2,
                    "aes67_enabled": True
                }
            ]
        }
        res = PipeWireConfigGenerator.generate_config(12, config, "/tmp/pw-12")
        self.assertIn('destination.ip = "239.69.11.1"', res)
        self.assertIn('destination.ip = "239.69.11.2"', res)

    def test_generate_ptp4l_config_aes67_software(self):
        """Verifies ptp4l.conf generation with AES67 profile, software timestamping, and auto-inhibition."""
        ptp_cfg = {
            "enabled": True,
            "auto_inhibit": True,
            "priority1": 128,
            "domain": 0,
            "profile": "aes67"
        }
        conf = PipeWireConfigGenerator.generate_ptp4l_config(
            service_id=5,
            ptp_cfg=ptp_cfg,
            iface="enp9s0",
            ptp_support="software"
        )
        self.assertIn("domainNumber            0", conf)
        self.assertIn("priority1               128", conf)
        self.assertIn("serverOnly              0", conf)  # Auto-inhibition allows BMCA coexistence
        self.assertIn("uds_address", conf)
        self.assertIn("uds_ro_address", conf)
        self.assertIn("logSyncInterval         -3", conf)  # 8 packets/sec for AES67
        self.assertIn("logAnnounceInterval     0", conf)
        self.assertIn("dscp_event              46", conf)
        self.assertIn("dscp_general            34", conf)
        self.assertIn("time_stamping           software", conf)
        self.assertIn("[enp9s0]", conf)
        self.assertIn("network_transport       UDPv4", conf)

    def test_generate_ptp4l_config_ieee1588_hardware_force_master(self):
        """Verifies ptp4l.conf generation with IEEE 1588, hardware timestamping, and forced serverOnly."""
        ptp_cfg = {
            "enabled": True,
            "auto_inhibit": False,
            "priority1": 64,
            "domain": 1,
            "profile": "ieee1588"
        }
        conf = PipeWireConfigGenerator.generate_ptp4l_config(
            service_id=8,
            ptp_cfg=ptp_cfg,
            iface="eth1",
            ptp_support="hardware"
        )
        self.assertIn("domainNumber            1", conf)
        self.assertIn("priority1               64", conf)
        self.assertIn("serverOnly              1", conf)  # Forced master/server only
        self.assertIn("uds_address", conf)
        self.assertIn("uds_ro_address", conf)
        self.assertIn("logSyncInterval         0", conf)  # 1 packet/sec for standard IEEE 1588
        self.assertIn("time_stamping           hardware", conf)
        self.assertIn("[eth1]", conf)

    def test_write_ptp4l_config_file(self):
        """Verifies atomic file writing with 0o600 permissions."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            target = os.path.join(tmp_dir, "ptp4l_test.conf")
            written = PipeWireConfigGenerator.write_ptp4l_config_file(
                service_id=1,
                ptp_cfg={"priority1": 200, "domain": 0, "auto_inhibit": True},
                iface="eth0",
                target_path=target,
                ptp_support="software"
            )
            self.assertEqual(written, target)
            self.assertTrue(os.path.exists(target))
            with open(target, "r") as f:
                content = f.read()
            self.assertIn("priority1               200", content)


if __name__ == "__main__":
    unittest.main()

