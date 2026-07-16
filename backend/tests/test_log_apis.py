import unittest
import os
import sys
import tempfile
import importlib
import shutil
from fastapi.testclient import TestClient

# Ensure backend folder is in path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

class TestLogAPIs(unittest.TestCase):
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
        
        # Point the default logs storage path in the DB to our temp_dir
        from database.models import Storage
        default_logs_storage = self.db.query(Storage).filter(Storage.type == "logs", Storage.is_default == True).first()
        if default_logs_storage:
            default_logs_storage.path = self.temp_dir
        else:
            # If not found, insert one
            default_logs_storage = Storage(
                name="Default Logs Storage",
                path=self.temp_dir,
                type="logs",
                is_default=True
            )
            self.db.add(default_logs_storage)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        # Drop all tables to start clean for the next test
        self.db_module.Base.metadata.drop_all(bind=self.db_module.engine)
        
        # Clean up the temporary directory
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)

    def test_log_exists_endpoint(self):
        from database.models import MediaProcess
        
        # 1. Non-existent process returns 404
        res = self.client.get("/api/processes/9999/log-exists")
        self.assertEqual(res.status_code, 404)
        
        # 2. Existent process, log file doesn't exist -> False
        proc = MediaProcess(
            name="Test Process 1",
            type="service",
            input_config={"type": "lavfi", "path": "testsrc"},
            output_config={"type": "file", "path": "/tmp/out.mp4"},
            codec_config={"vcodec": "libx264"},
            status="stopped"
        )
        self.db.add(proc)
        self.db.commit()
        proc_id = proc.id
        
        res = self.client.get(f"/api/processes/{proc_id}/log-exists")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"exists": False})
        
        # 3. Create log file, but size is 0 -> False
        log_path = os.path.join(self.temp_dir, f"process_{proc_id}.log")
        with open(log_path, "w") as f:
            pass
            
        res = self.client.get(f"/api/processes/{proc_id}/log-exists")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"exists": False})
        
        # 4. Log file size > 0 -> True
        with open(log_path, "w") as f:
            f.write("Log line content\n")
            
        res = self.client.get(f"/api/processes/{proc_id}/log-exists")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"exists": True})

    def test_download_log_endpoint(self):
        from database.models import MediaProcess
        
        # 1. Non-existent process -> 404
        res = self.client.get("/api/processes/9999/download-log")
        self.assertEqual(res.status_code, 404)
        
        # 2. Existent process, log file doesn't exist -> 404
        proc = MediaProcess(
            name="Test Process 2",
            type="service",
            input_config={"type": "lavfi", "path": "testsrc"},
            output_config={"type": "file", "path": "/tmp/out.mp4"},
            codec_config={"vcodec": "libx264"},
            status="stopped"
        )
        self.db.add(proc)
        self.db.commit()
        proc_id = proc.id
        
        res = self.client.get(f"/api/processes/{proc_id}/download-log")
        self.assertEqual(res.status_code, 404)
        
        # 3. Create log file, check download
        log_path = os.path.join(self.temp_dir, f"process_{proc_id}.log")
        log_content = "This is a sample log file content.\nLine 2.\n"
        with open(log_path, "w") as f:
            f.write(log_content)
            
        res = self.client.get(f"/api/processes/{proc_id}/download-log")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.text, log_content)
        self.assertEqual(res.headers.get("content-type"), "text/plain; charset=utf-8")
        self.assertIn(f"process_{proc_id}.log", res.headers.get("content-disposition", ""))

    def test_progress_endpoint(self):
        proc_id = 12345
        
        # 1. File doesn't exist -> default/empty values
        res = self.client.get(f"/api/processes/{proc_id}/progress")
        self.assertEqual(res.status_code, 200)
        default_data = res.json()
        self.assertEqual(default_data["frame"], 0)
        self.assertEqual(default_data["fps"], 0.0)
        self.assertEqual(default_data["bitrate"], "N/A")
        self.assertEqual(default_data["speed"], "N/A")
        self.assertEqual(default_data["out_time"], "N/A")
        self.assertEqual(default_data["dup_frames"], 0)
        self.assertEqual(default_data["drop_frames"], 0)
        self.assertEqual(default_data["progress"], "N/A")
        
        # 2. File exists (we will write to /tmp/ffmpeg_progress_{proc_id}.log)
        tmp_progress_path = f"/tmp/ffmpeg_progress_{proc_id}.log"
        progress_content = """frame=523
fps=29.97
bitrate=4500.2kbits/s
speed=1.05x
out_time=00:01:23.450000
dup_frames=2
drop_frames=1
progress=continue
"""
        try:
            with open(tmp_progress_path, "w") as f:
                f.write(progress_content)
                
            res = self.client.get(f"/api/processes/{proc_id}/progress")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data["frame"], 523)
            self.assertEqual(data["fps"], 29.97)
            self.assertEqual(data["bitrate"], "4500.2kbits/s")
            self.assertEqual(data["speed"], "1.05x")
            self.assertEqual(data["out_time"], "00:01:23.450000")
            self.assertEqual(data["dup_frames"], 2)
            self.assertEqual(data["drop_frames"], 1)
            self.assertEqual(data["progress"], "continue")
        finally:
            if os.path.exists(tmp_progress_path):
                os.remove(tmp_progress_path)

    def test_process_deletion_deletes_log_file(self):
        from database.models import MediaProcess
        
        # Create process
        proc = MediaProcess(
            name="Test Process 3",
            type="service",
            input_config={"type": "lavfi", "path": "testsrc"},
            output_config={"type": "file", "path": "/tmp/out.mp4"},
            codec_config={"vcodec": "libx264"},
            status="stopped"
        )
        self.db.add(proc)
        self.db.commit()
        proc_id = proc.id
        
        # Create log file
        log_path = os.path.join(self.temp_dir, f"process_{proc_id}.log")
        with open(log_path, "w") as f:
            f.write("Log contents")
        self.assertTrue(os.path.exists(log_path))
        
        # Delete process via API
        res = self.client.delete(f"/processes/{proc_id}")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "deleted")
        
        # Verify log file deleted from disk
        self.assertFalse(os.path.exists(log_path))
