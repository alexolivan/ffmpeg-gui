import os
import sys
import shutil
import unittest
import tempfile

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.sdk_manager import SdkManager

class TestNdiSdkArchitecture(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.sdk_manager = SdkManager(self.temp_dir)
        
        # Create fake extraction directory
        self.extract_dir = os.path.join(self.temp_dir, "extract_ndi")
        os.makedirs(self.extract_dir, exist_ok=True)
        
        # Create include directory with a dummy header
        include_dir = os.path.join(self.extract_dir, "include")
        os.makedirs(include_dir, exist_ok=True)
        with open(os.path.join(include_dir, "Processing.NDI.Lib.h"), "w") as f:
            f.write("// Fake NDI header\n")

        # Create multiple architectures
        # 1. 32-bit architecture library (alphabetically first path)
        self.lib32_dir = os.path.join(self.extract_dir, "lib", "i686-linux-gnu")
        os.makedirs(self.lib32_dir, exist_ok=True)
        self.lib32_file = os.path.join(self.lib32_dir, "libndi.so.6.3.2")
        with open(self.lib32_file, "wb") as f:
            # ELF magic with EI_CLASS = 1 (32-bit)
            f.write(b"\x7fELF\x01" + b"\x00" * 60)
        os.symlink("libndi.so.6.3.2", os.path.join(self.lib32_dir, "libndi.so"))

        # 2. 64-bit architecture library
        self.lib64_dir = os.path.join(self.extract_dir, "lib", "x86_64-linux-gnu")
        os.makedirs(self.lib64_dir, exist_ok=True)
        self.lib64_file = os.path.join(self.lib64_dir, "libndi.so.6.3.2")
        with open(self.lib64_file, "wb") as f:
            # ELF magic with EI_CLASS = 2 (64-bit), and e_machine = 0x3e (x86_64)
            header = bytearray(b"\x7fELF\x02" + b"\x00" * 60)
            header[18] = 0x3e
            f.write(header)
        os.symlink("libndi.so.6.3.2", os.path.join(self.lib64_dir, "libndi.so"))

        # 3. ARM aarch64 architecture library (64-bit ELF, e_machine = 0xb7)
        self.libarm_dir = os.path.join(self.extract_dir, "lib", "aarch64-linux-gnu")
        os.makedirs(self.libarm_dir, exist_ok=True)
        self.libarm_file = os.path.join(self.libarm_dir, "libndi.so.6.3.2")
        with open(self.libarm_file, "wb") as f:
            # ELF magic with EI_CLASS = 2 (64-bit), and e_machine = 0xb7 (aarch64)
            header = bytearray(b"\x7fELF\x02" + b"\x00" * 60)
            header[18] = 0xb7
            f.write(header)
        os.symlink("libndi.so.6.3.2", os.path.join(self.libarm_dir, "libndi.so"))

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_handle_ndi_sdk_selects_64bit(self):
        from unittest.mock import patch
        
        # Save original os.walk
        real_walk = os.walk
        
        # Mock walk to always return aarch64 before x86_64
        def mock_walk(top, topdown=True, onerror=None, followlinks=False):
            walk_results = list(real_walk(top, topdown, onerror, followlinks))
            # Sort walk results so that aarch64 is visited first, then i686, then x86_64
            def sort_key(item):
                dirpath = item[0]
                if "aarch64" in dirpath:
                    return 0
                if "i686" in dirpath:
                    return 1
                if "x86_64" in dirpath:
                    return 2
                return 3
            walk_results.sort(key=sort_key)
            return walk_results

        with patch("os.walk", side_effect=mock_walk):
            # Run SdkManager's handle logic
            result = self.sdk_manager._handle_ndi_sdk(self.extract_dir, "1.0.0")
            self.assertTrue(result["success"], f"SDK handling failed: {result.get('error')}")
            
            # Check which library got copied
            installed_lib_dir = os.path.join(result["path"], "lib", "x86_64-linux-gnu")
            target_lib = os.path.join(installed_lib_dir, "libndi.so.6.3.2")
            
            self.assertTrue(os.path.exists(target_lib))
            with open(target_lib, "rb") as f:
                content = f.read(20)
                self.assertEqual(content[4], 2, "Should have copied a 64-bit version of the NDI library")
                self.assertEqual(content[18], 0x3e, "Should have copied the Intel/AMD x86_64 version of the NDI library")

if __name__ == "__main__":
    unittest.main()
