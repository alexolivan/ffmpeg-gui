import os
import subprocess
import tempfile
import unittest
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


class TestThemeSettingsAPI(unittest.TestCase):
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

    def test_get_settings_contains_theme(self):
        res = self.client.get("/api/settings")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("theme", data)
        self.assertEqual(data["theme"], "studio-dark")

    def test_post_settings_updates_theme(self):
        res = self.client.post("/api/settings", json={"theme": "cyberpunk"})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["theme"], "cyberpunk")

        # Re-fetch settings
        res2 = self.client.get("/api/settings")
        self.assertEqual(res2.json()["theme"], "cyberpunk")

    def test_post_settings_rejects_invalid_theme(self):
        res = self.client.post("/api/settings", json={"theme": "matrix-hacker"})
        self.assertEqual(res.status_code, 400)
