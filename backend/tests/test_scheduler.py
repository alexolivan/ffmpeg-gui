import unittest
import asyncio
import datetime
from unittest.mock import MagicMock, AsyncMock
from database.db import SessionLocal, init_db
from database.models import ScheduledTask, TaskExecution
from core.scheduler import Scheduler

class TestScheduler(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        init_db()
        self.db = SessionLocal()
        # Mock TaskManager
        self.task_manager = MagicMock()
        self.task_manager.start_execution = AsyncMock()
        self.scheduler = Scheduler(lambda: SessionLocal(), self.task_manager, poll_interval=0.1)

    async def asyncTearDown(self):
        self.db.close()

    async def test_scheduler_triggers_due_tasks(self):
        # 1. Manual task (should NOT run)
        manual_task = ScheduledTask(
            name="Manual Task",
            input_config={"type": "lavfi", "path": "testsrc"},
            output_config={"type": "file", "path": "/tmp/out1.mp4"},
            codec_config={"vcodec": "copy", "acodec": "copy"},
            schedule_type="manual",
            is_active=True
        )
        self.db.add(manual_task)

        # 2. One-shot task due in the past (should run)
        past_time = datetime.datetime.utcnow() - datetime.timedelta(minutes=5)
        one_shot_task = ScheduledTask(
            name="Due One-shot Task",
            input_config={"type": "lavfi", "path": "testsrc"},
            output_config={"type": "file", "path": "/tmp/out2.mp4"},
            codec_config={"vcodec": "copy", "acodec": "copy"},
            schedule_type="one_shot",
            schedule_datetime=past_time,
            next_run=past_time,
            is_active=True
        )
        self.db.add(one_shot_task)

        # 3. Recurring task due in the past (should run and update next_run)
        recurring_task = ScheduledTask(
            name="Due Recurring Task",
            input_config={"type": "lavfi", "path": "testsrc"},
            output_config={"type": "file", "path": "/tmp/out3.mp4"},
            codec_config={"vcodec": "copy", "acodec": "copy"},
            schedule_type="recurring",
            schedule_cron="*/5 * * * *",
            next_run=past_time,
            is_active=True
        )
        self.db.add(recurring_task)
        
        self.db.commit()
        self.db.refresh(manual_task)
        self.db.refresh(one_shot_task)
        self.db.refresh(recurring_task)

        # Start scheduler loop briefly
        task = asyncio.create_task(self.scheduler.start())
        await asyncio.sleep(0.3)
        await self.scheduler.stop()
        await task

        # Check that one-shot next_run is cleared
        self.db.refresh(one_shot_task)
        self.assertIsNone(one_shot_task.next_run)

        # Check that recurring next_run is updated to future
        self.db.refresh(recurring_task)
        self.assertIsNotNone(recurring_task.next_run)
        self.assertGreater(recurring_task.next_run, datetime.datetime.utcnow())

        # Verify task_manager execution triggers
        # It should have triggered executions for one_shot and recurring, but not manual
        self.assertEqual(self.task_manager.start_execution.call_count, 2)

        # Cleanup
        # Delete executions created by scheduler in DB if any
        for exec_run in self.db.query(TaskExecution).filter(TaskExecution.task_id.in_([one_shot_task.id, recurring_task.id])).all():
            self.db.delete(exec_run)
        self.db.delete(manual_task)
        self.db.delete(one_shot_task)
        self.db.delete(recurring_task)
        self.db.commit()
