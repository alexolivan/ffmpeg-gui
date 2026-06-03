import unittest
import datetime
from database.db import SessionLocal, init_db
from database.models import ScheduledTask, TaskExecution, TaskExecutionLog

class TestScheduledTaskModels(unittest.TestCase):
    def setUp(self):
        init_db()
        self.db = SessionLocal()

    def tearDown(self):
        self.db.close()

    def test_models_creation(self):
        # Create ScheduledTask
        task = ScheduledTask(
            name="Test Task Models",
            input_config={"type": "file", "path": "/tmp/test.mp4"},
            output_config={"type": "file", "path": "/tmp/out.mp4"},
            codec_config={"vcodec": "copy", "acodec": "copy"},
            schedule_type="one_shot",
            schedule_datetime=datetime.datetime.utcnow() + datetime.timedelta(hours=1),
            duration_type="timer",
            duration_seconds=60,
            retry_policy={"max_retries": 2}
        )
        self.db.add(task)
        self.db.commit()
        self.db.refresh(task)
        self.assertIsNotNone(task.id)
        
        # Create TaskExecution
        exec_run = TaskExecution(
            task_id=task.id,
            status="pending",
            retry_count=0
        )
        self.db.add(exec_run)
        self.db.commit()
        self.db.refresh(exec_run)
        self.assertIsNotNone(exec_run.id)
        
        # Create TaskExecutionLog
        log = TaskExecutionLog(
            execution_id=exec_run.id,
            level="INFO",
            message="Started test run"
        )
        self.db.add(log)
        self.db.commit()
        
        # Read back and assert relations
        db_task = self.db.query(ScheduledTask).get(task.id)
        self.assertEqual(len(db_task.executions), 1)
        self.assertEqual(db_task.executions[0].status, "pending")
        self.assertEqual(len(db_task.executions[0].logs), 1)
        self.assertEqual(db_task.executions[0].logs[0].message, "Started test run")
        
        # Cleanup
        self.db.delete(log)
        self.db.delete(exec_run)
        self.db.delete(task)
        self.db.commit()
