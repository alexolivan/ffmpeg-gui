import os
import subprocess
import sys
import unittest

class TestDbCli(unittest.TestCase):
    def setUp(self):
        self.repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        self.script_path = os.path.join(self.repo_root, "scripts", "db_cli.py")
        self.python_bin = sys.executable

    def test_db_cli_path_only(self):
        res = subprocess.run([self.python_bin, self.script_path, "--path-only"], capture_output=True, text=True)
        self.assertEqual(res.returncode, 0)
        self.assertTrue(res.stdout.strip().endswith(".db"))

    def test_db_cli_tables(self):
        res = subprocess.run([self.python_bin, self.script_path, "--tables"], capture_output=True, text=True)
        self.assertEqual(res.returncode, 0)
        self.assertIn("storages", res.stdout)
        self.assertIn("Table Name", res.stdout)

    def test_db_cli_custom_query(self):
        res = subprocess.run(
            [self.python_bin, self.script_path, "SELECT name, type FROM storages WHERE type='preview'"],
            capture_output=True,
            text=True
        )
        self.assertEqual(res.returncode, 0)
        self.assertIn("Default Preview Storage", res.stdout)
    def test_db_cli_services(self):
        res = subprocess.run([self.python_bin, self.script_path, "--services"], capture_output=True, text=True)
        self.assertEqual(res.returncode, 0)
        self.assertIn("service_type", res.stdout)
        self.assertIn("watchdog", res.stdout)

if __name__ == "__main__":
    unittest.main()
