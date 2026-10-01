import unittest
from unittest.mock import patch, MagicMock
import os
import sys
import yaml

# Ensure backend directory is in sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from core.process_manager import ProcessManager


class TestServiceBindAddress(unittest.TestCase):
    def setUp(self):
        self.pm = ProcessManager(MagicMock())
        self.session = MagicMock()

    def test_mediamtx_config_default_bind(self):
        media_proc = MagicMock()
        media_proc.id = 101
        media_proc.config = {
            "mediamtx_config": {
                "rtsp_enabled": True,
                "rtsp_port": 8554,
                "rtmp_enabled": True,
                "rtmp_port": 1935,
                "hls_enabled": True,
                "hls_port": 8888,
                "srt_enabled": True,
                "srt_port": 8890
            }
        }
        cmd, ephem_path = self.pm._build_mediamtx_config_and_cmd(media_proc, "mediamtx", self.session)
        try:
            with open(ephem_path, "r") as f:
                cfg = yaml.safe_load(f)
            # Default should bind universally (:port)
            self.assertEqual(cfg["rtspAddress"], ":8554")
            self.assertEqual(cfg["rtmpAddress"], ":1935")
            self.assertEqual(cfg["hlsAddress"], ":8888")
            self.assertEqual(cfg["srtAddress"], ":8890")
        finally:
            if os.path.exists(ephem_path):
                os.remove(ephem_path)

    def test_mediamtx_config_specific_bind_ip(self):
        media_proc = MagicMock()
        media_proc.id = 102
        media_proc.config = {
            "mediamtx_config": {
                "bind_address": "127.0.0.1",
                "rtsp_enabled": True,
                "rtsp_port": 8554,
                "rtmp_enabled": True,
                "rtmp_port": 1935,
                "srt_enabled": True,
                "srt_port": 8890
            }
        }
        cmd, ephem_path = self.pm._build_mediamtx_config_and_cmd(media_proc, "mediamtx", self.session)
        try:
            with open(ephem_path, "r") as f:
                cfg = yaml.safe_load(f)
            self.assertEqual(cfg["rtspAddress"], "127.0.0.1:8554")
            self.assertEqual(cfg["rtmpAddress"], "127.0.0.1:1935")
            self.assertEqual(cfg["srtAddress"], "127.0.0.1:8890")
        finally:
            if os.path.exists(ephem_path):
                os.remove(ephem_path)

    def test_mediamtx_config_failsafe_fallback(self):
        media_proc = MagicMock()
        media_proc.id = 103
        media_proc.config = {
            "mediamtx_config": {
                "bind_address": "198.51.100.99", # Missing/dead IP
                "rtsp_enabled": True,
                "rtsp_port": 8554
            }
        }
        cmd, ephem_path = self.pm._build_mediamtx_config_and_cmd(media_proc, "mediamtx", self.session)
        try:
            with open(ephem_path, "r") as f:
                cfg = yaml.safe_load(f)
            # Failsafe should fallback to universal (:port)
            self.assertEqual(cfg["rtspAddress"], ":8554")
        finally:
            if os.path.exists(ephem_path):
                os.remove(ephem_path)

    def test_icecast_config_default_bind(self):
        media_proc = MagicMock()
        media_proc.id = 201
        media_proc.config = {
            "icecast_config": {
                "port": 8000
            }
        }
        cmd, ephem_path = self.pm._build_icecast_config_and_cmd(media_proc, "icecast", self.session)
        try:
            with open(ephem_path, "r") as f:
                xml_content = f.read()
            self.assertIn("<port>8000</port>", xml_content)
            self.assertNotIn("<bind-address>", xml_content)
        finally:
            if os.path.exists(ephem_path):
                os.remove(ephem_path)

    def test_icecast_config_specific_bind(self):
        media_proc = MagicMock()
        media_proc.id = 202
        media_proc.config = {
            "icecast_config": {
                "bind_address": "127.0.0.1",
                "port": 8000
            }
        }
        cmd, ephem_path = self.pm._build_icecast_config_and_cmd(media_proc, "icecast", self.session)
        try:
            with open(ephem_path, "r") as f:
                xml_content = f.read()
            self.assertIn("<port>8000</port>", xml_content)
            self.assertIn("<bind-address>127.0.0.1</bind-address>", xml_content)
        finally:
            if os.path.exists(ephem_path):
                os.remove(ephem_path)

    def test_icecast_config_failsafe_fallback(self):
        media_proc = MagicMock()
        media_proc.id = 203
        media_proc.config = {
            "icecast_config": {
                "bind_address": "198.51.100.99", # Missing/dead IP
                "port": 8000
            }
        }
        cmd, ephem_path = self.pm._build_icecast_config_and_cmd(media_proc, "icecast", self.session)
        try:
            with open(ephem_path, "r") as f:
                xml_content = f.read()
            self.assertIn("<port>8000</port>", xml_content)
            self.assertNotIn("<bind-address>", xml_content)
        finally:
            if os.path.exists(ephem_path):
                os.remove(ephem_path)


if __name__ == "__main__":
    unittest.main()
