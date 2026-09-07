import unittest
from backend.core.circuit_breaker import analyze_fatal_error

class TestCircuitBreaker(unittest.TestCase):
    def test_protocol_not_found(self):
        logs = [
            "[info] ffmpeg version 7.1.3 Copyright (c) 2000-2024",
            "[URL @ 0x55d14e0] Protocol 'whip' not found",
            "http://127.0.0.1:8889/live/whip: Protocol not found"
        ]
        is_fatal, reason = analyze_fatal_error(logs, execution_duration=0.5)
        self.assertTrue(is_fatal)
        self.assertIn("Protocol not supported", reason)
        self.assertIn("whip", reason)

    def test_unknown_format(self):
        logs = [
            "Unknown output format: 'whip'"
        ]
        is_fatal, reason = analyze_fatal_error(logs, execution_duration=0.2)
        self.assertTrue(is_fatal)
        self.assertIn("Format not supported", reason)

    def test_unknown_encoder(self):
        logs = [
            "[vost#0:0/libx265 @ 0x55d14e0] Unknown encoder 'libx265'"
        ]
        is_fatal, reason = analyze_fatal_error(logs, execution_duration=1.0)
        self.assertTrue(is_fatal)
        self.assertIn("Encoder not supported", reason)
        self.assertIn("libx265", reason)

    def test_unrecognized_option(self):
        logs = [
            "Unrecognized option 'bad_flag'."
        ]
        is_fatal, reason = analyze_fatal_error(logs, execution_duration=0.1)
        self.assertTrue(is_fatal)
        self.assertIn("Unrecognized CLI option", reason)

    def test_transient_network_error_not_fatal(self):
        logs = [
            "[tcp @ 0x55d14e0] Connection to tcp://192.168.1.50:9000 failed: Connection refused",
            "srt://192.168.1.50:9000: Connection refused"
        ]
        is_fatal, reason = analyze_fatal_error(logs, execution_duration=1.2)
        self.assertFalse(is_fatal)
        self.assertIsNone(reason)

    def test_long_running_crash_not_tripped_by_circuit_breaker(self):
        logs = [
            "Protocol 'whip' not found"
        ]
        # Ran for 15 seconds before crashing -> not an immediate startup syntax/binary failure
        is_fatal, reason = analyze_fatal_error(logs, execution_duration=15.0)
        self.assertFalse(is_fatal)
        self.assertIsNone(reason)

    def test_empty_logs(self):
        is_fatal, reason = analyze_fatal_error([], execution_duration=0.5)
        self.assertFalse(is_fatal)
        self.assertIsNone(reason)


class TestProcessManagerCircuitBreaker(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from database.models import Base
        from core.process_manager import ProcessManager

        self.engine = create_engine('sqlite:///:memory:')
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()
        self.manager = ProcessManager(db_session_factory=self.Session)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    async def test_circuit_breaker_trips_and_aborts_watchdog(self):
        from database.models import Service, ServiceLog
        from unittest.mock import patch, MagicMock
        import asyncio

        svc = Service(
            name="Fatal WHIP Service",
            type="service",
            service_type="ffmpeg_stream",
            input_config={"type": "lavfi", "path": "testsrc"},
            output_config={"type": "whip", "path": "http://127.0.0.1:8889/live/whip"},
            status="running",
            watchdog_enabled=True,
            watchdog_retries=-1,  # Infinite retries!
            watchdog_circuit_breaker=True
        )
        self.db.add(svc)
        self.db.commit()
        self.db.refresh(svc)

        # Inject fatal log into manager log buffer
        import collections
        self.manager.log_buffers[svc.id] = collections.deque([
            {"timestamp": "2026-09-07T12:00:00Z", "level": "ERROR", "message": "Protocol 'whip' not found"}
        ], maxlen=100)

        # Register mock process
        mock_proc = MagicMock()
        mock_proc.pid = 99999
        mock_proc.returncode = 1
        mock_proc.wait = unittest.mock.AsyncMock(return_value=1)
        self.manager.processes[svc.id] = mock_proc

        # Run _watchdog
        await self.manager._watchdog(svc.id, proc=mock_proc, pid=99999)

        # Service should be in error state, NO restart scheduled in pending_restarts
        self.db.refresh(svc)
        self.assertEqual(svc.status, "error")
        self.assertEqual(svc.restart_count, 0)
        self.assertNotIn(svc.id, self.manager.pending_restarts)

        # Check that circuit breaker log was written
        cb_log = self.db.query(ServiceLog).filter(
            ServiceLog.service_id == svc.id,
            ServiceLog.message.like("%Circuit Breaker tripped%")
        ).first()
        self.assertIsNotNone(cb_log)
        self.assertIn("Protocol not supported", cb_log.message)

    async def test_circuit_breaker_disabled_keeps_retrying(self):
        from database.models import Service
        from unittest.mock import MagicMock
        import collections

        svc = Service(
            name="Fatal Service But CB Disabled",
            type="service",
            service_type="ffmpeg_stream",
            input_config={"type": "lavfi", "path": "testsrc"},
            output_config={"type": "whip", "path": "http://127.0.0.1:8889/live/whip"},
            status="running",
            watchdog_enabled=True,
            watchdog_retries=5,
            watchdog_circuit_breaker=False  # Disabled!
        )
        self.db.add(svc)
        self.db.commit()
        self.db.refresh(svc)

        self.manager.log_buffers[svc.id] = collections.deque([
            {"timestamp": "2026-09-07T12:00:00Z", "level": "ERROR", "message": "Protocol 'whip' not found"}
        ], maxlen=100)

        mock_proc = MagicMock()
        mock_proc.pid = 99998
        mock_proc.returncode = 1
        mock_proc.wait = unittest.mock.AsyncMock(return_value=1)
        self.manager.processes[svc.id] = mock_proc

        await self.manager._watchdog(svc.id, proc=mock_proc, pid=99998)

        # Circuit breaker is disabled: restart SHOULD be scheduled
        self.assertIn(svc.id, self.manager.pending_restarts)
        pending_task = self.manager.pending_restarts.pop(svc.id, None)
        if pending_task:
            pending_task.cancel()


if __name__ == '__main__':
    unittest.main()

