import os
import shutil
import stat
import asyncio
import unittest
from unittest.mock import patch, MagicMock, AsyncMock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database.models import Base, Service, FfmpegBuild
from core.process_manager import ProcessManager
from core.resource_lock_manager import resource_manager, resource_lock_manager
from core.dependency_manager import dependency_manager
from fastapi.testclient import TestClient
from main import app, verify_token, get_db


from sqlalchemy.pool import StaticPool

class TestPipeWireProcess(unittest.IsolatedAsyncioTestCase):

    async def asyncSetUp(self):
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool
        )
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

    @patch("asyncio.create_subprocess_exec")
    async def test_start_pipewire_hub_with_custom_forge_build(self, mock_exec):
        import tempfile
        mock_proc = self._create_mock_proc(pid=10999)
        mock_exec.return_value = mock_proc

        tmp_build_dir = tempfile.mkdtemp(prefix="pw_forge_test_")
        self.cleanup_dirs.append(tmp_build_dir)
        bin_dir = os.path.join(tmp_build_dir, "bin")
        lib_dir = os.path.join(tmp_build_dir, "lib")
        spa_dir = os.path.join(lib_dir, "spa-0.2")
        mod_dir = os.path.join(lib_dir, "pipewire-0.3")
        os.makedirs(bin_dir, exist_ok=True)
        os.makedirs(spa_dir, exist_ok=True)
        os.makedirs(mod_dir, exist_ok=True)
        fake_pw_bin = os.path.join(bin_dir, "pipewire")
        with open(fake_pw_bin, "w") as f:
            f.write("#!/bin/sh\nexit 0\n")
        os.chmod(fake_pw_bin, 0o755)

        with self.Session() as session:
            b = FfmpegBuild(
                id=15,
                software_type="pipewire",
                name="PipeWire 1.6.9 Test",
                version_tag="1.6.9",
                status="ready",
                install_path=tmp_build_dir,
                binary_path=fake_pw_bin
            )
            svc = Service(
                id=115,
                name="Forge PipeWire Hub",
                service_type="pipewire_hub",
                status="stopped",
                ffmpeg_build_id=15,
                config={
                    "software_build_id": 15,
                    "pipewire_config": {
                        "sample_rate": 48000,
                        "aes67_network": {"enabled": False}
                    }
                }
            )
            session.add(b)
            session.add(svc)
            session.commit()

        self.cleanup_dirs.append(f"/tmp/ffmpeg-gui/pipewire-115")
        self.cleanup_files.append(f"/dev/shm/pipewire_115.conf")

        with patch.object(self.pm, "_watchdog", new_callable=AsyncMock), \
             patch.object(self.pm, "_file_log_tailer", new_callable=AsyncMock):

            await self.pm.start_process(115)

            self.assertIn(115, self.pm.processes)
            self.assertTrue(mock_exec.called)
            cmd_args = mock_exec.call_args[0]
            call_kwargs = mock_exec.call_args[1]

            self.assertEqual(cmd_args[0], fake_pw_bin)
            sub_env = call_kwargs.get("env", {})
            self.assertEqual(sub_env.get("SPA_PLUGIN_DIR"), spa_dir)
            self.assertEqual(sub_env.get("PIPEWIRE_MODULE_DIR"), mod_dir)
            self.assertIn(lib_dir, sub_env.get("LD_LIBRARY_PATH", ""))

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

    async def test_get_pipewire_telemetry_not_running(self):
        # Service not in active_processes
        telemetry = await self.pm.get_pipewire_telemetry(999)
        self.assertFalse(telemetry["active"])
        self.assertEqual(telemetry["nodes"], [])
        self.assertEqual(telemetry["ports"], [])
        self.assertEqual(telemetry["links"], [])
        self.assertEqual(telemetry["streams"], [])
        self.assertEqual(telemetry["raw_summary"], {"nodes_count": 0, "ports_count": 0, "links_count": 0})
        self.assertIn("not running", telemetry["error"])

    @patch("shutil.which", return_value="/usr/bin/pw-dump")
    @patch("asyncio.create_subprocess_exec")
    async def test_get_pipewire_telemetry_success(self, mock_exec, mock_which):
        # Service is in active_processes
        self.pm.processes[101] = self._create_mock_proc(pid=10101)

        mock_pw_dump_output = [
            {
                "id": 42,
                "type": "PipeWire:Interface:Node",
                "info": {
                    "props": {
                        "node.name": "alsa_output.pci-0000_00_1f.3.analog-stereo",
                        "media.class": "Audio/Sink",
                        "node.description": "Built-in Audio Analog Stereo"
                    },
                    "state": "running"
                }
            },
            {
                "id": 55,
                "type": "PipeWire:Interface:Port",
                "info": {
                    "props": {
                        "port.name": "playback_FL",
                        "port.direction": "in",
                        "node.id": 42,
                        "audio.channel": "FL"
                    }
                }
            },
            {
                "id": 60,
                "type": "PipeWire:Interface:Link",
                "info": {
                    "output-node-id": 30,
                    "output-port-id": 31,
                    "input-node-id": 42,
                    "input-port-id": 55,
                    "state": "active"
                }
            }
        ]
        import json
        dump_proc = MagicMock()
        dump_proc.returncode = 0
        dump_proc.communicate = AsyncMock(return_value=(json.dumps(mock_pw_dump_output).encode("utf-8"), b""))
        mock_exec.return_value = dump_proc

        telemetry = await self.pm.get_pipewire_telemetry(101)
        self.assertTrue(telemetry["active"])
        self.assertIsNone(telemetry["error"])
        self.assertEqual(len(telemetry["nodes"]), 1)
        self.assertEqual(telemetry["nodes"][0]["id"], 42)
        self.assertEqual(telemetry["nodes"][0]["name"], "alsa_output.pci-0000_00_1f.3.analog-stereo")
        self.assertEqual(telemetry["nodes"][0]["media_class"], "Audio/Sink")
        self.assertEqual(telemetry["nodes"][0]["state"], "running")

        self.assertEqual(len(telemetry["ports"]), 1)
        self.assertEqual(telemetry["ports"][0]["id"], 55)
        self.assertEqual(telemetry["ports"][0]["name"], "playback_FL")
        self.assertEqual(telemetry["ports"][0]["node_id"], 42)

        self.assertEqual(len(telemetry["links"]), 1)
        self.assertEqual(telemetry["links"][0]["output_node_id"], 30)

        self.assertEqual(telemetry["raw_summary"]["nodes_count"], 1)
        self.assertEqual(telemetry["raw_summary"]["ports_count"], 1)
        self.assertEqual(telemetry["raw_summary"]["links_count"], 1)

    @patch("shutil.which", return_value="/usr/bin/pw-dump")
    @patch("asyncio.create_subprocess_exec")
    async def test_get_pipewire_telemetry_id_zero(self, mock_exec, mock_which):
        self.pm.processes[101] = self._create_mock_proc(pid=10101)

        mock_pw_dump_output = [
            {
                "id": 0,
                "type": "PipeWire:Interface:Node",
                "info": {
                    "props": {
                        "node.name": "node.zero",
                        "media.class": "Audio/Sink"
                    },
                    "state": "running"
                }
            },
            {
                "id": 0,
                "type": "PipeWire:Interface:Port",
                "info": {
                    "props": {
                        "port.name": "port.zero",
                        "node.id": 0
                    }
                }
            },
            {
                "id": 0,
                "type": "PipeWire:Interface:Link",
                "info": {
                    "output-node-id": 0,
                    "output-port-id": 0,
                    "input-node-id": 0,
                    "input-port-id": 0,
                    "state": "active"
                }
            }
        ]
        import json
        dump_proc = MagicMock()
        dump_proc.returncode = 0
        dump_proc.communicate = AsyncMock(return_value=(json.dumps(mock_pw_dump_output).encode("utf-8"), b""))
        mock_exec.return_value = dump_proc

        telemetry = await self.pm.get_pipewire_telemetry(101)
        self.assertTrue(telemetry["active"])
        self.assertEqual(telemetry["nodes"][0]["id"], 0)
        self.assertEqual(telemetry["ports"][0]["id"], 0)
        self.assertEqual(telemetry["ports"][0]["node_id"], 0)
        self.assertEqual(telemetry["links"][0]["output_node_id"], 0)
        self.assertEqual(telemetry["links"][0]["input_node_id"], 0)
        self.assertEqual(telemetry["links"][0]["output_port_id"], 0)
        self.assertEqual(telemetry["links"][0]["input_port_id"], 0)

    @patch("shutil.which", return_value="/usr/bin/pw-dump")
    @patch("asyncio.create_subprocess_exec")
    async def test_get_pipewire_telemetry_timeout(self, mock_exec, mock_which):
        self.pm.processes[101] = self._create_mock_proc(pid=10101)

        dump_proc = MagicMock()
        dump_proc.returncode = None
        dump_proc.communicate = AsyncMock()
        dump_proc.kill = MagicMock(side_effect=lambda: setattr(dump_proc, "returncode", -9))
        dump_proc.wait = AsyncMock(return_value=-9)
        mock_exec.return_value = dump_proc

        async def fake_wait_for(fut, timeout=None):
            if asyncio.iscoroutine(fut):
                fut.close()
            raise asyncio.TimeoutError()

        with patch("asyncio.wait_for", side_effect=fake_wait_for):
            telemetry = await self.pm.get_pipewire_telemetry(101)
            self.assertTrue(telemetry["active"])
            self.assertEqual(telemetry["nodes"], [])
            self.assertEqual(telemetry["ports"], [])
            self.assertEqual(telemetry["links"], [])
            self.assertEqual(telemetry["streams"], [])
            self.assertEqual(telemetry["raw_summary"], {"nodes_count": 0, "ports_count": 0, "links_count": 0})
            self.assertIn("timed out", telemetry["error"].lower())
            dump_proc.kill.assert_called_once()
            dump_proc.wait.assert_awaited_once()

    def test_pipewire_nodes_api_endpoint(self):
        from fastapi.testclient import TestClient
        try:
            from main import app, verify_token, get_db, process_manager
        except ImportError:
            from backend.main import app, verify_token, get_db, process_manager

        with self.Session() as session:
            svc_hub = Service(
                id=301,
                name="Tele PipeWire Hub",
                service_type="pipewire_hub",
                status="running",
                config={"pipewire_config": {}}
            )
            svc_ffmpeg = Service(
                id=302,
                name="Regular Stream",
                service_type="direct",
                status="running",
                config={}
            )
            session.add_all([svc_hub, svc_ffmpeg])
            session.commit()

        def override_get_db():
            db = self.Session()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[verify_token] = lambda: "test_user"
        app.dependency_overrides[get_db] = override_get_db

        client = TestClient(app)
        try:
            with patch.object(process_manager, "get_pipewire_telemetry", new_callable=AsyncMock) as mock_tele:
                mock_tele.return_value = {
                    "active": True,
                    "nodes": [{"id": 1, "name": "dummy_node"}],
                    "ports": [],
                    "links": [],
                    "streams": [{"id": 1, "name": "dummy_node"}],
                    "raw_summary": {"nodes_count": 1, "ports_count": 0, "links_count": 0}
                }

                # 1. Successful request on pipewire_hub
                res = client.get("/api/services/301/pipewire/nodes")
                self.assertEqual(res.status_code, 200)
                data = res.json()
                self.assertTrue(data["active"])
                self.assertEqual(len(data["nodes"]), 1)
                self.assertEqual(data["nodes"][0]["name"], "dummy_node")
                mock_tele.assert_awaited_once_with(301)

                # 2. Non-pipewire service returns 400
                res_bad = client.get("/api/services/302/pipewire/nodes")
                self.assertEqual(res_bad.status_code, 400)
                self.assertIn("not a PipeWire Hub", res_bad.json()["detail"])

                # 3. Non-existent service returns 404
                res_404 = client.get("/api/services/9999/pipewire/nodes")
                self.assertEqual(res_404.status_code, 404)
        finally:
            app.dependency_overrides.clear()

    @patch("shutil.which", return_value="/usr/bin/ffmpeg")
    @patch("asyncio.create_subprocess_exec")
    async def test_ffmpeg_service_pipewire_lease_lifecycle(self, mock_exec, mock_which):
        """Test that starting an FFmpeg service with PipeWire input acquires a lease and injects PULSE_SERVER/PIPEWIRE_RUNTIME_DIR."""
        mock_proc = self._create_mock_proc(pid=6060)
        mock_exec.return_value = mock_proc

        with self.Session() as session:
            hub = Service(
                id=501,
                name="PW Hub 501",
                service_type="pipewire_hub",
                status="running",
                config={"pipewire_config": {"sample_rate": 48000}}
            )
            consumer = Service(
                id=502,
                name="FFmpeg PipeWire Consumer",
                service_type="ffmpeg_stream",
                status="stopped",
                config={
                    "input_config": {
                        "type": "pipewire",
                        "provider_service_id": 501,
                        "sink_id": "mix_bus"
                    },
                    "codec_config": {"acodec": "pcm_s16le"},
                    "output_config": {"type": "alsa", "device": "hw:0,0"}
                }
            )
            session.add_all([hub, consumer])
            session.commit()

        with patch.object(self.pm, "_watchdog", new_callable=AsyncMock), \
             patch.object(self.pm, "_log_reader", new_callable=AsyncMock):

            await self.pm.start_process(502)

            # Check that lease was acquired on Hub 501 by service:502
            self.assertIn(501, dependency_manager.active_leases)
            self.assertIn("service:502", dependency_manager.active_leases[501])

            # Check environment variables passed to asyncio.create_subprocess_exec
            self.assertTrue(mock_exec.called)
            kwargs = mock_exec.call_args[1]
            env = kwargs.get("env", {})
            self.assertEqual(env.get("PULSE_SERVER"), "unix:/tmp/ffmpeg-gui/pipewire-501/pulse.sock")
            self.assertEqual(env.get("PIPEWIRE_RUNTIME_DIR"), "/tmp/ffmpeg-gui/pipewire-501")

            # Stopping the consumer should release the lease
            await self.pm.stop_process(502)
            active_for_501 = dependency_manager.active_leases.get(501, set())
            self.assertNotIn("service:502", active_for_501)

    def test_dependency_manager_sync_pipewire_stream(self):
        """Test that sync_auto_dependencies detects PipeWire provider_service_id in input and output config."""
        from database.models import ServiceDependency
        with self.Session() as session:
            consumer = Service(
                id=601,
                name="Stream 601",
                service_type="ffmpeg_stream",
                status="stopped",
                config={}
            )
            hub = Service(
                id=602,
                name="Hub 602",
                service_type="pipewire_hub",
                status="running",
                config={}
            )
            session.add_all([consumer, hub])
            session.commit()

            inp_cfg = {
                "input1": {
                    "type": "pipewire",
                    "provider_service_id": 602,
                    "sink_id": "master_bus"
                }
            }
            out_cfg = {"type": "icecast", "host": "127.0.0.1"}

            p_ids = dependency_manager.sync_auto_dependencies("service", 601, inp_cfg, out_cfg, session)
            self.assertIn(602, p_ids)

            deps = session.query(ServiceDependency).filter_by(consumer_type="service", consumer_id=601).all()
            self.assertEqual(len(deps), 1)
            self.assertEqual(deps[0].provider_service_id, 602)

    @patch("asyncio.create_subprocess_exec")
    async def test_start_pipewire_hub_creates_supervisor(self, mock_exec):
        """Test that starting a pipewire_hub service creates and starts its companion PipeWireMatrixSupervisor."""
        mock_proc = self._create_mock_proc(pid=12345)
        mock_exec.return_value = mock_proc

        with self.Session() as session:
            svc = Service(
                id=14,
                name="PipeWire Audio Hub",
                service_type="pipewire_hub",
                config={"virtual_sinks": [{"id": "master_bus"}]}
            )
            session.add(svc)
            session.commit()

        with patch("shutil.which", return_value="/usr/bin/pipewire"):
            with patch("core.pipewire_matrix_supervisor.PipeWireMatrixSupervisor.start", new_callable=AsyncMock) as mock_start:
                await self.pm.start_process(14)
                mock_start.assert_awaited_once()
                self.assertIn(14, self.pm.pipewire_supervisors)

    @patch("asyncio.create_subprocess_exec")
    async def test_stop_pipewire_hub_stops_supervisor(self, mock_exec):
        """Test that stopping a pipewire_hub service stops and cleans up its supervisor."""
        mock_sup = MagicMock()
        mock_sup.stop = AsyncMock()
        self.pm.pipewire_supervisors[14] = mock_sup
        mock_proc = self._create_mock_proc(pid=12345)
        self.pm.processes[14] = mock_proc

        with self.Session() as session:
            svc = Service(
                id=14,
                name="PipeWire Audio Hub",
                service_type="pipewire_hub",
                status="running",
                config={"virtual_sinks": [{"id": "master_bus"}]}
            )
            session.add(svc)
            session.commit()

        await self.pm.stop_process(14)
        mock_sup.stop.assert_awaited_once()
        self.assertNotIn(14, self.pm.pipewire_supervisors)

    def test_notify_pipewire_matrix_change_dispatches_to_supervisors(self):
        """Test that notify_pipewire_matrix_change triggers reconcile on active supervisors."""
        sup1 = MagicMock()
        sup2 = MagicMock()
        self.pm.pipewire_supervisors[14] = sup1
        self.pm.pipewire_supervisors[15] = sup2

        # Notify specific hub
        self.pm.notify_pipewire_matrix_change(14)
        sup1.trigger_reconcile.assert_called_once()
        sup2.trigger_reconcile.assert_not_called()

        # Notify all hubs
        sup1.reset_mock()
        sup2.reset_mock()
        self.pm.notify_pipewire_matrix_change()
        sup1.trigger_reconcile.assert_called_once()
        sup2.trigger_reconcile.assert_called_once()

    async def test_restart_dependent_ffmpeg_consumers_on_pipewire_hub_start(self):
        """Verify that _restart_dependent_ffmpeg_consumers cascades restart only to running FFmpeg services."""
        with self.Session() as session:
            # 1. PipeWire Hub 14
            hub = Service(
                id=14,
                name="PipeWire Audio Hub",
                service_type="pipewire_hub",
                status="running",
                config={"virtual_sinks": [{"id": "master_bus"}]}
            )
            # 2. FFmpeg consumer service 1 depending on Hub 14
            ffmpeg_svc = Service(
                id=1,
                name="Tac12 Output",
                service_type="ffmpeg_stream",
                status="running",
                config={
                    "input_config": {
                        "type": "pipewire_hub",
                        "provider_service_id": 14,
                        "sink_id": "master_bus"
                    }
                }
            )
            # 3. Desktop service 2 (not FFmpeg)
            desktop_svc = Service(
                id=2,
                name="Desktop 2",
                service_type="desktop",
                status="running",
                config={
                    "desktop_config": {
                        "audio_backend": "pipewire_hub",
                        "pipewire_service_id": 14
                    }
                }
            )
            session.add_all([hub, ffmpeg_svc, desktop_svc])
            session.commit()

        # Mock running processes in ProcessManager
        mock_ffmpeg_proc = MagicMock()
        mock_ffmpeg_proc.returncode = None
        mock_desktop_proc = MagicMock()
        mock_desktop_proc.returncode = None

        self.pm.processes[1] = mock_ffmpeg_proc
        self.pm.processes[2] = mock_desktop_proc

        # Mock pulse.sock existence
        sock_path = f"/tmp/ffmpeg-gui/pipewire-14/pulse.sock"
        os.makedirs(os.path.dirname(sock_path), exist_ok=True)
        with open(sock_path, "w") as f:
            f.write("")
        self.cleanup_files.append(sock_path)
        self.cleanup_dirs.append(os.path.dirname(sock_path))

        with patch.object(self.pm, "restart_process", new_callable=AsyncMock) as mock_restart:
            await self.pm._restart_dependent_ffmpeg_consumers(14)
            # Service 1 (FFmpeg) must be restarted
            mock_restart.assert_awaited_once_with(1)

    async def test_restart_dependent_consumers_includes_kiosk_and_reattached_pids(self):
        with self.Session() as session:
            hub = Service(
                id=20,
                name="Hub 20",
                service_type="pipewire_hub",
                status="running",
                config={"pipewire_config": {"virtual_sinks": [{"id": "mix_bus"}]}}
            )
            desktop = Service(
                id=21,
                name="Desktop 21",
                service_type="desktop",
                status="running",
                config={"desktop_config": {"audio_backend": "pipewire_hub", "pipewire_service_id": 20}}
            )
            kiosk = Service(
                id=22,
                name="Kiosk 22",
                service_type="kiosk_browser",
                status="running",
                config={"kiosk_config": {"target_desktop_service_id": 21}}
            )
            ffmpeg_svc = Service(
                id=23,
                name="FFmpeg 23",
                service_type="ffmpeg_stream",
                status="running",
                config={"input_config": {"type": "pipewire_hub", "provider_service_id": 20}}
            )
            session.add_all([hub, desktop, kiosk, ffmpeg_svc])
            session.commit()

        # Both kiosk 22 and ffmpeg 23 are reattached PIDs, not in self.pm.processes
        self.pm.reattached_pids[22] = 99922
        self.pm.reattached_pids[23] = 99923

        sock_path = f"/tmp/ffmpeg-gui/pipewire-20/pulse.sock"
        os.makedirs(os.path.dirname(sock_path), exist_ok=True)
        with open(sock_path, "w") as f:
            f.write("")
        self.cleanup_files.append(sock_path)
        self.cleanup_dirs.append(os.path.dirname(sock_path))

        with patch("psutil.pid_exists", return_value=True), \
             patch.object(self.pm, "restart_process", new_callable=AsyncMock) as mock_restart:
            await self.pm._restart_dependent_pipewire_consumers(20)
            restarted = [call.args[0] for call in mock_restart.await_args_list]
            self.assertIn(22, restarted)  # Kiosk restarted
            self.assertIn(23, restarted)  # FFmpeg restarted
            self.assertNotIn(21, restarted) # Desktop NOT restarted

    async def test_get_or_create_pipewire_supervisor_self_heals_reattached_hub(self):
        with self.Session() as session:
            hub = Service(
                id=30,
                name="Reattached Hub 30",
                service_type="pipewire_hub",
                status="running",
                config={"pipewire_config": {"virtual_sinks": [{"id": "mix_bus"}]}}
            )
            session.add(hub)
            session.commit()

        self.pm.reattached_pids[30] = 99930
        self.assertNotIn(30, self.pm.pipewire_supervisors)

        with patch("psutil.pid_exists", return_value=True):
            sup = self.pm.get_or_create_pipewire_supervisor(30)
            self.assertIsNotNone(sup)
            self.assertIn(30, self.pm.pipewire_supervisors)
            # Second call returns existing instance
            sup2 = self.pm.get_or_create_pipewire_supervisor(30)
            self.assertIs(sup, sup2)
            sup.stop()

    async def test_start_ptp4l_sidecar_spawns_process_and_cleans_up(self):
        """Verifies that ptp4l master clock is spawned as an auxiliary process and cleaned up on stop."""
        with self.Session() as session:
            hub = Service(
                id=40,
                name="PTP PipeWire Hub 40",
                service_type="pipewire_hub",
                status="stopped",
                config={
                    "pipewire_config": {
                        "aes67_network": {
                            "enabled": True,
                            "interface": "enp9s0",
                            "ptp": {
                                "enabled": True,
                                "auto_inhibit": True,
                                "priority1": 128,
                                "domain": 0,
                                "profile": "aes67"
                            }
                        },
                        "virtual_sinks": [{"id": "aes_sink"}]
                    }
                }
            )
            session.add(hub)
            session.commit()

        mock_pw_proc = self._create_mock_proc(pid=40001)
        mock_ptp_proc = self._create_mock_proc(pid=40002)

        def mock_exec(*cmd, **kwargs):
            if "ptp4l" in cmd[0]:
                return mock_ptp_proc
            return mock_pw_proc

        with patch("asyncio.create_subprocess_exec", side_effect=mock_exec) as mock_spawn, \
             patch("core.network_inspector.find_system_binary", return_value="/usr/sbin/ptp4l"), \
             patch("core.network_inspector.audit_pipewire_network_capabilities", return_value={
                 "interfaces": [{"name": "enp9s0", "ptp_support": "software"}]
             }), \
             patch("os.path.exists", side_effect=lambda p: True if "ptp4l" in str(p) or "pipewire" in str(p) else False), \
             patch("shutil.which", return_value="/usr/bin/pipewire"), \
             patch.object(self.pm, "_watchdog", new_callable=AsyncMock):

            await self.pm.start_process(40)

            # Check that ptp4l was spawned
            spawn_calls = [c[0] for c in mock_spawn.call_args_list]
            ptp_call = next((c for c in spawn_calls if any("ptp4l" in str(arg) for arg in c)), None)
            self.assertIsNotNone(ptp_call)
            self.assertIn("-i", ptp_call)
            self.assertIn("enp9s0", ptp_call)
            self.assertIn("-S", ptp_call)  # software timestamping
            self.assertIn(mock_ptp_proc, self.pm.auxiliary_processes.get(40, []))

            # Stop process and verify auxiliary cleanup
            await self.pm.stop_process(40)
            mock_ptp_proc.terminate.assert_called()

    def test_get_aoip_discovery_endpoint(self):
        """Verifies GET /api/pipewire/aoip-discovery returns discovery status."""
        app.dependency_overrides[verify_token] = lambda: "admin"
        try:
            client = TestClient(app)
            res = client.get("/api/pipewire/aoip-discovery")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertIn("discovered_streams", data)
            self.assertIn("ptp_status", data)
            self.assertIn("remote_sinks_status", data)
        finally:
            app.dependency_overrides.pop(verify_token, None)


if __name__ == "__main__":
    unittest.main()



