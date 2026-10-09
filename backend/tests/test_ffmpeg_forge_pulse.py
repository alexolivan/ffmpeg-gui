import unittest
import os
import shutil
import tempfile
from unittest.mock import AsyncMock, MagicMock, patch

from forge.recipes import get_recipe
from forge.recipes.ffmpeg import FfmpegRecipe
from core.build_manager import BuildManager


class TestFfmpegForgePulse(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.builds_root = os.path.join(self.test_dir, "builds")
        self.runner = MagicMock()
        self.runner.get_src_path = lambda bid: os.path.join(self.builds_root, str(bid), "src")
        self.runner.get_install_path = lambda bid: os.path.join(self.builds_root, str(bid), "install")
        self.runner._run_logged_cmd = AsyncMock(return_value=0)
        self.runner._get_command_output = AsyncMock(return_value="ffmpeg version 7.1\n")
        self.runner.FFMPEG_GIT_URL = "https://git.ffmpeg.org/ffmpeg.git"
        self.runner.check_dependencies = MagicMock(return_value={
            "dependencies": {
                "libpulse": {"installed": True, "type": "required"},
                "libasound2": {"installed": True, "type": "required"}
            }
        })

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_ffmpeg_recipe_dependencies_include_libpulse_and_libasound(self):
        recipe = get_recipe("ffmpeg", self.builds_root, self.runner)
        self.assertIsInstance(recipe, FfmpegRecipe)
        deps = recipe.get_dependencies()
        self.assertIn("libpulse", deps)
        self.assertIn("libasound2", deps)

    def test_build_manager_ffmpeg_deps_include_libpulse(self):
        bm = BuildManager(self.builds_root)
        results = bm.check_dependencies(software_type="ffmpeg")
        deps = results["dependencies"]
        self.assertIn("libpulse", deps)
        self.assertEqual(deps["libpulse"]["type"], "required")
        self.assertIn("libasound2", deps)
        self.assertEqual(deps["libasound2"]["type"], "required")

    async def test_ffmpeg_recipe_compile_adds_enable_libpulse_flag(self):
        recipe = FfmpegRecipe(self.builds_root, self.runner)
        log_mock = AsyncMock()
        install_path = os.path.join(self.builds_root, "1", "install")

        # Fake creation of ffmpeg binary during install
        async def fake_run_logged_cmd(cmd, callback, cwd=None, env=None):
            if any("make" in str(arg) for arg in cmd) and "install" in cmd:
                bin_dir = os.path.join(install_path, "bin")
                os.makedirs(bin_dir, exist_ok=True)
                fake_bin = os.path.join(bin_dir, "ffmpeg")
                with open(fake_bin, "w") as f:
                    f.write("#!/bin/sh\necho ffmpeg 7.1\n")
                os.chmod(fake_bin, 0o755)
            return 0

        self.runner._run_logged_cmd.side_effect = fake_run_logged_cmd

        options = {}
        res = await recipe.compile(
            build_id=1,
            version_tag="n7.1",
            options=options,
            sdk_paths=None,
            install_path=install_path,
            log_callback=log_mock
        )

        self.assertTrue(res["success"])
        self.assertTrue(options.get("libpulse"))

        # Check configure command arguments
        configure_calls = [
            c[0][0] for c in self.runner._run_logged_cmd.call_args_list
            if len(c[0]) > 0 and isinstance(c[0][0], list) and any("./configure" in str(arg) for arg in c[0][0])
        ]
        self.assertTrue(len(configure_calls) > 0)
        configure_cmd = configure_calls[0]
        self.assertIn("--enable-libpulse", configure_cmd)


if __name__ == "__main__":
    unittest.main()
