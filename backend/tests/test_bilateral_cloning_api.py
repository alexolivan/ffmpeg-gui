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

    def test_clone_mediamtx_service(self):
        mtx_proc = MediaProcess(
            name="Test Clone MediaMTX Hub",
            service_type="mediamtx_hub",
            status="running",
            config={
                "mediamtx_config": {
                    "rtmp_enabled": True, "rtmp_port": 1935,
                    "rtsp_enabled": True, "rtsp_port": 8554,
                    "rtp_port": 8000, "rtcp_port": 8001,
                    "hls_enabled": True, "hls_port": 8888,
                    "webrtc_enabled": True, "webrtc_port": 8889, "webrtc_udp_port": 8189,
                    "srt_enabled": True, "srt_port": 8890,
                    "api_enabled": True, "api_port": 9997,
                    "ssl_enabled": False, "rtmps_enabled": False, "rtmps_port": 1936,
                    "rtsps_enabled": False, "rtsps_port": 8322
                }
            }
        )
        self.db.add(mtx_proc)
        self.db.commit()
        self.db.refresh(mtx_proc)

        res = self.client.post(f"/processes/{mtx_proc.id}/clone")
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["name"], "Test Clone MediaMTX Hub (Copy)")
        self.assertEqual(data["service_type"], "mediamtx_hub")
        self.assertEqual(data["status"], "stopped")
        self.assertFalse(data["auto_start"])

        # Check conflict-free port allocation (e.g. +10 offset for collision avoidance)
        cloned_mtx = data["config"]["mediamtx_config"]
        self.assertNotEqual(cloned_mtx["rtmp_port"], 1935)
        self.assertNotEqual(cloned_mtx["rtsp_port"], 8554)
        self.assertNotEqual(cloned_mtx["api_port"], 9997)
        self.assertEqual(cloned_mtx["rtmp_port"], 1945)
        self.assertEqual(cloned_mtx["rtsp_port"], 8564)
        self.assertEqual(cloned_mtx["api_port"], 9998)

    def test_clone_icecast_service(self):
        ice_proc = MediaProcess(
            name="Test Clone Icecast Server",
            service_type="icecast_server",
            status="running",
            config={
                "icecast_config": {
                    "http_enabled": True,
                    "port": 7000,
                    "ssl_enabled": True,
                    "ssl_port": 7443,
                    "mounts": [{"mount_name": "/live.mp3"}]
                }
            }
        )
        self.db.add(ice_proc)
        self.db.commit()
        self.db.refresh(ice_proc)

        res = self.client.post(f"/processes/{ice_proc.id}/clone")
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["name"], "Test Clone Icecast Server (Copy)")
        self.assertEqual(data["service_type"], "icecast_server")
        self.assertEqual(data["status"], "stopped")
        self.assertFalse(data["auto_start"])

        # Check conflict-free port allocation (TCP 7XXX range: 7000 -> 7010, 7443 -> 7453)
        cloned_ice = data["config"]["icecast_config"]
        self.assertEqual(cloned_ice["port"], 7010)
        self.assertEqual(cloned_ice["ssl_port"], 7453)

    def test_clone_ffmpeg_stream_with_listener(self):
        ff_proc = MediaProcess(
            name="Test Clone FFmpeg SRT",
            service_type="ffmpeg_stream",
            status="running",
            input_config={"input1": {"type": "srt", "mode": "listener", "port": 9000}},
            output_config={"type": "udp", "host": "239.0.0.1", "port": 1234}
        )
        self.db.add(ff_proc)
        self.db.commit()
        self.db.refresh(ff_proc)

        res = self.client.post(f"/processes/{ff_proc.id}/clone")
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["name"], "Test Clone FFmpeg SRT (Copy)")
        self.assertEqual(data["status"], "stopped")
        # Port 9000 occupied by original, so clone gets 9001
        self.assertEqual(int(data["input_config"]["input1"]["port"]), 9001)

