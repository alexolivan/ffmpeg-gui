import unittest
from fastapi.testclient import TestClient
from main import app
from database.db import SessionLocal, init_db
from database.models import MediaProcess, ScheduledTask

class TestBilateralCloningAPI(unittest.TestCase):
    def setUp(self):
        init_db()
        self.db = SessionLocal()
        self.client = TestClient(app)

    def tearDown(self):
        self.db.query(MediaProcess).filter(MediaProcess.name.like("Test Clone%")).delete(synchronize_session=False)
        self.db.query(ScheduledTask).filter(ScheduledTask.name.like("Test Clone%")).delete(synchronize_session=False)
        self.db.commit()
        self.db.close()

    def test_clone_process_as_task(self):
        proc = MediaProcess(
            name="Test Clone Service",
            type="service",
            status="stopped",
            input_config={"input1": {"type": "file", "path": "/tmp/test.mp4"}},
            output_config={"type": "udp", "host": "239.0.0.1", "port": "1234"},
            codec_config={"vcodec": "libx264", "b:v": "3000k"}
        )
        self.db.add(proc)
        self.db.commit()
        self.db.refresh(proc)

        res = self.client.post(f"/processes/{proc.id}/clone-as-task")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["name"], "Copy of Test Clone Service")
        self.assertEqual(data["schedule_type"], "manual")
        self.assertFalse(data["is_active"])
        self.assertEqual(data["duration_seconds"], 3600)
        self.assertEqual(data["input_config"], proc.input_config)
        self.assertEqual(data["output_config"], proc.output_config)

    def test_clone_task_as_service(self):
        task = ScheduledTask(
            name="Test Clone Task",
            schedule_type="manual",
            is_active=False,
            input_config={"input1": {"type": "file", "path": "/tmp/input.mp4"}},
            output_config={"type": "srt", "host": "1.2.3.4", "port": "9000"},
            codec_config={"vcodec": "hevc_nvenc"}
        )
        self.db.add(task)
        self.db.commit()
        self.db.refresh(task)

        res = self.client.post(f"/tasks/{task.id}/clone-as-service")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["name"], "Copy of Test Clone Task")
        self.assertEqual(data["type"], "service")
        self.assertEqual(data["status"], "stopped")
        self.assertFalse(data["auto_start"])
        self.assertTrue(data["watchdog_enabled"])
        self.assertTrue(data["input_config"]["input1"].get("re"))
