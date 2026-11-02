"""CloudHub outbound reverse tunnel client and in-memory ASGI bridge."""

import os
import sys
import time
import json
import uuid
import hmac
import base64
import hashlib
import asyncio
import logging
from typing import Dict, Any, Optional, List, Tuple
from urllib.parse import urlparse
import urllib.request
import websockets

try:
    from version import __version__
    from database.models import SystemSettings
except ImportError:
    from backend.version import __version__
    from backend.database.models import SystemSettings
try:
    from core.auth_manager import auth_manager
except ImportError:
    from backend.core.auth_manager import auth_manager


logger = logging.getLogger("ffmpeg_gui.cloud_tunnel")


def encode_body(data: Optional[bytes]) -> Optional[str]:
    if data is None:
        return None
    return base64.b64encode(data).decode("ascii")


def decode_body(data_b64: Optional[str]) -> Optional[bytes]:
    if data_b64 is None:
        return None
    return base64.b64decode(data_b64.encode("ascii"))


def get_loopback_ssl_context(parsed_url: Any) -> Optional[Any]:
    """Provide unverified SSL context for loopback/localhost or when CLOUDHUB_INSECURE_SSL=1."""
    if parsed_url.scheme in ("https", "wss"):
        hostname = (parsed_url.hostname or "").lower()
        if hostname in ("127.0.0.1", "localhost", "::1") or os.environ.get("CLOUDHUB_INSECURE_SSL") == "1":
            import ssl
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            return ctx
    return None


