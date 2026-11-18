import os
import sys
import time
import json
import hmac
import base64
import hashlib
import asyncio
import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from main import app, ConnectionManager
from database.db import SessionLocal, init_db
from database.models import (
    Service as MediaProcess,
    ServiceDependency,
    ScheduledTask,
    SystemSettings,
)
from core.authz import AuthzContext
from core.cloud_tunnel_client import CloudTunnelClient


def _sign_sso(node_id: str, username: str, secret: str) -> str:
    now = int(time.time())
    exp = now + 60
    payload = f"{node_id}:{username}:{now}:{exp}"
    sig = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload}:{sig}"


def _sign_authz(node_id: str, username: str, secret: str, scopes: dict) -> str:
    now = int(time.time())
    exp = now + 60
    claims = {"user": username, "channel": "cloudhub", "scopes": scopes}
    b64 = base64.urlsafe_b64encode(
        json.dumps(claims, separators=(",", ":"), sort_keys=True).encode("utf-8")
    ).decode("ascii")
    payload = f"{node_id}:{username}:{b64}:{now}:{exp}"
    sig = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload}:{sig}"


class _MockWS:
    def __init__(self):
        self.sent = []

    async def send(self, text: str):
        self.sent.append(json.loads(text))


class TestEdgeAuthz(unittest.TestCase):
    def setUp(self):
        init_db()
        self.client = TestClient(app)
        self.db = SessionLocal()
        self.secret = "edge_test_tunnel_secret_abc"
        self.node_id = "ch_node_edge_test"

        # Save previous SystemSettings values to restore in tearDown
        self.settings = self.db.query(SystemSettings).first()
        if not self.settings:
            self.settings = SystemSettings()
            self.db.add(self.settings)
            self.db.commit()
            self.db.refresh(self.settings)
        self._orig_pw = self.settings.gui_password
        self._orig_secret = self.settings.cloudhub_tunnel_secret
        self._orig_node_id = self.settings.cloudhub_node_id
        self._orig_sso = self.settings.cloudhub_sso_enabled
        self.settings.gui_password = None
        self.settings.cloudhub_tunnel_secret = self.secret
        self.settings.cloudhub_node_id = self.node_id
        self.settings.cloudhub_sso_enabled = True

        # Create test services: consumer FFmpeg, provider Icecast, Desk, Kiosk, hidden service
        self.icecast = MediaProcess(
            name="Test Authz Icecast",
            service_type="icecast_server",
            status="stopped",
            config={
                "icecast_config": {
                    "port": 7099,
                    "admin_user": "iceadmin",
                    "admin_password": "super_secret_ice_pw",
                    "source_password": "source_secret_pw",
                }
            },
        )
        self.ffmpeg = MediaProcess(
            name="Test Authz FFmpeg",
            service_type="ffmpeg_stream",
            status="stopped",
            config={
                "input_config": {"url": "rtmp://user:secretpass@10.0.0.5/live/stream"},
                "output_config": {"type": "icecast", "icecast_password": "push_secret"},
                "codec_config": {},
            },
        )
        self.desktop = MediaProcess(
            name="Test Authz Desktop",
            service_type="desktop",
            status="stopped",
            config={"desktop_config": {"display_num": 77, "vnc_port": 5977}},
        )
        self.hidden = MediaProcess(
            name="Test Authz Hidden",
            service_type="mediamtx_hub",
            status="stopped",
            config={"mediamtx_config": {"publish_pass": "mtx_pub_secret"}},
        )
        self.db.add_all([self.icecast, self.ffmpeg, self.desktop, self.hidden])
        self.db.flush()

        self.kiosk = MediaProcess(
            name="Test Authz Kiosk",
            service_type="kiosk_browser",
            status="stopped",
            config={"kiosk_config": {"desktop_service_id": self.desktop.id}},
        )
        self.db.add(self.kiosk)
        self.db.flush()

        # Consumer dependency: ffmpeg -> icecast
        self.dep = ServiceDependency(
            consumer_type="service",
            consumer_id=self.ffmpeg.id,
            provider_service_id=self.icecast.id,
            is_auto_managed=True,
        )
        self.db.add(self.dep)

        self.task_op = ScheduledTask(
            name="Test Authz Record Task",
            input_config={"type": "url", "url": "http://user:tasksecret@10.0.0.9/in.ts"},
            output_config={"type": "file", "path": "/tmp/out.mp4"},
            codec_config={},
            schedule_type="manual",
        )
        self.db.add(self.task_op)
        self.db.commit()

        for obj in (self.icecast, self.ffmpeg, self.desktop, self.kiosk, self.hidden, self.task_op):
            self.db.refresh(obj)

        self.tunnel_client = CloudTunnelClient(app, SessionLocal)

    def tearDown(self):
        self.db.query(ServiceDependency).filter(
            ServiceDependency.consumer_id.in_([self.ffmpeg.id, self.kiosk.id])
        ).delete(synchronize_session=False)
        for tid in [self.task_op.id]:
            row = self.db.query(ScheduledTask).get(tid)
            if row:
                self.db.delete(row)
        # Also remove any tasks created during test
        self.db.query(ScheduledTask).filter(ScheduledTask.name.like("Authz Test Restart%")).delete(synchronize_session=False)
        for sid in (self.kiosk.id, self.ffmpeg.id, self.icecast.id, self.desktop.id, self.hidden.id):
            row = self.db.query(MediaProcess).get(sid)
            if row:
                self.db.delete(row)
        s = self.db.query(SystemSettings).first()
        if s:
            s.gui_password = self._orig_pw
            s.cloudhub_tunnel_secret = self._orig_secret
            s.cloudhub_node_id = self._orig_node_id
            s.cloudhub_sso_enabled = self._orig_sso
        self.db.commit()
        self.db.close()

    def _tunnel_http(self, method: str, path: str, authz_token: str, body: bytes = b"", extra_headers=None):
        ws = _MockWS()
        frame = {
            "type": "http_req",
            "stream_id": "s1",
            "method": method,
            "path": path,
            "query": "",
            "headers": extra_headers or {},
            "body": base64.b64encode(body).decode("ascii") if body else None,
            "sso_assertion": _sign_sso(self.node_id, "op_carlos", self.secret),
            "authz_assertion": authz_token,
            "supports_stream": False,
        }
        asyncio.run(self.tunnel_client._handle_asgi_http(ws, frame, self.secret, True))
        resp = ws.sent[0]
        raw_body = base64.b64decode(resp["body"]) if resp.get("body") else b""
        return resp["status_code"], json.loads(raw_body.decode("utf-8")) if raw_body.startswith((b"{", b"[")) else raw_body

    def test_local_owner_unrestricted_even_with_spoofed_headers(self):
        # Local HTTP request with spoofed CloudHub claim headers MUST remain full owner (and headers ignored)
        res = self.client.get(
            "/processes",
            headers={
                "x-authenticated-channel": "cloudhub",
                "x-cloudhub-claims": json.dumps({"scopes": {"processes": {"default": "none"}}}),
            },
        )
        self.assertEqual(res.status_code, 200)
        ids = {p["id"] for p in res.json()}
        self.assertIn(self.hidden.id, ids)
        exp = self.client.get(f"/processes/{self.icecast.id}/export")
        self.assertEqual(exp.status_code, 200)

    def test_tampered_authz_assertion_fails_closed(self):
        bad_token = _sign_authz(self.node_id, "op_carlos", "wrong_secret", {"dashboard": "admin"})
        status_code, data = self._tunnel_http("GET", "/processes", bad_token)
        self.assertEqual(status_code, 200)
        self.assertEqual(data, [])

        post_code, _ = self._tunnel_http("POST", "/settings", bad_token, body=b"{}")
        self.assertEqual(post_code, 403)

    def test_downward_cascade_secret_redaction_and_route_guards(self):
        # Operator can ONLY operate self.ffmpeg and monitor self.kiosk & task_op.
        # Everything else (icecast, desktop, hidden, settings, forge, hardware) is explicitly none!
        scopes = {
            "dashboard": "monitor",
            "hardware": "none",
            "media": "none",
            "settings": "none",
            "forge": "none",
            "processes": {
                "default": "none",
                "by_type": {},
                "services": {
                    str(self.ffmpeg.id): "operate",
                    str(self.kiosk.id): "operate",
                },
                "tasks": {
                    str(self.task_op.id): "operate",
                },
            },
        }
        token = _sign_authz(self.node_id, "op_carlos", self.secret, scopes)

        # 1. GET /processes returns ffmpeg (operate), kiosk (operate), PLUS implicit monitor icecast & desktop,
        #    while hiding hidden service — and redacts all secrets below manage!
        code, procs = self._tunnel_http("GET", "/processes", token)
        self.assertEqual(code, 200)
        by_id = {p["id"]: p for p in procs}
        self.assertIn(self.ffmpeg.id, by_id)
        self.assertIn(self.icecast.id, by_id)
        self.assertIn(self.kiosk.id, by_id)
        self.assertIn(self.desktop.id, by_id)
        self.assertNotIn(self.hidden.id, by_id)

        self.assertEqual(by_id[self.ffmpeg.id]["effective_level"], "operate")
        self.assertEqual(by_id[self.icecast.id]["effective_level"], "monitor")
        self.assertEqual(by_id[self.desktop.id]["effective_level"], "monitor")

        # Secrets MUST be redacted below manage
        self.assertEqual(by_id[self.icecast.id]["config"]["icecast_config"]["admin_password"], "********")
        self.assertEqual(by_id[self.ffmpeg.id]["input_config"]["url"], "rtmp://user:********@10.0.0.5/live/stream")

        # 2. Export & Icecast /admin/ blocked below manage (403)
        exp_code, _ = self._tunnel_http("GET", f"/processes/{self.icecast.id}/export", token)
        self.assertEqual(exp_code, 403)
        admin_code, _ = self._tunnel_http("GET", f"/api/processes/{self.icecast.id}/icecast-proxy/admin/", token)
        self.assertEqual(admin_code, 403)

        # 3. Non-admin Icecast status page allowed at monitor
        class FakeResp:
            status_code = 200
            headers = {"content-type": "text/html"}
            async def aread(self): return b"<html><body>OK</body></html>"
            async def aclose(self): pass
        class FakeClient:
            def __init__(self, **kw): pass
            def build_request(self, m, u, **kw): return MagicMock()
            async def send(self, r, stream=True): return FakeResp()
            async def aclose(self): pass
        with patch("httpx.AsyncClient", FakeClient):
            st_code, _ = self._tunnel_http("GET", f"/api/processes/{self.icecast.id}/icecast-proxy/status.xsl", token)
        self.assertEqual(st_code, 200)

        # 4. Settings/Forge/Hardware domain isolation
        for blocked_path in ("/builds/1/compile", "/api/settings/alsa/cards", "/api/audit-logs"):
            m = "POST" if "compile" in blocked_path else "GET"
            c, _ = self._tunnel_http(m, blocked_path, token)
            self.assertEqual(c, 403, f"Expected 403 for {m} {blocked_path}, got {c}")

        # 5. Builds & settings bootstrap return gracefully without crashing UI
        b_code, b_data = self._tunnel_http("GET", "/builds", token)
        self.assertEqual(b_code, 200)
        self.assertEqual(b_data, [])

        # 6. Catalog returns live topology
        cat_code, cat_data = self._tunnel_http("GET", "/api/cloudhub/catalog", token)
        self.assertEqual(cat_code, 200)
        self.assertTrue(any(s["id"] == self.ffmpeg.id and self.icecast.id in s["dependencies"] for s in cat_data["services"]))

        # 7. service_restart task guard blocks targeting hidden/monitor service, allows operate service
        scopes_task_mgr = dict(scopes)
        scopes_task_mgr["processes"] = dict(scopes["processes"], by_type={"task": "manage"})
        mgr_token = _sign_authz(self.node_id, "op_carlos", self.secret, scopes_task_mgr)

        bad_restart_payload = json.dumps({
            "name": "Authz Test Restart Blocked",
            "command": "system://service_restart",
            "input_config": {"type": "service_restart", "service_ids": [self.icecast.id]},
            "output_config": {},
            "codec_config": {},
            "schedule_type": "manual",
        }).encode("utf-8")
        c_bad, _ = self._tunnel_http("POST", "/tasks", mgr_token, body=bad_restart_payload, extra_headers={"content-type": "application/json"})
        self.assertEqual(c_bad, 403)

        ok_restart_payload = json.dumps({
            "name": "Authz Test Restart Allowed",
            "command": "system://service_restart",
            "input_config": {"type": "service_restart", "service_ids": [self.ffmpeg.id]},
            "output_config": {},
            "codec_config": {},
            "schedule_type": "manual",
        }).encode("utf-8")
        c_ok, _ = self._tunnel_http("POST", "/tasks", mgr_token, body=ok_restart_payload, extra_headers={"content-type": "application/json"})
        self.assertEqual(c_ok, 200)

        # 8. Telemetry WebSocket frame filtering & redaction
        ctx = AuthzContext(is_owner=False, channel="cloudhub", username="op_carlos", scopes=scopes)
        svc_levels = ctx.resolve_all_service_levels(self.db)
        task_levels = ctx.resolve_all_task_levels(self.db)
        filtered = ConnectionManager._filter_message_for_context(
            {
                "type": "telemetry",
                "data": [
                    {"id": self.ffmpeg.id, "service_type": "ffmpeg_stream", "input_config": {"url": "rtmp://u:p@h/app"}},
                    {"id": self.hidden.id, "service_type": "mediamtx_hub", "config": {"publish_pass": "secret"}},
                ],
                "upcoming_tasks": [
                    {"id": self.task_op.id, "name": "Visible"},
                    {"id": 999999, "name": "Hidden"},
                ],
                "system": {"cpu": 10},
            },
            ctx,
            svc_levels,
            task_levels,
        )
        self.assertEqual(len(filtered["data"]), 1)
        self.assertEqual(filtered["data"][0]["input_config"]["url"], "rtmp://u:********@h/app")
        self.assertEqual([t["id"] for t in filtered["upcoming_tasks"]], [self.task_op.id])
        self.assertEqual(filtered["system"], {"cpu": 10})


if __name__ == "__main__":
    unittest.main()
