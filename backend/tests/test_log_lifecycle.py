import unittest
import asyncio
import errno
import os
import time
import tempfile
import configparser
import shutil
import gzip
from collections import namedtuple
from unittest.mock import MagicMock, patch

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

    async def test_execute_log_rotate_rotates_and_purges_access_log(self):
        """Verifies that access.log is rotated via copytruncate when oversized and expired archives are purged."""
        config_path = os.path.join(self.temp_dir.name, "test_access.conf")
        config = configparser.ConfigParser()
        config["logging"] = {
            "mode": "file",
            "file_path": os.path.join(self.log_dir, "ffmpeg-gui.log"),
            "access_log_path": os.path.join(self.log_dir, "access.log"),
            "retention_days": "2",
            "rotation_max_bytes": "500",
            "compression_enabled": "true"
        }
        with open(config_path, "w") as f:
            config.write(f)
        os.environ["CONFIG_FILE_PATH"] = config_path

        # 1. Active oversized access.log
        access_log = os.path.join(self.log_dir, "access.log")
        access_data = b"ACCESS_ENTRY\n" * 50  # ~650 bytes > 500 max_bytes
        with open(access_log, "wb") as f:
            f.write(access_data)

        # 2. Recent archive 1 day ago (preserve)
        recent_arch = os.path.join(self.log_dir, "access.log.1.gz")
        with open(recent_arch, "w") as f:
            f.write("recent access archive")
        one_day_ago = time.time() - (24 * 3600 * 1)
        os.utime(recent_arch, (one_day_ago, one_day_ago))

        # 3. Expired archive 5 days ago (delete)
        expired_arch = os.path.join(self.log_dir, "access.log.2.gz")
        with open(expired_arch, "w") as f:
            f.write("old access archive")
        five_days_ago = time.time() - (24 * 3600 * 5)
        os.utime(expired_arch, (five_days_ago, five_days_ago))

        logs = []
        await self.manager._execute_log_rotate(lambda m: logs.append(m), lambda m: logs.append(m))

        # Active log must have been truncated to 0 bytes
        self.assertTrue(os.path.exists(access_log))
        self.assertEqual(os.path.getsize(access_log), 0)

        # Recent archive must exist, expired must be deleted
        self.assertTrue(os.path.exists(recent_arch), "Recent access.log archive must be preserved")
        self.assertFalse(os.path.exists(expired_arch), "Expired access.log archive must be deleted")

    async def test_execute_log_rotate_icecast_timestamp_archives_and_zero_byte_cleanup(self):
        """Verifies Icecast .YYYYMMDD_HHMMSS archives are compressed, pruned by backup_count/age, and 0-byte files deleted."""
        config_path = os.path.join(self.temp_dir.name, "test_ice_ts.conf")
        config = configparser.ConfigParser()
        config["logging"] = {
            "retention_days": "30",
            "rotation_max_bytes": "10485760",
            "rotation_backup_count": "3",
            "compression_enabled": "false",
        }
        with open(config_path, "w") as f:
            config.write(f)
        os.environ["CONFIG_FILE_PATH"] = config_path

        ice_dir = os.path.join(self.log_dir, "icecast_101")
        os.makedirs(ice_dir, exist_ok=True)
        with open(os.path.join(ice_dir, "access.log"), "w") as f:
            f.write("active")

        now = time.time()
        # 1. Expired timestamped archive (45 days old)
        expired_ts = os.path.join(ice_dir, "access.log.20261004_200158")
        with open(expired_ts, "w") as f:
            f.write("expired icecast archive")
        os.utime(expired_ts, (now - 45 * 86400, now - 45 * 86400))

        # 2. Zero-byte ENOSPC remnant
        zero_ts = os.path.join(ice_dir, "access.log.20261123_153254")
        with open(zero_ts, "w") as f:
            pass

        # 3. Five recent timestamped archives (backup_count=3 should prune oldest 2 and gzip newest 3 on 256MB tmpfs)
        recent_paths = []
        for idx in range(5):
            p = os.path.join(ice_dir, f"access.log.20261124_0{idx}0000")
            with open(p, "w") as f:
                f.write(f"log batch {idx}\n" * 20)
            t = now - (5 - idx) * 3600
            os.utime(p, (t, t))
            recent_paths.append(p)

        DiskUsage = namedtuple("DiskUsage", ["total", "used", "free"])
        small_tmpfs = DiskUsage(total=256 * 1024 * 1024, used=64 * 1024 * 1024, free=192 * 1024 * 1024)

        logs = []
        with patch("core.task_manager.shutil.disk_usage", return_value=small_tmpfs):
            await self.manager._execute_log_rotate(lambda m: logs.append(m), lambda m: logs.append(m))

        self.assertFalse(os.path.exists(expired_ts), "Expired timestamped archive must be deleted")
        self.assertFalse(os.path.exists(zero_ts), "Zero-byte Icecast archive must be removed")
        self.assertFalse(os.path.exists(recent_paths[0]), "Oldest excess archive #0 must be pruned")
        self.assertFalse(os.path.exists(recent_paths[1]), "Oldest excess archive #1 must be pruned")
        for kept in recent_paths[2:]:
            self.assertFalse(os.path.exists(kept), "Uncompressed kept archive must be replaced by .gz on <=512MB tmpfs")
            self.assertTrue(os.path.exists(kept + ".gz"), "Kept Icecast archive must be gzipped")

    async def test_rotate_shifts_process_backups_and_cleans_enospc(self):
        """Verifies .1 -> .2 shifting and safe ENOSPC cleanup + emergency truncate."""
        config_path = os.path.join(self.temp_dir.name, "test_shift.conf")
        config = configparser.ConfigParser()
        config["logging"] = {
            "retention_days": "30",
            "rotation_max_bytes": "500",
            "rotation_backup_count": "3",
            "compression_enabled": "true",
        }
        with open(config_path, "w") as f:
            config.write(f)
        os.environ["CONFIG_FILE_PATH"] = config_path

        proc_log = os.path.join(self.log_dir, "process_101.log")
        prev_arch = os.path.join(self.log_dir, "process_101.log.1")
        with open(prev_arch, "wb") as f:
            f.write(b"OLD_ARCHIVE\n" * 10)
        with open(proc_log, "wb") as f:
            f.write(b"NEW_ACTIVE\n" * 80)

        logs = []
        await self.manager._execute_log_rotate(lambda m: logs.append(m), lambda m: logs.append(m))

        self.assertTrue(os.path.exists(os.path.join(self.log_dir, "process_101.log.1.gz")))
        self.assertTrue(os.path.exists(os.path.join(self.log_dir, "process_101.log.2.gz")))
        self.assertEqual(os.path.getsize(proc_log), 0)

        # Now simulate ENOSPC while rotating oversized process_101.log
        with open(proc_log, "wb") as f:
            f.write(b"FLOOD\n" * 200)
        with patch("core.task_manager.gzip.open", side_effect=OSError(errno.ENOSPC, "No space left on device")):
            await self.manager._execute_log_rotate(lambda m: logs.append(m), lambda m: logs.append(m))

        self.assertEqual(os.path.getsize(proc_log), 0, "Active log must be emergency-truncated on ENOSPC")
        leftover_tmps = [f for f in os.listdir(self.log_dir) if f.endswith(".rot_tmp")]
        self.assertEqual(leftover_tmps, [], "No .rot_tmp files may linger after ENOSPC")

    def test_enforce_log_storage_quota_purges_oldest_archives_and_emergency_truncates(self):
        """Verifies storage pressure pruning at >=80% and emergency active log truncation at >=92%."""
        DiskUsage = namedtuple("DiskUsage", ["total", "used", "free"])
        total = 256 * 1024 * 1024

        arch_old = os.path.join(self.log_dir, "process_101.log.2.gz")
        arch_new = os.path.join(self.log_dir, "process_101.log.1.gz")
        active_proc = os.path.join(self.log_dir, "process_101.log")
        for idx, p in enumerate((arch_old, arch_new)):
            with open(p, "wb") as f:
                f.write(b"A" * 4096)
            t = time.time() - (2 - idx) * 3600
            os.utime(p, (t, t))
        with open(active_proc, "wb") as f:
            f.write(b"B" * (600 * 1024))

        # Sequence: initial 88% -> after deleting arch_old drops to 74% -> stops before deleting arch_new
        usage_seq = iter([
            DiskUsage(total=total, used=int(total * 0.88), free=int(total * 0.12)),  # entry check
            DiskUsage(total=total, used=int(total * 0.88), free=int(total * 0.12)),  # before arch_old
            DiskUsage(total=total, used=int(total * 0.74), free=int(total * 0.26)),  # before arch_new (<=0.75 stop)
            DiskUsage(total=total, used=int(total * 0.74), free=int(total * 0.26)),  # post-loop emergency check
        ])
        logs = []
        with patch("core.task_manager.shutil.disk_usage", side_effect=lambda _p: next(usage_seq)):
            self.manager._enforce_log_storage_quota({self.log_dir}, {"access.log", "ffmpeg-gui.log"}, logs.append, logs.append)

        self.assertFalse(os.path.exists(arch_old), "Oldest archive must be purged under storage pressure")
        self.assertTrue(os.path.exists(arch_new), "Newer archive should be retained once pressure drops <=75%")
        self.assertGreater(os.path.getsize(active_proc), 0, "Active log must stay intact below emergency watermark")

        # Now simulate 95% full with NO archives left -> emergency truncate active_proc (>512KB)
        os.remove(arch_new)
        em_seq = iter([
            DiskUsage(total=total, used=int(total * 0.95), free=int(total * 0.05)),
            DiskUsage(total=total, used=int(total * 0.95), free=int(total * 0.05)),
            DiskUsage(total=total, used=int(total * 0.95), free=int(total * 0.05)),
        ])
        with patch("core.task_manager.shutil.disk_usage", side_effect=lambda _p: next(em_seq)):
            self.manager._enforce_log_storage_quota({self.log_dir}, {"access.log", "ffmpeg-gui.log"}, logs.append, logs.append)
        self.assertEqual(os.path.getsize(active_proc), 0, "Largest active log must be truncated in-place at >=92%")

if __name__ == "__main__":
    unittest.main()

