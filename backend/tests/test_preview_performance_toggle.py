import unittest
import os
import tempfile
from unittest.mock import patch, MagicMock
from core.process_manager import ProcessManager
from core.builders.ffmpeg_builder import FFmpegCommandBuilder
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


class TestFFmpeg9ThreadQueueSize(unittest.TestCase):
    def setUp(self):
        FFmpegCommandBuilder._THREAD_QUEUE_SIZE_INPUT_CACHE.clear()
        self.manager = ProcessManager(lambda: None)
        self.tmp = tempfile.NamedTemporaryFile(delete=False)
        self.tmp.write(b"#!/bin/sh\n")
        self.tmp.close()
        self.dummy_bin = self.tmp.name

    def tearDown(self):
        FFmpegCommandBuilder._THREAD_QUEUE_SIZE_INPUT_CACHE.clear()
        if os.path.exists(self.dummy_bin):
            os.unlink(self.dummy_bin)

    def _build_dual_input_proc(self):
        return MediaProcess(
            id=21,
            name="Dual Input TQS",
            type="service",
            input_config={
                "has_video": True,
                "has_audio": True,
                "input1": {"type": "v4l2", "path": "/dev/video0"},
                "input2": {"type": "alsa", "path": "hw:0,0"},
                "use_secondary_input": True,
            },
            output_config={"type": "udp", "url": "udp://127.0.0.1:1234"},
            codec_config={"vcodec": "libx264", "acodec": "aac"},
            filter_config={"advanced": {"thread_queue_size": 8192}},
        )

    def test_ffmpeg9_omits_input_thread_queue_size(self):
        help_9_1 = MagicMock(
            stdout="-thread_queue_size  set the maximum number of queued packets per stream on the muxer\n",
            stderr="",
        )
        with patch("core.builders.ffmpeg_builder.subprocess.run", return_value=help_9_1):
            self.assertFalse(FFmpegCommandBuilder.supports_input_thread_queue_size(self.dummy_bin))
            cmd = self.manager._build_ffmpeg_cmd(self._build_dual_input_proc(), self.dummy_bin)
        self.assertNotIn("-thread_queue_size", cmd)

    def test_ffmpeg8_keeps_input_thread_queue_size(self):
        help_8_1 = MagicMock(
            stdout="-thread_queue_size  set the maximum number of queued packets from the demuxer\n",
            stderr="",
        )
        with patch("core.builders.ffmpeg_builder.subprocess.run", return_value=help_8_1):
            self.assertTrue(FFmpegCommandBuilder.supports_input_thread_queue_size(self.dummy_bin))
            cmd = self.manager._build_ffmpeg_cmd(self._build_dual_input_proc(), self.dummy_bin)
        input_indices = [i for i, arg in enumerate(cmd) if arg == "-i"]
        self.assertEqual(len(input_indices), 2)
        self.assertIn("-thread_queue_size", cmd[:input_indices[0]])
        self.assertIn("-thread_queue_size", cmd[input_indices[0]:input_indices[1]])

    def test_probe_result_cached_per_binary_mtime(self):
        help_9_1 = MagicMock(
            stdout="-thread_queue_size  set the maximum number of queued packets per stream on the muxer\n",
            stderr="",
        )
        with patch("core.builders.ffmpeg_builder.subprocess.run", return_value=help_9_1) as mock_run:
            self.assertFalse(FFmpegCommandBuilder.supports_input_thread_queue_size(self.dummy_bin))
            self.assertFalse(FFmpegCommandBuilder.supports_input_thread_queue_size(self.dummy_bin))
            self.assertEqual(mock_run.call_count, 1)


if __name__ == "__main__":
    unittest.main()
