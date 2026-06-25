import unittest
from unittest.mock import patch, MagicMock
import sys
import os
import asyncio

# Add backend directory to path
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from utils.process_utils import get_ffmpeg_version
from main import get_ndi_sources

class TestNDIScan(unittest.TestCase):
    @patch('subprocess.run')
    def test_ffmpeg_version_parsing(self, mock_run):
        # Test modern version
        mock_res = MagicMock()
        mock_res.stdout = "ffmpeg version 5.1-css Copyright (c) 2000-2022 the FFmpeg developers"
        mock_res.stderr = ""
        mock_run.return_value = mock_res
        
        version = get_ffmpeg_version("mock_ffmpeg")
        self.assertEqual(version, 5.1)

        # Test legacy version
        mock_res.stdout = "ffmpeg version 4.4 Copyright (c) 2000-2021 the FFmpeg developers"
        version = get_ffmpeg_version("mock_ffmpeg")
        self.assertEqual(version, 4.4)

        # Test error fallback
        mock_run.side_effect = Exception("failed to run")
        version = get_ffmpeg_version("mock_ffmpeg")
        self.assertEqual(version, 4.4)

    @patch('asyncio.create_subprocess_exec')
    def test_ndi_sources_route(self, mock_exec):
        # Create a mock process
        mock_proc = MagicMock()
        
        # Define mock communicate coroutine returning both formats and duplicates
        async def mock_communicate():
            return b"", (
                b"[libndi_newtek @ 0x560] Found NDI source: 'DESKTOP-1234 (Stream 1)'\n"
                b"[libndi_newtek] Found NDI source: 'LAPTOP-ABCD (OBS)'\n"
                b"[libndi_newtek @ 0x5629402] \t'TEST1 (LA-XARXA-TX3)'\t'192.168.99.11:5961'\n"
                b"[libndi_newtek @ 0x5629402] \t'TEST1 (LA-XARXA-TX3)'\t'192.168.99.11:5961'\n"
            )
            
        mock_proc.communicate = mock_communicate
        
        # Mock create_subprocess_exec return value
        async def mock_create(*args, **kwargs):
            return mock_proc
            
        mock_exec.side_effect = mock_create
        
        # Run async function using asyncio
        res = asyncio.run(get_ndi_sources())
        
        self.assertEqual(res["sources"], ["DESKTOP-1234 (Stream 1)", "LAPTOP-ABCD (OBS)", "TEST1 (LA-XARXA-TX3)"])

    @patch('database.db.SessionLocal')
    @patch('asyncio.create_subprocess_exec')
    @patch('os.path.exists')
    def test_ndi_sources_route_with_build_id(self, mock_exists, mock_exec, mock_session_local):
        # Mock database session and query
        mock_db = MagicMock()
        mock_session_local.return_value = mock_db
        
        mock_build = MagicMock()
        mock_build.ffmpeg_binary = "/mock/build/bin/ffmpeg"
        
        # Configure query mock chain
        mock_query = mock_db.query.return_value
        mock_filter = mock_query.filter.return_value
        mock_filter.first.return_value = mock_build
        
        # Mock os.path.exists to return True for the binary
        mock_exists.return_value = True
        
        # Create a mock process
        mock_proc = MagicMock()
        async def mock_communicate():
            return b"", b"[libndi_newtek] Found NDI source: 'TEST-BUILD-ID (Stream)'"
        mock_proc.communicate = mock_communicate
        
        async def mock_create(*args, **kwargs):
            # Assert that the first argument is indeed our custom binary path
            self.assertEqual(args[0], "/mock/build/bin/ffmpeg")
            return mock_proc
            
        mock_exec.side_effect = mock_create
        
        # Run async function with build_id parameter
        res = asyncio.run(get_ndi_sources(build_id=42))
        
        self.assertEqual(res["sources"], ["TEST-BUILD-ID (Stream)"])
        mock_db.query.assert_called_once()
        mock_db.close.assert_called_once()


if __name__ == '__main__':
    unittest.main()
