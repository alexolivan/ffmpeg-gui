import unittest
import os
import tempfile
import importlib
from database.models import Storage

class TestStorageSeeding(unittest.TestCase):
    def setUp(self):
        # Create a temporary file for the SQLite database
        self.db_fd, self.db_path = tempfile.mkstemp()
        
        # Save original environment and database module reference
        self.original_db_path_env = os.environ.get("DATABASE_PATH")
        os.environ["DATABASE_PATH"] = self.db_path
        
        # Reload database.db to bind it to the temporary database
        import database.db
        importlib.reload(database.db)
        self.db_module = database.db

    def tearDown(self):
        # Close the temporary database file descriptor and delete the file
        os.close(self.db_fd)
        if os.path.exists(self.db_path):
            os.unlink(self.db_path)
            
        # Restore original DATABASE_PATH environment variable
        if self.original_db_path_env is not None:
            os.environ["DATABASE_PATH"] = self.original_db_path_env
        elif "DATABASE_PATH" in os.environ:
            del os.environ["DATABASE_PATH"]
            
        # Reload database.db again to restore the original configuration
        importlib.reload(self.db_module)

    def test_default_storages_seeding(self):
        # 1. Run database initialization which should trigger schema creation and seeding
        self.db_module.init_db()
        
        # 2. Query the seeded storages using a new session
        db = self.db_module.SessionLocal()
        try:
            storages = db.query(Storage).all()
            
            # Assert exactly 4 default storage records
            self.assertEqual(len(storages), 4)
            
            # Prepare expected storages data mapping
            expected = {
                "Default Build Storage": {
                    "path": os.path.abspath("ffmpeg_builds"),
                    "type": "build",
                    "is_default": True
                },
                "Default Media Storage": {
                    "path": os.path.abspath("data/uploads"),
                    "type": "media",
                    "is_default": True
                },
                "Default SDK Storage": {
                    "path": os.path.abspath("data/sdks"),
                    "type": "sdk",
                    "is_default": True
                },
                "Default Preview Storage": {
                    "path": os.path.abspath("/tmp/ffmpeg-gui-previews"),
                    "type": "preview",
                    "is_default": True
                }
            }
            
            for storage in storages:
                self.assertIn(storage.name, expected)
                exp = expected[storage.name]
                self.assertEqual(storage.type, exp["type"])
                self.assertEqual(storage.path, exp["path"])
                self.assertEqual(storage.is_default, exp["is_default"])
                # Assert path is absolute
                self.assertTrue(os.path.isabs(storage.path))
                
        finally:
            db.close()

    def test_seeding_skips_if_not_empty(self):
        # 1. First run init_db to seed the database
        self.db_module.init_db()
        
        # 2. Verify we have 4 storages
        db = self.db_module.SessionLocal()
        try:
            self.assertEqual(db.query(Storage).count(), 4)
            
            # 3. Add a custom storage record
            custom_storage = Storage(
                name="Custom Storage",
                path=os.path.abspath("custom_path"),
                type="media",
                is_default=False
            )
            db.add(custom_storage)
            db.commit()
            
            self.assertEqual(db.query(Storage).count(), 5)
            
            # 4. Run init_db again, it should NOT add any duplicate default records
            self.db_module.init_db()
            
            # Count must still be 5
            self.assertEqual(db.query(Storage).count(), 5)
        finally:
            db.close()
