import socket
import struct
import unittest
from unittest.mock import MagicMock, patch

from core.aoip_discovery_supervisor import AoIpDiscoverySupervisor, parse_sap_packet


def build_raw_sap_packet(
    sdp_text: str,
    origin_ip: str = "192.168.99.11",
    is_deletion: bool = False,
    include_mime: bool = True
) -> bytes:
    """Helper to construct raw SAP packet conforming to RFC 2974."""
    # Byte 0: v=1 (0x20), msg_type=deletion (0x04) if is_deletion else 0x00
    byte0 = 0x20
    if is_deletion:
        byte0 |= 0x04

    auth_len = 0
    msg_id_hash = 0x1234
    ip_bytes = socket.inet_aton(origin_ip)

    header = struct.pack("!BBH4s", byte0, auth_len, msg_id_hash, ip_bytes)
    payload = b""
    if include_mime:
        payload += b"application/sdp\x00"
    payload += sdp_text.encode("utf-8")
    return header + payload


class TestAoIpDiscoverySupervisor(unittest.IsolatedAsyncioTestCase):
    def test_sap_multicast_groups_include_aes67_org_local(self):
        from core.aoip_discovery_supervisor import SAP_MULTICAST_GROUPS
        self.assertIn("239.255.255.255", SAP_MULTICAST_GROUPS)
        self.assertIn("239.192.255.255", SAP_MULTICAST_GROUPS)
        self.assertIn("224.0.0.56", SAP_MULTICAST_GROUPS)
        self.assertIn("224.2.127.254", SAP_MULTICAST_GROUPS)

    def test_new_or_deleted_sap_stream_invalidates_ws_pipewire_graph(self):
        mock_pm = MagicMock()
        mock_pm.db_session_factory = MagicMock()

        supervisor = AoIpDiscoverySupervisor(14, mock_pm)
        supervisor.interface = "enp9s0"
        supervisor.nic_ip = "192.168.99.11"

        with patch("core.websocket_subscription_hub.subscription_hub.invalidate_pipewire_graph") as mock_inval:
            sdp = (
                "v=0\r\n"
                "s=Test AES Stream\r\n"
                "c=IN IP4 239.192.1.1\r\n"
                "m=audio 5004 RTP/AVP 96\r\n"
            )
            raw = build_raw_sap_packet(sdp, origin_ip="192.168.99.100")
            supervisor.handle_sap_packet(raw, ("192.168.99.100", 9875))
            mock_inval.assert_called_with(14)
            mock_inval.reset_mock()

            # Repeat packet shouldn't invalidate if not new and not deleted
            supervisor.handle_sap_packet(raw, ("192.168.99.100", 9875))
            mock_inval.assert_not_called()

            # Deletion packet should invalidate
            raw_del = build_raw_sap_packet(sdp, origin_ip="192.168.99.100", is_deletion=True)
            supervisor.handle_sap_packet(raw_del, ("192.168.99.100", 9875))
            mock_inval.assert_called_with(14)

    def test_parse_valid_l24_sap_packet(self):
        sdp = (
            "v=0\r\n"
            "o=- 12345 12345 IN IP4 192.168.99.11\r\n"
            "s=test1 aes_bus\r\n"
            "c=IN IP4 239.69.11.1/32\r\n"
            "t=0 0\r\n"
            "m=audio 5004 RTP/AVP 96\r\n"
            "a=rtpmap:96 L24/48000/2\r\n"
            "a=ts-refclk:ptp=IEEE1588-2008:F0-2F-74-FF-FE-32-26-60:0\r\n"
        )
        raw = build_raw_sap_packet(sdp, origin_ip="192.168.99.11")
        parsed = parse_sap_packet(raw, sender_ip="192.168.99.11")

        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["sap_name"], "test1 aes_bus")
        self.assertEqual(parsed["session_name"], "test1 aes_bus")
        self.assertEqual(parsed["session_id"], "239.69.11.1:5004")
        self.assertEqual(parsed["multicast_ip"], "239.69.11.1")
        self.assertEqual(parsed["rtp_port"], 5004)
        self.assertEqual(parsed["channels"], 2)
        self.assertEqual(parsed["rate"], 48000)
        self.assertEqual(parsed["sample_rate"], 48000)
        self.assertEqual(parsed["encoding"], "L24")
        self.assertEqual(parsed["format"], "S24BE")
        self.assertEqual(parsed["ptp_clock_id"], "F0-2F-74-FF-FE-32-26-60:0")
        self.assertEqual(parsed["origin_ip"], "192.168.99.11")
        self.assertFalse(parsed["is_deletion"])

    def test_parse_valid_l16_sap_packet(self):
        sdp = (
            "v=0\r\n"
            "s=Studio MultiTrack\r\n"
            "c=IN IP4 239.69.99.5\r\n"
            "m=audio 5008 RTP/AVP 97\r\n"
            "a=rtpmap:97 L16/48000/8\r\n"
        )
        raw = build_raw_sap_packet(sdp, origin_ip="192.168.99.20", include_mime=False)
        parsed = parse_sap_packet(raw, sender_ip="192.168.99.20")

        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["sap_name"], "Studio MultiTrack")
        self.assertEqual(parsed["multicast_ip"], "239.69.99.5")
        self.assertEqual(parsed["rtp_port"], 5008)
        self.assertEqual(parsed["channels"], 8)
        self.assertEqual(parsed["rate"], 48000)
        self.assertEqual(parsed["encoding"], "L16")
        self.assertEqual(parsed["format"], "S16BE")
        self.assertFalse(parsed["is_deletion"])

    def test_parse_sap_deletion_packet(self):
        sdp = (
            "v=0\r\n"
            "s=test1 aes_bus\r\n"
            "c=IN IP4 239.69.11.1\r\n"
            "m=audio 5004 RTP/AVP 96\r\n"
        )
        raw = build_raw_sap_packet(sdp, origin_ip="192.168.99.11", is_deletion=True)
        parsed = parse_sap_packet(raw, sender_ip="192.168.99.11")

        self.assertIsNotNone(parsed)
        self.assertTrue(parsed["is_deletion"])
        self.assertEqual(parsed["multicast_ip"], "239.69.11.1")

    def test_parse_invalid_or_truncated_packet(self):
        self.assertIsNone(parse_sap_packet(b""))
        self.assertIsNone(parse_sap_packet(b"\x00\x00\x00\x00"))
        # Invalid version (version 0 instead of 1)
        self.assertIsNone(parse_sap_packet(b"\x00\x00\x00\x00\x00\x00\x00\x00\x00"))
        # Encrypted flag set
        encrypted_raw = b"\x22\x00\x00\x00\x7f\x00\x00\x01v=0"
        self.assertIsNone(parse_sap_packet(encrypted_raw))

    async def test_supervisor_lifecycle_and_status(self):
        mock_pm = MagicMock()
        mock_pm.db_session_factory = MagicMock()

        supervisor = AoIpDiscoverySupervisor(14, mock_pm)
        supervisor.interface = "enp9s0"
        supervisor.nic_ip = "192.168.99.11"

        # Mock persisted remote sinks
        supervisor._get_persisted_remote_sinks = MagicMock(return_value=[
            {
                "id": "remote_test3_aes",
                "name": "Test3 AES Stream",
                "multicast_ip": "239.69.13.1",
                "rtp_port": 5004,
                "channels": 2,
                "format": "S24BE"
            }
        ])

        # Manually seed discovered stream cache
        import time
        now = time.time()
        supervisor._streams_cache["239.69.13.1:5004"] = {
            "sap_name": "test3 main",
            "multicast_ip": "239.69.13.1",
            "rtp_port": 5004,
            "channels": 2,
            "rate": 48000,
            "encoding": "L24",
            "format": "S24BE",
            "ptp_clock_id": "00-11-22-FF-FE-33-44-55:0",
            "origin_ip": "192.168.99.13",
            "is_local": False,
            "last_seen": now
        }

        status = supervisor.get_discovery_status()
        self.assertEqual(status["hub_id"], 14)
        self.assertEqual(len(status["discovered_streams"]), 1)
        disc = status["discovered_streams"][0]
        self.assertEqual(disc["multicast_ip"], "239.69.13.1")
        self.assertTrue(disc["is_persisted"])
        self.assertEqual(disc["matched_sink_id"], "remote_test3_aes")

        # Check remote sinks status
        self.assertEqual(len(status["remote_sinks_status"]), 1)
        rs_stat = status["remote_sinks_status"][0]
        self.assertEqual(rs_stat["id"], "remote_test3_aes")
        self.assertEqual(rs_stat["status"], "online")

        # Test stop
        await supervisor.stop()
        self.assertFalse(supervisor._running)

    def test_setup_sap_socket_joins_dante_multicast_group(self):
        """Verifies that _setup_sap_socket joins 239.255.255.255 for Dante/AES67 discovery."""
        mock_pm = MagicMock()
        supervisor = AoIpDiscoverySupervisor(14, mock_pm)
        supervisor.interface = "enp9s0"
        supervisor.nic_ip = "192.168.99.13"

        with patch("socket.socket") as mock_sock_cls, \
             patch("socket.if_nametoindex", return_value=3):
            mock_sock = MagicMock()
            mock_sock_cls.return_value = mock_sock

            res = supervisor._setup_sap_socket()
            self.assertEqual(res, mock_sock)

            # Check that IP_ADD_MEMBERSHIP was called for 239.255.255.255
            add_membership_calls = [
                c for c in mock_sock.setsockopt.call_args_list
                if len(c[0]) >= 2 and c[0][1] == socket.IP_ADD_MEMBERSHIP
            ]
            joined_ips = []
            for call in add_membership_calls:
                mreq_bytes = call[0][2]
                joined_ip = socket.inet_ntoa(mreq_bytes[:4])
                joined_ips.append(joined_ip)

            self.assertIn("239.255.255.255", joined_ips)
            self.assertIn("224.0.0.56", joined_ips)
            self.assertIn("224.2.127.254", joined_ips)

    def test_handle_sap_packet_and_streams_count(self):
        mock_pm = MagicMock()
        supervisor = AoIpDiscoverySupervisor(14, mock_pm)
        supervisor.nic_ip = "192.168.99.13"

        sdp = (
            "v=0\r\n"
            "s=test1 aes_bus_0\r\n"
            "c=IN IP4 239.69.11.3/1\r\n"
            "m=audio 5008 RTP/AVP 127\r\n"
            "a=rtpmap:127 L24/48000/2\r\n"
        )
        packet = build_raw_sap_packet(sdp, origin_ip="192.168.99.11")
        supervisor.handle_sap_packet(packet, ("192.168.99.11", 57602))

        status = supervisor.get_discovery_status()
        self.assertEqual(status["streams_count"], 1)
        self.assertEqual(len(status["discovered_streams"]), 1)
        st = status["discovered_streams"][0]
        self.assertEqual(st["session_name"], "test1 aes_bus_0")
        self.assertEqual(st["session_id"], "239.69.11.3:5008")
        self.assertEqual(st["multicast_ip"], "239.69.11.3")
        self.assertEqual(st["rtp_port"], 5008)
        self.assertEqual(st["sample_rate"], 48000)
        self.assertFalse(st["is_local"])

        # Deletion packet handling
        del_packet = build_raw_sap_packet(sdp, origin_ip="192.168.99.11", is_deletion=True)
        supervisor.handle_sap_packet(del_packet, ("192.168.99.11", 57602))
        status2 = supervisor.get_discovery_status()
        self.assertEqual(status2["streams_count"], 0)
        self.assertEqual(len(status2["discovered_streams"]), 0)

    def test_get_discovery_status_actively_prunes_expired_streams(self):
        import time
        mock_pm = MagicMock()
        supervisor = AoIpDiscoverySupervisor(14, mock_pm)
        supervisor.nic_ip = "192.168.99.13"

        now = time.time()
        # Seed an active stream (seen 10s ago) and an expired stream (seen 130s ago > 120s threshold)
        supervisor._streams_cache["239.69.11.1:5004"] = {
            "session_name": "Active Stream",
            "session_id": "239.69.11.1:5004",
            "multicast_ip": "239.69.11.1",
            "rtp_port": 5004,
            "last_seen": now - 10.0,
            "origin_ip": "192.168.99.11",
            "channels": 2,
            "format": "S24BE"
        }
        supervisor._streams_cache["239.69.11.2:5008"] = {
            "session_name": "Expired Stream",
            "session_id": "239.69.11.2:5008",
            "multicast_ip": "239.69.11.2",
            "rtp_port": 5008,
            "last_seen": now - 130.0,
            "origin_ip": "192.168.99.11",
            "channels": 2,
            "format": "S24BE"
        }

        # Mock persisted remote sinks pointing to both
        supervisor._get_persisted_remote_sinks = MagicMock(return_value=[
            {"id": "rx_active", "name": "Rx Active", "multicast_ip": "239.69.11.1", "rtp_port": 5004},
            {"id": "rx_expired", "name": "Rx Expired", "multicast_ip": "239.69.11.2", "rtp_port": 5008},
        ])

        # Calling get_discovery_status() must prune the expired stream on-the-fly
        status = supervisor.get_discovery_status()

        # 1. Expired stream should be pruned from cache & discovered_streams
        self.assertNotIn("239.69.11.2:5008", supervisor._streams_cache)
        self.assertIn("239.69.11.1:5004", supervisor._streams_cache)
        self.assertEqual(len(status["discovered_streams"]), 1)
        self.assertEqual(status["discovered_streams"][0]["session_name"], "Active Stream")
        self.assertEqual(status["discovered_streams"][0]["status"], "online")

        # 2. Remote sinks status should reflect real-time network presence
        rs_status = {s["id"]: s["status"] for s in status["remote_sinks_status"]}
        self.assertEqual(rs_status["rx_active"], "online")
        self.assertEqual(rs_status["rx_expired"], "waiting")

    def test_stream_recovery_after_silence_invalidates_pipewire_graph(self):
        """Verifies that an inactive/silent stream receiving a new SAP packet transitions to online and invalidates the graph."""
        import time
        mock_pm = MagicMock()
        supervisor = AoIpDiscoverySupervisor(14, mock_pm)
        supervisor.nic_ip = "192.168.99.13"

        with patch("core.websocket_subscription_hub.subscription_hub.invalidate_pipewire_graph") as mock_inval:
            sdp = (
                "v=0\r\n"
                "s=Recoverable Stream\r\n"
                "c=IN IP4 239.69.20.1\r\n"
                "m=audio 5004 RTP/AVP 96\r\n"
            )
            raw = build_raw_sap_packet(sdp, origin_ip="192.168.99.20")

            # 1. First packet: new stream -> invalidates graph
            supervisor.handle_sap_packet(raw, ("192.168.99.20", 9875))
            mock_inval.assert_called_with(14)
            mock_inval.reset_mock()

            # 2. Simulate stream went silent for 70 seconds (> 60s active window)
            now = time.time()
            stream_key = "239.69.20.1:5004"
            supervisor._streams_cache[stream_key]["last_seen"] = now - 70.0
            supervisor._streams_cache[stream_key]["_state"] = "waiting"

            # 3. New packet arrives from recovered sender: MUST invalidate graph!
            supervisor.handle_sap_packet(raw, ("192.168.99.20", 9875))
            mock_inval.assert_called_with(14)

            # 4. State in cache should now be online
            cached = supervisor._streams_cache[stream_key]
            self.assertEqual(cached["status"], "online")
            self.assertEqual(cached["_state"], "online")



if __name__ == "__main__":
    unittest.main()
