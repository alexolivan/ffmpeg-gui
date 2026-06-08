import unittest
import asyncio
import datetime
import os
from database.db import SessionLocal, init_db
from database.models import ScheduledTask, TaskExecution
from core.task_manager import TaskManager

class TestTaskManager(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        init_db()
        self.db = SessionLocal()
        self.manager = TaskManager(lambda: SessionLocal())

    async def asyncTearDown(self):
        self.db.close()
        # Clean up output file if it exists
        if os.path.exists("/tmp/test_out.mp4"):
            try:
                os.remove("/tmp/test_out.mp4")
            except Exception:
                pass

    async def test_task_manager_successful_execution(self):
        task = ScheduledTask(
            name="Test Task Manager Quick",
            input_config={
                "input1": {
                    "type": "lavfi",
                    "path": "testsrc=duration=1:size=176x144:rate=1"
                },
                "has_video": True,
                "has_audio": False
            },
            output_config={"type": "file", "path": "/tmp/test_out.mp4"},
            codec_config={"vcodec": "libx264", "acodec": "aac"},
            filter_config={"advanced": {"threads": 1}},
            schedule_type="manual",
            duration_type="timer",
            duration_seconds=1
        )
        
        self.db.add(task)
        self.db.commit()
        self.db.refresh(task)

        execution = TaskExecution(task_id=task.id, status="pending")
        self.db.add(execution)
        self.db.commit()
        self.db.refresh(execution)

        # Start execution
        await self.manager.start_execution(execution.id)
        
        # Wait for the process to finish
        for _ in range(10):
            await asyncio.sleep(0.5)
            self.db.refresh(execution)
            if execution.status in ('finished', 'error'):
                break

        self.assertEqual(execution.status, 'finished')

        # Cleanup
        self.db.delete(execution)
        self.db.delete(task)
        self.db.commit()

    async def test_task_manager_watchdog_inactivity(self):
        task = ScheduledTask(
            name="Test Task Watchdog Inactivity",
            input_config={
                "input1": {
                    "type": "lavfi",
                    "path": "testsrc=duration=5:size=176x144:rate=1"
                },
                "has_video": True,
                "has_audio": False
            },
            output_config={"type": "file", "path": "/tmp/test_out.mp4"},
            codec_config={"vcodec": "libx264", "acodec": "aac"},
            filter_config={"advanced": {"threads": 1}},
            schedule_type="manual",
            duration_type="timer",
            duration_seconds=5
        )
        
        self.db.add(task)
        self.db.commit()
        self.db.refresh(task)

        execution = TaskExecution(task_id=task.id, status="pending")
        self.db.add(execution)
        self.db.commit()
        self.db.refresh(execution)

        # Start execution
        await self.manager.start_execution(execution.id)
        
        # Simulate inactivity by setting last_activity to 65 seconds ago
        self.manager.last_activity[execution.id] = datetime.datetime.utcnow() - datetime.timedelta(seconds=65)

        # Wait for the watchdog to detect inactivity and kill the process
        for _ in range(15):
            await asyncio.sleep(0.2)
            self.db.refresh(execution)
            if execution.status in ('finished', 'error'):
                break

        self.assertEqual(execution.status, 'error')
        self.assertEqual(execution.error_message, 'Execution hung (no log activity for 60s)')

        # Cleanup
        self.db.delete(execution)
        self.db.delete(task)
        self.db.commit()
