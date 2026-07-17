import os
import gzip
import logging
import tempfile
import unittest
from run_server import GzippedRotatingFileHandler

class TestLoggingHandler(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.log_file = os.path.join(self.temp_dir.name, "test_app.log")

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_gzipped_rotation(self):
        # Instantiate the custom handler with small maxBytes to force rollover
        handler = GzippedRotatingFileHandler(self.log_file, maxBytes=10, backupCount=2)
        handler.setFormatter(logging.Formatter("%(message)s"))
        
        logger = logging.getLogger("test_gzipped_rotation_logger")
        logger.setLevel(logging.INFO)
        logger.addHandler(handler)
        
        try:
            # Write first log
            logger.info("123")
            handler.flush()
            
            # File should exist and contain "123"
            self.assertTrue(os.path.exists(self.log_file))
            with open(self.log_file, "r") as f:
                self.assertEqual(f.read().strip(), "123")
                
            # Write second log to trigger rollover
            logger.info("4567890")
            handler.flush()
            
            # Original log file should be rolled over to .1.gz
            gz_file = f"{self.log_file}.1.gz"
            self.assertTrue(os.path.exists(gz_file), "Gzipped backup file should exist")
            self.assertFalse(os.path.exists(f"{self.log_file}.1"), "Uncompressed rotated file should be deleted")
            
            # Verify contents of .gz file
            with gzip.open(gz_file, "rt") as f:
                self.assertEqual(f.read().strip(), "123")
                
            # Verify current active log file
            with open(self.log_file, "r") as f:
                self.assertEqual(f.read().strip(), "4567890")
                
            # Trigger second rollover
            logger.info("abcdefgh")
            handler.flush()
            
            gz_file_1 = f"{self.log_file}.1.gz"
            gz_file_2 = f"{self.log_file}.2.gz"
            
            self.assertTrue(os.path.exists(gz_file_1))
            self.assertTrue(os.path.exists(gz_file_2))
            self.assertFalse(os.path.exists(f"{self.log_file}.2"))
            
            with gzip.open(gz_file_2, "rt") as f:
                self.assertEqual(f.read().strip(), "123")
            with gzip.open(gz_file_1, "rt") as f:
                self.assertEqual(f.read().strip(), "4567890")
        finally:
            logger.removeHandler(handler)
            handler.close()

    def test_log_configuration_journalctl(self):
        import run_server
        from unittest.mock import patch, MagicMock
        
        # Test mode journalctl
        mock_config = {
            "logging": {
                "mode": "journalctl",
                "file_path": self.log_file,
                "rotation_enabled": "false",
            }
        }
        
        with patch("configparser.ConfigParser") as mock_parser, \
             patch("os.path.exists", return_value=True), \
             patch("uvicorn.run") as mock_run:
             
            # Setup ConfigParser mock
            parser_inst = mock_parser.return_value
            parser_inst.read = MagicMock()
            parser_inst.__contains__ = MagicMock(side_effect=lambda k: k in mock_config)
            parser_inst.__getitem__ = MagicMock(side_effect=lambda k: MagicMock(
                get=MagicMock(side_effect=lambda key, default=None: mock_config[k].get(key, default)),
                getboolean=MagicMock(side_effect=lambda key, default=False: mock_config[k].get(key, default) == "true"),
                getint=MagicMock(side_effect=lambda key, default=0: int(mock_config[k].get(key, default)))
            ))
            
            # Run main
            with patch("sys.argv", ["run_server.py", "--config", "dummy.conf"]):
                run_server.main()
                
            # Get the log_config passed to uvicorn.run
            called_args, called_kwargs = mock_run.call_args
            log_config = called_kwargs["log_config"]
            
            # In journalctl mode, root and FFMPEG-GUI should use default (console) only
            self.assertIn("default", log_config["root"]["handlers"])
            self.assertNotIn("file", log_config["root"]["handlers"])
            self.assertIn("default", log_config["loggers"]["FFMPEG-GUI"]["handlers"])
            self.assertNotIn("file", log_config["loggers"]["FFMPEG-GUI"]["handlers"])

    def test_log_configuration_file_only(self):
        import run_server
        from unittest.mock import patch, MagicMock
        
        # Test mode file only
        mock_config = {
            "logging": {
                "mode": "file",
                "file_path": self.log_file,
                "rotation_enabled": "true",
                "rotation_max_bytes": "2000",
                "rotation_backup_count": "3",
                "compression_enabled": "true"
            }
        }
        
        with patch("configparser.ConfigParser") as mock_parser, \
             patch("os.path.exists", return_value=True), \
             patch("uvicorn.run") as mock_run:
             
            parser_inst = mock_parser.return_value
            parser_inst.read = MagicMock()
            parser_inst.__contains__ = MagicMock(side_effect=lambda k: k in mock_config)
            parser_inst.__getitem__ = MagicMock(side_effect=lambda k: MagicMock(
                get=MagicMock(side_effect=lambda key, default=None: mock_config[k].get(key, default)),
                getboolean=MagicMock(side_effect=lambda key, default=False: mock_config[k].get(key, default) == "true"),
                getint=MagicMock(side_effect=lambda key, default=0: int(mock_config[k].get(key, default)))
            ))
            
            with patch("sys.argv", ["run_server.py", "--config", "dummy.conf"]):
                run_server.main()
                
            called_args, called_kwargs = mock_run.call_args
            log_config = called_kwargs["log_config"]
            
            # In file mode, root and FFMPEG-GUI should use file handler only
            self.assertEqual(log_config["root"]["handlers"], ["file"])
            self.assertEqual(log_config["loggers"]["FFMPEG-GUI"]["handlers"], ["file"])
            self.assertEqual(log_config["loggers"]["uvicorn"]["handlers"], ["file"])
            
            # File handler should be configured as GzippedRotatingFileHandler
            self.assertEqual(log_config["handlers"]["file"]["()"], run_server.GzippedRotatingFileHandler)
            self.assertEqual(log_config["handlers"]["file"]["maxBytes"], 2000)
            self.assertEqual(log_config["handlers"]["file"]["backupCount"], 3)
