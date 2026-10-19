import os
import shutil
import asyncio
import unittest
from unittest.mock import patch, MagicMock, AsyncMock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database.models import Base, Service, ScheduledTask, TaskExecution
from core.pipewire_matrix_supervisor import PipeWireMatrixSupervisor, DesiredLink
from core.process_manager import ProcessManager


class TestPipeWireMatrixSupervisor(unittest.IsolatedAsyncioTestCase):

    async def asyncSetUp(self):
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.pm = ProcessManager(db_session_factory=self.Session)
        self.hub_id = 14
        self.supervisor = PipeWireMatrixSupervisor(self.hub_id, self.pm)

        # Mock runtime dir and pulse.sock
        self.test_runtime_dir = f"/tmp/test_pw_sup_{self.hub_id}"
        os.makedirs(self.test_runtime_dir, exist_ok=True)
        self.pulse_sock = os.path.join(self.test_runtime_dir, "pulse.sock")
        with open(self.pulse_sock, "w") as f:
            f.write("")
        self.supervisor.runtime_dir = self.test_runtime_dir

    async def asyncTearDown(self):
        if self.supervisor._running:
            await self.supervisor.stop()
        if os.path.exists(self.test_runtime_dir):
            shutil.rmtree(self.test_runtime_dir, ignore_errors=True)

    async def test_supervisor_start_stop_lifecycle(self):
        """Tests starting and stopping supervisor background task."""
        self.assertFalse(self.supervisor._running)
        await self.supervisor.start()
        self.assertTrue(self.supervisor._running)
        self.assertIsNotNone(self.supervisor._task)
        self.assertTrue(self.supervisor.get_matrix_status()["running"])

        # Stop supervisor
        await self.supervisor.stop()
        self.assertFalse(self.supervisor._running)
        self.assertIsNone(self.supervisor._task)
        self.assertFalse(self.supervisor.get_matrix_status()["running"])

    def test_resolve_desired_links_kiosks_and_ffmpeg(self):
        """Tests resolving desired routing matrix from SQLite DB."""
        with self.Session() as session:
            # 1. PipeWire Hub
            hub = Service(
                id=self.hub_id,
                name="PipeWire Test Hub",
                service_type="pipewire_hub",
                status="running",
                config={
                    "virtual_sinks": [
                        {"id": "master_bus", "name": "Master Bus", "channels": 2},
                        {"id": "aux_bus", "name": "Aux Bus", "channels": 2}
                    ]
                }
            )
            session.add(hub)

            # 2. Desktop configured with PipeWire
            desktop = Service(
                id=10,
                name="Studio Desktop",
                service_type="desktop",
                status="running",
                config={
                    "desktop_config": {
                        "audio_backend": "pipewire_hub",
                        "pipewire_service_id": self.hub_id,
                        "pipewire_sink_id": "master_bus"
                    }
                }
            )
            session.add(desktop)

            # 3. Kiosk associated with Desktop
            kiosk = Service(
                id=13,
                name="Playground Kiosk",
                service_type="kiosk_browser",
                status="running",
                config={
                    "kiosk_config": {
                        "target_desktop_service_id": 10
                    }
                }
            )
            session.add(kiosk)

            # 4. FFmpeg service capturing from PipeWire master_bus.monitor
            ffmpeg_ingest = Service(
                id=1,
                name="DeckLink Playout",
                service_type="ffmpeg_stream",
                status="running",
                config={
                    "input_config": {
                        "type": "pipewire",
                        "provider_service_id": self.hub_id,
                        "sink_id": "master_bus"
                    }
                }
            )
            session.add(ffmpeg_ingest)

            # 5. FFmpeg service publishing audio to aux_bus
            ffmpeg_pub = Service(
                id=2,
                name="Audio Generator",
                service_type="ffmpeg_stream",
                status="running",
                config={
                    "output_config": {
                        "type": "pipewire",
                        "provider_service_id": self.hub_id,
                        "sink_id": "aux_bus"
                    }
                }
            )
            session.add(ffmpeg_pub)

            # 6. FFmpeg Task capturing from PipeWire master_bus.monitor
            task = ScheduledTask(
                id=5,
                name="Recording Task",
                schedule_type="manual",
                input_config={
                    "type": "pipewire",
                    "provider_service_id": self.hub_id,
                    "sink_id": "master_bus"
                },
                output_config={"type": "file", "path": "/tmp/rec.mp4"},
                codec_config={}
            )
            session.add(task)

            execution = TaskExecution(
                id=50,
                task_id=5,
                status="running"
            )
            session.add(execution)
            session.commit()

        # Mark services as running in process_manager
        self.pm.processes[13] = MagicMock(pid=1001)
        self.pm.processes[1] = MagicMock(pid=1002)
        self.pm.processes[2] = MagicMock(pid=1003)

        links = self.supervisor._resolve_desired_links()
        self.assertEqual(len(links), 4)

        # Kiosk -> master_bus
        k_link = next(l for l in links if l.source_id == "kiosk_13")
        self.assertEqual(k_link.target_id, "master_bus")
        self.assertIn("Chromium", k_link.source_aliases)
        self.assertEqual(k_link.link_type, "playback")

        # master_bus.monitor -> FFmpeg Service #1
        f_ingest_link = next(l for l in links if l.target_id == "ffmpeg_service_1")
        self.assertEqual(f_ingest_link.source_id, "master_bus.monitor")
        self.assertEqual(f_ingest_link.link_type, "monitor_capture")
        self.assertIn("ffmpeg_1", f_ingest_link.target_aliases)

        # FFmpeg Service #2 -> aux_bus
        f_pub_link = next(l for l in links if l.source_id == "ffmpeg_service_2")
        self.assertEqual(f_pub_link.target_id, "aux_bus")
        self.assertEqual(f_pub_link.link_type, "playback")

        # master_bus.monitor -> FFmpeg Task #5
        t_link = next(l for l in links if l.target_id == "ffmpeg_task_5")
        self.assertEqual(t_link.source_id, "master_bus.monitor")
        self.assertEqual(t_link.link_type, "monitor_capture")

    def test_resolve_desired_links_aes67_transmitter(self):
        """Tests that AES67 enabled virtual sinks resolve a monitor_capture link to their RTP transmitter node."""
        with self.Session() as session:
            hub = Service(
                id=self.hub_id,
                name="PipeWire AES67 Hub",
                service_type="pipewire_hub",
                status="running",
                config={
                    "virtual_sinks": [
                        {
                            "id": "aes_bus",
                            "name": "AES Bus",
                            "channels": 2,
                            "aes67_enabled": True,
                            "multicast_ip": "239.69.1.13",
                            "rtp_port": 5010
                        }
                    ]
                }
            )
            session.add(hub)
            session.commit()

        links = self.supervisor._resolve_desired_links()
        self.assertEqual(len(links), 1)
        tx_link = links[0]
        self.assertEqual(tx_link.source_id, "aes_bus.monitor")
        self.assertEqual(tx_link.target_id, "rtp_tx_aes_bus")
        self.assertEqual(tx_link.source_ports, ["aes_bus:monitor_FL", "aes_bus:monitor_FR"])
        self.assertEqual(tx_link.target_ports, ["rtp_tx_aes_bus:input_FL", "rtp_tx_aes_bus:input_FR"])
        self.assertEqual(tx_link.link_type, "monitor_capture")
        self.assertEqual(tx_link.target_entity_type, "aes67_sink")
        self.assertIn("AES Bus.monitor → AES67 Tx (239.69.1.13:5010)", tx_link.description)

    @patch("asyncio.create_subprocess_exec")
    async def test_reconcile_links_established(self, mock_exec):
        """Tests that reconcile identifies missing routes and connects them via pw-link."""
        # Setup DB with Kiosk -> master_bus
        with self.Session() as session:
            hub = Service(id=self.hub_id, name="Hub", service_type="pipewire_hub", status="running", config={"virtual_sinks": [{"id": "master_bus"}]})
            desktop = Service(id=10, name="Desktop", service_type="desktop", status="running", config={"desktop_config": {"audio_backend": "pipewire_hub", "pipewire_service_id": self.hub_id, "pipewire_sink_id": "master_bus"}})
            kiosk = Service(id=13, name="Kiosk", service_type="kiosk_browser", status="running", config={"kiosk_config": {"target_desktop_service_id": 10}})
            session.add_all([hub, desktop, kiosk])
            session.commit()
        self.pm.processes[13] = MagicMock(pid=1001)

        # pw-link -l (empty active links)
        proc_l = MagicMock()
        proc_l.communicate = AsyncMock(return_value=(b"", b""))

        # pw-link -o (Chromium output ports available)
        proc_o = MagicMock()
        proc_o.communicate = AsyncMock(return_value=(b"Chromium:output_FL\nChromium:output_FR\n", b""))

        # pw-link -i (master_bus playback ports available)
        proc_i = MagicMock()
        proc_i.communicate = AsyncMock(return_value=(b"master_bus:playback_FL\nmaster_bus:playback_FR\n", b""))

        # pw-link <src> <dst>
        proc_link1 = MagicMock()
        proc_link1.communicate = AsyncMock(return_value=(b"", b""))
        proc_link2 = MagicMock()
        proc_link2.communicate = AsyncMock(return_value=(b"", b""))

        mock_exec.side_effect = [proc_l, proc_o, proc_i, proc_link1, proc_link2]

        with patch.object(self.pm, "_get_pipewire_tool_binary", return_value=("/usr/bin/pw-link", None)):
            await self.supervisor.reconcile()

        link_calls = [
            call for call in mock_exec.call_args_list
            if len(call[0]) >= 3 and call[0][0] == "/usr/bin/pw-link"
        ]
        self.assertEqual(len(link_calls), 2)
        self.assertEqual(link_calls[0][0], ("/usr/bin/pw-link", "Chromium:output_FL", "master_bus:playback_FL"))
        self.assertEqual(link_calls[1][0], ("/usr/bin/pw-link", "Chromium:output_FR", "master_bus:playback_FR"))

        status = self.supervisor.get_matrix_status()
        self.assertEqual(status["active_links_count"], 1)
        self.assertEqual(status["pending_links_count"], 0)
        self.assertEqual(status["routes"][0]["status"], "linked")

    @patch("asyncio.create_subprocess_exec")
    async def test_reconcile_pending_source_when_muted(self, mock_exec):
        """Tests that when client audio is muted or not yet streaming, route is marked pending_source without errors."""
        with self.Session() as session:
            hub = Service(id=self.hub_id, name="Hub", service_type="pipewire_hub", status="running", config={"virtual_sinks": [{"id": "master_bus"}]})
            desktop = Service(id=10, name="Desktop", service_type="desktop", status="running", config={"desktop_config": {"audio_backend": "pipewire_hub", "pipewire_service_id": self.hub_id, "pipewire_sink_id": "master_bus"}})
            kiosk = Service(id=13, name="Kiosk", service_type="kiosk_browser", status="running", config={"kiosk_config": {"target_desktop_service_id": 10}})
            session.add_all([hub, desktop, kiosk])
            session.commit()
        self.pm.processes[13] = MagicMock(pid=1001)

        proc_l = MagicMock()
        proc_l.communicate = AsyncMock(return_value=(b"", b""))
        # No Chromium output ports in pw-link -o
        proc_o = MagicMock()
        proc_o.communicate = AsyncMock(return_value=(b"Dummy:output_FL\n", b""))
        # master_bus playback ports are ready in pw-link -i
        proc_i = MagicMock()
        proc_i.communicate = AsyncMock(return_value=(b"master_bus:playback_FL\nmaster_bus:playback_FR\n", b""))

        mock_exec.side_effect = [proc_l, proc_o, proc_i]

        with patch.object(self.pm, "_get_pipewire_tool_binary", return_value=("/usr/bin/pw-link", None)):
            await self.supervisor.reconcile()

        # No links should have been attempted
        link_calls = [
            call for call in mock_exec.call_args_list
            if len(call[0]) >= 3 and call[0][0] == "/usr/bin/pw-link"
        ]
        self.assertEqual(len(link_calls), 0)

        status = self.supervisor.get_matrix_status()
        self.assertEqual(status["active_links_count"], 0)
        self.assertEqual(status["pending_links_count"], 1)
        self.assertEqual(status["routes"][0]["status"], "pending_source")

    def test_flexible_channel_port_matching(self):
        """Tests that _match_ports correctly maps channels even with numeric suffixes or aliases."""
        available_outputs = {
            "Chromium:output_0",
            "Chromium:output_1",
            "other_node:output_FL"
        }
        res = PipeWireMatrixSupervisor._match_ports(
            candidate_node="kiosk_13",
            desired_ports=["kiosk_13:output_FL", "kiosk_13:output_FR"],
            aliases=["Chromium"],
            available_ports=available_outputs
        )
        self.assertEqual(res, ["Chromium:output_0", "Chromium:output_1"])

    @patch("asyncio.create_subprocess_exec")
    async def test_reconcile_ffmpeg_monitor_ingest(self, mock_exec):
        """Tests linking master_bus.monitor to FFmpeg service input ports."""
        with self.Session() as session:
            hub = Service(id=self.hub_id, name="Hub", service_type="pipewire_hub", status="running", config={"virtual_sinks": [{"id": "master_bus"}]})
            ffmpeg_svc = Service(
                id=1,
                name="Playout",
                service_type="ffmpeg_stream",
                status="running",
                config={"input_config": {"type": "pipewire", "provider_service_id": self.hub_id, "sink_id": "master_bus"}}
            )
            session.add_all([hub, ffmpeg_svc])
            session.commit()
        self.pm.processes[1] = MagicMock(pid=1002)

        proc_l = MagicMock()
        proc_l.communicate = AsyncMock(return_value=(b"", b""))

        proc_o = MagicMock()
        proc_o.communicate = AsyncMock(return_value=(b"master_bus:monitor_FL\nmaster_bus:monitor_FR\n", b""))

        proc_i = MagicMock()
        proc_i.communicate = AsyncMock(return_value=(b"ffmpeg_service_1:input_FL\nffmpeg_service_1:input_FR\n", b""))

        proc_link1 = MagicMock()
        proc_link1.communicate = AsyncMock(return_value=(b"", b""))
        proc_link2 = MagicMock()
        proc_link2.communicate = AsyncMock(return_value=(b"", b""))

        mock_exec.side_effect = [proc_l, proc_o, proc_i, proc_link1, proc_link2]

        with patch.object(self.pm, "_get_pipewire_tool_binary", return_value=("/usr/bin/pw-link", None)):
            await self.supervisor.reconcile()

        link_calls = [
            call for call in mock_exec.call_args_list
            if len(call[0]) >= 3 and call[0][0] == "/usr/bin/pw-link"
        ]
        self.assertEqual(len(link_calls), 2)
        self.assertEqual(link_calls[0][0], ("/usr/bin/pw-link", "master_bus:monitor_FL", "ffmpeg_service_1:input_FL"))
        self.assertEqual(link_calls[1][0], ("/usr/bin/pw-link", "master_bus:monitor_FR", "ffmpeg_service_1:input_FR"))

    def test_notify_pipewire_matrix_change_triggers_reconcile(self):
        """Tests that notify_pipewire_matrix_change triggers supervisor reconcile event."""
        self.pm.pipewire_supervisors[self.hub_id] = self.supervisor
        self.assertFalse(self.supervisor._trigger_event.is_set())

        self.pm.notify_pipewire_matrix_change(self.hub_id)
        self.assertTrue(self.supervisor._trigger_event.is_set())

    @patch("asyncio.create_subprocess_exec")
    async def test_watchdog_triggers_restart_when_ffmpeg_node_missing_for_four_ticks(self, mock_exec):
        """Tests that supervisor watchdog requests restart when an active FFmpeg process misses its node in PipeWire for 4 ticks."""
        with self.Session() as session:
            hub = Service(
                id=self.hub_id,
                name="PipeWire Test Hub",
                service_type="pipewire_hub",
                status="running",
                config={"virtual_sinks": [{"id": "master_bus"}]}
            )
            ffmpeg_svc = Service(
                id=1,
                name="FFmpeg Output",
                service_type="ffmpeg_stream",
                status="running",
                config={"input_config": {"type": "pipewire", "provider_service_id": self.hub_id, "sink_id": "master_bus"}}
            )
            session.add_all([hub, ffmpeg_svc])
            session.commit()

        # Active in pm.processes
        mock_proc = MagicMock()
        mock_proc.returncode = None
        self.pm.processes[1] = mock_proc

        # pw-link outputs: master_bus is present, but ffmpeg_service_1 is missing!
        proc_l = MagicMock()
        proc_l.communicate = AsyncMock(return_value=(b"", b""))

        proc_o = MagicMock()
        proc_o.communicate = AsyncMock(return_value=(b"master_bus:monitor_FL\nmaster_bus:monitor_FR\n", b""))

        proc_i = MagicMock()
        proc_i.communicate = AsyncMock(return_value=(b"", b""))  # No ffmpeg ports!

        mock_exec.side_effect = [proc_l, proc_o, proc_i] * 5

        self.pm.restart_process = AsyncMock()

        with patch.object(self.pm, "_get_pipewire_tool_binary", return_value=("/usr/bin/pw-link", None)):
            # First 3 ticks: count reaches 3, no restart yet
            for i in range(3):
                await self.supervisor.reconcile()
                self.assertEqual(self.supervisor._missing_node_counts.get(1), i + 1)
                self.pm.restart_process.assert_not_called()

            # 4th tick: count reaches 4, restart is triggered!
            await self.supervisor.reconcile()
            self.pm.restart_process.assert_called_once_with(1)

    @patch("asyncio.create_subprocess_exec")
    async def test_watchdog_does_not_trigger_for_kiosks(self, mock_exec):
        """Tests that kiosks muted/buffering do NOT trigger automatic restart watchdog."""
        with self.Session() as session:
            hub = Service(
                id=self.hub_id,
                name="PipeWire Test Hub",
                service_type="pipewire_hub",
                status="running",
                config={"virtual_sinks": [{"id": "master_bus"}]}
            )
            desktop = Service(
                id=10,
                name="Studio Desktop",
                service_type="desktop",
                status="running",
                config={"desktop_config": {"audio_backend": "pipewire_hub", "pipewire_service_id": self.hub_id}}
            )
            kiosk = Service(
                id=13,
                name="Kiosk",
                service_type="kiosk_browser",
                status="running",
                config={"kiosk_config": {"target_desktop_service_id": 10}}
            )
            session.add_all([hub, desktop, kiosk])
            session.commit()

        # Active kiosk process
        mock_kiosk_proc = MagicMock()
        mock_kiosk_proc.returncode = None
        self.pm.processes[13] = mock_kiosk_proc

        proc_l = MagicMock()
        proc_l.communicate = AsyncMock(return_value=(b"", b""))
        proc_o = MagicMock()
        proc_o.communicate = AsyncMock(return_value=(b"", b""))  # No kiosk ports (muted)
        proc_i = MagicMock()
        proc_i.communicate = AsyncMock(return_value=(b"master_bus:playback_FL\nmaster_bus:playback_FR\n", b""))

        mock_exec.side_effect = [proc_l, proc_o, proc_i] * 5

        self.pm.restart_process = AsyncMock()

        with patch.object(self.pm, "_get_pipewire_tool_binary", return_value=("/usr/bin/pw-link", None)):
            for _ in range(5):
                await self.supervisor.reconcile()

            # Kiosks must never be restarted by missing node watchdog
            self.pm.restart_process.assert_not_called()
            self.assertNotIn(13, self.supervisor._missing_node_counts)

    def test_resolve_desired_links_single_hub_implicit_fallback(self):
        """Tests that single PipeWire Hub in DB provides implicit binding fallback when provider_service_id is omitted."""
        with self.Session() as session:
            hub = Service(
                id=self.hub_id,
                name="PipeWire Single Hub",
                service_type="pipewire_hub",
                status="running",
                config={
                    "virtual_sinks": [
                        {"id": "master_bus", "name": "Master Bus", "channels": 2},
                        {"id": "aux_bus", "name": "Aux Bus", "channels": 2}
                    ]
                }
            )
            # Service publishing audio to PipeWire without explicit provider_service_id
            pub_svc = Service(
                id=20,
                name="Stream Icecast to PW",
                service_type="ffmpeg_stream",
                status="running",
                config={
                    "input_config": {"type": "icecast", "url": "http://stream.example.com/audio"},
                    "output_config": {"type": "pipewire", "sink_id": "aux_bus"}
                }
            )
            # Service consuming audio from PipeWire without explicit provider_service_id
            sub_svc = Service(
                id=21,
                name="Stream PW to ALSA",
                service_type="ffmpeg_stream",
                status="running",
                config={
                    "input_config": {"type": "pipewire", "sink_id": "aux_bus"},
                    "output_config": {"type": "alsa", "device": "hw:0,0"}
                }
            )
            session.add_all([hub, pub_svc, sub_svc])
            session.commit()

        self.pm.processes[20] = MagicMock(returncode=None)
        self.pm.processes[21] = MagicMock(returncode=None)

        desired = self.supervisor._resolve_desired_links()
        self.assertEqual(len(desired), 2)

        pub_link = next((d for d in desired if d.source_entity_id == 20), None)
        self.assertIsNotNone(pub_link)
        self.assertEqual(pub_link.source_id, "ffmpeg_service_20")
        self.assertEqual(pub_link.target_id, "aux_bus")
        self.assertEqual(pub_link.link_type, "playback")
        self.assertIn("ffmpeg_proc_20", pub_link.source_aliases)

        sub_link = next((d for d in desired if d.target_entity_id == 21), None)
        self.assertIsNotNone(sub_link)
        self.assertEqual(sub_link.source_id, "aux_bus.monitor")
        self.assertEqual(sub_link.target_id, "ffmpeg_service_21")
        self.assertEqual(sub_link.link_type, "monitor_capture")
        self.assertIn("ffmpeg_proc_21", sub_link.target_aliases)

    def test_match_ports_with_proc_and_service_aliases(self):
        """Tests that _match_ports matches FFmpeg whether ports are named ffmpeg_proc_ or ffmpeg_service_."""
        candidate = "ffmpeg_service_20"
        desired_ports = ["ffmpeg_service_20:output_FL", "ffmpeg_service_20:output_FR"]
        aliases = ["ffmpeg_service_20", "ffmpeg_proc_20", "ffmpeg_20", "ffmpeg"]

        # Case 1: FFmpeg registered with ffmpeg_proc_20:output_FL / FR
        available_proc = {"ffmpeg_proc_20:output_FL", "ffmpeg_proc_20:output_FR", "master_bus:playback_FL"}
        matched = self.supervisor._match_ports(candidate, desired_ports, aliases, available_proc)
        self.assertEqual(matched, ["ffmpeg_proc_20:output_FL", "ffmpeg_proc_20:output_FR"])

        # Case 2: FFmpeg registered with ffmpeg_service_20:output_FL / FR
        available_service = {"ffmpeg_service_20:output_FL", "ffmpeg_service_20:output_FR", "master_bus:playback_FL"}
        matched = self.supervisor._match_ports(candidate, desired_ports, aliases, available_service)
        self.assertEqual(matched, ["ffmpeg_service_20:output_FL", "ffmpeg_service_20:output_FR"])

    def test_sanitize_output_config_preserves_pipewire(self):
        """Tests that sanitize_output_config_data preserves provider_service_id for pipewire outputs."""
        import main
        out_cfg = {
            "type": "pipewire",
            "sink_id": "master_bus",
            "provider_service_id": 14
        }
        main.sanitize_output_config_data(out_cfg)
        self.assertEqual(out_cfg.get("provider_service_id"), 14)
        self.assertEqual(out_cfg.get("pipewire_service_id"), 14)

        # For file output, provider_service_id should be stripped
        file_cfg = {
            "type": "file",
            "path": "/tmp/test.mp4",
            "provider_service_id": 14
        }
        main.sanitize_output_config_data(file_cfg)
        self.assertNotIn("provider_service_id", file_cfg)

    def test_dependency_manager_sync_pipewire_output(self):
        """Tests that dependency_manager registers ServiceDependency for PipeWire outputs."""
        from core.dependency_manager import dependency_manager
        from database.models import ServiceDependency

        with self.Session() as session:
            out_cfg = {
                "type": "pipewire",
                "sink_id": "master_bus",
                "provider_service_id": self.hub_id
            }
            dependency_manager.sync_auto_dependencies("service", 25, None, out_cfg, session)

            dep = session.query(ServiceDependency).filter(
                ServiceDependency.consumer_type == "service",
                ServiceDependency.consumer_id == 25
            ).first()
            self.assertIsNotNone(dep)
            self.assertEqual(dep.provider_service_id, self.hub_id)

    def test_resolve_desired_links_with_remote_sinks(self):
        """Verifies that PipeWireMatrixSupervisor resolves AES67 Rx links and consumer monitor links for remote_sinks."""
        from database.models import Service

        with self.Session() as session:
            # Clean db
            session.query(Service).delete()
            session.commit()

            hub = Service(
                id=self.hub_id,
                name="PipeWire Hub with Remote Sinks",
                service_type="pipewire_hub",
                status="running",
                config={
                    "virtual_sinks": [{"id": "master_bus", "name": "Master Bus"}],
                    "remote_sinks": [
                        {
                            "id": "remote_test1_aes",
                            "name": "Test1 AES Stream",
                            "multicast_ip": "239.69.11.1",
                            "rtp_port": 5004,
                            "channels": 2
                        }
                    ]
                }
            )
            consumer_svc = Service(
                id=30,
                name="FFmpeg Capture Remote AES",
                service_type="ffmpeg_stream",
                status="running",
                config={
                    "input_config": {"type": "pipewire", "sink_id": "remote_test1_aes", "provider_service_id": self.hub_id},
                    "output_config": {"type": "alsa", "device": "hw:0,0"}
                }
            )
            session.add_all([hub, consumer_svc])
            session.commit()

        self.pm.processes[30] = MagicMock(returncode=None)

        links = self.supervisor._resolve_desired_links()

        # Link 1: AES67 Rx (rtp_rx_remote_test1_aes -> remote_test1_aes)
        rx_links = [l for l in links if l.source_id == "rtp_rx_remote_test1_aes"]
        self.assertEqual(len(rx_links), 1)
        rx_link = rx_links[0]
        self.assertEqual(rx_link.target_id, "remote_test1_aes")
        self.assertEqual(rx_link.link_type, "playback")
        self.assertEqual(rx_link.target_ports, ["remote_test1_aes:playback_FL", "remote_test1_aes:playback_FR"])

        # Link 2: Consumer capture (remote_test1_aes.monitor -> ffmpeg_service_30)
        capture_links = [l for l in links if l.source_id == "remote_test1_aes.monitor"]
        self.assertEqual(len(capture_links), 1)
        cap_link = capture_links[0]
        self.assertEqual(cap_link.target_id, "ffmpeg_service_30")
        self.assertEqual(cap_link.link_type, "monitor_capture")



