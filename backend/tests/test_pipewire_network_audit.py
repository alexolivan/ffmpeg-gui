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

    def test_validate_multicast_route_valid_and_ranges(self):
        """Verifica validación sintáctica, rango AoIP estándar y detección de rangos de control."""
        app.dependency_overrides[verify_token] = lambda: "admin"

        # 1. Valid AoIP stream
        res1 = self.client.post("/api/pipewire/validate-multicast", json={
            "multicast_ip": "239.69.11.1",
            "rtp_port": 5004
        })
        self.assertEqual(res1.status_code, 200)
        d1 = res1.json()
        self.assertTrue(d1["valid"])
        self.assertTrue(d1["in_aes67_range"])
        self.assertFalse(d1["is_reserved"])
        self.assertFalse(d1["collision"])

        # 2. Reserved control range 224.0.0.X (e.g. SAP announcement address 224.0.0.56)
        res2 = self.client.post("/api/pipewire/validate-multicast", json={
            "multicast_ip": "224.0.0.56",
            "rtp_port": 9875
        })
        self.assertEqual(res2.status_code, 200)
        d2 = res2.json()
        self.assertFalse(d2["valid"])
        self.assertTrue(d2["is_reserved"])
        self.assertIn("reserved", d2["message"].lower())

        # 3. Not multicast
        res3 = self.client.post("/api/pipewire/validate-multicast", json={
            "multicast_ip": "192.168.1.100",
            "rtp_port": 5004
        })
        self.assertEqual(res3.status_code, 200)
        d3 = res3.json()
        self.assertFalse(d3["valid"])
        self.assertIn("multicast range", d3["message"].lower())

    def test_validate_multicast_route_collision_detection(self):
        """Verifica detección de colisiones contra servicios de la base de datos."""
        app.dependency_overrides[verify_token] = lambda: "admin"

        from database.db import SessionLocal
        from database.models import Service

        with SessionLocal() as db:
            # Crear un servicio pipewire con un sink AES67 en 239.69.55.1:5004
            svc = Service(
                name="Existing AES67 Hub",
                service_type="pipewire_hub",
                status="stopped",
                config={
                    "virtual_sinks": [
                        {
                            "id": "sink_active",
                            "name": "Active Stream",
                            "aes67_enabled": True,
                            "multicast_ip": "239.69.55.1",
                            "rtp_port": 5004
                        }
                    ]
                }
            )
            db.add(svc)
            db.commit()
            db.refresh(svc)
            svc_id = svc.id

        try:
            # Intentar usar la misma IP y puerto desde otro servicio -> colisión
            res_coll = self.client.post("/api/pipewire/validate-multicast", json={
                "service_id": svc_id + 999,
                "sink_id": "other_sink",
                "multicast_ip": "239.69.55.1",
                "rtp_port": 5004
            })
            self.assertEqual(res_coll.status_code, 200)
            d_coll = res_coll.json()
            self.assertFalse(d_coll["valid"])
            self.assertTrue(d_coll["collision"])
            self.assertIn("Collides with service 'Existing AES67 Hub'", d_coll["message"])

            # Misma IP pero diferente puerto -> válido pero con aviso de IGMP snooping
            res_advisory = self.client.post("/api/pipewire/validate-multicast", json={
                "service_id": svc_id + 999,
                "sink_id": "other_sink",
                "multicast_ip": "239.69.55.1",
                "rtp_port": 5010
            })
            self.assertEqual(res_advisory.status_code, 200)
            d_adv = res_advisory.json()
            self.assertTrue(d_adv["valid"])
            self.assertTrue(d_adv["advisory_same_ip"])
            self.assertIn("IGMP snooping", d_adv["message"])

            # Mismo servicio y mismo sink (auto-edición) -> no colisiona consigo mismo
            res_self = self.client.post("/api/pipewire/validate-multicast", json={
                "service_id": svc_id,
                "sink_id": "sink_active",
                "multicast_ip": "239.69.55.1",
                "rtp_port": 5004
            })
            self.assertEqual(res_self.status_code, 200)
            d_self = res_self.json()
            self.assertTrue(d_self["valid"])
            self.assertFalse(d_self["collision"])
        finally:
            with SessionLocal() as db:
                db.query(Service).filter(Service.id == svc_id).delete()
                db.commit()

    def test_pipewire_profile_import_sanitization(self):
        """Verifica que migrate_and_validate_profile sanitiza NICs, IP multicast canónicas y SAP names."""
        from database.db import SessionLocal
        try:
            from main import migrate_and_validate_profile
        except ImportError:
            from backend.main import migrate_and_validate_profile

        with SessionLocal() as db:
            foreign_payload = {
                "profile": {
                    "name": "Imported Studio Hub",
                    "service_type": "pipewire_hub",
                    "software_type": "pipewire",
                    "software_build_id": 999999,  # Non-existent foreign build
                    "config": {
                        "sample_rate": 48000,
                        "aes67_network": {
                            "enabled": True,
                            "interface": "foreign_nonexistent_nic_0",
                            "ip": "192.168.99.11",
                            "base_multicast_prefix": "239.69.11"
                        },
                        "virtual_sinks": [
                            {
                                "id": "pgm_bus",
                                "name": "PGM Audio",
                                "aes67_enabled": True,
                                "multicast_ip": "239.69.11.1",
                                "rtp_port": 5004,
                                "sap_name": "test1 pgm_bus"
                            }
                        ]
                    }
                }
            }

            sanitized = migrate_and_validate_profile(foreign_payload, db)
            cfg = sanitized.get("config", {})
            net = cfg.get("aes67_network", {})
            sinks = cfg.get("virtual_sinks", [])

            # 1. Sinks list is preserved
            self.assertEqual(len(sinks), 1)

            # 2. Base multicast prefix matches local canonical prefix derived from resolved IP
            local_prefix = net.get("base_multicast_prefix")
            self.assertTrue(local_prefix.startswith("239.69."))

            # 3. Sink multicast IP reflects local canonical prefix
            sink_ip = sinks[0].get("multicast_ip")
            self.assertTrue(sink_ip.startswith(f"{local_prefix}."))

            # 4. SAP name is prefixed with local hostname rather than foreign 'test1'
            local_hostname = socket.gethostname().split(".")[0]
            self.assertTrue(sinks[0].get("sap_name").startswith(f"{local_hostname} "))
            self.assertIn("pgm_bus", sinks[0].get("sap_name"))

    def test_pipewire_profile_import_sanitization_nested_config(self):
        """Verifica que migrate_and_validate_profile sanitiza correctamente cuando pipewire_config está anidado."""
        from database.db import SessionLocal
        try:
            from main import migrate_and_validate_profile
        except ImportError:
            from backend.main import migrate_and_validate_profile

        with SessionLocal() as db:
            nested_payload = {
                "profile": {
                    "name": "Exported PipeWire Hub",
                    "service_type": "pipewire_hub",
                    "software_type": "pipewire",
                    "software_build_id": 999999,
                    "config": {
                        "auto_start": True,
                        "pipewire_config": {
                            "sample_rate": 48000,
                            "quantum": 1024,
                            "aes67_network": {
                                "enabled": True,
                                "interface": "enp9s0_nonexistent_on_test2",
                                "ip": "192.168.99.11",
                                "base_multicast_prefix": "239.69.11"
                            },
                            "virtual_sinks": [
                                {
                                    "id": "mix_bus",
                                    "name": "Master Mix Bus",
                                    "aes67_enabled": True,
                                    "multicast_ip": "239.69.11.1",
                                    "rtp_port": 5004,
                                    "sap_name": "test1 aes_mix_bus"
                                }
                            ]
                        }
                    }
                }
            }

            with patch(f"{NI_TARGET}.get_network_interfaces") as mock_ifaces:
                mock_ifaces.return_value = [
                    {
                        "name": "exp7s0",
                        "is_up": True,
                        "is_loopback": False,
                        "ipv4_addresses": [{"address": "192.168.99.13", "netmask": "255.255.255.0"}]
                    }
                ]
                sanitized = migrate_and_validate_profile(nested_payload, db)

            cfg = sanitized.get("config", {})
            pw_cfg = cfg.get("pipewire_config", {})
            net = pw_cfg.get("aes67_network", {})
            sinks = pw_cfg.get("virtual_sinks", [])

            self.assertEqual(len(sinks), 1)
            # 1. Interface adapted to exp7s0
            self.assertEqual(net.get("interface"), "exp7s0")
            self.assertEqual(net.get("ip"), "192.168.99.13")

            # 2. Base multicast prefix updated to 239.69.13
            self.assertEqual(net.get("base_multicast_prefix"), "239.69.13")

            # 3. Sink multicast IP migrated to 239.69.13.1
            sink_ip = sinks[0].get("multicast_ip")
            self.assertEqual(sink_ip, "239.69.13.1")

            local_hostname = socket.gethostname().split(".")[0]
            self.assertTrue(sinks[0].get("sap_name").startswith(f"{local_hostname} "))

    @patch(f"{NI_TARGET}.probe_network_ptp_master")
    @patch(f"{NI_TARGET}.psutil.process_iter")
    @patch(f"{NI_TARGET}.shutil.which")
    @patch(f"{NI_TARGET}.subprocess.run")
    @patch(f"{NI_TARGET}.psutil.net_if_stats")
    @patch(f"{NI_TARGET}.psutil.net_if_addrs")
    def test_ptp_tri_state_classification(
        self,
        mock_addrs,
        mock_stats,
        mock_run,
        mock_which,
        mock_proc_iter,
        mock_probe
    ):
        """Verifica la clasificación precisa en tri-estado: hardware, software y none."""
        app.dependency_overrides[verify_token] = lambda: "admin"

        mock_addrs.return_value = {
            "eth_hw": [SnicAddr(family=socket.AF_INET, address="192.168.1.10", netmask="255.255.255.0", broadcast=None, ptp=None)],
            "eth_sw": [SnicAddr(family=socket.AF_INET, address="192.168.1.20", netmask="255.255.255.0", broadcast=None, ptp=None)],
            "eth_none": [SnicAddr(family=socket.AF_INET, address="192.168.1.30", netmask="255.255.255.0", broadcast=None, ptp=None)]
        }
        mock_stats.return_value = {
            "eth_hw": SnicStats(isup=True, duplex=2, speed=1000, mtu=1500, flags="up"),
            "eth_sw": SnicStats(isup=True, duplex=2, speed=1000, mtu=1500, flags="up"),
            "eth_none": SnicStats(isup=True, duplex=2, speed=1000, mtu=1500, flags="up")
        }

        def mock_ethtool(cmd, capture_output=True, text=True, timeout=2.0):
            iface = cmd[2]
            res = MagicMock()
            res.returncode = 0
            if iface == "eth_hw":
                res.stdout = "Capabilities:\n\thardware-transmit\n\thardware-receive\nPTP Hardware Clock: 1\n"
            elif iface == "eth_sw":
                # Typical test1 NIC output
                res.stdout = "Capabilities:\n\tsoftware-transmit\n\tsoftware-receive\n\tsoftware-system-clock\nPTP Hardware Clock: none\n"
            else:
                res.stdout = "Capabilities:\n\tnone\n"
            res.stderr = ""
            return res

        mock_run.side_effect = mock_ethtool
        mock_which.return_value = "/usr/sbin/ptp4l"
        mock_proc_iter.return_value = []
        mock_probe.return_value = {"detected": False, "source_ip": None, "is_local": False}

        res = self.client.get("/api/pipewire/network-audit")
        self.assertEqual(res.status_code, 200)
        data = res.json()

        hw_iface = next(i for i in data["interfaces"] if i["name"] == "eth_hw")
        self.assertEqual(hw_iface["ptp_support"], "hardware")
        self.assertEqual(hw_iface["ptp_device"], "/dev/ptp1")
        self.assertTrue(hw_iface["ptp_hardware_capable"])
        self.assertFalse(hw_iface["ptp_software_capable"])

        sw_iface = next(i for i in data["interfaces"] if i["name"] == "eth_sw")
        self.assertEqual(sw_iface["ptp_support"], "software")
        self.assertIsNone(sw_iface["ptp_device"])
        self.assertFalse(sw_iface["ptp_hardware_capable"])
        self.assertTrue(sw_iface["ptp_software_capable"])

        none_iface = next(i for i in data["interfaces"] if i["name"] == "eth_none")
        self.assertEqual(none_iface["ptp_support"], "none")
        self.assertIsNone(none_iface["ptp_device"])
        self.assertFalse(none_iface["ptp_hardware_capable"])
        self.assertFalse(none_iface["ptp_software_capable"])

    @patch(f"{NI_TARGET}.socket.socket")
    def test_probe_network_ptp_master(self, mock_socket_cls):
        """Verifica la detección pasiva de un PTP Master en la red mediante mensaje Announce."""
        mock_sock = MagicMock()
        mock_socket_cls.return_value = mock_sock

        # Mock PTPv2 Announce packet (version=2, msg_type=0xB)
        ptp_announce_header = bytearray(44)
        ptp_announce_header[0] = 0x0B  # Announce msgType
        ptp_announce_header[1] = 0x02  # Version 2
        mock_sock.recvfrom.return_value = (bytes(ptp_announce_header), ("192.168.99.13", 320))

        detected = ni_module.probe_network_ptp_master("exp7s0", "192.168.99.11", timeout=0.1)
        self.assertTrue(detected["detected"])
        self.assertEqual(detected["source_ip"], "192.168.99.13")
        self.assertFalse(detected["is_local"])

        # Local source
        mock_sock.recvfrom.return_value = (bytes(ptp_announce_header), ("192.168.99.11", 320))
        local_detected = ni_module.probe_network_ptp_master("exp7s0", "192.168.99.11", timeout=0.1)
        self.assertTrue(local_detected["detected"])
        self.assertTrue(local_detected["is_local"])


if __name__ == "__main__":
    unittest.main()

