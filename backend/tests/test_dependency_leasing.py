import unittest
from unittest.mock import AsyncMock, MagicMock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database.models import Base, Service, ServiceDependency, ScheduledTask
from core.dependency_manager import DependencyManager


class TestDependencyLeasing(unittest.IsolatedAsyncioTestCase):

    async def asyncSetUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

        self.mock_pm = MagicMock()
        
        async def mock_start(pid, is_restart=False, is_on_demand=False):
            with self.Session() as s:
                svc = s.get(Service, pid)
                if svc:
                    svc.status = 'running'
                    s.commit()
            return True

        async def mock_stop(pid):
            with self.Session() as s:
                svc = s.get(Service, pid)
                if svc:
                    svc.status = 'stopped'
                    s.commit()
            return True

        self.mock_pm.start_process = AsyncMock(side_effect=mock_start)
        self.mock_pm.stop_process = AsyncMock(side_effect=mock_stop)

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
            config={"mediamtx_config": {"rtmp_port": 1935, "rtsp_port": 8554}}
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

    async def asyncTearDown(self):
        self.db.close()

    async def test_auto_start_on_demand_when_allowed(self):
        # When consumer service starts and provider is stopped
        await self.dm.acquire_dependencies('service', self.consumer_svc.id, allow_auto_start=True)
        
        # Verify process_manager.start_process was called on provider with is_on_demand=True
        self.mock_pm.start_process.assert_called_with(self.provider.id, is_restart=False, is_on_demand=True)
        # Verify lease is recorded
        self.assertIn("service:2", self.dm.active_leases[self.provider.id])
        self.assertFalse(self.dm.is_pinned(self.provider.id))

    async def test_auto_start_blocked_when_permission_disabled(self):
        # When allow_auto_start=False and provider is stopped
        with self.assertRaises(RuntimeError):
            await self.dm.acquire_dependencies('service', self.consumer_svc.id, allow_auto_start=False)

    async def test_multi_consumer_protection_and_last_one_turns_off_lights(self):
        # Consumer 1 (Service) acquires lease
        await self.dm.acquire_dependencies('service', self.consumer_svc.id, allow_auto_start=True)
        # Consumer 2 (Task) acquires lease
        await self.dm.acquire_dependencies('task', self.consumer_task.id, allow_auto_start=True)

        self.assertEqual(len(self.dm.active_leases[self.provider.id]), 2)

        # Consumer 1 terminates and releases lease -> "No estás solo en el mundo"
        await self.dm.release_dependencies('service', self.consumer_svc.id, allow_auto_stop=True)
        self.assertEqual(len(self.dm.active_leases[self.provider.id]), 1)
        self.mock_pm.stop_process.assert_not_called()

        # Consumer 2 terminates and releases lease -> "El último que apague la luz"
        await self.dm.release_dependencies('task', self.consumer_task.id, allow_auto_stop=True)
        self.assertEqual(len(self.dm.active_leases[self.provider.id]), 0)
        self.mock_pm.stop_process.assert_called_with(self.provider.id)

    async def test_pinned_service_never_stopped_by_consumer_release(self):
        # User manually started provider (marked pinned)
        self.dm.mark_pinned(self.provider.id)
        self.assertTrue(self.dm.is_pinned(self.provider.id))

        # Consumer acquires and releases lease
        await self.dm.acquire_dependencies('service', self.consumer_svc.id, allow_auto_start=True)
        await self.dm.release_dependencies('service', self.consumer_svc.id, allow_auto_stop=True)

        # Provider should NOT be stopped because it is pinned
        self.mock_pm.stop_process.assert_not_called()

    def test_sync_auto_dependencies_detection(self):
        # Service 3 output explicitly links to provider
        svc3 = Service(
            name="New RTMP Producer",
            service_type="ffmpeg_stream",
            status="stopped",
            type="service",
            output_config={"type": "rtmp", "url": "rtmp://localhost:1935/live/test", "provider_service_id": self.provider.id}
        )
        self.db.add(svc3)
        self.db.commit()
        self.db.refresh(svc3)

        detected = self.dm.sync_auto_dependencies(
            'service', svc3.id, svc3.input_config, svc3.output_config, self.db
        )
        self.assertEqual(detected, [self.provider.id])

        # Verify dependency exists in DB
        dep = self.db.query(ServiceDependency).filter(
            ServiceDependency.consumer_type == 'service',
            ServiceDependency.consumer_id == svc3.id
        ).first()
        self.assertIsNotNone(dep)
        self.assertEqual(dep.provider_service_id, self.provider.id)

        # Service with standalone URL (no provider_service_id) produces NO dependency
        svc4 = Service(
            name="Standalone Producer",
            service_type="ffmpeg_stream",
            status="stopped",
            type="service",
            output_config={"type": "rtmp", "url": "rtmp://127.0.0.1:1935/live/external"}
        )
        self.db.add(svc4)
        self.db.commit()
        self.db.refresh(svc4)

        detected4 = self.dm.sync_auto_dependencies(
            'service', svc4.id, svc4.input_config, svc4.output_config, self.db
        )
        self.assertEqual(detected4, [])


if __name__ == '__main__':
    unittest.main()
