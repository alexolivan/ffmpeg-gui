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

    def test_slots_advisor_multi_card_same_module(self):
        """Simulates test1 with NVidia GPU HDMI + Motherboard HD-Audio Generic + Loopback."""
        with patch.object(self.mgr, "get_cards") as mock_cards, \
             patch("os.path.exists", return_value=True), \
             patch("os.listdir", return_value=[]):

            mock_cards.return_value = [
                {"card_index": 0, "card_id": "NVidia", "name": "HDA-Intel - HDA NVidia", "driver": "HDA-Intel", "module": "snd_hda_intel"},
                {"card_index": 2, "card_id": "Generic", "name": "HDA-Intel - HD-Audio Generic", "driver": "HDA-Intel", "module": "snd_hda_intel"},
                {"card_index": 3, "card_id": "Loopback", "name": "Loopback - Loopback", "driver": "Loopback", "module": "snd_aloop"}
            ]

            res = self.mgr.get_alsa_slots_status()
            self.assertTrue(res["has_multiple_cards"])
            self.assertFalse(res["is_pinned"])
            # Should group multiple snd_hda_intel into a single options line with comma-separated index and id
            self.assertIn("options snd_hda_intel index=0,1 id=NVidia,Generic", res["recommended_snippet"])
            self.assertIn("options snd_aloop index=2 enable=1 pcm_substreams=8", res["recommended_snippet"])
            self.assertIn("options snd slots=snd_hda_intel,snd_hda_intel,snd_aloop", res["recommended_snippet"])

    def test_get_alsa_diagnostics_endpoint(self):
        from starlette.testclient import TestClient
        from main import app
        client = TestClient(app)

        with patch.object(self.mgr, "get_alsa_advisor_diagnostics") as mock_diag:
            mock_diag.return_value = {
                "iommu_hazard": {"hazard_detected": True, "has_audioscience": True},
                "slots_advisor": {"is_pinned": False, "has_multiple_cards": True},
                "summary": {"has_audioscience": True, "iommu_hazard": True, "slots_unpinned": True}
            }
            resp = client.get("/api/settings/alsa/diagnostics")
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertTrue(data["summary"]["iommu_hazard"])
            self.assertTrue(data["summary"]["slots_unpinned"])

    def test_status_endpoint_returns_system_and_service_uptimes(self):
        from starlette.testclient import TestClient
        from main import app
        client = TestClient(app)

        resp = client.get("/api/status")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("system_uptime_seconds", data)
        self.assertIn("service_uptime_seconds", data)
        self.assertIsInstance(data["system_uptime_seconds"], int)
        self.assertIsInstance(data["service_uptime_seconds"], int)
        self.assertGreaterEqual(data["system_uptime_seconds"], 0)
        self.assertGreaterEqual(data["service_uptime_seconds"], 0)


if __name__ == "__main__":
    unittest.main()
