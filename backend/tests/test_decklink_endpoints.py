import os
import sys
import unittest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from main import app

class TestDecklinkEndpoints(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    @patch("asyncio.create_subprocess_exec")
    def test_get_decklink_devices(self, mock_exec):
        mock_proc_sources = AsyncMock()
        mock_proc_sources.communicate.return_value = (
            b"Auto-detected sources for decklink:\n  [DeckLink Mini Recorder 4K]\n",
            b""
        )
        
        mock_proc_sinks = AsyncMock()
        mock_proc_sinks.communicate.return_value = (
            b"Auto-detected sinks for decklink:\n  [DeckLink Mini Monitor 4K]\n",
            b""
        )
        
        mock_exec.side_effect = [mock_proc_sources, mock_proc_sinks]
        
        response = self.client.get("/decklink/devices")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("inputs", data)
        self.assertIn("outputs", data)
        self.assertEqual(data["inputs"], ["DeckLink Mini Recorder 4K"])
        self.assertEqual(data["outputs"], ["DeckLink Mini Monitor 4K"])

    @patch("asyncio.create_subprocess_exec")
    def test_get_decklink_formats(self, mock_exec):
        mock_proc = AsyncMock()
        mock_proc.communicate.return_value = (
            b"",
            b"[decklink @ 0x55aaee] format_code   description\n[decklink @ 0x55aaee] hp50          1080p50\n"
        )
        mock_exec.return_value = mock_proc
        
        response = self.client.get("/decklink/formats?device=DeckLink%20Mini%20Recorder%204K")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["code"], "hp50")
        self.assertEqual(data[0]["description"], "1080p50")

    @patch("asyncio.create_subprocess_exec")
    def test_get_decklink_devices_modern_format(self, mock_exec):
        mock_proc_sources = AsyncMock()
        mock_proc_sources.communicate.return_value = (
            b"Auto-detected sources for decklink:\n  30:00000000:001e0300 [Intensity Pro] (none)\n",
            b""
        )
        
        mock_proc_sinks = AsyncMock()
        mock_proc_sinks.communicate.return_value = (
            b"Auto-detected sinks for decklink:\n  30:00000000:001e0300 [Intensity Pro] (none)\n",
            b""
        )
        
        mock_exec.side_effect = [mock_proc_sources, mock_proc_sinks]
        
        response = self.client.get("/decklink/devices")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["inputs"], ["Intensity Pro"])
        self.assertEqual(data["outputs"], ["Intensity Pro"])

    @patch("asyncio.create_subprocess_exec")
    def test_get_decklink_formats_modern_format(self, mock_exec):
        mock_proc = AsyncMock()
        mock_proc.communicate.return_value = (
            b"",
            b"[in#0 @ 0x55ec4b562b80] Supported formats for 'Intensity Pro':\n"
            b"\tformat_code\tdescription\n"
            b"\tntsc\t\t720x486 at 30000/1001 fps (interlaced, lower field first)\n"
            b"\tpal \t\t720x576 at 25000/1000 fps (interlaced, upper field first)\n"
            b"Error opening input file Intensity Pro.\n"
        )
        mock_exec.return_value = mock_proc
        
        response = self.client.get("/decklink/formats?device=Intensity%20Pro")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data), 2)
        self.assertEqual(data[0]["code"], "ntsc")
        self.assertEqual(data[1]["code"], "pal")

if __name__ == "__main__":
    unittest.main()
