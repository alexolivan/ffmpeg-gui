import os
import sys
import unittest

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.build_manager import BuildManager

class TestFfnvcodecCompatibility(unittest.TestCase):
    def setUp(self):
        self.build_manager = BuildManager("/tmp/ffmpeg-gui-test-builds")

    def test_get_ffnvcodec_tag_ffmpeg_versions(self):
        # FFmpeg 6.x -> n12.1.14.0
        self.assertEqual(self.build_manager.get_ffnvcodec_tag("6.0"), "n12.1.14.0")
        self.assertEqual(self.build_manager.get_ffnvcodec_tag("6.1.1"), "n12.1.14.0")

        # FFmpeg 5.x -> n11.1.5.3
        self.assertEqual(self.build_manager.get_ffnvcodec_tag("5.1"), "n11.1.5.3")
        self.assertEqual(self.build_manager.get_ffnvcodec_tag("5.0.2"), "n11.1.5.3")

        # FFmpeg 4.x or lower -> n9.1.23.2
        self.assertEqual(self.build_manager.get_ffnvcodec_tag("4.4"), "n9.1.23.2")
        self.assertEqual(self.build_manager.get_ffnvcodec_tag("3.2"), "n9.1.23.2")

        # FFmpeg 7.x or master -> None (latest)
        self.assertIsNone(self.build_manager.get_ffnvcodec_tag("7.0"))
        self.assertIsNone(self.build_manager.get_ffnvcodec_tag("7.1-dev"))
        self.assertIsNone(self.build_manager.get_ffnvcodec_tag("master"))
        self.assertIsNone(self.build_manager.get_ffnvcodec_tag("git-2023-04-12"))
        
        # Invalid / Empty version -> None
        self.assertIsNone(self.build_manager.get_ffnvcodec_tag(""))
        self.assertIsNone(self.build_manager.get_ffnvcodec_tag(None))

if __name__ == "__main__":
    unittest.main()
