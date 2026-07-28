import unittest
import asyncio
from unittest.mock import patch, MagicMock
from core.notification_manager import NotificationManager

class TestNotificationManager(unittest.TestCase):
    def setUp(self):
        # Reset singleton instance between tests
        NotificationManager._instance = None
        self.manager = NotificationManager()

    def tearDown(self):
        if hasattr(self.manager, "_worker_task") and self.manager._worker_task:
            self.manager._worker_task.cancel()
        NotificationManager._instance = None

    def test_singleton(self):
        manager2 = NotificationManager()
        self.assertEqual(self.manager, manager2)

    def test_load_config(self):
        config_data = {
            "smtp_host": "smtp.example.com",
            "smtp_port": 587,
            "smtp_user": "user@example.com",
            "smtp_password": "secretpassword",
            "use_tls": True,
            "use_ssl": False,
            "sender_email": "alerts@example.com",
            "recipient_emails": ["admin@example.com", "ops@example.com"],
            "enabled": True,
        }
        self.manager.load_config(config_data)
        
        self.assertEqual(self.manager.config["smtp_host"], "smtp.example.com")
        self.assertEqual(self.manager.config["smtp_port"], 587)
        self.assertEqual(self.manager.config["smtp_user"], "user@example.com")
        self.assertEqual(self.manager.config["sender_email"], "alerts@example.com")
        self.assertEqual(len(self.manager.config["recipient_emails"]), 2)
        self.assertTrue(self.manager.is_enabled())

    def test_load_config_string_recipients(self):
        config_data = {
            "recipient_emails": "admin@example.com, ops@example.com  ,dev@example.com",
            "enabled": True,
        }
        self.manager.load_config(config_data)
        self.assertEqual(
            self.manager.config["recipient_emails"],
            ["admin@example.com", "ops@example.com", "dev@example.com"]
        )

    def test_state_based_coalescing(self):
        proc_id = 42
        proc_name = "Main Broadcast Stream"

        # 1. Initial crash -> should notify (True)
        should_notify_1 = self.manager.should_notify_service_failure(
            proc_id=proc_id,
            proc_name=proc_name,
            is_initial_crash=True,
            is_recovered=False
        )
        self.assertTrue(should_notify_1, "Initial crash should trigger notification")

        # 2. Subsequent watchdog crash while down -> silence (False)
        should_notify_2 = self.manager.should_notify_service_failure(
            proc_id=proc_id,
            proc_name=proc_name,
            is_initial_crash=False,
            is_recovered=False
        )
        self.assertFalse(should_notify_2, "Repeated crash while already failed should be silenced")

        # 3. Another repeat crash -> silence (False)
        should_notify_3 = self.manager.should_notify_service_failure(
            proc_id=proc_id,
            proc_name=proc_name,
            is_initial_crash=False,
            is_recovered=False
        )
        self.assertFalse(should_notify_3, "Subsequent crash attempts must remain silenced")

        # 4. Service Recovery -> should notify (True)
        should_notify_4 = self.manager.should_notify_service_failure(
            proc_id=proc_id,
            proc_name=proc_name,
            is_initial_crash=False,
            is_recovered=True
        )
        self.assertTrue(should_notify_4, "Recovery event should trigger notification")

        # 5. Subsequent recovery check when healthy -> silence (False)
        should_notify_5 = self.manager.should_notify_service_failure(
            proc_id=proc_id,
            proc_name=proc_name,
            is_initial_crash=False,
            is_recovered=True
        )
        self.assertFalse(should_notify_5, "Recovery when service is not in failed state should be silenced")

    def test_coalescing_multiple_processes(self):
        proc_1 = 101
        proc_2 = 102

        # Proc 1 crashes
        self.assertTrue(self.manager.should_notify_service_failure(proc_1, "Stream 1", True, False))
        # Proc 2 crashes
        self.assertTrue(self.manager.should_notify_service_failure(proc_2, "Stream 2", True, False))

        # Proc 1 repeat failure -> False
        self.assertFalse(self.manager.should_notify_service_failure(proc_1, "Stream 1", False, False))
        # Proc 2 recovers -> True
        self.assertTrue(self.manager.should_notify_service_failure(proc_2, "Stream 2", False, True))

        # Proc 1 recovers -> True
        self.assertTrue(self.manager.should_notify_service_failure(proc_1, "Stream 1", False, True))

    @patch("smtplib.SMTP")
    def test_send_test_email_success(self, mock_smtp_cls):
        mock_smtp_inst = MagicMock()
        mock_smtp_cls.return_value = mock_smtp_inst
        mock_smtp_inst.__enter__.return_value = mock_smtp_inst

        config = {
            "smtp_host": "smtp.test.com",
            "smtp_port": 587,
            "smtp_user": "testuser",
            "smtp_password": "testpass",
            "use_tls": True,
            "sender_email": "sender@test.com",
            "recipient_emails": ["recipient@test.com"],
            "enabled": True,
        }
        self.manager.load_config(config)

        success, msg = self.manager.send_test_email()
        self.assertTrue(success)
        self.assertIn("sent successfully", msg.lower())
        mock_smtp_inst.starttls.assert_called_once()
        mock_smtp_inst.login.assert_called_once_with("testuser", "testpass")
        mock_smtp_inst.send_message.assert_called_once()

    @patch("smtplib.SMTP")
    def test_send_test_email_override_config(self, mock_smtp_cls):
        mock_smtp_inst = MagicMock()
        mock_smtp_cls.return_value = mock_smtp_inst
        mock_smtp_inst.__enter__.return_value = mock_smtp_inst

        override_config = {
            "smtp_host": "override.smtp.com",
            "smtp_port": 25,
            "sender_email": "override@test.com",
            "recipient_emails": ["dest@test.com"],
            "enabled": True,
        }

        success, msg = self.manager.send_test_email(override_config=override_config)
        self.assertTrue(success)
        mock_smtp_cls.assert_called_once_with("override.smtp.com", 25, timeout=10)

    @patch("smtplib.SMTP")
    def test_send_test_email_failure(self, mock_smtp_cls):
        mock_smtp_cls.side_effect = Exception("Connection timed out")

        config = {
            "smtp_host": "unreachable.host",
            "smtp_port": 25,
            "sender_email": "sender@test.com",
            "recipient_emails": ["recipient@test.com"],
            "enabled": True,
        }
        self.manager.load_config(config)

        success, msg = self.manager.send_test_email()
        self.assertFalse(success)
        self.assertIn("Connection timed out", msg)

    def test_enqueue_and_worker_loop(self):
        async def run_async_test():
            with patch("smtplib.SMTP") as mock_smtp_cls:
                mock_smtp_inst = MagicMock()
                mock_smtp_cls.return_value = mock_smtp_inst
                mock_smtp_inst.__enter__.return_value = mock_smtp_inst

                self.manager.load_config({
                    "smtp_host": "smtp.test.com",
                    "smtp_port": 587,
                    "sender_email": "sender@test.com",
                    "recipient_emails": ["recip@test.com"],
                    "enabled": True,
                })

                # Start worker loop
                task = asyncio.create_task(self.manager._worker_loop())

                event = {
                    "subject": "Alert: Stream 1 Down",
                    "body": "Process 1 crashed at 10:00:00",
                    "recipients": ["ops@test.com"]
                }
                self.manager.enqueue_notification(event)

                # Wait for queue to be processed
                await self.manager._queue.join()
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

                mock_smtp_inst.send_message.assert_called_once()

        asyncio.run(run_async_test())

if __name__ == "__main__":
    unittest.main()
