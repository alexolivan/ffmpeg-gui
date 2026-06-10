import os
import sys
import unittest
from unittest.mock import patch, MagicMock, AsyncMock
from fastapi.testclient import TestClient

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from main import app, build_manager
from database.db import SessionLocal, init_db
from database.models import FfmpegBuild

class TestCompileLogsAndClean(unittest.TestCase):
    def setUp(self):
        init_db()
        self.client = TestClient(app)
        self.db = SessionLocal()

        # Create a dummy build profile
        self.build = FfmpegBuild(
            name="API Test Log & Clean Profile",
            ffmpeg_version="6.0",
            build_options={"nvenc": True},
            install_path="/tmp/ffmpeg-gui-test-builds/install",
            status="ready",
            sources_cleaned=True
        )
        self.db.add(self.build)
        self.db.commit()
        self.db.refresh(self.build)

    def tearDown(self):
        # Clean build log file if created
        build_path = build_manager.get_build_path(self.build.id)
        log_file = os.path.join(build_path, "build.log")
        if os.path.exists(log_file):
            try:
                os.remove(log_file)
            except Exception:
                pass
        
        # Delete dummy build profile
        db_build = self.db.query(FfmpegBuild).get(self.build.id)
        if db_build:
            self.db.delete(db_build)
            self.db.commit()
        self.db.close()

    @patch("main.build_manager.run_build", new_callable=AsyncMock)
    def test_clean_compile_parameter(self, mock_run_build):
        mock_run_build.return_value = {"success": True, "ffmpeg_binary": "/tmp/dummy", "ffprobe_binary": "/tmp/dummy"}

        # Start build compile with clean=true
        res = self.client.post(f"/builds/{self.build.id}/compile?clean=true")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "ok")

        # Verify background task compiled with sources_cleaned=True
        mock_run_build.assert_called_once()
        called_kwargs = mock_run_build.call_args[1]
        self.assertTrue(called_kwargs["sources_cleaned"])

    def test_websocket_sends_existing_logs(self):
        # Create a dummy build.log file
        build_path = build_manager.get_build_path(self.build.id)
        os.makedirs(build_path, exist_ok=True)
        log_file = os.path.join(build_path, "build.log")
        with open(log_file, "w") as f:
            f.write("Line 1 of logs\nLine 2 of logs\n")

        # Connect to websocket and verify logs are sent
        with self.client.websocket_connect(f"/ws/build/{self.build.id}") as websocket:
            # We expect two messages (since the file has two lines)
            msg1 = websocket.receive_text()
            msg2 = websocket.receive_text()
            self.assertEqual(msg1, "Line 1 of logs\n")
            self.assertEqual(msg2, "Line 2 of logs\n")

if __name__ == "__main__":
    unittest.main()