class CloudTunnelClient:
    """Outbound WebSocket client connecting to CloudHub with in-memory ASGI dispatch."""

    def __init__(self, asgi_app: Any, db_session_factory: Any):
        self.app = asgi_app
        self.db_session_factory = db_session_factory
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._ws: Optional[Any] = None
        self._connected = False
        self._last_connected_at: Optional[float] = None
        self._last_error: Optional[str] = None
        self._active_ws_streams: Dict[str, asyncio.Queue] = {}

    def get_status(self) -> Dict[str, Any]:
        """Return real-time connection status for Web UI settings card."""
        with self.db_session_factory() as session:
            settings = session.query(SystemSettings).first()
            enabled = bool(settings.cloudhub_enabled) if settings else False
            hub_url = settings.cloudhub_url if settings else None
            node_id = settings.cloudhub_node_id if settings else None
            sso_enabled = bool(settings.cloudhub_sso_enabled) if settings else True
            org_name = settings.cloudhub_org_name if settings else None
            group_name = settings.cloudhub_group_name if settings else None

        return {
            "enabled": enabled,
            "connected": self._connected,
            "hub_url": hub_url,
            "node_id": node_id,
            "sso_enabled": sso_enabled,
            "org_name": org_name,
            "group_name": group_name,
            "last_connected_at": self._last_connected_at,
            "last_error": self._last_error,
            "version": __version__,
        }

    async def start(self) -> None:
        """Start the background tunnel daemon if enabled in settings."""
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._connection_loop())
        logger.info("CloudTunnelClient daemon started")

    async def stop(self) -> None:
        """Stop tunnel connection and clean up."""
        self._running = False
        if self._ws:
            try:
                await self._ws.close()
            except Exception:
                pass
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        self._connected = False
        logger.info("CloudTunnelClient daemon stopped")

    def enroll(self, hub_url: str, enrollment_token: str) -> Dict[str, Any]:
        """
        Synchronously exchange an enrollment token with CloudHub and configure settings.
        """
        hub_url_clean = hub_url.strip().rstrip("/")
        enroll_endpoint = f"{hub_url_clean}/api/edge/enroll"

        with self.db_session_factory() as session:
            settings = session.query(SystemSettings).first()
            if not settings:
                settings = SystemSettings()
                session.add(settings)
                session.flush()

            node_name = settings.node_name or "FFmpeg Appliance"
            icon_data = None
            if settings.logo_path and os.path.isfile(settings.logo_path):
                try:
                    with open(settings.logo_path, "rb") as f:
                        b64_logo = base64.b64encode(f.read()).decode("ascii")
                        icon_data = f"data:image/png;base64,{b64_logo}"
                except Exception:
                    pass
            if not icon_data and settings.logo_text:
                icon_data = settings.logo_text.strip().upper()

        payload = {
            "token": enrollment_token.strip(),
            "name": node_name,
            "icon_data": icon_data,
            "current_version": __version__,
        }

        req = urllib.request.Request(
            enroll_endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        ssl_ctx = get_loopback_ssl_context(urlparse(hub_url_clean))
        try:
            with urllib.request.urlopen(req, timeout=10.0, context=ssl_ctx) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8")
            try:
                err_json = json.loads(err_body)
                msg = err_json.get("detail", str(e))
            except Exception:
                msg = f"HTTP {e.code}: {e.reason}"
            raise ConnectionError(f"CloudHub enrollment failed: {msg}")
        except Exception as e:
            raise ConnectionError(f"Cannot reach CloudHub at {hub_url_clean}: {e}")

        # Save credentials to database
        with self.db_session_factory() as session:
            settings = session.query(SystemSettings).first()
            settings.cloudhub_url = hub_url_clean
            settings.cloudhub_node_id = data["node_id"]
            settings.cloudhub_tunnel_secret = data["tunnel_secret"]
            settings.cloudhub_enabled = True
            settings.cloudhub_org_name = str(data.get("org_id", ""))
            settings.cloudhub_group_name = str(data.get("group_id", "")) if data.get("group_id") else None
            session.commit()

        logger.info(
            "Successfully enrolled to CloudHub '%s' as node ID: %s",
            hub_url_clean,
            data["node_id"],
        )
        return data

    def disconnect_hub(self) -> None:
        """Clear enrollment credentials and disable tunnel."""
        with self.db_session_factory() as session:
            settings = session.query(SystemSettings).first()
            if settings:
                settings.cloudhub_enabled = False
                settings.cloudhub_node_id = None
                settings.cloudhub_tunnel_secret = None
                settings.cloudhub_org_name = None
                settings.cloudhub_group_name = None
                session.commit()
        self._connected = False
        logger.info("Unlinked and disconnected from CloudHub")

    def _verify_sso_assertion(
        self, assertion: Optional[str], tunnel_secret: str, sso_enabled: bool
    ) -> bool:
        """
        Validate HMAC-SHA256 assertion signature and timestamp window (60s).
        Format: {node_id}:{username}:{timestamp}:{expiry}:{sig}
        """
        if not assertion or not sso_enabled or not tunnel_secret:
            return False

        try:
            parts = assertion.split(":")
            if len(parts) != 5:
                return False

            node_id, username, ts_str, exp_str, signature = parts
            now = int(time.time())
            exp = int(exp_str)
            ts = int(ts_str)

            # Check expiration and timestamp freshness
            if now > exp or (now - ts) > 60:
                return False

            payload = f"{node_id}:{username}:{ts_str}:{exp_str}"
            expected_sig = hmac.new(
                tunnel_secret.encode("utf-8"),
                payload.encode("utf-8"),
                hashlib.sha256,
            ).hexdigest()

            return hmac.compare_digest(expected_sig, signature)
        except Exception as err:
            logger.debug("SSO assertion validation error: %s", err)
            return False

    async def _connection_loop(self) -> None:
        """Main outbound connection loop with exponential backoff."""
        backoff = 1.0
        while self._running:
            with self.db_session_factory() as session:
                settings = session.query(SystemSettings).first()
                if not settings or not settings.cloudhub_enabled:
                    await asyncio.sleep(2.0)
                    continue

                hub_url = settings.cloudhub_url
                node_id = settings.cloudhub_node_id
                tunnel_secret = settings.cloudhub_tunnel_secret
                sso_enabled = bool(settings.cloudhub_sso_enabled)

            if not hub_url or not node_id or not tunnel_secret:
                await asyncio.sleep(2.0)
                continue

            # Convert http/https URL to ws/wss URL
            parsed = urlparse(hub_url)
            ws_scheme = "wss" if parsed.scheme == "https" else "ws"
            netloc = parsed.netloc or parsed.path
            ws_url = f"{ws_scheme}://{netloc}/api/edge/tunnel"

            now_ts = str(int(time.time()))
            sig = hmac.new(
                tunnel_secret.encode("utf-8"),
                f"{node_id}:{now_ts}".encode("utf-8"),
                hashlib.sha256,
            ).hexdigest()

            headers = {
                "X-Node-ID": node_id,
                "X-Tunnel-Timestamp": now_ts,
                "X-Tunnel-Signature": sig,
            }

            # Fallback credentials in query parameters in case proxy/CDN strips X- headers
            ws_url = f"{ws_scheme}://{netloc}/api/edge/tunnel?node_id={node_id}&timestamp={now_ts}&signature={sig}"

            connect_kwargs: Dict[str, Any] = {
                "ping_interval": 20,
                "ping_timeout": 10,
            }
            ws_ssl = get_loopback_ssl_context(parsed)
            if ws_ssl is not None:
                connect_kwargs["ssl"] = ws_ssl

            # Support both websockets >= 14 (additional_headers) and websockets < 14 (extra_headers)
            try:
                import inspect
                sig_params = inspect.signature(websockets.connect).parameters
                if "additional_headers" in sig_params:
                    connect_kwargs["additional_headers"] = headers
                elif "extra_headers" in sig_params:
                    connect_kwargs["extra_headers"] = headers
                else:
                    connect_kwargs["additional_headers"] = headers
            except Exception:
                connect_kwargs["additional_headers"] = headers

            try:
                logger.info("Connecting reverse tunnel to CloudHub: %s", ws_url)
                async with websockets.connect(
                    ws_url,
                    **connect_kwargs,
                ) as ws:
                    self._ws = ws
                    self._connected = True
                    self._last_connected_at = time.time()
                    self._last_error = None
                    backoff = 1.0
                    logger.info("Reverse tunnel established to CloudHub as '%s'", node_id)

                    # Start telemetry heartbeat worker
                    heartbeat_task = asyncio.create_task(
                        self._heartbeat_worker(ws, node_id, tunnel_secret)
                    )

                    try:
                        async for message in ws:
                            asyncio.create_task(
                                self._dispatch_tunnel_frame(
                                    ws, message, tunnel_secret, sso_enabled
                                )
                            )
                    finally:
                        heartbeat_task.cancel()
                        try:
                            await heartbeat_task
                        except asyncio.CancelledError:
                            pass

            except Exception as err:
                self._connected = False
                self._last_error = str(err)
                logger.warning(
                    "CloudHub tunnel disconnected (%s). Reconnecting in %.1fs...",
                    err,
                    backoff,
                )
                await asyncio.sleep(backoff)
                backoff = min(backoff * 1.5, 30.0)

    async def _heartbeat_worker(self, ws: Any, node_id: str, tunnel_secret: str) -> None:
        """Periodically stream system vitality metrics to CloudHub."""
        while True:
            await asyncio.sleep(5.0)
            try:
                # Gather system metrics without blocking
                import psutil

                cpu = psutil.cpu_percent(interval=None)
                ram = psutil.virtual_memory().percent
                disk = psutil.disk_usage("/").percent
                boot_time = psutil.boot_time()
                uptime_sec = int(time.time() - boot_time)

                # Query services workload
                with self.db_session_factory() as session:
                    from backend.database.models import Service, ScheduledTask, SystemSettings

                    total_services = session.query(Service).count()
                    running_services = (
                        session.query(Service).filter(Service.status == "running").count()
                    )
                    error_services = (
                        session.query(Service).filter(Service.status == "error").count()
                    )
                    total_tasks = session.query(ScheduledTask).count()

                    sys_settings = session.query(SystemSettings).first()
                    node_name = sys_settings.node_name if sys_settings else None
                    logo_text = sys_settings.logo_text if sys_settings else None
                    logo_path = sys_settings.logo_path if sys_settings else None

                payload = {
                    "type": "heartbeat",
                    "current_version": __version__,
                    "node_name": node_name,
                    "logo_text": logo_text,
                    "logo_path": logo_path,
                    "system": {
                        "cpu_percent": cpu,
                        "memory_percent": ram,
                        "disk_percent": disk,
                        "uptime_seconds": uptime_sec,
                    },
                    "workload": {
                        "total_services": total_services,
                        "services_running": running_services,
                        "services_error": error_services,
                        "total_tasks": total_tasks,
                        "tasks_running": 0,
                    },
                }

                await ws.send(json.dumps(payload))
            except asyncio.CancelledError:
                break
            except Exception as err:
                logger.debug("Heartbeat error: %s", err)

    async def _dispatch_tunnel_frame(
        self, ws: Any, raw_msg: str, tunnel_secret: str, sso_enabled: bool
    ) -> None:
        """Route multiplexed tunnel frames into local in-memory ASGI app."""
        try:
            msg = json.loads(raw_msg)
            msg_type = msg.get("type")
            stream_id = msg.get("stream_id")

            if msg_type == "http_req":
                await self._handle_asgi_http(ws, msg, tunnel_secret, sso_enabled)

            elif msg_type == "ws_open":
                await self._handle_asgi_ws_open(ws, msg, tunnel_secret, sso_enabled)

            elif msg_type == "ws_frame":
                queue = self._active_ws_streams.get(stream_id)
                if queue:
                    await queue.put(msg)

            elif msg_type == "ws_close":
                queue = self._active_ws_streams.pop(stream_id, None)
                if queue:
                    await queue.put(None)  # Sentinel to close stream

        except Exception as err:
            logger.error("Error dispatching tunnel frame: %s", err)

    async def _handle_asgi_http(
        self, ws: Any, frame: Dict[str, Any], tunnel_secret: str, sso_enabled: bool
    ) -> None:
        """Execute HTTP call in-memory via ASGI 3.0 interface."""
        stream_id = frame["stream_id"]
        method = frame.get("method", "GET").upper()
        path = frame.get("path", "/")
        query = frame.get("query", "")
        headers_dict = frame.get("headers", {})
        body_bytes = decode_body(frame.get("body")) or b""
        sso_assertion = frame.get("sso_assertion")

        # Prepare ASGI headers (list of [bytes, bytes])
        asgi_headers = []
        for k, v in headers_dict.items():
            asgi_headers.append((k.lower().encode("latin1"), v.encode("latin1")))

        # Check and inject SSO session
        if self._verify_sso_assertion(sso_assertion, tunnel_secret, sso_enabled):
            username = sso_assertion.split(":")[1] if sso_assertion else "cloudhub_operator"
            with self.db_session_factory() as session:
                settings = session.query(SystemSettings).first()
                gui_password = settings.gui_password if settings else None

            # Generate local ephemeral session token
            current_pw = gui_password or ""
            ephemeral_token = auth_manager.create_session(
                current_password=current_pw, expiry_seconds=60
            )

            # Inject into cookies and Authorization header
            cookie_header = f"gui_session={ephemeral_token}"
            asgi_headers.append((b"cookie", cookie_header.encode("latin1")))
            asgi_headers.append(
                (b"authorization", f"Bearer {ephemeral_token}".encode("latin1"))
            )
            asgi_headers.append((b"x-authenticated-user", username.encode("latin1")))
            asgi_headers.append((b"x-authenticated-channel", b"cloudhub"))


        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": method,
            "path": path,
            "raw_path": path.encode("utf-8"),
            "query_string": query.encode("utf-8"),
            "headers": asgi_headers,
            "client": ("127.0.0.1", 0),
            "server": ("cloudhub-tunnel", 0),
        }

        # Body stream
        body_sent = False

        async def receive():
            nonlocal body_sent
            if not body_sent:
                body_sent = True
                return {
                    "type": "http.request",
                    "body": body_bytes,
                    "more_body": False,
                }
            return {"type": "http.request", "body": b"", "more_body": False}

        resp_status = 500
        resp_headers = []
        resp_body_chunks = []

        async def send(message):
            nonlocal resp_status, resp_headers
            msg_type = message.get("type")
            if msg_type == "http.response.start":
                resp_status = message.get("status", 200)
                for hk, hv in message.get("headers", []):
                    resp_headers.append(
                        [hk.decode("latin1"), hv.decode("latin1")]
                    )
            elif msg_type == "http.response.body":
                chunk = message.get("body", b"")
                if chunk:
                    resp_body_chunks.append(chunk)

        try:
            await self.app(scope, receive, send)
            full_body = b"".join(resp_body_chunks)
            resp_frame = {
                "type": "http_resp",
                "stream_id": stream_id,
                "status_code": resp_status,
                "headers": resp_headers,
                "body": encode_body(full_body),
            }
            await ws.send(json.dumps(resp_frame))
        except Exception as err:
            logger.error("In-memory ASGI HTTP dispatch error: %s", err)
            err_frame = {
                "type": "http_resp",
                "stream_id": stream_id,
                "status_code": 500,
                "headers": [["content-type", "application/json"]],
                "body": encode_body(json.dumps({"detail": str(err)}).encode("utf-8")),
            }
            await ws.send(json.dumps(err_frame))

    async def _handle_asgi_ws_open(
        self, ws: Any, frame: Dict[str, Any], tunnel_secret: str, sso_enabled: bool
    ) -> None:
        """Handle incoming WebSocket stream via in-memory ASGI 3.0 bridge."""
        stream_id = frame["stream_id"]
        path = frame.get("path", "/")
        query = frame.get("query", "")
        headers_dict = frame.get("headers", {})
        sso_assertion = frame.get("sso_assertion")

        asgi_headers = []
        for k, v in headers_dict.items():
            asgi_headers.append((k.lower().encode("latin1"), v.encode("latin1")))

        if self._verify_sso_assertion(sso_assertion, tunnel_secret, sso_enabled):
            username = sso_assertion.split(":")[1] if sso_assertion else "cloudhub_operator"
            with self.db_session_factory() as session:
                settings = session.query(SystemSettings).first()
                gui_password = settings.gui_password if settings else None

            current_pw = gui_password or ""
            ephemeral_token = auth_manager.create_session(
                current_password=current_pw, expiry_seconds=60
            )
            cookie_header = f"gui_session={ephemeral_token}"
            asgi_headers.append((b"cookie", cookie_header.encode("latin1")))
            asgi_headers.append(
                (b"authorization", f"Bearer {ephemeral_token}".encode("latin1"))
            )
            asgi_headers.append((b"x-authenticated-user", username.encode("latin1")))
            asgi_headers.append((b"x-authenticated-channel", b"cloudhub"))


        scope = {
            "type": "websocket",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "scheme": "ws",
            "path": path,
            "raw_path": path.encode("utf-8"),
            "query_string": query.encode("utf-8"),
            "headers": asgi_headers,
            "client": ("127.0.0.1", 0),
            "server": ("cloudhub-tunnel", 0),
            "subprotocols": [],
        }

        queue: asyncio.Queue = asyncio.Queue()
        self._active_ws_streams[stream_id] = queue

        # First receive event for ASGI WebSocket must be websocket.connect
        connect_sent = False

        async def receive():
            nonlocal connect_sent
            if not connect_sent:
                connect_sent = True
                return {"type": "websocket.connect"}

            msg = await queue.get()
            if msg is None:
                return {"type": "websocket.disconnect", "code": 1000}

            is_binary = msg.get("is_binary", False)
            data = msg.get("data")
            if is_binary:
                bin_data = decode_body(data)
                return {"type": "websocket.receive", "bytes": bin_data}
            else:
                return {"type": "websocket.receive", "text": str(data)}

        async def send(message):
            msg_type = message.get("type")
            if msg_type == "websocket.accept":
                pass  # Accepted locally
            elif msg_type == "websocket.send":
                text = message.get("text")
                bytes_data = message.get("bytes")
                if text is not None:
                    out = {
                        "type": "ws_frame",
                        "stream_id": stream_id,
                        "is_binary": False,
                        "data": text,
                    }
                    await ws.send(json.dumps(out))
                elif bytes_data is not None:
                    out = {
                        "type": "ws_frame",
                        "stream_id": stream_id,
                        "is_binary": True,
                        "data": encode_body(bytes_data),
                    }
                    await ws.send(json.dumps(out))
            elif msg_type == "websocket.close":
                out = {
                    "type": "ws_close",
                    "stream_id": stream_id,
                    "code": message.get("code", 1000),
                }
                await ws.send(json.dumps(out))

        try:
            await self.app(scope, receive, send)
        except Exception as err:
            logger.debug("In-memory ASGI WS error: %s", err)
        finally:
            self._active_ws_streams.pop(stream_id, None)

    def schedule_audit_event(self, event_data: Dict[str, Any]) -> None:
        """Schedule sending an audit event frame over the reverse tunnel."""
        if not self._connected or not self._ws:
            return
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self.send_audit_event(event_data))
        except RuntimeError:
            pass

    async def send_audit_event(self, event_data: Dict[str, Any]) -> None:
        """Stream an audit event frame to CloudHub over the active WebSocket."""
        if not self._connected or not self._ws:
            return
        frame = {
            "type": "audit_event",
            "event": event_data,
        }
        try:
            await self._ws.send(json.dumps(frame))
        except Exception as e:
            logger.debug("Failed to send audit frame over CloudHub tunnel: %s", e)

