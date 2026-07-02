import unittest
import asyncio
from unittest.mock import patch, AsyncMock
from database.db import SessionLocal, init_db
from database.models import MediaProcess
from main import auto_start_services, process_manager

class TestAutoStartServices(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        init_db()
        self.db = SessionLocal()
        # Clean up database of any existing processes to ensure clean test environment
        self.db.query(MediaProcess).delete()
        self.db.commit()

    async def asyncTearDown(self):
        self.db.query(MediaProcess).delete()
        self.db.commit()
        self.db.close()

    @patch("asyncio.sleep")
    async def test_auto_start_services_starts_multiple_sequentially(self, mock_sleep):
        # 1. Create two services with auto_start=True
        proc1 = MediaProcess(
            name="Service 1",
            type="service",
            input_config={"type": "lavfi", "path": "testsrc"},
            output_config={"type": "file", "path": "/tmp/s1.mp4"},
            codec_config={"vcodec": "libx264"},
            status="stopped",
            auto_start=True
        )
        proc2 = MediaProcess(
            name="Service 2",
            type="service",
            input_config={"type": "lavfi", "path": "testsrc"},
            output_config={"type": "file", "path": "/tmp/s2.mp4"},
            codec_config={"vcodec": "libx264"},
            status="stopped",
            auto_start=True
        )
        # Create a third process with auto_start=False to ensure it's NOT started
        proc3 = MediaProcess(
            name="Service 3",
            type="service",
            input_config={"type": "lavfi", "path": "testsrc"},
            output_config={"type": "file", "path": "/tmp/s3.mp4"},
            codec_config={"vcodec": "libx264"},
            status="stopped",
            auto_start=False
        )
        self.db.add_all([proc1, proc2, proc3])
        self.db.commit()
        self.db.refresh(proc1)
        self.db.refresh(proc2)
        self.db.refresh(proc3)

        # We want to mock process_manager.start_process to verify they are called sequentially.
        # To do so, we can make the mock function log the start and end of each execution,
        # verifying that they do not overlap.
        call_events = []

        async def mock_start(process_id, is_restart=False):
            call_events.append(("start", process_id))
            await asyncio.sleep(0.05)  # Simulate some startup time
            call_events.append(("end", process_id))

        with patch.object(process_manager, "start_process", side_effect=mock_start) as mock_pm_start:
            await auto_start_services()

            # Verify both were called
            self.assertEqual(mock_pm_start.call_count, 2)
            mock_pm_start.assert_any_call(proc1.id)
            mock_pm_start.assert_any_call(proc2.id)

            # Check execution sequence: start 1 -> end 1 -> start 2 -> end 2
            # or start 2 -> end 2 -> start 1 -> end 1
            # There should be no overlap (i.e. no start before the previous end).
            self.assertEqual(len(call_events), 4)
            self.assertEqual(call_events[0][0], "start")
            self.assertEqual(call_events[1][0], "end")
            self.assertEqual(call_events[0][1], call_events[1][1])
            self.assertEqual(call_events[2][0], "start")
            self.assertEqual(call_events[3][0], "end")
            self.assertEqual(call_events[2][1], call_events[3][1])
