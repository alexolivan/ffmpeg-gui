import unittest
from unittest.mock import patch, MagicMock
import os
import sys
import socket

# Ensure backend directory is in sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from core.network_inspector import get_network_interfaces, resolve_bind_address
from fastapi.testclient import TestClient
from main import app


class TestNetworkInterfaces(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_get_network_interfaces_structure(self):
        interfaces = get_network_interfaces()
        self.assertIsInstance(interfaces, list)
        self.assertTrue(len(interfaces) > 0, "Should detect at least one network interface (e.g. lo)")

        # Verify loopback interface presence
        lo = next((i for i in interfaces if i.get("is_loopback")), None)
        self.assertIsNotNone(lo, "Loopback interface should be detected")
        self.assertEqual(lo["name"], "lo")
        self.assertTrue(any(addr["address"] == "127.0.0.1" for addr in lo["ipv4_addresses"]))

        # Verify schema of each interface
        for iface in interfaces:
            self.assertIn("name", iface)
            self.assertIn("is_up", iface)
            self.assertIn("speed", iface)
            self.assertIn("mac", iface)
            self.assertIn("ipv4_addresses", iface)
            self.assertIn("ipv6_addresses", iface)
            self.assertIn("is_loopback", iface)

    def test_resolve_bind_address_standard(self):
        # 0.0.0.0 and 127.0.0.1 are always valid
        host, fell_back, reason = resolve_bind_address("0.0.0.0")
        self.assertEqual(host, "0.0.0.0")
        self.assertFalse(fell_back)
        self.assertIsNone(reason)

        host, fell_back, reason = resolve_bind_address("127.0.0.1")
        self.assertEqual(host, "127.0.0.1")
        self.assertFalse(fell_back)
        self.assertIsNone(reason)

    def test_resolve_bind_address_missing_ip_failsafe(self):
        # An IP that does not exist on this machine should trigger fallback to 0.0.0.0
        missing_ip = "198.51.100.254" # RFC 5737 TEST-NET-2
        host, fell_back, reason = resolve_bind_address(missing_ip)
        self.assertEqual(host, "0.0.0.0")
        self.assertTrue(fell_back)
        self.assertIn("not assigned to any active interface", reason)

    @patch("core.network_inspector.psutil.net_if_addrs")
    @patch("core.network_inspector.psutil.net_if_stats")
    def test_resolve_bind_address_by_interface_name(self, mock_stats, mock_addrs):
        snic = MagicMock()
        snic.family = socket.AF_INET
        snic.address = "192.168.10.45"
        snic.netmask = "255.255.255.0"
        snic.broadcast = "192.168.10.255"

        mock_addrs.return_value = {"eth1": [snic]}

        stat = MagicMock()
        stat.isup = True
        stat.speed = 1000
        mock_stats.return_value = {"eth1": stat}

        # Interface name resolution
        host, fell_back, reason = resolve_bind_address("eth1")
        self.assertEqual(host, "192.168.10.45")
        self.assertFalse(fell_back)

    @patch("core.network_inspector.psutil.net_if_addrs")
    @patch("core.network_inspector.psutil.net_if_stats")
    def test_resolve_bind_address_interface_down(self, mock_stats, mock_addrs):
        snic = MagicMock()
        snic.family = socket.AF_INET
        snic.address = "192.168.10.45"
        snic.netmask = "255.255.255.0"
        snic.broadcast = "192.168.10.255"

        mock_addrs.return_value = {"eth1": [snic]}

        stat = MagicMock()
        stat.isup = False  # Interface is DOWN
        stat.speed = 0
        mock_stats.return_value = {"eth1": stat}

        host, fell_back, reason = resolve_bind_address("eth1")
        self.assertEqual(host, "0.0.0.0")
        self.assertTrue(fell_back)
        self.assertIn("DOWN", reason)

    def test_api_system_network_interfaces_endpoint(self):
        res = self.client.get("/api/system/network/interfaces")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("interfaces", data)
        self.assertIsInstance(data["interfaces"], list)
        self.assertTrue(len(data["interfaces"]) > 0)


if __name__ == "__main__":
    unittest.main()
