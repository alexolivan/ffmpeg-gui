import asyncio
import ctypes
import os
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from core.build_manager import BuildManager
from core.hw_probe import (
    detect_host_nvenc_api_version,
    detect_host_vaapi_render_node,
    parse_nvenc_api_tuple,
)
from forge.recipes.ffmpeg import FfmpegRecipe


class TestForgeHwValidation(unittest.TestCase):
    def test_parse_nvenc_api_tuple(self):
        self.assertEqual(parse_nvenc_api_tuple("n13.1.15.0"), (13, 1))
        self.assertEqual(parse_nvenc_api_tuple("n12.2.72.0"), (12, 2))
        self.assertEqual(parse_nvenc_api_tuple("12.2"), (12, 2))
        self.assertIsNone(parse_nvenc_api_tuple("auto"))
        self.assertIsNone(parse_nvenc_api_tuple("master"))
        self.assertIsNone(parse_nvenc_api_tuple(None))

    def test_detect_host_nvenc_api_version_decoding(self):
        def _make_fake_cdll(ver_val: int, rc: int = 0):
            def _fn(ptr):
                ptr._obj.value = ver_val
                return rc
            fake_lib = SimpleNamespace(NvEncodeAPIGetMaxSupportedVersion=_fn)
            return MagicMock(return_value=fake_lib)

        with patch("core.hw_probe.ctypes.CDLL", _make_fake_cdll((12 << 4) | 2)):
            self.assertEqual(detect_host_nvenc_api_version(), "12.2")

        with patch("core.hw_probe.ctypes.CDLL", _make_fake_cdll((13 << 4) | 1)):
            self.assertEqual(detect_host_nvenc_api_version(), "13.1")

        with patch("core.hw_probe.ctypes.CDLL", side_effect=OSError("missing lib")):
            self.assertIsNone(detect_host_nvenc_api_version())

    def test_detect_host_vaapi_render_node_filters_intel_and_amd(self):
        with tempfile.TemporaryDirectory() as tmp:
            # First node: NVIDIA vendor (ignored)
            n0 = os.path.join(tmp, "renderD128", "device")
            os.makedirs(n0)
            with open(os.path.join(n0, "vendor"), "w") as f:
                f.write("0x10de\n")

            # Second node: Intel vendor (detected)
            n1 = os.path.join(tmp, "renderD129", "device")
            os.makedirs(n1)
            with open(os.path.join(n1, "vendor"), "w") as f:
                f.write("0x8086\n")

            with patch("core.hw_probe.glob.glob", return_value=[os.path.join(tmp, "renderD128"), os.path.join(tmp, "renderD129")]):
                self.assertEqual(detect_host_vaapi_render_node(), "/dev/dri/renderD129")

            # AMD vendor
            with open(os.path.join(n1, "vendor"), "w") as f:
                f.write("0x1002\n")
            with patch("core.hw_probe.glob.glob", return_value=[os.path.join(tmp, "renderD129")]):
                self.assertEqual(detect_host_vaapi_render_node(), "/dev/dri/renderD129")

            # No Intel/AMD nodes
            with patch("core.hw_probe.glob.glob", return_value=[os.path.join(tmp, "renderD128")]):
                self.assertIsNone(detect_host_vaapi_render_node())

    def test_get_ffnvcodec_tag_clamps_to_host_api_ceiling(self):
        bm = BuildManager("/tmp/test_builds_root")
        self.assertEqual(bm.get_ffnvcodec_tag("n7.1", host_nvenc_api="12.2"), "n12.2.72.0")
        self.assertEqual(bm.get_ffnvcodec_tag("n7.1", host_nvenc_api="13.1"), "n13.0.19.0")
        self.assertEqual(bm.get_ffnvcodec_tag("n6.1", host_nvenc_api="12.0"), "n12.0.16.1")
        self.assertEqual(bm.get_ffnvcodec_tag("n7.1", host_nvenc_api=""), "n13.0.19.0")

    def test_smoke_tests_symmetrical_nvenc_and_vaapi_results(self):
        runner = SimpleNamespace(_get_command_output=AsyncMock(return_value="ffmpeg version 7.1"))
        recipe = FfmpegRecipe("/tmp/test_builds_root", runner=runner)

        with tempfile.NamedTemporaryFile() as fake_bin:
            # 1. Both succeed
            with (
                patch("forge.recipes.ffmpeg.shutil.which", return_value="/usr/bin/nvidia-smi"),
                patch("core.hw_probe.detect_host_nvenc_api_version", return_value="12.2"),
                patch("core.hw_probe.detect_host_vaapi_render_node", return_value="/dev/dri/renderD128"),
                patch.object(recipe, "_run_smoke_cmd", side_effect=[(0, ""), (0, "")]),
            ):
                res_ok = asyncio.run(recipe.validate(fake_bin.name, build_options={"nvenc": True, "vaapi": True}))
            self.assertTrue(res_ok["valid"])
            self.assertFalse(res_ok["has_warnings"])
            self.assertEqual([c["status"] for c in res_ok["hw_checks"]], ["ok", "ok"])
            self.assertEqual([c["engine"] for c in res_ok["hw_checks"]], ["nvenc", "vaapi"])

            # 2. Both fail -> valid True with has_warnings True & clear error messages
            with (
                patch("forge.recipes.ffmpeg.shutil.which", return_value="/usr/bin/nvidia-smi"),
                patch("core.hw_probe.detect_host_nvenc_api_version", return_value="12.2"),
                patch("core.hw_probe.detect_host_vaapi_render_node", return_value="/dev/dri/renderD128"),
                patch.object(
                    recipe,
                    "_run_smoke_cmd",
                    side_effect=[
                        (1, "Driver does not support the required nvenc API version. Required: 13.1 Found: 12.2"),
                        (1, "Failed to initialise VAAPI connection: -1 (unknown libva error)."),
                    ],
                ),
            ):
                res_warn = asyncio.run(recipe.validate(fake_bin.name, build_options={"nvenc": True, "vaapi": True}))
            self.assertTrue(res_warn["valid"])
            self.assertTrue(res_warn["has_warnings"])
            self.assertEqual([c["status"] for c in res_warn["hw_checks"]], ["warning", "warning"])
            self.assertIn("Required: 13.1 Found: 12.2", res_warn["hw_checks"][0]["message"])
            self.assertIn("VAAPI", res_warn["hw_checks"][1]["message"])

            # 3. Missing hardware -> skipped for both symmetrically
            with (
                patch("forge.recipes.ffmpeg.shutil.which", return_value=None),
                patch("forge.recipes.ffmpeg.os.path.exists", return_value=False),
                patch("core.hw_probe.detect_host_vaapi_render_node", return_value=None),
            ):
                res_skip = asyncio.run(recipe.validate(fake_bin.name, build_options={"nvenc": True, "vaapi": True}))
            self.assertTrue(res_skip["valid"])
            self.assertFalse(res_skip["has_warnings"])
            self.assertEqual([c["status"] for c in res_skip["hw_checks"]], ["skipped", "skipped"])

    def test_build_manager_validate_build_passes_options_and_handles_legacy_recipes(self):
        bm = BuildManager("/tmp/test_builds_root")
        with tempfile.NamedTemporaryFile() as fake_bin:
            mock_ffmpeg_recipe = MagicMock()
            mock_ffmpeg_recipe.validate = AsyncMock(return_value={"valid": True, "output": "ok", "hw_checks": [], "has_warnings": False})
            with patch("forge.recipes.get_recipe", return_value=mock_ffmpeg_recipe):
                res = asyncio.run(bm.validate_build(fake_bin.name, software_type="ffmpeg", build_options={"vaapi": True}))
            self.assertTrue(res["valid"])
            mock_ffmpeg_recipe.validate.assert_awaited_once_with(fake_bin.name, build_options={"vaapi": True})

            # Non-ffmpeg recipe whose validate only accepts (binary_path)
            class LegacyRecipe:
                async def validate(self, binary_path: str) -> dict:
                    return {"valid": True, "output": f"checked {binary_path}"}

            with patch("forge.recipes.get_recipe", return_value=LegacyRecipe()):
                res2 = asyncio.run(bm.validate_build(fake_bin.name, software_type="icecast2", build_options={"vaapi": True}))
            self.assertTrue(res2["valid"])
            self.assertIn(fake_bin.name, res2["output"])


if __name__ == "__main__":
    unittest.main()
