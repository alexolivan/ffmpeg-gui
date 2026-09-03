import unittest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database.models import Base, Service, ScheduledTask
from core.process_manager import ProcessManager
from core.task_manager import TaskManager


class TestSslCascadeReload(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()
        self.pm = ProcessManager(db_session_factory=self.Session)
        self.tm = TaskManager(db_session_factory=self.Session, process_manager=self.pm)

    def tearDown(self):
        self.db.close()

    async def test_reload_ssl_services_restarts_only_running_ssl_services(self):
        # 1. Running MediaMTX service with SSL enabled
        s_ssl_running = Service(
            name="MediaMTX TLS Hub",
            service_type="mediamtx_hub",
            status="running",
            config={"mediamtx_config": {"ssl_enabled": True}}
        )
        # 2. Stopped MediaMTX service with SSL enabled
        s_ssl_stopped = Service(
            name="MediaMTX Offline TLS",
            service_type="mediamtx_hub",
            status="stopped",
            config={"mediamtx_config": {"ssl_enabled": True}}
        )
        # 3. Running MediaMTX service without SSL (HTTP/WS only)
        s_plain_running = Service(
            name="MediaMTX Plain Hub",
            service_type="mediamtx_hub",
            status="running",
            config={"mediamtx_config": {"ssl_enabled": False}}
        )
        # 4. Running general service with top-level ssl_enabled: True
        s_general_ssl = Service(
            name="General SSL Daemon",
            service_type="custom",
            status="running",
            config={"ssl_enabled": True}
        )

        self.db.add_all([s_ssl_running, s_ssl_stopped, s_plain_running, s_general_ssl])
        self.db.commit()

        # Mock stop_process and start_process
        self.pm.stop_process = AsyncMock()
        self.pm.start_process = AsyncMock()

        log_messages = []
        reloaded = await self.pm.reload_ssl_services(db_session=self.db, log_fn=lambda m: log_messages.append(m))

        # Assert only s_ssl_running and s_general_ssl were restarted
        reloaded_ids = [item["id"] for item in reloaded]
        self.assertEqual(len(reloaded), 2)
        self.assertIn(s_ssl_running.id, reloaded_ids)
        self.assertIn(s_general_ssl.id, reloaded_ids)
        self.assertNotIn(s_ssl_stopped.id, reloaded_ids)
        self.assertNotIn(s_plain_running.id, reloaded_ids)

        # Verify stop and start were invoked for each reloaded service with is_restart=True
        self.assertEqual(self.pm.stop_process.await_count, 2)
        self.assertEqual(self.pm.start_process.await_count, 2)
        self.pm.stop_process.assert_any_await(s_ssl_running.id, is_restart=True)
        self.pm.stop_process.assert_any_await(s_general_ssl.id, is_restart=True)
        self.pm.start_process.assert_any_await(s_ssl_running.id, is_restart=True)
        self.pm.start_process.assert_any_await(s_general_ssl.id, is_restart=True)

        self.assertTrue(any("MediaMTX TLS Hub" in msg for msg in log_messages))

    async def test_task_manager_execute_ssl_renew_invokes_cascade_reload(self):
        s_ssl = Service(
            name="Active MediaMTX",
            service_type="mediamtx_hub",
            status="running",
            config={"mediamtx_config": {"ssl_enabled": True}}
        )
        self.db.add(s_ssl)
        self.db.commit()

        self.pm.stop_process = AsyncMock()
        self.pm.start_process = AsyncMock()

        mock_cert_mgr = MagicMock()
        mock_cert_mgr.get_cert_status.return_value = {
            "status": "valid",
            "days_remaining": 89,
            "domain": "stream.example.com"
        }
        mock_cert_mgr.renew_acme_certificate.return_value = (True, "Renewal OK")

        log_messages = []
        with patch("services.cert_manager.CertificateManager", return_value=mock_cert_mgr):
            await self.tm._execute_ssl_renew(
                log_info=lambda m: log_messages.append(m),
                log_error=lambda m: log_messages.append(m)
            )

        self.assertTrue(any("Cascade reloaded 1 active SSL-enabled service(s)" in msg for msg in log_messages))
        self.pm.stop_process.assert_awaited_once_with(s_ssl.id, is_restart=True)
        self.pm.start_process.assert_awaited_once_with(s_ssl.id, is_restart=True)


if __name__ == "__main__":
    unittest.main()
