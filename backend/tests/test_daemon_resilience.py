import asyncio
import os
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database.models import Base, Service, Storage
from core.process_manager import ProcessManager


class TestDaemonResilience(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tmp_dir.name, "test.db")
        self.engine = create_engine(f"sqlite:///{self.db_path}", connect_args={"check_same_thread": False})
        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)

        with self.SessionLocal() as session:
            storage = Storage(
                name="Test Logs Storage",
                type="logs",
                path=self.tmp_dir.name,
                is_default=True
            )
            session.add(storage)
            session.commit()

        self.pm = ProcessManager(db_session_factory=self.SessionLocal)

    async def asyncTearDown(self):
        # Cancel any pending watchdog/tailer tasks
        for t in list(self.pm.watchdog_tasks.values()):
            t.cancel()
        self.tmp_dir.cleanup()

    async def test_mediamtx_stdout_decoupled_to_file_descriptor(self):
        """Verify that MediaMTX is spawned with stdout pointing to a real file handle rather than PIPE."""
        with self.SessionLocal() as session:
            svc = Service(
                name="Test MediaMTX",
                service_type="mediamtx_hub",
                config={"mediamtx_config": {}},
                status="stopped"
            )
            session.add(svc)
            session.commit()
            svc_id = svc.id

        mock_proc = MagicMock()
        mock_proc.pid = 99999
        mock_proc.returncode = None

        captured_kwargs = {}

        async def fake_create_subprocess_exec(*cmd, **kwargs):
            nonlocal captured_kwargs
            captured_kwargs = kwargs
            return mock_proc

        with patch("asyncio.create_subprocess_exec", side_effect=fake_create_subprocess_exec), \
             patch.object(self.pm, "_build_mediamtx_config_and_cmd", return_value=(["echo", "hi"], "/tmp/cfg.yml")), \
             patch("shutil.which", return_value="/bin/echo"):

            await self.pm.start_process(svc_id)

            self.assertIn("stdout", captured_kwargs)
            # stdout must NOT be PIPE
            self.assertNotEqual(captured_kwargs["stdout"], asyncio.subprocess.PIPE)
            # stdin must be DEVNULL
            self.assertEqual(captured_kwargs["stdin"], asyncio.subprocess.DEVNULL)
            # stdout must have a fileno (real open file descriptor)
            self.assertTrue(hasattr(captured_kwargs["stdout"], "fileno"))

    async def test_file_log_tailer_populates_buffer(self):
        """Verify that _file_log_tailer reads disk file lines into in-memory log buffer."""
        svc_id = 42
        self.pm.log_buffers[svc_id] = []
        log_file = os.path.join(self.tmp_dir.name, "test_tailer.log")
        with open(log_file, "w") as f:
            f.write("Initial line\n")

        mock_proc = MagicMock()
        mock_proc.returncode = None
        self.pm.processes[svc_id] = mock_proc

        tailer_task = asyncio.create_task(self.pm._file_log_tailer(svc_id, log_file, proc=mock_proc))
        await asyncio.sleep(0.3)

        # Write new lines to log file
        with open(log_file, "a") as f:
            f.write("2026-09-07 INF MediaMTX stream published\n")
            f.flush()

        # Wait for tailer iteration
        await asyncio.sleep(0.8)

        # Buffer should contain the new message
        messages = [e["message"] for e in self.pm.log_buffers[svc_id]]
        self.assertTrue(any("stream published" in m for m in messages))

        # Cleanup
        tailer_task.cancel()
        try:
            await tailer_task
        except asyncio.CancelledError:
            pass

    async def test_reattach_process_starts_tailer_for_mediamtx(self):
        """Verify that reattaching a running MediaMTX service initiates log tailing."""
        with self.SessionLocal() as session:
            svc = Service(
                name="Reattach MediaMTX",
                service_type="mediamtx_hub",
                config={"mediamtx_config": {}},
                status="running",
                pid=12345
            )
            session.add(svc)
            session.commit()
            svc_id = svc.id

        tailer_called = False

        async def fake_tailer(*args, **kwargs):
            nonlocal tailer_called
            tailer_called = True

        async def fake_watchdog(*args, **kwargs):
            return None

        with patch.object(self.pm, "_file_log_tailer", side_effect=fake_tailer), \
             patch.object(self.pm, "_watchdog", side_effect=fake_watchdog):

            self.pm.reattach_process(svc_id, pid=12345)
            self.assertIn(svc_id, self.pm.log_buffers)
            await asyncio.sleep(0.05)
            self.assertTrue(tailer_called)


if __name__ == "__main__":
    unittest.main()
