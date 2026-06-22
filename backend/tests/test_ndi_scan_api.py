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
        
        # Define mock communicate coroutine
        async def mock_communicate():
            return b"", b"[libndi_newtek @ 0x560] Found NDI source: 'DESKTOP-1234 (Stream 1)'\n[libndi_newtek] Found NDI source: 'LAPTOP-ABCD (OBS)'"
            
        mock_proc.communicate = mock_communicate
        
        # Mock create_subprocess_exec return value
        async def mock_create(*args, **kwargs):
            return mock_proc
            
        mock_exec.side_effect = mock_create
        
        # Run async function using asyncio
        res = asyncio.run(get_ndi_sources())
        
        self.assertEqual(res["sources"], ["DESKTOP-1234 (Stream 1)", "LAPTOP-ABCD (OBS)"])


if __name__ == '__main__':
    unittest.main()
