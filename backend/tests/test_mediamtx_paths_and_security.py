import os
import unittest
import yaml
from unittest.mock import patch, MagicMock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database.models import Base, Service, Storage
from core.process_manager import ProcessManager


class TestMediaMtxPathsAndSecurity(unittest.TestCase):

    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()
        self.pm = ProcessManager(db_session_factory=self.Session)

        # Create dummy storage for HLS if needed
        self.storage = Storage(name="Default HLS", path="/tmp/test_hls", type="hls", is_default=True)
        self.db.add(self.storage)
        self.db.commit()
        self.created_files = []

    def tearDown(self):
        self.db.close()
        for f in self.created_files:
            if os.path.exists(f):
                try:
                    os.remove(f)
                except Exception:
                    pass

    def test_global_security_yaml_generation(self):
        service = Service(
            name="MediaMTX Auth Hub",
            service_type="mediamtx_hub",
            config={
                "mediamtx_config": {
                    "security": {
                        "publish_user": "global_publisher",
                        "publish_pass": "pub_secret_123",
                        "read_user": "global_reader",
                        "read_pass": "read_secret_456",
                    }
                }
            }
        )
        self.db.add(service)
        self.db.commit()

        cmd, ephem_path = self.pm._build_mediamtx_config_and_cmd(service, "/usr/local/bin/mediamtx", self.db)
        self.created_files.append(ephem_path)

        with open(ephem_path, "r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f)

        self.assertIn("paths", cfg)
        self.assertIn("all_others", cfg["paths"])
        all_others = cfg["paths"]["all_others"]
        self.assertEqual(all_others.get("publishUser"), "global_publisher")
        self.assertEqual(all_others.get("publishPass"), "pub_secret_123")
        self.assertEqual(all_others.get("readUser"), "global_reader")
        self.assertEqual(all_others.get("readPass"), "read_secret_456")

    def test_paths_dictionary_parsing_modes(self):
        service = Service(
            name="MediaMTX Multi-Path Hub",
            service_type="mediamtx_hub",
            config={
                "mediamtx_config": {
                    "security": {
                        "publish_user": "global_pub",
                        "publish_pass": "global_pass",
                        "read_user": "global_read",
                        "read_pass": "global_rpass",
                    },
                    "paths": {
                        "default_stream": {
                            "mode": "inherit",
                        },
                        "studio_live": {
                            "mode": "custom",
                            "publish_user": "studio1",
                            "publish_pass": "studiopass123",
                            "read_user": "viewer1",
                            "read_pass": "viewerpass123",
                        },
                        "public_broadcast": {
                            "mode": "open",
                        }
                    }
                }
            }
        )
        self.db.add(service)
        self.db.commit()

        cmd, ephem_path = self.pm._build_mediamtx_config_and_cmd(service, "/usr/local/bin/mediamtx", self.db)
        self.created_files.append(ephem_path)

        with open(ephem_path, "r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f)

        paths = cfg.get("paths", {})

        # all_others should have global credentials
        self.assertEqual(paths["all_others"]["publishUser"], "global_pub")
        self.assertEqual(paths["all_others"]["publishPass"], "global_pass")
        self.assertEqual(paths["all_others"]["readUser"], "global_read")
        self.assertEqual(paths["all_others"]["readPass"], "global_rpass")

        # custom mode path
        self.assertIn("studio_live", paths)
        studio = paths["studio_live"]
        self.assertEqual(studio.get("publishUser"), "studio1")
        self.assertEqual(studio.get("publishPass"), "studiopass123")
        self.assertEqual(studio.get("readUser"), "viewer1")
        self.assertEqual(studio.get("readPass"), "viewerpass123")

        # open mode path
        self.assertIn("public_broadcast", paths)
        pub = paths["public_broadcast"]
        self.assertEqual(pub.get("publishUser"), "")
        self.assertEqual(pub.get("publishPass"), "")
        self.assertEqual(pub.get("readUser"), "")
        self.assertEqual(pub.get("readPass"), "")

        # inherit mode path
        self.assertIn("default_stream", paths)
        default_s = paths["default_stream"]
        # In inherit mode, specific user/pass should not overwrite with empty strings
        self.assertNotIn("publishUser", default_s)

    def test_ssl_enabled_configuration(self):
        service = Service(
            name="MediaMTX SSL Hub",
            service_type="mediamtx_hub",
            config={
                "mediamtx_config": {
                    "ssl_enabled": True,
                    "rtmps_enabled": True,
                    "rtmps_port": 1936,
                    "rtsps_enabled": True,
                    "rtsps_port": 8322,
                    "server_key": "/data/certs/live/privkey.pem",
                    "server_cert": "/data/certs/live/fullchain.pem",
                }
            }
        )
        self.db.add(service)
        self.db.commit()

        cmd, ephem_path = self.pm._build_mediamtx_config_and_cmd(service, "/usr/local/bin/mediamtx", self.db)
        self.created_files.append(ephem_path)

        with open(ephem_path, "r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f)

        self.assertEqual(cfg.get("serverKey"), "/data/certs/live/privkey.pem")
        self.assertEqual(cfg.get("serverCert"), "/data/certs/live/fullchain.pem")
        self.assertEqual(cfg.get("rtmpEncryption"), "optional")
        self.assertEqual(cfg.get("rtmpsAddress"), ":1936")
        self.assertEqual(cfg.get("rtspEncryption"), "optional")
        self.assertEqual(cfg.get("rtspsAddress"), ":8322")
        self.assertTrue(cfg.get("hlsEncryption"))
        self.assertTrue(cfg.get("webrtcEncryption"))
        self.assertTrue(cfg.get("apiEncryption"))


if __name__ == "__main__":
    unittest.main()
