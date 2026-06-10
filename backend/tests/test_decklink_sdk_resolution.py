import os
import sys
import shutil
import unittest
import tempfile
import zipfile

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.sdk_manager import SdkManager

class TestDeckLinkSdkResolution(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.sdk_manager = SdkManager(self.temp_dir)
        
        # Create fake extraction directory
        self.extract_dir = os.path.join(self.temp_dir, "extract_decklink")
        os.makedirs(self.extract_dir, exist_ok=True)
        
        # Create macOS SDK structures
        mac_include = os.path.join(self.extract_dir, "Mac", "include")
        os.makedirs(mac_include, exist_ok=True)
        with open(os.path.join(mac_include, "DeckLinkAPI.h"), "w") as f:
            f.write("#include <CoreFoundation/CoreFoundation.h>\n// macOS Header\n")
            
        # Create Linux SDK structures
        linux_include = os.path.join(self.extract_dir, "Linux", "include")
        os.makedirs(linux_include, exist_ok=True)
        with open(os.path.join(linux_include, "DeckLinkAPI.h"), "w") as f:
            f.write("// Linux Header\n")
        with open(os.path.join(linux_include, "DeckLinkAPIVersion.h"), "w") as f:
            f.write("#define BLACKMAGIC_DECKLINK_API_VERSION 0x0c040000\n")

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_clean_non_linux_dirs_removes_mac_folder(self):
        # Verify Mac directory initially exists
        mac_path = os.path.join(self.extract_dir, "Mac")
        self.assertTrue(os.path.exists(mac_path))
        
        # Run cleanup
        self.sdk_manager._clean_non_linux_dirs(self.extract_dir)
        
        # Verify Mac directory is removed, but Linux remains
        self.assertFalse(os.path.exists(mac_path))
        self.assertTrue(os.path.exists(os.path.join(self.extract_dir, "Linux")))

    def test_find_file_recursively_prioritizes_linux(self):
        # We search with both Mac and Linux present (without cleaning)
        header_file = self.sdk_manager._find_file_recursively(self.extract_dir, "DeckLinkAPI.h")
        self.assertIsNotNone(header_file)
        self.assertIn("Linux", header_file)

    def test_handle_decklink_sdk_with_multiplatform_archive(self):
        # Mock packaging the mock structure into a zip file
        zip_path = os.path.join(self.temp_dir, "Blackmagic_DeckLink_SDK_16.0.zip")
        with zipfile.ZipFile(zip_path, 'w') as zip_ref:
            # Add macOS files
            zip_ref.writestr("Mac/include/DeckLinkAPI.h", "#include <CoreFoundation/CoreFoundation.h>\n")
            # Add Linux files
            zip_ref.writestr("Linux/include/DeckLinkAPI.h", "// Linux Header\n")
            zip_ref.writestr("Linux/include/DeckLinkAPIVersion.h", "#define BLACKMAGIC_DECKLINK_API_VERSION 0x0c040000\n")

        # Process the zip upload
        result = self.sdk_manager.process_sdk_upload(zip_path, "Blackmagic_DeckLink_SDK_16.0.zip", "decklink")
        self.assertTrue(result["success"], f"Failed to process SDK: {result.get('error')}")
        self.assertEqual(result["version"], "12.4") # parsed from 0x0c040000

        # Check copied headers in target
        target_include = os.path.join(result["path"], "include")
        copied_header = os.path.join(target_include, "DeckLinkAPI.h")
        self.assertTrue(os.path.exists(copied_header))
        
        with open(copied_header, "r") as f:
            content = f.read()
            self.assertNotIn("CoreFoundation", content)
            self.assertIn("Linux Header", content)

if __name__ == "__main__":
    unittest.main()
