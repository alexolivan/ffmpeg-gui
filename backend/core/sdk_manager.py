import os
import shutil
import zipfile
import tarfile
import re
import logging
from typing import List, Dict, Optional, Any
from sqlalchemy.orm import Session

logger = logging.getLogger("SdkManager")


def find_file_recursively(root_dir: str, target_filename: str) -> Optional[str]:
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


def clean_non_linux_dirs(temp_extract_dir: str):
    """Recursively removes macOS, Windows, and iOS directories from the extracted SDK."""
    non_linux_names = {"mac", "mac_os", "macos", "win", "win32", "windows", "ios"}
    for root, dirs, files in os.walk(temp_extract_dir, topdown=True):
        for d in list(dirs):
            if d.lower() in non_linux_names:
                dir_path = os.path.join(root, d)
                try:
                    shutil.rmtree(dir_path)
                except Exception as e:
                    logger.warning(f"Failed to remove non-Linux directory {dir_path}: {e}")
                dirs.remove(d)


def extract_version_from_name(filename: str) -> str:
    """Find patterns like 14.2, 12.4.1 in the filename."""
    match = re.search(r"(\d+(?:\.\d+)+)", filename)
    return match.group(1) if match else "1.0.0"


def get_dir_size(path: str) -> int:
    """Calculate cumulative file size in bytes for a directory."""
    total_size = 0
    if not os.path.exists(path):
        return 0
    for dirpath, _, filenames in os.walk(path):
        for f in filenames:
            fp = os.path.join(dirpath, f)
            if not os.path.islink(fp) and os.path.exists(fp):
                try:
                    total_size += os.path.getsize(fp)
                except OSError:
                    pass
    return total_size


# ── Strategy Processors ────────────────────────────────────────────────


class BaseSdkProcessor:
    """Base strategy processor for SDK extraction and optimization."""

    def process(
        self,
        temp_extract_dir: str,
        original_filename: str,
        fallback_version: str,
        target_base_dir: Optional[str] = None,
    ) -> Dict[str, Any]:
        raise NotImplementedError("Subclasses must implement process()")


