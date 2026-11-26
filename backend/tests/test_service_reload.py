import asyncio
import copy
import os
import signal
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import yaml
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.process_manager import ProcessManager
from core.authz import AuthzContext, authorize_http_request
from database.models import Base, Service


class TestServiceHotReload(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp(prefix="ffmpeg_gui_reload_test_")
        self.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)
        self.pm = ProcessManager(self.SessionLocal)

    def tearDown(self):
        self.engine.dispose()
        for root, dirs, files in os.walk(self.test_dir, topdown=False):
            for name in files:
                try:
                    os.remove(os.path.join(root, name))
                except Exception:
                    pass
            for name in dirs:
                try:
                    os.rmdir(os.path.join(root, name))
                except Exception:
                    pass
        try:
            os.rmdir(self.test_dir)
        except Exception:
            pass

    def test_pending_change_mode_distinguishes_reload_vs_restart(self):
        mtx = Service(
            id=10,
            name="MediaMTX Hub",
            service_type="mediamtx_hub",
            status="running",
            config={"mediamtx_config": {"rtsp_port": 8554, "paths": {"live": {"mode": "open"}}}},
            last_started_config={"config": {"mediamtx_config": {"rtsp_port": 8554, "paths": {"live": {"mode": "open"}}}}},
        )
        self.assertFalse(mtx.pending_changes)
        self.assertEqual(mtx.pending_change_mode, "none")

        # Adding a path -> reloadable without restart
        mtx.config = {"mediamtx_config": {"rtsp_port": 8554, "paths": {"live": {"mode": "open"}, "radio": {"mode": "open"}}}}
        self.assertTrue(mtx.pending_changes)
        self.assertEqual(mtx.pending_change_mode, "reload")

        # Changing listener port -> requires restart
        mtx.config = {"mediamtx_config": {"rtsp_port": 8555, "paths": {"live": {"mode": "open"}}}}
        self.assertEqual(mtx.pending_change_mode, "restart")

        ice = Service(
            id=11,
            name="Icecast Hub",
            service_type="icecast_server",
            status="running",
            config={"icecast_config": {"port": 7000, "mounts": [{"mount_name": "/a.mp3"}]}},
            last_started_config={"config": {"icecast_config": {"port": 7000, "mounts": [{"mount_name": "/a.mp3"}]}}},
        )
        # Volatile has_status_json should not trigger false pending changes
        ice.config = {"icecast_config": {"port": 7000, "has_status_json": True, "mounts": [{"mount_name": "/a.mp3"}]}}
        self.assertEqual(ice.pending_change_mode, "none")

        # Adding a standard mount -> reloadable via SIGHUP
        ice.config = {"icecast_config": {"port": 7000, "mounts": [{"mount_name": "/a.mp3"}, {"mount_name": "/b.mp3"}]}}
        self.assertEqual(ice.pending_change_mode, "reload")

        # Enabling a remote relay -> requires restart for Icecast
        ice.config = {
            "icecast_config": {
                "port": 7000,
                "mounts": [
                    {"mount_name": "/a.mp3", "relay_enabled": True, "relay_url": "http://remote:8000/src.mp3"},
                ],
            }
        }
        self.assertEqual(ice.pending_change_mode, "restart")

        # Changing relay credentials on a relay mount -> also requires restart
        ice.last_started_config = {
            "config": {
                "icecast_config": {
                    "port": 7000,
                    "mounts": [
                        {
                            "mount_name": "/a.mp3",
                            "relay_enabled": True,
                            "relay_url": "http://remote:8000/src.mp3",
                            "relay_password": "old",
                        },
                    ],
                }
            }
        }
        ice.config = {
            "icecast_config": {
                "port": 7000,
                "mounts": [
                    {
                        "mount_name": "/a.mp3",
                        "relay_enabled": True,
                        "relay_url": "http://remote:8000/src.mp3",
                        "relay_password": "new",
                    },
                ],
            }
        }
        self.assertEqual(ice.pending_change_mode, "restart")

    def test_mediamtx_atomic_reload_in_place_updates_yaml_and_clears_pending(self):
        yaml_path = os.path.join(self.test_dir, "mediamtx.yml")
        with self.SessionLocal() as db:
            svc = Service(
                id=20,
                name="MediaMTX Live",
                service_type="mediamtx_hub",
                status="running",
                config={"mediamtx_config": {"rtsp_port": 8554, "paths": {"cam1": {"mode": "open"}}}},
                last_started_config={"config": {"mediamtx_config": {"rtsp_port": 8554, "paths": {"cam1": {"mode": "open"}}}}},
            )
            db.add(svc)
            db.commit()
            db.refresh(svc)

            self.pm._build_mediamtx_config_and_cmd(svc, "mediamtx", db, target_path=yaml_path)
            self.pm.ephemeral_configs[20] = yaml_path
            self.pm.processes[20] = SimpleNamespace(pid=424242, returncode=None)

            # Mutate paths in DB
            svc.config = {"mediamtx_config": {"rtsp_port": 8554, "paths": {"cam1": {"mode": "open"}, "cam2": {"mode": "open"}}}}
            db.commit()

        res = asyncio.run(self.pm.reload_process(20))
        self.assertEqual(res["status"], "reloaded")

        with open(yaml_path, "r", encoding="utf-8") as f:
            loaded = yaml.safe_load(f.read())
        self.assertIn("cam2", loaded["paths"])

        with self.SessionLocal() as db:
            refreshed = db.query(Service).get(20)
            self.assertFalse(refreshed.pending_changes)
            self.assertEqual(refreshed.pending_change_mode, "none")

    def test_icecast_reload_writes_xml_atomically_and_sends_sighup(self):
        xml_path = os.path.join(self.test_dir, "icecast.xml")
        with self.SessionLocal() as db:
            svc = Service(
                id=30,
                name="Icecast Live",
                service_type="icecast_server",
                status="running",
                config={"icecast_config": {"port": 7000, "mounts": [{"mount_name": "/main.mp3"}]}},
                last_started_config={"config": {"icecast_config": {"port": 7000, "mounts": [{"mount_name": "/main.mp3"}]}}},
            )
            db.add(svc)
            db.commit()
            db.refresh(svc)

            self.pm._build_icecast_config_and_cmd(svc, "icecast2", db, log_storage_path=self.test_dir, target_path=xml_path)
            self.pm.ephemeral_configs[30] = xml_path
            self.pm.processes[30] = SimpleNamespace(pid=515151, returncode=None)

            svc.config = {
                "icecast_config": {
                    "port": 7000,
                    "mounts": [{"mount_name": "/main.mp3"}, {"mount_name": "/studio2.mp3", "max_listeners": 50}],
                }
            }
            db.commit()

        with patch("core.process_manager.os.kill") as mock_kill:
            res = asyncio.run(self.pm.reload_process(30))
        mock_kill.assert_called_once_with(515151, signal.SIGHUP)
        self.assertEqual(res["status"], "reloaded")

        with open(xml_path, "r", encoding="utf-8") as f:
            xml_text = f.read()
        self.assertIn("/studio2.mp3", xml_text)

        with self.SessionLocal() as db:
            refreshed = db.query(Service).get(30)
            self.assertFalse(refreshed.pending_changes)

    def test_reload_rejects_unsupported_service_type(self):
        with self.SessionLocal() as db:
            svc = Service(id=40, name="PipeWire", service_type="pipewire_hub", status="running", config={})
            db.add(svc)
            db.commit()
            self.pm.processes[40] = SimpleNamespace(pid=616161, returncode=None)

        with self.assertRaises(ValueError):
            asyncio.run(self.pm.reload_process(40))

    def test_rbac_reload_requires_operate_permission(self):
        with self.SessionLocal() as db:
            svc = Service(id=50, name="Icecast Guarded", service_type="icecast_server", status="running", config={})
            db.add(svc)
            db.commit()

            op_ctx = AuthzContext(
                is_owner=False,
                scopes={"processes": {"default": "none", "services": {"50": "operate"}}},
            )
            mon_ctx = AuthzContext(
                is_owner=False,
                scopes={"processes": {"default": "none", "services": {"50": "monitor"}}},
            )
            req = SimpleNamespace(url=SimpleNamespace(path="/processes/50/reload"), method="POST")
            self.assertIsNone(authorize_http_request(req, op_ctx, db))
            self.assertIsNotNone(authorize_http_request(req, mon_ctx, db))


if __name__ == "__main__":
    unittest.main()
