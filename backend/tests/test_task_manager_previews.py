import unittest
from core.task_manager import TaskManager
from database.models import ScheduledTask
from database.db import PREVIEWS_DIR
import os

class TestTaskManagerPreviews(unittest.TestCase):
    def test_build_ffmpeg_cmd_uses_previews_dir(self):
        manager = TaskManager(lambda: None)
        task = ScheduledTask(
            id=24,
            name="Test Task",
            input_config={"type": "lavfi", "path": "testsrc"},
            output_config={"type": "file", "path": "/tmp/out.mp4"},
            codec_config={"vcodec": "libx264"}
        )
        cmd = manager._build_ffmpeg_cmd(task, "ffmpeg", None, execution_id=100)
        expected_path = os.path.join(PREVIEWS_DIR, "preview_task_100.jpg")
        self.assertIn(expected_path, cmd)