class DeckLinkSdkProcessor(BaseSdkProcessor):
    """Strategy processor for Blackmagic DeckLink SDK archives."""

    def process(
        self,
        temp_extract_dir: str,
        original_filename: str,
        fallback_version: str,
        target_base_dir: Optional[str] = None,
    ) -> Dict[str, Any]:
        header_file = find_file_recursively(temp_extract_dir, "DeckLinkAPI.h")
        if not header_file:
            return {
                "success": False,
                "error": "Could not find 'DeckLinkAPI.h' in the uploaded archive",
            }

        src_include_dir = os.path.dirname(header_file)

        version_header = find_file_recursively(
            temp_extract_dir, "DeckLinkAPIVersion.h"
        )
        version = fallback_version
        if version_header:
            try:
                with open(version_header, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                    api_version_match = re.search(
                        r"BLACKMAGIC_DECKLINK_API_VERSION\s+(0x[0-9a-fA-F]+)", content
                    )
                    if api_version_match:
                        raw_hex = int(api_version_match.group(1), 16)
                        major = (raw_hex >> 24) & 0xFF
                        minor = (raw_hex >> 16) & 0xFF
                        patch = (raw_hex >> 8) & 0xFF
                        version = f"{major}.{minor}"
                        if patch:
                            version += f".{patch}"
            except Exception as e:
                logger.warning(
                    f"Could not parse version from DeckLinkAPIVersion.h: {e}"
                )

        if target_base_dir:
            target_sdk_path = os.path.join(target_base_dir, "decklink", version)
        else:
            target_sdk_path = os.path.join("data", "sdks", "decklink", version)

        if os.path.exists(target_sdk_path):
            shutil.rmtree(target_sdk_path)

        target_include_path = os.path.join(target_sdk_path, "include")
        os.makedirs(target_include_path, exist_ok=True)

        for filename in os.listdir(src_include_dir):
            if filename.endswith((".h", ".idl")):
                shutil.copy2(
                    os.path.join(src_include_dir, filename), target_include_path
                )

        dispatch_file = find_file_recursively(
            temp_extract_dir, "DeckLinkAPIDispatch.cpp"
        )
        if dispatch_file:
            shutil.copy2(dispatch_file, target_include_path)
        else:
            logger.warning(
                "DeckLinkAPIDispatch.cpp was not found in the archive. FFmpeg decklink compilation might fail."
            )

        size_bytes = get_dir_size(target_sdk_path)

        return {
            "success": True,
            "name": "Blackmagic DeckLink SDK",
            "version": version,
            "path": target_sdk_path,
            "type": "decklink",
            "size_bytes": size_bytes,
        }


class NdiSdkProcessor(BaseSdkProcessor):
    """Strategy processor for NewTek NDI SDK archives."""

    def process(
        self,
        temp_extract_dir: str,
        original_filename: str,
        fallback_version: str,
        target_base_dir: Optional[str] = None,
    ) -> Dict[str, Any]:
        header_file = find_file_recursively(temp_extract_dir, "Processing.NDI.Lib.h")
        if not header_file:
            return {
                "success": False,
                "error": "Could not find 'Processing.NDI.Lib.h' in the uploaded archive",
            }

        src_include_dir = os.path.dirname(header_file)

        lib_file = None
        import sys
        import platform

        is_64bit_system = sys.maxsize > 2**32
        host_mach = platform.machine().lower()

        expected_machine = None
        if host_mach in ["x86_64", "amd64"]:
            expected_machine = 0x3E
        elif host_mach in ["aarch64", "arm64"]:
            expected_machine = 0xB7
        elif host_mach in ["i386", "i686", "x86"]:
            expected_machine = 0x03

        candidates = []
        for dirpath, _, filenames in os.walk(temp_extract_dir):
            for f in filenames:
                if f == "libndi.so" or f.startswith("libndi.so."):
                    candidates.append(os.path.join(dirpath, f))

        best_candidate = None
        for candidate in candidates:
            try:
                real_candidate = os.path.realpath(candidate)
                if os.path.exists(real_candidate) and os.path.isfile(real_candidate):
                    with open(real_candidate, "rb") as f:
                        header = f.read(20)
                        if len(header) >= 20 and header[:4] == b"\x7fELF":
                            is_elf64 = header[4] == 2
                            if is_64bit_system == is_elf64:
                                elf_machine = header[18]
                                if (
                                    expected_machine is None
                                    or elf_machine == expected_machine
                                ):
                                    parent_dir = os.path.dirname(candidate)
                                    if os.path.exists(
                                        os.path.join(parent_dir, "libndi.so")
                                    ):
                                        best_candidate = os.path.join(
                                            parent_dir, "libndi.so"
                                        )
                                        break
                                    best_candidate = candidate
            except Exception:
                pass

        if best_candidate:
            lib_file = best_candidate
        else:
            lib_file = find_file_recursively(temp_extract_dir, "libndi.so")
            if not lib_file:
                for dirpath, _, filenames in os.walk(temp_extract_dir):
                    for f in filenames:
                        if f.startswith("libndi.so"):
                            lib_file = os.path.join(dirpath, f)
                            break
                    if lib_file:
                        break

        if not lib_file:
            return {
                "success": False,
                "error": "Could not find 'libndi.so' library in the uploaded archive",
            }

        src_lib_dir = os.path.dirname(lib_file)
        version = fallback_version

        if target_base_dir:
            target_sdk_path = os.path.join(target_base_dir, "ndi", version)
        else:
            target_sdk_path = os.path.join("data", "sdks", "ndi", version)

        if os.path.exists(target_sdk_path):
            shutil.rmtree(target_sdk_path)

        target_include_path = os.path.join(target_sdk_path, "include")
        target_lib_path = os.path.join(target_sdk_path, "lib", "x86_64-linux-gnu")
        os.makedirs(target_include_path, exist_ok=True)
        os.makedirs(target_lib_path, exist_ok=True)

        for filename in os.listdir(src_include_dir):
            if filename.endswith(".h"):
                shutil.copy2(
                    os.path.join(src_include_dir, filename), target_include_path
                )

        for filename in os.listdir(src_lib_dir):
            if "libndi.so" in filename:
                src_path = os.path.join(src_lib_dir, filename)
                if os.path.islink(src_path):
                    link_target = os.readlink(src_path)
                    os.symlink(link_target, os.path.join(target_lib_path, filename))
                else:
                    shutil.copy2(src_path, target_lib_path)

        size_bytes = get_dir_size(target_sdk_path)

        return {
            "success": True,
            "name": "NewTek NDI SDK",
            "version": version,
            "path": target_sdk_path,
            "type": "ndi",
            "size_bytes": size_bytes,
        }


PROCESSORS: Dict[str, BaseSdkProcessor] = {
    "decklink": DeckLinkSdkProcessor(),
    "ndi": NdiSdkProcessor(),
}


# ── Main SdkManager Class ──────────────────────────────────────────────


class SdkManager:
    """Manages the lifecycle of development SDKs (Blackmagic DeckLink and NewTek NDI).

    Handles secure uploads, recursive header identification, strategy dispatching,
    storage migrations, DB persistence, and reference-checked deletions.
    """

    def __init__(self, workspace_root: str):
        self.workspace_root = os.path.abspath(workspace_root)
        self.sdks_dir = os.path.join(self.workspace_root, "data", "sdks")
        self.temp_dir = os.path.join(self.workspace_root, "data", "temp_uploads")
        os.makedirs(self.sdks_dir, exist_ok=True)
        os.makedirs(self.temp_dir, exist_ok=True)

    def get_sdk_path(self, sdk_type: str, version: str) -> str:
        return os.path.join(self.sdks_dir, sdk_type, version)

    def list_installed_sdks(
        self,
        sdk_type: Optional[str] = None,
        target_app: str = "ffmpeg",
        db: Optional[Session] = None,
    ) -> List[Dict[str, Any]]:
        """List installed SDKs populated from DB and disk status check or filesystem fallback."""
        if db is not None:
            from database.models import InstalledSdk, FfmpegBuild

            builds = db.query(FfmpegBuild).all()
            query = db.query(InstalledSdk).filter(InstalledSdk.target_app == target_app)
            if sdk_type is not None:
                query = query.filter(InstalledSdk.sdk_type == sdk_type)

            records = query.all()
            sdks = []
            for sdk in records:
                if sdk.storage:
                    full_path = os.path.join(sdk.storage.path, sdk.relative_path)
                else:
                    full_path = os.path.join(self.sdks_dir, sdk.relative_path)

                exists = os.path.exists(full_path)
                if not exists and sdk.status != "missing":
                    sdk.status = "missing"
                    db.commit()
                elif exists and sdk.status == "missing":
                    sdk.status = "ready"
                    db.commit()

                referencing_builds = [
                    b.name for b in builds
                    if self._build_references_sdk(b, sdk.sdk_type, sdk.version)
                ]

                sdks.append(
                    {
                        "id": sdk.id,
                        "target_app": sdk.target_app,
                        "sdk_type": sdk.sdk_type,
                        "name": sdk.name,
                        "version": sdk.version,
                        "storage_id": sdk.storage_id,
                        "relative_path": sdk.relative_path,
                        "path": full_path,
                        "size_bytes": sdk.size_bytes,
                        "status": sdk.status,
                        "used_by_builds": referencing_builds,
                    }
                )
            return sdks

        # Fallback disk scan for non-DB callers
        if sdk_type:
            types_to_scan = [sdk_type]
        else:
            types_to_scan = (
                [
                    d
                    for d in os.listdir(self.sdks_dir)
                    if os.path.isdir(os.path.join(self.sdks_dir, d))
                ]
                if os.path.exists(self.sdks_dir)
                else []
            )

        sdks = []
        for st in types_to_scan:
            type_dir = os.path.join(self.sdks_dir, st)
            if not os.path.exists(type_dir):
                continue
            for version in os.listdir(type_dir):
                version_path = os.path.join(type_dir, version)
                if not os.path.isdir(version_path):
                    continue
                sdks.append(
                    {
                        "sdk_type": st,
                        "version": version,
                        "path": version_path,
                        "status": "ready",
                        "used_by_builds": [],
                    }
                )

        sdks.sort(
            key=lambda x: [
                int(c) if c.isdigit() else c for c in re.split(r"(\d+)", x["version"])
            ],
            reverse=True,
        )
        return sdks

    def process_sdk_upload(
        self,
        file_path: str,
        original_filename: str,
        sdk_type: str,
        storage_id: Optional[int] = None,
        db: Optional[Session] = None,
        target_app: str = "ffmpeg",
    ) -> Dict[str, Any]:
        """Extract, locate headers/libraries via strategy processor, and persist SDK to disk & DB."""
        if sdk_type not in PROCESSORS:
            return {"success": False, "error": f"Invalid SDK type: {sdk_type}"}

        storage_path = self.sdks_dir
        selected_storage_id = storage_id

        if db is not None:
            from database.models import Storage

            if storage_id is not None:
                storage = db.query(Storage).filter(Storage.id == storage_id).first()
                if storage:
                    storage_path = storage.path
            else:
                storage = (
                    db.query(Storage)
                    .filter(Storage.type == "sdk", Storage.is_default == True)
                    .first()
                )
                if not storage:
                    storage = db.query(Storage).filter(Storage.type == "sdk").first()
                if storage:
                    storage_path = storage.path
                    selected_storage_id = storage.id

        extraction_id = os.path.basename(file_path).replace(".", "_")
        temp_extract_dir = os.path.join(self.temp_dir, extraction_id)
        os.makedirs(temp_extract_dir, exist_ok=True)

        try:
            self._unpack_archive(file_path, temp_extract_dir)
            clean_non_linux_dirs(temp_extract_dir)
            version = extract_version_from_name(original_filename)

            processor = PROCESSORS[sdk_type]
            res = processor.process(
                temp_extract_dir=temp_extract_dir,
                original_filename=original_filename,
                fallback_version=version,
                target_base_dir=storage_path,
            )

            if not res.get("success"):
                return res

            final_version = res.get("version", version)
            final_name = res.get("name", f"{sdk_type.title()} SDK")
            target_path = res.get("path")
            size_bytes = res.get("size_bytes", get_dir_size(target_path))
            relative_path = os.path.relpath(target_path, storage_path)

            if db is not None:
                from database.models import InstalledSdk

                sdk_record = (
                    db.query(InstalledSdk)
                    .filter(
                        InstalledSdk.target_app == target_app,
                        InstalledSdk.sdk_type == sdk_type,
                        InstalledSdk.version == final_version,
                    )
                    .first()
                )
                if sdk_record:
                    sdk_record.name = final_name
                    sdk_record.storage_id = selected_storage_id
                    sdk_record.relative_path = relative_path
                    sdk_record.size_bytes = size_bytes
                    sdk_record.status = "ready"
                else:
                    sdk_record = InstalledSdk(
                        target_app=target_app,
                        sdk_type=sdk_type,
                        name=final_name,
                        version=final_version,
                        storage_id=selected_storage_id,
                        relative_path=relative_path,
                        size_bytes=size_bytes,
                        status="ready",
                    )
                    db.add(sdk_record)
                db.commit()
                db.refresh(sdk_record)
                res["id"] = sdk_record.id
                res["storage_id"] = sdk_record.storage_id
                res["relative_path"] = sdk_record.relative_path

            return res

        except Exception as e:
            logger.error(f"Failed to process SDK upload: {e}", exc_info=True)
            return {"success": False, "error": str(e)}
        finally:
            if os.path.exists(temp_extract_dir):
                shutil.rmtree(temp_extract_dir)
            if os.path.exists(file_path):
                try:
                    os.remove(file_path)
                except OSError:
                    pass

    def migrate_sdk_storage(
        self, sdk_id: int, target_storage_id: int, db: Session
    ) -> Dict[str, Any]:
        """Move physical folder to target storage directory and update DB record."""
        from database.models import InstalledSdk, Storage

        sdk = db.query(InstalledSdk).filter(InstalledSdk.id == sdk_id).first()
        if not sdk:
            return {
                "success": False,
                "error": f"InstalledSdk with id {sdk_id} not found",
            }

        target_storage = (
            db.query(Storage).filter(Storage.id == target_storage_id).first()
        )
        if not target_storage:
            return {
                "success": False,
                "error": f"Target Storage with id {target_storage_id} not found",
            }

        if sdk.storage:
            current_base = sdk.storage.path
        else:
            current_base = self.sdks_dir

        current_path = os.path.join(current_base, sdk.relative_path)
        if not os.path.exists(current_path):
            if os.path.exists(sdk.relative_path):
                current_path = sdk.relative_path
            else:
                alt_path = self.get_sdk_path(sdk.sdk_type, sdk.version)
                if os.path.exists(alt_path):
                    current_path = alt_path

        new_relative_path = os.path.join(sdk.sdk_type, sdk.version)
        target_path = os.path.join(target_storage.path, new_relative_path)
        os.makedirs(os.path.dirname(target_path), exist_ok=True)

        if os.path.exists(current_path):
            if os.path.exists(target_path):
                shutil.rmtree(target_path)
            shutil.move(current_path, target_path)

        sdk.storage_id = target_storage_id
        sdk.relative_path = new_relative_path
        db.commit()
        db.refresh(sdk)

        return {
            "success": True,
            "sdk_id": sdk.id,
            "storage_id": target_storage_id,
            "relative_path": new_relative_path,
            "path": target_path,
        }

    def delete_sdk(
        self, sdk_id: int, force: bool = False, db: Optional[Session] = None
    ) -> Dict[str, Any]:
        """Delete SDK physically and update/delete DB record depending on FfmpegBuild references."""
        if db is None:
            return {
                "success": False,
                "error": "Database session required for delete_sdk",
            }

        from database.models import InstalledSdk, FfmpegBuild

        sdk = db.query(InstalledSdk).filter(InstalledSdk.id == sdk_id).first()
        if not sdk:
            return {
                "success": False,
                "error": f"InstalledSdk with id {sdk_id} not found",
            }

        builds = db.query(FfmpegBuild).all()
        referencing_builds = []
        for build in builds:
            if self._build_references_sdk(build, sdk.sdk_type, sdk.version):
                referencing_builds.append(build.name)

        if referencing_builds and not force:
            return {
                "success": False,
                "in_use": True,
                "used_by": referencing_builds,
                "error": f"SDK is referenced by builds: {', '.join(referencing_builds)}",
            }

        if sdk.storage:
            base_dir = sdk.storage.path
        else:
            base_dir = self.sdks_dir
        physical_path = os.path.join(base_dir, sdk.relative_path)

        if not os.path.exists(physical_path):
            alt_path = self.get_sdk_path(sdk.sdk_type, sdk.version)
            if os.path.exists(alt_path):
                physical_path = alt_path

        if os.path.exists(physical_path):
            shutil.rmtree(physical_path)

        if referencing_builds and force:
            sdk.status = "missing"
            db.commit()
            db.refresh(sdk)
            return {
                "success": True,
                "status": "missing",
                "in_use": True,
                "used_by": referencing_builds,
            }
        else:
            db.delete(sdk)
            db.commit()
            return {"success": True, "deleted": True}

    def _build_references_sdk(self, build: Any, sdk_type: str, version: str) -> bool:
        sdk_type_lower = sdk_type.lower()
        version_str = str(version)

        def dict_matches(d: dict) -> bool:
            type_found = False
            version_found = False

            for k, v in d.items():
                k_str = str(k).lower()
                v_str = str(v).lower() if v is not None else ""

                if sdk_type_lower in k_str or sdk_type_lower in v_str:
                    type_found = True
                    if version_str in k_str or version_str in v_str:
                        version_found = True

            if type_found and version_found:
                return True

            if type_found:
                full_str = str(d)
                if version_str in full_str:
                    return True

            return False

        if build.sdk_paths:
            if isinstance(build.sdk_paths, dict) and dict_matches(build.sdk_paths):
                return True
            elif isinstance(build.sdk_paths, (list, str)):
                s = str(build.sdk_paths).lower()
                if sdk_type_lower in s and version_str in s:
                    return True

        if build.build_options:
            if isinstance(build.build_options, dict) and dict_matches(build.build_options):
                return True
            elif isinstance(build.build_options, (list, str)):
                s = str(build.build_options).lower()
                if sdk_type_lower in s and version_str in s:
                    return True

        return False

    # ── Private Unpackers & Helpers ─────────────────────────────────

    def _unpack_archive(self, archive_path: str, extract_to: str):
        if archive_path.endswith(".zip"):
            with zipfile.ZipFile(archive_path, "r") as zip_ref:
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
        return extract_version_from_name(filename)

    def _clean_non_linux_dirs(self, temp_extract_dir: str):
        clean_non_linux_dirs(temp_extract_dir)

    def _find_file_recursively(
        self, root_dir: str, target_filename: str
    ) -> Optional[str]:
        return find_file_recursively(root_dir, target_filename)

    def _handle_decklink_sdk(
        self, temp_extract_dir: str, fallback_version: str
    ) -> Dict[str, Any]:
        return PROCESSORS["decklink"].process(
            temp_extract_dir, "", fallback_version, target_base_dir=self.sdks_dir
        )

    def _handle_ndi_sdk(
        self, temp_extract_dir: str, fallback_version: str
    ) -> Dict[str, Any]:
        return PROCESSORS["ndi"].process(
            temp_extract_dir, "", fallback_version, target_base_dir=self.sdks_dir
        )
