import pytest
from starlette.testclient import TestClient
from main import app, security_guard
from database.db import SessionLocal, init_db
from database.models import SystemSettings


@pytest.fixture
def auth_test_client():
    init_db()
    with SessionLocal() as db:
        settings = db.query(SystemSettings).first()
        if not settings:
            settings = SystemSettings()
            db.add(settings)
        old_password = settings.gui_password
        old_bf_enabled = settings.brute_force_enabled
        old_bf_max = settings.brute_force_max_attempts
        old_bf_window = settings.brute_force_window_seconds
        old_bf_lockout = settings.brute_force_lockout_seconds
        old_bf_whitelist = settings.brute_force_whitelist

        settings.gui_password = "supersecretpassword123"
        settings.brute_force_enabled = True
        settings.brute_force_max_attempts = 3
        settings.brute_force_window_seconds = 60
        settings.brute_force_lockout_seconds = 120
        settings.brute_force_whitelist = ""
        db.commit()

        # Reconfigure security guard in RAM
        security_guard.configure(
            enabled=True,
            max_attempts=3,
            window_seconds=60,
            lockout_seconds=120,
            whitelist=""
        )

    # Clear any residual lockouts in guard
    with security_guard._lock:
        security_guard._locked_out.clear()
        security_guard._failed_attempts.clear()

    client = TestClient(app)
    try:
        yield client
    finally:
        with SessionLocal() as db:
            settings = db.query(SystemSettings).first()
            if settings:
                settings.gui_password = old_password
                settings.brute_force_enabled = old_bf_enabled
                settings.brute_force_max_attempts = old_bf_max
                settings.brute_force_window_seconds = old_bf_window
                settings.brute_force_lockout_seconds = old_bf_lockout
                settings.brute_force_whitelist = old_bf_whitelist
                db.commit()
            security_guard.configure(
                enabled=old_bf_enabled if old_bf_enabled is not None else True,
                max_attempts=old_bf_max or 5,
                window_seconds=old_bf_window or 300,
                lockout_seconds=old_bf_lockout or 900,
                whitelist=old_bf_whitelist or ""
            )
        with security_guard._lock:
            security_guard._locked_out.clear()
            security_guard._failed_attempts.clear()


def test_failed_login_and_lockout(auth_test_client):
    client = auth_test_client
    attacker_ip = "198.51.100.99"
    headers = {"X-Forwarded-For": attacker_ip}

    # Attempt 1: 401
    resp = client.post("/api/auth/login", json={"password": "wrongpassword1"}, headers=headers)
    assert resp.status_code == 401

    # Attempt 2: 401
    resp = client.post("/api/auth/login", json={"password": "wrongpassword2"}, headers=headers)
    assert resp.status_code == 401

    # Attempt 3: 429 (Lockout triggered)
    resp = client.post("/api/auth/login", json={"password": "wrongpassword3"}, headers=headers)
    assert resp.status_code == 429
    assert "Too many failed login attempts" in resp.json()["detail"]
    assert "Retry-After" in resp.headers

    # Attempt 4 (even with correct password!): 429 immediately blocked in RAM
    resp = client.post("/api/auth/login", json={"password": "supersecretpassword123"}, headers=headers)
    assert resp.status_code == 429

    # Admin checks status endpoint using loopback connection (or authenticated session)
    admin_login = client.post("/api/auth/login", json={"password": "supersecretpassword123"}, headers={"X-Forwarded-For": "127.0.0.1"})
    assert admin_login.status_code == 200
    token = admin_login.json()["token"]
    auth_headers = {"Authorization": f"Bearer {token}"}

    status_resp = client.get("/api/settings/security/status", headers=auth_headers)
    assert status_resp.status_code == 200
    data = status_resp.json()
    assert data["active_lockout_count"] == 1
    assert data["active_lockouts"][0]["ip"] == attacker_ip

    # Admin unblocks attacker IP
    unblock_resp = client.post("/api/settings/security/unblock", json={"ip": attacker_ip}, headers=auth_headers)
    assert unblock_resp.status_code == 200
    assert unblock_resp.json()["unblocked"] is True

    # Now attacker can log in with correct password
    login_resp = client.post("/api/auth/login", json={"password": "supersecretpassword123"}, headers=headers)
    assert login_resp.status_code == 200
    assert login_resp.json()["authenticated"] is True


def test_loopback_is_immune_to_lockout(auth_test_client):
    client = auth_test_client
    # Direct loopback requests without forwarding header
    for i in range(10):
        resp = client.post("/api/auth/login", json={"password": f"wrong_{i}"})
        assert resp.status_code == 401  # Never 429!

    # Can still immediately authenticate with correct password
    resp = client.post("/api/auth/login", json={"password": "supersecretpassword123"})
    assert resp.status_code == 200
    assert resp.json()["authenticated"] is True


def test_update_settings_brute_force_config(auth_test_client):
    client = auth_test_client

    # Authenticate as admin first
    admin_login = client.post("/api/auth/login", json={"password": "supersecretpassword123"}, headers={"X-Forwarded-For": "127.0.0.1"})
    assert admin_login.status_code == 200
    token = admin_login.json()["token"]
    auth_headers = {"Authorization": f"Bearer {token}"}

    # Update settings
    payload = {
        "brute_force_enabled": True,
        "brute_force_max_attempts": 10,
        "brute_force_window_seconds": 600,
        "brute_force_lockout_seconds": 1800,
        "brute_force_whitelist": "10.0.0.1, 192.168.0.0/16"
    }
    resp = client.post("/api/settings", json=payload, headers=auth_headers)
    assert resp.status_code == 200

    # Verify settings persisted and reflected in GET /api/settings
    get_resp = client.get("/api/settings", headers=auth_headers)
    assert get_resp.status_code == 200
    settings_data = get_resp.json()
    assert settings_data["brute_force_max_attempts"] == 10
    assert settings_data["brute_force_window_seconds"] == 600
    assert settings_data["brute_force_lockout_seconds"] == 1800
    assert settings_data["brute_force_whitelist"] == "10.0.0.1, 192.168.0.0/16"

    # Verify security_guard in RAM was reconfigured
    assert security_guard.max_attempts == 10
    assert security_guard.window_seconds == 600
    assert security_guard.lockout_seconds == 1800
    assert "10.0.0.1" in security_guard._whitelist_entries
