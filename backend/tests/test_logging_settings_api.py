import unittest
import os
import sys
import tempfile
import importlib
import shutil
import logging
import logging.handlers
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

class TestLoggingSettingsAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db_fd, cls.db_path = tempfile.mkstemp()
        cls.original_db_path_env = os.environ.get("DATABASE_PATH")
        os.environ["DATABASE_PATH"] = cls.db_path
        
        import database.db
        importlib.reload(database.db)
        cls.db_module = database.db
        
        import main
        importlib.reload(main)
        cls.main_module = main
        cls.client = TestClient(main.app)

    @classmethod
    def tearDownClass(cls):
        os.close(cls.db_fd)
        if os.path.exists(cls.db_path):
            os.unlink(cls.db_path)
        if cls.original_db_path_env is not None:
            os.environ["DATABASE_PATH"] = cls.original_db_path_env
        else:
            os.environ.pop("DATABASE_PATH", None)

    def setUp(self):
        self.db_module.init_db()
        self.db = self.db_module.SessionLocal()
        
        # Temp config file
        self.conf_fd, self.conf_path = tempfile.mkstemp(suffix=".conf")
        os.environ["CONFIG_FILE_PATH"] = self.conf_path

    def tearDown(self):
        self.db.close()
        self.db_module.Base.metadata.drop_all(bind=self.db_module.engine)
        os.close(self.conf_fd)
        if os.path.exists(self.conf_path):
            os.unlink(self.conf_path)
        os.environ.pop("CONFIG_FILE_PATH", None)

    def test_get_settings_defaults(self):
        # With empty config file, should return default logging configuration
        with open(self.conf_path, "w") as f:
            f.write("[server]\nport = 8000\n")

        temp_log = tempfile.mktemp()
        fh = logging.FileHandler(temp_log)
        fh.baseFilename = os.path.abspath("ffmpeg-gui.log")
        sh = logging.StreamHandler()

        try:
            with patch("main.logging.getLogger") as mock_get_logger:
                mock_logger = MagicMock()
                mock_logger.handlers = [fh, sh]
                mock_get_logger.return_value = mock_logger
                
                res = self.client.get("/settings")
                self.assertEqual(res.status_code, 200)
                data = res.json()
                
                self.assertEqual(data["logging_mode"], "both")
                self.assertIsNone(data["logging_storage_id"])
                self.assertEqual(data["logging_relative_path"], "ffmpeg-gui.log")
                self.assertFalse(data["logging_rotation_enabled"])
                self.assertEqual(data["logging_rotation_max_bytes"], 10485760)
                self.assertEqual(data["logging_rotation_backup_count"], 5)
                self.assertFalse(data["logging_compression_enabled"])
                self.assertEqual(data["logging_retention_days"], 30)
                self.assertFalse(data["restart_required"])
        finally:
            fh.close()
            if os.path.exists(temp_log):
                os.unlink(temp_log)

    def test_post_settings_logging_config(self):
        # Seed a storage of type logs
        from database.models import Storage
        storage_logs = Storage(name="Test Logs Storage", path="/tmp/logs-test", type="logs")
        storage_build = Storage(name="Test Build Storage", path="/tmp/builds-test", type="build")
        self.db.add(storage_logs)
        self.db.add(storage_build)
        self.db.commit()
        
        # Test successful update of logging settings
        payload = {
            "logging_mode": "file",
            "logging_storage_id": storage_logs.id,
            "logging_relative_path": "custom-ffmpeg.log",
            "logging_rotation_enabled": True,
            "logging_rotation_max_bytes": 5000000,
            "logging_rotation_backup_count": 10,
            "logging_compression_enabled": True,
            "logging_retention_days": 14
        }
        res = self.client.post("/settings", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        
        # Check that config file was updated correctly
        import configparser
        config = configparser.ConfigParser()
        config.read(self.conf_path)
        
        self.assertEqual(config["logging"]["mode"], "file")
        self.assertEqual(config["logging"]["storage_id"], str(storage_logs.id))
        self.assertEqual(config["logging"]["relative_path"], "custom-ffmpeg.log")
        self.assertEqual(config["logging"]["file_path"], os.path.abspath("/tmp/logs-test/custom-ffmpeg.log"))
        self.assertEqual(config["logging"]["rotation_enabled"], "true")
        self.assertEqual(config["logging"]["rotation_max_bytes"], "5000000")
        self.assertEqual(config["logging"]["rotation_backup_count"], "10")
        self.assertEqual(config["logging"]["compression_enabled"], "true")
        self.assertEqual(config["logging"]["retention_days"], "14")
        
        # Test validation error when using a storage of incorrect type
        payload_bad = {
            "logging_storage_id": storage_build.id
        }
        res_bad = self.client.post("/settings", json=payload_bad)
        self.assertEqual(res_bad.status_code, 400)
        self.assertIn("Invalid storage type", res_bad.json()["detail"])

    def test_restart_required_trigger(self):
        # Set up a config in the conf file
        with open(self.conf_path, "w") as f:
            f.write("[logging]\nmode = file\nrotation_enabled = true\n")

        temp_log = tempfile.mktemp()
        fh = logging.FileHandler(temp_log)
        fh.baseFilename = os.path.abspath("ffmpeg-gui.log")
        sh = logging.StreamHandler()

        try:
            with patch("main.logging.getLogger") as mock_get_logger:
                mock_logger = MagicMock()
                mock_logger.handlers = [fh, sh]
                mock_get_logger.return_value = mock_logger
                
                res = self.client.get("/settings")
                self.assertEqual(res.status_code, 200)
                data = res.json()
                
                # Since active is "both" (console + file) and config is "file", restart_required should be True
                self.assertTrue(data["restart_required"])
        finally:
            fh.close()
            if os.path.exists(temp_log):
                os.unlink(temp_log)
