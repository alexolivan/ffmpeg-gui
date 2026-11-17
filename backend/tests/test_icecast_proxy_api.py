import os
import sys
import base64
import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from main import app
from database.db import SessionLocal, init_db
from database.models import Service as MediaProcess


class TestIcecastProxyAPI(unittest.TestCase):
    def setUp(self):
        init_db()
        self.client = TestClient(app)
        self.db = SessionLocal()

        self.icecast_proc = MediaProcess(
            name="Test Icecast Proxy Server",
            service_type="icecast_server",
            status="running",
            input_config={},
            output_config={},
            codec_config={},
            config={
                "icecast_config": {
                    "port": 7010,
                    "http_enabled": True,
                    "ssl_enabled": False,
                    "admin_user": "iceadmin",
                    "admin_password": "secret_ice_password",
                }
            },
        )
        self.ffmpeg_proc = MediaProcess(
            name="Test FFmpeg Non-Icecast",
            service_type="ffmpeg_stream",
            status="stopped",
            input_config={},
            output_config={},
            codec_config={},
            config={},
        )
        self.db.add_all([self.icecast_proc, self.ffmpeg_proc])
        self.db.commit()
        self.db.refresh(self.icecast_proc)
        self.db.refresh(self.ffmpeg_proc)

    def tearDown(self):
        for p in self.db.query(MediaProcess).filter(MediaProcess.id.in_([self.icecast_proc.id, self.ffmpeg_proc.id])).all():
            self.db.delete(p)
        self.db.commit()
        self.db.close()

    def test_icecast_proxy_guards_404_and_400(self):
        res_404 = self.client.get("/api/processes/999999/icecast-proxy/status.xsl")
        self.assertEqual(res_404.status_code, 404)

        res_400 = self.client.get(f"/api/processes/{self.ffmpeg_proc.id}/icecast-proxy/status.xsl")
        self.assertEqual(res_400.status_code, 400)

    def test_icecast_proxy_rewrites_html_and_injects_basic_auth_on_admin(self):
        captured_requests = []

        class FakeUpstreamResp:
            def __init__(self):
                self.status_code = 200
                self.headers = {"content-type": "text/html; charset=utf-8"}

            async def aread(self):
                return (
                    b'<html><head><link rel="stylesheet" href="/style.css"></head>'
                    b'<body><a href="/admin/listclients.xsl">Clients</a>'
                    b'<audio src="/live.mp3"></audio></body></html>'
                )

            async def aclose(self):
                pass

        class FakeAsyncClient:
            def __init__(self, **kwargs):
                pass

            def build_request(self, method, url, headers=None, content=None):
                captured_requests.append({"method": method, "url": url, "headers": headers or {}})
                return MagicMock()

            async def send(self, req, stream=True):
                return FakeUpstreamResp()

            async def aclose(self):
                pass

        with patch("httpx.AsyncClient", FakeAsyncClient):
            res = self.client.get(f"/api/processes/{self.icecast_proc.id}/icecast-proxy/admin/")

        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(captured_requests[0]["url"], "http://127.0.0.1:7010/admin/")

        expected_auth = "Basic " + base64.b64encode(b"iceadmin:secret_ice_password").decode("ascii")
        self.assertEqual(captured_requests[0]["headers"].get("authorization"), expected_auth)

        prefix = f"/api/processes/{self.icecast_proc.id}/icecast-proxy"
        self.assertIn(f'href="{prefix}/style.css"', res.text)
        self.assertIn(f'href="{prefix}/admin/listclients.xsl"', res.text)
        self.assertIn(f'src="{prefix}/live.mp3"', res.text)

    def test_icecast_proxy_streams_audio_mountpoint(self):
        class FakeAudioResp:
            def __init__(self):
                self.status_code = 200
                self.headers = {"content-type": "audio/mpeg", "icy-name": "Live Radio"}

            async def aiter_bytes(self, chunk_size=16384):
                yield b"mp3-frame-1-"
                yield b"mp3-frame-2"

            async def aclose(self):
                pass

        class FakeAsyncClient:
            def __init__(self, **kwargs):
                pass

            def build_request(self, method, url, headers=None, content=None):
                return MagicMock()

            async def send(self, req, stream=True):
                return FakeAudioResp()

            async def aclose(self):
                pass

        with patch("httpx.AsyncClient", FakeAsyncClient):
            with self.client.stream("GET", f"/api/processes/{self.icecast_proc.id}/icecast-proxy/live.mp3") as res:
                self.assertEqual(res.status_code, 200)
                self.assertEqual(res.headers.get("content-type"), "audio/mpeg")
                body = b"".join(res.iter_bytes())

        self.assertEqual(body, b"mp3-frame-1-mp3-frame-2")


if __name__ == "__main__":
    unittest.main()
