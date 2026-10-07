import os
import unittest
from unittest.mock import patch, MagicMock, AsyncMock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database.models import Base, Service
from core.process_manager import ProcessManager
from core.resource_lock_manager import resource_lock_manager
from core.dependency_manager import dependency_manager


class TestDesktopPipeWireLease(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.pm = ProcessManager(self.Session)

        with resource_lock_manager._lock:
            resource_lock_manager._locks.clear()
        with dependency_manager.state_lock:
            dependency_manager.active_leases.clear()
            dependency_manager.pinned_services.clear()

    async def asyncTearDown(self):
        with resource_lock_manager._lock:
            resource_lock_manager._locks.clear()
        with dependency_manager.state_lock:
            dependency_manager.active_leases.clear()
            dependency_manager.pinned_services.clear()

    @patch("shutil.which", return_value="/usr/bin/mock")
    @patch("asyncio.create_subprocess_exec")
    async def test_start_desktop_acquires_pipewire_lease(self, mock_exec, mock_which):
        mock_proc = MagicMock()
        mock_proc.pid = 11111
        mock_proc.returncode = None
        mock_proc.wait = AsyncMock(return_value=0)
        mock_exec.return_value = mock_proc

        with self.Session() as session:
            svc = Service(
                id=10,
                name="Desktop PipeWire",
                service_type="desktop",
                status="stopped",
                config={
                    "desktop_config": {
                        "display_num": 99,
                        "vnc_port": 5999,
                        "audio_backend": "pipewire_hub",
                        "pipewire_service_id": 88
                    }
                }
            )
            session.add(svc)
            session.commit()

        with patch.object(self.pm, "_watchdog", new_callable=AsyncMock), \
             patch.object(self.pm, "_file_log_tailer", new_callable=AsyncMock), \
             patch.object(self.pm, "_spawn_x11vnc", new_callable=AsyncMock), \
             patch.object(self.pm, "acquire_lease", new_callable=AsyncMock) as mock_acquire_lease:

            await self.pm.start_process(10)

            mock_acquire_lease.assert_awaited_once()
            call_args, call_kwargs = mock_acquire_lease.await_args
            self.assertEqual(call_args[0], 88)
            self.assertEqual(call_kwargs.get("lease_holder"), "desktop_10")
            self.assertIsNotNone(call_kwargs.get("db"))

    @patch("shutil.which", return_value="/usr/bin/mock")
    async def test_stop_desktop_releases_pipewire_lease(self, mock_which):
        with self.Session() as session:
            svc = Service(
                id=20,
                name="Desktop PipeWire Stop",
                service_type="desktop",
                status="running",
                pid=22222,
                config={
                    "desktop_config": {
                        "display_num": 99,
                        "vnc_port": 5999,
                        "audio_backend": "pipewire_hub",
                        "pipewire_service_id": 88
                    }
                }
            )
            session.add(svc)
            session.commit()

        with patch.object(self.pm, "release_lease", new_callable=AsyncMock) as mock_release_lease:
            await self.pm.stop_process(20)

            mock_release_lease.assert_awaited_once()
            call_args, call_kwargs = mock_release_lease.await_args
            self.assertEqual(call_args[0], 88)
            self.assertEqual(call_kwargs.get("lease_holder"), "desktop_20")
            self.assertIsNotNone(call_kwargs.get("db"))

    @patch("shutil.which", return_value="/usr/bin/mock")
    @patch("asyncio.create_subprocess_exec")
    async def test_start_desktop_alsa_loopback_does_not_acquire_pipewire_lease(self, mock_exec, mock_which):
        mock_proc = MagicMock()
        mock_proc.pid = 33333
        mock_proc.returncode = None
        mock_proc.wait = AsyncMock(return_value=0)
        mock_exec.return_value = mock_proc

        with self.Session() as session:
            svc = Service(
                id=30,
                name="Desktop ALSA",
                service_type="desktop",
                status="stopped",
                config={
                    "desktop_config": {
                        "display_num": 99,
                        "vnc_port": 5999,
                        "audio_backend": "alsa_loopback",
                        "pipewire_service_id": 88
                    }
                }
            )
            session.add(svc)
            session.commit()

        with patch.object(self.pm, "_watchdog", new_callable=AsyncMock), \
             patch.object(self.pm, "_file_log_tailer", new_callable=AsyncMock), \
             patch.object(self.pm, "_spawn_x11vnc", new_callable=AsyncMock), \
             patch.object(self.pm, "acquire_lease", new_callable=AsyncMock) as mock_acquire_lease:

            await self.pm.start_process(30)

            mock_acquire_lease.assert_not_called()
