import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from sqlalchemy.pool import StaticPool

from main import app, get_db
from database.models import Base, SoftwareBuild
from core.software_manager import software_manager


class TestSoftwareSettingsApi(unittest.TestCase):

    def setUp(self):
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

        def override_get_db():
            db_s = self.Session()
            try:
                yield db_s
            finally:
                db_s.close()

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)
        software_manager._init_state()

    def tearDown(self):
        app.dependency_overrides.clear()
        self.db.close()

    def test_get_software_settings(self):
        response = self.client.get("/api/settings/software")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("ffmpeg", data)
        self.assertIn("mediamtx", data)
        self.assertIn("icecast2", data)
        self.assertIn("kiosk_cog", data)
        self.assertTrue(data["ffmpeg"]["is_enabled"])
        self.assertTrue(data["ffmpeg"]["supports_forge"])

    def test_update_software_config_invariant_failure(self):
        # Attempting to disable all sources for FFmpeg should return 400
        payload = {
            "ffmpeg_enabled": True,
            "ffmpeg_forge_enabled": False,
            "ffmpeg_installed_enabled": False
        }
        response = self.client.post("/api/settings/software/config", json=payload)
        self.assertEqual(response.status_code, 400)
        self.assertIn("at least one binary source", response.json()["detail"])

    def test_update_software_config_success(self):
        payload = {
            "ffmpeg_enabled": True,
            "ffmpeg_forge_enabled": True,
            "ffmpeg_installed_enabled": True,
            "mediamtx_enabled": True,
            "mediamtx_precompiled_enabled": True
        }
        response = self.client.post("/api/settings/software/config", json=payload)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["success"])

    @patch.object(software_manager, "audit_system_binary")
    def test_toggle_installed_software(self, mock_audit):
        mock_audit.return_value = {"found": True, "path": "/usr/bin/ffmpeg", "version": "7.1"}

        # Enable installed
        res = self.client.post(
            "/api/settings/software/ffmpeg/installed/toggle",
            json={"enabled": True, "alias": "System FFmpeg"}
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["action"], "registered")

        build = self.db.query(SoftwareBuild).filter(SoftwareBuild.software_type == "ffmpeg").first()
        self.assertIsNotNone(build)
        self.assertEqual(build.name, "System FFmpeg")

        # Disable installed
        res_del = self.client.post(
            "/api/settings/software/ffmpeg/installed/toggle",
            json={"enabled": False}
        )
        self.assertEqual(res_del.status_code, 200)
        self.assertEqual(res_del.json()["action"], "unregistered")

    @patch.object(software_manager, "get_mediamtx_releases")
    def test_get_mediamtx_releases(self, mock_get_rel):
        mock_get_rel.return_value = [{"tag": "1.9.3", "name": "MediaMTX v1.9.3"}]
        res = self.client.get("/api/settings/software/mediamtx/releases")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["tag"], "1.9.3")


if __name__ == "__main__":
    unittest.main()
