import os
import shutil
import tempfile
import unittest
from unittest.mock import MagicMock
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database.models import Base, Storage
from main import app, get_db, validate_and_normalize_route_path, refresh_hls_routes_cache, _hls_routes_cache, serve_spa

class TestHlsRoutes(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.temp_dir, "test_hls.db")
        self.engine = create_engine(f"sqlite:///{self.db_path}", connect_args={"check_same_thread": False})
        self.TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)
        Base.metadata.create_all(bind=self.engine)

        def override_get_db():
            db = self.TestingSessionLocal()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)

        # Create temporary storage directories
        self.hls_dir = os.path.join(self.temp_dir, "hls_media")
        os.makedirs(self.hls_dir, exist_ok=True)

        # Create dummy playlist and segment files
        with open(os.path.join(self.hls_dir, "index.m3u8"), "w") as f:
            f.write("#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:2.0,\nseg0.ts\n")
        with open(os.path.join(self.hls_dir, "seg0.ts"), "wb") as f:
            f.write(b"MPEG-TS-DUMMY-PACKET-DATA")

    def tearDown(self):
        app.dependency_overrides.clear()
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_validate_and_normalize_route_path(self):
        # Normalization
        self.assertEqual(validate_and_normalize_route_path("live"), "/live")
        self.assertEqual(validate_and_normalize_route_path("/live/"), "/live")
        self.assertEqual(validate_and_normalize_route_path("hls/channel_1"), "/hls/channel_1")
        self.assertIsNone(validate_and_normalize_route_path(None))
        self.assertIsNone(validate_and_normalize_route_path(""))

        # Root route rejected
        with self.assertRaises(Exception) as ctx:
            validate_and_normalize_route_path("/")
        self.assertIn("Route path cannot be root", str(ctx.exception))

        # Invalid chars rejected
        with self.assertRaises(Exception) as ctx:
            validate_and_normalize_route_path("/live?query=1")
        self.assertIn("alphanumeric", str(ctx.exception))

        # Reserved prefixes rejected
        for reserved in ["api", "ws", "settings", "previews", "assets"]:
            with self.assertRaises(Exception) as ctx:
                validate_and_normalize_route_path(f"/{reserved}/stream")
            self.assertIn("reserved", str(ctx.exception))

    def test_create_and_update_storage_with_route_path(self):
        # Reject route_path on non-hls storage
        res = self.client.post("/settings/storages", json={
            "name": "Build Drive",
            "path": self.temp_dir,
            "type": "build",
            "route_path": "/builds_stream"
        })
        self.assertEqual(res.status_code, 400)
        self.assertIn("only supported for storages of type 'hls'", res.json()["detail"])

        # Accept route_path on hls storage
        res = self.client.post("/settings/storages", json={
            "name": "Live HLS",
            "path": self.hls_dir,
            "type": "hls",
            "route_path": "/live"
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()
        storage_id = data["id"]
        self.assertEqual(data["route_path"], "/live")

        # Duplicate route_path rejected
        hls_dir2 = os.path.join(self.temp_dir, "hls_media2")
        os.makedirs(hls_dir2, exist_ok=True)
        res_dup = self.client.post("/settings/storages", json={
            "name": "Duplicate Route",
            "path": hls_dir2,
            "type": "hls",
            "route_path": "/live"
        })
        self.assertEqual(res_dup.status_code, 400)
        self.assertIn("already assigned", res_dup.json()["detail"])

        # Update route_path
        res_update = self.client.put(f"/settings/storages/{storage_id}", json={
            "name": "Live HLS Renamed",
            "path": self.hls_dir,
            "route_path": "/ch1/live"
        })
        self.assertEqual(res_update.status_code, 200)
        self.assertEqual(res_update.json()["route_path"], "/ch1/live")

    def test_serve_hls_files_cors_and_caching(self):
        # Create HLS storage with route /live
        res = self.client.post("/settings/storages", json={
            "name": "Live HLS Stream",
            "path": self.hls_dir,
            "type": "hls",
            "route_path": "/live"
        })
        self.assertEqual(res.status_code, 200)

        # GET playlist: /live/index.m3u8
        resp_m3u8 = self.client.get("/live/index.m3u8")
        self.assertEqual(resp_m3u8.status_code, 200)
        self.assertIn("application/vnd.apple.mpegurl", resp_m3u8.headers.get("content-type", ""))
        self.assertEqual(resp_m3u8.headers.get("access-control-allow-origin"), "*")
        self.assertIn("no-cache", resp_m3u8.headers.get("cache-control", ""))
        self.assertIn("#EXTM3U", resp_m3u8.text)

        # GET segment: /live/seg0.ts
        resp_ts = self.client.get("/live/seg0.ts")
        self.assertEqual(resp_ts.status_code, 200)
        self.assertIn("video/mp2t", resp_ts.headers.get("content-type", "").lower())
        self.assertEqual(resp_ts.headers.get("access-control-allow-origin"), "*")
        self.assertIn("max-age=60", resp_ts.headers.get("cache-control", ""))
        self.assertEqual(resp_ts.content, b"MPEG-TS-DUMMY-PACKET-DATA")

        # Default to index.m3u8 when hitting /live or /live/
        resp_root = self.client.get("/live")
        self.assertEqual(resp_root.status_code, 200)
        self.assertIn("#EXTM3U", resp_root.text)

        # HEAD request: /live/seg0.ts
        resp_head = self.client.head("/live/seg0.ts")
        self.assertEqual(resp_head.status_code, 200)
        self.assertEqual(resp_head.headers.get("content-length"), str(len(b"MPEG-TS-DUMMY-PACKET-DATA")))
        self.assertEqual(resp_head.headers.get("access-control-allow-origin"), "*")

        # OPTIONS preflight: /live/index.m3u8
        resp_opt = self.client.options("/live/index.m3u8")
        self.assertEqual(resp_opt.status_code, 204)
        self.assertEqual(resp_opt.headers.get("access-control-allow-origin"), "*")
        self.assertIn("GET", resp_opt.headers.get("access-control-allow-methods", ""))

        # Missing segment under HLS route must return 404 (NOT SPA index.html)
        resp_missing = self.client.get("/live/seg999.ts")
        self.assertEqual(resp_missing.status_code, 404)
        self.assertEqual(resp_missing.json()["detail"], "HLS media not found")

        # Direct path traversal attempt blocked by commonpath check
        mock_req = MagicMock()
        mock_req.method = "GET"
        with self.assertRaises(HTTPException) as exc_info:
            serve_spa("live/../../etc/passwd", mock_req)
        self.assertEqual(exc_info.exception.status_code, 403)

if __name__ == "__main__":
    unittest.main()
