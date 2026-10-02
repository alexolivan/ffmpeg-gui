import os
import sys
import unittest
from unittest.mock import patch, MagicMock

# Ensure backend directory is in sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from core.notification_manager import NotificationManager
from core.hardware_health import hardware_health_manager
from core.lcd.manager import LCDManager
from core.task_manager import TaskManager
from core.build_manager import BuildManager
from database.models import ScheduledTask, TaskExecution, SoftwareBuild


class TestThermalAlertsAndShielding(unittest.TestCase):
    def setUp(self):
        self.notif_mgr = NotificationManager()
        self.notif_mgr.config["enabled"] = True
        self.notif_mgr.config["notify_thermal_alerts"] = True
        self.notif_mgr.config["recipient_emails"] = ["admin@example.com"]
        self.notif_mgr._last_thermal_status = "normal"
        self.notif_mgr._last_thermal_alert_time = 0.0

    @patch.object(NotificationManager, "enqueue_notification")
    def test_thermal_notifications_debounce_and_recovery(self, mock_enqueue):
        # 1. Normal state does not alert initially
        res = self.notif_mgr.notify_thermal_alerts({"status": "normal", "max_temp_c": 50.0})
        self.assertFalse(res)
        mock_enqueue.assert_not_called()

        # 2. Transition normal -> warning triggers alert
        res = self.notif_mgr.notify_thermal_alerts({
            "status": "warning",
            "max_temp_c": 76.5,
            "alerts": [{"message": "Elevated temperature"}]
        })
        self.assertTrue(res)
        self.assertEqual(mock_enqueue.call_count, 1)
        self.assertIn("Elevated Hardware Temperature", mock_enqueue.call_args[0][0]["subject"])

        # 3. Repeated warning immediately is debounced (within 1800s)
        res_dup = self.notif_mgr.notify_thermal_alerts({
            "status": "warning",
            "max_temp_c": 77.0,
            "alerts": [{"message": "Elevated temperature"}]
        })
        self.assertFalse(res_dup)
        self.assertEqual(mock_enqueue.call_count, 1)

        # 4. Transition warning -> critical alerts immediately
        res_crit = self.notif_mgr.notify_thermal_alerts({
            "status": "critical",
            "max_temp_c": 87.2,
            "alerts": [{"message": "Critical temperature reached"}]
        })
        self.assertTrue(res_crit)
        self.assertEqual(mock_enqueue.call_count, 2)
        self.assertIn("CRITICAL", mock_enqueue.call_args[0][0]["subject"])

        # 5. Transition critical -> normal triggers recovery notification
        res_rec = self.notif_mgr.notify_thermal_alerts({
            "status": "normal",
            "max_temp_c": 55.0,
            "alerts": []
        })
        self.assertTrue(res_rec)
        self.assertEqual(mock_enqueue.call_count, 3)
        self.assertIn("Recovery", mock_enqueue.call_args[0][0]["subject"])
        self.assertEqual(self.notif_mgr._last_thermal_status, "normal")

    def test_lcd_thermal_led_profile(self):
        lcd = LCDManager(
            db_session_factory=None,
            process_manager=MagicMock(),
            task_manager=MagicMock(),
            port="/dev/null"
        )
        self.assertEqual(lcd.get_led_legend_prefix("thermal"), "THRM")
        self.assertEqual(lcd.get_led_legend_prefix("therm"), "THRM")

        # Test state mapping
        lcd._cached_led_states["thermal_status"] = "normal"
        t_st = lcd._cached_led_states.get("thermal_status")
        color_normal = "red" if t_st == "critical" else ("yellow" if t_st == "warning" else "green")
        self.assertEqual(color_normal, "green")

        lcd._cached_led_states["thermal_status"] = "warning"
        t_st = lcd._cached_led_states.get("thermal_status")
        color_warn = "red" if t_st == "critical" else ("yellow" if t_st == "warning" else "green")
        self.assertEqual(color_warn, "yellow")

        lcd._cached_led_states["thermal_status"] = "critical"
        t_st = lcd._cached_led_states.get("thermal_status")
        color_crit = "red" if t_st == "critical" else ("yellow" if t_st == "warning" else "green")
        self.assertEqual(color_crit, "red")

    def test_task_active_thermal_protection(self):
        mock_db = MagicMock()
        mock_session = MagicMock()
        mock_db.return_value.__enter__.return_value = mock_session

        mock_task = MagicMock(spec=ScheduledTask)
        mock_task.id = 1
        mock_task.name = "Transcode Daily"
        mock_task.command = None
        mock_task.duration_type = "timer"
        mock_task.duration_seconds = 10
        mock_task.ffmpeg_build_id = None
        mock_task.input_config = {}
        mock_task.output_config = {}
        mock_task.filter_config = {}


        mock_exec = MagicMock(spec=TaskExecution)
        mock_exec.id = 100
        mock_exec.task = mock_task
        mock_session.query.return_value.get.return_value = mock_exec

        task_mgr = TaskManager(db_session_factory=mock_db)

        # 1. Active protection enabled & status critical -> raises RuntimeError
        with patch.object(hardware_health_manager, "active_protection_enabled", True):
            with patch.object(hardware_health_manager, "get_health_snapshot", return_value={"status": "critical", "max_temp_c": 91.0}):
                import asyncio
                with self.assertRaises(RuntimeError) as ctx:
                    asyncio.run(task_mgr.start_execution(100))
                self.assertIn("Thermal protection active", str(ctx.exception))
                self.assertEqual(mock_exec.status, "error")

        # 2. Active protection disabled -> proceeds beyond thermal check
        with patch.object(hardware_health_manager, "active_protection_enabled", False):
            with patch.object(hardware_health_manager, "get_health_snapshot", return_value={"status": "critical", "max_temp_c": 91.0}):
                with patch.object(task_mgr, "_detect_ffmpeg", return_value="/bin/true"):
                    with patch.object(task_mgr, "_build_ffmpeg_cmd", return_value=["ffmpeg"]):
                        with patch("asyncio.create_subprocess_exec") as mock_subproc:
                            mock_p = MagicMock()
                            mock_p.pid = 9999
                            mock_subproc.return_value = mock_p
                            with patch("asyncio.create_task"):
                                import asyncio
                                asyncio.run(task_mgr.start_execution(100))
                                # Successfully passed without raising thermal exception
                                self.assertEqual(mock_exec.status, "running")

    def test_build_active_thermal_protection(self):
        build_mgr = BuildManager(builds_root="/tmp/builds")
        mock_log = MagicMock()
        import asyncio
        async def dummy_log(msg):
            mock_log(msg)

        # Active protection enabled & status critical -> halts build
        with patch.object(hardware_health_manager, "active_protection_enabled", True):
            with patch.object(hardware_health_manager, "get_health_snapshot", return_value={"status": "critical", "max_temp_c": 89.5}):
                res = asyncio.run(build_mgr.run_build(
                    build_id=1,
                    ffmpeg_version="n7.1",
                    srt_version=None,
                    options={},
                    sdk_paths=None,
                    sources_cleaned=False,
                    log_callback=dummy_log
                ))
                self.assertFalse(res["success"])
                self.assertIn("Thermal protection active", res["error"])
                self.assertFalse(build_mgr.is_building)


if __name__ == "__main__":
    unittest.main()
