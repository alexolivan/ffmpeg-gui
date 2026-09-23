import os
import unittest
from unittest.mock import patch, MagicMock, AsyncMock
import psutil
import signal
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database.models import Base, Service
from core.process_manager import ProcessManager
from utils.process_utils import cleanup_rogue_processes


class TestDesktopLifecycle(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.pm = ProcessManager(self.Session)

    def test_build_desktop_cmds_default_values(self):
        svc = Service(
            id=1,
            name="Desktop Default",
            service_type="desktop",
            config={"desktop_config": {}},
        )
        xvfb_cmd, xset_cmd, xsetroot_cmd, x11vnc_cmd, display_num, vnc_port = self.pm._build_desktop_cmds(svc)

        self.assertEqual(display_num, 99)
        self.assertEqual(vnc_port, 5999)

        # Xvfb command validation
        self.assertTrue(any("Xvfb" in arg for arg in xvfb_cmd))
        self.assertIn(":99", xvfb_cmd)
        self.assertIn("1920x1080x24", xvfb_cmd)
        self.assertIn("-nocursor", xvfb_cmd)
        self.assertIn("-nolisten", xvfb_cmd)
        self.assertIn("tcp", xvfb_cmd)
        self.assertIn("-s", xvfb_cmd)
        self.assertIn("0", xvfb_cmd)
        self.assertIn("-dpms", xvfb_cmd)

        # xset anti-screensaver hardening command validation
        self.assertTrue(any("xset" in arg for arg in xset_cmd))
        self.assertEqual(xset_cmd[1:], ["s", "off", "-dpms", "s", "noblank"])

        # xsetroot cursor & canvas hardening command validation
        self.assertTrue(any("xsetroot" in arg for arg in xsetroot_cmd))
        self.assertIn("-cursor_name", xsetroot_cmd)
        self.assertIn("left_ptr", xsetroot_cmd)
        self.assertIn("-solid", xsetroot_cmd)
        self.assertIn("#111827", xsetroot_cmd)

        # x11vnc command validation
        self.assertTrue(any("x11vnc" in arg for arg in x11vnc_cmd))
        self.assertIn("-display", x11vnc_cmd)
        self.assertIn(":99", x11vnc_cmd)
        self.assertIn("-rfbport", x11vnc_cmd)
        self.assertIn("5999", x11vnc_cmd)
        self.assertIn("-localhost", x11vnc_cmd)
        self.assertIn("-nopw", x11vnc_cmd)
        self.assertIn("-forever", x11vnc_cmd)
        self.assertIn("-shared", x11vnc_cmd)
        self.assertNotIn("-bg", x11vnc_cmd)

    def test_build_desktop_cmds_custom_values(self):
        svc = Service(
            id=2,
            name="Desktop Custom 720p",
            service_type="desktop",
            config={
                "desktop_config": {
                    "display_num": 105,
                    "resolution": "1280x720",
                    "color_depth": 16,
                    "vnc_port": 6005,
                }
            },
        )
        xvfb_cmd, xset_cmd, xsetroot_cmd, x11vnc_cmd, display_num, vnc_port = self.pm._build_desktop_cmds(svc)

        self.assertEqual(display_num, 105)
        self.assertEqual(vnc_port, 6005)
        self.assertIn(":105", xvfb_cmd)
        self.assertIn("1280x720x16", xvfb_cmd)
        self.assertIn("-solid", xsetroot_cmd)
        self.assertIn("#111827", xsetroot_cmd)
        self.assertIn(":105", x11vnc_cmd)
        self.assertIn("6005", x11vnc_cmd)

    @patch("shutil.which")
    async def test_desktop_service_missing_xvfb_raises(self, mock_which):
        mock_which.return_value = None  # Xvfb not found
        with self.Session() as session:
            svc = Service(
                id=3,
                name="Desktop Missing Bin",
                service_type="desktop",
                status="stopped",
                config={"desktop_config": {}},
            )
            session.add(svc)
            session.commit()

        with self.assertRaises(FileNotFoundError):
            await self.pm.start_process(3)

        with self.Session() as session:
            updated = session.get(Service, 3)
            self.assertEqual(updated.status, "error")

    @patch("shutil.which", return_value="/usr/bin/mock")
    @patch("asyncio.create_subprocess_exec")
    async def test_desktop_start_and_stop_lifecycle(self, mock_exec, mock_which):
        # Mock processes
        mock_xvfb = MagicMock()
        mock_xvfb.pid = 11111
        mock_xvfb.returncode = None
        mock_xvfb.wait = AsyncMock(return_value=0)
        mock_xvfb.terminate = MagicMock(side_effect=lambda: setattr(mock_xvfb, "returncode", 0))
        mock_xvfb.kill = MagicMock(side_effect=lambda: setattr(mock_xvfb, "returncode", -9))
        mock_xvfb.stdin = None

        mock_xset = MagicMock()
        mock_xset.wait = AsyncMock(return_value=0)

        mock_xsetroot = MagicMock()
        mock_xsetroot.wait = AsyncMock(return_value=0)

        mock_x11vnc = MagicMock()
        mock_x11vnc.pid = 22222
        mock_x11vnc.returncode = None
        mock_x11vnc.wait = AsyncMock(return_value=0)
        mock_x11vnc.terminate = MagicMock(side_effect=lambda: setattr(mock_x11vnc, "returncode", 0))
        mock_x11vnc.kill = MagicMock(side_effect=lambda: setattr(mock_x11vnc, "returncode", -9))
        mock_x11vnc.stdin = None

        mock_exec.side_effect = [mock_xvfb, mock_xset, mock_xsetroot, mock_x11vnc]

        with patch.object(self.pm, "_watchdog", new_callable=AsyncMock), \
             patch.object(self.pm, "_file_log_tailer", new_callable=AsyncMock):

            with self.Session() as session:
                svc = Service(
                    id=4,
                    name="Desktop Lifecycle",
                    service_type="desktop",
                    status="stopped",
                    config={"desktop_config": {"display_num": 99, "vnc_port": 5999}},
                )
                session.add(svc)
                session.commit()

            # Start process
            await self.pm.start_process(4)

            # Verify Xvfb was stored in processes
            self.assertIn(4, self.pm.processes)
            self.assertEqual(self.pm.processes[4], mock_xvfb)

            # Verify x11vnc was stored in auxiliary_processes and auxiliary_pids
            self.assertIn(4, self.pm.auxiliary_processes)
            self.assertEqual(self.pm.auxiliary_processes[4], [mock_x11vnc])
            self.assertEqual(self.pm.auxiliary_pids[4], [22222])

            # Stop process
            await self.pm.stop_process(4, graceful=True)

            # Verify terminations
            mock_xvfb.terminate.assert_called()
            mock_x11vnc.terminate.assert_called()
            self.assertNotIn(4, self.pm.processes)
            self.assertNotIn(4, self.pm.auxiliary_processes)

    @patch("shutil.which", return_value="/usr/bin/mock")
    @patch("asyncio.create_subprocess_exec")
    async def test_desktop_start_with_explicit_none_io_configs(self, mock_exec, mock_which):
        mock_xvfb = MagicMock()
        mock_xvfb.pid = 33333
        mock_xvfb.returncode = None
        mock_xvfb.wait = AsyncMock(return_value=0)
        mock_xvfb.terminate = MagicMock()

        mock_xset = MagicMock()
        mock_xset.wait = AsyncMock(return_value=0)

        mock_xsetroot = MagicMock()
        mock_xsetroot.wait = AsyncMock(return_value=0)

        mock_x11vnc = MagicMock()
        mock_x11vnc.pid = 44444
        mock_x11vnc.returncode = None
        mock_x11vnc.wait = AsyncMock(return_value=0)
        mock_x11vnc.terminate = MagicMock()

        mock_exec.side_effect = [mock_xvfb, mock_xset, mock_xsetroot, mock_x11vnc]

        with patch.object(self.pm, "_watchdog", new_callable=AsyncMock), \
             patch.object(self.pm, "_file_log_tailer", new_callable=AsyncMock):

            with self.Session() as session:
                svc = Service(
                    id=5,
                    name="Desktop None IO",
                    service_type="desktop",
                    status="stopped",
                    config={
                        "desktop_config": {"display_num": 99, "vnc_port": 5999},
                        "input_config": None,
                        "output_config": None,
                    },
                )
                session.add(svc)
                session.commit()

            await self.pm.start_process(5)
            self.assertIn(5, self.pm.processes)

            await self.pm.stop_process(5, graceful=True)
            self.assertNotIn(5, self.pm.processes)

    @patch("psutil.process_iter")
    def test_find_auxiliary_pids(self, mock_iter):
        with self.Session() as session:
            desk_svc = Service(
                id=10,
                name="Test Desktop",
                service_type="desktop",
                config={"desktop_config": {"display_num": 99}},
                status="running",
                pid=1791,
            )
            session.add(desk_svc)
            session.commit()

        proc_vnc = MagicMock()
        proc_vnc.info = {"pid": 1798, "name": "x11vnc"}
        proc_vnc.environ.return_value = {"FFMPEG_GUI_PROCESS_ID": "10"}

        proc_other = MagicMock()
        proc_other.info = {"pid": 2000, "name": "ffmpeg"}
        proc_other.environ.return_value = {"FFMPEG_GUI_PROCESS_ID": "1"}

        mock_iter.return_value = [proc_vnc, proc_other]

        aux_pids = self.pm.find_auxiliary_pids(process_id=10, svc_type="desktop")
        self.assertEqual(aux_pids, [1798])

    def test_find_auxiliary_pids_ignores_non_desktop_services(self):
        aux_pids = self.pm.find_auxiliary_pids(process_id=1, svc_type="ffmpeg_stream")
        self.assertEqual(aux_pids, [])

    @patch("core.process_manager.ProcessManager.find_auxiliary_pids")
    async def test_reattach_process_returns_all_pids(self, mock_find_aux):
        mock_find_aux.return_value = [1798]

        with self.Session() as session:
            desk_svc = Service(
                id=10,
                name="Test Desktop",
                service_type="desktop",
                config={
                    "desktop_config": {
                        "display_num": 99,
                        "resolution": "1920x1080",
                        "color_depth": 24,
                        "vnc_port": 5999,
                    }
                },
                status="running",
                pid=1791,
            )
            session.add(desk_svc)
            session.commit()

        with patch.object(self.pm, "_watchdog", new_callable=AsyncMock), \
             patch.object(self.pm, "_ensure_desktop_vnc", new_callable=AsyncMock), \
             patch.object(self.pm, "_file_log_tailer", new_callable=AsyncMock):
            all_pids = self.pm.reattach_process(10, pid=1791)
            self.assertEqual(all_pids, [1791, 1798])
            self.assertEqual(self.pm.auxiliary_pids[10], [1798])

    @patch("psutil.process_iter")
    def test_cleanup_rogue_processes_preserves_desktop_and_vnc(self, mock_iter):
        proc_xvfb = MagicMock()
        proc_xvfb.info = {"pid": 1791, "name": "Xvfb"}
        proc_xvfb.environ.return_value = {"FFMPEG_GUI_PROCESS_ID": "10"}

        proc_vnc = MagicMock()
        proc_vnc.info = {"pid": 1798, "name": "x11vnc"}
        proc_vnc.environ.return_value = {"FFMPEG_GUI_PROCESS_ID": "10"}

        proc_stale = MagicMock()
        proc_stale.info = {"pid": 9999, "name": "x11vnc"}
        proc_stale.environ.return_value = {"FFMPEG_GUI_PROCESS_ID": "99"}

        mock_iter.return_value = [proc_xvfb, proc_vnc, proc_stale]

        # Active PIDs contains both Xvfb (1791) and x11vnc (1798)
        cleanup_rogue_processes(active_pids={1791, 1798})

        # Neither Xvfb nor x11vnc should be killed
        proc_xvfb.send_signal.assert_not_called()
        proc_vnc.send_signal.assert_not_called()

        # The stale one should be killed
        proc_stale.send_signal.assert_called_once_with(signal.SIGKILL)

    @patch("psutil.pid_exists")
    async def test_watchdog_respawns_dead_auxiliary_vnc(self, mock_pid_exists):
        with self.Session() as session:
            desk_svc = Service(
                id=20,
                name="Test Desktop Watchdog",
                service_type="desktop",
                config={
                    "desktop_config": {
                        "display_num": 99,
                        "resolution": "1920x1080",
                        "color_depth": 24,
                        "vnc_port": 5999,
                    }
                },
                status="running",
                pid=1791,
            )
            session.add(desk_svc)
            session.commit()

        self.pm.auxiliary_pids[20] = [1798]

        iteration = 0
        def side_effect(pid):
            nonlocal iteration
            if pid == 1791:
                iteration += 1
                return iteration <= 2
            if pid == 1798:
                return False
            return False

        mock_pid_exists.side_effect = side_effect

        with patch.object(self.pm, "_ensure_desktop_vnc", new_callable=AsyncMock) as mock_ensure:
            with patch("asyncio.sleep", new_callable=AsyncMock):
                await self.pm._watchdog(20, pid=1791)
                mock_ensure.assert_called_once_with(20)


if __name__ == "__main__":
    unittest.main()
