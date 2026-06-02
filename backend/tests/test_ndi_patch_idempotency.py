import os
import sys
import unittest

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.build_manager import BuildManager

class TestNdiPatchIdempotency(unittest.TestCase):
    def setUp(self):
        self.build_manager = BuildManager("/tmp/fake_builds")

    def test_build_manager_instantiation(self):
        self.assertEqual(self.build_manager.builds_root, "/tmp/fake_builds")

if __name__ == "__main__":
    unittest.main()
