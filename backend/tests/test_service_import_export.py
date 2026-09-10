import unittest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database.models import Service, SoftwareBuild
from database.db import SessionLocal, init_db
import main

class TestServiceImportExport(unittest.TestCase):
    def setUp(self):
        init_db()
        self.client = TestClient(main.app)
        self.db = SessionLocal()

        # Create default builds for testing
        self.ffmpeg_build = self.db.query(SoftwareBuild).filter(SoftwareBuild.software_type == 'ffmpeg', SoftwareBuild.is_default == True).first()
        if not self.ffmpeg_build:
            self.ffmpeg_build = SoftwareBuild(name="FFmpeg Default", software_type="ffmpeg", version_tag="7.1", is_default=True, status="ready")
            self.db.add(self.ffmpeg_build)

        self.mediamtx_build = self.db.query(SoftwareBuild).filter(SoftwareBuild.software_type == 'mediamtx', SoftwareBuild.is_default == True).first()
        if not self.mediamtx_build:
            self.mediamtx_build = SoftwareBuild(name="MediaMTX Default", software_type="mediamtx", version_tag="v1.20.1", is_default=True, status="ready")
            self.db.add(self.mediamtx_build)
            
        self.db.commit()

    def tearDown(self):
        for s in self.db.query(Service).filter((Service.name.like("%MediaMTX Master Hub%")) | (Service.name.like("%Old MTX%")) | (Service.name.like("%Transcoder Stream 1%"))).all():
            self.db.delete(s)
        self.db.commit()
        self.db.close()

    def test_export_and_import_mediamtx_service(self):
        # 1. Create MediaMTX Service
        mtx_service = Service(
            name="MediaMTX Master Hub",
            alias="MTX-LIVE",
            service_type="mediamtx_hub",
            config={
                "mediamtx_config": {
                    "rtmp_enabled": True,
                    "rtmp_port": 1935,
                    "srt_enabled": True,
                    "srt_port": 8890,
                    "paths": {
                        "live": {"mode": "open"}
                    }
                },
                "auto_start": True,
                "startup_order": 1,
                "software_build_id": self.mediamtx_build.id
            }
        )
        self.db.add(mtx_service)
        self.db.commit()

        # 2. Export service
        res_exp = self.client.get(f"/processes/{mtx_service.id}/export")
        self.assertEqual(res_exp.status_code, 200)
        exported = res_exp.json()

        self.assertEqual(exported["version"], 2)
        profile = exported["profile"]
        self.assertEqual(profile["name"], "MediaMTX Master Hub")
        self.assertEqual(profile["alias"], "MTX-LIVE")
        self.assertEqual(profile["service_type"], "mediamtx_hub")
        self.assertIn("mediamtx_config", profile["config"])
        self.assertEqual(profile["config"]["mediamtx_config"]["srt_port"], 8890)

        # 3. Import service from the exported JSON
        res_imp = self.client.post("/processes/import", json=exported)
        self.assertEqual(res_imp.status_code, 200)
        imported_data = res_imp.json()

        self.assertEqual(imported_data["service_type"], "mediamtx_hub")
        self.assertEqual(imported_data["alias"], "MTX-LIVE")
        self.assertIn("Imported: MediaMTX Master Hub", imported_data["name"])
        self.assertEqual(imported_data["config"]["mediamtx_config"]["srt_port"], 8890)

        # 4. Verify in DB
        imported_db = self.db.query(Service).filter(Service.id == imported_data["id"]).first()
        self.assertIsNotNone(imported_db)
        self.assertEqual(imported_db.service_type, "mediamtx_hub")
        self.assertEqual(imported_db.config["mediamtx_config"]["srt_port"], 8890)

    def test_legacy_1x_json_import_auto_detects_mediamtx(self):
        # A legacy 1.x or incomplete export that has mediamtx_config at top level without service_type
        legacy_payload = {
            "version": 2,
            "profile": {
                "name": "Old MTX",
                "alias": "OLDMTX",
                "type": "service",
                "mediamtx_config": {
                    "rtmp_port": 1935,
                    "hls_port": 8888
                }
            }
        }
        res_imp = self.client.post("/processes/import", json=legacy_payload)
        self.assertEqual(res_imp.status_code, 200)
        imported_data = res_imp.json()
        self.assertEqual(imported_data["service_type"], "mediamtx_hub")
        self.assertEqual(imported_data["config"]["mediamtx_config"]["hls_port"], 8888)

    def test_export_and_import_ffmpeg_service(self):
        # Standard FFmpeg service
        ff_service = Service(
            name="Transcoder Stream 1",
            alias="TX1",
            service_type="ffmpeg_stream",
            config={
                "input_config": {"input1": {"type": "udp", "host": "239.0.0.1", "port": 1234}},
                "output_config": {"type": "srt", "host": "127.0.0.1", "port": 8890, "mode": "caller"},
                "codec_config": {"vcodec": "libx264", "acodec": "aac"},
                "filter_config": {"scale": "1920:1080"},
                "auto_start": True
            }
        )
        self.db.add(ff_service)
        self.db.commit()

        res_exp = self.client.get(f"/processes/{ff_service.id}/export")
        self.assertEqual(res_exp.status_code, 200)
        exported = res_exp.json()

        self.assertEqual(exported["profile"]["service_type"], "ffmpeg_stream")

        res_imp = self.client.post("/processes/import", json=exported)
        self.assertEqual(res_imp.status_code, 200)
        imported_data = res_imp.json()

        self.assertEqual(imported_data["service_type"], "ffmpeg_stream")
        self.assertEqual(imported_data["input_config"]["input1"]["port"], 1234)
        self.assertEqual(imported_data["output_config"]["type"], "srt")


    def test_export_and_import_service_with_peer_flags_and_sanitization(self):
        # Service with peer sharing and foreign peer references
        svc = Service(
            name="MediaMTX Master Hub Peer",
            alias="MTX-PEER",
            service_type="mediamtx_hub",
            is_shared_with_peers=True,
            allow_peer_lease=True,
            config={
                "output_config": {
                    "type": "srt",
                    "host": "10.0.0.99",
                    "peer_node_id": 99999,
                    "peer_service_id": 88888,
                    "provider_service_id": 77777
                }
            }
        )
        self.db.add(svc)
        self.db.commit()

        res_exp = self.client.get(f"/processes/{svc.id}/export")
        self.assertEqual(res_exp.status_code, 200)
        exported = res_exp.json()
        self.assertTrue(exported["profile"]["is_shared_with_peers"])
        self.assertTrue(exported["profile"]["allow_peer_lease"])

        # Import into DB
        res_imp = self.client.post("/processes/import", json=exported)
        self.assertEqual(res_imp.status_code, 200)
        imported_data = res_imp.json()
        self.assertTrue(imported_data["is_shared_with_peers"])
        self.assertTrue(imported_data["allow_peer_lease"])
        
        # Foreign IDs 99999, 88888, 77777 do not exist in DB, so they must be sanitized out
        out_cfg = imported_data["output_config"]
        self.assertNotIn("peer_node_id", out_cfg)
        self.assertNotIn("peer_service_id", out_cfg)
        self.assertNotIn("provider_service_id", out_cfg)

    def test_tasks_export_and_import(self):
        from database.models import ScheduledTask
        t = ScheduledTask(
            name="Test Task 1",
            schedule_type="manual",
            is_active=False,
            ffmpeg_build_id=99999, # Non-existent build ID
            allow_auto_start_deps=True,
            allow_auto_stop_deps=True,
            input_config={"input1": {"type": "file", "path": "/tmp/test.mp4"}},
            output_config={"type": "udp", "host": "127.0.0.1", "port": 5000},
            codec_config={"vcodec": "copy"}
        )
        self.db.add(t)
        self.db.commit()

        # Export single
        res_single = self.client.get(f"/tasks/{t.id}/export")
        self.assertEqual(res_single.status_code, 200)
        task_data = res_single.json()
        self.assertTrue(task_data["task"]["allow_auto_start_deps"])
        self.assertTrue(task_data["task"]["allow_auto_stop_deps"])

        # Export all
        res_all = self.client.get("/tasks/export")
        self.assertEqual(res_all.status_code, 200)
        all_data = res_all.json()
        self.assertTrue(any(item["name"] == "Test Task 1" for item in all_data["tasks"]))

        # Import task (should resolve missing build 99999 to default ffmpeg build)
        res_imp = self.client.post("/tasks/import", json=task_data)
        self.assertEqual(res_imp.status_code, 200)
        
        imported_task = self.db.query(ScheduledTask).filter(ScheduledTask.name == "Imported: Test Task 1").first()
        self.assertIsNotNone(imported_task)
        self.assertEqual(imported_task.ffmpeg_build_id, self.ffmpeg_build.id)
        self.assertTrue(imported_task.allow_auto_start_deps)
        self.assertTrue(imported_task.allow_auto_stop_deps)

        self.db.delete(t)
        self.db.delete(imported_task)
        self.db.commit()


if __name__ == "__main__":
    unittest.main()

