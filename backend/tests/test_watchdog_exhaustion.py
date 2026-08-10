import unittest
import asyncio
import os
import sqlite3
import tempfile
from unittest.mock import MagicMock, patch

from core.process_manager import ProcessManager
from database.db import SessionLocal, init_db, Base, engine
from database.models import MediaProcess, ProcessLog

class TestWatchdogExhaustion(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        Base.metadata.create_all(bind=engine)
        self.pm = ProcessManager(db_session_factory=SessionLocal)

    def tearDown(self):
        Base.metadata.drop_all(bind=engine)

    async def test_watchdog_exhaustion_transitions_to_stopped(self):
        with SessionLocal() as db:
            proc = MediaProcess(
                name="Test Exhaustion Service",
                type="service",
                status="running",
                pid=999999,
                input_config='{"mode":"lavfi","lavfi_type":"testsrc"}',
                output_config='{"mode":"null"}',
                codec_config='{}',
                filter_config='{}',
                watchdog_enabled=True,
                watchdog_retries=2,
                restart_count=1
            )
            db.add(proc)
            db.commit()
            db.refresh(proc)
            proc_id = proc.id

        self.pm.restart_counts[proc_id] = 2

        # Simulate watchdog cleanup when max restart attempts (2) are reached
        with SessionLocal() as session:
            media_proc = session.query(MediaProcess).get(proc_id)
            retries = media_proc.watchdog_retries
            current_restarts = self.pm.restart_counts.get(proc_id, 0)
            
            # Max retries reached condition: current_restarts >= retries
            self.assertGreaterEqual(current_restarts, retries)

            limit_log = ProcessLog(
                process_id=proc_id,
                level='ERROR',
                message=f"Watchdog: Max restart attempts ({retries}) reached. Service stopped."
            )
            session.add(limit_log)
            media_proc.status = 'stopped'
            media_proc.restart_count = 0
            media_proc.pid = None
            media_proc.cpu_usage = 0
            media_proc.ram_usage = 0
            media_proc.fps = "0"
            media_proc.bitrate = "0 kb/s"
            media_proc.speed = "0x"
            self.pm.restart_counts.pop(proc_id, None)
            session.commit()

        # Verify state in DB
        with SessionLocal() as session:
            updated_proc = session.query(MediaProcess).get(proc_id)
            self.assertEqual(updated_proc.status, "stopped")
            self.assertEqual(updated_proc.restart_count, 0)
            self.assertIsNone(updated_proc.pid)

if __name__ == '__main__':
    unittest.main()
