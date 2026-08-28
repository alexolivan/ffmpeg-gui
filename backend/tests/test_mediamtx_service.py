import os
import unittest
import yaml
from unittest.mock import MagicMock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database.models import Base, Service, Storage
from core.process_manager import ProcessManager


class TestMediaMtxService(unittest.TestCase):

    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()
        self.pm = ProcessManager(db_session_factory=self.Session)

        # Create dummy storage
        self.storage = Storage(name="Default HLS", path="/tmp/test_hls", type="hls", is_default=True)
        self.db.add(self.storage)
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_build_mediamtx_config_and_cmd(self):
        service = Service(
            name="MediaMTX Test Hub",
            service_type="mediamtx_hub",
            config={
                "mediamtx_config": {
                    "rtsp_enabled": True,
                    "rtsp_port": 8554,
                    "rtmp_enabled": True,
                    "rtmp_port": 1935,
                    "hls_enabled": True,
                    "hls_port": 8888,
                    "hls_storage_id": self.storage.id,
                    "webrtc_enabled": False,
                    "srt_enabled": False,
                    "log_level": "debug"
                }
            }
        )
        self.db.add(service)
        self.db.commit()
        self.db.refresh(service)

        cmd, ephem_path = self.pm._build_mediamtx_config_and_cmd(service, "/usr/local/bin/mediamtx", self.db)
        
        self.assertEqual(cmd[0], "/usr/local/bin/mediamtx")
        self.assertEqual(cmd[1], ephem_path)
        self.assertTrue(os.path.exists(ephem_path))

        # Inspect generated YAML content
        with open(ephem_path, "r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f)

        self.assertEqual(cfg.get("logLevel"), "debug")
        self.assertTrue(cfg.get("rtsp"))
        self.assertEqual(cfg.get("rtspAddress"), ":8554")
        self.assertTrue(cfg.get("rtmp"))
        self.assertEqual(cfg.get("rtmpAddress"), ":1935")
        self.assertTrue(cfg.get("hls"))
        self.assertEqual(cfg.get("hlsAddress"), ":8888")
        self.assertEqual(cfg.get("hlsSegmentCount"), 7)
        self.assertEqual(cfg.get("hlsSegmentDuration"), "2s")

        # Clean up ephemeral file
        if os.path.exists(ephem_path):
            os.remove(ephem_path)


if __name__ == "__main__":
    unittest.main()
