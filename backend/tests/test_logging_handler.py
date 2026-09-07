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
             patch("uvicorn.Config") as mock_cfg, \
             patch("uvicorn.Server") as mock_srv, \
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
                
            # Get the log_config passed to uvicorn.Config or uvicorn.run
            if mock_cfg.called:
                called_args, called_kwargs = mock_cfg.call_args
            else:
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
                "compression_enabled": "true",
                "access_log_enabled": "true"
            }
        }
        
        with patch("configparser.ConfigParser") as mock_parser, \
             patch("os.path.exists", return_value=True), \
             patch("uvicorn.Config") as mock_cfg, \
             patch("uvicorn.Server") as mock_srv, \
             patch("uvicorn.run") as mock_run:
             
            parser_inst = mock_parser.return_value
            parser_inst.read = MagicMock()
            parser_inst.__contains__ = MagicMock(side_effect=lambda k: k in mock_config)
            parser_inst.__getitem__ = MagicMock(side_effect=lambda k: MagicMock(
                get=MagicMock(side_effect=lambda key, default=None: mock_config[k].get(key, default)),
                getboolean=MagicMock(side_effect=lambda key, default=False: mock_config[k].get(key, "true" if default else "false") == "true"),
                getint=MagicMock(side_effect=lambda key, default=0: int(mock_config[k].get(key, default)))
            ))
            
            with patch("sys.argv", ["run_server.py", "--config", "dummy.conf"]):
                run_server.main()
                
            if mock_cfg.called:
                called_args, called_kwargs = mock_cfg.call_args
            else:
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
            
            # ACCESS_LOG_PATH must be separated to access.log, NOT equal to base log_file
            self.assertIn("ACCESS_LOG_PATH", os.environ)
            self.assertNotEqual(os.environ["ACCESS_LOG_PATH"], os.path.abspath(self.log_file))
            self.assertTrue(os.environ["ACCESS_LOG_PATH"].endswith("access.log"))
            self.assertEqual(os.environ.get("ACCESS_LOG_IGNORE_MEDIA"), "true")

    def test_access_log_middleware_noise_filtering(self):
        import asyncio
        from main import NginxAccessLogMiddleware
        
        access_log_file = os.path.join(self.temp_dir.name, "middleware_access.log")
        os.environ["ACCESS_LOG_PATH"] = access_log_file
        os.environ["ACCESS_LOG_IGNORE_MEDIA"] = "true"
        
        async def dummy_app(scope, receive, send):
            status = scope.get("_test_status", 200)
            await send({"type": "http.response.start", "status": status, "headers": [(b"content-length", b"10")]})
            await send({"type": "http.response.body", "body": b"test"})

        middleware = NginxAccessLogMiddleware(dummy_app)

        async def run_req(path, status=200):
            scope = {
                "type": "http",
                "method": "GET",
                "path": path,
                "query_string": b"",
                "headers": [],
                "client": ("127.0.0.1", 12345),
                "_test_status": status
            }
            await middleware(scope, lambda: None, lambda msg: asyncio.sleep(0))

        # 1. High frequency asset and media requests (200 OK) -> should be filtered out
        asyncio.run(run_req("/assets/index-abc.js", status=200))
        asyncio.run(run_req("/assets/style.css", status=200))
        asyncio.run(run_req("/favicon.svg", status=200))
        asyncio.run(run_req("/live/chunk123.ts", status=200))
        asyncio.run(run_req("/live/index.m3u8", status=200))
        asyncio.run(run_req("/previews/preview_1.jpg", status=200))
        asyncio.run(run_req("/api/settings/software/ffmpeg/icon", status=200))

        # File should either not exist or be completely empty
        if os.path.exists(access_log_file):
            with open(access_log_file, "r") as f:
                self.assertEqual(f.read().strip(), "", "High-frequency media/assets should be filtered from access.log")

        # 2. Standard API request (200 OK) -> should be logged
        asyncio.run(run_req("/api/processes", status=200))
        with open(access_log_file, "r") as f:
            content = f.read()
            self.assertIn("GET /api/processes HTTP/1.1", content)
            self.assertIn("200 10", content)

        # 3. Failed asset request (404 Not Found) -> must NOT be filtered out
        asyncio.run(run_req("/assets/missing.js", status=404))
        with open(access_log_file, "r") as f:
            content = f.read()
            self.assertIn("GET /assets/missing.js HTTP/1.1", content)
            self.assertIn("404", content)

