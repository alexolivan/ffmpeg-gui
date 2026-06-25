import os
import sys
import unittest
from fastapi.testclient import TestClient

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from main import app

class TestSystemCapabilities(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_get_capabilities_endpoint(self):
        response = self.client.get("/system/capabilities")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        for key in ["vaapi", "nvenc", "v4l2", "alsa", "decklink", "avahi"]:
            self.assertIn(key, data)
            self.assertIn("available", data[key])
            self.assertIn("details", data[key])
        
        self.assertIn("ffmpeg", data)
        self.assertIn("filters", data["ffmpeg"])
        self.assertIn("decoders", data["ffmpeg"])
        self.assertIn("encoders", data["ffmpeg"])
        self.assertIsInstance(data["ffmpeg"]["filters"], list)
        self.assertIsInstance(data["ffmpeg"]["decoders"], list)
        self.assertIsInstance(data["ffmpeg"]["encoders"], list)

if __name__ == "__main__":
    unittest.main()
