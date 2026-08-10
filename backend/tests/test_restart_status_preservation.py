import unittest
import asyncio
from unittest.mock import MagicMock, patch

from core.process_manager import ProcessManager
from database.db import SessionLocal, init_db, Base, engine
from database.models import MediaProcess

class TestRestartStatusPreservation(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        Base.metadata.create_all(bind=engine)
        self.pm = ProcessManager(db_session_factory=SessionLocal)

    def tearDown(self):
        Base.metadata.drop_all(bind=engine)

    async def test_stop_process_with_is_restart(self):
        with SessionLocal() as session:
            proc = MediaProcess(
                name="Test Stream",
                type="service",
                input_config='{}',
                output_config='{}',
                codec_config='{}',
                filter_config='{}',
                status="running",
                pid=1234
            )
            session.add(proc)
            session.commit()
            proc_id = proc.id

        # Call stop_process with is_restart=True
        await self.pm.stop_process(proc_id, is_restart=True)

        with SessionLocal() as session:
            updated_proc = session.query(MediaProcess).get(proc_id)
            self.assertEqual(updated_proc.status, "restarting")
            self.assertIsNone(updated_proc.pid)

if __name__ == "__main__":
    unittest.main()
