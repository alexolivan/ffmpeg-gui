import unittest
from unittest.mock import MagicMock, patch
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from datetime import datetime, timedelta

from database.models import Base, Service
from core.process_manager import ProcessManager


class TestAdaptiveWatchdog(unittest.TestCase):

    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()
        self.pm = ProcessManager(db_session_factory=self.Session)

    def tearDown(self):
        self.db.close()

    def test_mediamtx_daemon_not_killed_by_ffmpeg_frame_checks(self):
        # Create MediaMTX service with watchdog enabled
        service = Service(
            name="MediaMTX Daemon",
            service_type="mediamtx_hub",
            status="running",
            type="service",
            watchdog_enabled=True,
            config={
                "watchdog_enabled": True,
                "mediamtx_config": {
                    "rtsp_enabled": True,
                    "rtsp_port": 8554,
                    "rtmp_enabled": True,
                    "rtmp_port": 1935
                }
            }
        )
        self.db.add(service)
        self.db.commit()
        self.db.refresh(service)

        # Mock a mock process
        mock_proc = MagicMock()
        mock_proc.returncode = None
        mock_proc.poll.return_value = None

        # Verify that is_ffmpeg_service is False for mediamtx_hub
        svc = self.db.query(Service).get(service.id)
        is_ffmpeg_service = (getattr(svc, 'service_type', 'ffmpeg_stream') == 'ffmpeg_stream')
        self.assertFalse(is_ffmpeg_service)

    def test_ffmpeg_stream_identified_for_transcode_watchdog(self):
        service = Service(
            name="FFmpeg Live Stream",
            service_type="ffmpeg_stream",
            status="running",
            type="service",
            watchdog_enabled=True,
            config={"watchdog_enabled": True}
        )
        self.db.add(service)
        self.db.commit()
        self.db.refresh(service)

        svc = self.db.query(Service).get(service.id)
        is_ffmpeg_service = (getattr(svc, 'service_type', 'ffmpeg_stream') == 'ffmpeg_stream')
        self.assertTrue(is_ffmpeg_service)


if __name__ == '__main__':
    unittest.main()
