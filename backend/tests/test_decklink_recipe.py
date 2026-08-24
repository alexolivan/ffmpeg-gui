import unittest
import os
import shutil
import tempfile
import asyncio
from unittest.mock import AsyncMock, MagicMock
from backend.forge.recipes import get_recipe
from backend.forge.recipes.decklink_tools import DecklinkToolsRecipe


class TestDecklinkRecipe(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.builds_root = os.path.join(self.test_dir, "builds")
        self.runner = MagicMock()
        self.runner.get_src_path = lambda bid: os.path.join(self.builds_root, str(bid), "src")
        self.runner.get_install_path = lambda bid: os.path.join(self.builds_root, str(bid), "install")
        self.runner._run_logged_cmd = AsyncMock(return_value=0)

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_recipe_registration(self):
        recipe = get_recipe("decklink_tools", self.builds_root, self.runner)
        self.assertIsInstance(recipe, DecklinkToolsRecipe)
        self.assertEqual(recipe.software_type, "decklink_tools")
        self.assertIn("decklink", recipe.supported_sdk_types)
        self.assertEqual(recipe.get_dependencies(), ["g++", "make"])

    async def test_compile_fails_without_sdk(self):
        recipe = DecklinkToolsRecipe(self.builds_root, self.runner)
        logs = []
        async def log_cb(msg): logs.append(msg)

        install_path = os.path.join(self.builds_root, "1", "install")
        res = await recipe.compile(
            build_id=1,
            version_tag="1.0.0",
            options={},
            sdk_paths=None,
            install_path=install_path,
            log_callback=log_cb
        )
        self.assertFalse(res["success"])
        self.assertIn("No se encontró el SDK", res["error"])

    async def test_compile_success_with_mock_sdk(self):
        # Create mock SDK directory
        mock_sdk_include = os.path.join(self.test_dir, "mock_sdk", "include")
        os.makedirs(mock_sdk_include, exist_ok=True)
        with open(os.path.join(mock_sdk_include, "DeckLinkAPI.h"), "w") as f:
            f.write("// mock header\n")
        with open(os.path.join(mock_sdk_include, "DeckLinkAPIDispatch.cpp"), "w") as f:
            f.write("// mock dispatch\n")

        recipe = DecklinkToolsRecipe(self.builds_root, self.runner)
        logs = []
        async def log_cb(msg): logs.append(msg)

        install_path = os.path.join(self.builds_root, "2", "install")
        os.makedirs(install_path, exist_ok=True)

        # Mock binary creation during g++ execution
        async def fake_run_cmd(cmd, log_cb, cwd=None):
            # Create dummy binary
            with open(os.path.join(install_path, "decklink-ctl"), "w") as f:
                f.write("#!/bin/sh\necho mock\n")
            return 0

        self.runner._run_logged_cmd = AsyncMock(side_effect=fake_run_cmd)

        res = await recipe.compile(
            build_id=2,
            version_tag="1.0.0",
            options={},
            sdk_paths={"decklink": os.path.join(self.test_dir, "mock_sdk")},
            install_path=install_path,
            log_callback=log_cb
        )

        self.assertTrue(res["success"])
        self.assertIsNotNone(res["binary_path"])
        self.assertTrue(os.path.exists(res["binary_path"]))


if __name__ == "__main__":
    unittest.main()
