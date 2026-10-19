import os
import unittest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi import HTTPException

from database.models import Base, Service, ScheduledTask
from utils.port_validator import (
    extract_ports_from_service,
    validate_service_port_conflicts,
    get_next_available_mediamtx_ports,
)


class TestPipeWirePorts(unittest.TestCase):
    def setUp(self):
        os.environ["ACTIVE_PORT"] = "8000"
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

    def tearDown(self):
        self.db.close()

    def test_extract_ports_from_pipewire_hub(self):
        cfg = {
            "pipewire_config": {
                "aes67_network": {"enabled": True, "interface": "eth0", "ip": "192.168.1.100"},
                "virtual_sinks": [
                    {"id": "mix_bus", "name": "Master Bus", "aes67_enabled": True, "rtp_port": 5004, "multicast_ip": "239.69.1.1"},
                    {"id": "local_bus", "name": "Local Bus", "aes67_enabled": False}  # Local RAM only
                ],
                "remote_sinks": [
                    {"id": "sat_rx", "name": "Satellite Rx", "rtp_port": 5006, "multicast_ip": "239.69.1.50"}
                ]
            }
        }
        ports = extract_ports_from_service(10, "PipeWire Studio Hub", "pipewire_hub", cfg, None, None)
        port_numbers = [p[0] for p in ports]
        protocols = [p[4] for p in ports]

        self.assertIn(5004, port_numbers)
        self.assertIn(5006, port_numbers)
        self.assertIn(9875, port_numbers)  # SAP Discovery
        self.assertTrue(all(proto == "udp" for proto in protocols))

    def test_pipewire_internal_multicast_stream_collision(self):
        # Two sinks attempting to use the EXACT same multicast IP and port
        cfg = {
            "pipewire_config": {
                "aes67_network": {"enabled": True},
                "virtual_sinks": [
                    {"id": "sink1", "name": "Sink 1", "aes67_enabled": True, "rtp_port": 5004, "multicast_ip": "239.69.1.10"},
                    {"id": "sink2", "name": "Sink 2", "aes67_enabled": True, "rtp_port": 5004, "multicast_ip": "239.69.1.10"}
                ]
            }
        }
        with self.assertRaises(HTTPException) as ctx:
            validate_service_port_conflicts(
                db=self.db,
                service_id=1,
                service_name="PW Hub",
                service_type="pipewire_hub",
                config=cfg,
                input_config=None,
                output_config=None
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Internal port/IP collision", ctx.exception.detail)

    def test_pipewire_allows_same_port_with_different_multicast_ips(self):
        # In AES67, different multicast IPs can share standard port 5004
        cfg = {
            "pipewire_config": {
                "aes67_network": {"enabled": True},
                "virtual_sinks": [
                    {"id": "sink1", "name": "Sink 1", "aes67_enabled": True, "rtp_port": 5004, "multicast_ip": "239.69.1.10"},
                    {"id": "sink2", "name": "Sink 2", "aes67_enabled": True, "rtp_port": 5004, "multicast_ip": "239.69.1.11"}
                ]
            }
        }
        # Should NOT raise HTTPException
        validate_service_port_conflicts(
            db=self.db,
            service_id=1,
            service_name="PW Hub",
            service_type="pipewire_hub",
            config=cfg,
            input_config=None,
            output_config=None
        )

    def test_pipewire_collision_with_other_pipewire_hub_same_stream(self):
        hub1 = Service(
            name="Hub Primary",
            service_type="pipewire_hub",
            status="running",
            type="service",
            config={
                "pipewire_config": {
                    "aes67_network": {"enabled": True},
                    "virtual_sinks": [
                        {"id": "mix", "name": "Main Mix", "aes67_enabled": True, "rtp_port": 5004, "multicast_ip": "239.69.1.10"}
                    ]
                }
            }
        )
        self.db.add(hub1)
        self.db.commit()

        # Hub 2 uses same multicast IP and port
        hub2_cfg = {
            "pipewire_config": {
                "aes67_network": {"enabled": True},
                "virtual_sinks": [
                    {"id": "pgm", "name": "Program", "aes67_enabled": True, "rtp_port": 5004, "multicast_ip": "239.69.1.10"}
                ]
            }
        }
        with self.assertRaises(HTTPException) as ctx:
            validate_service_port_conflicts(
                db=self.db,
                service_id=2,
                service_name="Hub Secondary",
                service_type="pipewire_hub",
                config=hub2_cfg,
                input_config=None,
                output_config=None
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Multicast stream 239.69.1.10:5004 is already in use by PipeWire Hub 'Hub Primary'", ctx.exception.detail)

    def test_pipewire_shared_sap_port_between_two_hubs_is_allowed(self):
        hub1 = Service(
            name="Hub 1",
            service_type="pipewire_hub",
            status="running",
            type="service",
            config={"pipewire_config": {"aes67_network": {"enabled": True}}}
        )
        self.db.add(hub1)
        self.db.commit()

        # Hub 2 also has AES67 network enabled (shares SAP 9875 multicast discovery)
        hub2_cfg = {"pipewire_config": {"aes67_network": {"enabled": True}}}
        # Should NOT raise HTTPException
        validate_service_port_conflicts(
            db=self.db,
            service_id=2,
            service_name="Hub 2",
            service_type="pipewire_hub",
            config=hub2_cfg,
            input_config=None,
            output_config=None
        )

    def test_pipewire_collision_with_ffmpeg_unicast_stream(self):
        pw_hub = Service(
            name="PipeWire Studio",
            service_type="pipewire_hub",
            status="running",
            type="service",
            config={
                "pipewire_config": {
                    "remote_sinks": [
                        {"id": "net_in", "name": "Network In", "rtp_port": 5004, "multicast_ip": "239.69.1.20"}
                    ]
                }
            }
        )
        self.db.add(pw_hub)
        self.db.commit()

        # FFmpeg stream attempting to bind UDP port 5004
        with self.assertRaises(HTTPException) as ctx:
            validate_service_port_conflicts(
                db=self.db,
                service_id=None,
                service_name="FFmpeg UDP Ingest",
                service_type="ffmpeg_stream",
                config={},
                input_config={"input1": {"type": "udp", "port": 5004}},
                output_config=[]
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Port 5004/UDP", ctx.exception.detail)
        self.assertIn("PipeWire Studio", ctx.exception.detail)

    def test_pipewire_collision_with_active_scheduled_task(self):
        task = ScheduledTask(
            name="Nightly SRT Ingest Task",
            schedule_type="recurring",
            schedule_cron="0 0 * * *",
            is_active=True,
            input_config={"input1": {"type": "srt", "mode": "listener", "port": 7500}},
            output_config=[],
            codec_config={}
        )
        self.db.add(task)
        self.db.commit()

        # PipeWire Hub attempting to use port 7500 for a remote sink
        pw_cfg = {
            "pipewire_config": {
                "remote_sinks": [
                    {"id": "rx1", "name": "Remote Rx", "rtp_port": 7500, "multicast_ip": "239.69.1.30"}
                ]
            }
        }
        with self.assertRaises(HTTPException) as ctx:
            validate_service_port_conflicts(
                db=self.db,
                service_id=None,
                service_name="PW Studio",
                service_type="pipewire_hub",
                config=pw_cfg,
                input_config=None,
                output_config=None
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Nightly SRT Ingest Task", ctx.exception.detail)

    def test_mediamtx_auto_allocator_respects_pipewire_ports(self):
        # Hub uses port 8890 (base SRT port)
        pw_hub = Service(
            name="PipeWire Studio",
            service_type="pipewire_hub",
            status="running",
            type="service",
            config={
                "pipewire_config": {
                    "remote_sinks": [
                        {"id": "srt_pipe", "name": "AoIP Rx", "rtp_port": 8890, "multicast_ip": "239.69.1.40"}
                    ]
                }
            }
        )
        self.db.add(pw_hub)
        self.db.commit()

        # MediaMTX auto-allocator should skip base 8890 and pick a non-conflicting port
        mtx_ports = get_next_available_mediamtx_ports(self.db)
        self.assertNotEqual(mtx_ports["srt_port"], 8890)


if __name__ == "__main__":
    unittest.main()
