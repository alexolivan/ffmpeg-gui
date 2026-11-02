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


if __name__ == "__main__":
    unittest.main()
