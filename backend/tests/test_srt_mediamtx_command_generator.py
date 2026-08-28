import unittest
from unittest.mock import MagicMock, patch
import sys
import os

# Add backend directory to path
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from core.process_manager import ProcessManager
from core.task_manager import TaskManager


class TestSrtMediaMtxCommandGenerator(unittest.TestCase):
    def setUp(self):
        self.mock_session_factory = MagicMock()
        self.pm = ProcessManager(self.mock_session_factory)
        self.pm.ffmpeg_path = "ffmpeg"
        self.tm = TaskManager(self.mock_session_factory, ffmpeg_path="ffmpeg")

    @patch('utils.process_utils.get_ffmpeg_version')
    def test_srt_output_targeting_mediamtx_publish_no_auth(self, mock_version):
        mock_version.return_value = 5.0

        media_proc = MagicMock()
        media_proc.id = 101
        media_proc.type = "service"
        media_proc.input_config = {
            'type': 'file',
            'path': '/tmp/sample.mp4'
        }
        media_proc.codec_config = {
            'vcodec': 'libx264',
            'acodec': 'aac',
            'video_params': {},
            'audio_params': {}
        }
        media_proc.filter_config = {}
        media_proc.output_config = {
            'type': 'srt',
            'mode': 'caller',
            'host': '127.0.0.1',
            'port': '8890',
            'latency': 200,
            'path_id': 'tx_main',
            'mediamtx_mode': True
        }

        cmd = self.pm._build_ffmpeg_cmd(media_proc, "ffmpeg")
        cmd_str = " ".join(cmd)

        expected_url = "srt://127.0.0.1:8890?mode=caller&latency=200&streamid=#!::r=tx_main,m=publish"
        self.assertIn(expected_url, cmd_str)

    @patch('utils.process_utils.get_ffmpeg_version')
    def test_srt_output_targeting_mediamtx_publish_with_auth(self, mock_version):
        mock_version.return_value = 5.0

        media_proc = MagicMock()
        media_proc.id = 102
        media_proc.type = "service"
        media_proc.input_config = {
            'type': 'file',
            'path': '/tmp/sample.mp4'
        }
        media_proc.codec_config = {
            'vcodec': 'libx264',
            'acodec': 'aac',
            'video_params': {},
            'audio_params': {}
        }
        media_proc.filter_config = {}
        media_proc.output_config = {
            'type': 'srt',
            'mode': 'caller',
            'host': '127.0.0.1',
            'port': '8890',
            'latency': 200,
            'path_id': 'tx_main',
            'publish_user': 'studio_user',
            'publish_pass': 'studio_secret',
            'service_target': 'mediamtx'
        }

        cmd = self.pm._build_ffmpeg_cmd(media_proc, "ffmpeg")
        cmd_str = " ".join(cmd)

        expected_url = "srt://127.0.0.1:8890?mode=caller&latency=200&streamid=#!::r=tx_main,m=publish,u=studio_user,p=studio_secret"
        self.assertIn(expected_url, cmd_str)

    @patch('utils.process_utils.get_ffmpeg_version')
    def test_srt_input_pulling_from_mediamtx_request_no_auth(self, mock_version):
        mock_version.return_value = 5.0

        media_proc = MagicMock()
        media_proc.id = 103
        media_proc.type = "service"
        media_proc.input_config = {
            'type': 'srt',
            'mode': 'caller',
            'host': '127.0.0.1',
            'port': '8890',
            'latency': 250,
            'path_id': 'tx_main',
            'mediamtx_mode': True,
            'network_timeout': 15
        }
        media_proc.codec_config = {
            'vcodec': 'copy',
            'acodec': 'copy',
            'video_params': {},
            'audio_params': {}
        }
        media_proc.filter_config = {}
        media_proc.output_config = {
            'type': 'file',
            'path': '/tmp/output.ts'
        }

        cmd = self.pm._build_ffmpeg_cmd(media_proc, "ffmpeg")
        cmd_str = " ".join(cmd)

        expected_url = "srt://127.0.0.1:8890?mode=caller&latency=250&timeout=15000000&streamid=#!::r=tx_main,m=request"
        self.assertIn(expected_url, cmd_str)

    @patch('utils.process_utils.get_ffmpeg_version')
    def test_srt_input_pulling_from_mediamtx_request_with_auth(self, mock_version):
        mock_version.return_value = 5.0

        media_proc = MagicMock()
        media_proc.id = 104
        media_proc.type = "service"
        media_proc.input_config = {
            'type': 'srt',
            'mode': 'caller',
            'host': '127.0.0.1',
            'port': '8890',
            'latency': 250,
            'path_id': 'tx_main',
            'read_user': 'viewer_user',
            'read_pass': 'viewer_secret',
            'mediamtx_mode': True,
            'network_timeout': 15
        }
        media_proc.codec_config = {
            'vcodec': 'copy',
            'acodec': 'copy',
            'video_params': {},
            'audio_params': {}
        }
        media_proc.filter_config = {}
        media_proc.output_config = {
            'type': 'file',
            'path': '/tmp/output.ts'
        }

        cmd = self.pm._build_ffmpeg_cmd(media_proc, "ffmpeg")
        cmd_str = " ".join(cmd)

        expected_url = "srt://127.0.0.1:8890?mode=caller&latency=250&timeout=15000000&streamid=#!::r=tx_main,m=request,u=viewer_user,p=viewer_secret"
        self.assertIn(expected_url, cmd_str)

    @patch('utils.process_utils.get_ffmpeg_version')
    def test_standard_manual_srt_urls_backward_compatible(self, mock_version):
        mock_version.return_value = 5.0

        # Standard manual SRT output without MediaMTX mode
        media_proc = MagicMock()
        media_proc.id = 105
        media_proc.type = "service"
        media_proc.input_config = {
            'type': 'file',
            'path': '/tmp/sample.mp4'
        }
        media_proc.codec_config = {
            'vcodec': 'libx264',
            'acodec': 'aac',
            'video_params': {},
            'audio_params': {}
        }
        media_proc.filter_config = {}
        media_proc.output_config = {
            'type': 'srt',
            'mode': 'caller',
            'host': '1.2.3.4',
            'port': '9000',
            'latency': 2000000,
            'passphrase': 'secure_password',
            'pbkeylen': 16
        }

        cmd = self.pm._build_ffmpeg_cmd(media_proc, "ffmpeg")
        cmd_str = " ".join(cmd)

        expected_url = "srt://1.2.3.4:9000?mode=caller&latency=2000000&passphrase=secure_password&pbkeylen=16"
        self.assertIn(expected_url, cmd_str)
        self.assertNotIn("streamid=", cmd_str)

    def test_build_srt_url_helper_direct(self):
        # Direct tests of helper on ProcessManager and TaskManager
        out_cfg = {
            'host': '10.0.0.5',
            'port': 8890,
            'mode': 'caller',
            'latency': 180,
            'path_id': 'live_cam',
            'mediamtx_mode': True,
            'publish_user': 'cam_pub',
            'publish_pass': 'cam_pass'
        }
        url_pm = self.pm._build_srt_url(out_cfg, direction="output")
        url_tm = self.tm._build_srt_url(out_cfg, direction="output")

        expected = "srt://10.0.0.5:8890?mode=caller&latency=180&streamid=#!::r=live_cam,m=publish,u=cam_pub,p=cam_pass"
        self.assertEqual(url_pm, expected)
        self.assertEqual(url_tm, expected)

    @patch('utils.process_utils.get_ffmpeg_version')
    def test_task_manager_srt_mediamtx_command(self, mock_version):
        mock_version.return_value = 5.0

        task = MagicMock()
        task.id = 201
        task.type = "task"
        task.input_config = {
            'type': 'srt',
            'mode': 'caller',
            'host': '127.0.0.1',
            'port': '8890',
            'latency': 250,
            'path_id': 'ingest_task',
            'mediamtx_mode': True,
            'network_timeout': 10
        }
        task.codec_config = {
            'vcodec': 'copy',
            'acodec': 'copy',
            'video_params': {},
            'audio_params': {}
        }
        task.filter_config = {}
        task.output_config = {
            'type': 'srt',
            'mode': 'caller',
            'host': '127.0.0.1',
            'port': '8890',
            'latency': 200,
            'path_id': 'egress_task',
            'mediamtx_mode': True,
            'publish_user': 'task_pub',
            'publish_pass': 'task_secret'
        }

        cmd = self.tm._build_ffmpeg_cmd(task, "ffmpeg", limit_sec=30, execution_id=99)
        cmd_str = " ".join(cmd)

        expected_in = "srt://127.0.0.1:8890?mode=caller&latency=250&timeout=10000000&streamid=#!::r=ingest_task,m=request"
        expected_out = "srt://127.0.0.1:8890?mode=caller&latency=200&streamid=#!::r=egress_task,m=publish,u=task_pub,p=task_secret"

        self.assertIn(expected_in, cmd_str)
        self.assertIn(expected_out, cmd_str)
        self.assertIn("-t 30", cmd_str)


if __name__ == '__main__':
    unittest.main()
