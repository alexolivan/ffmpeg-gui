import unittest
import asyncio
from unittest.mock import patch, MagicMock, AsyncMock
from database.db import SessionLocal, init_db
from database.models import MediaProcess
import main

class TestStartupReattach(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        init_db()
        main._startup_initialized = False
        main._shutdown_initialized = False
        self.db = SessionLocal()
        self.db.query(MediaProcess).delete()
        self.db.commit()

    async def asyncTearDown(self):
        self.db.query(MediaProcess).delete()
        self.db.commit()
        self.db.close()

    @patch("main.cleanup_rogue_processes")
    @patch("psutil.pid_exists")
    @patch("main.process_manager.reattach_process")
    async def test_startup_event_reattaches_alive_processes_and_stops_dead_ones(
        self, mock_reattach, mock_pid_exists, mock_cleanup
    ):
        # Setup mock behavior
        # Let's say PID 12345 exists, and PID 67890 does not
        def side_effect_pid_exists(pid):
            return pid == 12345
        mock_pid_exists.side_effect = side_effect_pid_exists

        # Create two running processes in DB
        alive_proc = MediaProcess(
            name="Alive Process",
            type="service",
            input_config={"type": "lavfi", "path": "testsrc"},
            output_config={"type": "file", "path": "/tmp/alive.mp4"},
            codec_config={},
            status="running",
            pid=12345
        )
        dead_proc = MediaProcess(
            name="Dead Process",
            type="service",
            input_config={"type": "lavfi", "path": "testsrc"},
            output_config={"type": "file", "path": "/tmp/dead.mp4"},
            codec_config={},
            status="running",
            pid=67890
        )
        self.db.add_all([alive_proc, dead_proc])
        self.db.commit()
        self.db.refresh(alive_proc)
        self.db.refresh(dead_proc)

        # Mock LCD manager start and scheduler to avoid side effects
        mock_sch = MagicMock()
        mock_sch.start = AsyncMock()
        with patch("main.lcd_manager") as mock_lcd, \
             patch("main.scheduler", mock_sch), \
             patch("main.telemetry_broadcast_loop") as mock_telemetry, \
             patch("main.auto_start_services") as mock_auto_start:
            
            # Execute the startup event
            await main.startup_event()

            # Verify alive process got reattached
            mock_reattach.assert_called_once_with(alive_proc.id, 12345)

            # Verify cleanup_rogue_processes called with active PIDs
            mock_cleanup.assert_called_once()
            _, kwargs = mock_cleanup.call_args
            self.assertIn("active_pids", kwargs)
            self.assertEqual(kwargs["active_pids"], {12345})

            # Refresh and check DB states
            self.db.refresh(alive_proc)
            self.db.refresh(dead_proc)

            # Alive process should remain running
            self.assertEqual(alive_proc.status, "running")
            self.assertEqual(alive_proc.pid, 12345)

            # Dead process should be stopped with PID cleared
            self.assertEqual(dead_proc.status, "stopped")
            self.assertIsNone(dead_proc.pid)
            self.assertEqual(dead_proc.cpu_usage, 0)
            self.assertEqual(dead_proc.ram_usage, 0)
            self.assertEqual(dead_proc.fps, "0")
            self.assertEqual(dead_proc.bitrate, "0 kb/s")
            self.assertEqual(dead_proc.speed, "0x")

    @patch("main.cleanup_rogue_processes")
    @patch("psutil.pid_exists")
    @patch("main.process_manager.reattach_process")
    async def test_startup_event_stops_debug_mode_processes(
        self, mock_reattach, mock_pid_exists, mock_cleanup
    ):
        mock_pid_exists.return_value = True

        debug_proc = MediaProcess(
            name="Debug Process",
            type="service",
            input_config={"type": "lavfi", "path": "testsrc"},
            output_config={"type": "file", "path": "/tmp/debug.mp4"},
            codec_config={},
            status="running",
            pid=12345,
            debug_mode=True
        )
        self.db.add(debug_proc)
        self.db.commit()
        self.db.refresh(debug_proc)

        mock_sch = MagicMock()
        mock_sch.start = AsyncMock()
        with patch("main.lcd_manager") as mock_lcd, \
             patch("main.scheduler", mock_sch), \
             patch("main.telemetry_broadcast_loop") as mock_telemetry, \
             patch("main.auto_start_services") as mock_auto_start:
            
            await main.startup_event()

            # Verify debug process was NOT reattached
            mock_reattach.assert_not_called()

            # Refresh and check DB states
            self.db.refresh(debug_proc)

            # Debug process should be marked as stopped
            self.assertEqual(debug_proc.status, "stopped")
            self.assertIsNone(debug_proc.pid)

    @patch("asyncio.create_task")
    def test_reattach_process_restores_resource_lock(self, mock_create_task):
        from core.resource_lock_manager import resource_lock_manager
        resource_lock_manager.clear_all()

        pub_proc = MediaProcess(
            name="Icecast Radio Stream",
            type="service",
            input_config={"type": "alsa", "device": "hw:0,0"},
            output_config={"type": "icecast", "icecast_mount": "/radio.mp3", "provider_service_id": 7},
            codec_config={},
            status="running",
            pid=54321
        )
        self.db.add(pub_proc)
        self.db.commit()
        self.db.refresh(pub_proc)

        # Reattach process via process_manager
        main.process_manager.reattach_process(pub_proc.id, 54321)

        # Verify resource lock was acquired for /radio.mp3
        locks = resource_lock_manager.get_active_locks()
        self.assertEqual(len(locks), 1)
        self.assertEqual(locks[0]["resource_path"], "/radio.mp3")
        self.assertEqual(locks[0]["owner_id"], pub_proc.id)
        self.assertEqual(locks[0]["owner_type"], "service")

        resource_lock_manager.clear_all()

    @patch("asyncio.create_task")
    def test_reattach_process_restores_active_leases_for_desktop_and_kiosk(self, mock_create_task):
        from core.dependency_manager import dependency_manager
        with dependency_manager.state_lock:
            dependency_manager.active_leases.clear()

        pw_proc = MediaProcess(
            id=100,
            name="PipeWire Hub Test",
            type="service",
            service_type="pipewire_hub",
            config={"pipewire_config": {"virtual_sinks": [{"id": "mix_bus"}]}},
            status="running",
            pid=88880
        )
        desk_proc = MediaProcess(
            id=101,
            name="Virtual Desktop Test",
            type="service",
            service_type="desktop",
            config={"desktop_config": {"audio_backend": "pipewire_hub", "pipewire_service_id": 100, "pipewire_sink_id": "mix_bus"}},
            status="running",
            pid=88881
        )
        kiosk_proc = MediaProcess(
            id=102,
            name="Kiosk Test",
            type="service",
            service_type="kiosk_browser",
            config={"kiosk_config": {"target_desktop_service_id": 101}},
            status="running",
            pid=88882
        )
        self.db.add_all([pw_proc, desk_proc, kiosk_proc])
        self.db.commit()

        # Reattach the desktop and kiosk
        main.process_manager.reattach_process(desk_proc.id, 88881)
        main.process_manager.reattach_process(kiosk_proc.id, 88882)

        # Verify PipeWire hub has leases for both desktop and kiosk
        pw_leases = dependency_manager.get_active_leases(100)
        self.assertIn("desktop:101", pw_leases)
        self.assertIn("kiosk:102", pw_leases)

        # Verify Desktop has lease for kiosk
        desk_leases = dependency_manager.get_active_leases(101)
        self.assertIn("service:102", desk_leases)

    def test_reconcile_active_leases_cold_boot(self):
        from core.dependency_manager import dependency_manager
        with dependency_manager.state_lock:
            dependency_manager.active_leases.clear()

        pw_proc = MediaProcess(
            id=200,
            name="PipeWire Hub Cold Boot",
            type="service",
            service_type="pipewire_hub",
            config={"pipewire_config": {"virtual_sinks": [{"id": "mix_bus"}]}},
            status="running",
            pid=99990
        )
        desk_proc = MediaProcess(
            id=201,
            name="Virtual Desktop Cold Boot",
            type="service",
            service_type="desktop",
            config={"desktop_config": {"audio_backend": "pipewire_hub", "pipewire_service_id": 200, "pipewire_sink_id": "mix_bus"}},
            status="running",
            pid=99991
        )
        kiosk_proc = MediaProcess(
            id=202,
            name="Kiosk Cold Boot",
            type="service",
            service_type="kiosk_browser",
            config={"kiosk_config": {"target_desktop_service_id": 201}},
            status="running",
            pid=99992
        )
        self.db.add_all([pw_proc, desk_proc, kiosk_proc])
        self.db.commit()

        # Leases are initially empty
        self.assertEqual(dependency_manager.get_active_leases(200), [])
        self.assertEqual(dependency_manager.get_active_leases(201), [])

        # Run reconciliation pass (simulating startup)
        dependency_manager.reconcile_active_leases(self.db)

        # Verify restored leases
        pw_leases = dependency_manager.get_active_leases(200)
        self.assertIn("desktop:201", pw_leases)
        self.assertIn("kiosk:202", pw_leases)

        desk_leases = dependency_manager.get_active_leases(201)
        self.assertIn("service:202", desk_leases)

