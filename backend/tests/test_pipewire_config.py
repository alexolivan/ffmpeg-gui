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
        self.assertIn('pipewire-0 = "unrestricted"', res)
        self.assertIn('{ name = "pipewire-0" }', res)
        self.assertIn('{ name = "pipewire-0-manager" }', res)
        self.assertIn("libpipewire-module-spa-node-factory", res)
        self.assertIn("libpipewire-module-client-node", res)
        self.assertIn("libpipewire-module-client-device", res)
        self.assertIn("libpipewire-module-session-manager", res)
        self.assertIn("libpipewire-module-link-factory", res)
        self.assertIn("libpipewire-module-adapter", res)
        self.assertIn("libpipewire-module-metadata", res)
        self.assertIn("libpipewire-module-protocol-pulse", res)
        self.assertIn(f'server.address = [ "unix:{runtime_dir}/pulse.sock" ]', res)

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

        self.assertIn('factory.name = "support.null-audio-sink"', res)
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
        """Checks libpipewire-module-rtp-sink, destination.ip, destination.port, sess.sap=true, net.ifname, sess.name."""
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
                }
            ]
        }
        res = PipeWireConfigGenerator.generate_config(7, config, "/tmp/pipewire-7")

        self.assertIn('name = "libpipewire-module-rtp-sink"', res)
        self.assertIn('source.ip = "192.168.1.50"', res)
        self.assertIn('destination.ip = "239.69.10.1"', res)
        self.assertIn('destination.port = 5004', res)
        self.assertIn('net.ifname = "eth0"', res)
        self.assertIn('sess.name = "PGM Stream"', res)
        self.assertIn('sess.sap = true', res)
        self.assertIn('matches = [ { "node.name" = "aes67_pgm" } ]', res)

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
        self.assertIn(r'sess.name = "SAP \"Studio A\" [Live]"', res)

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


if __name__ == "__main__":
    unittest.main()

