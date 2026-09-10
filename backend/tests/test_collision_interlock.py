import unittest
import asyncio
from unittest.mock import MagicMock, patch
from core.resource_lock_manager import resource_lock_manager
from core.process_manager import ProcessManager
from database.models import Service


class TestCollisionInterlock(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        import tempfile
        resource_lock_manager.clear_all()
        self.test_logs_dir = tempfile.mkdtemp()
        self.db_factory = MagicMock()
        self.pm = ProcessManager(self.db_factory)

    def tearDown(self):
        import shutil
        resource_lock_manager.clear_all()
        shutil.rmtree(self.test_logs_dir, ignore_errors=True)

    async def test_service_collision_interlock(self):
        # Service 101 emitting to /live.mp3
        svc1 = Service(
            id=101,
            name="Radio Station Alpha",
            service_type="ffmpeg_stream",
            status="stopped",
            config={
                "output_config": {
                    "type": "icecast",
                    "provider_service_id": 1,
                    "icecast_mount": "/live.mp3"
                }
            }
        )

        # Service 102 also emitting to /live.mp3
        svc2 = Service(
            id=102,
            name="Radio Station Beta",
            service_type="ffmpeg_stream",
            status="stopped",
            config={
                "output_config": {
                    "type": "icecast",
                    "provider_service_id": 1,
                    "icecast_mount": "/live.mp3"
                }
            }
        )

        # Service 103 emitting to /rock.mp3 (different mount)
        svc3 = Service(
            id=103,
            name="Radio Station Gamma",
            service_type="ffmpeg_stream",
            status="stopped",
            config={
                "output_config": {
                    "type": "icecast",
                    "provider_service_id": 1,
                    "icecast_mount": "/rock.mp3"
                }
            }
        )

        db_records = {101: svc1, 102: svc2, 103: svc3}

        mock_session = MagicMock()
        mock_session.get.side_effect = lambda model, id: db_records.get(id)
        mock_session.query.return_value.get.side_effect = lambda id: db_records.get(id)
        mock_session.query.return_value.filter.return_value.all.return_value = []
        self.db_factory.return_value.__enter__.return_value = mock_session

        with patch.object(self.pm, "start_dependencies", return_value=None), \
             patch.object(self.pm, "stop_unused_dependencies", return_value=None), \
             patch.object(self.pm, "get_process_log_storage_path", return_value=self.test_logs_dir):
            with patch("asyncio.create_subprocess_exec") as mock_spawn:
                def make_mock_proc(pid):
                    p = MagicMock()
                    p.pid = pid
                    p.stdout.read = unittest.mock.AsyncMock(return_value=b"")
                    p.stderr.read = unittest.mock.AsyncMock(return_value=b"")
                    p.wait = unittest.mock.AsyncMock(return_value=0)
                    p.returncode = 0
                    return p

                mock_proc1 = make_mock_proc(8881)
                mock_spawn.return_value = mock_proc1

                # 1. Start Service 101 -> Should acquire lock and succeed
                await self.pm.start_process(101)
                self.assertEqual(len(resource_lock_manager.get_active_locks()), 1)
                self.assertEqual(svc1.status, "running")

                # 2. Start Service 102 (same mount /live.mp3) -> Should abort before spawn with collision error
                mock_spawn.reset_mock()
                await self.pm.start_process(102)
                mock_spawn.assert_not_called()
                self.assertEqual(svc2.status, "error")
                self.assertIn("ya está siendo emitido", svc2.error_message)
                self.assertIn("Radio Station Alpha", svc2.error_message)

                # 3. Start Service 103 (different mount /rock.mp3) -> Should succeed!
                mock_spawn.reset_mock()
                mock_proc3 = make_mock_proc(8883)
                mock_spawn.return_value = mock_proc3
                await self.pm.start_process(103)
                mock_spawn.assert_called_once()
                self.assertEqual(svc3.status, "running")
                self.assertEqual(len(resource_lock_manager.get_active_locks()), 2)

                # 4. Stop Service 101 -> Lock on /live.mp3 released
                await self.pm.stop_process(101)
                active_keys = [l["resource_path"] for l in resource_lock_manager.get_active_locks()]
                self.assertNotIn("/live.mp3", active_keys)
                self.assertIn("/rock.mp3", active_keys)

                # 5. Now Service 102 can start on /live.mp3
                mock_spawn.reset_mock()
                mock_proc2 = make_mock_proc(8882)
                mock_spawn.return_value = mock_proc2
                await self.pm.start_process(102)
                mock_spawn.assert_called_once()
                self.assertEqual(svc2.status, "running")


if __name__ == "__main__":
    unittest.main()
