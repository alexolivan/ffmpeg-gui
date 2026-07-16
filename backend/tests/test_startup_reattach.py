import unittest
import asyncio
from unittest.mock import patch, MagicMock, AsyncMock
from database.db import SessionLocal, init_db
from database.models import MediaProcess
import main

class TestStartupReattach(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        init_db()
        self.db = SessionLocal()
        self.db.query(MediaProcess).delete()
        self.db.commit()

    async def asyncTearDown(self):
        self.db.query(MediaProcess).delete()
        self.db.commit()
        self.db.close()

    @patch("main.cleanup_rogue_processes")
    @patch("psutil.pid_exists")
    @patch("main.process_manager.reattach_process")
    async def test_startup_event_reattaches_alive_processes_and_stops_dead_ones(
        self, mock_reattach, mock_pid_exists, mock_cleanup
    ):
        # Setup mock behavior
        # Let's say PID 12345 exists, and PID 67890 does not
        def side_effect_pid_exists(pid):
            return pid == 12345
        mock_pid_exists.side_effect = side_effect_pid_exists

        # Create two running processes in DB
        alive_proc = MediaProcess(
            name="Alive Process",
            type="service",
            input_config={"type": "lavfi", "path": "testsrc"},
            output_config={"type": "file", "path": "/tmp/alive.mp4"},
            codec_config={},
            status="running",
            pid=12345
        )
        dead_proc = MediaProcess(
            name="Dead Process",
            type="service",
            input_config={"type": "lavfi", "path": "testsrc"},
            output_config={"type": "file", "path": "/tmp/dead.mp4"},
            codec_config={},
            status="running",
            pid=67890
        )
        self.db.add_all([alive_proc, dead_proc])
        self.db.commit()
        self.db.refresh(alive_proc)
        self.db.refresh(dead_proc)

        # Mock LCD manager start and scheduler to avoid side effects
        mock_sch = MagicMock()
        mock_sch.start = AsyncMock()
        with patch("main.lcd_manager") as mock_lcd, \
             patch("main.scheduler", mock_sch), \
             patch("main.telemetry_broadcast_loop") as mock_telemetry, \
             patch("main.auto_start_services") as mock_auto_start:
            
            # Execute the startup event
            await main.startup_event()

            # Verify alive process got reattached
            mock_reattach.assert_called_once_with(alive_proc.id, 12345)

            # Verify cleanup_rogue_processes called with active PIDs
            mock_cleanup.assert_called_once()
            _, kwargs = mock_cleanup.call_args
            self.assertIn("active_pids", kwargs)
            self.assertEqual(kwargs["active_pids"], {12345})

            # Refresh and check DB states
            self.db.refresh(alive_proc)
            self.db.refresh(dead_proc)

            # Alive process should remain running
            self.assertEqual(alive_proc.status, "running")
            self.assertEqual(alive_proc.pid, 12345)

            # Dead process should be stopped with PID cleared
            self.assertEqual(dead_proc.status, "stopped")
            self.assertIsNone(dead_proc.pid)
            self.assertEqual(dead_proc.cpu_usage, 0)
            self.assertEqual(dead_proc.ram_usage, 0)
            self.assertEqual(dead_proc.fps, "0")
            self.assertEqual(dead_proc.bitrate, "0 kb/s")
            self.assertEqual(dead_proc.speed, "0x")
