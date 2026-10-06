import unittest
import os
import shutil
import tempfile
from unittest.mock import AsyncMock, MagicMock

from forge.recipes import get_recipe
from forge.recipes.pipewire import PipeWireRecipe
from core.build_manager import BuildManager


class TestPipewireForge(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.builds_root = os.path.join(self.test_dir, "builds")
        self.runner = MagicMock()
        self.runner.get_src_path = lambda bid: os.path.join(self.builds_root, str(bid), "src")
        self.runner.get_install_path = lambda bid: os.path.join(self.builds_root, str(bid), "install")
        self.runner._run_logged_cmd = AsyncMock(return_value=0)
        self.runner._get_command_output = AsyncMock(return_value="Compiled with libpipewire 1.6.9\n")

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_pipewire_recipe_registration_and_dependencies(self):
        recipe = get_recipe("pipewire", self.builds_root, self.runner)
        self.assertIsInstance(recipe, PipeWireRecipe)
        self.assertEqual(recipe.software_type, "pipewire")

        deps = recipe.get_dependencies()
        expected_deps = [
            "git",
            "meson",
            "ninja-build",
            "pkg-config",
            "gcc",
            "libasound2-dev",
            "libdbus-1-dev",
            "libudev-dev"
        ]
        for dep in expected_deps:
            self.assertIn(dep, deps)

    async def test_pipewire_recipe_compilation_workflow(self):
        recipe = PipeWireRecipe(self.builds_root, self.runner)
        log_mock = AsyncMock()
        install_path = os.path.join(self.builds_root, "1", "install")

        # Fake creation of pipewire binary during ninja install
        async def fake_run_logged_cmd(cmd, callback, cwd=None):
            if any("ninja" in str(arg) for arg in cmd):
                bin_dir = os.path.join(install_path, "bin")
                os.makedirs(bin_dir, exist_ok=True)
                fake_bin = os.path.join(bin_dir, "pipewire")
                with open(fake_bin, "w") as f:
                    f.write("#!/bin/sh\necho pipewire 1.6.9\n")
                os.chmod(fake_bin, 0o755)
            return 0

        self.runner._run_logged_cmd.side_effect = fake_run_logged_cmd

        res = await recipe.compile(
            build_id=1,
            version_tag="1.6.9",
            options={},
            sdk_paths=None,
            install_path=install_path,
            log_callback=log_mock
        )

        self.assertTrue(res["success"])
        self.assertIsNotNone(res["binary_path"])
        self.assertIn("1.6.9", res["version_output"])

        # Verify command invocations
        cmd_calls = [c[0][0] for c in self.runner._run_logged_cmd.call_args_list]
        self.assertTrue(any("git" in c[0] and "clone" in c for c in cmd_calls))
        self.assertTrue(any("meson" in c[0] and "setup" in c for c in cmd_calls))
        self.assertTrue(any(any("ninja" in str(arg) for arg in c) and "install" in c for c in cmd_calls))

    async def test_pipewire_recipe_compilation_failure_missing_binary(self):
        recipe = PipeWireRecipe(self.builds_root, self.runner)
        log_mock = AsyncMock()
        install_path = os.path.join(self.builds_root, "1", "install")

        # Do not create binary during fake command run
        self.runner._run_logged_cmd.side_effect = AsyncMock(return_value=0)

        res = await recipe.compile(
            build_id=1,
            version_tag="1.6.9",
            options={},
            sdk_paths=None,
            install_path=install_path,
            log_callback=log_mock
        )

        self.assertFalse(res["success"])
        self.assertIsNone(res["binary_path"])
        self.assertIn("PipeWire binary not found", res["error"])

    async def test_pipewire_recipe_validation(self):
        recipe = PipeWireRecipe(self.builds_root, self.runner)

        # Invalid path
        invalid_res = await recipe.validate("/non/existent/path/pipewire")
        self.assertFalse(invalid_res["valid"])
        self.assertIn("Binary not found", invalid_res["error"])

        # Valid mock path
        bin_dir = os.path.join(self.builds_root, "1", "install", "bin")
        os.makedirs(bin_dir, exist_ok=True)
        fake_bin = os.path.join(bin_dir, "pipewire")
        with open(fake_bin, "w") as f:
            f.write("#!/bin/sh\n")

        valid_res = await recipe.validate(fake_bin)
        self.assertTrue(valid_res["valid"])
        self.assertIn("Compiled with libpipewire", valid_res["output"])

    def test_build_manager_dependency_check_for_pipewire(self):
        bm = BuildManager(self.builds_root)
        check = bm.check_dependencies(software_type="pipewire")

        deps = check["dependencies"]
        # Required core tools
        self.assertIn("meson", deps)
        self.assertIn("ninja", deps)
        self.assertIn("gcc", deps)
        self.assertIn("pkg-config", deps)
        self.assertIn("git", deps)

        # PipeWire libraries
        self.assertIn("libasound2", deps)
        self.assertIn("libdbus-1", deps)
        self.assertIn("libudev", deps)

        # Should not include unrelated software deps
        self.assertNotIn("cmake", deps)
        self.assertNotIn("libx264", deps)
        self.assertNotIn("libvorbis", deps)
        self.assertNotIn("curl", deps)


if __name__ == "__main__":
    unittest.main()
