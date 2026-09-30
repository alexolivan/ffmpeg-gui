import asyncio
from unittest.mock import patch, AsyncMock, MagicMock
import pytest
from starlette.websockets import WebSocketDisconnect
from fastapi.testclient import TestClient
from main import app
from database.db import SessionLocal
from database.models import SystemSettings, Service
from core.auth_manager import auth_manager


@pytest.fixture
def db_session():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def test_next_available_desktop_ports_endpoints():
    client = TestClient(app)
    # Test primary endpoint
    res1 = client.get("/api/services/desktop/next-available-ports")
    assert res1.status_code == 200
    data1 = res1.json()
    assert "display_num" in data1
    assert "vnc_port" in data1
    assert data1["vnc_port"] == 5900 + data1["display_num"]

    # Test alias endpoint
    res2 = client.get("/api/services/next-desktop-ports")
    assert res2.status_code == 200
    data2 = res2.json()
    assert "display_num" in data2
    assert "vnc_port" in data2


def test_ws_desktop_vnc_auth_barrier(db_session):
    client = TestClient(app)
    settings = db_session.query(SystemSettings).first()
    if not settings:
        settings = SystemSettings(node_name="WsTestNode", gui_password="SecretDesktopPassword123!")
        db_session.add(settings)
    else:
        settings.gui_password = "SecretDesktopPassword123!"
    db_session.commit()

    try:
        # 1. Unauthenticated WS connection to /ws/desktop/999/vnc must be rejected with 1008
        with pytest.raises(WebSocketDisconnect) as excinfo:
            with client.websocket_connect("/ws/desktop/999/vnc"):
                pass
        assert excinfo.value.code == 1008
    finally:
        settings.gui_password = None
        db_session.commit()


def test_ws_desktop_vnc_non_existent_service(db_session):
    client = TestClient(app)
    # Service ID 999999 does not exist, should close with 1008
    with pytest.raises(WebSocketDisconnect) as excinfo:
        with client.websocket_connect("/ws/desktop/999999/vnc"):
            pass
    assert excinfo.value.code == 1008


def test_ws_desktop_vnc_proxy_bidirectional(db_session):
    # Create test desktop service in database
    svc = Service(
        name="Test VNC Desktop",
        service_type="desktop",
        status="running",
        type="service",
        config={"desktop_config": {"display_num": 99, "vnc_port": 5999}},
    )
    db_session.add(svc)
    db_session.commit()

    mock_reader = AsyncMock()
    mock_writer = MagicMock()
    mock_writer.drain = AsyncMock()
    mock_writer.wait_closed = AsyncMock()

    async def mock_read(n):
        if not hasattr(mock_read, "called"):
            mock_read.called = True
            return b"RFB 003.008\n"
        await asyncio.sleep(0.5)
        return b""

    mock_reader.read.side_effect = mock_read

    with patch("asyncio.open_connection", new_callable=AsyncMock) as mock_open:
        mock_open.return_value = (mock_reader, mock_writer)
        client = TestClient(app)
        with client.websocket_connect(f"/ws/desktop/{svc.id}/vnc", subprotocols=["binary"]) as ws:
            # Client receives VNC banner
            data = ws.receive_bytes()
            assert data == b"RFB 003.008\n"

            # Client sends response
            ws.send_bytes(b"RFB 003.008\n")

        # Verify writer received the bytes and was closed
        mock_writer.write.assert_called_with(b"RFB 003.008\n")
        mock_writer.close.assert_called()

    # Cleanup DB
    db_session.delete(svc)
    db_session.commit()
