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
