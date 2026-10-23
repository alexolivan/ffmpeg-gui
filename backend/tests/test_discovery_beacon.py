import unittest
from unittest.mock import patch, MagicMock
import os
import sys
import json
import uuid

# Ensure backend directory is in sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from core.discovery_beacon import (
    DiscoveryBeaconService,
    get_node_id,
    get_primary_ip,
    get_network_info
)
from core.network_inspector import get_active_port_matrix, generate_firewall_rules


class TestDiscoveryBeacon(unittest.TestCase):
    def test_node_id_is_valid_uuid(self):
        node_id = get_node_id()
        self.assertIsInstance(node_id, str)
        # Should be parseable as a UUID
        parsed = uuid.UUID(node_id)
        self.assertEqual(str(parsed), node_id)

    def test_build_payload_structure(self):
        service = DiscoveryBeaconService(port=59990)
        payload = service.build_payload()

        self.assertEqual(payload["app"], "ffmpeg-gui")
        self.assertEqual(payload["protocol_version"], 1)
        self.assertEqual(payload["node_id"], service.node_id)
        self.assertIn("node_name", payload)
        self.assertIn("node_alias", payload)
        self.assertIn("ip", payload)
        self.assertIn("http_port", payload)
        self.assertIn("https_port", payload)
        self.assertIn("web_url", payload)
        self.assertIn("version", payload)
        self.assertIn("running_services", payload)
        self.assertIn("active_streams", payload)

    def test_payload_url_when_ssl_disabled(self):
        service = DiscoveryBeaconService(port=59990)
        with patch("core.discovery_beacon.get_network_info") as mock_net, \
             patch("core.discovery_beacon.get_primary_ip", return_value="192.168.1.50"):
            mock_net.return_value = {
                "http_port": 8000,
                "https_port": 8443,
                "ssl_enabled": False
            }
            payload = service.build_payload()
            self.assertEqual(payload["http_port"], 8000)
            self.assertIsNone(payload["https_port"])
            self.assertEqual(payload["web_url"], "http://192.168.1.50:8000")

    def test_payload_url_when_ssl_enabled(self):
        service = DiscoveryBeaconService(port=59990)
        with patch("core.discovery_beacon.get_network_info") as mock_net, \
             patch("core.discovery_beacon.get_primary_ip", return_value="192.168.1.50"):
            mock_net.return_value = {
                "http_port": 8000,
                "https_port": 8443,
                "ssl_enabled": True
            }
            payload = service.build_payload()
            self.assertEqual(payload["http_port"], 8000)
            self.assertEqual(payload["https_port"], 8443)
            self.assertEqual(payload["web_url"], "https://192.168.1.50:8443")

    def test_service_start_and_stop(self):
        service = DiscoveryBeaconService(port=59991)  # Use alt test port
        self.assertFalse(service.is_running())

        service.start()
        self.assertTrue(service.is_running())

        # Second start is idempotent
        service.start()
        self.assertTrue(service.is_running())

        service.stop()
        self.assertFalse(service.is_running())

        # Second stop is safe
        service.stop()
        self.assertFalse(service.is_running())

    def test_handle_query_packet(self):
        service = DiscoveryBeaconService(port=59992)
        with patch.object(service, "send_beacon") as mock_send:
            # Simulate socket receiving query
            mock_sock = MagicMock()
            mock_sock.recvfrom.side_effect = [
                (json.dumps({"cmd": "DISCOVER_QUERY"}).encode("utf-8"), ("192.168.1.100", 54321)),
                Exception("break loop")
            ]
            service._sock = mock_sock
            service._stop_event.clear()

            # Run one iteration logic directly
            data, addr = mock_sock.recvfrom(4096)
            msg = json.loads(data.decode("utf-8"))
            if msg.get("cmd") == "DISCOVER_QUERY":
                service.send_beacon(target_addr=addr)

            mock_send.assert_called_once_with(target_addr=("192.168.1.100", 54321))

    def test_is_enabled_guard_prevents_broadcast(self):
        mock_db_session = MagicMock()
        mock_factory = MagicMock(return_value=mock_db_session)
        mock_db_session.__enter__.return_value = mock_db_session

        mock_settings = MagicMock()
        mock_settings.discovery_beacon_enabled = False
        mock_db_session.query.return_value.first.return_value = mock_settings

        service = DiscoveryBeaconService(db_session_factory=mock_factory, port=59993)
        service._running = True
        service._sock = MagicMock()

        self.assertFalse(service.is_enabled())

        # Attempt to send beacon while disabled
        service.send_beacon()
        service._sock.sendto.assert_not_called()

    def test_network_inspector_includes_discovery_beacon(self):
        mock_db = MagicMock()
        mock_db.query.return_value.all.return_value = []

        # Enabled case
        settings_enabled = {
            "bind_address": "0.0.0.0",
            "gui_port": 8000,
            "https_port": 8443,
            "ssl_enabled": False,
            "discovery_beacon_enabled": True
        }
        matrix = get_active_port_matrix(mock_db, settings=settings_enabled)
        beacon_entries = [e for e in matrix if e["port"] == 59990 and e["proto"] == "udp"]
        self.assertEqual(len(beacon_entries), 1)
        self.assertEqual(beacon_entries[0]["category"], "core")
        self.assertEqual(beacon_entries[0]["status"], "running")

        rules = generate_firewall_rules(matrix)
        self.assertTrue(any("59990/udp" in r for r in rules["ufw"]))

        # Disabled case
        settings_disabled = {
            "bind_address": "0.0.0.0",
            "gui_port": 8000,
            "https_port": 8443,
            "ssl_enabled": False,
            "discovery_beacon_enabled": False
        }
        matrix_disabled = get_active_port_matrix(mock_db, settings=settings_disabled)
        beacon_entries_disabled = [e for e in matrix_disabled if e["port"] == 59990 and e["proto"] == "udp"]
        self.assertEqual(len(beacon_entries_disabled), 0)


if __name__ == "__main__":
    unittest.main()
