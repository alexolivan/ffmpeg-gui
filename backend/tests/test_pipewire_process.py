import os
import shutil
import stat
import unittest
from unittest.mock import patch, MagicMock, AsyncMock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database.models import Base, Service, FfmpegBuild
from core.process_manager import ProcessManager
from core.resource_lock_manager import resource_manager, resource_lock_manager
from core.dependency_manager import dependency_manager


class TestPipeWireProcess(unittest.IsolatedAsyncioTestCase):

    async def asyncSetUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.pm = ProcessManager(db_session_factory=self.Session)

        # Clear locks and leases before each test
        with resource_lock_manager._lock:
            resource_lock_manager._locks.clear()
        with dependency_manager.state_lock:
            dependency_manager.active_leases.clear()
            dependency_manager.pinned_services.clear()

        self.cleanup_dirs = []
        self.cleanup_files = []

    async def asyncTearDown(self):
        for d in self.cleanup_dirs:
            if os.path.exists(d):
                shutil.rmtree(d, ignore_errors=True)
        for f in self.cleanup_files:
            if os.path.exists(f):
                try:
                    os.remove(f)
                except Exception:
                    pass

        with resource_lock_manager._lock:
            resource_lock_manager._locks.clear()
        with dependency_manager.state_lock:
            dependency_manager.active_leases.clear()
            dependency_manager.pinned_services.clear()

    def _create_mock_proc(self, pid=5555):
        proc = MagicMock()
        proc.pid = pid
        proc.returncode = None
        proc.wait = AsyncMock(return_value=0)
        proc.terminate = MagicMock(side_effect=lambda: setattr(proc, "returncode", 0))
        proc.kill = MagicMock(side_effect=lambda: setattr(proc, "returncode", -9))
        proc.stdin = None
        return proc

    @patch("shutil.which", return_value="/usr/bin/pipewire")
    @patch("asyncio.create_subprocess_exec")
    async def test_start_pipewire_hub(self, mock_exec, mock_which):
        mock_proc = self._create_mock_proc(pid=10101)
        mock_exec.return_value = mock_proc

        with self.Session() as session:
            svc = Service(
                id=101,
                name="Main PipeWire Hub",
                service_type="pipewire_hub",
                status="stopped",
                config={
                    "pipewire_config": {
                        "sample_rate": 48000,
                        "buffer_size": 256,
                        "clock_quantum": "256/48000",
                        "aes67_network": {"enabled": False}
                    }
                }
            )
            session.add(svc)
            session.commit()

        self.cleanup_dirs.append(f"/tmp/ffmpeg-gui/pipewire-101")
        self.cleanup_files.append(f"/dev/shm/pipewire_101.conf")

        with patch.object(self.pm, "_watchdog", new_callable=AsyncMock), \
             patch.object(self.pm, "_file_log_tailer", new_callable=AsyncMock):

            await self.pm.start_process(101)

            self.assertIn(101, self.pm.processes)
            self.assertIn(101, self.pm.active_processes)
            self.assertEqual(self.pm.processes[101], mock_proc)

            self.assertTrue(mock_exec.called)
            cmd_args = mock_exec.call_args[0]
            call_kwargs = mock_exec.call_args[1]

            self.assertEqual(cmd_args[0], "/usr/bin/pipewire")
            self.assertEqual(cmd_args[1], "-c")
            conf_path = cmd_args[2]

            self.assertTrue(os.path.exists(conf_path))
            runtime_dir = f"/tmp/ffmpeg-gui/pipewire-101"
            self.assertTrue(os.path.exists(runtime_dir))

            mode = stat.S_IMODE(os.stat(runtime_dir).st_mode)
            self.assertEqual(mode, 0o700)

            sub_env = call_kwargs.get("env", {})
            self.assertEqual(sub_env.get("PIPEWIRE_RUNTIME_DIR"), runtime_dir)
            self.assertEqual(sub_env.get("PIPEWIRE_CONFIG_NAME"), conf_path)

            with self.Session() as session:
                updated = session.get(Service, 101)
                self.assertEqual(updated.status, "running")
                self.assertEqual(updated.pid, 10101)

    @patch("shutil.which", return_value="/usr/bin/pipewire")
    @patch("asyncio.create_subprocess_exec")
    async def test_stop_pipewire_hub(self, mock_exec, mock_which):
        mock_proc = self._create_mock_proc(pid=10202)
        mock_exec.return_value = mock_proc

        with self.Session() as session:
            svc = Service(
                id=102,
                name="Stop Test PipeWire Hub",
                service_type="pipewire_hub",
                status="stopped",
                config={
                    "pipewire_config": {
                        "sample_rate": 48000,
                        "buffer_size": 256,
                        "aes67_network": {"enabled": False}
                    }
                }
            )
            session.add(svc)
            session.commit()

        self.cleanup_dirs.append(f"/tmp/ffmpeg-gui/pipewire-102")
        self.cleanup_files.append(f"/dev/shm/pipewire_102.conf")

        with patch.object(self.pm, "_watchdog", new_callable=AsyncMock), \
             patch.object(self.pm, "_file_log_tailer", new_callable=AsyncMock):

            await self.pm.start_process(102)
            self.assertIn(102, self.pm.processes)

            conf_path = self.pm.ephemeral_configs.get(102)
            runtime_dir = f"/tmp/ffmpeg-gui/pipewire-102"
            self.assertTrue(os.path.exists(runtime_dir))

            await self.pm.stop_process(102)

            self.assertNotIn(102, self.pm.processes)
            self.assertTrue(mock_proc.terminate.called or mock_proc.kill.called)

            if conf_path:
                self.assertFalse(os.path.exists(conf_path))
            self.assertFalse(os.path.exists(runtime_dir))

            with self.Session() as session:
                updated = session.get(Service, 102)
                self.assertEqual(updated.status, "stopped")
                self.assertIsNone(updated.pid)

    @patch("shutil.which", return_value="/usr/bin/pipewire")
    @patch("asyncio.create_subprocess_exec")
    async def test_pipewire_hub_aes67_nic_reservation(self, mock_exec, mock_which):
        mock_proc1 = self._create_mock_proc(pid=10301)
        mock_proc2 = self._create_mock_proc(pid=10302)
        mock_exec.side_effect = [mock_proc1, mock_proc2]

        with self.Session() as session:
            svc1 = Service(
                id=103,
                name="AES67 Hub Primary",
                service_type="pipewire_hub",
                status="stopped",
                config={
                    "pipewire_config": {
                        "sample_rate": 48000,
                        "aes67_network": {"enabled": True, "interface": "eth0"}
                    }
                }
            )
            svc2 = Service(
                id=104,
                name="AES67 Hub Contender",
                service_type="pipewire_hub",
                status="stopped",
                config={
                    "pipewire_config": {
                        "sample_rate": 48000,
                        "aes67_network": {"enabled": True, "interface": "eth0"}
                    }
                }
            )
            session.add_all([svc1, svc2])
            session.commit()

        self.cleanup_dirs.extend(["/tmp/ffmpeg-gui/pipewire-103", "/tmp/ffmpeg-gui/pipewire-104"])
        self.cleanup_files.extend(["/dev/shm/pipewire_103.conf", "/dev/shm/pipewire_104.conf"])

        with patch.object(self.pm, "_watchdog", new_callable=AsyncMock), \
             patch.object(self.pm, "_file_log_tailer", new_callable=AsyncMock):

            await self.pm.start_process(103)

            # Check that eth0 is claimed in resource_manager
            with resource_manager._lock:
                key = "resource:network_interface:eth0"
                self.assertIn(key, resource_manager._locks)
                self.assertEqual(resource_manager._locks[key]["owner_id"], 103)

            # Attempting to start contender claiming the same NIC should raise RuntimeError
            with self.assertRaises(RuntimeError) as ctx:
                await self.pm.start_process(104)
            self.assertTrue(
                "reservado" in str(ctx.exception).lower() or
                "already in use" in str(ctx.exception).lower() or
                "conflicto" in str(ctx.exception).lower()
            )

            # Stop primary service and verify NIC is released
            await self.pm.stop_process(103)
            with resource_manager._lock:
                self.assertNotIn("resource:network_interface:eth0", resource_manager._locks)

            # Now contender should be able to start and claim eth0
            await self.pm.start_process(104)
            with resource_manager._lock:
                self.assertIn("resource:network_interface:eth0", resource_manager._locks)
                self.assertEqual(resource_manager._locks["resource:network_interface:eth0"]["owner_id"], 104)

            await self.pm.stop_process(104)
            with resource_manager._lock:
                self.assertNotIn("resource:network_interface:eth0", resource_manager._locks)

    @patch("shutil.which", return_value="/usr/bin/pipewire")
    @patch("asyncio.create_subprocess_exec")
    async def test_pipewire_hub_lease_lifecycle(self, mock_exec, mock_which):
        mock_proc = self._create_mock_proc(pid=10501)
        mock_exec.return_value = mock_proc

        with self.Session() as session:
            svc = Service(
                id=105,
                name="On Demand PipeWire Hub",
                service_type="pipewire_hub",
                status="stopped",
                config={"pipewire_config": {"sample_rate": 48000}}
            )
            session.add(svc)
            session.commit()

        self.cleanup_dirs.append(f"/tmp/ffmpeg-gui/pipewire-105")
        self.cleanup_files.append(f"/dev/shm/pipewire_105.conf")

        with patch.object(self.pm, "_watchdog", new_callable=AsyncMock), \
             patch.object(self.pm, "_file_log_tailer", new_callable=AsyncMock):

            # 1. Acquire lease: Should auto-start service
            ok = await self.pm.acquire_lease(105, consumer_type="service", consumer_id=201, allow_auto_start=True)
            self.assertTrue(ok)
            self.assertEqual(self.pm.get_service_ref_count(105), 1)
            self.assertIn(105, self.pm.processes)

            # 2. Acquire second lease
            await self.pm.acquire_lease(105, consumer_type="service", consumer_id=202)
            self.assertEqual(self.pm.get_service_ref_count(105), 2)
            self.assertIn(105, self.pm.processes)

            # 3. Release first lease: Remains active
            await self.pm.release_lease(105, consumer_type="service", consumer_id=201, allow_auto_stop=True)
            self.assertEqual(self.pm.get_service_ref_count(105), 1)
            self.assertIn(105, self.pm.processes)

            # 4. Release second lease: Ref count reaches 0 -> Auto-stops
            await self.pm.release_lease(105, consumer_type="service", consumer_id=202, allow_auto_stop=True)
            self.assertEqual(self.pm.get_service_ref_count(105), 0)
            self.assertNotIn(105, self.pm.processes)

    @patch("shutil.which", return_value=None)
    @patch("core.software_manager.SoftwareManager.get_active_binary", return_value=None)
    async def test_pipewire_hub_missing_binary_error(self, mock_sw_bin, mock_which):
        with self.Session() as session:
            svc = Service(
                id=106,
                name="Missing PipeWire Hub",
                service_type="pipewire_hub",
                status="stopped",
                config={"pipewire_config": {}}
            )
            session.add(svc)
            session.commit()

        with self.assertRaises(FileNotFoundError):
            await self.pm.start_process(106)

        with self.Session() as session:
            updated = session.get(Service, 106)
            self.assertEqual(updated.status, "error")
            self.assertIn("not found", updated.last_error.lower())


if __name__ == "__main__":
    unittest.main()
