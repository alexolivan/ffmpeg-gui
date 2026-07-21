import os
import unittest
from fastapi.testclient import TestClient

os.environ['ENV'] = 'test'
from backend.main import app

class TestRestartRequiredLogic(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_get_settings_returns_restart_reasons_list(self):
        res = self.client.get("/api/settings")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("restart_required", data)
        self.assertIn("restart_reasons", data)
        self.assertIsInstance(data["restart_reasons"], list)
