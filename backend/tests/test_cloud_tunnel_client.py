import unittest
import asyncio
import json
import hmac
import hashlib
import time
from unittest.mock import patch, MagicMock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.database.models import Base, SystemSettings
from backend.core.cloud_tunnel_client import CloudTunnelClient, encode_body, decode_body
from backend.core.update_checker import check_latest_release
try:
    from core.auth_manager import auth_manager
except ImportError:
    from backend.core.auth_manager import auth_manager


class TestCloudTunnelClient(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)

        # Seed initial SystemSettings
        with self.Session() as session:
            settings = SystemSettings(
                node_name="Test Edge Node",
                cloudhub_enabled=False,
                cloudhub_url="https://hub.example.com",
                cloudhub_node_id="node_edge_test",
                cloudhub_tunnel_secret="test_super_secret_key_12345",
                cloudhub_sso_enabled=True,
                gui_password="local_password_secret",
            )
            session.add(settings)
            session.commit()

        # Dummy ASGI app for testing in-memory bridge
        async def dummy_asgi_app(scope, receive, send):
            if scope["type"] == "http":
                # Check headers
                headers = dict(scope.get("headers", []))
                auth_hdr = headers.get(b"authorization", b"").decode("latin1")
                cookie_hdr = headers.get(b"cookie", b"").decode("latin1")

                body = json.dumps({
                    "path": scope["path"],
                    "query": scope.get("query_string", b"").decode("utf-8"),
                    "has_auth": bool(auth_hdr),
                    "auth": auth_hdr,
                    "cookie": cookie_hdr,
                }).encode("utf-8")

                await send({
                    "type": "http.response.start",
                    "status": 200,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode("ascii")),
                    ],
                })
                await send({
                    "type": "http.response.body",
                    "body": body,
                    "more_body": False,
                })

        self.client = CloudTunnelClient(asgi_app=dummy_asgi_app, db_session_factory=self.Session)

    def test_settings_model_cloudhub_columns(self):
        """Verify that SystemSettings contains all CloudHub integration columns."""
        with self.Session() as session:
            settings = session.query(SystemSettings).first()
            self.assertIsNotNone(settings)
            self.assertEqual(settings.node_name, "Test Edge Node")
            self.assertFalse(settings.cloudhub_enabled)
            self.assertEqual(settings.cloudhub_url, "https://hub.example.com")
            self.assertEqual(settings.cloudhub_node_id, "node_edge_test")
            self.assertEqual(settings.cloudhub_tunnel_secret, "test_super_secret_key_12345")
            self.assertTrue(settings.cloudhub_sso_enabled)

    def test_sso_assertion_verification(self):
        """Verify HMAC-SHA256 assertion signature validation logic."""
        secret = "test_super_secret_key_12345"
        node_id = "node_edge_test"
        username = "admin"
        now = int(time.time())
        exp = now + 60

        payload = f"{node_id}:{username}:{now}:{exp}"
        sig = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
        valid_assertion = f"{payload}:{sig}"

        # Valid assertion
        self.assertTrue(self.client._verify_sso_assertion(valid_assertion, secret, sso_enabled=True))

        # SSO disabled
        self.assertFalse(self.client._verify_sso_assertion(valid_assertion, secret, sso_enabled=False))

        # Tampered signature
        tampered_assertion = f"{payload}:deadbeef"
        self.assertFalse(self.client._verify_sso_assertion(tampered_assertion, secret, sso_enabled=True))

        # Expired assertion
        past_exp = now - 10
        past_payload = f"{node_id}:{username}:{now - 70}:{past_exp}"
        past_sig = hmac.new(secret.encode("utf-8"), past_payload.encode("utf-8"), hashlib.sha256).hexdigest()
        expired_assertion = f"{past_payload}:{past_sig}"
        self.assertFalse(self.client._verify_sso_assertion(expired_assertion, secret, sso_enabled=True))

    async def test_in_memory_asgi_http_dispatch_with_sso(self):
        """Verify in-memory ASGI dispatch handles SSO injection and returns HTTP responses."""
        secret = "test_super_secret_key_12345"
        node_id = "node_edge_test"
        now = int(time.time())
        exp = now + 60
        payload = f"{node_id}:admin:{now}:{exp}"
        sig = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
        assertion = f"{payload}:{sig}"

        sent_messages = []

        class MockWS:
            async def send(self, msg_str):
                sent_messages.append(json.loads(msg_str))

        mock_ws = MockWS()
        http_req = {
            "type": "http_request",
            "stream_id": "req-12345",
            "method": "GET",
            "path": "/api/test",
            "query": "foo=bar",
            "headers": {},
            "body": None,
            "sso_assertion": assertion,
        }

        await self.client._handle_asgi_http(mock_ws, http_req, secret, sso_enabled=True)

        self.assertEqual(len(sent_messages), 1)
        resp = sent_messages[0]
        self.assertEqual(resp["type"], "http_resp")
        self.assertEqual(resp["stream_id"], "req-12345")
        self.assertEqual(resp["status_code"], 200)

        body_bytes = decode_body(resp["body"])
        body_json = json.loads(body_bytes.decode("utf-8"))
        self.assertEqual(body_json["path"], "/api/test")
        self.assertEqual(body_json["query"], "foo=bar")
        self.assertTrue(body_json["has_auth"])
        self.assertIn("Bearer ", body_json["auth"])
        self.assertIn("gui_session=", body_json["cookie"])

    async def test_in_memory_asgi_streaming_disconnect_handling(self):
        """Verify ASGI streaming responses terminate gracefully without raising unexpected http.request errors."""
        async def streaming_asgi_app(scope, receive, send):
            if scope["type"] == "http":
                await send({
                    "type": "http.response.start",
                    "status": 200,
                    "headers": [(b"content-type", b"multipart/x-mixed-replace; boundary=ffmpeg")],
                })
                # Application first consumes request body
                req_msg = await receive()
                self.assertEqual(req_msg["type"], "http.request")
                self.assertFalse(req_msg["more_body"])

                # Simulate Starlette listening for disconnect while streaming
                await send({
                    "type": "http.response.body",
                    "body": b"--ffmpeg\r\nContent-Type: image/jpeg\r\n\r\nfakejpg\r\n",
                    "more_body": True,
                })
                # Check receive() behavior: should wait or get disconnect, NOT crash
                msg = await receive()
                self.assertEqual(msg["type"], "http.disconnect")
                await send({
                    "type": "http.response.body",
                    "body": b"",
                    "more_body": False,
                })

        client = CloudTunnelClient(asgi_app=streaming_asgi_app, db_session_factory=self.Session)
        sent_messages = []
        class MockWS:
            async def send(self, msg_str):
                sent_messages.append(json.loads(msg_str))

        http_req = {
            "type": "http_request",
            "stream_id": "stream-1",
            "method": "GET",
            "path": "/processes/1/preview",
            "query": "",
            "headers": {},
            "body": None,
        }

        await client._handle_asgi_http(MockWS(), http_req, "secret", sso_enabled=False)
        self.assertEqual(len(sent_messages), 1)
        resp = sent_messages[0]
        self.assertEqual(resp["status_code"], 200)
        self.assertIn(b"fakejpg", decode_body(resp["body"]))

    def test_disconnect_hub(self):
        """Verify disconnect_hub clears node credentials in DB."""
        self.client.disconnect_hub()
        with self.Session() as session:
            settings = session.query(SystemSettings).first()
            self.assertFalse(settings.cloudhub_enabled)
            self.assertIsNone(settings.cloudhub_node_id)
            self.assertIsNone(settings.cloudhub_tunnel_secret)

    @patch("urllib.request.urlopen")
    def test_update_checker_github_tag_fallback(self, mock_urlopen):
        """Verify update checker falls back to /tags when /releases/latest is unavailable (404)."""
        import urllib.error

        # First call to /releases/latest raises HTTPError 404
        # Second call to /tags returns valid JSON list of tags
        tags_response = json.dumps([
            {"name": "v2.52.0", "commit": {"sha": "abc1234"}},
            {"name": "v2.51.0", "commit": {"sha": "def5678"}},
            {"name": "v2.50.0", "commit": {"sha": "ghi9012"}},
        ]).encode("utf-8")

        mock_404 = urllib.error.HTTPError("https://api.github.com/repos/alexolivan/ffmpeg-gui/releases/latest", 404, "Not Found", {}, None)
        mock_tags_resp = MagicMock()
        mock_tags_resp.read.return_value = tags_response
        mock_tags_resp.__enter__.return_value = mock_tags_resp

        mock_urlopen.side_effect = [mock_404, mock_tags_resp]

        res = check_latest_release("2.50.0", force=True)
        self.assertTrue(res["update_available"])
        self.assertEqual(res["latest_release"], "2.52.0")
        self.assertIn("v2.52.0", res["release_url"])

    async def test_revoke_frame_handling(self):
        """Verify receiving revoke frame automatically clears credentials and stops tunnel."""
        mock_ws = MagicMock()
        mock_ws.close = MagicMock(return_value=asyncio.sleep(0))

        with self.Session() as session:
            settings = session.query(SystemSettings).first()
            settings.cloudhub_enabled = True
            session.commit()

        revoke_msg = json.dumps({"type": "revoke", "reason": "unlinked_by_superadmin"})
        await self.client._dispatch_tunnel_frame(mock_ws, revoke_msg, "secret", True)

        self.assertTrue(self.client._revoked)
        with self.Session() as session:
            settings = session.query(SystemSettings).first()
            self.assertFalse(settings.cloudhub_enabled)
            self.assertIsNone(settings.cloudhub_node_id)

    async def test_send_unlink_notify(self):
        """Verify sending unlink_notify sends control frame to CloudHub."""
        mock_ws = MagicMock()
        mock_ws.send = MagicMock(return_value=asyncio.sleep(0))
        self.client._ws = mock_ws
        self.client._connected = True

        await self.client.send_unlink_notify()
        mock_ws.send.assert_called_once()
        sent_data = json.loads(mock_ws.send.call_args[0][0])
        self.assertEqual(sent_data["type"], "unlink_notify")

    async def test_heartbeat_worker_includes_lcd_telemetry(self):
        """Verify _heartbeat_worker constructs and sends lcd capability details."""
        with self.Session() as session:
            settings = session.query(SystemSettings).first()
            settings.lcd_enabled = True
            settings.lcd_alias = "RACK-ENC-01"
            settings.lcd_model = "cfa635"
            session.commit()

        mock_ws = MagicMock()
        sent_frames = []

        async def fake_send(data):
            sent_frames.append(json.loads(data))
            raise asyncio.CancelledError()

        mock_ws.send = fake_send

        with patch("asyncio.sleep", return_value=None):
            await self.client._heartbeat_worker(mock_ws, "node_edge_test", "test_super_secret_key_12345")

        self.assertEqual(len(sent_frames), 1)
        payload = sent_frames[0]
        self.assertIn("lcd", payload)
        self.assertTrue(payload["lcd"]["enabled"])
        self.assertEqual(payload["lcd"]["alias"], "RACK-ENC-01")
        self.assertEqual(payload["lcd"]["model"], "cfa635")
        self.assertIn("locator_active", payload["lcd"])
        self.assertIn("leds", payload["lcd"])
        self.assertEqual(len(payload["lcd"]["leds"]), 4)
        self.assertEqual(payload["lcd"]["leds"][0], "blink_green")
        self.assertEqual(payload["lcd"]["leds"][3], "green")

    async def test_handle_asgi_http_returns_413_when_exceeding_max_frame_bytes(self):
        """Verify _handle_asgi_http guards against >MAX_TUNNEL_FRAME_BYTES frames to prevent 1009 disconnects."""
        import sys
        async def big_app(scope, receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": [[b"content-type", b"application/json"]]})
            await send({"type": "http.response.body", "body": b"x" * 2048, "more_body": False})

        self.client.app = big_app
        sent_frames = []

        class FakeWS:
            async def send(self, data):
                sent_frames.append(json.loads(data))

        with patch.object(sys.modules[self.client.__class__.__module__], "MAX_TUNNEL_FRAME_BYTES", 512):
            await self.client._handle_asgi_http(FakeWS(), {
                "stream_id": "s_big_http",
                "method": "GET",
                "path": "/api/services/7/pipewire/nodes",
                "headers": {},
            }, "secret", False)

        self.assertEqual(len(sent_frames), 1)
        frame = sent_frames[0]
        self.assertEqual(frame["type"], "http_resp")
        self.assertEqual(frame["stream_id"], "s_big_http")
        self.assertEqual(frame["status_code"], 413)

    async def test_handle_asgi_ws_open_closes_stream_when_exceeding_max_frame_bytes(self):
        """Verify _handle_asgi_ws_open sends ws_close(1009) instead of an oversized ws_frame."""
        import sys
        async def big_ws_app(scope, receive, send):
            await receive()
            await send({"type": "websocket.accept"})
            await send({"type": "websocket.send", "text": "y" * 2048})

        self.client.app = big_ws_app
        sent_frames = []

        class FakeWS:
            async def send(self, data):
                sent_frames.append(json.loads(data))

        with patch.object(sys.modules[self.client.__class__.__module__], "MAX_TUNNEL_FRAME_BYTES", 512):
            await self.client._handle_asgi_ws_open(FakeWS(), {
                "stream_id": "s_big_ws",
                "path": "/ws/logs",
                "headers": {},
            }, "secret", False)

        self.assertEqual(len(sent_frames), 1)
        self.assertEqual(sent_frames[0]["type"], "ws_close")
        self.assertEqual(sent_frames[0]["stream_id"], "s_big_ws")
        self.assertEqual(sent_frames[0]["code"], 1009)


if __name__ == "__main__":
    unittest.main()
