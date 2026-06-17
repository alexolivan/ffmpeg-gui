import unittest
import asyncio
from unittest.mock import patch, MagicMock
from database.db import SessionLocal, init_db
from database.models import MediaProcess
from core.process_manager import ProcessManager

class TestProcessManagerRestarts(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        init_db()
        self.db = SessionLocal()
        self.manager = ProcessManager(lambda: SessionLocal())

    async def asyncTearDown(self):
        # Cancel any leftover pending restarts to clean up tasks
        for task in list(self.manager.pending_restarts.values()):
            task.cancel()
        self.db.close()

    @patch("asyncio.create_subprocess_exec")
    async def test_watchdog_restart_flow_and_cancellation(self, mock_exec):
        # 1. Create a mocked process that exits immediately with exit code 1
        mock_proc = MagicMock()
        mock_proc.pid = 12345
        mock_proc.returncode = 1
        mock_proc.stdin = MagicMock()

        # Mock wait and communication
        async def mock_wait():
            return 1
        mock_proc.wait = mock_wait

        # Mock stderr.read to return b"" to avoid TypeError in log reader
        mock_proc.stderr = MagicMock()
        async def mock_read(n):
            return b""
        mock_proc.stderr.read = mock_read

        async def mock_create(*args, **kwargs):
            return mock_proc
        mock_exec.side_effect = mock_create

        # Create a test media process in DB
        media_proc = MediaProcess(
            name="Test Restart Process",
            type="service",
            input_config={"type": "lavfi", "path": "testsrc"},
            output_config={"type": "file", "path": "/tmp/test_pm_out.mp4"},
            codec_config={"vcodec": "libx264"},
            status="pending",
            watchdog_enabled=True,
            watchdog_retries=3
        )
        self.db.add(media_proc)
        self.db.commit()
        self.db.refresh(media_proc)

        try:
            # Start the process. It will run, fail immediately (returncode=1),
            # and schedule a restart in 5 seconds.
            await self.manager.start_process(media_proc.id)
            
            # Give a tiny slice of CPU time to let the watchdog task run and schedule the delayed restart
            await asyncio.sleep(0.2)
            
            # Verify that it scheduled a delayed restart and it is tracked
            self.assertIn(media_proc.id, self.manager.pending_restarts)
            restart_task = self.manager.pending_restarts[media_proc.id]
            self.assertFalse(restart_task.done())

            # Now, stop the process manually. This should cancel the pending restart!
            await self.manager.stop_process(media_proc.id)
            
            # Give the event loop time to handle the cancellation raise
            await asyncio.sleep(0.1)
            
            # Verify it was cancelled and removed from tracked tasks
            self.assertNotIn(media_proc.id, self.manager.pending_restarts)
            self.assertTrue(restart_task.cancelled() or restart_task.done())

        finally:
            self.db.delete(media_proc)
            self.db.commit()

    @patch("asyncio.create_subprocess_exec")
    async def test_delayed_restart_aborts_on_stopped_db_status(self, mock_exec):
        # 1. Create a media process
        media_proc = MediaProcess(
            name="Test Restart Process Abort",
            type="service",
            input_config={"type": "lavfi", "path": "testsrc"},
            output_config={"type": "file", "path": "/tmp/test_pm_out_abort.mp4"},
            codec_config={"vcodec": "libx264"},
            status="stopped", # Explicitly stopped!
            watchdog_enabled=True,
            watchdog_retries=3
        )
        self.db.add(media_proc)
        self.db.commit()
        self.db.refresh(media_proc)

        try:
            # Trigger delayed_restart directly to verify it aborts and doesn't call start_process
            # because status is 'stopped' in DB
            with patch.object(self.manager, "start_process") as mock_start:
                with patch("asyncio.sleep", return_value=None):
                    await self.manager._delayed_restart(media_proc.id)
                    mock_start.assert_not_called()

        finally:
            self.db.delete(media_proc)
            self.db.commit()

    @patch("asyncio.create_subprocess_exec")
    async def test_watchdog_does_not_overwrite_restarted_process_status(self, mock_exec):
        media_proc = MediaProcess(
            name="Test Stale Watchdog Avoidance",
            type="service",
            input_config={"type": "lavfi", "path": "testsrc"},
            output_config={"type": "file", "path": "/tmp/test_pm_out_stale.mp4"},
            codec_config={"vcodec": "libx264"},
            status="running",
            pid=99999,
            watchdog_enabled=True,
            watchdog_retries=3
        )
        self.db.add(media_proc)
        self.db.commit()
        self.db.refresh(media_proc)

        try:
            # 1. Create a mocked old process
            mock_proc_old = MagicMock()
            mock_proc_old.pid = 99999
            mock_proc_old.returncode = 0
            
            async def mock_wait():
                return 0
            mock_proc_old.wait = mock_wait

            # 2. Simulate watchdog running for mock_proc_old.
            # But in the meantime, self.manager.processes[media_proc.id] has a different process
            # (simulating that it restarted and has a new mock process object)
            mock_proc_new = MagicMock()
            mock_proc_new.pid = 88888
            self.manager.processes[media_proc.id] = mock_proc_new

            # 3. Call _watchdog's body or directly run the finally block of _watchdog by calling it
            # and letting it finish.
            with patch("psutil.Process") as mock_psutil:
                # Make psutil raise NoSuchProcess so the main loop exits immediately
                import psutil
                mock_psutil.side_effect = psutil.NoSuchProcess(pid=99999)
                
                await self.manager._watchdog(media_proc.id, mock_proc_old)

            # 4. Check that the DB still shows pid=99999 (meaning the stale watchdog did NOT overwrite it to None)
            self.db.refresh(media_proc)
            self.assertEqual(media_proc.pid, 99999)
            self.assertEqual(media_proc.status, "running")

        finally:
            self.db.delete(media_proc)
            self.db.commit()
