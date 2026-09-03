import unittest
import os
import shutil
import tempfile
import xml.etree.ElementTree as ET
from unittest.mock import MagicMock, patch
from database.models import Service
from core.process_manager import ProcessManager
from core.builders.ffmpeg_builder import FFmpegCommandBuilder

class TestIcecastService(unittest.TestCase):

    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.db_factory = MagicMock()
        self.pm = ProcessManager(self.db_factory)

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_build_icecast_config_xml_structure(self):
        session = MagicMock()
        media_proc = Service(
            id=1,
            name="Main Icecast Server",
            service_type="icecast_server",
            config={
                "icecast_config": {
                    "port": 7000,
                    "http_enabled": True,
                    "ssl_enabled": False,
                    "source_password": "sourcessh",
                    "admin_user": "radmin",
                    "admin_password": "radminpass",
                    "relay_password": "relaypass",
                    "hostname": "radio.local",
                    "location": "Madrid Studio",
                    "admin_email": "ops@radio.local",
                    "clients_limit": 250,
                    "sources_limit": 15,
                    "burst_size": 131072,
                    "mounts": [
                        {
                            "mount_name": "/fm_main.mp3",
                            "max_listeners": 100,
                            "fallback_mount": "/backup.mp3",
                            "fallback_override": True,
                            "burst_size": 65536,
                            "source_password": "custompass"
                        },
                        {
                            "mount_name": "backup.mp3",
                            "max_listeners": 50
                        }
                    ]
                }
            }
        )

        cmd, xml_path = self.pm._build_icecast_config_and_cmd(media_proc, "/usr/bin/icecast2", session)
        self.assertTrue(os.path.exists(xml_path))
        self.assertEqual(cmd, ["/usr/bin/icecast2", "-c", xml_path])

        with open(xml_path, "r") as f:
            xml_str = f.read()

        # Parse XML to guarantee strict well-formedness
        root = ET.fromstring(xml_str)
        self.assertEqual(root.tag, "icecast")
        self.assertEqual(root.findtext("location"), "Madrid Studio")
        self.assertEqual(root.findtext("hostname"), "radio.local")
        self.assertEqual(root.findtext("admin"), "ops@radio.local")

        # Limits
        limits = root.find("limits")
        self.assertEqual(limits.findtext("clients"), "250")
        self.assertEqual(limits.findtext("sources"), "15")
        self.assertEqual(limits.findtext("burst-size"), "131072")

        # Authentication
        auth = root.find("authentication")
        self.assertEqual(auth.findtext("source-password"), "sourcessh")
        self.assertEqual(auth.findtext("admin-user"), "radmin")
        self.assertEqual(auth.findtext("admin-password"), "radminpass")

        # Listen sockets: 1 socket for port 7000
        sockets = root.findall("listen-socket")
        self.assertEqual(len(sockets), 1)
        self.assertEqual(sockets[0].findtext("port"), "7000")
        self.assertIsNone(sockets[0].find("ssl"))

        # Mounts
        mounts = root.findall("mount")
        self.assertEqual(len(mounts), 2)
        self.assertEqual(mounts[0].findtext("mount-name"), "/fm_main.mp3")
        self.assertEqual(mounts[0].findtext("max-listeners"), "100")
        self.assertEqual(mounts[0].findtext("fallback-mount"), "/backup.mp3")
        self.assertEqual(mounts[0].findtext("fallback-override"), "1")
        self.assertEqual(mounts[0].findtext("burst-size"), "65536")
        self.assertEqual(mounts[0].findtext("password"), "custompass")

        # Auto-prefixed leading slash on second mount
        self.assertEqual(mounts[1].findtext("mount-name"), "/backup.mp3")
        self.assertEqual(mounts[1].findtext("max-listeners"), "50")

        # Clean up
        if os.path.exists(xml_path):
            os.remove(xml_path)

    def test_build_icecast_config_dual_ssl_sockets(self):
        session = MagicMock()
        cert_file = os.path.join(self.test_dir, "test_cert.pem")
        key_file = os.path.join(self.test_dir, "test_key.pem")
        with open(cert_file, "w") as f: f.write("-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n")
        with open(key_file, "w") as f: f.write("-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n")

        media_proc = Service(
            id=2,
            name="SSL Icecast",
            service_type="icecast_server",
            config={
                "icecast_config": {
                    "port": 7000,
                    "http_enabled": True,
                    "ssl_enabled": True,
                    "ssl_port": 7443,
                    "server_cert": cert_file,
                    "server_key": key_file,
                }
            }
        )

        cmd, xml_path = self.pm._build_icecast_config_and_cmd(media_proc, "icecast", session)
        with open(xml_path, "r") as f:
            xml_str = f.read()

        root = ET.fromstring(xml_str)
        sockets = root.findall("listen-socket")
        self.assertEqual(len(sockets), 2)
        # Socket 1: Plain HTTP port 7000
        self.assertEqual(sockets[0].findtext("port"), "7000")
        self.assertIsNone(sockets[0].find("ssl"))
        # Socket 2: Secure HTTPS port 7443
        self.assertEqual(sockets[1].findtext("port"), "7443")
        self.assertEqual(sockets[1].findtext("ssl"), "1")

        # Bundle PEM check
        bundle_path = root.find("paths").findtext("ssl-certificate")
        self.assertTrue(os.path.exists(bundle_path))
        with open(bundle_path, "r") as fb:
            bundle_content = fb.read()
            self.assertIn("BEGIN CERTIFICATE", bundle_content)
            self.assertIn("BEGIN PRIVATE KEY", bundle_content)

        # Clean up
        if os.path.exists(xml_path): os.remove(xml_path)
        if os.path.exists(bundle_path): os.remove(bundle_path)

    def test_ffmpeg_builder_icecast_codec_and_metadata_mapping(self):
        # Test MP3
        cmd_mp3 = []
        FFmpegCommandBuilder._append_output(
            cmd=cmd_mp3,
            output_cfg={
                "type": "icecast",
                "host": "127.0.0.1",
                "port": 7000,
                "icecast_mount": "/radio.mp3",
                "icecast_password": "secret",
                "ice_name": "Rock Station",
                "ice_genre": "Classic Rock",
                "ice_public": True,
            },
            codec_cfg={"acodec": "libmp3lame"},
        )
        self.assertIn("-f", cmd_mp3)
        self.assertIn("mp3", cmd_mp3)
        self.assertIn("-content_type", cmd_mp3)
        self.assertIn("audio/mpeg", cmd_mp3)
        self.assertIn("-ice_name", cmd_mp3)
        self.assertIn("Rock Station", cmd_mp3)
        self.assertIn("-ice_genre", cmd_mp3)
        self.assertIn("Classic Rock", cmd_mp3)
        self.assertIn("-ice_public", cmd_mp3)
        self.assertIn("1", cmd_mp3)
        self.assertIn("icecast://source:secret@127.0.0.1:7000/radio.mp3", cmd_mp3)

        # Test AAC
        cmd_aac = []
        FFmpegCommandBuilder._append_output(
            cmd=cmd_aac,
            output_cfg={
                "type": "icecast",
                "host": "127.0.0.1",
                "port": 7000,
                "icecast_mount": "aac_stream",
                "icecast_password": "secret",
            },
            codec_cfg={"acodec": "aac"},
        )
        self.assertIn("-f", cmd_aac)
        self.assertIn("adts", cmd_aac)
        self.assertIn("-content_type", cmd_aac)
        self.assertIn("audio/aac", cmd_aac)
        self.assertIn("icecast://source:secret@127.0.0.1:7000/aac_stream", cmd_aac)

        # Test Opus
        cmd_opus = []
        FFmpegCommandBuilder._append_output(
            cmd=cmd_opus,
            output_cfg={
                "type": "icecast",
                "host": "127.0.0.1",
                "port": 7000,
                "icecast_mount": "/opus.ogg",
                "icecast_password": "secret",
            },
            codec_cfg={"acodec": "libopus"},
        )
        self.assertIn("-f", cmd_opus)
        self.assertIn("ogg", cmd_opus)
        self.assertIn("-content_type", cmd_opus)
        self.assertIn("audio/ogg", cmd_opus)

        # Test FLAC
        cmd_flac = []
        FFmpegCommandBuilder._append_output(
            cmd=cmd_flac,
            output_cfg={
                "type": "icecast",
                "host": "127.0.0.1",
                "port": 7000,
                "icecast_mount": "/lossless.flac",
                "icecast_password": "secret",
            },
            codec_cfg={"acodec": "flac"},
        )
        self.assertIn("-f", cmd_flac)
        self.assertIn("flac", cmd_flac)
        self.assertIn("-content_type", cmd_flac)
        self.assertIn("audio/flac", cmd_flac)

if __name__ == "__main__":
    unittest.main()
