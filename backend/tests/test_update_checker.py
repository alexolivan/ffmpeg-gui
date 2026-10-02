import unittest
from unittest.mock import patch, MagicMock
import json
import io
import os
import sys

# Ensure backend directory is in sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from core.update_checker import compare_semver, check_latest_release, get_git_metadata
from fastapi.testclient import TestClient
from main import app


class TestUpdateChecker(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_compare_semver(self):
        # Major bump
        self.assertTrue(compare_semver("3.0.0", "2.30.0"))
        # Minor bump
        self.assertTrue(compare_semver("2.31.0", "2.30.0"))
        # Patch bump
        self.assertTrue(compare_semver("2.30.1", "2.30.0"))
        # With 'v' prefix
        self.assertTrue(compare_semver("v2.31.0", "2.30.0"))
        self.assertTrue(compare_semver("v2.31.0", "v2.30.0"))
        # Equal versions
        self.assertFalse(compare_semver("2.30.0", "2.30.0"))
        self.assertFalse(compare_semver("v2.30.0", "2.30.0"))
        # Older version
        self.assertFalse(compare_semver("2.29.0", "2.30.0"))
        self.assertFalse(compare_semver("1.99.9", "2.30.0"))

    @patch("core.update_checker.urllib.request.urlopen")
    def test_check_latest_release_success(self, mock_urlopen):
        mock_response = MagicMock()
        payload = {
            "tag_name": "v2.31.0",
            "html_url": "https://github.com/alexolivan/ffmpeg-gui/releases/tag/v2.31.0"
        }
        mock_response.read.return_value = json.dumps(payload).encode("utf-8")
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        res = check_latest_release("2.30.0", force=True)
        self.assertTrue(res["update_available"])
        self.assertEqual(res["latest_release"], "2.31.0")
        self.assertEqual(res["release_url"], "https://github.com/alexolivan/ffmpeg-gui/releases/tag/v2.31.0")

    @patch("core.update_checker.urllib.request.urlopen")
    def test_check_latest_release_air_gapped_silence(self, mock_urlopen):
        mock_urlopen.side_effect = Exception("Network unreachable")

        res = check_latest_release("2.30.0", force=True)
        self.assertFalse(res["update_available"])
        self.assertIsNone(res["latest_release"])

    @patch("core.update_checker.urllib.request.urlopen")
    def test_check_latest_release_caching(self, mock_urlopen):
        mock_response = MagicMock()
        payload = {
            "tag_name": "v2.30.0",
            "html_url": "https://github.com/alexolivan/ffmpeg-gui/releases/tag/v2.30.0"
        }
        mock_response.read.return_value = json.dumps(payload).encode("utf-8")
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        # First call triggers network request
        res1 = check_latest_release("2.30.0", force=True)
        self.assertEqual(mock_urlopen.call_count, 1)

        # Second call within TTL does not query network again
        res2 = check_latest_release("2.30.0", force=False)
        self.assertEqual(mock_urlopen.call_count, 1)
        self.assertEqual(res1["checked_at"], res2["checked_at"])

    def test_git_metadata_resolution(self):
        meta = get_git_metadata()
        self.assertIn("branch", meta)
        self.assertIn("commit", meta)
        self.assertIn("is_release", meta)

    def test_api_status_includes_update_and_git_fields(self):
        res = self.client.get("/api/status")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("git_branch", data)
        self.assertIn("git_commit", data)
        self.assertIn("is_release", data)
        self.assertIn("update_available", data)

    @patch("core.update_checker.urllib.request.urlopen")
    def test_api_check_updates_endpoint(self, mock_urlopen):
        mock_response = MagicMock()
        payload = {
            "tag_name": "v2.35.0",
            "html_url": "https://github.com/alexolivan/ffmpeg-gui/releases/tag/v2.35.0"
        }
        mock_response.read.return_value = json.dumps(payload).encode("utf-8")
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        res = self.client.post("/api/system/check-updates")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["update_available"])
        self.assertEqual(data["latest_release"], "2.35.0")


if __name__ == "__main__":
    unittest.main()
