import unittest
import os
import shutil
import tempfile
from unittest.mock import AsyncMock, MagicMock, patch
from forge.recipes import get_recipe
from forge.recipes.icecast2 import IcecastRecipe
from core.build_manager import BuildManager
from core.software_manager import SoftwareManager

class TestIcecastForgeAndSoftware(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.builds_root = os.path.join(self.test_dir, "builds")
        self.runner = MagicMock()
        self.runner.get_src_path = lambda bid: os.path.join(self.builds_root, str(bid), "src")
        self.runner.get_install_path = lambda bid: os.path.join(self.builds_root, str(bid), "install")
        self.runner._run_logged_cmd = AsyncMock(return_value=0)

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_icecast_recipe_registration_and_dependencies(self):
        recipe = get_recipe("icecast2", self.builds_root, self.runner)
        self.assertIsInstance(recipe, IcecastRecipe)
        self.assertEqual(recipe.software_type, "icecast2")
        deps = recipe.get_dependencies()
        self.assertIn("libssl-dev", deps)
        self.assertIn("libxml2-dev", deps)
        self.assertIn("libxslt1-dev", deps)
        self.assertIn("libvorbis-dev", deps)
        self.assertIn("libogg-dev", deps)
        self.assertIn("libigloo-dev", deps)
        self.assertIn("librhash-dev", deps)

    async def test_icecast_recipe_auto_builds_libigloo_when_missing(self):
        recipe = IcecastRecipe(self.builds_root, self.runner)
        log_mock = AsyncMock()
        
        # When system igloo is missing, recipe should download and compile libigloo
        with patch("subprocess.run", side_effect=Exception("not found")):
            res = await recipe.compile(
                build_id=1,
                version_tag="2.5.0",
                options={},
                sdk_paths=None,
                install_path=os.path.join(self.builds_root, "1", "install"),
                log_callback=log_mock
            )
            self.assertTrue(res["success"])
            # Verify libigloo commands were logged
            log_calls = [c[0][0] for c in log_mock.call_args_list if c[0]]
            self.assertTrue(any("libigloo" in str(line) for line in log_calls))

    async def test_icecast_recipe_validate_executes_version(self):
        recipe = IcecastRecipe(self.builds_root, self.runner)
        fake_bin = os.path.join(self.test_dir, "bin", "icecast")
        os.makedirs(os.path.dirname(fake_bin), exist_ok=True)
        with open(fake_bin, "w") as f:
            f.write("#!/bin/sh\necho 'Icecast 2.5.0'")
        os.chmod(fake_bin, 0o755)

        self.runner._get_command_output = AsyncMock(return_value="Icecast 2.5.0\nCompile time flags: ...\nDependencies:\n libigloo")
        res = await recipe.validate(fake_bin)
        self.assertTrue(res["valid"])
        self.assertIn("Icecast 2.5.0", res["output"])
        self.runner._get_command_output.assert_called_once()
        called_cmd = self.runner._get_command_output.call_args[0][0]
        self.assertEqual(called_cmd, [fake_bin, "-V"])

    def test_build_manager_checks_libxml2_and_libxslt(self):
        bm = BuildManager(self.builds_root)
        results = bm.check_dependencies()
        deps = results.get("dependencies", {})
        self.assertIn("libxml2", deps)
        self.assertIn("libxslt", deps)
        self.assertEqual(deps["libxml2"]["type"], "optional")
        self.assertEqual(deps["libxslt"]["type"], "optional")

    def test_build_manager_checks_dependencies_per_software_type(self):
        bm = BuildManager(self.builds_root)
        
        # Test Icecast2 dependencies: NO video codecs, YES XML/XSLT/SSL/RHASH
        ice_results = bm.check_dependencies(software_type="icecast2")
        ice_deps = ice_results.get("dependencies", {})
        self.assertEqual(ice_results.get("software_type"), "icecast2")
        self.assertIn("libxml2", ice_deps)
        self.assertEqual(ice_deps["libxml2"]["type"], "required")
        self.assertIn("libxslt", ice_deps)
        self.assertEqual(ice_deps["libxslt"]["type"], "required")
        self.assertIn("librhash", ice_deps)
        self.assertEqual(ice_deps["librhash"]["type"], "required")
        self.assertIn("libssl", ice_deps)
        self.assertIn("gcc", ice_deps)
        self.assertIn("make", ice_deps)
        self.assertNotIn("libx264", ice_deps)
        self.assertNotIn("libx265", ice_deps)
        self.assertNotIn("yasm/nasm", ice_deps)
        self.assertNotIn("vainfo", ice_deps)
        self.assertNotIn("clang", ice_deps)

        # Test DeckLink Tools dependencies: only gcc/g++ and make
        dl_results = bm.check_dependencies(software_type="decklink_tools")
        dl_deps = dl_results.get("dependencies", {})
        self.assertIn("gcc", dl_deps)
        self.assertIn("make", dl_deps)
        self.assertNotIn("libx264", dl_deps)
        self.assertNotIn("libxml2", dl_deps)
        self.assertNotIn("libssl", dl_deps)

    async def test_tag_normalization_in_fetch_available_tags(self):
        bm = BuildManager(self.builds_root)
        fake_stdout = b"hash1\trefs/tags/icecast-2.5.0\nhash2\trefs/tags/icecast-2.4.4\nhash3\trefs/tags/icecast-2.4.4^{}\n"
        
        with patch("asyncio.create_subprocess_exec") as mock_exec:
            mock_proc = MagicMock()
            mock_proc.communicate = AsyncMock(return_value=(fake_stdout, b""))
            mock_exec.return_value = mock_proc

            tags = await bm.fetch_available_tags("https://gitlab.xiph.org/xiph/icecast-server.git")
            self.assertEqual(tags, ["2.5.0", "2.4.4"])

    def test_software_manager_detects_icecast2_or_icecast(self):
        sm = SoftwareManager()
        with patch("shutil.which") as mock_which, patch("os.path.isfile", return_value=True):
            # Case 1: Only /usr/bin/icecast exists (not icecast2)
            mock_which.side_effect = lambda bin_name: "/usr/bin/icecast" if bin_name == "icecast" else None
            with patch("subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(stdout="Icecast 2.5.0\n", stderr="", returncode=0)
                audit = sm.audit_system_binary("icecast2")
                self.assertTrue(audit["found"])
                self.assertEqual(audit["path"], "/usr/bin/icecast")
                self.assertEqual(audit["version"], "2.5.0")

            # Case 2: Standard /usr/bin/icecast2 exists
            mock_which.side_effect = lambda bin_name: "/usr/bin/icecast2" if bin_name == "icecast2" else None
            with patch("subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(stdout="Icecast 2.4.4\n", stderr="", returncode=0)
                audit = sm.audit_system_binary("icecast2")
                self.assertTrue(audit["found"])
                self.assertEqual(audit["path"], "/usr/bin/icecast2")
                self.assertEqual(audit["version"], "2.4.4")

if __name__ == "__main__":
    unittest.main()
