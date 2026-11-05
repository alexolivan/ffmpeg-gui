import pytest
from starlette.websockets import WebSocketDisconnect
from fastapi.testclient import TestClient
from main import app
from database.db import SessionLocal
from database.models import SystemSettings
from core.auth_manager import auth_manager


@pytest.fixture
def db_session():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def test_ws_telemetry_auth_barrier(db_session):
    client = TestClient(app)
    settings = db_session.query(SystemSettings).first()
    if not settings:
        settings = SystemSettings(node_name="WsNode", gui_password="WsSecretPassword!")
        db_session.add(settings)
    else:
        settings.gui_password = "WsSecretPassword!"
    db_session.commit()

    try:
        # 1. Unauthenticated WS connection must be rejected with 1008
        with pytest.raises(WebSocketDisconnect) as excinfo:
            with client.websocket_connect("/ws/telemetry"):
                pass
        assert excinfo.value.code == 1008

        # 2. Authenticated with query param token succeeds
        token = auth_manager.create_session("WsSecretPassword!")
        with client.websocket_connect(f"/ws/telemetry?token={token}") as ws:
            # Successfully connected
            assert ws is not None

        # 3. Authenticated with session cookie succeeds
        client.cookies.set("gui_session", token)
        with client.websocket_connect("/ws/telemetry") as ws:
            assert ws is not None
        client.cookies.clear()

    finally:
        settings.gui_password = None
        db_session.commit()


@pytest.mark.asyncio
async def test_connection_manager_broadcast_prunes_dead_connections():
    from unittest.mock import AsyncMock
    from main import ConnectionManager

    cm = ConnectionManager()
    healthy_ws = AsyncMock()
    dead_ws = AsyncMock()
    dead_ws.send_json.side_effect = Exception("ConnectionClosedError 1012")

    cm.active_connections = [healthy_ws, dead_ws]

    await cm.broadcast({"type": "test"})

    healthy_ws.send_json.assert_called_once_with({"type": "test"})
    dead_ws.send_json.assert_called_once_with({"type": "test"})
    assert healthy_ws in cm.active_connections
    assert dead_ws not in cm.active_connections

