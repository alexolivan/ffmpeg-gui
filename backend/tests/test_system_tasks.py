import unittest
import asyncio
import datetime
import os
import time
import tempfile
import configparser
from unittest.mock import patch

from database.db import SessionLocal, init_db
from database.models import ScheduledTask, TaskExecution, TaskExecutionLog
from core.task_manager import TaskManager

class TestSystemTasks(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        init_db()
        self.db = SessionLocal()
        self.manager = TaskManager(lambda: SessionLocal())
        self.temp_dir = tempfile.TemporaryDirectory()

    async def asyncTearDown(self):
        self.db.close()
        self.temp_dir.cleanup()

    def test_log_rotate_task_is_seeded(self):
        # Verify the task has been auto-seeded during init_db() in asyncSetUp
        task = self.db.query(ScheduledTask).filter(
            ScheduledTask.command == "system://log_rotate"
        ).first()
        self.assertIsNotNone(task)
        self.assertEqual(task.name, "System Log Rotation and Retention Cleanup")
        self.assertTrue(task.is_system)
        self.assertEqual(task.schedule_type, "recurring")
        self.assertEqual(task.schedule_cron, "0 0 * * *")

    async def test_system_log_rotate_execution(self):
        # 1. Prepare dummy configuration file
        config_path = os.path.join(self.temp_dir.name, "test_app.conf")
        log_file_path = os.path.join(self.temp_dir.name, "app.log")
        
        # Create active log file
        with open(log_file_path, "w") as f:
            f.write("active logs")

        # Create dummy configuration
        config = configparser.ConfigParser()
        config["logging"] = {
            "mode": "both",
            "file_path": log_file_path,
            "retention_days": "2"
        }
        with open(config_path, "w") as f:
            config.write(f)

        # 2. Prepare rotated log files in the directory
        # Active: app.log (should preserve)
        # Rotated 1 day ago: app.log.1.gz (should preserve)
        # Rotated 5 days ago: app.log.2.gz (should delete)
        gz_preserved_path = f"{log_file_path}.1.gz"
        gz_deleted_path = f"{log_file_path}.2.gz"

        with open(gz_preserved_path, "w") as f:
            f.write("mtime 1 day ago")
        with open(gz_deleted_path, "w") as f:
            f.write("mtime 5 days ago")

        now = time.time()
        one_day_ago = now - (24 * 3600 * 1)
        five_days_ago = now - (24 * 3600 * 5)

        os.utime(gz_preserved_path, (one_day_ago, one_day_ago))
        os.utime(gz_deleted_path, (five_days_ago, five_days_ago))

        # 3. Insert a ScheduledTask and execution record for testing
        task = self.db.query(ScheduledTask).filter(
            ScheduledTask.command == "system://log_rotate"
        ).first()
        if not task:
            task = ScheduledTask(
                name="System Log Rotation and Retention Cleanup",
                command="system://log_rotate",
                is_system=True,
                schedule_type="recurring",
                schedule_cron="0 0 * * *",
                input_config={},
                output_config={},
                codec_config={}
            )
            self.db.add(task)
            self.db.commit()
            self.db.refresh(task)

        execution = TaskExecution(task_id=task.id, status="pending")
        self.db.add(execution)
        self.db.commit()
        self.db.refresh(execution)

        # 4. Run execution with CONFIG_FILE_PATH env var mocked
        with patch.dict(os.environ, {"CONFIG_FILE_PATH": config_path}):
            await self.manager.start_execution(execution.id)
            
            # Wait for execution to finish (it runs in async task)
            for _ in range(20):
                await asyncio.sleep(0.1)
                self.db.refresh(execution)
                if execution.status in ("finished", "error"):
                    break

        self.assertEqual(execution.status, "finished")

        # 5. Assert files deletion/preservation
        self.assertTrue(os.path.exists(log_file_path), "Active log file should be preserved")
        self.assertTrue(os.path.exists(gz_preserved_path), "Log rotated 1 day ago (retention=2) should be preserved")
        self.assertFalse(os.path.exists(gz_deleted_path), "Log rotated 5 days ago (retention=2) should be deleted")

        # 6. Verify database history logs
        logs = self.db.query(TaskExecutionLog).filter(
            TaskExecutionLog.execution_id == execution.id
        ).order_by(TaskExecutionLog.timestamp.asc()).all()
        
        log_messages = [l.message for l in logs]
        self.assertTrue(any("Deleted expired rotated log file" in msg for msg in log_messages))
        self.assertTrue(any("Preserved rotated log file" in msg for msg in log_messages))
        self.assertTrue(any("Cleanup finished" in msg for msg in log_messages))

        # Cleanup test records
        self.db.delete(execution)
        self.db.commit()
