import unittest
import os
import shutil
import tempfile
import json
import asyncio
from unittest.mock import patch, MagicMock, AsyncMock
from backend.core.decklink_manager import DecklinkManager


class TestDecklinkManager(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.mgr = DecklinkManager()

    @patch("subprocess.run")
    def test_get_desktopvideo_version(self, mock_subproc):
        mock_subproc.return_value = MagicMock(returncode=0, stdout="14.2.1-1\n")
        ver = self.mgr.get_desktopvideo_version()
        self.assertEqual(ver, "14.2.1-1")

    @patch("shutil.which", return_value="/usr/bin/BlackmagicFirmwareUpdater")
    @patch("os.path.exists", return_value=True)
    @patch("subprocess.run")
    def test_get_firmware_status_ok(self, mock_subproc, mock_exists, mock_which):
        mock_subproc.return_value = MagicMock(
            returncode=0,
            stdout="[0] DeckLink Duo 2: Firmware is up to date\n[1] DeckLink Duo 2: Firmware is up to date\n",
            stderr="",
        )
        status = self.mgr.get_firmware_status()
        self.assertTrue(status["available"])
        self.assertFalse(status["needs_update"])
        self.assertEqual(len(status["devices"]), 2)

    @patch("shutil.which", return_value="/usr/bin/BlackmagicFirmwareUpdater")
    @patch("os.path.exists", return_value=True)
    @patch("subprocess.run")
    def test_get_firmware_status_needs_update(self, mock_subproc, mock_exists, mock_which):
        mock_subproc.return_value = MagicMock(
            returncode=0,
            stdout="[0] DeckLink Duo 2: Firmware update required\n",
            stderr="",
        )
        status = self.mgr.get_firmware_status()
        self.assertTrue(status["available"])
        self.assertTrue(status["needs_update"])

    @patch.object(DecklinkManager, "get_active_helper_path", return_value="/fake/decklink-ctl")
    async def test_get_devices_mocked(self, mock_path):
        fake_json = {
            "success": True,
            "devices": [
                {
                    "index": 0,
                    "display_name": "DeckLink Duo 2 (1)",
                    "model_name": "DeckLink Duo 2",
                    "persistent_id": 1234567,
                    "topological_id": 1001,
                    "sub_device_index": 0,
                    "num_sub_devices": 4,
                    "duplex_mode": "half",
                    "supports_full_duplex": True,
                    "signal_locked": True,
                    "detected_mode": "1080p50",
                    "detected_pixel_format": "8-bit YUV"
                }
            ]
        }
        
        async def fake_proc(*args, **kwargs):
            mock_p = AsyncMock()
            mock_p.communicate.return_value = (json.dumps(fake_json).encode("utf-8"), b"")
            mock_p.returncode = 0
            return mock_p

        with patch("asyncio.create_subprocess_exec", side_effect=fake_proc):
            devices = await self.mgr.get_devices()
            self.assertEqual(len(devices), 1)
            self.assertEqual(devices[0]["model_name"], "DeckLink Duo 2")
            self.assertTrue(devices[0]["signal_locked"])

    @patch.object(DecklinkManager, "get_active_helper_path", return_value="/fake/decklink-ctl")
    async def test_configure_device_conflict_detection(self, mock_path):
        mock_proc_manager = MagicMock()
        mock_active_proc = MagicMock()
        mock_active_proc.config = {"input_url": "decklink:DeckLink Duo 2 (1)"}
        mock_active_proc.name = "My SDI Stream"
        mock_proc_manager.get_active_processes.return_value = [mock_active_proc]

        res = await self.mgr.configure_device(
            "DeckLink Duo 2 (1)",
            {"duplex": "full"},
            process_manager=mock_proc_manager
        )
        self.assertFalse(res["success"])
        self.assertTrue(res.get("conflict"))
        self.assertIn("My SDI Stream", res["error"])


if __name__ == "__main__":
    unittest.main()
