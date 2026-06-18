import unittest
from unittest.mock import patch, mock_open
import asyncio
from core.preview_manager import PreviewManager
from database.db import PREVIEWS_DIR
import os

class TestPreviewManagerPreviews(unittest.IsolatedAsyncioTestCase):
    async def test_get_mjpeg_stream_reads_from_previews_dir(self):
        pm = PreviewManager()
        expected_path = os.path.join(PREVIEWS_DIR, "preview_42.jpg")
        
        with patch("os.path.exists", return_value=True) as mock_exists, \
             patch("os.path.getmtime", return_value=123.45), \
             patch("builtins.open", mock_open(read_data=b"fakeimage")) as mock_file:
            
            gen = pm.get_mjpeg_stream(42, {}, is_running=True, is_task=False)
            item = await gen.__anext__()
            
            mock_exists.assert_called_with(expected_path)
            mock_file.assert_called_with(expected_path, 'rb')
            self.assertIn(b"fakeimage", item)
