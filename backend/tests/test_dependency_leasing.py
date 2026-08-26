import unittest
from unittest.mock import MagicMock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database.models import Base, Service, ServiceDependency, ScheduledTask
from core.dependency_manager import DependencyManager


class TestDependencyLeasing(unittest.TestCase):

    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

        self.mock_pm = MagicMock()
        # Fresh singleton instance
        self.dm = DependencyManager(
            db_session_factory=self.Session,
            process_manager=self.mock_pm
        )
        self.dm.active_leases.clear()
        self.dm.pinned_services.clear()

        # Create MediaMTX Provider Hub (ID 1)
        self.provider = Service(
            name="MediaMTX Provider Hub",
            service_type="mediamtx_hub",
            status="stopped",
            type="service",
            config={"mediamtx_config": {}}
        )
        self.db.add(self.provider)
        self.db.commit()
        self.db.refresh(self.provider)

        # Create Consumer Service (ID 2)
        self.consumer_svc = Service(
            name="FFmpeg Stream Consumer",
            service_type="ffmpeg_stream",
            status="stopped",
            type="service",
            config={
                "allow_auto_start_deps": True,
                "allow_auto_stop_deps": True
            }
        )
        self.db.add(self.consumer_svc)

        # Create Consumer Task (ID 1)
        self.consumer_task = ScheduledTask(
            name="Transcode Task Consumer",
            schedule_type="manual",
            input_config={},
            output_config={},
            codec_config={},
            allow_auto_start_deps=True,
            allow_auto_stop_deps=True
        )
        self.db.add(self.consumer_task)
        self.db.commit()
        self.db.refresh(self.consumer_svc)
        self.db.refresh(self.consumer_task)

        # Link Service -> Provider
        dep1 = ServiceDependency(
            consumer_type='service',
            consumer_id=self.consumer_svc.id,
            provider_service_id=self.provider.id,
            is_auto_managed=True
        )
        # Link Task -> Provider
        dep2 = ServiceDependency(
            consumer_type='task',
            consumer_id=self.consumer_task.id,
            provider_service_id=self.provider.id,
            is_auto_managed=True
        )
        self.db.add_all([dep1, dep2])
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_auto_start_on_demand_when_allowed(self):
        # When consumer service starts and provider is stopped
        self.dm.acquire_dependencies('service', self.consumer_svc.id, allow_auto_start=True)
        
        # Verify process_manager.start_process was called on provider
        self.mock_pm.start_process.assert_called_with(self.provider.id)
        # Verify lease is recorded
        self.assertIn("service:2", self.dm.active_leases[self.provider.id])
        self.assertFalse(self.dm.is_pinned(self.provider.id))

    def test_auto_start_blocked_when_permission_disabled(self):
        # When allow_auto_start=False and provider is stopped
        with self.assertRaises(RuntimeError):
            self.dm.acquire_dependencies('service', self.consumer_svc.id, allow_auto_start=False)

    def test_multi_consumer_protection_and_last_one_turns_off_lights(self):
        # Consumer 1 (Service) acquires lease
        self.dm.acquire_dependencies('service', self.consumer_svc.id, allow_auto_start=True)
        # Consumer 2 (Task) acquires lease
        self.dm.acquire_dependencies('task', self.consumer_task.id, allow_auto_start=True)

        self.assertEqual(len(self.dm.active_leases[self.provider.id]), 2)

        # Consumer 1 terminates and releases lease -> "No estás solo en el mundo"
        self.dm.release_dependencies('service', self.consumer_svc.id, allow_auto_stop=True)
        self.assertEqual(len(self.dm.active_leases[self.provider.id]), 1)
        self.mock_pm.stop_process.assert_not_called()

        # Consumer 2 terminates and releases lease -> "El último que apague la luz"
        self.dm.release_dependencies('task', self.consumer_task.id, allow_auto_stop=True)
        self.assertEqual(len(self.dm.active_leases[self.provider.id]), 0)
        self.mock_pm.stop_process.assert_called_with(self.provider.id)

    def test_pinned_service_never_stopped_by_consumer_release(self):
        # User manually started provider (marked pinned)
        self.dm.mark_pinned(self.provider.id)
        self.assertTrue(self.dm.is_pinned(self.provider.id))

        # Consumer acquires and releases lease
        self.dm.acquire_dependencies('service', self.consumer_svc.id, allow_auto_start=True)
        self.dm.release_dependencies('service', self.consumer_svc.id, allow_auto_stop=True)

        # Provider should NOT be stopped because it is pinned
        self.mock_pm.stop_process.assert_not_called()


if __name__ == '__main__':
    unittest.main()
