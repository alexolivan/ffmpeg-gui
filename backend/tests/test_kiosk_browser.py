import os
import shutil
import unittest
from unittest.mock import patch, MagicMock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database.models import Base, Service, ServiceDependency, SoftwareBuild
from core.process_manager import ProcessManager
from core.dependency_manager import DependencyManager


class TestKioskBrowser(unittest.TestCase):

    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()
        self.pm = ProcessManager(self.Session)
        self.dm = DependencyManager()
        self.dm.db_session_factory = self.Session

        # Create a mock Virtual Desktop service
        self.desktop = Service(
            name="Virtual Desktop 1",
            type="service",
            service_type="desktop",
            status="running",
            config={
                "desktop_config": {
                    "display_num": 99,
                    "resolution": "1920x1080",
                    "vnc_port": 5999
                }
            }
        )
        self.db.add(self.desktop)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        # Clean up any test profile dirs
        for d in ("/tmp/kiosk_cr_2", "/tmp/kiosk_ff_3"):
            if os.path.exists(d):
                shutil.rmtree(d, ignore_errors=True)

    @patch("shutil.which")
    def test_chromium_launcher_strategy(self, mock_which):
        real_sh = shutil.which("sh") or "/bin/sh"
        mock_which.return_value = real_sh

        kiosk = Service(
            name="Kiosk Chrome",
            type="service",
            service_type="kiosk_browser",
            status="stopped",
            config={
                "kiosk_config": {
                    "engine_id": "chromium",
                    "desktop_service_id": self.desktop.id,
                    "target_source": "https://example.com/stream",
                    "hide_scrollbars": True,
                    "disk_cache_disabled": True,
                    "gpu_acceleration": "enabled",
                    "custom_flags": "--remote-debugging-port=9222"
                }
            }
        )
        self.db.add(kiosk)
        self.db.commit()

        cmd, display_num, profile_dir = self.pm._build_kiosk_cmds(kiosk, self.db)

        self.assertEqual(display_num, 99)
        self.assertEqual(cmd[0], real_sh)
        self.assertIn("--kiosk", cmd)
        self.assertIn("--start-fullscreen", cmd)
        self.assertIn(f"--user-data-dir=/tmp/kiosk_cr_{kiosk.id}", cmd)
        self.assertIn("--hide-scrollbars", cmd)
        self.assertIn("--disk-cache-dir=/dev/null", cmd)
        self.assertIn("--enable-gpu-rasterization", cmd)
        self.assertIn("--remote-debugging-port=9222", cmd)
        self.assertEqual(cmd[-1], "https://example.com/stream")
        self.assertEqual(profile_dir, f"/tmp/kiosk_cr_{kiosk.id}")

    @patch("shutil.which")
    def test_firefox_launcher_strategy(self, mock_which):
        real_sh = shutil.which("sh") or "/bin/sh"
        mock_which.return_value = real_sh

        kiosk = Service(
            name="Kiosk Firefox",
            type="service",
            service_type="kiosk_browser",
            status="stopped",
            config={
                "kiosk_config": {
                    "engine_id": "firefox",
                    "desktop_service_id": self.desktop.id,
                    "target_source": "https://example.com/dashboard",
                    "hide_scrollbars": True,
                    "disk_cache_disabled": True,
                    "gpu_acceleration": "enabled",
                    "custom_flags": "--devtools"
                }
            }
        )
        self.db.add(kiosk)
        self.db.commit()

        cmd, display_num, profile_dir = self.pm._build_kiosk_cmds(kiosk, self.db)

        self.assertEqual(display_num, 99)
        self.assertEqual(cmd[0], real_sh)
        self.assertIn("--kiosk", cmd)
        self.assertIn("-profile", cmd)
        self.assertIn(f"/tmp/kiosk_ff_{kiosk.id}", cmd)
        self.assertIn("--devtools", cmd)
        self.assertEqual(cmd[-1], "https://example.com/dashboard")

        # Verify generated user.js preferences
        user_js_path = os.path.join(profile_dir, "user.js")
        self.assertTrue(os.path.exists(user_js_path))
        with open(user_js_path, "r", encoding="utf-8") as f:
            content = f.read()
            self.assertIn('media.autoplay.default', content)
            self.assertIn('browser.cache.disk.enable", false', content)
            self.assertIn('layers.acceleration.force-enabled", true', content)

        # Verify userChrome.css scrollbar collapse
        css_path = os.path.join(profile_dir, "chrome", "userChrome.css")
        self.assertTrue(os.path.exists(css_path))
        with open(css_path, "r", encoding="utf-8") as f:
            self.assertIn('scrollbar-width: none', f.read())

    def test_missing_desktop_validation(self):
        kiosk = Service(
            name="Kiosk Broken",
            type="service",
            service_type="kiosk_browser",
            status="stopped",
            config={
                "kiosk_config": {
                    "engine_id": "chromium",
                    "desktop_service_id": 99999,  # Non-existent
                    "target_source": "https://example.com"
                }
            }
        )
        self.db.add(kiosk)
        self.db.commit()

        with self.assertRaises(ValueError):
            self.pm._build_kiosk_cmds(kiosk, self.db)

    def test_dependency_manager_auto_links_desktop(self):
        kiosk = Service(
            name="Kiosk Consumer",
            type="service",
            service_type="kiosk_browser",
            status="stopped",
            config={
                "kiosk_config": {
                    "engine_id": "chromium",
                    "desktop_service_id": self.desktop.id,
                    "target_source": "https://example.com"
                }
            }
        )
        self.db.add(kiosk)
        self.db.commit()

        providers = self.dm.sync_auto_dependencies("service", kiosk.id, None, None, self.db)
        self.assertIn(self.desktop.id, providers)

        dep = self.db.query(ServiceDependency).filter(
            ServiceDependency.consumer_type == "service",
            ServiceDependency.consumer_id == kiosk.id,
            ServiceDependency.provider_service_id == self.desktop.id
        ).first()
        self.assertIsNotNone(dep)
        self.assertTrue(dep.is_auto_managed)


if __name__ == "__main__":
    unittest.main()
