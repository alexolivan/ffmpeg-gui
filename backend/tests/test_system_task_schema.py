import unittest
import datetime
from sqlalchemy import text
from database.db import SessionLocal, init_db, engine
from database.models import ScheduledTask

class TestSystemTaskSchema(unittest.TestCase):
    def setUp(self):
        init_db()
        self.db = SessionLocal()

    def tearDown(self):
        self.db.close()

    def test_is_system_column_exists(self):
        with engine.connect() as conn:
            result = conn.execute(text("PRAGMA table_info(scheduled_tasks)"))
            columns = [row[1] for row in result.fetchall()]
            self.assertIn("is_system", columns)

    def test_scheduled_task_is_system_default(self):
        task = ScheduledTask(
            name="Test Task Default System Status",
            input_config={"type": "file", "path": "/tmp/test.mp4"},
            output_config={"type": "file", "path": "/tmp/out.mp4"},
            codec_config={"vcodec": "copy", "acodec": "copy"},
            schedule_type="manual"
        )
        self.db.add(task)
        self.db.commit()
        self.db.refresh(task)

        # Default is_system should be False
        self.assertFalse(task.is_system)

        # Clean up
        self.db.delete(task)
        self.db.commit()

    def test_scheduled_task_is_system_true_and_false(self):
        task_true = ScheduledTask(
            name="System Task True",
            input_config={"type": "file", "path": "/tmp/test.mp4"},
            output_config={"type": "file", "path": "/tmp/out.mp4"},
            codec_config={"vcodec": "copy", "acodec": "copy"},
            schedule_type="manual",
            is_system=True
        )
        task_false = ScheduledTask(
            name="System Task False",
            input_config={"type": "file", "path": "/tmp/test.mp4"},
            output_config={"type": "file", "path": "/tmp/out.mp4"},
            codec_config={"vcodec": "copy", "acodec": "copy"},
            schedule_type="manual",
            is_system=False
        )

        self.db.add_all([task_true, task_false])
        self.db.commit()

        self.db.refresh(task_true)
        self.db.refresh(task_false)

        self.assertTrue(task_true.is_system)
        self.assertFalse(task_false.is_system)

        # Cleanup
        self.db.delete(task_true)
        self.db.delete(task_false)
        self.db.commit()
