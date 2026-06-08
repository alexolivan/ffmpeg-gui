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

    def test_single_task_export_import_and_preview(self):
        # 1. Create a task
        payload = {
            "name": "API Test Single Task",
            "input_config": {"type": "lavfi", "path": "testsrc"},
            "output_config": {"type": "file", "path": "/tmp/single_task.mp4"},
            "codec_config": {"vcodec": "libx264"},
            "schedule_type": "manual",
            "duration_type": "timer",
            "duration_seconds": 45
        }
        res = self.client.post("/tasks", json=payload)
        self.assertEqual(res.status_code, 200)
        task_id = res.json()["id"]

        # 2. Export single task
        res = self.client.get(f"/tasks/{task_id}/export")
        self.assertEqual(res.status_code, 200)
        exported = res.json()
        self.assertEqual(exported["version"], 2)
        self.assertEqual(exported["task"]["name"], "API Test Single Task")
        self.assertEqual(exported["task"]["duration_seconds"], 45)

        # 3. Preview task command
        res = self.client.post("/tasks/preview-cmd", json=payload)
        self.assertEqual(res.status_code, 200)
        self.assertIn("ffmpeg", res.json()["command"])
        self.assertIn("-t 45", res.json()["command"])

        # 4. Import single task
        import_payload = {
            "version": 2,
            "task": exported["task"]
        }
        res = self.client.post("/tasks/import", json=import_payload)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["count"], 1)

        # Cleanup
        for t in self.db.query(ScheduledTask).filter(ScheduledTask.name.like("%API Test Single Task%")).all():
            self.db.delete(t)
        self.db.commit()

    def test_streaming_inputs_and_hls_output_preview(self):
        # Test 1: Inputs http_audio, rtmp, hls
        payload_input_http = {
            "name": "Test Stream HTTP Audio",
            "type": "service",
            "input_config": {"input1": {"type": "http_audio", "path": "http://icecast.live/stream.mp3"}},
            "output_config": {"type": "udp", "host": "127.0.0.1", "port": "1234"},
            "codec_config": {"vcodec": "libx264"}
        }
        res = self.client.post("/processes/preview-cmd", json=payload_input_http)
        self.assertEqual(res.status_code, 200)
        cmd = res.json()["command"]
        self.assertIn("-i http://icecast.live/stream.mp3", cmd)

        payload_input_rtmp = {
            "name": "Test Stream RTMP",
            "type": "service",
            "input_config": {"input1": {"type": "rtmp", "path": "rtmp://live.rtmp/app/key"}},
            "output_config": {"type": "udp", "host": "127.0.0.1", "port": "1234"},
            "codec_config": {"vcodec": "libx264"}
        }
        res = self.client.post("/processes/preview-cmd", json=payload_input_rtmp)
        self.assertEqual(res.status_code, 200)
        cmd = res.json()["command"]
        self.assertIn("-i rtmp://live.rtmp/app/key", cmd)

        payload_input_hls = {
            "name": "Test Stream HLS",
            "type": "service",
            "input_config": {"input1": {"type": "hls", "path": "http://live.hls/playlist.m3u8"}},
            "output_config": {"type": "udp", "host": "127.0.0.1", "port": "1234"},
            "codec_config": {"vcodec": "libx264"}
        }
        res = self.client.post("/processes/preview-cmd", json=payload_input_hls)
        self.assertEqual(res.status_code, 200)
        cmd = res.json()["command"]
        self.assertIn("-i http://live.hls/playlist.m3u8", cmd)

        # Test 2: HLS Output local with delete segments
        payload_output_hls_local = {
            "name": "Test Output HLS Local",
            "type": "service",
            "input_config": {"input1": {"type": "file", "path": "/tmp/test.mp4"}},
            "output_config": {
                "type": "hls",
                "path": "/var/www/hls/stream.m3u8",
                "hls_method": "local",
                "hls_time": 4,
                "hls_list_size": 10,
                "hls_delete_segments": True
            },
            "codec_config": {"vcodec": "libx264"}
        }
        res = self.client.post("/processes/preview-cmd", json=payload_output_hls_local)
        self.assertEqual(res.status_code, 200)
        cmd = res.json()["command"]
        self.assertIn("-f hls", cmd)
        self.assertIn("-hls_time 4", cmd)
        self.assertIn("-hls_list_size 10", cmd)
        self.assertIn("-hls_flags delete_segments", cmd)
        self.assertIn("-hls_segment_filename /var/www/hls/stream_%03d.ts", cmd)
        self.assertIn("/var/www/hls/stream.m3u8", cmd)

        # Test 3: HLS Output remote with custom headers
        payload_output_hls_remote = {
            "name": "Test Output HLS Remote",
            "type": "service",
            "input_config": {"input1": {"type": "file", "path": "/tmp/test.mp4"}},
            "output_config": {
                "type": "hls",
                "path": "http://ingest.server/live/stream.m3u8",
                "hls_method": "PUT",
                "hls_time": 2,
                "hls_list_size": 5,
                "headers": "Authorization: Bearer test_token"
            },
            "codec_config": {"vcodec": "libx264"}
        }
        res = self.client.post("/processes/preview-cmd", json=payload_output_hls_remote)
        self.assertEqual(res.status_code, 200)
        cmd = res.json()["command"]
        self.assertIn("-f hls", cmd)
        self.assertIn("-method PUT", cmd)
        self.assertIn("-headers 'Authorization: Bearer test_token\r\n'", cmd)
        self.assertIn("http://ingest.server/live/stream.m3u8", cmd)

    def test_create_process_hls_abr(self):
        payload = {
            "name": "API Test HLS ABR",
            "type": "service",
            "input_config": {"input1": {"type": "file", "path": "/tmp/test.mp4"}},
            "output_config": {
                "type": "hls",
                "path": "/var/www/hls/abr.m3u8",
                "hls_time": 4,
                "hls_list_size": 10,
                "hls_delete_segments": True,
                "variants": [
                    {"resolution": "1920:1080", "video_bitrate": "4500k", "audio_bitrate": "192k"},
                    {"resolution": "1280:720", "video_bitrate": "2500k", "audio_bitrate": "128k"}
                ]
            },
            "codec_config": {"vcodec": "libx264"}
        }
        res = self.client.post("/processes", json=payload)
        self.assertEqual(res.status_code, 200)
        proc_id = res.json()["id"]
        
        # Recuperar proceso
        res = self.client.get("/processes")
        self.assertEqual(res.status_code, 200)
        procs = res.json()
        proc = next(p for p in procs if p["id"] == proc_id)
        self.assertIn("variants", proc["output_config"])
        self.assertEqual(len(proc["output_config"]["variants"]), 2)
        
        # Cleanup
        self.client.delete(f"/processes/{proc_id}")

if __name__ == "__main__":
    unittest.main()
