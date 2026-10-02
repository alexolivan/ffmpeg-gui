import unittest
from unittest.mock import patch, MagicMock, mock_open
import os
import sys

# Ensure backend directory is in sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from core.audioscience_health import (
    parse_hpicontrol_list,
    parse_status_control_references,
    parse_child_control,
    probe_audioscience_health,
)
from core.hardware_health import HardwareHealthManager


class TestAudioScienceHealth(unittest.TestCase):
    def test_parse_hpicontrol_list(self):
        output = """Local adapters: 2
  0 ASI5720, serial 105283, SW version 4.20.54, HW version F7, 2 inputs, 4 outputs
  1 ASI5810, serial 114300, SW version 4.20.54, HW version D3, 2 inputs, 4 outputs
Network Adapters on default interface: 0
"""
        adapters = parse_hpicontrol_list(output)
        self.assertEqual(len(adapters), 2)
        self.assertEqual(adapters[0]["adapter_index"], 0)
        self.assertEqual(adapters[0]["name"], "ASI5720")
        self.assertEqual(adapters[0]["serial"], "105283")

        self.assertEqual(adapters[1]["adapter_index"], 1)
        self.assertEqual(adapters[1]["name"], "ASI5810")
        self.assertEqual(adapters[1]["serial"], "114300")

    def test_parse_status_control_references(self):
        # Case 1: multiple references [10, 11]
        out_multi = """Control 9 CONTROL_UNIVERSAL on SOURCENODE_ADAPTER 0 Universal_Info 
sequence block[3]
--cstring classname[6]= b'Status'
--int flags[1]= 2readable
--reference value[2]= [10, 11]
Universal_Get 
reference value[2]= [10, 11]
"""
        refs_multi = parse_status_control_references(out_multi)
        self.assertEqual(refs_multi, [10, 11])

        # Case 2: single reference 10
        out_single = """Control 9 CONTROL_UNIVERSAL on SOURCENODE_ADAPTER 0 Universal_Info 
sequence block[3]
--cstring classname[6]= b'Status'
--int flags[1]= 2readable
--reference value[1]= 10
Universal_Get 
reference value[1]= 10
"""
        refs_single = parse_status_control_references(out_single)
        self.assertEqual(refs_single, [10])

    def test_parse_child_control(self):
        cpu_out = """Control 10 CONTROL_UNIVERSAL on SOURCENODE_ADAPTER 0 Universal_Info 
sequence parameter_port[5]
--cstring classname[15]= b'CPU Utilization'
--cstring units[1]= b'%'
--int flags[1]= 6readablevolatile
--sequence value_constraint[1]
----int range[3]= [0, 100, 1]
--int value[1]= 8
Universal_Get 
int value[1]= 8
"""
        cpu_res = parse_child_control(cpu_out)
        self.assertEqual(cpu_res["classname"], "CPU Utilization")
        self.assertEqual(cpu_res["value"], 8)

        temp_out = """Control 11 CONTROL_UNIVERSAL on SOURCENODE_ADAPTER 0 Universal_Info 
sequence parameter_port[5]
--cstring classname[11]= b'Temperature'
--cstring units[9]= b'degrees C'
--int flags[1]= 6readablevolatile
--sequence value_constraint[1]
----float range[3]= [0.0, 100.0, 1.0]
--float value[1]= 53.0
Universal_Get 
float value[1]= 53.0
"""
        temp_res = parse_child_control(temp_out)
        self.assertEqual(temp_res["classname"], "Temperature")
        self.assertEqual(temp_res["value"], 53.0)

    @patch("core.audioscience_health._find_hpicontrol_bin", return_value="/usr/bin/hpicontrol.py")
    @patch("subprocess.run")
    def test_probe_audioscience_health_success(self, mock_run, mock_bin):
        def side_effect(cmd, **kwargs):
            m = MagicMock()
            m.returncode = 0
            if cmd == ["/usr/bin/hpicontrol.py", "list"]:
                m.stdout = "  0 ASI5720, serial 105283, SW version 4.20.54\n"
            elif cmd == ["/usr/bin/hpicontrol.py", "-a", "0", "cget", "9"]:
                m.stdout = "--reference value[2]= [10, 11]\n"
            elif cmd == ["/usr/bin/hpicontrol.py", "-a", "0", "cget", "10"]:
                m.stdout = "--cstring classname[15]= b'CPU Utilization'\nint value[1]= 8\n"
            elif cmd == ["/usr/bin/hpicontrol.py", "-a", "0", "cget", "11"]:
                m.stdout = "--cstring classname[11]= b'Temperature'\nfloat value[1]= 53.0\n"
            return m

        mock_run.side_effect = side_effect
        cards = probe_audioscience_health()
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]["name"], "ASI5720")
        self.assertEqual(cards[0]["dsp_cpu_percent"], 8)
        self.assertEqual(cards[0]["dsp_temp_c"], 53.0)
        self.assertTrue(cards[0]["has_temp_sensor"])
        self.assertEqual(cards[0]["status"], "normal")

    @patch("core.audioscience_health._find_hpicontrol_bin", return_value="/usr/bin/hpicontrol.py")
    @patch("subprocess.run")
    def test_probe_audioscience_without_temp_sensor(self, mock_run, mock_bin):
        # Card like ASI5810 where status only references control 10 (CPU load), no temp sensor
        def side_effect(cmd, **kwargs):
            m = MagicMock()
            m.returncode = 0
            if cmd == ["/usr/bin/hpicontrol.py", "list"]:
                m.stdout = "  0 ASI5810, serial 114300, SW version 4.20.54\n"
            elif cmd == ["/usr/bin/hpicontrol.py", "-a", "0", "cget", "9"]:
                m.stdout = "--reference value[1]= 10\n"
            elif cmd == ["/usr/bin/hpicontrol.py", "-a", "0", "cget", "10"]:
                m.stdout = "--cstring classname[15]= b'CPU Utilization'\nint value[1]= 17\n"
            return m

        mock_run.side_effect = side_effect
        cards = probe_audioscience_health()
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]["name"], "ASI5810")
        self.assertEqual(cards[0]["dsp_cpu_percent"], 17)
        self.assertIsNone(cards[0]["dsp_temp_c"])
        self.assertFalse(cards[0]["has_temp_sensor"])
        self.assertEqual(cards[0]["status"], "normal")



