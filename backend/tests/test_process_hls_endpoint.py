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

if __name__ == "__main__":
    unittest.main()
