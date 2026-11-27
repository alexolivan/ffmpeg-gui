import os
import sys
import unittest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from database.models import Base, Service
from utils.port_validator import validate_service_port_conflicts


class TestSrtCallerAndMediaMtxPorts(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

        self.mtx = Service(
            name="Local Hub",
            service_type="mediamtx_hub",
            config={
                "mediamtx_config": {
                    "rtmp_enabled": True,
                    "rtmp_port": 1935,
                    "rtsp_enabled": True,
                    "rtsp_port": 8554,
                    "hls_enabled": True,
                    "hls_port": 8888,
                    "srt_enabled": True,
                    "srt_port": 8890,
                    "api_enabled": False,
                }
            },
        )
        self.db.add(self.mtx)
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_multiple_srt_callers_to_mediamtx_8890_allowed(self):
        barras = Service(
            name="Barras",
            service_type="ffmpeg_stream",
            input_config={"type": "lavfi_testsrc"},
            output_config={
                "type": "srt",
                "host": "127.0.0.1",
                "port": 8890,
                "mode": "caller",
                "is_mediamtx": True,
                "streamid": "#!::r=barras,m=publish",
            },
        )
        self.db.add(barras)
        self.db.commit()

        # Second SRT caller to 127.0.0.1:8890 (with and without explicit mode) must succeed
        validate_service_port_conflicts(
            self.db,
            None,
            "Stream 2",
            "ffmpeg_stream",
            {},
            {"type": "srt", "host": "127.0.0.1", "port": 8890, "is_mediamtx": True},
            {
                "type": "srt",
                "host": "127.0.0.1",
                "port": 8890,
                "mode": "caller",
                "streamid": "#!::r=stream2,m=publish",
            },
        )

    def test_two_srt_local_listeners_still_collide(self):
        listener1 = Service(
            name="Listener 1",
            service_type="ffmpeg_stream",
            input_config={"type": "lavfi_testsrc"},
            output_config={"type": "srt", "host": "0.0.0.0", "port": 9100, "mode": "listener"},
        )
        self.db.add(listener1)
        self.db.commit()

        with self.assertRaises(HTTPException) as ctx:
            validate_service_port_conflicts(
                self.db,
                None,
                "Listener 2",
                "ffmpeg_stream",
                {},
                {"type": "lavfi_testsrc"},
                {"type": "srt", "host": "0.0.0.0", "port": 9100, "mode": "listener"},
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Port collision", ctx.exception.detail)
