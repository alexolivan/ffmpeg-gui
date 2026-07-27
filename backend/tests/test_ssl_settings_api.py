import unittest
from fastapi.testclient import TestClient
from backend.main import app

class TestSSLSettingsAPI(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_get_settings_contains_ssl_and_network_fields(self):
        response = self.client.get("/api/settings")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("bind_address", data)
        self.assertIn("http_port", data)
        self.assertIn("https_port", data)
        self.assertIn("ssl_enabled", data)
        self.assertIn("force_https_redirect", data)
        self.assertIn("ssl_mode", data)
        self.assertIn("ssl_domain", data)

    def test_get_ssl_status(self):
        response = self.client.get("/api/settings/ssl/status")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("status", data)
        self.assertIn("valid", data)

    def test_enable_ssl_without_valid_cert_raises_400(self):
        # Attempt to enable ssl_enabled when no cert exists in test env
        response = self.client.post("/api/settings", json={"ssl_enabled": True})
        self.assertEqual(response.status_code, 400)
        self.assertIn("SSL certificate", response.json()["detail"])

if __name__ == "__main__":
    unittest.main()
