import unittest
import asyncio
from unittest.mock import patch, MagicMock, AsyncMock, call
from database.db import SessionLocal, init_db
from database.models import Service
from core.process_manager import ProcessManager
from core.alsa_manager import alsa_manager


class TestAudioScienceStability(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        init_db()
        self.db = SessionLocal()
        self.manager = ProcessManager(lambda: SessionLocal())

    async def asyncTearDown(self):
        self.db.close()

    async def test_stop_all_processes_staggers_same_alsa_card_and_runs_non_alsa_concurrently(self):
        """
        Verify that stop_all_processes:
        1. Identifies processes sharing ALSA card 0.
        2. Staggers their stop with ~0.30s delay.
        3. Stops non-ALSA processes concurrently.
        4. Wraps execution in hardware_busy_guard.
        """
        # Ensure any leftover running services from other test suites are marked stopped
        self.db.query(Service).filter(Service.status.in_(["running", "starting", "restarting"])).update({Service.status: "stopped"})
        self.db.commit()

        # Create test services in DB
        s1 = Service(name="ASI Stream 1", service_type="ffmpeg_stream", status="running", config={"output": {"type": "alsa", "device": "hw:0,0,0"}})
        s2 = Service(name="ASI Stream 2", service_type="ffmpeg_stream", status="running", config={"output": {"type": "alsa", "device": "hw:0,0,1"}})
        s3 = Service(name="Non-ALSA Stream", service_type="ffmpeg_stream", status="running", config={"output": {"type": "rtmp", "url": "rtmp://live"}})
        self.db.add_all([s1, s2, s3])
        self.db.commit()
        self.db.refresh(s1)
        self.db.refresh(s2)
        self.db.refresh(s3)

        stop_calls = []
        busy_during_stop = []

        async def mock_stop_process(pid, graceful=True, is_restart=False):
            stop_calls.append(pid)
            busy_during_stop.append(alsa_manager.is_hardware_busy)

        with patch.object(self.manager, "stop_process", side_effect=mock_stop_process), \
             patch("asyncio.sleep", new_callable=AsyncMock) as mock_sleep, \
             patch("core.process_manager.cleanup_rogue_processes") as mock_rogue:

            await self.manager.stop_all_processes(graceful=True)

            # All 3 services were stopped
            self.assertEqual(set(stop_calls), {s1.id, s2.id, s3.id})

            # During all stops, hardware_busy_guard was active (True)
            self.assertTrue(all(busy_during_stop))
            # After stop_all_processes completed, hardware_busy_guard exited
            self.assertFalse(alsa_manager.is_hardware_busy)

            # Sleep was invoked with 0.30s between the 2 ALSA card 0 processes
            mock_sleep.assert_awaited_once_with(0.30)

    async def test_restart_process_activates_hardware_busy_guard(self):
        """Verify that restart_process wraps stop and start inside hardware_busy_guard."""
        busy_states = []

        async def mock_stop(pid, is_restart=False):
            busy_states.append(("stop", alsa_manager.is_hardware_busy))

        async def mock_start(pid, is_restart=False):
            busy_states.append(("start", alsa_manager.is_hardware_busy))

        with patch.object(self.manager, "stop_process", side_effect=mock_stop), \
             patch.object(self.manager, "start_process", side_effect=mock_start), \
             patch("asyncio.sleep", new_callable=AsyncMock):

            await self.manager.restart_process(99)

            self.assertEqual(busy_states, [("stop", True), ("start", True)])
            self.assertFalse(alsa_manager.is_hardware_busy)


if __name__ == "__main__":
    unittest.main()
