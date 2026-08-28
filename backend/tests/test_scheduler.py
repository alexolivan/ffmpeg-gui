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
        self.db.query(TaskExecution).delete()
        self.db.query(ScheduledTask).delete()
        self.db.commit()
        # Mock TaskManager
        self.task_manager = MagicMock()
        self.task_manager.start_execution = AsyncMock()
        self.scheduler = Scheduler(lambda: SessionLocal(), self.task_manager, poll_interval=0.1)

    async def asyncTearDown(self):
        self.db.close()

    async def test_scheduler_startup_recalibrates_stale_tasks_without_firing(self):
        # Stale recurring task from yesterday (when machine was offline)
        past_time = datetime.datetime.utcnow() - datetime.timedelta(days=1)
        recurring_task = ScheduledTask(
            name="Stale Recurring Task",
            input_config={"type": "lavfi", "path": "testsrc"},
            output_config={"type": "file", "path": "/tmp/out_stale.mp4"},
            codec_config={"vcodec": "copy", "acodec": "copy"},
            schedule_type="recurring",
            schedule_cron="*/5 * * * *",
            next_run=past_time,
            is_active=True
        )
        self.db.add(recurring_task)

        # Stale one-shot task from yesterday
        one_shot_task = ScheduledTask(
            name="Stale One-shot Task",
            input_config={"type": "lavfi", "path": "testsrc"},
            output_config={"type": "file", "path": "/tmp/out_oneshot.mp4"},
            codec_config={"vcodec": "copy", "acodec": "copy"},
            schedule_type="one_shot",
            schedule_datetime=past_time,
            next_run=past_time,
            is_active=True
        )
        self.db.add(one_shot_task)
        self.db.commit()

        # Start scheduler (simulating system boot)
        task = asyncio.create_task(self.scheduler.start())
        await asyncio.sleep(0.2)
        await self.scheduler.stop()
        await task

        # Verify recurring task was recalibrated to future WITHOUT firing execution
        self.db.refresh(recurring_task)
        self.assertIsNotNone(recurring_task.next_run)
        self.assertGreater(recurring_task.next_run, datetime.datetime.utcnow())

        # Verify stale one-shot was deactivated
        self.db.refresh(one_shot_task)
        self.assertFalse(one_shot_task.is_active)
        self.assertIsNone(one_shot_task.next_run)

        # Crucial check: start_execution MUST NOT have been called on boot!
        self.assertEqual(self.task_manager.start_execution.call_count, 0)

    async def test_scheduler_poll_triggers_active_due_task(self):
        # Task that becomes due right now
        now = datetime.datetime.utcnow()
        active_task = ScheduledTask(
            name="Active Due Task",
            input_config={"type": "lavfi", "path": "testsrc"},
            output_config={"type": "file", "path": "/tmp/out_active.mp4"},
            codec_config={"vcodec": "copy", "acodec": "copy"},
            schedule_type="recurring",
            schedule_cron="*/5 * * * *",
            next_run=now,
            is_active=True
        )
        self.db.add(active_task)
        self.db.commit()

        # Run one polling cycle
        await self.scheduler.poll_due_tasks()

        # Verify task was triggered
        self.assertEqual(self.task_manager.start_execution.call_count, 1)
        self.db.refresh(active_task)
        self.assertGreater(active_task.next_run, now)

if __name__ == '__main__':
    unittest.main()
