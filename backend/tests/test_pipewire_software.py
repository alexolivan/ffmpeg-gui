import os
import unittest
from unittest.mock import patch, MagicMock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database.models import Base, SoftwareBuild
from core.software_manager import SoftwareManager, SUPPORTED_ENGINES

class TestPipewireSoftware(unittest.TestCase):

    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()
        self.sm = SoftwareManager()
        self.sm._init_state()

    def tearDown(self):
        self.db.close()

    def test_pipewire_engine_metadata_registered(self):
        self.assertIn("pipewire", SUPPORTED_ENGINES)
        meta = SUPPORTED_ENGINES["pipewire"]
        self.assertEqual(meta["name"], "PipeWire Audio Server")
        self.assertTrue(meta["supports_forge"])
        self.assertTrue(meta["supports_installed"])
        self.assertFalse(meta["supports_precompiled"])
        self.assertFalse(meta["always_enabled"])
        self.assertEqual(meta["default_binary"], "pipewire")

    def test_pipewire_initial_config_state(self):
        cfg = self.sm.get_config()
        self.assertTrue(cfg.get("pipewire_enabled"))
        self.assertTrue(cfg.get("pipewire_installed_enabled"))
        self.assertTrue(cfg.get("pipewire_forge_enabled"))

    @patch("shutil.which")
    @patch("subprocess.run")
    def test_audit_system_binary_pipewire_version_extraction(self, mock_run, mock_which):
        mock_which.return_value = "/usr/bin/pipewire"
        mock_proc = MagicMock()
        mock_proc.stdout = "pipewire\nCompiled with libpipewire 1.4.2\nLinked with libpipewire 1.4.2\n"
        mock_proc.stderr = ""
        mock_run.return_value = mock_proc

        res = self.sm.audit_system_binary("pipewire")
        self.assertTrue(res["found"])
        self.assertEqual(res["path"], "/usr/bin/pipewire")
        self.assertEqual(res["version"], "1.4.2")

    @patch("shutil.which")
    @patch("subprocess.run")
    def test_audit_system_binary_pipewire_fallback_version(self, mock_run, mock_which):
        mock_which.return_value = "/usr/bin/pipewire"
        mock_proc = MagicMock()
        mock_run.return_value = mock_proc

        # Semver regex fallback
        mock_proc.stdout = "pipewire custom-git 1.9.0\n"
        mock_proc.stderr = ""
        res = self.sm.audit_system_binary("pipewire")
        self.assertTrue(res["found"])
        self.assertEqual(res["version"], "1.9.0")

        # First line fallback when no semver matched
        mock_proc.stdout = "pipewire-custom\n"
        mock_proc.stderr = ""
        res2 = self.sm.audit_system_binary("pipewire")
        self.assertTrue(res2["found"])
        self.assertEqual(res2["version"], "pipewire-custom")

    @patch("shutil.which")
    def test_audit_system_binary_pipewire_not_found(self, mock_which):
        mock_which.return_value = None
        res = self.sm.audit_system_binary("pipewire")
        self.assertFalse(res["found"])
        self.assertIsNone(res["path"])
        self.assertIsNone(res["version"])

    @patch.object(SoftwareManager, "audit_system_binary")
    def test_toggle_installed_binary_pipewire(self, mock_audit):
        mock_audit.return_value = {
            "found": True,
            "path": "/usr/bin/pipewire",
            "version": "1.4.2"
        }

        # Test registration
        res = self.sm.toggle_installed_binary("pipewire", True, "System PipeWire", self.db)
        self.assertTrue(res["success"])
        self.assertEqual(res["action"], "registered")
        self.assertEqual(res["software_type"], "pipewire")

        build = self.db.query(SoftwareBuild).filter_by(software_type="pipewire").first()
        self.assertIsNotNone(build)
        self.assertEqual(build.name, "System PipeWire")
        self.assertEqual(build.version_tag, "1.4.2")
        self.assertEqual(build.binary_path, "/usr/bin/pipewire")
        self.assertFalse(build.is_managed)

        # Test unregistration
        res_del = self.sm.toggle_installed_binary("pipewire", False, None, self.db)
        self.assertTrue(res_del["success"])
        self.assertEqual(res_del["action"], "unregistered")

        deleted_build = self.db.query(SoftwareBuild).filter_by(software_type="pipewire").first()
        self.assertIsNone(deleted_build)
