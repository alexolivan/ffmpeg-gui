import unittest
import datetime
from database.db import SessionLocal, init_db
from database.models import Storage, FfmpegBuild

class TestStorageSchema(unittest.TestCase):
    def setUp(self):
        init_db()
        self.db = SessionLocal()

    def tearDown(self):
        self.db.close()

    def test_storage_creation_and_relationship(self):
        # Create a Storage record
        storage = Storage(
            name="Test Build Storage",
            path="/tmp/ffmpeg-builds-test",
            type="build",
            is_default=True
        )
        self.db.add(storage)
        self.db.commit()
        self.db.refresh(storage)
        
        self.assertIsNotNone(storage.id)
        self.assertEqual(storage.name, "Test Build Storage")
        self.assertEqual(storage.path, "/tmp/ffmpeg-builds-test")
        self.assertEqual(storage.type, "build")
        self.assertTrue(storage.is_default)
        self.assertIsNotNone(storage.created_at)

        # Create an FfmpegBuild and associate it with the Storage
        build = FfmpegBuild(
            name="Test Build For Storage",
            ffmpeg_version="6.0",
            srt_version="1.5.0",
            build_options={"enable_gpl": True},
            install_path="/tmp/ffmpeg-builds-test/test-build-profile",
            status="pending",
            storage_id=storage.id
        )
        self.db.add(build)
        self.db.commit()
        self.db.refresh(build)

        self.assertIsNotNone(build.id)
        self.assertEqual(build.storage_id, storage.id)
        
        # Verify relationship from FfmpegBuild -> Storage
        self.assertIsNotNone(build.storage)
        self.assertEqual(build.storage.name, "Test Build Storage")
        
        # Verify relationship from Storage -> FfmpegBuild
        self.assertEqual(len(storage.builds), 1)
        self.assertEqual(storage.builds[0].name, "Test Build For Storage")

        # Cleanup
        self.db.delete(build)
        self.db.delete(storage)
        self.db.commit()
