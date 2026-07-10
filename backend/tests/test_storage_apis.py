import unittest
import os
import sys
import tempfile
import importlib
import shutil
from fastapi.testclient import TestClient

# Ensure backend folder is in path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

class TestStorageAPIs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Create a temporary file for the SQLite database
        cls.db_fd, cls.db_path = tempfile.mkstemp()
        cls.original_db_path_env = os.environ.get("DATABASE_PATH")
        os.environ["DATABASE_PATH"] = cls.db_path
        
        # Reload database.db to bind it to the temporary database
        import database.db
        importlib.reload(database.db)
        cls.db_module = database.db
        
        # Reload main to ensure get_db dependency uses the reloaded SessionLocal
        import main
        importlib.reload(main)
        cls.main_module = main
        cls.client = TestClient(main.app)

    @classmethod
    def tearDownClass(cls):
        # Close the temporary database file descriptor and delete the file
        os.close(cls.db_fd)
        if os.path.exists(cls.db_path):
            os.unlink(cls.db_path)
            
        # Restore original DATABASE_PATH environment variable
        if cls.original_db_path_env is not None:
            os.environ["DATABASE_PATH"] = cls.original_db_path_env
        elif "DATABASE_PATH" in os.environ:
            del os.environ["DATABASE_PATH"]
            
        # Reload database.db and main again to restore the original configuration
        import database.db
        importlib.reload(database.db)
        import main
        importlib.reload(main)

    def setUp(self):
        # Initialize tables and seed default storages
        self.db_module.init_db()
        self.db = self.db_module.SessionLocal()
        
        # Create a temporary directory for path-based testing
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        self.db.close()
        # Drop all tables to start clean for the next test
        self.db_module.Base.metadata.drop_all(bind=self.db_module.engine)
        
        # Clean up the temporary directory
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)

    def test_get_storages(self):
        # Fetch default seeded storages
        res = self.client.get("/settings/storages")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        
        # Should have exactly 4 seeded default storages
        self.assertEqual(len(data), 4)
        
        # Verify default storage names and that they have stats populated
        names = [item["name"] for item in data]
        self.assertIn("Default Build Storage", names)
        self.assertIn("Default Media Storage", names)
        self.assertIn("Default SDK Storage", names)
        self.assertIn("Default Preview Storage", names)
        
        for storage in data:
            self.assertTrue(storage["is_default"])
            self.assertIn("total", storage)
            self.assertIn("used", storage)
            self.assertIn("free", storage)
            self.assertIn("percent", storage)
            self.assertIn("stats", storage)
            # Stats should have same values
            self.assertEqual(storage["total"], storage["stats"]["total"])
            self.assertTrue(os.path.isabs(storage["path"]))

    def test_create_storage_success(self):
        test_path = os.path.join(self.temp_dir, "custom_media")
        
        payload = {
            "name": "Custom Media Storage",
            "path": test_path,
            "type": "media"
        }
        res = self.client.post("/settings/storages", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        
        self.assertEqual(data["name"], "Custom Media Storage")
        self.assertEqual(data["path"], os.path.abspath(test_path))
        self.assertEqual(data["type"], "media")
        self.assertFalse(data["is_default"])
        
        # Verify the path was created
        self.assertTrue(os.path.exists(test_path))
        
        # Verify it shows up in GET /settings/storages
        res_get = self.client.get("/settings/storages")
        self.assertEqual(res_get.status_code, 200)
        storages = res_get.json()
        self.assertEqual(len(storages), 5)
        names = [item["name"] for item in storages]
        self.assertIn("Custom Media Storage", names)

    def test_create_storage_invalid_type(self):
        test_path = os.path.join(self.temp_dir, "custom_invalid")
        payload = {
            "name": "Custom Invalid Storage",
            "path": test_path,
            "type": "invalid_type"
        }
        res = self.client.post("/settings/storages", json=payload)
        # Should raise HTTP 422 (Pydantic validation if constrained, or HTTP 400 if validation is custom)
        # Our endpoint explicitly returns HTTP 400 for invalid types
        self.assertEqual(res.status_code, 400)

    def test_create_storage_unwritable_path(self):
        # We simulate a path that cannot be created or accessed by using an invalid directory path
        # (e.g. containing invalid characters or system-restricted paths)
        # Note: on Unix, trying to make directories in a restricted folder or using a path with null bytes/uncreatable
        invalid_path = "/sys/kernel/restricted_nonexistent_directory_test_abc"
        payload = {
            "name": "Restricted Storage",
            "path": invalid_path,
            "type": "logs"
        }
        res = self.client.post("/settings/storages", json=payload)
        self.assertEqual(res.status_code, 400)

    def test_create_storage_duplicate_type_and_path(self):
        test_path = os.path.join(self.temp_dir, "duplicate_path")
        payload = {
            "name": "First Storage",
            "path": test_path,
            "type": "build"
        }
        res1 = self.client.post("/settings/storages", json=payload)
        self.assertEqual(res1.status_code, 200)
        
        # Try to create another storage with the same type and path
        payload_dup = {
            "name": "Second Storage",
            "path": test_path,
            "type": "build"
        }
        res2 = self.client.post("/settings/storages", json=payload_dup)
        self.assertEqual(res2.status_code, 400)

    def test_update_storage_success(self):
        test_path_1 = os.path.join(self.temp_dir, "path1")
        test_path_2 = os.path.join(self.temp_dir, "path2")
        
        # Create
        payload = {
            "name": "Storage to Update",
            "path": test_path_1,
            "type": "sdk"
        }
        res = self.client.post("/settings/storages", json=payload)
        self.assertEqual(res.status_code, 200)
        storage_id = res.json()["id"]
        
        # Update name and path
        update_payload = {
            "name": "Storage Updated",
            "path": test_path_2
        }
        res_put = self.client.put(f"/settings/storages/{storage_id}", json=update_payload)
        self.assertEqual(res_put.status_code, 200)
        data = res_put.json()
        
        self.assertEqual(data["name"], "Storage Updated")
        self.assertEqual(data["path"], os.path.abspath(test_path_2))
        self.assertTrue(os.path.exists(test_path_2))

    def test_update_storage_default_restricted(self):
        # Fetch default storages to get a default id
        res = self.client.get("/settings/storages")
        default_storage_id = res.json()[0]["id"]
        
        update_payload = {
            "name": "Trying to update default",
            "path": "/tmp/new_default_path"
        }
        res_put = self.client.put(f"/settings/storages/{default_storage_id}", json=update_payload)
        self.assertEqual(res_put.status_code, 400)
        self.assertEqual(res_put.json()["detail"], "Cannot edit a default storage")

    def test_delete_storage_success(self):
        test_path = os.path.join(self.temp_dir, "delete_test")
        payload = {
            "name": "Storage to Delete",
            "path": test_path,
            "type": "hls"
        }
        res = self.client.post("/settings/storages", json=payload)
        self.assertEqual(res.status_code, 200)
        storage_id = res.json()["id"]
        
        # Delete
        res_del = self.client.delete(f"/settings/storages/{storage_id}")
        self.assertEqual(res_del.status_code, 200)
        self.assertEqual(res_del.json()["status"], "deleted")
        
        # Confirm it's gone from database
        from database.models import Storage
        db_storage = self.db.query(Storage).filter(Storage.id == storage_id).first()
        self.assertIsNone(db_storage)

    def test_delete_storage_default_restricted(self):
        # Fetch default storages to get a default id
        res = self.client.get("/settings/storages")
        default_storage_id = res.json()[0]["id"]
        
        res_del = self.client.delete(f"/settings/storages/{default_storage_id}")
        self.assertEqual(res_del.status_code, 400)
        self.assertEqual(res_del.json()["detail"], "Cannot delete default storages")

    def test_delete_storage_in_use(self):
        # Create storage
        test_path = os.path.join(self.temp_dir, "in_use_test")
        payload = {
            "name": "In Use Storage",
            "path": test_path,
            "type": "build"
        }
        res = self.client.post("/settings/storages", json=payload)
        self.assertEqual(res.status_code, 200)
        storage_id = res.json()["id"]
        
        # Create FfmpegBuild referencing this storage
        from database.models import FfmpegBuild
        build = FfmpegBuild(
            name="API Build Storage Test Profile",
            ffmpeg_version="6.0",
            srt_version="1.5.0",
            build_options={"enable_gpl": True},
            install_path="/tmp/install/dummy",
            status="pending",
            storage_id=storage_id
        )
        self.db.add(build)
        self.db.commit()
        
        # Try to delete the storage
        res_del = self.client.delete(f"/settings/storages/{storage_id}")
        self.assertEqual(res_del.status_code, 400)
        self.assertEqual(res_del.json()["detail"], "Cannot delete storage: it is currently in use by build profile(s).")
        
        # Clean up build first so tearDown metadata drop works cleanly
        self.db.delete(build)
        self.db.commit()

    def test_connection_endpoint(self):
        test_path = os.path.join(self.temp_dir, "test_conn")
        
        # Test valid path
        payload = {"path": test_path}
        res = self.client.post("/settings/storages/test", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        
        self.assertTrue(data["valid"])
        self.assertEqual(data["path"], os.path.abspath(test_path))
        self.assertIn("total", data)
        self.assertIn("stats", data)
        
        # Verify that no database record was created
        from database.models import Storage
        db_storage = self.db.query(Storage).filter(Storage.path == os.path.abspath(test_path)).first()
        self.assertIsNone(db_storage)
        
        # Test invalid path
        invalid_path = "/sys/kernel/restricted_nonexistent_directory_test_abc"
        payload_invalid = {"path": invalid_path}
        res_invalid = self.client.post("/settings/storages/test", json=payload_invalid)
        self.assertEqual(res_invalid.status_code, 400)

    def test_build_storage_creation_and_migration(self):
        # Create storage 1
        path1 = os.path.join(self.temp_dir, "build_storage_1")
        res1 = self.client.post("/settings/storages", json={"name": "BS 1", "path": path1, "type": "build"})
        self.assertEqual(res1.status_code, 200)
        storage1_id = res1.json()["id"]

        # Create storage 2
        path2 = os.path.join(self.temp_dir, "build_storage_2")
        res2 = self.client.post("/settings/storages", json={"name": "BS 2", "path": path2, "type": "build"})
        self.assertEqual(res2.status_code, 200)
        storage2_id = res2.json()["id"]

        # Create a build profile with storage1_id
        build_payload = {
            "name": "Storage Test Build Profile",
            "ffmpeg_version": "n8.1.1",
            "srt_version": "v1.5.3",
            "build_options": {"whip": True},
            "sdk_paths": {},
            "auto_clean": False,
            "storage_id": storage1_id
        }
        res_build = self.client.post("/builds", json=build_payload)
        self.assertEqual(res_build.status_code, 200)
        build_id = res_build.json()["id"]
        
        # Verify the build database record has storage_id set and correct install path
        from database.models import FfmpegBuild
        db_build = self.db.query(FfmpegBuild).get(build_id)
        self.assertEqual(db_build.storage_id, storage1_id)
        self.assertTrue(db_build.install_path.startswith(os.path.abspath(path1)))

        # Simulate compiling has finished and binaries exist at path1
        # Create a dummy folder and files at path1/[build_id]/install/bin/ffmpeg
        dummy_bin_dir = os.path.join(path1, str(build_id), "install", "bin")
        os.makedirs(dummy_bin_dir, exist_ok=True)
        ffmpeg_file = os.path.join(dummy_bin_dir, "ffmpeg")
        ffprobe_file = os.path.join(dummy_bin_dir, "ffprobe")
        with open(ffmpeg_file, "w") as f:
            f.write("dummy ffmpeg")
        with open(ffprobe_file, "w") as f:
            f.write("dummy ffprobe")

        # Update build's binary paths in db
        db_build.ffmpeg_binary = ffmpeg_file
        db_build.ffprobe_binary = ffprobe_file
        self.db.commit()

        # Update the build to use storage2_id
        update_payload = {
            "storage_id": storage2_id
        }
        res_update = self.client.put(f"/builds/{build_id}", json=update_payload)
        self.assertEqual(res_update.status_code, 200)
        
        # Refresh from DB and verify update
        self.db.refresh(db_build)
        self.assertEqual(db_build.storage_id, storage2_id)
        
        # Check that physical directory has been moved from path1 to path2
        old_dir = os.path.join(path1, str(build_id))
        new_dir = os.path.join(path2, str(build_id))
        self.assertFalse(os.path.exists(old_dir))
        self.assertTrue(os.path.exists(new_dir))
        
        # Verify that database binary paths are updated to point to path2
        self.assertTrue(db_build.ffmpeg_binary.startswith(os.path.abspath(path2)))
        self.assertTrue(db_build.ffprobe_binary.startswith(os.path.abspath(path2)))
        self.assertTrue(os.path.exists(db_build.ffmpeg_binary))
        self.assertTrue(os.path.exists(db_build.ffprobe_binary))
