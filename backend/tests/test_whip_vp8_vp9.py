import os
import sys
import unittest
from unittest.mock import patch, MagicMock, AsyncMock
from fastapi.testclient import TestClient

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from main import app, build_manager
from database.db import SessionLocal, init_db
from database.models import FfmpegBuild

class TestWhipVp8Vp9(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        init_db()
        self.client = TestClient(app)
        self.db = SessionLocal()
        self.test_builds = []

    async def asyncTearDown(self):
        for b in self.test_builds:
            db_build = self.db.query(FfmpegBuild).get(b.id)
            if db_build:
                self.db.delete(db_build)
        self.db.commit()
        self.db.close()

    def test_create_build_with_whip_option(self):
        # Create a build profile with whip and libvpx enabled
        payload = {
            "name": "Test WHIP VP8/VP9 Profile",
            "ffmpeg_version": "n8.1.1",
            "srt_version": "v1.5.3",
            "build_options": {"whip": True, "libsrt": True},
            "sdk_paths": {},
            "auto_clean": False
        }
        response = self.client.post("/builds", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["build_options"].get("whip"))
        
        # Verify it was persisted to database
        db_build = self.db.query(FfmpegBuild).filter_by(name=payload["name"]).first()
        self.assertIsNotNone(db_build)
        self.test_builds.append(db_build)
        self.assertTrue(db_build.build_options.get("whip"))

    @patch("subprocess.run")
    async def test_build_manager_validation_and_flags(self, mock_sub_run):
        # Mock subprocess.run for ffmpeg -version check
        mock_proc = MagicMock()
        mock_proc.stdout = "ffmpeg version 8.1.1"
        mock_sub_run.return_value = mock_proc

        # Mock dependency checker to report libssl and libvpx as installed
        mock_check_deps_val = {
            "dependencies": {
                "libssl": {"pkg": "openssl", "type": "required", "installed": True, "description": "OpenSSL"},
                "libvpx": {"pkg": "vpx", "type": "optional", "installed": True, "description": "VP8/VP9"},
                "libopus": {"pkg": "opus", "type": "optional", "installed": False, "description": "Opus"}
            }
        }

        # 1. Validation test: FFmpeg version < 8.0 should fail validation if whip option is selected
        log_callback = AsyncMock()
        with patch.object(build_manager, "check_dependencies", return_value=mock_check_deps_val):
            res = await build_manager.run_build(
                build_id=9999,
                ffmpeg_version="n7.1.3",
                srt_version=None,
                options={"whip": True},
                sdk_paths={},
                sources_cleaned=False,
                log_callback=log_callback
            )
            self.assertFalse(res["success"])
            self.assertIn("requires FFmpeg 8.0 or newer", res["error"])

        # 2. Validation test: FFmpeg version >= 8.0 should pass validation and configure with openssl & vpx
        with patch.object(build_manager, "get_src_path", return_value="/tmp/dummy_src"), \
             patch.object(build_manager, "get_install_path", return_value="/tmp/dummy_install"), \
             patch("os.makedirs"), \
             patch("shutil.rmtree"), \
             patch("os.path.exists", return_value=True), \
             patch.object(build_manager, "get_disk_usage", return_value=123), \
             patch.object(build_manager, "check_dependencies", return_value=mock_check_deps_val):
             
             # Mock _run_logged_cmd to capture configure options
             configure_options = []
             async def mock_cmd(args, cb, cwd=None, **kwargs):
                 if len(args) > 0 and "configure" in args[0]:
                     nonlocal configure_options
                     configure_options = args
                 return MagicMock(returncode=0)
             
             with patch.object(build_manager, "_run_logged_cmd", new=mock_cmd):
                 res = await build_manager.run_build(
                     build_id=9999,
                     ffmpeg_version="n8.1.1",
                     srt_version=None,
                     options={"whip": True},
                     sdk_paths={},
                     sources_cleaned=False,
                     log_callback=log_callback
                 )
                 
                 # The mock compilation should finish successfully
                 self.assertTrue(res["success"])
                 self.assertIn("--enable-openssl", configure_options)
                 self.assertIn("--enable-libvpx", configure_options)
                 self.assertNotIn("--enable-libopus", configure_options)

if __name__ == "__main__":
    unittest.main()
