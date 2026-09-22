import os
import unittest
from unittest.mock import patch
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi import HTTPException

from database.models import Base, Service
from utils.port_validator import (
    extract_ports_from_service,
    validate_service_port_conflicts,
    get_next_available_desktop_display_and_vnc_port,
    is_port_in_use_os,
    is_display_in_use_os,
)


class TestDesktopPorts(unittest.TestCase):
    def setUp(self):
        os.environ["ACTIVE_PORT"] = "8011"
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

    def tearDown(self):
        self.db.close()

    def test_extract_ports_from_desktop_service(self):
        # Explicit vnc_port and display_num
        cfg1 = {"desktop_config": {"display_num": 99, "vnc_port": 5999}}
        ports1 = extract_ports_from_service(1, "Desktop 1", "desktop", cfg1, None, None)
        self.assertEqual(len(ports1), 1)
        self.assertEqual(ports1[0], (5999, "VNC (Desktop)", "Desktop 1", 1, "tcp"))

        # Only display_num (calculates 5900 + 102 = 6002)
        cfg2 = {"desktop_config": {"display_num": 102}}
        ports2 = extract_ports_from_service(2, "Desktop 2", "desktop", cfg2, None, None)
        self.assertEqual(len(ports2), 1)
        self.assertEqual(ports2[0], (6002, "VNC (Desktop)", "Desktop 2", 2, "tcp"))

        # Empty config (fallback default 5999)
        ports3 = extract_ports_from_service(3, "Desktop Default", "desktop", {}, None, None)
        self.assertEqual(len(ports3), 1)
        self.assertEqual(ports3[0], (5999, "VNC (Desktop Default)", "Desktop Default", 3, "tcp"))

    def test_desktop_vnc_port_collision_with_other_desktop(self):
        s1 = Service(
            name="Desktop Primary",
            service_type="desktop",
            status="stopped",
            type="service",
            config={"desktop_config": {"display_num": 99, "vnc_port": 5999}},
        )
        self.db.add(s1)
        self.db.commit()

        # Desktop 2 attempts to use same VNC port 5999 (with different display)
        with self.assertRaises(HTTPException) as ctx:
            validate_service_port_conflicts(
                db=self.db,
                service_id=None,
                service_name="Desktop Collision",
                service_type="desktop",
                config={"desktop_config": {"display_num": 100, "vnc_port": 5999}},
                input_config={},
                output_config={},
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("5999", ctx.exception.detail)
        self.assertIn("Port collision", ctx.exception.detail)

    def test_desktop_display_collision_with_other_desktop(self):
        s1 = Service(
            name="Desktop Primary",
            service_type="desktop",
            status="stopped",
            type="service",
            config={"desktop_config": {"display_num": 99, "vnc_port": 5999}},
        )
        self.db.add(s1)
        self.db.commit()

        # Desktop 2 attempts to use same display 99 even with different VNC port 5998
        with self.assertRaises(HTTPException) as ctx:
            validate_service_port_conflicts(
                db=self.db,
                service_id=None,
                service_name="Desktop Same Display",
                service_type="desktop",
                config={"desktop_config": {"display_num": 99, "vnc_port": 5998}},
                input_config={},
                output_config={},
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Display collision", ctx.exception.detail)
        self.assertIn("Display :99", ctx.exception.detail)

    def test_desktop_vnc_collision_with_other_service_types(self):
        # An FFmpeg stream listener occupying port 5999
        s_ffmpeg = Service(
            name="SRT or TCP Stream",
            service_type="ffmpeg_stream",
            status="stopped",
            type="service",
            output_config=[{"type": "tcp", "mode": "listener", "port": 5999}],
        )
        self.db.add(s_ffmpeg)
        self.db.commit()

        # Desktop attempting to use port 5999
        with self.assertRaises(HTTPException) as ctx:
            validate_service_port_conflicts(
                db=self.db,
                service_id=None,
                service_name="Desktop Colliding with FFmpeg",
                service_type="desktop",
                config={"desktop_config": {"display_num": 99, "vnc_port": 5999}},
                input_config={},
                output_config={},
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Port collision", ctx.exception.detail)
        self.assertIn("5999", ctx.exception.detail)

    def test_get_next_available_desktop_display_and_vnc_port(self):
        # Empty DB returns base display 99 and VNC port 5999
        res = get_next_available_desktop_display_and_vnc_port(self.db, check_os=False)
        self.assertEqual(res["display_num"], 99)
        self.assertEqual(res["vnc_port"], 5999)

        # Occupy display 99
        s1 = Service(
            name="Desktop 1",
            service_type="desktop",
            status="stopped",
            type="service",
            config={"desktop_config": {"display_num": 99, "vnc_port": 5999}},
        )
        self.db.add(s1)
        self.db.commit()

        # Next should increment to 100 / 6000
        res2 = get_next_available_desktop_display_and_vnc_port(self.db, check_os=False)
        self.assertEqual(res2["display_num"], 100)
        self.assertEqual(res2["vnc_port"], 6000)

    @patch("utils.port_validator.is_display_in_use_os")
    def test_get_next_available_skips_active_os_display(self, mock_display_check):
        # Simulate OS already having :99 in use (e.g. /tmp/.X11-unix/X99 exists)
        mock_display_check.side_effect = lambda disp: disp == 99

        with patch("utils.port_validator.is_port_in_use_os", return_value=False):
            res = get_next_available_desktop_display_and_vnc_port(self.db, check_os=True)
            self.assertEqual(res["display_num"], 100)
            self.assertEqual(res["vnc_port"], 6000)

    def test_exclude_service_id_allows_keeping_same_display(self):
        s1 = Service(
            name="Desktop Existing",
            service_type="desktop",
            status="stopped",
            type="service",
            config={"desktop_config": {"display_num": 99, "vnc_port": 5999}},
        )
        self.db.add(s1)
        self.db.commit()

        # When editing s1 (exclude_service_id=s1.id), display 99 is available
        res = get_next_available_desktop_display_and_vnc_port(self.db, exclude_service_id=s1.id, check_os=False)
        self.assertEqual(res["display_num"], 99)
        self.assertEqual(res["vnc_port"], 5999)


if __name__ == "__main__":
    unittest.main()
