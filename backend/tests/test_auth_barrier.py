import pytest
from fastapi.testclient import TestClient
from main import app
from database.db import SessionLocal
from database.models import SystemSettings


@pytest.fixture
def db_session():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def auth_client():
    return TestClient(app)


def test_auth_status_open_mode(auth_client, db_session):
    # Ensure no gui_password
    settings = db_session.query(SystemSettings).first()
    if not settings:
        settings = SystemSettings(node_name="OpenNode", gui_password=None)
        db_session.add(settings)
    else:
        settings.gui_password = None
    db_session.commit()

    resp = auth_client.get("/api/auth/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["password_required"] is False
    assert data["authenticated"] is True
    assert "node_name" in data
    assert "version" in data
    assert "gui_password" not in data


def test_auth_barrier_enforcement(auth_client, db_session):
    # Set a password
    settings = db_session.query(SystemSettings).first()
    if not settings:
        settings = SystemSettings(node_name="SecureNode", gui_password="BarrierPassword123!")
        db_session.add(settings)
    else:
        settings.gui_password = "BarrierPassword123!"
    db_session.commit()

    try:
        # 1. Check auth status
        resp = auth_client.get("/api/auth/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["password_required"] is True
        assert data["authenticated"] is False
        assert "gui_password" not in data

        # Public assets like favicon must not return 401
        assert auth_client.get("/favicon.svg").status_code != 401

        # 2. Private endpoint without auth returns 401
        resp = auth_client.get("/settings")
        assert resp.status_code == 401

        resp = auth_client.get("/builds")
        assert resp.status_code == 401

        # 3. Login with invalid password fails
        resp = auth_client.post("/login", json={"password": "WrongPassword"})
        assert resp.status_code == 401

        # 4. Login with valid password succeeds and sets session cookie
        resp = auth_client.post("/login", json={"password": "BarrierPassword123!"})
        assert resp.status_code == 200
        login_data = resp.json()
        assert login_data["authenticated"] is True
        assert "token" in login_data
        assert "gui_session" in resp.cookies

        # 5. Access private endpoint with cookie
        resp = auth_client.get("/settings", cookies=resp.cookies)
        assert resp.status_code == 200
        settings_data = resp.json()
        assert settings_data.get("has_gui_password") is True
        assert "gui_password" not in settings_data or settings_data["gui_password"] is None

        # 6. Auth status with cookie shows authenticated
        resp = auth_client.get("/api/auth/status", cookies=resp.cookies)
        assert resp.status_code == 200
        assert resp.json()["authenticated"] is True

        # 7. Logout clears session
        resp = auth_client.post("/logout")
        assert resp.status_code == 200
        assert resp.json()["authenticated"] is False

        # 8. Access private endpoint after logout fails
        auth_client.cookies.clear()
        resp = auth_client.get("/settings")
        assert resp.status_code == 401

    finally:
        # Clean up password
        settings.gui_password = None
        db_session.commit()
