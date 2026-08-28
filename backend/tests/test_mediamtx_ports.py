import os
import unittest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi import HTTPException
from database.models import Base, Service
from utils.port_validator import validate_service_port_conflicts, get_next_available_mediamtx_ports

class TestMediaMtxPorts(unittest.TestCase):
    def setUp(self):
        os.environ["ACTIVE_PORT"] = "8011"
        self.engine = create_engine('sqlite:///:memory:')
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

    def tearDown(self):
        self.db.close()

    def test_single_mediamtx_standard_ports_pass(self):
        # MediaMTX 1 on standard ports
        validate_service_port_conflicts(
            db=self.db,
            service_id=None,
            service_name="MediaMTX 1",
            service_type="mediamtx_hub",
            config={
                "mediamtx_config": {
                    "rtmp_port": 1935,
                    "rtsp_port": 8554,
                    "rtp_port": 8000,
                    "rtcp_port": 8001,
                    "hls_port": 8888,
                    "webrtc_port": 8889,
                    "webrtc_udp_port": 8189,
                    "srt_port": 8890,
                    "api_port": 9997
                }
            },
            input_config={},
            output_config={}
        )

    def test_duplicate_port_detected_between_mediamtx_services(self):
        # Insert MediaMTX 1
        s1 = Service(
            name="MediaMTX 1",
            service_type="mediamtx_hub",
            status="stopped",
            type="service",
            config={
                "mediamtx_config": {
                    "rtmp_port": 1935,
                    "rtsp_port": 8554,
                    "rtp_port": 8000,
                    "rtcp_port": 8001,
                    "api_port": 9997
                }
            }
        )
        self.db.add(s1)
        self.db.commit()

        # Attempt to create MediaMTX 2 with same RTMP port 1935
        with self.assertRaises(HTTPException) as ctx:
            validate_service_port_conflicts(
                db=self.db,
                service_id=None,
                service_name="MediaMTX 2",
                service_type="mediamtx_hub",
                config={
                    "mediamtx_config": {
                        "rtmp_port": 1935, # Collision!
                        "rtsp_port": 8555,
                        "rtp_port": 8002,
                        "rtcp_port": 8003,
                        "api_port": 9998
                    }
                },
                input_config={},
                output_config={}
            )
        self.assertIn("Port collision", ctx.exception.detail)
        self.assertIn("1935", ctx.exception.detail)

    def test_duplicate_hidden_rtp_port_detected(self):
        # Insert MediaMTX 1 with default RTP port 8000
        s1 = Service(
            name="MediaMTX 1",
            service_type="mediamtx_hub",
            status="stopped",
            type="service",
            config={
                "mediamtx_config": {
                    "rtsp_enabled": True,
                    "rtsp_port": 8554,
                    "rtp_port": 8000
                }
            }
        )
        self.db.add(s1)
        self.db.commit()

        # MediaMTX 2 changed RTSP port to 8555 but left RTP on 8000
        with self.assertRaises(HTTPException) as ctx:
            validate_service_port_conflicts(
                db=self.db,
                service_id=None,
                service_name="MediaMTX 2",
                service_type="mediamtx_hub",
                config={
                    "mediamtx_config": {
                        "rtsp_enabled": True,
                        "rtsp_port": 8555,
                        "rtp_port": 8000 # Collision!
                    }
                },
                input_config={},
                output_config={}
            )
        self.assertIn("8000", ctx.exception.detail)

    def test_duplicate_webrtc_udp_port_detected(self):
        # Insert MediaMTX 1 with WebRTC enabled (default 8189 UDP)
        s1 = Service(
            name="MediaMTX 1",
            service_type="mediamtx_hub",
            status="stopped",
            type="service",
            config={
                "mediamtx_config": {
                    "rtsp_enabled": False,
                    "rtmp_enabled": False,
                    "hls_enabled": False,
                    "api_enabled": False,
                    "webrtc_enabled": True,
                    "webrtc_port": 8889,
                    "webrtc_udp_port": 8189
                }
            }
        )
        self.db.add(s1)
        self.db.commit()

        # MediaMTX 2 changed WebRTC HTTP port to 8890 but left UDP on 8189
        with self.assertRaises(HTTPException) as ctx:
            validate_service_port_conflicts(
                db=self.db,
                service_id=None,
                service_name="MediaMTX 2",
                service_type="mediamtx_hub",
                config={
                    "mediamtx_config": {
                        "rtsp_enabled": False,
                        "rtmp_enabled": False,
                        "hls_enabled": False,
                        "api_enabled": False,
                        "webrtc_enabled": True,
                        "webrtc_port": 8890,
                        "webrtc_udp_port": 8189 # Collision!
                    }
                },
                input_config={},
                output_config={}
            )
        self.assertIn("8189", ctx.exception.detail)

    def test_duplicate_rtmps_port_detected(self):
        # Insert MediaMTX 1 with RTMPS on 1936
        s1 = Service(
            name="MediaMTX 1",
            service_type="mediamtx_hub",
            status="stopped",
            type="service",
            config={
                "mediamtx_config": {
                    "rtsp_enabled": False,
                    "rtmp_enabled": False,
                    "hls_enabled": False,
                    "api_enabled": False,
                    "rtmps_enabled": True,
                    "rtmps_port": 1936
                }
            }
        )
        self.db.add(s1)
        self.db.commit()

        # MediaMTX 2 attempts to use same RTMPS port 1936
        with self.assertRaises(HTTPException) as ctx:
            validate_service_port_conflicts(
                db=self.db,
                service_id=None,
                service_name="MediaMTX 2",
                service_type="mediamtx_hub",
                config={
                    "mediamtx_config": {
                        "rtsp_enabled": False,
                        "rtmp_enabled": False,
                        "hls_enabled": False,
                        "api_enabled": False,
                        "rtmps_enabled": True,
                        "rtmps_port": 1936
                    }
                },
                input_config={},
                output_config={}
            )
        self.assertIn("Port collision", ctx.exception.detail)
        self.assertIn("1936", ctx.exception.detail)

    def test_duplicate_rtsps_port_detected(self):
        # Insert MediaMTX 1 with RTSPS on default 8322
        s1 = Service(
            name="MediaMTX 1",
            service_type="mediamtx_hub",
            status="stopped",
            type="service",
            config={
                "mediamtx_config": {
                    "rtsp_enabled": False,
                    "rtmp_enabled": False,
                    "hls_enabled": False,
                    "api_enabled": False,
                    "rtsps_enabled": True
                }
            }
        )
        self.db.add(s1)
        self.db.commit()

        # MediaMTX 2 attempts to use RTSPS on 8322
        with self.assertRaises(HTTPException) as ctx:
            validate_service_port_conflicts(
                db=self.db,
                service_id=None,
                service_name="MediaMTX 2",
                service_type="mediamtx_hub",
                config={
                    "mediamtx_config": {
                        "rtsp_enabled": False,
                        "rtmp_enabled": False,
                        "hls_enabled": False,
                        "api_enabled": False,
                        "rtsps_enabled": True,
                        "rtsps_port": 8322
                    }
                },
                input_config={},
                output_config={}
            )
        self.assertIn("Port collision", ctx.exception.detail)
        self.assertIn("8322", ctx.exception.detail)

    def test_get_next_available_mediamtx_ports(self):
        # Empty DB returns base ports (offset 0)
        base_ports = get_next_available_mediamtx_ports(self.db)
        self.assertEqual(base_ports["rtmp_port"], 1935)
        self.assertEqual(base_ports["rtmps_port"], 1936)
        self.assertEqual(base_ports["rtsp_port"], 8554)
        self.assertEqual(base_ports["rtsps_port"], 8322)
        self.assertEqual(base_ports["rtp_port"], 8000)
        self.assertEqual(base_ports["rtcp_port"], 8001)
        self.assertEqual(base_ports["hls_port"], 8888)
        self.assertEqual(base_ports["webrtc_port"], 8889)
        self.assertEqual(base_ports["webrtc_udp_port"], 8189)
        self.assertEqual(base_ports["srt_port"], 8890)
        self.assertEqual(base_ports["api_port"], 9997)

        # With MediaMTX 1 occupying base slots
        s1 = Service(
            name="MediaMTX 1",
            service_type="mediamtx_hub",
            status="stopped",
            type="service",
            config={
                "mediamtx_config": {
                    "rtmp_port": 1935,
                    "rtmps_port": 1936,
                    "rtsp_port": 8554,
                    "rtsps_port": 8322,
                    "rtp_port": 8000,
                    "rtcp_port": 8001,
                    "hls_port": 8888,
                    "webrtc_port": 8889,
                    "webrtc_udp_port": 8189,
                    "srt_port": 8890,
                    "api_port": 9997
                }
            }
        )
        self.db.add(s1)
        self.db.commit()

        next_ports = get_next_available_mediamtx_ports(self.db)
        self.assertEqual(next_ports["rtmp_port"], 1945)
        self.assertEqual(next_ports["rtmps_port"], 1946)
        self.assertEqual(next_ports["rtsp_port"], 8564)
        self.assertEqual(next_ports["rtsps_port"], 8332)
        self.assertEqual(next_ports["rtp_port"], 8002)
        self.assertEqual(next_ports["rtcp_port"], 8003)
        self.assertEqual(next_ports["hls_port"], 8898)
        self.assertEqual(next_ports["webrtc_port"], 8899)
        self.assertEqual(next_ports["webrtc_udp_port"], 8199)
        self.assertEqual(next_ports["srt_port"], 8900)
        self.assertEqual(next_ports["api_port"], 9998)

    def test_step_10_spacing_prevents_rtmp_rtmps_collision(self):
        # MediaMTX 1 occupies offset 0 (RTMP: 1935, RTMPS: 1936, RTSP: 8554, RTSPS: 8322)
        s1 = Service(
            name="MediaMTX 1",
            service_type="mediamtx_hub",
            status="stopped",
            type="service",
            config={
                "mediamtx_config": {
                    "rtmp_port": 1935,
                    "rtmps_port": 1936,
                    "rtsp_port": 8554,
                    "rtsps_port": 8322,
                    "rtp_port": 8000,
                    "rtcp_port": 8001,
                    "hls_port": 8888,
                    "webrtc_port": 8889,
                    "webrtc_udp_port": 8189,
                    "srt_port": 8890,
                    "api_port": 9997
                }
            }
        )
        self.db.add(s1)
        self.db.commit()

        # MediaMTX 2 gets offset 1 (RTMP: 1945, RTMPS: 1946, RTSP: 8564, RTSPS: 8332)
        next_ports = get_next_available_mediamtx_ports(self.db)
        
        # Verify no port collision when validating MediaMTX 2 with these allocated ports
        validate_service_port_conflicts(
            db=self.db,
            service_id=None,
            service_name="MediaMTX 2",
            service_type="mediamtx_hub",
            config={"mediamtx_config": next_ports},
            input_config={},
            output_config={}
        )

if __name__ == '__main__':
    unittest.main()

