import unittest
from unittest.mock import MagicMock
from fastapi import HTTPException
from database.models import Service
from utils.port_validator import (
    extract_ports_from_service,
    get_next_available_icecast_ports,
    validate_icecast_ports,
    validate_service_port_conflicts,
)

class TestIcecastPorts(unittest.TestCase):

    def test_extract_ports_from_icecast_service(self):
        # Case 1: Plain HTTP only (7000)
        cfg_plain = {"icecast_config": {"port": 7000, "http_enabled": True, "ssl_enabled": False}}
        ports = extract_ports_from_service(1, "Icecast1", "icecast_server", cfg_plain, None, None)
        self.assertEqual(len(ports), 1)
        self.assertEqual(ports[0], (7000, "Icecast HTTP", "Icecast1", 1, "tcp"))

        # Case 2: HTTP + HTTPS (7000 + 7443)
        cfg_ssl = {
            "icecast_config": {
                "port": 7010,
                "http_enabled": True,
                "ssl_enabled": True,
                "ssl_port": 7453,
            }
        }
        ports_ssl = extract_ports_from_service(2, "IcecastSSL", "icecast_server", cfg_ssl, None, None)
        self.assertEqual(len(ports_ssl), 2)
        self.assertEqual(ports_ssl[0], (7010, "Icecast HTTP", "IcecastSSL", 2, "tcp"))
        self.assertEqual(ports_ssl[1], (7453, "Icecast HTTPS/TLS", "IcecastSSL", 2, "tcp"))

    def test_get_next_available_icecast_ports_offset(self):
        db = MagicMock()
        # No existing services
        db.query.return_value.all.return_value = []
        cand = get_next_available_icecast_ports(db)
        self.assertEqual(cand["port"], 7000)
        self.assertEqual(cand["ssl_port"], 7443)

        # Existing service occupying 7000
        svc1 = Service(
            id=1,
            name="Icecast1",
            service_type="icecast_server",
            config={"icecast_config": {"port": 7000, "http_enabled": True, "ssl_enabled": False}},
        )
        db.query.return_value.all.return_value = [svc1]
        cand2 = get_next_available_icecast_ports(db)
        # Next candidate should step +10 to 7010 and 7453
        self.assertEqual(cand2["port"], 7010)
        self.assertEqual(cand2["ssl_port"], 7453)

    def test_validate_icecast_ports_internal_conflict(self):
        db = MagicMock()
        # Attempt to bind both HTTP and HTTPS to port 7000
        bad_cfg = {"port": 7000, "http_enabled": True, "ssl_enabled": True, "ssl_port": 7000}
        with self.assertRaises(HTTPException) as ctx:
            validate_icecast_ports(1, "IcecastCrash", bad_cfg, db)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Port conflict within Icecast configuration", ctx.exception.detail)

    def test_validate_service_port_conflicts_cross_service(self):
        db = MagicMock()
        existing_svc = Service(
            id=10,
            name="ExistingIcecast",
            service_type="icecast_server",
            config={"icecast_config": {"port": 7000, "http_enabled": True, "ssl_enabled": False}},
        )
        db.query.return_value.all.return_value = [existing_svc]

        # Trying to create a new service with colliding port 7000
        colliding_cfg = {"icecast_config": {"port": 7000, "http_enabled": True, "ssl_enabled": False}}
        with self.assertRaises(HTTPException) as ctx:
            validate_service_port_conflicts(
                db=db,
                service_id=None,
                service_name="NewIcecast",
                service_type="icecast_server",
                config=colliding_cfg,
                input_config=None,
                output_config=None,
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("already in use by service 'ExistingIcecast'", ctx.exception.detail)

if __name__ == "__main__":
    unittest.main()
