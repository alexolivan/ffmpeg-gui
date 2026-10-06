import unittest
import os
import sys
import socket
import subprocess
from collections import namedtuple
from unittest.mock import patch, MagicMock

# Ensure backend directory is in sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

try:
    import core.network_inspector as ni_module
    NI_TARGET = "core.network_inspector"
except ImportError:
    import backend.core.network_inspector as ni_module
    NI_TARGET = "backend.core.network_inspector"

try:
    from main import app, verify_token
except ImportError:
    from backend.main import app, verify_token

from fastapi.testclient import TestClient

SnicAddr = namedtuple('snicaddr', ['family', 'address', 'netmask', 'broadcast', 'ptp'])
SnicStats = namedtuple('snicstats', ['isup', 'duplex', 'speed', 'mtu', 'flags'])


class TestPipewireNetworkAudit(unittest.TestCase):

    def setUp(self):
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_network_audit_unauthorized(self):
        """Verifica que el endpoint rechaza peticiones no autorizadas cuando verify_token falla."""
        from fastapi import HTTPException
        def raise_unauthorized():
            raise HTTPException(status_code=401, detail="Unauthorized")

        app.dependency_overrides[verify_token] = raise_unauthorized
        res = self.client.get("/api/pipewire/network-audit")
        self.assertEqual(res.status_code, 401)

    @patch(f"{NI_TARGET}.psutil.process_iter")
    @patch(f"{NI_TARGET}.shutil.which")
    @patch(f"{NI_TARGET}.subprocess.run")
    @patch(f"{NI_TARGET}.psutil.net_if_stats")
    @patch(f"{NI_TARGET}.psutil.net_if_addrs")
    def test_network_audit_success_and_filtering(
        self,
        mock_addrs,
        mock_stats,
        mock_run,
        mock_which,
        mock_proc_iter
    ):
        """Verifica parsing de interfaces, exclusión de lo y caídas, y detección PTP."""
        app.dependency_overrides[verify_token] = lambda: "admin"

        mock_addrs.return_value = {
            "lo": [
                SnicAddr(family=socket.AF_INET, address="127.0.0.1", netmask="255.0.0.0", broadcast=None, ptp=None)
            ],
            "eth0": [
                SnicAddr(family=socket.AF_INET, address="192.168.1.50", netmask="255.255.255.0", broadcast="192.168.1.255", ptp=None),
                SnicAddr(family=getattr(socket, "AF_PACKET", 17), address="00:11:22:33:44:55", netmask=None, broadcast=None, ptp=None)
            ],
            "enp3s0": [
                SnicAddr(family=socket.AF_INET, address="10.0.0.100", netmask="255.255.255.0", broadcast="10.0.0.255", ptp=None)
            ],
            "down0": [
                SnicAddr(family=socket.AF_INET, address="172.16.0.10", netmask="255.255.0.0", broadcast=None, ptp=None)
            ]
        }

        mock_stats.return_value = {
            "lo": SnicStats(isup=True, duplex=0, speed=0, mtu=65536, flags="up,loopback,running"),
            "eth0": SnicStats(isup=True, duplex=2, speed=1000, mtu=1500, flags="up,broadcast,running"),
            "enp3s0": SnicStats(isup=True, duplex=2, speed=10000, mtu=1500, flags="up,broadcast,running"),
            "down0": SnicStats(isup=False, duplex=0, speed=0, mtu=1500, flags="down")
        }

        def mock_ethtool(cmd, capture_output=True, text=True, timeout=2.0):
            iface = cmd[2]
            res = MagicMock()
            res.returncode = 0
            if iface == "eth0":
                res.stdout = "Capabilities:\n\thardware-transmit\n\thardware-receive\n"
                res.stderr = ""
            else:
                res.stdout = "Capabilities:\n\tsoftware-transmit\n"
                res.stderr = ""
            return res

        mock_run.side_effect = mock_ethtool
        mock_which.side_effect = lambda binary: "/usr/sbin/ptp4l" if binary == "ptp4l" else None

        mock_proc = MagicMock()
        mock_proc.info = {"name": "ptp4l"}
        mock_proc_iter.return_value = [mock_proc]

        res = self.client.get("/api/pipewire/network-audit")
        self.assertEqual(res.status_code, 200)
        data = res.json()

        # Interfaces: "lo" y "down0" deben estar excluidas
        iface_names = [iface["name"] for iface in data["interfaces"]]
        self.assertNotIn("lo", iface_names)
        self.assertNotIn("down0", iface_names)
        self.assertIn("eth0", iface_names)
        self.assertIn("enp3s0", iface_names)

        eth0_data = next(i for i in data["interfaces"] if i["name"] == "eth0")
        self.assertEqual(eth0_data["ip"], "192.168.1.50")
        self.assertTrue(eth0_data["is_up"])
        self.assertEqual(eth0_data["speed"], 1000)
        self.assertTrue(eth0_data["ptp_hardware_capable"])

        enp_data = next(i for i in data["interfaces"] if i["name"] == "enp3s0")
        self.assertEqual(enp_data["ip"], "10.0.0.100")
        self.assertTrue(enp_data["is_up"])
        self.assertEqual(enp_data["speed"], 10000)
        self.assertFalse(enp_data["ptp_hardware_capable"])

        # Host PTP
        self.assertTrue(data["host_ptp"]["ptp4l_installed"])
        self.assertTrue(data["host_ptp"]["ptp4l_running"])

    @patch(f"{NI_TARGET}.psutil.process_iter")
    @patch(f"{NI_TARGET}.shutil.which")
    @patch(f"{NI_TARGET}.subprocess.run")
    @patch(f"{NI_TARGET}.psutil.net_if_stats")
    @patch(f"{NI_TARGET}.psutil.net_if_addrs")
    def test_ptp_sof_timestamping_fallback(
        self,
        mock_addrs,
        mock_stats,
        mock_run,
        mock_which,
        mock_proc_iter
    ):
        """Verifica detección de hardware PTP con SOF_TIMESTAMPING_TX_HARDWARE."""
        app.dependency_overrides[verify_token] = lambda: "admin"

        mock_addrs.return_value = {
            "eth0": [SnicAddr(family=socket.AF_INET, address="192.168.1.50", netmask=None, broadcast=None, ptp=None)]
        }
        mock_stats.return_value = {
            "eth0": SnicStats(isup=True, duplex=2, speed=1000, mtu=1500, flags="up")
        }

        mock_res = MagicMock()
        mock_res.returncode = 0
        mock_res.stdout = "Capabilities:\n\tSOF_TIMESTAMPING_TX_HARDWARE\n"
        mock_res.stderr = ""
        mock_run.return_value = mock_res
        mock_which.return_value = None
        mock_proc_iter.return_value = []

        res = self.client.get("/api/pipewire/network-audit")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["interfaces"][0]["ptp_hardware_capable"])
        self.assertFalse(data["host_ptp"]["ptp4l_installed"])
        self.assertFalse(data["host_ptp"]["ptp4l_running"])

    @patch(f"{NI_TARGET}.psutil.process_iter")
    @patch(f"{NI_TARGET}.shutil.which")
    @patch(f"{NI_TARGET}.subprocess.run")
    @patch(f"{NI_TARGET}.psutil.net_if_stats")
    @patch(f"{NI_TARGET}.psutil.net_if_addrs")
    def test_ethtool_missing_or_error_fallback(
        self,
        mock_addrs,
        mock_stats,
        mock_run,
        mock_which,
        mock_proc_iter
    ):
        """Verifica manejo elegante cuando ethtool no está instalado o lanza PermissionError."""
        app.dependency_overrides[verify_token] = lambda: "admin"

        mock_addrs.return_value = {
            "eth0": [SnicAddr(family=socket.AF_INET, address="192.168.1.50", netmask=None, broadcast=None, ptp=None)],
            "eth1": [SnicAddr(family=socket.AF_INET, address="192.168.1.51", netmask=None, broadcast=None, ptp=None)]
        }
        mock_stats.return_value = {
            "eth0": SnicStats(isup=True, duplex=2, speed=1000, mtu=1500, flags="up"),
            "eth1": SnicStats(isup=True, duplex=2, speed=1000, mtu=1500, flags="up")
        }

        def mock_ethtool_error(cmd, capture_output=True, text=True, timeout=2.0):
            if cmd[2] == "eth0":
                raise FileNotFoundError("ethtool not found")
            raise PermissionError("Operation not permitted")

        mock_run.side_effect = mock_ethtool_error
        mock_which.return_value = None
        mock_proc_iter.return_value = []

        res = self.client.get("/api/pipewire/network-audit")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(len(data["interfaces"]), 2)
        self.assertFalse(data["interfaces"][0]["ptp_hardware_capable"])
        self.assertFalse(data["interfaces"][1]["ptp_hardware_capable"])

    @patch(f"{NI_TARGET}.psutil.process_iter")
    @patch(f"{NI_TARGET}.shutil.which")
    @patch(f"{NI_TARGET}.subprocess.run")
    @patch(f"{NI_TARGET}.psutil.net_if_stats")
    @patch(f"{NI_TARGET}.psutil.net_if_addrs")
    def test_ethtool_timeout_expired_fallback(
        self,
        mock_addrs,
        mock_stats,
        mock_run,
        mock_which,
        mock_proc_iter
    ):
        """Verifica que subprocess.TimeoutExpired se maneja con gracia dejando ptp_hardware_capable en False."""
        app.dependency_overrides[verify_token] = lambda: "admin"

        mock_addrs.return_value = {
            "eth0": [SnicAddr(family=socket.AF_INET, address="192.168.1.50", netmask=None, broadcast=None, ptp=None)]
        }
        mock_stats.return_value = {
            "eth0": SnicStats(isup=True, duplex=2, speed=1000, mtu=1500, flags="up")
        }

        mock_run.side_effect = subprocess.TimeoutExpired(cmd=["ethtool", "-T", "eth0"], timeout=2.0)
        mock_which.return_value = None
        mock_proc_iter.return_value = []

        res = self.client.get("/api/pipewire/network-audit")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(len(data["interfaces"]), 1)
        self.assertFalse(data["interfaces"][0]["ptp_hardware_capable"])

    @patch(f"{NI_TARGET}.psutil.process_iter")
    @patch(f"{NI_TARGET}.shutil.which")
    @patch(f"{NI_TARGET}.subprocess.run")
    @patch(f"{NI_TARGET}.psutil.net_if_stats")
    @patch(f"{NI_TARGET}.psutil.net_if_addrs")
    def test_interface_without_ipv4(
        self,
        mock_addrs,
        mock_stats,
        mock_run,
        mock_which,
        mock_proc_iter
    ):
        """Verifica que una interfaz sin dirección IPv4 devuelva ip=None."""
        app.dependency_overrides[verify_token] = lambda: "admin"

        mock_addrs.return_value = {
            "eth0": [
                SnicAddr(family=getattr(socket, "AF_INET6", 10), address="fe80::1", netmask=None, broadcast=None, ptp=None)
            ]
        }
        mock_stats.return_value = {
            "eth0": SnicStats(isup=True, duplex=2, speed=1000, mtu=1500, flags="up")
        }
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        mock_which.return_value = None
        mock_proc_iter.return_value = []

        res = self.client.get("/api/pipewire/network-audit")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(len(data["interfaces"]), 1)
        self.assertIsNone(data["interfaces"][0]["ip"])


if __name__ == "__main__":
    unittest.main()
