import unittest
from unittest.mock import patch
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

    def test_hls_abr_command_generation(self):
        payload = {
            "name": "Test Command HLS ABR",
            "type": "service",
            "input_config": {"input1": {"type": "file", "path": "/tmp/test.mp4"}},
            "output_config": {
                "type": "hls",
                "path": "/var/www/hls/stream.m3u8",
                "hls_method": "local",
                "hls_time": 4,
                "hls_list_size": 10,
                "hls_delete_segments": True,
                "variants": [
                    {"resolution": "1920:1080", "video_bitrate": "4500k", "audio_bitrate": "192k"},
                    {"resolution": "1280:720", "video_bitrate": "2500k", "audio_bitrate": "192k"},
                    {"resolution": "854:480", "video_bitrate": "1000k", "audio_bitrate": "96k"}
                ]
            },
            "codec_config": {"vcodec": "libx264"}
        }
        res = self.client.post("/processes/preview-cmd", json=payload)
        self.assertEqual(res.status_code, 200)
        cmd = res.json()["command"]
        
        # Validaciones de video
        self.assertIn("-filter:v:0 scale=1920:1080", cmd)
        self.assertIn("-filter:v:1 scale=1280:720", cmd)
        self.assertIn("-filter:v:2 scale=854:480", cmd)
        self.assertIn("-c:v:0 libx264 -b:v:0 4500k", cmd)
        self.assertIn("-c:v:1 libx264 -b:v:1 2500k", cmd)
        self.assertIn("-c:v:2 libx264 -b:v:2 1000k", cmd)
        
        # Validaciones de audio (deduplicado: sólo 2 streams de audio para 3 variantes)
        self.assertIn("-b:a:0 192k", cmd)
        self.assertIn("-b:a:1 96k", cmd)
        # No debe haber un tercer codificador de audio con 192k o 96k ya que se reutiliza
        self.assertNotIn("-b:a:2", cmd)
        
        # Validaciones de muxer HLS ABR
        self.assertIn("-f hls", cmd)
        self.assertIn("-hls_time 4", cmd)
        self.assertIn("-hls_list_size 10", cmd)
        self.assertIn("-master_pl_name master.m3u8", cmd)
        self.assertIn("v:0,a:0 v:1,a:0 v:2,a:1", cmd)
        self.assertIn("-hls_segment_filename /var/www/hls/stream_%v_%03d.ts", cmd)
        self.assertIn("/var/www/hls/stream_%v.m3u8", cmd)

    def test_task_hls_abr_command_generation(self):
        payload = {
            "name": "API Test Task HLS ABR",
            "input_config": {"type": "file", "path": "/tmp/test.mp4"},
            "output_config": {
                "type": "hls",
                "path": "/var/www/hls/task_abr.m3u8",
                "variants": [
                    {"resolution": "1920:1080", "video_bitrate": "4500k", "audio_bitrate": "128k"}
                ]
            },
            "codec_config": {"vcodec": "libx264"},
            "schedule_type": "manual"
        }
        res = self.client.post("/tasks/preview-cmd", json=payload)
        self.assertEqual(res.status_code, 200)
        cmd = res.json()["command"]
        self.assertIn("-filter:v:0 scale=1920:1080", cmd)
        self.assertIn("v:0,a:0", cmd)

    @patch("asyncio.create_subprocess_exec")
    def test_hls_abr_e2e_execution(self, mock_exec):
        import asyncio
        from unittest.mock import MagicMock
        
        # Mocking the async subprocess response
        mock_proc = MagicMock()
        mock_proc.pid = 99999
        mock_proc.returncode = None
        
        # Async mock for wait
        async def mock_wait():
            return 0
        mock_proc.wait = mock_wait
        
        # Async mock for create_subprocess_exec
        async def mock_create(*args, **kwargs):
            return mock_proc
        mock_exec.side_effect = mock_create
        
        payload = {
            "name": "E2E Task HLS ABR",
            "input_config": {
                "input1": {
                    "type": "lavfi",
                    "path": "testsrc=size=640x360:rate=25"
                },
                "has_video": True,
                "has_audio": False,
                "use_secondary_input": False
            },
            "output_config": {
                "type": "hls",
                "path": "/tmp/live.m3u8",
                "hls_method": "local",
                "hls_time": 1,
                "hls_list_size": 3,
                "hls_delete_segments": True,
                "variants": [
                    {"resolution": "480x270", "video_bitrate": "150k", "audio_bitrate": "64k"},
                    {"resolution": "320x180", "video_bitrate": "80k", "audio_bitrate": "64k"}
                ]
            },
            "codec_config": {
                "vcodec": "libx264",
                "acodec": "aac"
            },
            "schedule_type": "manual"
        }
        res = self.client.post("/tasks", json=payload)
        self.assertEqual(res.status_code, 200)
        task_id = res.json()["id"]
        
        try:
            res = self.client.post(f"/tasks/{task_id}/trigger")
            self.assertEqual(res.status_code, 200)
            exec_id = res.json()["execution_id"]
            
            # Verify execution triggered
            self.assertIsNotNone(exec_id)
            
            res = self.client.post(f"/tasks/executions/{exec_id}/stop")
            self.assertEqual(res.status_code, 200)
            
        finally:
            self.client.delete(f"/tasks/{task_id}")

    def test_hwaccel_command_generation(self):
        payload = {
            "name": "Test HWaccel Command Generation",
            "type": "service",
            "input_config": {"input1": {"type": "file", "path": "/tmp/test.mp4"}},
            "output_config": {"type": "udp", "host": "127.0.0.1", "port": "1234"},
            "codec_config": {"vcodec": "libx264"},
            "filter_config": {
                "advanced": {
                    "hwaccel": "cuda",
                    "hwaccel_output_format": ""
                }
            }
        }
        res = self.client.post("/processes/preview-cmd", json=payload)
        self.assertEqual(res.status_code, 200)
        cmd = res.json()["command"]
        self.assertIn("-hwaccel cuda", cmd)
        # Verify that we do not have an empty format argument
        self.assertNotIn("-hwaccel_output_format ''", cmd)
        self.assertNotIn("-hwaccel_output_format \"\"", cmd)

    def test_decklink_rawvideo_mapping_preview(self):
        # Test mapping in process_manager (services)
        payload_service = {
            "name": "Test DeckLink Service Preview",
            "type": "service",
            "input_config": {"input1": {"type": "file", "path": "/tmp/test.mp4"}},
            "output_config": {
                "type": "decklink",
                "device": "Intensity Pro",
                "format_code": "Hi50",
                "video_size": "1920x1080",
                "framerate": "25"
            },
            "codec_config": {"vcodec": "rawvideo", "video_params": {"pix_fmt": "uyvy422"}},
            "filter_config": {}
        }
        res = self.client.post("/processes/preview-cmd", json=payload_service)
        self.assertEqual(res.status_code, 200)
        cmd = res.json()["command"]
        self.assertIn("-c:v wrapped_avframe", cmd)
        self.assertNotIn("-c:v rawvideo", cmd)
        self.assertIn("-pix_fmt uyvy422", cmd)
        self.assertNotIn("-s:v 1920x1080", cmd)
        self.assertNotIn("-r:v 25", cmd)

        # Test mapping in task_manager (tasks)
        payload_task = {
            "name": "API Test DeckLink Task Preview",
            "input_config": {"type": "file", "path": "/tmp/test.mp4"},
            "output_config": {
                "type": "decklink",
                "device": "Intensity Pro",
                "format_code": "Hi50",
                "video_size": "1920x1080",
                "framerate": "25"
            },
            "codec_config": {"vcodec": "rawvideo", "video_params": {"pix_fmt": "uyvy422"}},
            "schedule_type": "manual"
        }
        res = self.client.post("/tasks/preview-cmd", json=payload_task)
        self.assertEqual(res.status_code, 200)
        cmd_task = res.json()["command"]
        self.assertIn("-c:v wrapped_avframe", cmd_task)
        self.assertNotIn("-c:v rawvideo", cmd_task)
        self.assertIn("-pix_fmt uyvy422", cmd_task)
        self.assertNotIn("-s:v 1920x1080", cmd_task)
        self.assertNotIn("-r:v 25", cmd_task)

    def test_process_alias_serialization(self):
        # 1. Create a process with alias
        payload = {
            "name": "API Test Process Alias",
            "alias": "My-Alias_123",
            "type": "service",
            "input_config": {"input1": {"type": "file", "path": "/tmp/test.mp4"}},
            "output_config": {"type": "udp", "host": "127.0.0.1", "port": "1234"},
            "codec_config": {"vcodec": "libx264"}
        }
        res = self.client.post("/processes", json=payload)
        self.assertEqual(res.status_code, 200)
        proc_id = res.json()["id"]
        self.assertEqual(res.json()["alias"], "My-Alias_123")

        # 2. Get processes list and verify alias is present
        res = self.client.get("/processes")
        self.assertEqual(res.status_code, 200)
        procs = res.json()
        proc = next(p for p in procs if p["id"] == proc_id)
        self.assertEqual(proc["alias"], "My-Alias_123")

        # 3. Update process alias
        update_payload = {"alias": "New-Alias"}
        res = self.client.put(f"/processes/{proc_id}", json=update_payload)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["alias"], "New-Alias")

        # 4. Export process and verify alias is present
        res = self.client.get(f"/processes/{proc_id}/export")
        self.assertEqual(res.status_code, 200)
        exported = res.json()
        self.assertEqual(exported["profile"]["alias"], "New-Alias")

        # 5. Clean up
        self.client.delete(f"/processes/{proc_id}")

if __name__ == "__main__":
    unittest.main()
