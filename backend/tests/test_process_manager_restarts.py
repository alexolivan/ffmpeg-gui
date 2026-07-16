import unittest
import asyncio
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock, PropertyMock
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

    @patch("asyncio.create_subprocess_exec")
    async def test_watchdog_progress_stall_kill(self, mock_exec):
        class StubProcess:
            def __init__(self):
                self.pid = 12345
                self.returncode = None
                self.stdin = MagicMock()
                self.stderr = MagicMock()
                self.kill_called = False

                async def mock_read(n):
                    return b""
                self.stderr.read = mock_read

            def kill(self):
                self.kill_called = True
                self.returncode = -9

            async def wait(self):
                return self.returncode

        stub_proc = StubProcess()

        # Create a test media process in DB configured as service
        media_proc = MediaProcess(
            name="Watchdog Stall Service",
            type="service",
            input_config={"type": "lavfi", "path": "testsrc"},
            output_config={"type": "file", "path": "/tmp/test_watchdog_stall.mp4"},
            codec_config={"vcodec": "libx264"},
            status="running",
            watchdog_enabled=True,
            watchdog_retries=3,
            bitrate="0.0kbits/s",
            fps="0"
        )
        self.db.add(media_proc)
        self.db.commit()
        self.db.refresh(media_proc)

        self.manager.processes[media_proc.id] = stub_proc

        import os
        shm_path = f"/dev/shm/ffmpeg_progress_{media_proc.id}.log"
        tmp_path = f"/tmp/ffmpeg_progress_{media_proc.id}.log"
        if os.path.exists("/dev/shm") and os.access("/dev/shm", os.W_OK):
            progress_path = shm_path
        else:
            progress_path = tmp_path

        # Helper to write progress log file
        def write_progress(frame, fps, bitrate, speed, out_time_us):
            content = f"frame={frame}\nfps={fps}\nbitrate={bitrate}\nspeed={speed}\nout_time_us={out_time_us}\nprogress=continue\n"
            with open(progress_path, "w") as f:
                f.write(content)

        # Start by cleanup in case file exists
        if os.path.exists(progress_path):
            os.remove(progress_path)

        try:
            with patch("psutil.Process") as mock_psutil:
                mock_p = MagicMock()
                mock_p.cpu_percent.return_value = 5.0
                mock_p.memory_info.return_value.rss = 100 * 1024 * 1024
                mock_psutil.return_value = mock_p

                sleep_count = 0
                async def mock_sleep(delay):
                    nonlocal sleep_count
                    sleep_count += 1
                    if sleep_count == 1:
                        # Write initial activity
                        write_progress(frame=100, fps="25.0", bitrate="1500kbits/s", speed="1.0x", out_time_us=4000000)
                    elif sleep_count == 2:
                        # Write same activity (stall begins)
                        write_progress(frame=100, fps="25.0", bitrate="1500kbits/s", speed="1.0x", out_time_us=4000000)
                    elif sleep_count >= 3:
                        # Continue sleep and let the loop run
                        pass

                from datetime import timedelta
                now = datetime.utcnow()
                time_points = [
                    now,                        # Setup/init
                    now,                        # Loop 1 check running
                    now,                        # Loop 1 update DB & check stall
                    now + timedelta(seconds=2), # Loop 2 check running
                    now + timedelta(seconds=2), # Loop 2 update DB & check stall
                    now + timedelta(seconds=4), # Loop 3 check running
                    now + timedelta(seconds=25),# Loop 3 update DB & check stall (elapsed > 15s)
                    now + timedelta(seconds=27),# Loop 4 check running
                ]
                time_iter = iter(time_points)
                def mock_utcnow():
                    try:
                        return next(time_iter)
                    except StopIteration:
                        return datetime.utcnow() + timedelta(seconds=100)

                with patch("core.process_manager.datetime") as mock_dt, patch("asyncio.sleep", side_effect=mock_sleep):
                    mock_dt.utcnow = mock_utcnow
                    mock_dt.fromisoformat = datetime.fromisoformat
                    
                    await self.manager._watchdog(media_proc.id, stub_proc)

                # Check if stub_proc.kill() was called due to stall
                self.assertTrue(stub_proc.kill_called)

                # Refresh and verify stats in DB
                self.db.refresh(media_proc)
                self.assertEqual(media_proc.fps, "0")
                self.assertEqual(media_proc.bitrate, "0 kb/s")
                self.assertEqual(media_proc.speed, "0x")

        finally:
            if os.path.exists(progress_path):
                os.remove(progress_path)
            self.db.delete(media_proc)
            self.db.commit()

    @patch("asyncio.create_subprocess_exec")
    async def test_unexpected_exit_code_zero_triggers_restart(self, mock_exec):
        # 1. Create a mocked process that exits with code 0 unexpectedly
        mock_proc = MagicMock()
        mock_proc.pid = 99911
        mock_proc.returncode = 0
        mock_proc.stdin = MagicMock()

        async def mock_wait():
            return 0
        mock_proc.wait = mock_wait

        mock_proc.stderr = MagicMock()
        async def mock_read(n):
            return b""
        mock_proc.stderr.read = mock_read

        media_proc = MediaProcess(
            name="Test Exit Code 0 Service",
            type="service",
            input_config={"type": "lavfi", "path": "testsrc"},
            output_config={"type": "file", "path": "/tmp/test_out.mp4"},
            codec_config={"vcodec": "libx264"},
            status="running",
            watchdog_enabled=True,
            watchdog_retries=3
        )
        self.db.add(media_proc)
        self.db.commit()
        self.db.refresh(media_proc)

        self.manager.processes[media_proc.id] = mock_proc

        try:
            with patch("psutil.Process") as mock_psutil:
                # Raise NoSuchProcess to simulate the process exiting immediately
                import psutil
                mock_psutil.side_effect = psutil.NoSuchProcess(pid=99911)
                
                await self.manager._watchdog(media_proc.id, mock_proc)

            # Check that the database status is set to 'error' (indicating it will restart),
            # NOT 'stopped' (which would abort the restart)
            self.db.refresh(media_proc)
            self.assertEqual(media_proc.status, "error")
            self.assertIn(media_proc.id, self.manager.pending_restarts)

        finally:
            self.db.delete(media_proc)
            self.db.commit()

    @patch("asyncio.create_subprocess_exec")
    async def test_start_process_does_not_self_cancel(self, mock_exec):
        # Create a test media process in DB
        media_proc = MediaProcess(
            name="Test Self Cancel Service",
            type="service",
            input_config={"type": "lavfi", "path": "testsrc"},
            output_config={"type": "file", "path": "/tmp/test_sc.mp4"},
            codec_config={"vcodec": "libx264"},
            status="running",
            watchdog_enabled=True,
            watchdog_retries=3
        )
        self.db.add(media_proc)
        self.db.commit()
        self.db.refresh(media_proc)

        mock_proc = MagicMock()
        mock_proc.pid = 99912
        mock_proc.returncode = None
        mock_proc.stdin = MagicMock()
        
        async def mock_create(*args, **kwargs):
            return mock_proc
        mock_exec.side_effect = mock_create

        try:
            # We place the current task in pending_restarts to simulate start_process being called
            # from within the delayed restart task
            current_task = asyncio.current_task()
            self.manager.pending_restarts[media_proc.id] = current_task

            # If the bug was present, start_process would call current_task.cancel(),
            # raising CancelledError at the first await point inside start_process.
            # But with the fix, it should run completely without raising CancelledError!
            await self.manager.start_process(media_proc.id, is_restart=True)
            
            # Clean up the watchdog and log reader tasks that were spawned
            proc = self.manager.processes.get(media_proc.id)
            if proc:
                proc.returncode = 0
            
            # Ensure it popped the current task from pending_restarts without cancelling it
            self.assertNotIn(media_proc.id, self.manager.pending_restarts)
            self.assertFalse(current_task.cancelled())

        finally:
            self.db.delete(media_proc)
            self.db.commit()
