import os
import sys
import unittest
from unittest.mock import patch, MagicMock

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from core.alsa_manager import AlsaManager, alsa_manager

SAMPLE_AMIXER_OUTPUT = """
numid=16,iface=MIXER,name='PCM 0 Playback Volume'
  ; type=INTEGER,access=rw---R--,values=2,min=-10000,max=2000,step=1
  : values=0,0
  | dBscale-min=-100.00dB,step=0.01dB,mute=1
numid=17,iface=MIXER,name='PCM 0 Playback Switch'
  ; type=BOOLEAN,access=rw------,values=1
  : values=on
numid=32,iface=MIXER,name='PCM 0 Playback Meter'
  ; type=INTEGER,access=r--v----,values=2,min=0,max=2147483647,step=0
  : values=214748,214748
numid=40,iface=MIXER,name='PCM 0 Capture Route'
  ; type=ENUMERATED,access=rw------,values=1,items=3
  ; Item #0 'Line 0'
  ; Item #1 'Digital 0'
  ; Item #2 'PCM 0'
  : values=0
numid=1,iface=MIXER,name='Line 0 Capture Level'
  ; type=INTEGER,access=rw---R--,values=1,min=-10,max=24,step=1
  : values=14
  | dBscale-min=-10.00dB,step=1.00dB,mute=0
"""

