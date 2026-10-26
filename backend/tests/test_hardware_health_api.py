import os
import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

os.environ['ENV'] = 'test'
from backend.main import app, hardware_health_manager
from backend.database.db import SessionLocal
from backend.database.models import SystemSettings



class TestHardwareHealthAPI(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        with SessionLocal() as db:
            settings = db.query(SystemSettings).first()
            if not settings:
                settings = SystemSettings()
                db.add(settings)
            settings.gui_password = None  # Ensure open access for testclient
            settings.thermal_warning_threshold = 75
            settings.thermal_critical_threshold = 85
            settings.thermal_active_protection = False
            db.commit()

    def test_get_hardware_health_endpoint(self):
        mock_snapshot = {
            "status": "normal",
            "max_temp_c": 52.4,
            "cpu": {
                "package_temp": 52.4,
                "cores": [{"label": "Core 0", "temp": 50.0}],
                "throttling": {
                    "active": False,
                    "throttling_detected": False,
                    "total_package_events": 0,
                    "total_core_events": 0,
                    "recent_events": 0,
                },
            },
            "fans": [{"name": "Fan 1", "rpm": 1200, "status": "ok"}],
            "av_hardware": {
                "audioscience": [],
                "magewell": [],
                "decklink": [],
            },
            "alerts": [],
            "timestamp": 1234567890.0,
        }

        with patch.object(hardware_health_manager, "get_health_snapshot", return_value=mock_snapshot):
            res = self.client.get("/api/hardware/health")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data["status"], "normal")
            self.assertEqual(data["max_temp_c"], 52.4)
            self.assertEqual(data["cpu"]["package_temp"], 52.4)
            self.assertEqual(len(data["fans"]), 1)

    def test_get_hardware_health_with_session_cookie(self):
        with SessionLocal() as db:
            s = db.query(SystemSettings).first()
            s.gui_password = "supersecretpassword"
            db.commit()

        try:
            # Without auth -> 401
            res = self.client.get("/api/hardware/health")
            self.assertEqual(res.status_code, 401)

            # With valid session cookie -> 200
            from backend.core.auth_manager import auth_manager
            session_token = auth_manager.create_session("supersecretpassword")
            self.client.cookies.set(auth_manager.COOKIE_NAME, session_token)
            res = self.client.get("/api/hardware/health")
            self.assertEqual(res.status_code, 200)
        finally:
            with SessionLocal() as db:
                s = db.query(SystemSettings).first()
                s.gui_password = None
                db.commit()
            if auth_manager.COOKIE_NAME in self.client.cookies:
                del self.client.cookies[auth_manager.COOKIE_NAME]

    def test_get_settings_contains_thermal_fields(self):
        res = self.client.get("/api/settings")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("thermal_warning_threshold", data)
        self.assertIn("thermal_critical_threshold", data)
        self.assertIn("thermal_active_protection", data)
        self.assertEqual(data["thermal_warning_threshold"], 75)
        self.assertEqual(data["thermal_critical_threshold"], 85)
        self.assertFalse(data["thermal_active_protection"])

    def test_update_thermal_settings(self):
        payload = {
            "thermal_warning_threshold": 70,
            "thermal_critical_threshold": 80,
            "thermal_active_protection": True,
        }
        res = self.client.post("/api/settings", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["thermal_warning_threshold"], 70)
        self.assertEqual(data["thermal_critical_threshold"], 80)
        self.assertTrue(data["thermal_active_protection"])

        # Check DB persistence
        with SessionLocal() as db:
            s = db.query(SystemSettings).first()
            self.assertEqual(s.thermal_warning_threshold, 70)
            self.assertEqual(s.thermal_critical_threshold, 80)
            self.assertTrue(s.thermal_active_protection)

        # Check manager runtime configuration updated
        self.assertEqual(hardware_health_manager.warning_threshold_c, 70.0)
        self.assertEqual(hardware_health_manager.critical_threshold_c, 80.0)
        self.assertTrue(hardware_health_manager.active_protection_enabled)


if __name__ == "__main__":
    unittest.main()
