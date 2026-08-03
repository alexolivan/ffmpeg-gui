import unittest
from unittest.mock import patch, MagicMock
import psutil
import signal
from utils.process_utils import cleanup_rogue_processes

class TestProcessUtils(unittest.TestCase):
    @patch('psutil.process_iter')
    def test_cleanup_rogue_processes(self, mock_iter):
        # Mock processes
        mock_proc1 = MagicMock()
        mock_proc1.info = {'pid': 101, 'name': 'ffmpeg'}
        mock_proc1.environ.return_value = {"FFMPEG_GUI_PROCESS_ID": "5"}

        mock_proc2 = MagicMock()
        mock_proc2.info = {'pid': 102, 'name': 'ffmpeg'}
        mock_proc2.environ.return_value = {"FFMPEG_GUI_EXECUTION_ID": "42"}

        mock_proc3 = MagicMock()
        mock_proc3.info = {'pid': 103, 'name': 'ffmpeg'}
        mock_proc3.environ.return_value = {}  # User-run ffmpeg

        mock_proc4 = MagicMock()
        mock_proc4.info = {'pid': 104, 'name': 'nginx'}  # Other service
        mock_proc4.environ.return_value = {}

        mock_iter.return_value = [mock_proc1, mock_proc2, mock_proc3, mock_proc4]

        # Test case 1: target process_id = 5
        cleanup_rogue_processes(process_id=5)
        mock_proc1.send_signal.assert_called_once_with(signal.SIGKILL)
        mock_proc2.send_signal.assert_not_called()

        # Reset mocks
        mock_proc1.reset_mock()
        mock_proc2.reset_mock()

        # Test case 2: target execution_id = 42
        cleanup_rogue_processes(execution_id=42)
        mock_proc1.send_signal.assert_not_called()
        mock_proc2.send_signal.assert_called_once_with(signal.SIGKILL)

        # Reset mocks
        mock_proc1.reset_mock()
        mock_proc2.reset_mock()

        # Test case 3: Startup cleanup with active PIDs = {101}
        cleanup_rogue_processes(active_pids={101})
        mock_proc1.send_signal.assert_not_called()  # Active, do not kill
        mock_proc2.send_signal.assert_called_once_with(signal.SIGKILL)  # Stale, kill

    def test_prepare_process_file_permissions(self):
        import os
        from utils.process_utils import prepare_process_file_permissions
        proc_id = 9999
        prepare_process_file_permissions(process_id=proc_id)

        shm_log = f"/dev/shm/ffmpeg_progress_{proc_id}.log"
        tmp_log = f"/tmp/ffmpeg_progress_{proc_id}.log"
        preview_img = f"/tmp/ffmpeg-gui-previews/preview_{proc_id}.jpg"

        self.assertTrue(os.path.exists(shm_log) or os.path.exists(tmp_log))
        if os.path.exists(shm_log):
            mode = os.stat(shm_log).st_mode & 0o777
            self.assertEqual(mode, 0o666)
            os.remove(shm_log)
        if os.path.exists(tmp_log):
            mode = os.stat(tmp_log).st_mode & 0o777
            self.assertEqual(mode, 0o666)
            os.remove(tmp_log)
        if os.path.exists(preview_img):
            mode = os.stat(preview_img).st_mode & 0o777
            self.assertEqual(mode, 0o666)
            os.remove(preview_img)
