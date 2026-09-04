import unittest
import asyncio
import os
import time
import tempfile
import configparser
import shutil
import gzip
from unittest.mock import MagicMock

from database.db import SessionLocal, init_db
from database.models import Service, Storage, ScheduledTask
from core.task_manager import TaskManager
from core.process_manager import ProcessManager

class TestLogLifecycle(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        init_db()
        self.db = SessionLocal()
        self.manager = TaskManager(lambda: SessionLocal())
        self.temp_dir = tempfile.TemporaryDirectory()
        self.log_dir = self.temp_dir.name

        # Create Storage record of type 'logs'
        self.storage = Storage(
            name="Test Logs Storage",
            type="logs",
            path=self.log_dir,
            is_default=True
        )
        self.db.add(self.storage)

        # Create an active service with id 1
        self.service1 = Service(
            id=101,
            name="Active Test Service",
            service_type="icecast_server",
            config={
                "log_storage_id": self.storage.id,
                "icecast_config": {
                    "port": 7000,
                    "admin_password": "testpassword"
                }
            }
        )
        self.db.add(self.service1)
        self.db.commit()

    async def asyncTearDown(self):
        self.db.query(Service).filter(Service.id == 101).delete()
        self.db.query(Storage).filter(Storage.id == self.storage.id).delete()
        self.db.commit()
        self.db.close()
        self.temp_dir.cleanup()

    def test_icecast_config_logsize_and_archive_tags(self):
        """Verifies that generated icecast.xml includes <logsize> and <logarchive> tags."""
        pm = ProcessManager(lambda: SessionLocal())
        cmd, ephem_xml = pm._build_icecast_config_and_cmd(self.service1, "icecast", self.db, log_storage_path=self.log_dir)
        
        self.assertTrue(os.path.exists(ephem_xml))
        try:
            with open(ephem_xml, "r", encoding="utf-8") as f:
                content = f.read()
            self.assertIn("<logsize>10240</logsize>", content)
            self.assertIn("<logarchive>1</logarchive>", content)
            self.assertIn(f"<logdir>{os.path.join(self.log_dir, 'icecast_101')}</logdir>", content)
        finally:
            if os.path.exists(ephem_xml):
                os.remove(ephem_xml)

    async def test_execute_log_rotate_purges_expired_archives(self):
        """Verifies that archives older than retention_days are purged, while active logs are preserved."""
        config_path = os.path.join(self.temp_dir.name, "test.conf")
        config = configparser.ConfigParser()
        config["logging"] = {
            "mode": "both",
            "file_path": os.path.join(self.log_dir, "app.log"),
            "retention_days": "2",
            "rotation_max_bytes": "10485760"
        }
        with open(config_path, "w") as f:
            config.write(f)

        os.environ["CONFIG_FILE_PATH"] = config_path

        # 1. Active process log
        active_proc_log = os.path.join(self.log_dir, "process_101.log")
        with open(active_proc_log, "w") as f:
            f.write("active process log content")

        # 2. Rotated archive 1 day ago (preserve)
        arch_preserve = os.path.join(self.log_dir, "process_101.log.1.gz")
        with open(arch_preserve, "w") as f:
            f.write("recent archive")
        one_day_ago = time.time() - (24 * 3600 * 1)
        os.utime(arch_preserve, (one_day_ago, one_day_ago))

        # 3. Rotated archive 5 days ago (delete)
        arch_delete = os.path.join(self.log_dir, "process_101.log.2.gz")
        with open(arch_delete, "w") as f:
            f.write("old archive")
        five_days_ago = time.time() - (24 * 3600 * 5)
        os.utime(arch_delete, (five_days_ago, five_days_ago))

        logs = []
        await self.manager._execute_log_rotate(lambda m: logs.append(m), lambda m: logs.append(m))

        self.assertTrue(os.path.exists(active_proc_log), "Active process log must be preserved")
        self.assertTrue(os.path.exists(arch_preserve), "Recent archive (1 day old) must be preserved")
        self.assertFalse(os.path.exists(arch_delete), "Expired archive (5 days old) must be deleted")

    async def test_execute_log_rotate_rotates_oversized_process_log(self):
        """Verifies that process_{id}.log exceeding max_bytes is rotated via copytruncate to .1.gz."""
        config_path = os.path.join(self.temp_dir.name, "test.conf")
        config = configparser.ConfigParser()
        config["logging"] = {
            "retention_days": "7",
            "rotation_max_bytes": "500",
            "compression_enabled": "true"
        }
        with open(config_path, "w") as f:
            config.write(f)

        os.environ["CONFIG_FILE_PATH"] = config_path

        proc_log = os.path.join(self.log_dir, "process_101.log")
        large_content = b"X" * 1500
        with open(proc_log, "wb") as f:
            f.write(large_content)

        rotated_gz = os.path.join(self.log_dir, "process_101.log.1.gz")
        if os.path.exists(rotated_gz):
            os.remove(rotated_gz)

        logs = []
        await self.manager._execute_log_rotate(lambda m: logs.append(m), lambda m: logs.append(m))

        self.assertTrue(os.path.exists(rotated_gz), "Rotated .1.gz should be created")
        self.assertEqual(os.path.getsize(proc_log), 0, "Original log must be truncated to 0 for continuous append")

        # Verify gz content decompresses properly
        with gzip.open(rotated_gz, "rb") as f_gz:
            decompressed = f_gz.read()
        self.assertEqual(decompressed, large_content)

    async def test_execute_log_rotate_icecast_archives_compression_and_retention(self):
        """Verifies icecast directory log management: uncompressed .old is compressed, expired archives purged."""
        config_path = os.path.join(self.temp_dir.name, "test.conf")
        config = configparser.ConfigParser()
        config["logging"] = {
            "retention_days": "3",
            "rotation_max_bytes": "10485760",
            "compression_enabled": "true"
        }
        with open(config_path, "w") as f:
            config.write(f)

        os.environ["CONFIG_FILE_PATH"] = config_path

        ice_dir = os.path.join(self.log_dir, "icecast_101")
        os.makedirs(ice_dir, exist_ok=True)

        # 1. Active access.log
        access_log = os.path.join(ice_dir, "access.log")
        with open(access_log, "w") as f:
            f.write("active access")

        # 2. Uncompressed .old rotated yesterday -> should be compressed to access.log.old.gz
        old_log = os.path.join(ice_dir, "access.log.old")
        with open(old_log, "w") as f:
            f.write("yesterday rotated icecast log")
        one_day_ago = time.time() - (24 * 3600 * 1)
        os.utime(old_log, (one_day_ago, one_day_ago))

        # 3. Expired .gz archive 6 days ago -> should be deleted
        expired_gz = os.path.join(ice_dir, "error.log.old.gz")
        with open(expired_gz, "w") as f:
            f.write("ancient compressed log")
        six_days_ago = time.time() - (24 * 3600 * 6)
        os.utime(expired_gz, (six_days_ago, six_days_ago))

        logs = []
        await self.manager._execute_log_rotate(lambda m: logs.append(m), lambda m: logs.append(m))

        self.assertTrue(os.path.exists(access_log), "Active access.log must be preserved")
        self.assertFalse(os.path.exists(old_log), "Uncompressed .old should be replaced by .gz")
        self.assertTrue(os.path.exists(f"{old_log}.gz"), "access.log.old.gz should exist")
        self.assertFalse(os.path.exists(expired_gz), "Expired archive (6 days old) must be deleted")

    async def test_execute_log_rotate_cleans_orphaned_logs_and_dirs(self):
        """Verifies that logs and icecast dirs for deleted/non-existent service IDs are removed."""
        config_path = os.path.join(self.temp_dir.name, "test.conf")
        config = configparser.ConfigParser()
        config["logging"] = {"retention_days": "30"}
        with open(config_path, "w") as f:
            config.write(f)
        os.environ["CONFIG_FILE_PATH"] = config_path

        # Service ID 999 does NOT exist in DB
        orphan_proc_log = os.path.join(self.log_dir, "process_999.log")
        orphan_proc_arch = os.path.join(self.log_dir, "process_999.log.1.gz")
        with open(orphan_proc_log, "w") as f:
            f.write("orphan")
        with open(orphan_proc_arch, "w") as f:
            f.write("orphan arch")

        orphan_ice_dir = os.path.join(self.log_dir, "icecast_999")
        os.makedirs(orphan_ice_dir, exist_ok=True)
        with open(os.path.join(orphan_ice_dir, "access.log"), "w") as f:
            f.write("orphan icecast")

        logs = []
        await self.manager._execute_log_rotate(lambda m: logs.append(m), lambda m: logs.append(m))

        self.assertFalse(os.path.exists(orphan_proc_log), "Orphan process log must be deleted")
        self.assertFalse(os.path.exists(orphan_proc_arch), "Orphan process archive must be deleted")
        self.assertFalse(os.path.exists(orphan_ice_dir), "Orphan icecast dir must be deleted")

    def test_delete_process_cleans_logs_and_icecast_dir(self):
        """Verifies that calling DELETE /processes/{id} physically deletes all associated process logs and icecast directory."""
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        # Create a service to delete
        svc_to_delete = Service(
            name="Deletable Service",
            service_type="icecast_server",
            log_storage_id=self.storage.id,
            config={"log_storage_id": self.storage.id}
        )
        self.db.add(svc_to_delete)
        self.db.commit()
        self.db.refresh(svc_to_delete)
        svc_id = svc_to_delete.id

        # Populate files in storage
        p_log = os.path.join(self.log_dir, f"process_{svc_id}.log")
        p_arch = os.path.join(self.log_dir, f"process_{svc_id}.log.1.gz")
        ice_dir = os.path.join(self.log_dir, f"icecast_{svc_id}")
        os.makedirs(ice_dir, exist_ok=True)
        with open(p_log, "w") as f:
            f.write("active log")
        with open(p_arch, "w") as f:
            f.write("archived log")
        with open(os.path.join(ice_dir, "access.log"), "w") as f:
            f.write("icecast log")

        self.assertTrue(os.path.exists(p_log))
        self.assertTrue(os.path.exists(p_arch))
        self.assertTrue(os.path.exists(ice_dir))

        # Invoke delete endpoint
        resp = client.delete(f"/processes/{svc_id}")
        self.assertEqual(resp.status_code, 200)

        # Verify all files and directories have been purged
        self.assertFalse(os.path.exists(p_log), "process_{id}.log must be removed upon process deletion")
        self.assertFalse(os.path.exists(p_arch), "process_{id}.log.1.gz must be removed upon process deletion")
        self.assertFalse(os.path.exists(ice_dir), "icecast_{id} directory must be removed upon process deletion")

if __name__ == "__main__":
    unittest.main()

