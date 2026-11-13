import os
import sys
import unittest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

import pytest


class TestSignalWatchdogBackend(unittest.TestCase):
    def setUp(self):
        from core.process_manager import ProcessManager
        self.mock_session_factory = MagicMock()
        self.pm = ProcessManager(self.mock_session_factory)

    def test_stderr_parsing_silence_freeze_and_black_events(self):
        pid = 101
        self.pm.log_buffers[pid] = []

        self.pm._handle_log_msg(pid, "[Parsed_silencedetect_0 @ 0x1] silence_start: 12.5", None)
        st = self.pm.get_signal_watchdog_state(pid)
        self.assertTrue(st["silence"])

        self.pm._handle_log_msg(pid, "[Parsed_silencedetect_0 @ 0x1] silence_end: 20.0 | silence_duration: 7.5", None)
        st = self.pm.get_signal_watchdog_state(pid)
        self.assertFalse(st["silence"])

        self.pm._handle_log_msg(pid, "[Parsed_freezedetect_1 @ 0x2] lavfi.freezedetect.freeze_start: 30.0", None)
        self.assertTrue(self.pm.get_signal_watchdog_state(pid)["freeze"])

        self.pm._handle_log_msg(pid, "[Parsed_freezedetect_1 @ 0x2] lavfi.freezedetect.freeze_end: 36.0", None)
        self.assertFalse(self.pm.get_signal_watchdog_state(pid)["freeze"])

        self.pm._handle_log_msg(pid, "[Parsed_metadata_2 @ 0x3] lavfi.black_start=40.0", None)
        self.assertIsNotNone(self.pm.get_signal_watchdog_state(pid)["black_since"])

        self.pm._handle_log_msg(pid, "[Parsed_metadata_3 @ 0x4] lavfi.black_end=45.0", None)
        st = self.pm.get_signal_watchdog_state(pid)
        self.assertIsNone(st["black_since"])
        self.assertFalse(st["black"])

    def test_or_and_evaluation_and_hysteresis_recovery(self):
        import asyncio

        async def _run():
            proc_id = 202
            media_proc = MagicMock()
            media_proc.id = proc_id
            media_proc.name = "Main Stream"
            media_proc.service_type = "ffmpeg_stream"
            media_proc.input_config = {"has_video": True, "has_audio": True}
            media_proc.codec_config = {"vcodec": "libx264", "acodec": "aac"}
            media_proc.config = {
                "signal_watchdog": {
                    "silence_enabled": True,
                    "black_enabled": True,
                    "black_duration": 5,
                    "condition_logic": "or",
                    "recovery_delay": 10,
                    "reaction_mode": "alert_only",
                }
            }
            session = MagicMock()
            start_time = datetime.utcnow() - timedelta(seconds=60)

            # 1. Trigger silence -> alarm
            self.pm._handle_log_msg(proc_id, "silence_start: 50", None)
            await self.pm._evaluate_signal_watchdog(proc_id, media_proc, None, 9999, start_time, session)
            st = self.pm.get_signal_watchdog_state(proc_id)
            self.assertEqual(st["state"], "alarm")
            self.assertIn("silence", st["tripped_sensors"])

            # 2. Clear silence -> recovering (NOT normal yet)
            self.pm._handle_log_msg(proc_id, "silence_end: 65 | silence_duration: 15", None)
            await self.pm._evaluate_signal_watchdog(proc_id, media_proc, None, 9999, start_time, session)
            st = self.pm.get_signal_watchdog_state(proc_id)
            self.assertEqual(st["state"], "recovering")

            # 3. Re-trip before recovery_delay -> back to alarm
            self.pm._handle_log_msg(proc_id, "silence_start: 68", None)
            await self.pm._evaluate_signal_watchdog(proc_id, media_proc, None, 9999, start_time, session)
            self.assertEqual(self.pm.get_signal_watchdog_state(proc_id)["state"], "alarm")

            # 4. Clear again and simulate elapsed recovery_delay -> normal
            self.pm._handle_log_msg(proc_id, "silence_end: 70 | silence_duration: 2", None)
            await self.pm._evaluate_signal_watchdog(proc_id, media_proc, None, 9999, start_time, session)
            self.pm.signal_watchdog_states[proc_id]["recovering_since"] = datetime.utcnow() - timedelta(seconds=12)
            await self.pm._evaluate_signal_watchdog(proc_id, media_proc, None, 9999, start_time, session)
            self.assertEqual(self.pm.get_signal_watchdog_state(proc_id)["state"], "normal")

            # 5. AND mode requires both silence and black
            media_proc.config["signal_watchdog"]["condition_logic"] = "and"
            self.pm._handle_log_msg(proc_id, "silence_start: 80", None)
            await self.pm._evaluate_signal_watchdog(proc_id, media_proc, None, 9999, start_time, session)
            self.assertEqual(self.pm.get_signal_watchdog_state(proc_id)["state"], "normal")

            self.pm.signal_watchdog_states[proc_id]["black_since"] = datetime.utcnow() - timedelta(seconds=6)
            await self.pm._evaluate_signal_watchdog(proc_id, media_proc, None, 9999, start_time, session)
            self.assertEqual(self.pm.get_signal_watchdog_state(proc_id)["state"], "alarm")

        asyncio.run(_run())

    def test_failover_backup_lease_and_1hop_antiflap(self):
        import asyncio

        async def _run():
            proc_id = 303
            backup_id = 304
            media_proc = MagicMock()
            media_proc.id = proc_id
            media_proc.name = "Studio Primary"
            media_proc.service_type = "ffmpeg_stream"
            media_proc.input_config = {"has_video": False, "has_audio": True}
            media_proc.codec_config = {"acodec": "aac"}
            media_proc.config = {
                "signal_watchdog": {
                    "silence_enabled": True,
                    "condition_logic": "or",
                    "recovery_delay": 5,
                    "reaction_mode": "activate_backup",
                    "backup_service_id": backup_id,
                }
            }
            session = MagicMock()
            backup_svc = MagicMock()
            backup_svc.name = "Emergency Loop"
            session.query.return_value.get.return_value = backup_svc
            start_time = datetime.utcnow() - timedelta(seconds=60)

            self.pm.acquire_lease = AsyncMock(return_value=True)
            self.pm.release_lease = AsyncMock(return_value=True)

            # Alarm -> acquires failover:303 lease on backup_id 304
            self.pm._handle_log_msg(proc_id, "silence_start: 10", None)
            await self.pm._evaluate_signal_watchdog(proc_id, media_proc, None, 9999, start_time, session)
            self.pm.acquire_lease.assert_awaited_once_with(
                backup_id,
                consumer_type="failover",
                consumer_id=proc_id,
                allow_auto_start=True,
                lease_holder=f"failover:{proc_id}",
            )

            # Recovery -> releases failover:303 lease
            self.pm._handle_log_msg(proc_id, "silence_end: 25 | silence_duration: 15", None)
            await self.pm._evaluate_signal_watchdog(proc_id, media_proc, None, 9999, start_time, session)
            self.pm.signal_watchdog_states[proc_id]["recovering_since"] = datetime.utcnow() - timedelta(seconds=6)
            await self.pm._evaluate_signal_watchdog(proc_id, media_proc, None, 9999, start_time, session)
            self.pm.release_lease.assert_awaited_once_with(
                backup_id,
                consumer_type="failover",
                consumer_id=proc_id,
                allow_auto_stop=True,
                lease_holder=f"failover:{proc_id}",
            )

            # 1-hop anti-cascade: if proc_id itself is running on a failover:* lease and not pinned, suppress backup
            self.pm.acquire_lease.reset_mock()
            with self.pm.dependency_manager.state_lock:
                self.pm.dependency_manager.active_leases[proc_id] = {"failover:999"}
                self.pm.dependency_manager.pinned_services.discard(proc_id)
            self.pm._handle_log_msg(proc_id, "silence_start: 50", None)
            await self.pm._evaluate_signal_watchdog(proc_id, media_proc, None, 9999, start_time, session)
            self.pm.acquire_lease.assert_not_awaited()
            with self.pm.dependency_manager.state_lock:
                self.pm.dependency_manager.active_leases.pop(proc_id, None)

        asyncio.run(_run())

    def test_signal_alarm_email_coalescing_and_prometheus_export(self):
        from core.notification_manager import NotificationManager
        from core.prometheus_exporter import build_openmetrics_payload

        nm = NotificationManager()
        nm._signal_alarm_services.clear()
        nm.config["enabled"] = True
        nm.config["notify_service_failures"] = True
        nm.enqueue_notification = MagicMock()

        sent_1 = nm.notify_signal_alarm(1, "Main", ["silence"], "activate_backup", "Backup")
        sent_2 = nm.notify_signal_alarm(1, "Main", ["silence"], "activate_backup", "Backup")
        self.assertTrue(sent_1)
        self.assertFalse(sent_2)
        self.assertEqual(nm.enqueue_notification.call_count, 1)

        rec_1 = nm.notify_signal_recovery(1, "Main", "activate_backup", "Backup")
        rec_2 = nm.notify_signal_recovery(1, "Main", "activate_backup", "Backup")
        self.assertTrue(rec_1)
        self.assertFalse(rec_2)
        self.assertEqual(nm.enqueue_notification.call_count, 2)

        svc = MagicMock()
        svc.id = 1
        svc.name = "Main"
        svc.alias = "Main"
        svc.service_type = "ffmpeg_stream"
        svc.status = "running"
        svc.cpu_usage = 5
        svc.ram_usage = 100
        svc.restart_count = 0
        svc.last_start = None
        svc.fps = "25.0"
        svc.bitrate = "1000kbits/s"
        svc.speed = "1.0x"
        svc.input_config = {"has_video": True, "has_audio": True}
        svc.codec_config = {"vcodec": "libx264", "acodec": "aac"}
        svc.config = {"signal_watchdog": {"silence_enabled": True}}

        self.pm.signal_watchdog_states[1] = {"state": "alarm"}
        payload = build_openmetrics_payload([svc], process_manager=self.pm)
        self.assertIn('ffmpeg_gui_service_signal_alarm{id="1",name="Main",type="ffmpeg_stream"} 1.0', payload)
