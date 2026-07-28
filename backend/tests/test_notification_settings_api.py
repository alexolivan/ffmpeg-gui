import os
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient

os.environ['ENV'] = 'test'
from backend.main import app


def _clean_untracked_root_config():
    if os.path.exists("ffmpeg-gui.conf"):
        try:
            res = subprocess.run(
                ["git", "ls-files", "--error-unmatch", "ffmpeg-gui.conf"],
                capture_output=True
            )
            if res.returncode != 0:
                os.remove("ffmpeg-gui.conf")
        except Exception:
            pass


class TestNotificationSettingsAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _clean_untracked_root_config()

    @classmethod
    def tearDownClass(cls):
        _clean_untracked_root_config()

    def setUp(self):
        _clean_untracked_root_config()
        self.tmp_config = tempfile.NamedTemporaryFile(delete=False)
        self.tmp_config.close()
        self.old_config_env = os.environ.get("CONFIG_FILE_PATH")
        os.environ["CONFIG_FILE_PATH"] = self.tmp_config.name
        self.client = TestClient(app)

    def tearDown(self):
        if self.old_config_env is not None:
            os.environ["CONFIG_FILE_PATH"] = self.old_config_env
        else:
            os.environ.pop("CONFIG_FILE_PATH", None)

        if hasattr(self, "tmp_config") and os.path.exists(self.tmp_config.name):
            try:
                os.unlink(self.tmp_config.name)
            except OSError:
                pass
        _clean_untracked_root_config()

    def test_get_settings_contains_notifications(self):
        res = self.client.get("/api/settings")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("notifications", data)
        notifications = data["notifications"]
        required_fields = [
            "enabled",
            "smtp_host",
            "smtp_port",
            "smtp_encryption",
            "smtp_user",
            "recipient_email",
            "notify_service_failures",
            "notify_build_results",
            "notify_task_failures",
            "notify_ssl_alerts",
            "notify_storage_alerts",
        ]
        for field in required_fields:
            self.assertIn(field, notifications)

    def test_post_settings_updates_and_persists_notifications(self):
        payload = {
            "notifications": {
                "enabled": True,
                "smtp_host": "smtp.example.com",
                "smtp_port": 465,
                "smtp_encryption": "ssl",
                "smtp_user": "user@example.com",
                "smtp_password": "secretpassword",
                "recipient_email": "admin@example.com",
                "notify_service_failures": True,
                "notify_build_results": False,
                "notify_task_failures": True,
                "notify_ssl_alerts": False,
                "notify_storage_alerts": True,
            }
        }
        res = self.client.post("/api/settings", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("notifications", data)
        updated = data["notifications"]
        self.assertTrue(updated["enabled"])
        self.assertEqual(updated["smtp_host"], "smtp.example.com")
        self.assertEqual(updated["smtp_port"], 465)
        self.assertEqual(updated["smtp_encryption"], "ssl")
        self.assertEqual(updated["smtp_user"], "user@example.com")
        self.assertEqual(updated["smtp_password"], "*****")
        self.assertEqual(updated["recipient_email"], "admin@example.com")
        self.assertTrue(updated["notify_service_failures"])
        self.assertFalse(updated["notify_build_results"])

        # Re-fetch settings via GET to ensure persistence
        res2 = self.client.get("/api/settings")
        self.assertEqual(res2.status_code, 200)
        data2 = res2.json()
        fetched = data2["notifications"]
        self.assertTrue(fetched["enabled"])
        self.assertEqual(fetched["smtp_host"], "smtp.example.com")
        self.assertEqual(fetched["smtp_port"], 465)
        self.assertEqual(fetched["smtp_encryption"], "ssl")
        self.assertEqual(fetched["smtp_user"], "user@example.com")
        self.assertEqual(fetched["smtp_password"], "*****")
        self.assertEqual(fetched["recipient_email"], "admin@example.com")

    @patch("core.notification_manager.NotificationManager.send_test_email")
    def test_post_notifications_test_endpoint(self, mock_send_test_email):
        mock_send_test_email.return_value = (True, "Notification sent successfully.")
        res = self.client.post("/api/notifications/test", json={"smtp_host": "test.smtp.com"})
        self.assertEqual(res.status_code, 200)
        mock_send_test_email.assert_called_once()
        data = res.json()
        self.assertTrue(data.get("success"))
        self.assertIn("sent successfully", data.get("message", ""))


if __name__ == "__main__":
    unittest.main()
