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
        self.assertIn("auto_reload_ssl_services", data)
        self.assertTrue(data["auto_reload_ssl_services"])

    def test_update_auto_reload_ssl_services(self):
        response = self.client.post("/api/settings", json={"auto_reload_ssl_services": False})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["auto_reload_ssl_services"], False)

        # Restore to True
        response = self.client.post("/api/settings", json={"auto_reload_ssl_services": True})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["auto_reload_ssl_services"], True)

    def tearDown(self):
        from database.db import SessionLocal
        from database.models import SystemSettings
        with SessionLocal() as db:
            s = db.query(SystemSettings).first()
            if s and s.gui_password:
                s.gui_password = None
                db.commit()

    def test_password_preservation_when_not_provided(self):
        # Set password
        self.client.post("/api/settings", json={"gui_password": "supersecretpassword"})
        auth_headers = {"Authorization": "Bearer supersecretpassword"}
        
        # Verify password is set
        res = self.client.get("/api/settings", headers=auth_headers)
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["has_gui_password"])

        # Update another setting without providing gui_password
        update_res = self.client.post("/api/settings", json={"node_name": "Renamed Node"}, headers=auth_headers)
        self.assertEqual(update_res.status_code, 200)

        # Verify password was NOT wiped
        check_res = self.client.get("/api/settings", headers=auth_headers)
        self.assertEqual(check_res.status_code, 200)
        self.assertTrue(check_res.json()["has_gui_password"])
        self.assertEqual(check_res.json()["node_name"], "Renamed Node")

        # Clear password with empty string
        clear_res = self.client.post("/api/settings", json={"gui_password": ""}, headers=auth_headers)
        self.assertEqual(clear_res.status_code, 200)
        check_clear = self.client.get("/api/settings")
        self.assertFalse(check_clear.json().get("has_gui_password", False))

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

    def test_renew_ssl_without_valid_domain_raises_400(self):
        response = self.client.post("/api/settings/ssl/renew", json={"domain": "", "email": ""})
        self.assertEqual(response.status_code, 400)
        self.assertIn("Domain Name", response.json()["detail"])

if __name__ == "__main__":
    unittest.main()
