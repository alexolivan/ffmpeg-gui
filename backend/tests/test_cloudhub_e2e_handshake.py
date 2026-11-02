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
from backend.version import __version__


class TestCloudHubE2EHandshake(unittest.IsolatedAsyncioTestCase):
    """End-to-end integration test validating bilateral handshake between CloudHub and Edge node."""

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
                node_name="Broadcast Edge 01",
                gui_password="local_super_secret",
            )
            session.add(settings)
            session.commit()

        # Dummy ASGI app simulating ffmpeg-gui API
        async def asgi_app(scope, receive, send):
            if scope["type"] == "http":
                headers = dict(scope.get("headers", []))
                auth_hdr = headers.get(b"authorization", b"").decode("latin1")
                cookie_hdr = headers.get(b"cookie", b"").decode("latin1")

                data = {
                    "node": "Broadcast Edge 01",
                    "path": scope["path"],
                    "authenticated": ("gui_session=" in cookie_hdr or "Bearer " in auth_hdr),
                }
                body = json.dumps(data).encode("utf-8")

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

        self.client = CloudTunnelClient(asgi_app=asgi_app, db_session_factory=self.Session)

    @patch("urllib.request.urlopen")
    async def test_full_enrollment_and_sso_reverse_proxy_cycle(self, mock_urlopen):
        """
        Simulate full cycle:
        1. Enroll with CloudHub token -> receives node_id and tunnel_secret.
        2. Establish tunnel frame exchange -> CloudHub sends reverse proxy HTTP request with SSO.
        3. Node executes request via in-memory ASGI without local TCP port binding.
        4. CloudHub receives 200 OK and valid JSON.
        """
        hub_url = "https://hub.broadcast.local"
        node_id = "node_49f8a32b"
        tunnel_secret = "secret_handshake_hmac_key_999"

        # Mock enrollment HTTP response
        mock_enroll_resp = MagicMock()
        mock_enroll_resp.read.return_value = json.dumps({
            "node_id": node_id,
            "tunnel_secret": tunnel_secret,
            "org_id": "Main Station Org",
            "group_id": "Edge Encoders",
        }).encode("utf-8")
        mock_enroll_resp.__enter__.return_value = mock_enroll_resp
        mock_urlopen.return_value = mock_enroll_resp

        # 1. Execute enrollment
        enroll_res = self.client.enroll(hub_url, "chub_enr_test_token_123")
        self.assertEqual(enroll_res["node_id"], node_id)

        # Check DB state
        with self.Session() as session:
            settings = session.query(SystemSettings).first()
            self.assertTrue(settings.cloudhub_enabled)
            self.assertEqual(settings.cloudhub_node_id, node_id)
            self.assertEqual(settings.cloudhub_tunnel_secret, tunnel_secret)
            self.assertEqual(settings.cloudhub_org_name, "Main Station Org")

        # 2. CloudHub generates signed SSO assertion
        now = int(time.time())
        exp = now + 60
        sso_payload = f"{node_id}:operator_alex:{now}:{exp}"
        sso_sig = hmac.new(tunnel_secret.encode("utf-8"), sso_payload.encode("utf-8"), hashlib.sha256).hexdigest()
        assertion = f"{sso_payload}:{sso_sig}"

        # 3. Simulate CloudHub Reverse Proxy dispatching HTTP request across WebSocket tunnel
        tunnel_frames_sent = []

        class MockTunnelSocket:
            async def send(self, data_str):
                tunnel_frames_sent.append(json.loads(data_str))

        mock_socket = MockTunnelSocket()

        http_frame = {
            "type": "http_req",
            "stream_id": "stream_proxy_001",
            "method": "GET",
            "path": "/api/services",
            "query": "",
            "headers": {
                "user-agent": "Mozilla/5.0 CloudHubReverseProxy/1.0",
            },
            "body": None,
            "sso_assertion": assertion,
        }

        # 4. Handle frame in node
        await self.client._handle_asgi_http(
            ws=mock_socket,
            frame=http_frame,
            tunnel_secret=tunnel_secret,
            sso_enabled=True,
        )

        # 5. Verify response sent back to CloudHub
        self.assertEqual(len(tunnel_frames_sent), 1)
        resp_frame = tunnel_frames_sent[0]
        self.assertEqual(resp_frame["type"], "http_resp")
        self.assertEqual(resp_frame["stream_id"], "stream_proxy_001")
        self.assertEqual(resp_frame["status_code"], 200)

        # Verify decoded payload
        body_bytes = decode_body(resp_frame["body"])
        payload = json.loads(body_bytes.decode("utf-8"))
        self.assertEqual(payload["node"], "Broadcast Edge 01")
        self.assertEqual(payload["path"], "/api/services")
        self.assertTrue(payload["authenticated"], "SSO session must authenticate user transparently")

        # 6. Unlink
        self.client.disconnect_hub()
        with self.Session() as session:
            settings = session.query(SystemSettings).first()
            self.assertFalse(settings.cloudhub_enabled)
            self.assertIsNone(settings.cloudhub_node_id)
            self.assertIsNone(settings.cloudhub_tunnel_secret)


if __name__ == "__main__":
    unittest.main()
