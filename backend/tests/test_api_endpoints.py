import unittest
import os
import sys
import datetime
from fastapi.testclient import TestClient

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from main import app
from database.db import SessionLocal, init_db
from database.models import ScheduledTask, TaskExecution

class TestTaskAPI(unittest.TestCase):
    def setUp(self):
        init_db()
        self.client = TestClient(app)
        self.db = SessionLocal()

    def tearDown(self):
        # Cleanup any tasks created during testing
        for task in self.db.query(ScheduledTask).filter(ScheduledTask.name.like("API Test %")).all():
            self.db.delete(task)
        self.db.commit()
        self.db.close()

    def test_create_and_get_task(self):
        # Create Task
        payload = {
            "name": "API Test Task 1",
            "input_config": {"type": "lavfi", "path": "testsrc"},
            "output_config": {"type": "file", "path": "/tmp/api_test_out.mp4"},
            "codec_config": {"vcodec": "libx264"},
            "schedule_type": "manual"
        }
        res = self.client.post("/tasks", json=payload)
        self.assertEqual(res.status_code, 200)
        task_id = res.json()["id"]

        # Get Tasks list
        res = self.client.get("/tasks")
        self.assertEqual(res.status_code, 200)
        tasks = res.json()
        self.assertTrue(any(t["id"] == task_id for t in tasks))

        # Get Single Task
        res = self.client.get(f"/tasks/{task_id}")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["task"]["name"], "API Test Task 1")

        # Update Task
        update_payload = {"name": "API Test Task 1 Updated", "is_active": False}
        res = self.client.put(f"/tasks/{task_id}", json=update_payload)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["name"], "API Test Task 1 Updated")
        self.assertFalse(res.json()["is_active"])

        # Delete Task
        res = self.client.delete(f"/tasks/{task_id}")
        self.assertEqual(res.status_code, 200)

        # Confirm 404
        res = self.client.get(f"/tasks/{task_id}")
        self.assertEqual(res.status_code, 404)

    def test_create_recurring_task_invalid_cron(self):
        payload = {
            "name": "API Test Recurring Task Invalid",
            "input_config": {"type": "lavfi", "path": "testsrc"},
            "output_config": {"type": "file", "path": "/tmp/api_test_out.mp4"},
            "codec_config": {"vcodec": "libx264"},
            "schedule_type": "recurring",
            "schedule_cron": "invalid cron expression"
        }
        res = self.client.post("/tasks", json=payload)
        self.assertEqual(res.status_code, 400)

    def test_import_export_tasks(self):
        payload = {
            "tasks": [
                {
                    "name": "API Test Import 1",
                    "input_config": {"type": "lavfi", "path": "testsrc"},
                    "output_config": {"type": "file", "path": "/tmp/import_out.mp4"},
                    "codec_config": {"vcodec": "libx264"},
                    "schedule_type": "manual"
                }
            ]
        }
        res = self.client.post("/tasks/import", json=payload)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["count"], 1)

        res = self.client.get("/tasks/export")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["version"], 2)
        self.assertTrue(any(t["name"] == "Imported: API Test Import 1" for t in data["tasks"]))
        
        # Cleanup
        for t in self.db.query(ScheduledTask).filter(ScheduledTask.name.like("%API Test Import %")).all():
            self.db.delete(t)
        self.db.commit()

if __name__ == "__main__":
    unittest.main()
