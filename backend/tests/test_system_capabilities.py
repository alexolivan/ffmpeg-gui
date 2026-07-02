import os
import sys
import unittest
from unittest.mock import patch, MagicMock
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

    @patch("shutil.which")
    @patch("subprocess.run")
    def test_parse_vainfo_capabilities(self, mock_run, mock_which):
        from main import parse_vainfo_capabilities
        
        # Test case 1: vainfo not installed
        mock_which.return_value = None
        res = parse_vainfo_capabilities()
        self.assertEqual(res, {
            "decoders": [], 
            "encoders": [],
            "vaapi_version": None,
            "libva_version": None,
            "driver_version": None
        })
        
        # Test case 2: vainfo is installed and returns profiles
        mock_which.return_value = "/usr/bin/vainfo"
        
        mock_process = MagicMock()
        mock_process.returncode = 0
        mock_process.stdout = """
libva info: VA-API version 1.22.0
vainfo: VA-API version: 1.22 (libva 2.22.0)
vainfo: Driver version: Intel iHD driver for Intel(R) Gen Graphics - 25.2.3 ()
vainfo: Supported profile and entrypoints
      VAProfileMPEG2Simple            :	VAEntrypointVLD
      VAProfileH264High               :	VAEntrypointVLD
      VAProfileH264High               :	VAEntrypointEncSliceLP
      VAProfileHEVCMain               :	VAEntrypointVLD
      VAProfileHEVCMain10             :	VAEntrypointVLD
"""
        mock_process.stderr = ""
        mock_run.return_value = mock_process
        
        res = parse_vainfo_capabilities()
        self.assertIn("h264", res["encoders"])
        self.assertIn("h264", res["decoders"])
        self.assertIn("hevc", res["decoders"])
        self.assertNotIn("hevc", res["encoders"])
        self.assertEqual(res["vaapi_version"], "1.22")
        self.assertEqual(res["libva_version"], "2.22.0")
        self.assertEqual(res["driver_version"], "Intel iHD driver for Intel(R) Gen Graphics - 25.2.3 ()")

if __name__ == "__main__":
    unittest.main()
