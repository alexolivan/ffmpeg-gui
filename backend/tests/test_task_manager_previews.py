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

    def test_build_ffmpeg_cmd_with_limit_sec_applies_to_preview(self):
        manager = TaskManager(lambda: None)
        task = ScheduledTask(
            id=25,
            name="Timed Video Task",
            input_config={"type": "lavfi", "path": "testsrc"},
            output_config={"type": "file", "path": "/tmp/out.mp4"},
            codec_config={"vcodec": "libx264"}
        )
        cmd = manager._build_ffmpeg_cmd(task, "ffmpeg", limit_sec=300, execution_id=101)
        expected_path = os.path.join(PREVIEWS_DIR, "preview_task_101.jpg")
        preview_idx = cmd.index(expected_path)
        # Verify -t 300 is present in the arguments for the preview output
        self.assertEqual(cmd.count("-t"), 2)
        preview_output_args = cmd[cmd.index("-update") - 2 : preview_idx + 1]
        self.assertIn("-t", cmd[cmd.index("-map"):preview_idx])
        self.assertEqual(cmd[preview_idx - 5], "-t")
        self.assertEqual(cmd[preview_idx - 4], "300")
