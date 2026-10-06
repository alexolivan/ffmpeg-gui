import os
import unittest
from unittest.mock import patch, MagicMock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database.models import Base
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
    def test_audit_system_binary_pipewire_not_found(self, mock_which):
        mock_which.return_value = None
        res = self.sm.audit_system_binary("pipewire")
        self.assertFalse(res["found"])
        self.assertIsNone(res["path"])
        self.assertIsNone(res["version"])
