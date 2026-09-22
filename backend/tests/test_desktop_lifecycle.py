import os
import unittest
from unittest.mock import patch, MagicMock, AsyncMock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database.models import Base, Service
from core.process_manager import ProcessManager


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
        xvfb_cmd, xset_cmd, x11vnc_cmd, display_num, vnc_port = self.pm._build_desktop_cmds(svc)

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
        self.assertNotIn("-bg", x11vnc_cmd)  # Must NOT fork into background

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
        xvfb_cmd, xset_cmd, x11vnc_cmd, display_num, vnc_port = self.pm._build_desktop_cmds(svc)

        self.assertEqual(display_num, 105)
        self.assertEqual(vnc_port, 6005)
        self.assertIn(":105", xvfb_cmd)
        self.assertIn("1280x720x16", xvfb_cmd)
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

        mock_x11vnc = MagicMock()
        mock_x11vnc.pid = 22222
        mock_x11vnc.returncode = None
        mock_x11vnc.wait = AsyncMock(return_value=0)
        mock_x11vnc.terminate = MagicMock(side_effect=lambda: setattr(mock_x11vnc, "returncode", 0))
        mock_x11vnc.kill = MagicMock(side_effect=lambda: setattr(mock_x11vnc, "returncode", -9))
        mock_x11vnc.stdin = None

        mock_exec.side_effect = [mock_xvfb, mock_xset, mock_x11vnc]

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

            # Verify x11vnc was stored in auxiliary_processes
            self.assertIn(4, self.pm.auxiliary_processes)
            self.assertEqual(self.pm.auxiliary_processes[4], [mock_x11vnc])

            # Stop process
            await self.pm.stop_process(4, graceful=True)

            # Verify terminations
            mock_xvfb.terminate.assert_called()
            mock_x11vnc.terminate.assert_called()
            self.assertNotIn(4, self.pm.processes)
            self.assertNotIn(4, self.pm.auxiliary_processes)


if __name__ == "__main__":
    unittest.main()
