import unittest
from unittest.mock import patch, mock_open
import asyncio
from utils.alsa_v4l2_helper import (
    parse_arecord_output,
    build_alsa_devices,
    get_alsa_devices,
    get_alsa_playback_devices,
    get_alsa_devices_hierarchical
)

class TestAlsaDevices(unittest.IsolatedAsyncioTestCase):

    def test_parse_arecord_output_multiple_cards(self):
        output = """
card 0: PCH [HDA Intel PCH], device 0: ALC892 Analog [ALC892 Analog]
  Subdevices: 1/1
  Subdevice #0: subdevice #0
card 1: Loopback [Loopback], device 0: Loopback PCM [Loopback PCM]
  Subdevices: 8/8
  Subdevice #0: subdevice #0
  Subdevice #1: subdevice #1
card 1: Loopback [Loopback], device 1: Loopback PCM [Loopback PCM]
  Subdevices: 8/8
  Subdevice #0: subdevice #0
card 2: ASI5810 [ASI5810], device 0: Playback/Capture [Line In]
  Subdevices: 2/2
  Subdevice #0: subdevice #0
  Subdevice #1: subdevice #1
"""
        devices = parse_arecord_output(output)
        # Verify card 0, card 1 (loopback), card 2 (ASI) are parsed
        dev_strings = [d["device"] for d in devices]
        self.assertIn("hw:0,0", dev_strings)
        self.assertIn("hw:1,0,0", dev_strings)
        self.assertIn("hw:1,1,0", dev_strings)
        self.assertIn("hw:2,0,0", dev_strings)
        self.assertIn("hw:2,0,1", dev_strings)

    async def test_get_alsa_devices_hierarchical_from_proc(self):
        proc_cards = """ 0 [PCH            ]: HDA-Intel - HDA Intel PCH
                      HDA Intel PCH at 0xf7d10000 irq 51
 1 [Loopback       ]: Loopback - Loopback
                      Loopback 1
 2 [ASI5810        ]: ASI5810 - AudioScience ASI5810
                      PCI Express Audio Adapter
"""
        # Test hierarchical extraction
        with patch("os.path.exists", return_value=True), \
             patch("builtins.open", mock_open(read_data=proc_cards)):
            # Mock glob to simulate devices under /proc/asound/
            def mock_glob(path):
                if "/proc/asound/card0/pcm*" in path:
                    return ["/proc/asound/card0/pcm0c"]
                if "/proc/asound/card1/pcm*" in path:
                    return ["/proc/asound/card1/pcm0c", "/proc/asound/card1/pcm1c"]
                if "/proc/asound/card2/pcm*" in path:
                    return ["/proc/asound/card2/pcm0c"]
                if "sub*" in path:
                    if "card2" in path:
                        return ["/proc/asound/card2/pcm0c/sub0", "/proc/asound/card2/pcm0c/sub1"]
                    elif "card1/pcm1c" in path:
                        return ["/proc/asound/card1/pcm1c/sub0", "/proc/asound/card1/pcm1c/sub1"]
                    return ["/proc/asound/card0/pcm0c/sub0"]
                return []

            with patch("glob.glob", side_effect=mock_glob):
                hierarchical = await get_alsa_devices_hierarchical(stream_type="capture")
                self.assertEqual(len(hierarchical), 3)
                card_names = [c["card_name"] for c in hierarchical]
                self.assertIn("HDA Intel PCH", card_names)
                self.assertIn("Loopback", card_names)
                self.assertIn("AudioScience ASI5810", card_names)
                
                # Check ASI card devices
                asi_card = next(c for c in hierarchical if c["card_id"] == 2)
                self.assertEqual(len(asi_card["devices"]), 2)
                self.assertEqual(asi_card["devices"][0]["device"], "hw:2,0,0")
                self.assertEqual(asi_card["devices"][1]["device"], "hw:2,0,1")

if __name__ == "__main__":
    unittest.main()
