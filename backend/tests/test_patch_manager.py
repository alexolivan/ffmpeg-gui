import os
import unittest
import shutil
from core.patch_manager import PatchManager

class TestPatchManager(unittest.TestCase):
    
    def setUp(self):
        # We test against the real workspace but we will clean up any test-uploaded patches
        self.patch_manager = PatchManager(workspace_root=".")
        self.test_filenames = []

    def tearDown(self):
        # Clean up any files uploaded during tests
        for filename in self.test_filenames:
            self.patch_manager.delete_patch(filename)

    def test_list_patches_includes_system_patches(self):
        patches = self.patch_manager.list_patches()
        self.assertGreaterEqual(len(patches), 2)
        
        system_filenames = [p["filename"] for p in patches if p["source"] == "system"]
        self.assertIn("system_ffmpeg_7.patch", system_filenames)
        self.assertIn("system_ffmpeg_6.patch", system_filenames)

    def test_upload_patch_success(self):
        file_content = b"diff --git a/test b/test\n+content"
        original_filename = "custom-test-patch.patch"
        display_name = "Custom NDI Patch for Testing"
        ffmpeg_version_major = "7"
        
        result = self.patch_manager.upload_patch(
            file_content=file_content,
            original_filename=original_filename,
            display_name=display_name,
            ffmpeg_version_major=ffmpeg_version_major
        )
        
        self.assertTrue(result["success"])
        patch_info = result["patch"]
        self.assertEqual(patch_info["display_name"], display_name)
        self.assertEqual(patch_info["ffmpeg_version_major"], ffmpeg_version_major)
        self.assertEqual(patch_info["source"], "user")
        self.assertTrue(patch_info["filename"].startswith("user_custom-test-patch_"))
        
        # Track for cleanup
        self.test_filenames.append(patch_info["filename"])
        
        # Check it exists in list
        patches = self.patch_manager.list_patches()
        user_patches = [p for p in patches if p["filename"] == patch_info["filename"]]
        self.assertEqual(len(user_patches), 1)
        self.assertEqual(user_patches[0]["display_name"], display_name)

    def test_delete_system_patch_forbidden(self):
        result = self.patch_manager.delete_patch("system_ffmpeg_7.patch")
        self.assertFalse(result["success"])
        self.assertIn("Cannot delete system patches", result["error"])

    def test_delete_patch_success(self):
        file_content = b"diff --git a/test b/test\n+content"
        result = self.patch_manager.upload_patch(
            file_content=file_content,
            original_filename="to-delete.patch",
            display_name="ToDelete",
            ffmpeg_version_major="6"
        )
        
        self.assertTrue(result["success"])
        filename = result["patch"]["filename"]
        
        # Now delete it
        del_result = self.patch_manager.delete_patch(filename)
        self.assertTrue(del_result["success"])
        
        # Check it no longer exists
        patches = self.patch_manager.list_patches()
        self.assertFalse(any(p["filename"] == filename for p in patches))
