import unittest
import tempfile
import os
import shutil
from fastapi.testclient import TestClient
from main import app, get_db
from database.db import Base
from database.models import MediaProcess
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

class TestProcessHlsEndpoint(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.mkdtemp()
        cls.db_path = os.path.join(cls.temp_dir, "test.db")
        cls.engine = create_engine(f"sqlite:///{cls.db_path}", connect_args={"check_same_thread": False})
        cls.TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=cls.engine)
        Base.metadata.create_all(bind=cls.engine)

        def override_get_db():
            db = cls.TestingSessionLocal()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        app.dependency_overrides.clear()
        shutil.rmtree(cls.temp_dir, ignore_errors=True)

    def test_process_hls_serving(self):
        # Create an HLS directory with sample files
        hls_dir = os.path.join(self.temp_dir, "hls_stream")
        os.makedirs(hls_dir, exist_ok=True)
        m3u8_file = os.path.join(hls_dir, "stream1.m3u8")
        with open(m3u8_file, "w") as f:
            f.write("#EXTM3U\n#EXT-X-VERSION:3\n")

        ts_file = os.path.join(hls_dir, "stream1_000.ts")
        with open(ts_file, "wb") as f:
            f.write(b"SAMPLE_TS_DATA")

        db = self.TestingSessionLocal()
        proc = MediaProcess(
            name="HLS Service Test",
            type="service",
            output_config={"type": "hls", "path": hls_dir, "hls_stream_name": "stream1"},
            config={"output_config": {"type": "hls", "path": hls_dir, "hls_stream_name": "stream1"}}
        )
        db.add(proc)
        db.commit()
        db.refresh(proc)
        proc_id = proc.id
        db.close()

        # 1. Fetch .m3u8
        res = self.client.get(f"/processes/{proc_id}/hls/stream1.m3u8")
        self.assertEqual(res.status_code, 200)
        self.assertIn("#EXTM3U", res.text)
        self.assertEqual(res.headers.get("access-control-allow-origin"), "*")
        self.assertIn("application/vnd.apple.mpegurl", res.headers.get("content-type"))

        # 2. Fetch .ts
        res_ts = self.client.get(f"/processes/{proc_id}/hls/stream1_000.ts")
        self.assertEqual(res_ts.status_code, 200)
        self.assertEqual(res_ts.content, b"SAMPLE_TS_DATA")
        self.assertEqual(res_ts.headers.get("access-control-allow-origin"), "*")

        # 3. Path traversal attack blocked
        res_sec = self.client.get(f"/processes/{proc_id}/hls/../../etc/passwd")
        self.assertIn(res_sec.status_code, [403, 404])

        # 4. Non-existent file
        res_404 = self.client.get(f"/processes/{proc_id}/hls/nonexistent.m3u8")
        self.assertEqual(res_404.status_code, 404)

    def test_public_hls_path_resolution(self):
        from database.models import Storage
        db = self.TestingSessionLocal()
        
        # 1. Storage with route_path
        storage_routed = Storage(name="HLS Routed", path=self.temp_dir, type="hls", route_path="/live_channel")
        # 2. Storage without route_path
        storage_unrouted = Storage(name="HLS Unrouted", path=self.temp_dir, type="hls", route_path=None)
        db.add_all([storage_routed, storage_unrouted])
        db.commit()
        db.refresh(storage_routed)
        routed_id = storage_routed.id
        unrouted_id = storage_unrouted.id

        proc_with_route = MediaProcess(
            name="Service Routed",
            type="service",
            output_config={"type": "hls", "storage_id": routed_id, "relative_path": "sub", "hls_stream_name": "ch1"},
            config={"output_config": {"type": "hls", "storage_id": routed_id, "relative_path": "sub", "hls_stream_name": "ch1"}}
        )
        proc_without_route = MediaProcess(
            name="Service Unrouted",
            type="service",
            output_config={"type": "hls", "storage_id": unrouted_id, "relative_path": "sub", "hls_stream_name": "ch2"},
            config={"output_config": {"type": "hls", "storage_id": unrouted_id, "relative_path": "sub", "hls_stream_name": "ch2"}}
        )
        proc_str_id = MediaProcess(
            name="Service String Storage ID",
            type="service",
            output_config={"type": "hls", "storage_id": str(routed_id), "relative_path": "live", "hls_stream_name": "stream1"},
            config={"output_config": {"type": "hls", "storage_id": str(routed_id), "relative_path": "live", "hls_stream_name": "stream1"}}
        )
        proc_path_match = MediaProcess(
            name="Service Path Match",
            type="service",
            output_config={"type": "hls", "path": os.path.join(self.temp_dir, "live", "stream2.m3u8")},
            config={"output_config": {"type": "hls", "path": os.path.join(self.temp_dir, "live", "stream2.m3u8")}}
        )
        db.add_all([proc_with_route, proc_without_route, proc_str_id, proc_path_match])
        db.commit()
        db.refresh(proc_with_route)
        db.refresh(proc_without_route)
        db.refresh(proc_str_id)
        db.refresh(proc_path_match)
        id_routed = proc_with_route.id
        id_unrouted = proc_without_route.id
        id_str = proc_str_id.id
        id_path = proc_path_match.id
        db.close()

        res = self.client.get("/processes")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        
        item_routed = next((p for p in data if p["id"] == id_routed), None)
        item_unrouted = next((p for p in data if p["id"] == id_unrouted), None)
        item_str = next((p for p in data if p["id"] == id_str), None)
        item_path = next((p for p in data if p["id"] == id_path), None)

        self.assertIsNotNone(item_routed)
        self.assertEqual(item_routed.get("public_hls_path"), "/live_channel/sub/ch1.m3u8")

        self.assertIsNotNone(item_unrouted)
        self.assertIsNone(item_unrouted.get("public_hls_path"))

        self.assertIsNotNone(item_str)
        self.assertEqual(item_str.get("public_hls_path"), "/live_channel/live/stream1.m3u8")

        self.assertIsNotNone(item_path)
        self.assertEqual(item_path.get("public_hls_path"), "/live_channel/live/stream2.m3u8")

if __name__ == "__main__":
    unittest.main()
