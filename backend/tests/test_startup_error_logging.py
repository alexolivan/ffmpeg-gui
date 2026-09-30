import os
import shutil
import tempfile
import unittest
from unittest.mock import patch, MagicMock, AsyncMock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database.models import Base, Service, ServiceLog
from core.process_manager import ProcessManager


class TestStartupErrorLogging(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.pm = ProcessManager(self.Session)

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    @patch("shutil.which", return_value=None)
    async def test_startup_error_records_to_log_file_buffer_and_db(self, mock_which):
        with self.Session() as session:
            svc = Service(
                id=42,
                name="Desktop Missing Binaries",
                service_type="desktop",
                status="stopped",
                config={"desktop_config": {}},
            )
            session.add(svc)
            session.commit()

        # Patch log storage to temp directory
        log_file = os.path.join(self.temp_dir, "process_42.log")
        with patch.object(self.pm, "get_process_log_storage_path", return_value=self.temp_dir), \
             patch.object(self.pm, "get_process_log_path", return_value=log_file):

            with self.assertRaises(FileNotFoundError):
                await self.pm.start_process(42)

            # 1. Verify DB status and last_error
            with self.Session() as session:
                proc = session.get(Service, 42)
                self.assertEqual(proc.status, "error")
                self.assertIsNotNone(proc.last_error)
                self.assertIn("Xvfb binary not found", proc.last_error)

                # Verify ServiceLog entry in DB
                db_logs = session.query(ServiceLog).filter(ServiceLog.service_id == 42).all()
                self.assertTrue(any("Xvfb binary not found" in l.message for l in db_logs))

            # 2. Verify in-memory buffer
            self.assertIn(42, self.pm.log_buffers)
            buffer_msgs = [e["message"] for e in self.pm.log_buffers[42]]
            self.assertTrue(any("Xvfb binary not found" in m for m in buffer_msgs))

            # 3. Verify on-disk log file
            self.assertTrue(os.path.exists(log_file))
            with open(log_file, "r", encoding="utf-8") as f:
                disk_content = f.read()
            self.assertIn("--- PROCESS START ERROR AT", disk_content)
            self.assertIn("Xvfb binary not found", disk_content)

    @patch("shutil.which", return_value="/usr/bin/mock")
    @patch("asyncio.create_subprocess_exec")
    async def test_successful_start_clears_last_error(self, mock_exec, mock_which):
        mock_proc = MagicMock()
        mock_proc.pid = 9999
        mock_proc.returncode = None
        mock_proc.wait = AsyncMock(return_value=0)
        mock_proc.terminate = MagicMock()
        mock_proc.kill = MagicMock()
        mock_proc.stdin = None
        mock_exec.return_value = mock_proc

        with self.Session() as session:
            svc = Service(
                id=77,
                name="Healthy Desktop",
                service_type="desktop",
                status="stopped",
                config={"desktop_config": {}, "last_error": "Previous crash error message"},
            )
            session.add(svc)
            session.commit()

        with patch.object(self.pm, "_spawn_x11vnc", new_callable=AsyncMock), \
             patch.object(self.pm, "_file_log_tailer", new_callable=AsyncMock), \
             patch.object(self.pm, "_watchdog", new_callable=AsyncMock), \
             patch.object(self.pm, "get_process_log_storage_path", return_value=self.temp_dir):

            await self.pm.start_process(77)

            with self.Session() as session:
                proc = session.get(Service, 77)
                self.assertEqual(proc.status, "running")
                self.assertIsNone(proc.last_error)


if __name__ == "__main__":
    unittest.main()
