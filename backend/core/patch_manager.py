import os
import json
import time
import logging
from typing import List, Dict, Optional

logger = logging.getLogger("PatchManager")

class PatchManager:
    """Manages local compilation patches for FFmpeg (like NewTek NDI integration).
    
    Supports listing, uploading, and deleting patch files along with metadata JSON files.
    Differentiates between read-only system patches and user-uploaded patches.
    """
    
    def __init__(self, workspace_root: str):
        self.workspace_root = os.path.abspath(workspace_root)
        self.system_patches_dir = os.path.join(self.workspace_root, "backend", "patches")
        self.user_patches_dir = os.path.join(self.workspace_root, "backend", "data", "patches")
        
        os.makedirs(self.system_patches_dir, exist_ok=True)
        os.makedirs(self.user_patches_dir, exist_ok=True)

    def _scan_directory(self, directory: str, default_source: str) -> List[Dict[str, str]]:
        """Scan a directory for metadata JSON files and return the corresponding patches."""
        patches = []
        if not os.path.exists(directory):
            return []
            
        for file in os.listdir(directory):
            if not file.endswith(".json"):
                continue
                
            metadata_path = os.path.join(directory, file)
            try:
                with open(metadata_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                
                patch_filename = meta.get("filename")
                if patch_filename and os.path.exists(os.path.join(directory, patch_filename)):
                    patches.append({
                        "filename": patch_filename,
                        "display_name": meta.get("display_name", patch_filename),
                        "ffmpeg_version_major": meta.get("ffmpeg_version_major", "any"),
                        "source": meta.get("source", default_source)
                    })
            except Exception as e:
                logger.warning(f"Error reading patch metadata {file} in {directory}: {e}")
        return patches

    def list_patches(self) -> List[Dict[str, str]]:
        """List all available patches, both system-embedded and user-uploaded."""
        system_patches = self._scan_directory(self.system_patches_dir, "system")
        user_patches = self._scan_directory(self.user_patches_dir, "user")
        
        all_patches = system_patches + user_patches
        # Sort system patches first, then user patches, then alphabetically by display name
        all_patches.sort(key=lambda x: (0 if x["source"] == "system" else 1, x["display_name"].lower()))
        return all_patches

    def upload_patch(self, file_content: bytes, original_filename: str, display_name: str, ffmpeg_version_major: str) -> Dict[str, any]:
        """Save a new user-uploaded patch and generate its metadata JSON file in the user patches directory."""
        if not original_filename.endswith((".patch", ".diff")):
            return {"success": False, "error": "Invalid file extension. Only .patch and .diff are supported."}
            
        # Clean and create a unique name to prevent collisions
        timestamp = int(time.time())
        clean_name = "".join([c if c.isalnum() or c in "-_" else "_" for c in os.path.splitext(original_filename)[0]])
        unique_base = f"user_{clean_name}_{timestamp}"
        patch_filename = f"{unique_base}.patch"
        meta_filename = f"{unique_base}.json"
        
        patch_path = os.path.join(self.user_patches_dir, patch_filename)
        meta_path = os.path.join(self.user_patches_dir, meta_filename)
        
        try:
            # 1. Write the patch file
            with open(patch_path, "wb") as f:
                f.write(file_content)
                
            # 2. Write metadata JSON
            metadata = {
                "display_name": display_name or original_filename,
                "ffmpeg_version_major": ffmpeg_version_major or "any",
                "filename": patch_filename,
                "source": "user"
            }
            with open(meta_path, "w", encoding="utf-8") as f:
                json.dump(metadata, f, indent=2)
                
            return {
                "success": True,
                "patch": {
                    "filename": patch_filename,
                    "display_name": metadata["display_name"],
                    "ffmpeg_version_major": metadata["ffmpeg_version_major"],
                    "source": "user"
                }
            }
        except Exception as e:
            logger.error(f"Failed to upload patch {original_filename}: {e}")
            # Cleanup on failure
            if os.path.exists(patch_path):
                os.remove(patch_path)
            if os.path.exists(meta_path):
                os.remove(meta_path)
            return {"success": False, "error": str(e)}

    def delete_patch(self, filename: str) -> Dict[str, any]:
        """Delete a user patch. Embedded system patches cannot be deleted."""
        # Sanitize filename path traversal
        filename = os.path.basename(filename)
        if not filename.endswith((".patch", ".diff")):
            return {"success": False, "error": "Invalid patch file."}
            
        # Check system patches first
        system_patch_path = os.path.join(self.system_patches_dir, filename)
        if os.path.exists(system_patch_path):
            return {"success": False, "error": "Cannot delete system patches."}
            
        patch_path = os.path.join(self.user_patches_dir, filename)
        meta_filename = os.path.splitext(filename)[0] + ".json"
        meta_path = os.path.join(self.user_patches_dir, meta_filename)
        
        if not os.path.exists(patch_path) or not os.path.exists(meta_path):
            return {"success": False, "error": "Patch not found in user uploads."}
            
        try:
            # Verify it's a user patch before deleting
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
                
            if meta.get("source") != "user":
                return {"success": False, "error": "Cannot delete system patches."}
                
            os.remove(patch_path)
            os.remove(meta_path)
            return {"success": True}
        except Exception as e:
            logger.error(f"Failed to delete patch {filename}: {e}")
            return {"success": False, "error": str(e)}
