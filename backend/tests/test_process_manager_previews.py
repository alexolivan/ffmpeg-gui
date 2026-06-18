import unittest
from core.process_manager import ProcessManager
from database.models import MediaProcess
from database.db import PREVIEWS_DIR
import os

class TestProcessManagerPreviews(unittest.TestCase):
    def test_build_ffmpeg_cmd_uses_previews_dir(self):
        manager = ProcessManager(lambda: None)
        media_proc = MediaProcess(
            id=42,
            name="Test Service",
            type="service",
            input_config={"type": "lavfi", "path": "testsrc"},
            output_config={"type": "file", "path": "/tmp/out.mp4"},
            codec_config={"vcodec": "libx264"}
        )
        cmd = manager._build_ffmpeg_cmd(media_proc, "ffmpeg")
        expected_path = os.path.join(PREVIEWS_DIR, "preview_42.jpg")
        self.assertIn(expected_path, cmd)
