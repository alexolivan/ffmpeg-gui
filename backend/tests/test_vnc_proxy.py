import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from main import app
from database.db import SessionLocal
from database.models import Service, SystemSettings


def test_vnc_proxy_kiosk_dereferencing():
    client = TestClient(app)
    with SessionLocal() as db:
        # Create virtual desktop
        desktop = Service(
            name="Test Desktop VNC",
            service_type="desktop",
            status="running",
            config={"desktop_config": {"display_num": 98, "vnc_port": 5998}},
        )
        db.add(desktop)
        db.commit()
        db.refresh(desktop)

        # Create kiosk linked to desktop
        kiosk = Service(
            name="Test Kiosk Browser",
            service_type="kiosk_browser",
            status="running",
            config={"kiosk_config": {"desktop_service_id": desktop.id}},
        )
        db.add(kiosk)
        db.commit()
        db.refresh(kiosk)

        desktop_id = desktop.id
        kiosk_id = kiosk.id

    try:
        # Connecting to invalid service ID should fail with 1008
        with pytest.raises(WebSocketDisconnect) as exc_info:
            with client.websocket_connect("/ws/desktop/999999/vnc"):
                pass
        assert exc_info.value.code == 1008

        # Connecting to kiosk should NOT fail with 1008; it will attempt to connect to port 5998
        # and fail with 1011 (internal error because x11vnc isn't actually running in test environment)
        with pytest.raises(WebSocketDisconnect) as exc_info:
            with client.websocket_connect(f"/ws/desktop/{kiosk_id}/vnc"):
                pass
        assert exc_info.value.code == 1011

    finally:
        with SessionLocal() as db:
            db.query(Service).filter(Service.id.in_([desktop_id, kiosk_id])).delete(synchronize_session=False)
            db.commit()