class TestHardwareHealthManager(unittest.TestCase):
    def setUp(self):
        self.mgr = HardwareHealthManager()
        self.mgr._is_first_throttle_probe = True

    @patch("glob.glob")
    @patch("os.path.isfile", return_value=True)
    def test_probe_cpu_temperatures(self, mock_isfile, mock_glob):
        mock_glob.side_effect = lambda pat: {
            "/sys/class/hwmon/hwmon*": ["/sys/class/hwmon/hwmon0"],
            "/sys/class/hwmon/hwmon0/temp*_input": [
                "/sys/class/hwmon/hwmon0/temp1_input",
                "/sys/class/hwmon/hwmon0/temp2_input",
            ],
            "/sys/class/thermal/thermal_zone*": [],
        }.get(pat, [])

        def file_read_side_effect(filename, *args, **kwargs):
            if filename == "/sys/class/hwmon/hwmon0/name":
                return mock_open(read_data="coretemp\n").return_value
            elif filename == "/sys/class/hwmon/hwmon0/temp1_input":
                return mock_open(read_data="58000\n").return_value
            elif filename == "/sys/class/hwmon/hwmon0/temp1_label":
                return mock_open(read_data="Package id 0\n").return_value
            elif filename == "/sys/class/hwmon/hwmon0/temp2_input":
                return mock_open(read_data="54000\n").return_value
            elif filename == "/sys/class/hwmon/hwmon0/temp2_label":
                return mock_open(read_data="Core 0\n").return_value
            return mock_open(read_data="").return_value

        with patch("builtins.open", side_effect=file_read_side_effect):
            pkg_temp, cores = self.mgr._probe_cpu_temperatures()
            self.assertEqual(pkg_temp, 58.0)
            self.assertEqual(len(cores), 1)
            self.assertEqual(cores[0]["label"], "Core 0")
            self.assertEqual(cores[0]["temp"], 54.0)

    @patch("glob.glob")
    def test_probe_thermal_throttling_detection(self, mock_glob):
        mock_glob.side_effect = lambda pat: {
            "/sys/devices/system/cpu/cpu*/thermal_throttle/package_throttle_count": [
                "/sys/devices/system/cpu/cpu0/thermal_throttle/package_throttle_count"
            ],
            "/sys/devices/system/cpu/cpu*/thermal_throttle/core_throttle_count": [
                "/sys/devices/system/cpu/cpu0/thermal_throttle/core_throttle_count"
            ],
        }.get(pat, [])

        # First probe: initializes baselines
        with patch("builtins.open", side_effect=[mock_open(read_data="5\n").return_value, mock_open(read_data="2\n").return_value]):
            res1 = self.mgr._probe_thermal_throttling()
            self.assertFalse(res1["active"])
            self.assertTrue(res1["throttling_detected"])
            self.assertEqual(res1["total_package_events"], 5)

        # Second probe with incremented events -> actively throttling
        with patch("builtins.open", side_effect=[mock_open(read_data="8\n").return_value, mock_open(read_data="4\n").return_value]):
            res2 = self.mgr._probe_thermal_throttling()
            self.assertTrue(res2["active"])
            self.assertEqual(res2["recent_events"], 5)  # (8-5) + (4-2) = 3 + 2 = 5

    @patch("glob.glob")
    @patch("os.path.isfile", return_value=True)
    def test_probe_fans(self, mock_isfile, mock_glob):
        mock_glob.return_value = ["/sys/class/hwmon/hwmon0/fan1_input"]

        def fan_read_side_effect(filename, *args, **kwargs):
            if filename == "/sys/class/hwmon/hwmon0/fan1_input":
                return mock_open(read_data="1850\n").return_value
            elif filename == "/sys/class/hwmon/hwmon0/fan1_label":
                return mock_open(read_data="Chassis Fan 1\n").return_value
            return mock_open(read_data="").return_value

        with patch("builtins.open", side_effect=fan_read_side_effect):
            fans = self.mgr._probe_fans()
            self.assertEqual(len(fans), 1)
            self.assertEqual(fans[0]["name"], "Chassis Fan 1")
            self.assertEqual(fans[0]["rpm"], 1850)
            self.assertEqual(fans[0]["status"], "ok")

    @patch.object(HardwareHealthManager, "_probe_cpu_temperatures")
    @patch.object(HardwareHealthManager, "_probe_thermal_throttling")
    @patch.object(HardwareHealthManager, "_probe_fans")
    @patch.object(HardwareHealthManager, "_probe_av_hardware")
    def test_overall_status_evaluation(self, mock_av, mock_fans, mock_throt, mock_cpu):
        mock_cpu.return_value = (55.0, [{"label": "Core 0", "temp": 52.0}])
        mock_throt.return_value = {"active": False, "throttling_detected": False, "recent_events": 0}
        mock_fans.return_value = [{"name": "Fan 1", "rpm": 1500, "status": "ok"}]
        mock_av.return_value = {"audioscience": [], "magewell": [], "decklink": []}

        # 1. Normal
        snap_normal = self.mgr.collect_health_snapshot()
        self.assertEqual(snap_normal["status"], "normal")
        self.assertEqual(len(snap_normal["alerts"]), 0)

        # 2. Warning due to temperature (76°C)
        mock_cpu.return_value = (76.0, [])
        snap_warn = self.mgr.collect_health_snapshot()
        self.assertEqual(snap_warn["status"], "warning")
        self.assertTrue(any("Elevated" in a["message"] for a in snap_warn["alerts"]))

        # 3. Critical due to temperature (88°C)
        mock_cpu.return_value = (88.0, [])
        snap_crit = self.mgr.collect_health_snapshot()
        self.assertEqual(snap_crit["status"], "critical")
        self.assertTrue(any("Critical" in a["message"] for a in snap_crit["alerts"]))

        # 4. Stopped fan alert when temp >= 65°C
        mock_cpu.return_value = (68.0, [])
        mock_fans.return_value = [{"name": "Chassis Fan 1", "rpm": 0, "status": "stopped"}]
        snap_fan = self.mgr.collect_health_snapshot()
        self.assertTrue(any("fan failure" in a["message"].lower() for a in snap_fan["alerts"]))



if __name__ == "__main__":
    unittest.main()
