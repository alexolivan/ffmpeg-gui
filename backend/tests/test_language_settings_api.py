import os
import unittest
from fastapi.testclient import TestClient

os.environ['ENV'] = 'test'
from backend.main import app

class TestLanguageSettingsAPI(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_get_settings_contains_language(self):
        res = self.client.get("/api/settings")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("language", data)
        self.assertIn(data["language"], ["en", "es", "ca"])

    def test_post_settings_updates_language(self):
        res = self.client.post("/api/settings", json={"language": "es"})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["language"], "es")

        # Re-fetch settings
        res2 = self.client.get("/api/settings")
        self.assertEqual(res2.json()["language"], "es")

    def test_post_settings_rejects_invalid_language(self):
        res = self.client.post("/api/settings", json={"language": "fr"})
        self.assertEqual(res.status_code, 400)
