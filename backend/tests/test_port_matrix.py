import unittest
from unittest.mock import patch, MagicMock
import os
import sys

# Ensure backend directory is in sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from core.network_inspector import get_active_port_matrix, generate_firewall_rules
from fastapi.testclient import TestClient
from main import app


class TestPortMatrix(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.mock_db = MagicMock()

    def test_get_active_port_matrix_core_only(self):
        self.mock_db.query.return_value.all.return_value = []
        settings = {
            "bind_address": "0.0.0.0",
            "gui_port": 8000,
            "https_port": 8443,
            "ssl_enabled": False
        }

        matrix = get_active_port_matrix(self.mock_db, settings=settings)
        self.assertIsInstance(matrix, list)
        self.assertTrue(any(e["port"] == 8000 and e["proto"] == "tcp" and e["category"] == "core" for e in matrix))

        # Check fields of each entry
        for item in matrix:
            self.assertIn("port", item)
            self.assertIn("proto", item)
            self.assertIn("service_name", item)
            self.assertIn("category", item)
            self.assertIn("status", item)
            self.assertIn("is_socket_open", item)

    def test_get_active_port_matrix_with_services(self):
        mtx_service = MagicMock()
        mtx_service.id = 11
        mtx_service.name = "Studio Hub"
        mtx_service.service_type = "mediamtx_hub"
        mtx_service.status = "running"
        mtx_service.config = {
            "mediamtx_config": {
                "bind_address": "0.0.0.0",
                "rtmp_enabled": True,
                "rtmp_port": 1935,
                "rtsp_enabled": True,
                "rtsp_port": 8554,
                "srt_enabled": True,
                "srt_port": 8890,
                "hls_enabled": True,
                "hls_port": 8888,
                "webrtc_enabled": False
            }
        }

        ice_service = MagicMock()
        ice_service.id = 12
        ice_service.name = "Radio Icecast"
        ice_service.service_type = "icecast_server"
        ice_service.status = "stopped"
        ice_service.config = {
            "icecast_config": {
                "bind_address": "127.0.0.1",
                "port": 7000,
                "ssl_enabled": False
            }
        }

        self.mock_db.query.return_value.all.return_value = [mtx_service, ice_service]
        settings = {"bind_address": "0.0.0.0", "gui_port": 8000, "ssl_enabled": False}

        matrix = get_active_port_matrix(self.mock_db, settings=settings)

        # MediaMTX ports
        self.assertTrue(any(e["port"] == 1935 and e["proto"] == "tcp" and e["service_name"] == "Studio Hub" for e in matrix))
        self.assertTrue(any(e["port"] == 8890 and e["proto"] == "udp" and e["service_name"] == "Studio Hub" for e in matrix))

        # Icecast port
        self.assertTrue(any(e["port"] == 7000 and e["proto"] == "tcp" and e["service_name"] == "Radio Icecast" for e in matrix))

    def test_get_active_port_matrix_with_pipewire_hub(self):
        pw_service = MagicMock()
        pw_service.id = 15
        pw_service.name = "Master PipeWire Hub"
        pw_service.service_type = "pipewire_hub"
        pw_service.status = "running"
        pw_service.config = {
            "pipewire_config": {
                "aes67_network": {"enabled": True, "interface": "eth1", "ip": "192.168.99.15"},
                "virtual_sinks": [
                    {"id": "mix_bus", "name": "Main Mix", "aes67_enabled": True, "rtp_port": 5004, "multicast_ip": "239.69.15.1"}
                ],
                "remote_sinks": [
                    {"id": "studio_rx", "name": "Studio AES67 Rx", "rtp_port": 5006, "multicast_ip": "239.69.15.20"}
                ]
            }
        }

        stream_service = MagicMock()
        stream_service.id = 16
        stream_service.name = "Live SRT Ingest"
        stream_service.service_type = "ffmpeg_stream"
        stream_service.status = "running"
        stream_service.config = {}
        stream_service.input_config = {"input1": {"type": "srt", "mode": "listener", "port": "9100"}}
        stream_service.output_config = []

        self.mock_db.query.return_value.all.return_value = [pw_service, stream_service]
        settings = {"bind_address": "0.0.0.0", "gui_port": 8000, "ssl_enabled": False}

        matrix = get_active_port_matrix(self.mock_db, settings=settings)

        # PipeWire Remote Sink Rx (Inbound listening UDP socket)
        rx_entry = next((e for e in matrix if e["port"] == 5006 and e["service_name"] == "Master PipeWire Hub"), None)
        self.assertIsNotNone(rx_entry)
        self.assertEqual(rx_entry["proto"], "udp")
        self.assertTrue(rx_entry["requires_inbound_firewall"])
        self.assertEqual(rx_entry["bind_address"], "eth1")

        # PipeWire Virtual Sink Tx (Egress multicast)
        tx_entry = next((e for e in matrix if e["port"] == 5004 and e["service_name"] == "Master PipeWire Hub"), None)
        self.assertIsNotNone(tx_entry)
        self.assertEqual(tx_entry["proto"], "udp")
        self.assertFalse(tx_entry["requires_inbound_firewall"])

        # SAP Discovery & PTP Clock Sync
        self.assertTrue(any(e["port"] == 9875 and e["proto"] == "udp" and e["requires_inbound_firewall"] for e in matrix))
        self.assertTrue(any(e["port"] == 319 and e["proto"] == "udp" and e["requires_inbound_firewall"] for e in matrix))
        self.assertTrue(any(e["port"] == 320 and e["proto"] == "udp" and e["requires_inbound_firewall"] for e in matrix))

        # FFmpeg Stream SRT Ingest
        srt_entry = next((e for e in matrix if e["port"] == 9100 and e["service_name"] == "Live SRT Ingest"), None)
        self.assertIsNotNone(srt_entry)
        self.assertEqual(srt_entry["proto"], "udp")
        self.assertTrue(srt_entry["requires_inbound_firewall"])

        # Verify firewall generation for PipeWire and FFmpeg
        rules = generate_firewall_rules(matrix)
        ufw_rules = "\n".join(rules["ufw"])
        self.assertIn("ufw allow 5006/udp", ufw_rules)  # Rx
        self.assertNotIn("ufw allow 5004/udp", ufw_rules)  # Tx should NOT have inbound rule
        self.assertIn("ufw allow 9875/udp", ufw_rules)  # SAP
        self.assertIn("ufw allow 319/udp", ufw_rules)   # PTP Event
        self.assertIn("ufw allow 320/udp", ufw_rules)   # PTP General
        self.assertIn("ufw allow 9100/udp", ufw_rules)  # SRT Ingest

        iptables_rules = "\n".join(rules["iptables"])
        self.assertIn("-p udp --dport 5006 -j ACCEPT", iptables_rules)
        self.assertIn("-p udp --dport 9875 -j ACCEPT", iptables_rules)
        self.assertIn("-p udp --dport 319 -j ACCEPT", iptables_rules)

    def test_generate_firewall_rules(self):
        entries = [
            {"port": 8000, "proto": "tcp", "service_name": "ffmpeg-gui Web GUI", "category": "core", "requires_inbound_firewall": True},
            {"port": 8890, "proto": "udp", "service_name": "Studio Hub (SRT)", "category": "auxiliary", "requires_inbound_firewall": True},
            {"port": 6080, "proto": "tcp", "service_name": "Desktop noVNC", "bind_address": "127.0.0.1", "requires_inbound_firewall": False},
        ]

        rules = generate_firewall_rules(entries)
        self.assertIn("ufw", rules)
        self.assertIn("iptables", rules)

        ufw_rules = "\n".join(rules["ufw"])
        self.assertIn("ufw allow 8000/tcp", ufw_rules)
        self.assertIn("ufw allow 8890/udp", ufw_rules)
        self.assertNotIn("6080", ufw_rules)

        iptables_rules = "\n".join(rules["iptables"])
        self.assertIn("-p tcp --dport 8000 -j ACCEPT", iptables_rules)
        self.assertIn("-p udp --dport 8890 -j ACCEPT", iptables_rules)
        self.assertNotIn("6080", iptables_rules)

    def test_api_port_matrix_endpoint(self):
        res = self.client.get("/api/system/network/port-matrix")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("matrix", data)
        self.assertIn("firewall_rules", data)
        self.assertIn("ufw", data["firewall_rules"])
        self.assertIn("iptables", data["firewall_rules"])


if __name__ == "__main__":
    unittest.main()
