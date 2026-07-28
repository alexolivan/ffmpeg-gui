import unittest
from unittest.mock import patch, MagicMock
import asyncio
from core.notification_manager import NotificationManager

class TestNotificationHooks(unittest.TestCase):
    def setUp(self):
        NotificationManager._instance = None
        self.notification_manager = NotificationManager()
        self.notification_manager.load_config({"enabled": True})

    def tearDown(self):
        NotificationManager._instance = None

    @patch("core.notification_manager.NotificationManager.enqueue_notification")
    @patch("core.notification_manager.NotificationManager.should_notify_service_failure")
    def test_service_failure_and_recovery_hooks(self, mock_should_notify, mock_enqueue):
        from core.process_manager import ProcessManager

        mock_db_factory = MagicMock()
        pm = ProcessManager(db_session_factory=mock_db_factory)

        # Test crash hook trigger
        mock_should_notify.return_value = True
        pm.notify_service_crash(process_id=1, process_name="Test Stream", exit_code=1)

        mock_should_notify.assert_called_with(
            proc_id=1, proc_name="Test Stream", is_initial_crash=True, is_recovered=False
        )
        mock_enqueue.assert_called_once()
        self.assertIn("Service Failure", mock_enqueue.call_args[0][0]["subject"])

        # Reset mocks and test recovery hook trigger
        mock_enqueue.reset_mock()
        mock_should_notify.reset_mock()
        mock_should_notify.return_value = True

        pm.notify_service_recovery(process_id=1, process_name="Test Stream")

        mock_should_notify.assert_called_with(
            proc_id=1, proc_name="Test Stream", is_initial_crash=False, is_recovered=True
        )
        mock_enqueue.assert_called_once()
        self.assertIn("Service Recovered", mock_enqueue.call_args[0][0]["subject"])

    @patch("core.notification_manager.NotificationManager.enqueue_notification")
    def test_task_execution_failure_hook(self, mock_enqueue):
        from core.task_manager import TaskManager

        mock_db_factory = MagicMock()
        tm = TaskManager(db_session_factory=mock_db_factory)

        tm.notify_task_failure(execution_id=42, task_name="Nightly Transcode", error_msg="Input file missing")

        mock_enqueue.assert_called_once()
        call_event = mock_enqueue.call_args[0][0]
        self.assertIn("Task Execution Failed", call_event["subject"])
        self.assertIn("Nightly Transcode", call_event["body"])

    @patch("core.notification_manager.NotificationManager.enqueue_notification")
    def test_build_result_hook(self, mock_enqueue):
        import main

        main.notify_build_result(build_id=10, build_name="Custom FFmpeg 6.1", success=True)
        mock_enqueue.assert_called_once()
        self.assertIn("Build Ready", mock_enqueue.call_args[0][0]["subject"])

        mock_enqueue.reset_mock()
        main.notify_build_result(build_id=10, build_name="Custom FFmpeg 6.1", success=False, error_msg="Compilation failed")
        mock_enqueue.assert_called_once()
        self.assertIn("Build Failed", mock_enqueue.call_args[0][0]["subject"])

    @patch("core.notification_manager.NotificationManager.enqueue_notification")
    def test_ssl_warning_hook(self, mock_enqueue):
        import main

        main.notify_ssl_warning(domain="stream.example.com", days_remaining=10)
        mock_enqueue.assert_called_once()
        call_event = mock_enqueue.call_args[0][0]
        self.assertIn("SSL Certificate Warning", call_event["subject"])
        self.assertIn("stream.example.com", call_event["body"])

    @patch("core.notification_manager.NotificationManager.enqueue_notification")
    def test_storage_alert_hook(self, mock_enqueue):
        import main

        main.notify_storage_alert(storage_id=3, storage_name="Logs Storage", storage_path="/mnt/logs", percent=92.5)
        mock_enqueue.assert_called_once()
        call_event = mock_enqueue.call_args[0][0]
        self.assertIn("Storage Space Warning", call_event["subject"])
        self.assertIn("92.5%", call_event["body"])

if __name__ == "__main__":
    unittest.main()
