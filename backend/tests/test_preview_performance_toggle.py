import unittest
import os
from core.process_manager import ProcessManager
from database.models import MediaProcess
from database.db import PREVIEWS_DIR

class TestPreviewPerformanceToggle(unittest.TestCase):
    def setUp(self):
        self.manager = ProcessManager(lambda: None)

    def test_hls_defaults_to_no_preview(self):
        media_proc = MediaProcess(
            id=10,
            name="HLS Stream",
            type="service",
            input_config={"type": "v4l2", "path": "/dev/video0"},
            output_config={"type": "hls", "path": "/var/hls/live/stream.m3u8"},
            codec_config={"vcodec": "h264_vaapi"},
            filter_config={"advanced": {}}
        )
        cmd = self.manager._build_ffmpeg_cmd(media_proc, "ffmpeg")
        preview_path = os.path.join(PREVIEWS_DIR, "preview_10.jpg")
        self.assertNotIn(preview_path, cmd)
        self.assertNotIn("-c:v", [arg for i, arg in enumerate(cmd) if i + 1 < len(cmd) and cmd[i+1] == "mjpeg"])

    def test_hls_explicit_preview_enabled(self):
        media_proc = MediaProcess(
            id=11,
            name="HLS Stream With Preview",
            type="service",
            input_config={"type": "v4l2", "path": "/dev/video0"},
            output_config={"type": "hls", "path": "/var/hls/live/stream.m3u8"},
            codec_config={"vcodec": "h264_vaapi"},
            filter_config={"advanced": {"enable_preview": True}}
        )
        cmd = self.manager._build_ffmpeg_cmd(media_proc, "ffmpeg")
        preview_path = os.path.join(PREVIEWS_DIR, "preview_11.jpg")
        self.assertIn(preview_path, cmd)

    def test_file_defaults_to_preview_enabled(self):
        media_proc = MediaProcess(
            id=12,
            name="File Stream",
            type="service",
            input_config={"type": "v4l2", "path": "/dev/video0"},
            output_config={"type": "file", "path": "/tmp/test.mp4"},
            codec_config={"vcodec": "libx264"},
            filter_config={"advanced": {}}
        )
        cmd = self.manager._build_ffmpeg_cmd(media_proc, "ffmpeg")
        preview_path = os.path.join(PREVIEWS_DIR, "preview_12.jpg")
        self.assertIn(preview_path, cmd)

    def test_file_explicit_preview_disabled(self):
        media_proc = MediaProcess(
            id=13,
            name="File Stream No Preview",
            type="service",
            input_config={"type": "v4l2", "path": "/dev/video0"},
            output_config={"type": "file", "path": "/tmp/test.mp4"},
            codec_config={"vcodec": "libx264"},
            filter_config={"advanced": {"enable_preview": False}}
        )
        cmd = self.manager._build_ffmpeg_cmd(media_proc, "ffmpeg")
        preview_path = os.path.join(PREVIEWS_DIR, "preview_13.jpg")
        self.assertNotIn(preview_path, cmd)

    def test_secondary_input_receives_thread_queue_size(self):
        media_proc = MediaProcess(
            id=14,
            name="Dual Input Stream",
            type="service",
            input_config={
                "input1": {"type": "v4l2", "path": "/dev/video0"},
                "input2": {"type": "alsa", "path": "hw:0,0"},
                "use_secondary_input": True
            },
            output_config={"type": "udp", "url": "udp://127.0.0.1:1234"},
            codec_config={"vcodec": "libx264", "acodec": "aac"},
            filter_config={"advanced": {"thread_queue_size": 8192}}
        )
        cmd = self.manager._build_ffmpeg_cmd(media_proc, "ffmpeg")
        # Find indices of -i
        input_indices = [i for i, arg in enumerate(cmd) if arg == "-i"]
        self.assertEqual(len(input_indices), 2)
        
        # Check that -thread_queue_size 8192 precedes both inputs
        idx_input1 = input_indices[0]
        idx_input2 = input_indices[1]
        
        self.assertIn("-thread_queue_size", cmd[:idx_input1])
        self.assertIn("-thread_queue_size", cmd[idx_input1:idx_input2])

if __name__ == "__main__":
    unittest.main()
