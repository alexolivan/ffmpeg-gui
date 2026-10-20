import unittest
from unittest.mock import patch, mock_open
import os
from core.alsa_manager import AlsaManager


class TestAlsaAdvisor(unittest.TestCase):
    def setUp(self):
        self.mgr = AlsaManager()

    def test_iommu_hazard_detected_when_audioscience_and_strict_iommu(self):
        with patch.object(self.mgr, "get_cards") as mock_cards, \
             patch("os.path.exists") as mock_exists, \
             patch("os.listdir") as mock_listdir, \
             patch("builtins.open", mock_open(read_data="BOOT_IMAGE=/vmlinuz root=/dev/sda1 ro quiet")):

            mock_cards.return_value = [
                {"card_index": 0, "card_id": "ASI56400", "name": "ASI5640-0", "driver": "ASIHPI"}
            ]
            mock_exists.side_effect = lambda path: path in ("/proc/cmdline", "/sys/class/iommu")
            mock_listdir.return_value = ["dmar0", "dmar1"]

            res = self.mgr.get_kernel_iommu_status()
            self.assertTrue(res["has_audioscience"])
            self.assertTrue(res["iommu_active"])
            self.assertEqual(res["iommu_mode"], "strict")
            self.assertTrue(res["hazard_detected"])
            self.assertEqual(res["recommended_cmdline"], "intel_iommu=pt iommu=pt")

    def test_iommu_no_hazard_when_passthrough_enabled(self):
        with patch.object(self.mgr, "get_cards") as mock_cards, \
             patch("os.path.exists") as mock_exists, \
             patch("os.listdir") as mock_listdir, \
             patch("builtins.open", mock_open(read_data="BOOT_IMAGE=/vmlinuz intel_iommu=pt iommu=pt ro quiet")):

            mock_cards.return_value = [
                {"card_index": 0, "card_id": "ASI56400", "name": "ASI5640-0", "driver": "ASIHPI"}
            ]
            mock_exists.side_effect = lambda path: path in ("/proc/cmdline", "/sys/class/iommu")
            mock_listdir.return_value = ["dmar0"]

            res = self.mgr.get_kernel_iommu_status()
            self.assertTrue(res["has_audioscience"])
            self.assertEqual(res["iommu_mode"], "passthrough")
            self.assertFalse(res["hazard_detected"])

    def test_iommu_no_hazard_when_no_audioscience_card(self):
        with patch.object(self.mgr, "get_cards") as mock_cards, \
             patch("os.path.exists") as mock_exists, \
             patch("builtins.open", mock_open(read_data="BOOT_IMAGE=/vmlinuz ro quiet")):

            mock_cards.return_value = [
                {"card_index": 0, "card_id": "PCH", "name": "HDA Intel", "driver": "HDA-Intel"},
                {"card_index": 1, "card_id": "Loopback", "name": "Loopback", "driver": "snd-aloop"}
            ]
            mock_exists.side_effect = lambda path: path == "/proc/cmdline"

            res = self.mgr.get_kernel_iommu_status()
            self.assertFalse(res["has_audioscience"])
            self.assertFalse(res["hazard_detected"])

    def test_slots_advisor_detects_unpinned_multiple_cards(self):
        with patch.object(self.mgr, "get_cards") as mock_cards, \
             patch("os.path.exists", return_value=True), \
             patch("os.listdir", return_value=[]):  # Empty /etc/modprobe.d/

            mock_cards.return_value = [
                {"card_index": 0, "card_id": "ASI56400", "name": "ASI5640-0", "driver": "ASIHPI"},
                {"card_index": 1, "card_id": "PCH", "name": "HDA Intel", "driver": "HDA-Intel"},
                {"card_index": 2, "card_id": "Loopback", "name": "Loopback", "driver": "snd-aloop"}
            ]

            res = self.mgr.get_alsa_slots_status()
            self.assertTrue(res["has_multiple_cards"])
            self.assertFalse(res["is_pinned"])
            self.assertIn("options snd_asihpi index=0", res["recommended_snippet"])
            self.assertIn("options snd_hda_intel index=1", res["recommended_snippet"])
            self.assertIn("options snd_aloop index=2 enable=1 pcm_substreams=8", res["recommended_snippet"])
            self.assertIn("options snd slots=snd_asihpi,snd_hda_intel,snd_aloop", res["recommended_snippet"])

    def test_slots_advisor_detects_properly_pinned_cards(self):
        modprobe_content = """
        options snd_asihpi index=0
        options snd_hda_intel index=1
        options snd_aloop index=2 enable=1 pcm_substreams=8
        options snd slots=snd_asihpi,snd_hda_intel,snd_aloop
        """
        with patch.object(self.mgr, "get_cards") as mock_cards, \
             patch("os.path.exists", return_value=True), \
             patch("os.listdir", return_value=["alsa-base.conf"]), \
             patch("builtins.open", mock_open(read_data=modprobe_content)):

            mock_cards.return_value = [
                {"card_index": 0, "card_id": "ASI56400", "name": "ASI5640-0", "driver": "ASIHPI"},
                {"card_index": 1, "card_id": "PCH", "name": "HDA Intel", "driver": "HDA-Intel"},
                {"card_index": 2, "card_id": "Loopback", "name": "Loopback", "driver": "snd-aloop"}
            ]

            res = self.mgr.get_alsa_slots_status()
            self.assertTrue(res["has_multiple_cards"])
            self.assertTrue(res["is_pinned"])
            self.assertFalse(res["conflict_detected"])


if __name__ == "__main__":
    unittest.main()
