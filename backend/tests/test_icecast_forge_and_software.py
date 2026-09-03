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

    def test_build_manager_checks_libxml2_and_libxslt(self):
        bm = BuildManager(self.builds_root)
        results = bm.check_dependencies()
        deps = results.get("dependencies", {})
        self.assertIn("libxml2", deps)
        self.assertIn("libxslt", deps)
        self.assertEqual(deps["libxml2"]["type"], "optional")
        self.assertEqual(deps["libxslt"]["type"], "optional")

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
