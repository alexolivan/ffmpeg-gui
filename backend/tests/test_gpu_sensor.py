import unittest
from unittest.mock import patch, mock_open, MagicMock
from utils.gpu_sensor import GPUSensor

class TestGPUSensor(unittest.TestCase):
    @patch("shutil.which")
    @patch("os.path.exists")
    def test_vendor_detection_nvidia(self, mock_exists, mock_which):
        mock_which.return_value = "/usr/bin/nvidia-smi"
        sensor = GPUSensor()
        self.assertEqual(sensor.vendor, "nvidia")

    @patch("shutil.which")
    @patch("os.path.exists")
    def test_vendor_detection_amd(self, mock_exists, mock_which):
        mock_which.return_value = None
        mock_exists.side_effect = lambda p: p == "/sys/class/drm/card0/device/vendor"
        
        with patch("builtins.open", mock_open(read_data="0x1002\n")):
            sensor = GPUSensor()
            self.assertEqual(sensor.vendor, "amd")

    @patch("shutil.which")
    @patch("os.path.exists")
    def test_vendor_detection_none(self, mock_exists, mock_which):
        mock_which.return_value = None
        mock_exists.return_value = False
        sensor = GPUSensor()
        self.assertEqual(sensor.vendor, "none")

    @patch("shutil.which")
    @patch("subprocess.run")
    def test_get_stats_nvidia(self, mock_run, mock_which):
        mock_which.return_value = "/usr/bin/nvidia-smi"
        mock_run.return_value = MagicMock(stdout=" 25, 10, 1024, 8192\n", returncode=0)
        
        sensor = GPUSensor()
        stats = sensor.get_stats()
        self.assertEqual(stats["vendor"], "nvidia")
        self.assertEqual(stats["utilization"], 25)
        self.assertEqual(stats["vram_used"], 1024)
        self.assertEqual(stats["vram_total"], 8192)

    @patch("shutil.which")
    @patch("os.path.exists")
    def test_get_stats_amd(self, mock_exists, mock_which):
        mock_which.return_value = None
        mock_exists.side_effect = lambda p: p in (
            "/sys/class/drm/card0/device/vendor",
            "/sys/class/drm/card0/device/gpu_busy_percent",
            "/sys/class/drm/card0/device/mem_info_vram_used",
            "/sys/class/drm/card0/device/mem_info_vram_total"
        )
        
        # We patch builtin open to return different values depending on file
        open_mock = mock_open()
        # Mock file contents:
        # vendor = 0x1002
        # gpu_busy_percent = 15
        # mem_info_vram_used = 104857600 (100 MB)
        # mem_info_vram_total = 4194304000 (4000 MB)
        file_contents = {
            "/sys/class/drm/card0/device/vendor": "0x1002\n",
            "/sys/class/drm/card0/device/gpu_busy_percent": "15\n",
            "/sys/class/drm/card0/device/mem_info_vram_used": "104857600\n",
            "/sys/class/drm/card0/device/mem_info_vram_total": "4194304000\n"
        }
        open_mock.side_effect = lambda p, *args, **kwargs: mock_open(read_data=file_contents.get(p, "")).return_value
        
        with patch("builtins.open", open_mock):
            sensor = GPUSensor()
            stats = sensor.get_stats()
            self.assertEqual(stats["vendor"], "amd")
            self.assertEqual(stats["utilization"], 15)
            self.assertEqual(stats["vram_used"], 100)
            self.assertEqual(stats["vram_total"], 4000)

    @patch("shutil.which")
    @patch("subprocess.run")
    @patch("time.time")
    def test_get_stats_nvidia_caching(self, mock_time, mock_run, mock_which):
        mock_which.return_value = "/usr/bin/nvidia-smi"
        mock_time.return_value = 1000.0
        
        # First call return values
        mock_run.return_value = MagicMock(stdout=" 25, 10, 1024, 8192\n", returncode=0)
        sensor = GPUSensor()
        stats1 = sensor.get_stats()
        self.assertEqual(stats1["utilization"], 25)
        self.assertEqual(mock_run.call_count, 1)

        # Second call within 5 seconds (same timestamp)
        # Change mock return value to make sure it's not queried
        mock_run.return_value = MagicMock(stdout=" 50, 20, 2048, 8192\n", returncode=0)
        stats2 = sensor.get_stats()
        self.assertEqual(stats2["utilization"], 25) # Should still be cached 25
        self.assertEqual(mock_run.call_count, 1) # Call count remains 1

        # Third call after 6 seconds
        mock_time.return_value = 1006.0
        stats3 = sensor.get_stats()
        self.assertEqual(stats3["utilization"], 50) # Should query and get new stats 50
        self.assertEqual(mock_run.call_count, 2) # Call count should increase to 2

