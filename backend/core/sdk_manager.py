import os
import shutil
import zipfile
import tarfile
import re
import logging
from typing import List, Dict, Optional

logger = logging.getLogger("SdkManager")

class SdkManager:
    """Manages the lifecycle of development SDKs (Blackmagic DeckLink and NewTek NDI).
    
    Handles secure uploads, recursive header identification, version extraction, 
    and aggressive size optimization to minimize disk footprint.
    """
    
    def __init__(self, workspace_root: str):
        self.workspace_root = os.path.abspath(workspace_root)
        self.sdks_dir = os.path.join(self.workspace_root, "data", "sdks")
        self.temp_dir = os.path.join(self.workspace_root, "data", "temp_uploads")
        os.makedirs(self.sdks_dir, exist_ok=True)
        os.makedirs(self.temp_dir, exist_ok=True)

    def get_sdk_path(self, sdk_type: str, version: str) -> str:
        return os.path.join(self.sdks_dir, sdk_type, version)

    def list_installed_sdks(self, sdk_type: str) -> List[Dict[str, str]]:
        """List all successfully installed SDKs for a given type."""
        type_dir = os.path.join(self.sdks_dir, sdk_type)
        if not os.path.exists(type_dir):
            return []
        
        sdks = []
        for version in os.listdir(type_dir):
            version_path = os.path.join(type_dir, version)
            if not os.path.isdir(version_path):
                continue
            sdks.append({
                "version": version,
                "path": version_path
            })
        
        # Sort by version descending (simplistic regex numeric sort)
        sdks.sort(key=lambda x: [int(c) if c.isdigit() else c for c in re.split(r'(\d+)', x["version"])], reverse=True)
        return sdks

    def process_sdk_upload(self, file_path: str, original_filename: str, sdk_type: str) -> Dict[str, any]:
        """Extract, locate headers, extract version, sanitize, and persist the SDK."""
        if sdk_type not in ["decklink", "ndi"]:
            return {"success": False, "error": f"Invalid SDK type: {sdk_type}"}

        # Unique extraction directory
        extraction_id = os.path.basename(file_path).replace(".", "_")
        temp_extract_dir = os.path.join(self.temp_dir, extraction_id)
        os.makedirs(temp_extract_dir, exist_ok=True)

        try:
            # 1. Unpack archive
            self._unpack_archive(file_path, temp_extract_dir)

            # 1.5 Clean non-Linux platform folders immediately to save disk and prevent wrong resolution
            self._clean_non_linux_dirs(temp_extract_dir)

            # 2. Extract Version from filename as fallback
            version = self._extract_version_from_name(original_filename)

            # 3. Handle specific SDK types
            if sdk_type == "decklink":
                return self._handle_decklink_sdk(temp_extract_dir, version)
            
            return self._handle_ndi_sdk(temp_extract_dir, version)

        except Exception as e:
            logger.error(f"Failed to process SDK upload: {e}", exc_info=True)
            return {"success": False, "error": str(e)}
        finally:
            # Cleanup temporary extraction directory and uploaded archive
            if os.path.exists(temp_extract_dir):
                shutil.rmtree(temp_extract_dir)
            if os.path.exists(file_path):
                try:
                    os.remove(file_path)
                except OSError:
                    pass

    # ── Private Unpackers & Helpers ─────────────────────────────────

    def _unpack_archive(self, archive_path: str, extract_to: str):
        if archive_path.endswith(".zip"):
            with zipfile.ZipFile(archive_path, 'r') as zip_ref:
                zip_ref.extractall(extract_to)
            return
            
        if archive_path.endswith((".tar.gz", ".tgz")):
            with tarfile.open(archive_path, "r:gz") as tar_ref:
                tar_ref.extractall(extract_to)
            return
            
        if archive_path.endswith(".tar"):
            with tarfile.open(archive_path, "r:") as tar_ref:
                tar_ref.extractall(extract_to)
            return
            
        raise ValueError("Unsupported archive format. Use .zip, .tar.gz, or .tar")

    def _extract_version_from_name(self, filename: str) -> str:
        """Find patterns like 14.2, 12.4.1 in the filename."""
        match = re.search(r'(\d+(?:\.\d+)+)', filename)
        return match.group(1) if match else "1.0.0"

    def _clean_non_linux_dirs(self, temp_extract_dir: str):
        """Recursively removes macOS, Windows, and iOS directories from the extracted SDK."""
        non_linux_names = {"mac", "mac_os", "macos", "win", "win32", "windows", "ios"}
        for root, dirs, files in os.walk(temp_extract_dir, topdown=True):
            # Modify dirs in-place to prevent os.walk from descending into deleted directories
            for d in list(dirs):
                if d.lower() in non_linux_names:
                    dir_path = os.path.join(root, d)
                    try:
                        shutil.rmtree(dir_path)
                    except Exception as e:
                        logger.warning(f"Failed to remove non-Linux directory {dir_path}: {e}")
                    dirs.remove(d)

    def _find_file_recursively(self, root_dir: str, target_filename: str) -> Optional[str]:
        candidates = []
        for dirpath, _, filenames in os.walk(root_dir):
            if target_filename in filenames:
                candidates.append(os.path.join(dirpath, target_filename))
        
        if not candidates:
            return None
            
        # Prioritize Linux path
        for candidate in candidates:
            if "linux" in candidate.lower():
                return candidate
                
        return candidates[0]

    # ── Specific SDK Handlers ────────────────────────────────────────

    def _handle_decklink_sdk(self, temp_extract_dir: str, fallback_version: str) -> Dict[str, any]:
        """Locates DeckLinkAPI.h, extracts exact API version, copies C++ dispatchers, and cleans up."""
        header_file = self._find_file_recursively(temp_extract_dir, "DeckLinkAPI.h")
        if not header_file:
            return {"success": False, "error": "Could not find 'DeckLinkAPI.h' in the uploaded archive"}

        src_include_dir = os.path.dirname(header_file)
        
        # Try to find DeckLinkAPIVersion.h to extract real SDK version if possible
        version_header = self._find_file_recursively(temp_extract_dir, "DeckLinkAPIVersion.h")
        version = fallback_version
        if version_header:
            try:
                with open(version_header, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
                    # e.g. #define BLACKMAGIC_DECKLINK_API_VERSION 0x0c040000
                    # or similar version markers
                    api_version_match = re.search(r'BLACKMAGIC_DECKLINK_API_VERSION\s+(0x[0-9a-fA-F]+)', content)
                    if api_version_match:
                        raw_hex = int(api_version_match.group(1), 16)
                        major = (raw_hex >> 24) & 0xFF
                        minor = (raw_hex >> 16) & 0xFF
                        patch = (raw_hex >> 8) & 0xFF
                        version = f"{major}.{minor}"
                        if patch:
                            version += f".{patch}"
            except Exception as e:
                logger.warning(f"Could not parse version from DeckLinkAPIVersion.h: {e}")

        target_sdk_path = self.get_sdk_path("decklink", version)
        if os.path.exists(target_sdk_path):
            # Version already exists, overwrite it
            shutil.rmtree(target_sdk_path)
        
        target_include_path = os.path.join(target_sdk_path, "include")
        os.makedirs(target_include_path, exist_ok=True)

        # Copy all headers from the DeckLink include dir
        for filename in os.listdir(src_include_dir):
            if filename.endswith((".h", ".idl")):
                shutil.copy2(os.path.join(src_include_dir, filename), target_include_path)

        # FFmpeg compilation specifically requires 'DeckLinkAPIDispatch.cpp' for dynamic linking on Linux.
        # It's usually placed in the same include directory, or one level up, or in a 'common' directory.
        dispatch_file = self._find_file_recursively(temp_extract_dir, "DeckLinkAPIDispatch.cpp")
        if dispatch_file:
            shutil.copy2(dispatch_file, target_include_path)
        else:
            logger.warning("DeckLinkAPIDispatch.cpp was not found in the archive. FFmpeg decklink compilation might fail.")

        return {
            "success": True,
            "version": version,
            "path": target_sdk_path,
            "type": "decklink"
        }

    def _handle_ndi_sdk(self, temp_extract_dir: str, fallback_version: str) -> Dict[str, any]:
        """Locates NDI headers and libraries, filters for Linux x86_64, and copies them to the global SDK storage."""
        header_file = self._find_file_recursively(temp_extract_dir, "Processing.NDI.Lib.h")
        if not header_file:
            return {"success": False, "error": "Could not find 'Processing.NDI.Lib.h' in the uploaded archive"}

        src_include_dir = os.path.dirname(header_file)
        
        # Locate libndi.so
        lib_file = None
        # Walk to find all libndi.so candidates and filter by architecture compatibility
        import sys
        import platform
        is_64bit_system = sys.maxsize > 2**32
        host_mach = platform.machine().lower()
        
        # Map python machine names to ELF e_machine values
        expected_machine = None
        if host_mach in ["x86_64", "amd64"]:
            expected_machine = 0x3e
        elif host_mach in ["aarch64", "arm64"]:
            expected_machine = 0xb7
        elif host_mach in ["i386", "i686", "x86"]:
            expected_machine = 0x03
            
        candidates = []
        for dirpath, _, filenames in os.walk(temp_extract_dir):
            for f in filenames:
                if f == "libndi.so" or f.startswith("libndi.so."):
                    candidates.append(os.path.join(dirpath, f))

        # Filter candidates: prioritize exact target CPU machine & bitness compatibility
        best_candidate = None
        for candidate in candidates:
            try:
                # Resolve target if it's a symlink
                real_candidate = os.path.realpath(candidate)
                if os.path.exists(real_candidate) and os.path.isfile(real_candidate):
                    with open(real_candidate, "rb") as f:
                        header = f.read(20)
                        if len(header) >= 20 and header[:4] == b"\x7fELF":
                            is_elf64 = header[4] == 2
                            # Check bitness compatibility
                            if is_64bit_system == is_elf64:
                                # Check CPU architecture compatibility (e_machine byte at index 18)
                                elf_machine = header[18]
                                if expected_machine is None or elf_machine == expected_machine:
                                    # Found matching architecture candidate!
                                    # If it has "libndi.so" in the same directory, this directory is our target source directory
                                    parent_dir = os.path.dirname(candidate)
                                    if os.path.exists(os.path.join(parent_dir, "libndi.so")):
                                        best_candidate = os.path.join(parent_dir, "libndi.so")
                                        break
                                    # If the candidate itself is in a directory, we can use it
                                    best_candidate = candidate
            except Exception:
                pass

        if best_candidate:
            lib_file = best_candidate
        else:
            # Fallback to the first found libndi.so if no architecture match was found
            lib_file = self._find_file_recursively(temp_extract_dir, "libndi.so")
            if not lib_file:
                for dirpath, _, filenames in os.walk(temp_extract_dir):
                    for f in filenames:
                        if f.startswith("libndi.so"):
                            lib_file = os.path.join(dirpath, f)
                            break
                    if lib_file:
                        break

        if not lib_file:
            return {"success": False, "error": "Could not find 'libndi.so' library in the uploaded archive"}

        src_lib_dir = os.path.dirname(lib_file)
        
        # Try to refine version if possible from NDI headers or path
        version = fallback_version
        
        target_sdk_path = self.get_sdk_path("ndi", version)
        if os.path.exists(target_sdk_path):
            shutil.rmtree(target_sdk_path)
            
        target_include_path = os.path.join(target_sdk_path, "include")
        target_lib_path = os.path.join(target_sdk_path, "lib", "x86_64-linux-gnu")
        os.makedirs(target_include_path, exist_ok=True)
        os.makedirs(target_lib_path, exist_ok=True)

        # Copy all headers from the NDI include dir
        for filename in os.listdir(src_include_dir):
            if filename.endswith(".h"):
                shutil.copy2(os.path.join(src_include_dir, filename), target_include_path)

        # Copy NDI shared libraries (including symlinks if any, or matching libraries)
        for filename in os.listdir(src_lib_dir):
            if "libndi.so" in filename:
                src_path = os.path.join(src_lib_dir, filename)
                if os.path.islink(src_path):
                    # Resolve and replicate symlink
                    link_target = os.readlink(src_path)
                    os.symlink(link_target, os.path.join(target_lib_path, filename))
                else:
                    shutil.copy2(src_path, target_lib_path)

        return {
            "success": True,
            "version": version,
            "path": target_sdk_path,
            "type": "ndi"
        }
