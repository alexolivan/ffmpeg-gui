import unittest
import os
import json
from unittest.mock import patch, MagicMock, AsyncMock
from fastapi.testclient import TestClient
from backend.main import app


class TestDecklinkApi(unittest.TestCase):

    def setUp(self):
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    @patch("backend.main.decklink_manager.get_system_status", new_callable=AsyncMock)
    def test_get_decklink_status_endpoint(self, mock_status):
        mock_status.return_value = {
            "driver_version": "14.2.1",
            "driver_installed": True,
            "helper_path": "/path/to/decklink-ctl",
            "helper_version": "decklink-ctl v1.0.0",
            "helper_available": True,
            "firmware": {"available": True, "needs_update": False, "devices": []},
            "devices": [],
            "device_count": 0,
            "system_status": "READY"
        }
        res = self.client.get("/api/settings/decklink/status")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["driver_version"], "14.2.1")
        self.assertEqual(data["system_status"], "READY")

    @patch("backend.main.decklink_manager.get_device_telemetry", new_callable=AsyncMock)
    def test_get_decklink_telemetry_endpoint(self, mock_telemetry):
        mock_telemetry.return_value = {
            "success": True,
            "device_index": 0,
            "display_name": "DeckLink Duo 2 (1)",
            "signal_locked": True,
            "detected_mode": "1080p50",
            "detected_pixel_format": "8-bit YUV"
        }
        res = self.client.get("/api/settings/decklink/0/telemetry")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["signal_locked"])
        self.assertEqual(data["detected_mode"], "1080p50")

    @patch("backend.main.decklink_manager.configure_device", new_callable=AsyncMock)
    def test_configure_decklink_device_conflict_409(self, mock_config):
        mock_config.return_value = {
            "success": False,
            "conflict": True,
            "error": "Dispositivo en uso por proceso activo"
        }
        res = self.client.post("/api/settings/decklink/0/configure", json={"duplex": "full"})
        self.assertEqual(res.status_code, 409)
        self.assertIn("Dispositivo en uso", res.json()["detail"])


if __name__ == "__main__":
    unittest.main()
