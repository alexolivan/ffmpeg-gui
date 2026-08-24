import unittest
from unittest.mock import patch, MagicMock, AsyncMock
from backend.core.magewell_manager import MagewellManager


SAMPLE_MWCAP_INFO_L = """total: 2
device path     firmware ver    hardware ver    driver ver      alsa name       device name                   
/dev/video0     1.34            B               1.3.4429        hw:0,0          00:00 Pro Capture SDI         
/dev/video1     1.34            B               1.3.4429        hw:0,1          00:01 Pro Capture SDI         
"""

SAMPLE_MWCAP_INFO_I = """Device
  Family name ............................ Pro Capture
  Product name ........................... Pro Capture SDI
  Firmware name .......................... High Performance Firmware
  Serial number .......................... B105220301073  
  Hardware version ....................... B
  Firmware version ....................... 1.34
  Driver version ......................... 1.3.4429
  Board ID ............................... 0
  Channel ID ............................. 0
  Bus address ............................ bus 4, device 0
  PCIe speed ............................. gen 2
  PCIe width ............................. x1
  Max playload size ...................... 256 Bytes
  Max read request szie .................. 128 Bytes
  Total memory size ...................... 256 MB
  Free memory size ....................... 71 MB
  Max input resolution ................... 2048x1080
  Max output resolution .................. 2048x2160
  Chipset temperature .................... 75.5ºC

Input common
  Video input ............................ SDI
  Audio input ............................ SDI
  Auto scan .............................. Yes
  AV Link ................................ Yes

Input video
  Signal state ........................... Locked
  Resolution ............................. 1920x1080p 30.00 Hz
  Aspect ................................. 4:3
  Total size ............................. 2200x1125
  X offset ............................... 0
  Y offset ............................... 0
  Color space ............................ YUV BT.709
  Quantization ........................... Limited
  Saturation ............................. Limited

Input audio
  Audio format ........................... 48000 Hz, 24 bit, LPCM
  Channel 1 & 2 .......................... Valid
  Channel 3 & 4 .......................... Valid
  Channel 5 & 6 .......................... Valid
  Channel 7 & 8 .......................... Valid
"""

SAMPLE_LSPCI_OUTPUT = """00:00.0 Host bridge [0600]: Intel Corporation 8th Gen Core Processor Host Bridge/DRAM Registers [8086:3ec2] (rev 07)
04:00.0 Multimedia video controller [0400]: Nanjing Magewell Electronics Co., Ltd. Device [1d44:0005] (rev 01)
"""


class TestMagewellManager(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.mgr = MagewellManager()
        self.mgr.clear_cache()

    def test_parse_mwcap_info_list(self):
        channels = self.mgr.parse_mwcap_info_list(SAMPLE_MWCAP_INFO_L)
        self.assertEqual(len(channels), 2)
        self.assertEqual(channels[0]["device_path"], "/dev/video0")
        self.assertEqual(channels[0]["alsa_device"], "hw:0,0")
        self.assertEqual(channels[0]["board_id"], 0)
        self.assertEqual(channels[0]["channel_id"], 0)
        self.assertEqual(channels[0]["product_name"], "Pro Capture SDI")
        self.assertEqual(channels[1]["device_path"], "/dev/video1")
        self.assertEqual(channels[1]["channel_id"], 1)

    def test_parse_mwcap_info_detailed(self):
        info = self.mgr.parse_mwcap_info_detailed(SAMPLE_MWCAP_INFO_I)
        self.assertEqual(info["product_name"], "Pro Capture SDI")
        self.assertEqual(info["serial_number"], "B105220301073")
        self.assertEqual(info["temperature"], "75.5ºC")
        self.assertTrue(info["signal_locked"])
        self.assertEqual(info["detected_mode"], "1920x1080p 30.00 Hz")
        self.assertEqual(info["color_space"], "YUV BT.709")
        self.assertEqual(info["video_input"], "SDI")
        self.assertEqual(info["audio_input"], "SDI")
        self.assertEqual(len(info["audio_channels"]), 4)

    @patch("shutil.which", return_value="/usr/bin/lspci")
    @patch("subprocess.run")
    def test_get_pcie_devices(self, mock_run, mock_which):
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LSPCI_OUTPUT)
        devices = self.mgr.get_pcie_devices()
        self.assertEqual(len(devices), 1)
        self.assertEqual(devices[0]["slot"], "04:00.0")
        self.assertTrue(devices[0]["is_magewell"])

    @patch("shutil.which")
    @patch("subprocess.run")
    def test_get_system_status(self, mock_run, mock_which):
        def fake_which(cmd):
            if cmd in ["mwcap-info", "mwcap-control", "lspci"]:
                return f"/usr/bin/{cmd}"
            return None
        mock_which.side_effect = fake_which

        def fake_run(cmd, *args, **kwargs):
            if "lspci" in cmd[0]:
                return MagicMock(returncode=0, stdout=SAMPLE_LSPCI_OUTPUT)
            if "mwcap-info" in cmd[0] and "-l" in cmd:
                return MagicMock(returncode=0, stdout=SAMPLE_MWCAP_INFO_L)
            if "mwcap-info" in cmd[0] and "-i" in cmd:
                return MagicMock(returncode=0, stdout=SAMPLE_MWCAP_INFO_I)
            return MagicMock(returncode=0, stdout="")
        mock_run.side_effect = fake_run

        status = self.mgr.get_system_status()
        self.assertEqual(status["status"], "READY")
        self.assertTrue(status["utilities_available"])
        self.assertEqual(len(status["cards"]), 1)
        card = status["cards"][0]
        self.assertEqual(card["serial_number"], "B105220301073")
        self.assertEqual(len(card["channels"]), 2)
        ch0 = card["channels"][0]
        self.assertEqual(ch0["device_path"], "/dev/video0")
        self.assertEqual(ch0["temperature"], "75.5ºC")

    @patch("shutil.which", return_value="/usr/bin/mwcap-control")
    @patch("subprocess.run")
    async def test_configure_channel_success(self, mock_run, mock_which):
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        res = await self.mgr.configure_channel("/dev/video0", {
            "video_input": "sdi",
            "audio_input": "sdi",
            "low_latency": True,
            "deinterlace": "blend",
            "led_mode": "on"
        })
        self.assertTrue(res["success"])
        self.assertEqual(mock_run.call_count, 5)

    @patch("shutil.which", return_value="/usr/bin/mwcap-control")
    async def test_configure_channel_conflict(self, mock_which):
        mock_db = MagicMock()
        mock_service = MagicMock()
        mock_service.status = "running"
        mock_service.name = "Test Stream"
        mock_service.id = 42
        mock_service.config = {
            "input_config": {
                "input1": {"type": "v4l2", "device": "/dev/video0"}
            }
        }
        mock_db.query.return_value.filter.return_value.all.return_value = [mock_service]

        res = await self.mgr.configure_channel("/dev/video0", {"video_input": "hdmi"}, db_session=mock_db)
        self.assertFalse(res["success"])
        self.assertIn("Cannot reconfigure channel while active service", res["error"])


if __name__ == "__main__":
    unittest.main()
