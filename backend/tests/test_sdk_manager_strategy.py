import os
import sys
import shutil
import unittest
import tempfile
import zipfile

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from database.db import SessionLocal, init_db
from database.models import Storage, InstalledSdk, FfmpegBuild
from core.sdk_manager import (
    SdkManager,
    BaseSdkProcessor,
    DeckLinkSdkProcessor,
    NdiSdkProcessor,
    PROCESSORS,
)


class TestSdkManagerStrategy(unittest.TestCase):
    def setUp(self):
        init_db()
        self.db = SessionLocal()
        self.temp_dir = tempfile.mkdtemp()
        self.sdk_manager = SdkManager(self.temp_dir)

    def tearDown(self):
        self.db.close()
        shutil.rmtree(self.temp_dir)

    def test_strategy_processor_dispatch(self):
        """Test strategy processor map and base class interface."""
        self.assertIn("decklink", PROCESSORS)
        self.assertIn("ndi", PROCESSORS)
        self.assertIsInstance(PROCESSORS["decklink"], DeckLinkSdkProcessor)
        self.assertIsInstance(PROCESSORS["ndi"], NdiSdkProcessor)
        self.assertIsInstance(PROCESSORS["decklink"], BaseSdkProcessor)
        self.assertIsInstance(PROCESSORS["ndi"], BaseSdkProcessor)

        base_processor = BaseSdkProcessor()
        with self.assertRaises(NotImplementedError):
            base_processor.process("/tmp/fake", "sdk.zip", "1.0")

    def test_process_sdk_upload_creates_db_record(self):
        """Test process_sdk_upload inserting InstalledSdk DB records with metadata."""
        storage = Storage(
            name="Test SDK Storage",
            path=os.path.join(self.temp_dir, "sdks_storage"),
            type="sdk",
            is_default=True,
        )
        self.db.add(storage)
        self.db.commit()
        self.db.refresh(storage)

        # Create dummy DeckLink SDK zip archive
        zip_path = os.path.join(self.temp_dir, "DeckLink_SDK_14.2.zip")
        with zipfile.ZipFile(zip_path, "w") as z:
            z.writestr("Linux/include/DeckLinkAPI.h", "// DeckLink header\n")
            z.writestr(
                "Linux/include/DeckLinkAPIVersion.h",
                "#define BLACKMAGIC_DECKLINK_API_VERSION 0x0e020000\n",
            )

        res = self.sdk_manager.process_sdk_upload(
            file_path=zip_path,
            original_filename="DeckLink_SDK_14.2.zip",
            sdk_type="decklink",
            storage_id=storage.id,
            db=self.db,
        )

        self.assertTrue(res.get("success"), f"Upload failed: {res}")
        self.assertEqual(res.get("version"), "14.2")

        # Query DB to verify InstalledSdk record
        sdk = (
            self.db.query(InstalledSdk)
            .filter(
                InstalledSdk.sdk_type == "decklink",
                InstalledSdk.version == "14.2",
            )
            .first()
        )
        self.assertIsNotNone(sdk)
        self.assertEqual(sdk.storage_id, storage.id)
        self.assertEqual(sdk.version, "14.2")
        self.assertEqual(sdk.status, "ready")
        self.assertGreater(sdk.size_bytes, 0)

        # Cleanup DB
        self.db.delete(sdk)
        self.db.delete(storage)
        self.db.commit()

    def test_migrate_sdk_storage(self):
        """Test migrate_sdk_storage moving physical folder and updating DB storage_id and relative_path."""
        storage1 = Storage(
            name="SDK Storage 1",
            path=os.path.join(self.temp_dir, "storage1"),
            type="sdk",
        )
        storage2 = Storage(
            name="SDK Storage 2",
            path=os.path.join(self.temp_dir, "storage2"),
            type="sdk",
        )
        self.db.add_all([storage1, storage2])
        self.db.commit()
        self.db.refresh(storage1)
        self.db.refresh(storage2)

        # Create physical directory in storage1
        src_sdk_dir = os.path.join(storage1.path, "decklink", "14.2")
        os.makedirs(src_sdk_dir, exist_ok=True)
        with open(os.path.join(src_sdk_dir, "dummy.h"), "w") as f:
            f.write("test header")

        sdk = InstalledSdk(
            target_app="ffmpeg",
            sdk_type="decklink",
            name="Blackmagic DeckLink SDK",
            version="14.2",
            storage_id=storage1.id,
            relative_path="decklink/14.2",
            size_bytes=100,
            status="ready",
        )
        self.db.add(sdk)
        self.db.commit()
        self.db.refresh(sdk)

        res = self.sdk_manager.migrate_sdk_storage(
            sdk_id=sdk.id, target_storage_id=storage2.id, db=self.db
        )
        self.assertTrue(res.get("success"), f"Migration failed: {res}")

        # Check DB update
        self.db.refresh(sdk)
        self.assertEqual(sdk.storage_id, storage2.id)

        # Check physical files moved
        self.assertFalse(os.path.exists(src_sdk_dir))
        expected_dest_dir = os.path.join(storage2.path, sdk.relative_path)
        self.assertTrue(os.path.exists(expected_dest_dir))
        self.assertTrue(os.path.exists(os.path.join(expected_dest_dir, "dummy.h")))

        # Cleanup DB
        self.db.delete(sdk)
        self.db.delete(storage1)
        self.db.delete(storage2)
        self.db.commit()

    def test_delete_sdk_force_false_blocked_if_referenced(self):
        """Test delete_sdk(sdk_id, force=False) blocking deletion if referenced by FfmpegBuild."""
        storage = Storage(
            name="SDK Storage",
            path=os.path.join(self.temp_dir, "storage"),
            type="sdk",
        )
        self.db.add(storage)
        self.db.commit()

        sdk = InstalledSdk(
            target_app="ffmpeg",
            sdk_type="decklink",
            name="Blackmagic DeckLink SDK",
            version="14.2",
            storage_id=storage.id,
            relative_path="decklink/14.2",
            size_bytes=100,
            status="ready",
        )
        self.db.add(sdk)
        self.db.commit()

        build = FfmpegBuild(
            name="DeckLink Build",
            ffmpeg_version="6.1",
            install_path="/tmp/build_decklink",
            build_options={"enable_decklink": True},
            sdk_paths={"decklink": "decklink/14.2"},
        )
        self.db.add(build)
        self.db.commit()

        res = self.sdk_manager.delete_sdk(sdk.id, force=False, db=self.db)
        self.assertFalse(res.get("success"))
        self.assertTrue(res.get("in_use"))
        self.assertIn("DeckLink Build", res.get("used_by", []))

        # Ensure DB row was NOT deleted
        db_sdk = self.db.query(InstalledSdk).filter_by(id=sdk.id).first()
        self.assertIsNotNone(db_sdk)

        # Cleanup DB
        self.db.delete(build)
        self.db.delete(sdk)
        self.db.delete(storage)
        self.db.commit()

    def test_delete_sdk_force_true_referenced_and_unreferenced(self):
        """Test delete_sdk(sdk_id, force=True) marking status='missing' if referenced, or deleting DB row if unreferenced."""
        storage = Storage(
            name="SDK Storage",
            path=os.path.join(self.temp_dir, "storage"),
            type="sdk",
        )
        self.db.add(storage)
        self.db.commit()

        # 1. Referenced SDK with force=True -> status = "missing"
        sdk1_dir = os.path.join(storage.path, "decklink", "14.2")
        os.makedirs(sdk1_dir, exist_ok=True)
        sdk1 = InstalledSdk(
            target_app="ffmpeg",
            sdk_type="decklink",
            name="DeckLink SDK 14.2",
            version="14.2",
            storage_id=storage.id,
            relative_path="decklink/14.2",
            size_bytes=100,
            status="ready",
        )
        self.db.add(sdk1)
        self.db.commit()

        build = FfmpegBuild(
            name="Build Decklink 14.2 Unique Strategy Test",
            ffmpeg_version="6.1",
            install_path="/tmp/build_14_2",
            build_options={"decklink": True},
            sdk_paths={"decklink": "14.2"},
        )
        self.db.add(build)
        self.db.commit()

        res1 = self.sdk_manager.delete_sdk(sdk1.id, force=True, db=self.db)
        self.assertTrue(res1.get("success"))
        self.assertFalse(os.path.exists(sdk1_dir))

        self.db.refresh(sdk1)
        self.assertEqual(sdk1.status, "missing")

        # 2. Unreferenced SDK with force=True -> row deleted from DB
        sdk2_dir = os.path.join(storage.path, "ndi", "6.0")
        os.makedirs(sdk2_dir, exist_ok=True)
        sdk2 = InstalledSdk(
            target_app="ffmpeg",
            sdk_type="ndi",
            name="NDI SDK 6.0",
            version="6.0",
            storage_id=storage.id,
            relative_path="ndi/6.0",
            size_bytes=100,
            status="ready",
        )
        self.db.add(sdk2)
        self.db.commit()
        sdk2_id = sdk2.id

        res2 = self.sdk_manager.delete_sdk(sdk2_id, force=True, db=self.db)
        self.assertTrue(res2.get("success"))
        self.assertFalse(os.path.exists(sdk2_dir))

        db_sdk2 = self.db.query(InstalledSdk).filter_by(id=sdk2_id).first()
        self.assertIsNone(db_sdk2)

        # Cleanup DB
        self.db.delete(build)
        self.db.delete(sdk1)
        self.db.delete(storage)
        self.db.commit()


if __name__ == "__main__":
    unittest.main()
