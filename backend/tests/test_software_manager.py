import os
import tempfile
import unittest
from unittest.mock import patch, MagicMock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database.models import Base, SoftwareBuild, Service, Storage
from core.software_manager import SoftwareManager, software_manager


class TestSoftwareManager(unittest.TestCase):

    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()
        self.temp_dir = tempfile.mkdtemp()
        software_manager._init_state()

    def tearDown(self):
        self.db.close()
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_load_and_get_config(self):
        cfg = {
            "ffmpeg_forge_enabled": "true",
            "mediamtx_enabled": "false",
            "icecast2_enabled": "1"
        }
        software_manager.load_config(cfg)
        curr = software_manager.get_config()
        self.assertTrue(curr["ffmpeg_forge_enabled"])
        self.assertFalse(curr["mediamtx_enabled"])
        self.assertTrue(curr["icecast2_enabled"])

    @patch("shutil.which")
    @patch("subprocess.run")
    def test_audit_system_binary(self, mock_run, mock_which):
        mock_which.return_value = "/usr/bin/ffmpeg"
        mock_proc = MagicMock()
        mock_proc.stdout = "ffmpeg version 7.1-1 Copyright (c) 2000-2024\n"
        mock_proc.stderr = ""
        mock_run.return_value = mock_proc

        res = software_manager.audit_system_binary("ffmpeg")
        self.assertTrue(res["found"])
        self.assertEqual(res["path"], "/usr/bin/ffmpeg")
        self.assertEqual(res["version"], "7.1-1")

    def test_validate_safety_invariants(self):
        # Disabling all sources for FFmpeg should raise ValueError
        bad_config = {
            "ffmpeg_enabled": True,
            "ffmpeg_forge_enabled": False,
            "ffmpeg_installed_enabled": False
        }
        with self.assertRaises(ValueError):
            software_manager.validate_safety_invariants("ffmpeg", bad_config)

        # Keeping at least one should pass
        good_config = {
            "ffmpeg_enabled": True,
            "ffmpeg_forge_enabled": True,
            "ffmpeg_installed_enabled": False
        }
        software_manager.validate_safety_invariants("ffmpeg", good_config)

    @patch.object(software_manager, "audit_system_binary")
    def test_toggle_installed_binary(self, mock_audit):
        mock_audit.return_value = {"found": True, "path": "/usr/bin/ffmpeg", "version": "7.1"}

        # Register installed binary
        res = software_manager.toggle_installed_binary("ffmpeg", True, "Debian FFmpeg", self.db)
        self.assertTrue(res["success"])
        self.assertEqual(res["action"], "registered")

        build = self.db.query(SoftwareBuild).filter(SoftwareBuild.software_type == "ffmpeg").first()
        self.assertIsNotNone(build)
        self.assertEqual(build.source_type, "installed")
        self.assertFalse(build.is_managed)
        self.assertEqual(build.name, "Debian FFmpeg")

        # Unregister installed binary (with 0 active services)
        res_unreg = software_manager.toggle_installed_binary("ffmpeg", False, None, self.db)
        self.assertTrue(res_unreg["success"])
        self.assertEqual(res_unreg["action"], "unregistered")
        self.assertEqual(self.db.query(SoftwareBuild).count(), 0)

    @patch("urllib.request.urlretrieve")
    @patch("tarfile.open")
    @patch("subprocess.run")
    def test_provision_mediamtx_release(self, mock_run, mock_tar_open, mock_urlretrieve):
        mock_proc = MagicMock()
        mock_proc.stdout = "MediaMTX v1.9.3\n"
        mock_proc.stderr = ""
        mock_run.return_value = mock_proc

        # Mock tarfile extraction creating binary
        def fake_extract(path):
            bin_file = os.path.join(path, "mediamtx")
            with open(bin_file, "w") as f:
                f.write("#!/bin/sh\necho MediaMTX v1.9.3\n")

        mock_tar = MagicMock()
        mock_tar.extractall = fake_extract
        mock_tar_open.return_value.__enter__.return_value = mock_tar

        res = software_manager.provision_mediamtx_release("1.9.3", self.db, self.temp_dir)
        self.assertTrue(res["success"])
        self.assertEqual(res["version"], "1.9.3")

        build = self.db.query(SoftwareBuild).filter(SoftwareBuild.software_type == "mediamtx").first()
        self.assertIsNotNone(build)
        self.assertEqual(build.source_type, "precompiled")
        self.assertTrue(build.is_managed)
        self.assertEqual(build.name, "MediaMTX v1.9.3 (Official)")

    @patch("os.path.isfile", return_value=True)
    @patch("shutil.which")
    @patch("subprocess.run")
    def test_audit_browser_binaries(self, mock_run, mock_which, mock_isfile):
        # Test Chromium audit
        mock_which.side_effect = lambda cmd: "/usr/bin/chromium" if cmd == "chromium" else None
        mock_proc = MagicMock()
        mock_proc.stdout = "Chromium 130.0.6723.69 built on Debian 12\n"
        mock_proc.stderr = ""
        mock_run.return_value = mock_proc

        res_chrome = software_manager.audit_system_binary("chromium")
        self.assertTrue(res_chrome["found"])
        self.assertEqual(res_chrome["path"], "/usr/bin/chromium")
        self.assertEqual(res_chrome["version"], "130.0.6723.69")

        # Test Firefox audit
        mock_which.side_effect = lambda cmd: "/usr/bin/firefox-esr" if cmd == "firefox-esr" else None
        mock_proc.stdout = "Mozilla Firefox 128.3.0esr\n"
        res_ff = software_manager.audit_system_binary("firefox")
        self.assertTrue(res_ff["found"])
        self.assertEqual(res_ff["path"], "/usr/bin/firefox-esr")
        self.assertEqual(res_ff["version"], "128.3.0esr")

    @patch("urllib.request.urlretrieve")
    @patch("zipfile.ZipFile")
    @patch("subprocess.run")
    def test_provision_chromium_release(self, mock_run, mock_zipfile, mock_urlretrieve):
        mock_proc = MagicMock()
        mock_proc.stdout = "Google Chrome for Testing 130.0.6723.69\n"
        mock_proc.stderr = ""
        mock_run.return_value = mock_proc

        def fake_extractall(path):
            nested_dir = os.path.join(path, "chrome-linux64")
            os.makedirs(nested_dir, exist_ok=True)
            bin_file = os.path.join(nested_dir, "chrome")
            with open(bin_file, "w") as f:
                f.write("#!/bin/sh\necho Google Chrome for Testing 130.0.6723.69\n")

        mock_zip = MagicMock()
        mock_zip.extractall = fake_extractall
        mock_zipfile.return_value.__enter__.return_value = mock_zip

        res = software_manager.provision_engine_release("chromium", "130.0.6723.69", self.db, self.temp_dir)
        self.assertTrue(res["success"])
        self.assertEqual(res["version"], "130.0.6723.69")

        build = self.db.query(SoftwareBuild).filter(SoftwareBuild.software_type == "chromium").first()
        self.assertIsNotNone(build)
        self.assertEqual(build.source_type, "precompiled")
        self.assertTrue(build.is_managed)
        self.assertEqual(build.name, "Chromium v130.0.6723.69 (Official)")

    @patch("urllib.request.urlretrieve")
    @patch("tarfile.open")
    @patch("subprocess.run")
    def test_provision_firefox_release(self, mock_run, mock_tar_open, mock_urlretrieve):
        mock_proc = MagicMock()
        mock_proc.stdout = "Mozilla Firefox 130.0\n"
        mock_proc.stderr = ""
        mock_run.return_value = mock_proc

        def fake_extractall(path):
            nested_dir = os.path.join(path, "firefox")
            os.makedirs(nested_dir, exist_ok=True)
            bin_file = os.path.join(nested_dir, "firefox")
            with open(bin_file, "w") as f:
                f.write("#!/bin/sh\necho Mozilla Firefox 130.0\n")

        mock_tar = MagicMock()
        mock_tar.extractall = fake_extractall
        mock_tar_open.return_value.__enter__.return_value = mock_tar

        res = software_manager.provision_engine_release("firefox", "130.0", self.db, self.temp_dir)
        self.assertTrue(res["success"])
        self.assertEqual(res["version"], "130.0")

        build = self.db.query(SoftwareBuild).filter(SoftwareBuild.software_type == "firefox").first()
        self.assertIsNotNone(build)
        self.assertEqual(build.source_type, "precompiled")
        self.assertTrue(build.is_managed)
        self.assertEqual(build.name, "Firefox v130.0 (Official)")


if __name__ == "__main__":
    unittest.main()

