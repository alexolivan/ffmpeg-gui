import unittest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database.models import Base, Service
from core.process_manager import ProcessManager
import main


class TestLifecycleReloadStop(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()
        self.pm = ProcessManager(db_session_factory=self.Session)

    def tearDown(self):
        self.db.close()

    async def test_stop_all_processes_terminates_all_running_services(self):
        # Create 3 services: 2 running, 1 stopped
        s1 = Service(name="Stream 1", service_type="ffmpeg_stream", status="running", pid=1001, config={})
        s2 = Service(name="MediaMTX Hub", service_type="mediamtx_hub", status="running", pid=1002, config={})
        s3 = Service(name="Inactive Stream", service_type="ffmpeg_stream", status="stopped", pid=None, config={})

        self.db.add_all([s1, s2, s3])
        self.db.commit()

        self.pm.stop_process = AsyncMock()

        await self.pm.stop_all_processes(graceful=True)

        # Ensure stop_process was called for s1 and s2, but NOT s3
        stopped_ids = [call.args[0] for call in self.pm.stop_process.call_args_list]
        self.assertIn(s1.id, stopped_ids)
        self.assertIn(s2.id, stopped_ids)
        self.assertNotIn(s3.id, stopped_ids)

    async def test_shutdown_event_distinguishes_warm_reload_from_clean_stop(self):
        # 1. Test Clean Stop mode (is_reload_mode = False)
        main.set_reload_mode(False)
        with patch.object(main.process_manager, "stop_all_processes", new_callable=AsyncMock) as mock_stop_all, \
             patch.object(main.scheduler, "stop", new_callable=AsyncMock) as mock_sched_stop, \
             patch.object(main.notification_manager, "stop_worker", new_callable=MagicMock):
            
            await main.shutdown_event()
            
            mock_sched_stop.assert_awaited_once()
            mock_stop_all.assert_awaited_once_with(graceful=True)

        # 2. Test Warm Reload mode (is_reload_mode = True)
        main.set_reload_mode(True)
        with patch.object(main.process_manager, "stop_all_processes", new_callable=AsyncMock) as mock_stop_all, \
             patch.object(main.scheduler, "stop", new_callable=AsyncMock) as mock_sched_stop, \
             patch.object(main.notification_manager, "stop_worker", new_callable=MagicMock):
            
            await main.shutdown_event()
            
            mock_sched_stop.assert_awaited_once()
            # stop_all_processes must NOT be called on Warm Reload!
            mock_stop_all.assert_not_called()


if __name__ == "__main__":
    unittest.main()
