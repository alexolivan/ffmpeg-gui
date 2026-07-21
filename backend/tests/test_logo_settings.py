import os
import unittest
import io
from PIL import Image
from fastapi.testclient import TestClient

os.environ['ENV'] = 'test'
from backend.main import app

class TestLogoSettings(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_logo_path_returned_in_settings(self):
        # Create a small dummy image in memory
        img = Image.new('RGBA', (100, 100), color='red')
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        buf.seek(0)

        # Upload logo via API
        response = self.client.post(
            "/api/settings/logo",
            files={"file": ("test_logo.png", buf, "image/png")}
        )
        self.assertEqual(response.status_code, 200)
        uploaded_path = response.json()["logo_path"]

        # Fetch settings via GET /api/settings
        get_res = self.client.get("/api/settings")
        self.assertEqual(get_res.status_code, 200)
        data = get_res.json()
        
        # Verify logo_path is present and matches uploaded path
        self.assertIn("logo_path", data)
        self.assertEqual(data["logo_path"], uploaded_path)