class TestAlsaManager(unittest.TestCase):
    def setUp(self):
        self.mgr = AlsaManager()

    def test_singleton(self):
        m2 = AlsaManager()
        self.assertIs(self.mgr, m2)

    def test_classify_control(self):
        res_vol = self.mgr._classify_control(
            name="PCM 0 Playback Volume",
            iface=2,
            elem_type=2,
            access_flags="rw---R--",
            items=[]
        )
        self.assertEqual(res_vol["type"], "volume")
        self.assertEqual(res_vol["category"], "virtual_playout")
        self.assertEqual(res_vol["group"], "PCM 0")
        self.assertFalse(res_vol["is_meter"])

        res_master = self.mgr._classify_control(
            name="Master Playback Volume",
            iface=2,
            elem_type=2,
            access_flags="rw---R--",
            items=[]
        )
        self.assertEqual(res_master["category"], "hardware_outputs")
        self.assertEqual(res_master["group"], "Master")

        res_meter = self.mgr._classify_control(
            name="PCM 0 Playback Meter",
            iface=2,
            elem_type=2,
            access_flags="r--v----",
            items=[]
        )
        self.assertEqual(res_meter["type"], "meter")
        self.assertTrue(res_meter["is_meter"])

        res_line = self.mgr._classify_control(
            name="Line 0 Capture Level",
            iface=2,
            elem_type=2,
            access_flags="rw---R--",
            items=[]
        )
        self.assertEqual(res_line["category"], "hardware_inputs")
        self.assertEqual(res_line["group"], "Line 0")

        # Test standalone 'Line' vs 'Line Out'
        res_standalone_line = self.mgr._classify_control(
            name="Line Volume",
            iface=2,
            elem_type=2,
            access_flags="rw---R--",
            items=[]
        )
        self.assertEqual(res_standalone_line["category"], "hardware_inputs")

        res_line_out = self.mgr._classify_control(
            name="Line Out Playback Volume",
            iface=2,
            elem_type=2,
            access_flags="rw---R--",
            items=[]
        )
        self.assertEqual(res_line_out["category"], "hardware_outputs")

        # Test AudioScience Crosspoint Matrix Double-Name classification
        res_matrix1 = self.mgr._classify_control(
            name="PCM 0 Line 0 Playback Volume",
            iface=2,
            elem_type=2,
            access_flags="rw---R--",
            items=[]
        )
        self.assertEqual(res_matrix1["category"], "hardware_outputs")
        self.assertEqual(res_matrix1["group"], "Line 0")
        self.assertEqual(res_matrix1["matrix_source"], "PCM 0")

        res_matrix2 = self.mgr._classify_control(
            name="Line 0 Line 0 Monitor Playback Volume",
            iface=2,
            elem_type=2,
            access_flags="rw---R--",
            items=[]
        )
        self.assertEqual(res_matrix2["category"], "hardware_outputs")
        self.assertEqual(res_matrix2["group"], "Line 0")
        self.assertEqual(res_matrix2["matrix_source"], "Line 0 (Monitor)")

        res_matrix3 = self.mgr._classify_control(
            name="Line 1 Line 0 Monitor Playback Volume",
            iface=2,
            elem_type=2,
            access_flags="rw---R--",
            items=[]
        )
        self.assertEqual(res_matrix3["category"], "hardware_outputs")
        self.assertEqual(res_matrix3["group"], "Line 0")
        self.assertEqual(res_matrix3["matrix_source"], "Line 1 (Monitor)")

        # Test ignoring internal monitor playback mode crossovers
        res_ignored1 = self.mgr._classify_control(
            name="Line 0 Line 0 Monitor Playback Mode",
            iface=2,
            elem_type=3,
            access_flags="rw------",
            items=["Normal", "Swap", "From Left", "From Right", "To Left", "To Right"]
        )
        self.assertEqual(res_ignored1["category"], "ignored")
        self.assertEqual(res_ignored1["type"], "ignored")

        res_ignored2 = self.mgr._classify_control(
            name="Line 1 Line 0 Monitor Playback Mode",
            iface=2,
            elem_type=3,
            access_flags="rw------",
            items=["Normal", "Swap", "From Left", "From Right", "To Left", "To Right"]
        )
        self.assertEqual(res_ignored2["category"], "ignored")
        self.assertEqual(res_ignored2["type"], "ignored")

    def test_parse_amixer_contents(self):
        controls = self.mgr._parse_amixer_contents(SAMPLE_AMIXER_OUTPUT)
        self.assertEqual(len(controls), 5)
        
        vol_ctrl = next(c for c in controls if c["numid"] == 16)
        self.assertEqual(vol_ctrl["name"], "PCM 0 Playback Volume")
        self.assertEqual(vol_ctrl["min"], -10000)
        self.assertEqual(vol_ctrl["max"], 2000)
        self.assertEqual(vol_ctrl["db_min"], -100.0)
        self.assertEqual(vol_ctrl["values"], [0, 0])

        route_ctrl = next(c for c in controls if c["numid"] == 40)
        self.assertEqual(route_ctrl["items"], ["Line 0", "Digital 0", "PCM 0"])

    @patch("subprocess.run")
    def test_get_topology_fallback(self, mock_run):
        mock_proc = MagicMock()
        mock_proc.returncode = 0
        mock_proc.stdout = SAMPLE_AMIXER_OUTPUT
        mock_run.return_value = mock_proc

        topo = self.mgr._get_topology_fallback(card_idx=1)
        self.assertEqual(topo["card_index"], 1)
        self.assertIn("virtual_playout", topo)
        self.assertIn("hardware_inputs", topo)
        self.assertTrue(len(topo["virtual_playout"]) > 0)
        
        pcm_grp = topo["virtual_playout"][0]
        self.assertEqual(pcm_grp["name"], "PCM 0")
        self.assertTrue(len(pcm_grp["controls"]) > 0)
        self.assertTrue(len(pcm_grp["meters"]) > 0)

    @patch("subprocess.run")
    def test_write_control_value(self, mock_run):
        mock_proc = MagicMock()
        mock_proc.returncode = 0
        mock_run.return_value = mock_proc

        res = self.mgr.write_control_value(card_idx=1, numid=17, values=[True])
        self.assertTrue(res)
        mock_run.assert_called_once()
        cmd_args = mock_run.call_args[0][0]
        self.assertIn("amixer", cmd_args)
        self.assertIn("cset", cmd_args)
        self.assertIn("numid=17", cmd_args)
        self.assertIn("on", cmd_args)

if __name__ == "__main__":
    unittest.main()
