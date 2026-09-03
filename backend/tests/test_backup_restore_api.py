import unittest
import json
from fastapi.testclient import TestClient
from main import app
from database.db import SessionLocal, init_db
from database.models import MediaProcess, ScheduledTask, Storage, FfmpegBuild

class TestBackupRestoreAPI(unittest.TestCase):
    def setUp(self):
        init_db()
        self.db = SessionLocal()
        self.client = TestClient(app)

    def tearDown(self):
        self.db.query(MediaProcess).filter(MediaProcess.name.like("Backup Test%")).delete(synchronize_session=False)
        self.db.query(ScheduledTask).filter(ScheduledTask.name.like("Backup Test%")).delete(synchronize_session=False)
        self.db.query(FfmpegBuild).filter(FfmpegBuild.name.like("Backup Test%")).delete(synchronize_session=False)
        self.db.commit()
        self.db.close()

    def test_export_and_import_backup(self):
        # Create test service, task, and mediamtx hub service
        proc = MediaProcess(
            name="Backup Test Service",
            type="service",
            status="stopped",
            input_config={"input1": {"type": "file", "path": "/tmp/test.mp4"}},
            output_config={"type": "udp", "host": "127.0.0.1", "port": "1234"},
            codec_config={"vcodec": "copy"},
            filter_config={}
        )
        mtx_proc = MediaProcess(
            name="Backup Test MediaMTX",
            service_type="mediamtx_hub",
            status="stopped",
            mediamtx_config={"paths": {"live": {}}, "srt_port": 8890}
        )
        task = ScheduledTask(
            name="Backup Test Task",
            schedule_type="manual",
            is_active=False,
            input_config={"input1": {"type": "file", "path": "/tmp/test.mp4"}},
            output_config={"type": "udp", "host": "127.0.0.1", "port": "1234"},
            codec_config={"vcodec": "copy"},
            filter_config={}
        )
        build = FfmpegBuild(
            name="Backup Test Build",
            software_type="ffmpeg",
            source_type="installed",
            version_tag="n7.1",
            system_path="/usr/bin/ffmpeg",
            is_managed=False,
            status="ready"
        )
        self.db.add(proc)
        self.db.add(mtx_proc)
        self.db.add(task)
        self.db.add(build)
        self.db.commit()

        # 1. Export
        export_payload = {
            "gui_general": True,
            "gui_network_ssl": True,
            "lcd_display": True,
            "logging_retention": True,
            "watchdog_grace": True,
            "services": True,
            "tasks": True,
            "storage_volumes": True,
            "notifications": True,
            "software_engines": True
        }
        res = self.client.post("/api/backup/export", json=export_payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["app"], "ffmpeg-gui")
        self.assertIn("sections", data)
        self.assertIn("gui_general", data["sections"])
        self.assertIn("lcd_display", data["sections"])
        self.assertIn("services", data["sections"])
        self.assertIn("tasks", data["sections"])
        self.assertIn("software_engines", data["sections"])

        # Check service name and type in exported data
        service_names = [s["name"] for s in data["sections"]["services"]]
        self.assertIn("Backup Test Service", service_names)
        self.assertIn("Backup Test MediaMTX", service_names)

        mtx_export = next(s for s in data["sections"]["services"] if s["name"] == "Backup Test MediaMTX")
        self.assertEqual(mtx_export["service_type"], "mediamtx_hub")
        self.assertEqual(mtx_export["mediamtx_config"]["srt_port"], 8890)

        # 2. Delete from DB
        self.db.query(MediaProcess).filter_by(name="Backup Test Service").delete()
        self.db.query(MediaProcess).filter_by(name="Backup Test MediaMTX").delete()
        self.db.query(ScheduledTask).filter_by(name="Backup Test Task").delete()
        self.db.query(FfmpegBuild).filter_by(name="Backup Test Build").delete()
        self.db.commit()

        # 3. Import
        import_res = self.client.post("/api/backup/import", json=data)
        self.assertEqual(import_res.status_code, 200)
        import_data = import_res.json()
        self.assertEqual(import_data["status"], "success")

        # 4. Verify restored
        restored_proc = self.db.query(MediaProcess).filter_by(name="Backup Test Service").first()
        self.assertIsNotNone(restored_proc)
        self.assertEqual(restored_proc.service_type, "ffmpeg_stream")

        restored_mtx = self.db.query(MediaProcess).filter_by(name="Backup Test MediaMTX").first()
        self.assertIsNotNone(restored_mtx)
        self.assertEqual(restored_mtx.service_type, "mediamtx_hub")
        self.assertEqual(restored_mtx.mediamtx_config.get("srt_port"), 8890)

        restored_task = self.db.query(ScheduledTask).filter_by(name="Backup Test Task").first()
        self.assertIsNotNone(restored_task)

        restored_build = self.db.query(FfmpegBuild).filter_by(name="Backup Test Build").first()
        self.assertIsNotNone(restored_build)
        self.assertEqual(restored_build.software_type, "ffmpeg")

