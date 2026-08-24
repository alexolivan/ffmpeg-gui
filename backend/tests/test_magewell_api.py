import unittest
from unittest.mock import patch, AsyncMock, MagicMock
from fastapi.testclient import TestClient
from backend.main import app, magewell_manager


class TestMagewellApi(unittest.TestCase):

    def setUp(self):
        self.client = TestClient(app)
        magewell_manager.clear_cache()

    @patch.object(magewell_manager, "get_system_status")
    def test_get_magewell_status(self, mock_status):
        mock_status.return_value = {
            "driver_installed": True,
            "driver_version": "1.3.4429",
            "utilities_available": True,
            "pcie_hardware_detected": True,
            "status": "READY",
            "total_channels": 1,
            "cards": [
                {
                    "board_id": 0,
                    "product_name": "Pro Capture SDI",
                    "serial_number": "B105220301073",
                    "num_channels": 1,
                    "channels": [
                        {
                            "channel_id": 0,
                            "device_path": "/dev/video0",
                            "temperature": "75.5ºC",
                            "signal_locked": True
                        }
                    ]
                }
            ]
        }
        res = self.client.get("/api/settings/magewell/status")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "READY")
        self.assertEqual(data["driver_version"], "1.3.4429")
        self.assertEqual(len(data["cards"]), 1)

    @patch.object(magewell_manager, "configure_channel", new_callable=AsyncMock)
    def test_configure_magewell_channel_success(self, mock_config):
        mock_config.return_value = {"success": True, "message": "OK"}
        res = self.client.post("/api/settings/magewell/dev-video0/configure", json={
            "video_input": "sdi",
            "low_latency": True
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["success"])

    @patch.object(magewell_manager, "configure_channel", new_callable=AsyncMock)
    def test_configure_magewell_channel_conflict(self, mock_config):
        mock_config.return_value = {"success": False, "error": "Cannot reconfigure channel while active service Stream1 is using it"}
        res = self.client.post("/api/settings/magewell/dev-video0/configure", json={
            "video_input": "hdmi"
        })
        self.assertEqual(res.status_code, 409)
        self.assertIn("active service", res.json()["detail"])

    @patch.object(magewell_manager, "get_system_status")
    def test_capabilities_includes_magewell(self, mock_status):
        mock_status.return_value = {
            "driver_installed": True,
            "driver_version": "1.3.4429",
            "utilities_available": True,
            "status": "READY",
            "total_channels": 1,
            "cards": [{"product_name": "Pro Capture SDI", "num_channels": 1}]
        }
        res = self.client.get("/system/capabilities")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("magewell", data)
        self.assertTrue(data["magewell"]["available"])
        self.assertEqual(data["magewell"]["status"], "READY")


if __name__ == "__main__":
    unittest.main()
