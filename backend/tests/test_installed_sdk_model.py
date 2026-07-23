import unittest
from database.db import SessionLocal, init_db
from database.models import Storage, InstalledSdk


class TestInstalledSdkModel(unittest.TestCase):
    def setUp(self):
        init_db()
        self.db = SessionLocal()

    def tearDown(self):
        self.db.close()

    def test_create_installed_sdk(self):
        storage = Storage(
            name="SDK Storage",
            path="/var/lib/ffmpeg-gui/sdks",
            type="sdk",
            is_default=True
        )
        self.db.add(storage)
        self.db.commit()
        self.db.refresh(storage)

        sdk = InstalledSdk(
            target_app="ffmpeg",
            sdk_type="decklink",
            name="Blackmagic DeckLink SDK",
            version="14.2",
            storage_id=storage.id,
            relative_path="sdks/decklink/14.2",
            size_bytes=1048576,
            status="ready"
        )
        self.db.add(sdk)
        self.db.commit()
        self.db.refresh(sdk)

        self.assertIsNotNone(sdk.id)
        self.assertEqual(sdk.target_app, "ffmpeg")
        self.assertEqual(sdk.sdk_type, "decklink")
        self.assertEqual(sdk.name, "Blackmagic DeckLink SDK")
        self.assertEqual(sdk.version, "14.2")
        self.assertEqual(sdk.storage_id, storage.id)
        self.assertEqual(sdk.relative_path, "sdks/decklink/14.2")
        self.assertEqual(sdk.size_bytes, 1048576)
        self.assertEqual(sdk.status, "ready")
        self.assertIsNotNone(sdk.created_at)

        # Clean up
        self.db.delete(sdk)
        self.db.delete(storage)
        self.db.commit()

    def test_query_filtering(self):
        storage = Storage(name="SDK Storage", path="/tmp/sdks", type="sdk")
        self.db.add(storage)
        self.db.commit()
        self.db.refresh(storage)

        sdk1 = InstalledSdk(
            target_app="ffmpeg",
            sdk_type="decklink",
            name="DeckLink SDK 14.2",
            version="14.2",
            storage_id=storage.id,
            relative_path="sdks/decklink/14.2",
            size_bytes=1048576,
            status="ready"
        )
        sdk2 = InstalledSdk(
            target_app="ffmpeg",
            sdk_type="decklink",
            name="DeckLink SDK 12.4",
            version="12.4",
            storage_id=storage.id,
            relative_path="sdks/decklink/12.4",
            size_bytes=2048576,
            status="ready"
        )
        sdk3 = InstalledSdk(
            target_app="ffmpeg",
            sdk_type="ndi",
            name="NDI SDK 6.0",
            version="6.0",
            storage_id=storage.id,
            relative_path="sdks/ndi/6.0",
            size_bytes=500000,
            status="ready"
        )
        self.db.add_all([sdk1, sdk2, sdk3])
        self.db.commit()

        # Query by sdk_type and version
        results = self.db.query(InstalledSdk).filter(
            InstalledSdk.sdk_type == "decklink",
            InstalledSdk.version == "14.2"
        ).all()
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].name, "DeckLink SDK 14.2")

        # Cleanup
        self.db.delete(sdk1)
        self.db.delete(sdk2)
        self.db.delete(sdk3)
        self.db.delete(storage)
        self.db.commit()

    def test_storage_relationship(self):
        storage = Storage(name="SDK Storage Rel", path="/tmp/sdks_rel", type="sdk")
        self.db.add(storage)
        self.db.commit()
        self.db.refresh(storage)

        sdk = InstalledSdk(
            target_app="ffmpeg",
            sdk_type="decklink",
            name="DeckLink SDK 14.2",
            version="14.2",
            storage_id=storage.id,
            relative_path="sdks/decklink/14.2",
            size_bytes=1048576,
            status="ready"
        )
        self.db.add(sdk)
        self.db.commit()
        self.db.refresh(sdk)

        self.assertIsNotNone(sdk.storage)
        self.assertEqual(sdk.storage.name, "SDK Storage Rel")

        # Cleanup
        self.db.delete(sdk)
        self.db.delete(storage)
        self.db.commit()
