import unittest
from utils.alsa_v4l2_helper import parse_magewell_devices, parse_v4l2_formats, parse_arecord_output

class TestAlsaV4l2Helper(unittest.TestCase):
    def test_parse_magewell_devices(self):
        stdout = (
            "#DevicePath\tVersion\tLetter\tDriverVersion\tAlsaDevice\tName\n"
            "/dev/video0\t1.34\tB\t1.3.4429\thw:1,0\t00:00 Pro Capture SDI\n"
            "/dev/video1\t1.34\tB\t1.3.4429\thw:1,1\t00:01 Pro Capture HDMI\n"
        )
        res = parse_magewell_devices(stdout)
        self.assertEqual(len(res), 2)
        self.assertIn("/dev/video0", res)
        self.assertEqual(res["/dev/video0"]["alsa_device"], "hw:1,0")
        self.assertEqual(res["/dev/video0"]["name"], "00:00 Pro Capture SDI")
        self.assertTrue(res["/dev/video0"]["is_magewell"])

        self.assertIn("/dev/video1", res)
        self.assertEqual(res["/dev/video1"]["alsa_device"], "hw:1,1")
        self.assertEqual(res["/dev/video1"]["name"], "00:01 Pro Capture HDMI")

    def test_parse_v4l2_formats(self):
        stderr = (
            "[video4linux2,v4l2 @ 0x55cae5fcf7c0] Raw       :     yuyv422 :           YUYV 4:2:2 : 640x480 320x240\n"
            "[video4linux2,v4l2 @ 0x55cae5fcf7c0] Compressed:       mjpeg :          Motion-JPEG : 640x480\n"
        )
        res = parse_v4l2_formats(stderr)
        self.assertEqual(len(res), 2)
        self.assertEqual(res[0]["type"], "Raw")
        self.assertEqual(res[0]["pixel_format"], "yuyv422")
        self.assertEqual(res[0]["description"], "YUYV 4:2:2")
        self.assertEqual(res[0]["resolutions"], ["640x480", "320x240"])

        self.assertEqual(res[1]["type"], "Compressed")
        self.assertEqual(res[1]["pixel_format"], "mjpeg")
        self.assertEqual(res[1]["description"], "Motion-JPEG")
        self.assertEqual(res[1]["resolutions"], ["640x480"])

    def test_parse_arecord_output_single_subdevice(self):
        stdout = (
            "**** List of CAPTURE Hardware Devices ****\n"
            "card 0: PCH [HDA Intel PCH], device 0: ALC892 Analog [ALC892 Analog]\n"
            "  Subdevices: 1/1\n"
            "  Subdevice #0: subdevice #0\n"
            "card 1: Pro [Pro Capture SDI], device 0: Pro Capture PCM [Pro Capture PCM]\n"
            "  Subdevices: 1/1\n"
            "  Subdevice #0: subdevice #0\n"
        )
        res = parse_arecord_output(stdout)
        self.assertEqual(len(res), 2)
        self.assertEqual(res[0]["device"], "hw:0,0")
        self.assertEqual(res[0]["name"], "PCH - ALC892 Analog")
        self.assertEqual(res[1]["device"], "hw:1,0")
        self.assertEqual(res[1]["name"], "Pro - Pro Capture PCM")

    def test_parse_arecord_output_multiple_subdevices(self):
        stdout = (
            "card 2: ASI5810 [ASI5810], device 0: Asihpi PCM [Asihpi PCM]\n"
            "  Subdevices: 2/2\n"
            "  Subdevice #0: subdevice #0\n"
            "  Subdevice #1: subdevice #1\n"
        )
        res = parse_arecord_output(stdout)
        self.assertEqual(len(res), 2)
        self.assertEqual(res[0]["device"], "hw:2,0,0")
        self.assertEqual(res[0]["name"], "ASI5810 - Asihpi PCM (Subdevice #0)")
        self.assertEqual(res[1]["device"], "hw:2,0,1")
        self.assertEqual(res[1]["name"], "ASI5810 - Asihpi PCM (Subdevice #1)")
