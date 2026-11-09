import pytest
from starlette.testclient import TestClient
from main import app
from database.db import SessionLocal
from database.models import SystemSettings, Service


@pytest.fixture
def client():
    return TestClient(app)


def test_prometheus_metrics_disabled(client):
    with SessionLocal() as db:
        settings = db.query(SystemSettings).first()
        if not settings:
            settings = SystemSettings()
            db.add(settings)
        settings.metrics_exporter_enabled = False
        db.commit()

    resp = client.get("/api/metrics")
    assert resp.status_code == 404

    resp_root = client.get("/metrics")
    assert resp_root.status_code == 404


def test_prometheus_metrics_auth_and_ip_validation(client):
    with SessionLocal() as db:
        settings = db.query(SystemSettings).first()
        if not settings:
            settings = SystemSettings()
            db.add(settings)
        settings.metrics_exporter_enabled = True
        settings.metrics_exporter_token = "secret_metrics_token_999"
        settings.metrics_exporter_allowed_ips = "127.0.0.1, 10.0.0.0/8"
        db.commit()

    # 1. Missing token -> 401
    resp = client.get("/api/metrics")
    assert resp.status_code == 401

    # 2. Invalid token -> 401
    resp = client.get("/api/metrics?token=wrong_token")
    assert resp.status_code == 401

    # 3. Valid token query param, client IP 127.0.0.1 -> 200
    resp = client.get("/api/metrics?token=secret_metrics_token_999")
    assert resp.status_code == 200
    assert "version=0.0.4" in resp.headers["content-type"]
    assert "ffmpeg_gui_system_cpu_percent" in resp.text

    # 4. Valid Bearer header -> 200
    resp = client.get(
        "/api/metrics",
        headers={"Authorization": "Bearer secret_metrics_token_999"}
    )
    assert resp.status_code == 200

    # 5. IP restriction check with forbidden IP
    with SessionLocal() as db:
        settings = db.query(SystemSettings).first()
        settings.metrics_exporter_allowed_ips = "192.168.200.1"  # Not 127.0.0.1
        db.commit()

    resp = client.get(
        "/api/metrics",
        headers={"Authorization": "Bearer secret_metrics_token_999"}
    )
    assert resp.status_code == 403


def test_prometheus_metrics_service_gauges(client):
    with SessionLocal() as db:
        settings = db.query(SystemSettings).first()
        settings.metrics_exporter_enabled = True
        settings.metrics_exporter_token = "my_token"
        settings.metrics_exporter_allowed_ips = None

        # Add test running service
        svc = Service(
            name="Exporter Stream Test",
            service_type="ffmpeg_stream",
            status="running",
            config={},
            cpu_usage=18.5,
            ram_usage=95.0,
            bitrate=4500.0,
            fps=50.0,
            speed=1.002,
        )
        svc_na = Service(
            name="Audio Only PCM Service",
            service_type="ffmpeg_stream",
            status="running",
            config={},
            cpu_usage=5.0,
            ram_usage=40.0,
            bitrate="N/A",
            fps="N/A",
            speed="1.0x",
        )
        db.add(svc)
        db.add(svc_na)
        db.commit()
        db.refresh(svc)
        db.refresh(svc_na)
        svc_id = svc.id
        svc_na_id = svc_na.id

    try:
        resp = client.get("/api/metrics?token=my_token")
        assert resp.status_code == 200
        text = resp.text

        assert f'ffmpeg_gui_service_status{{id="{svc_id}",name="Exporter Stream Test",type="ffmpeg_stream"}} 1' in text
        assert f'ffmpeg_gui_service_bitrate_kbps{{id="{svc_id}",name="Exporter Stream Test"}} 4500' in text
        assert f'ffmpeg_gui_service_fps{{id="{svc_id}",name="Exporter Stream Test"}} 50' in text

        # Verify string metrics like "N/A" and "1.0x" converted safely without ValueError
        assert f'ffmpeg_gui_service_bitrate_kbps{{id="{svc_na_id}",name="Audio Only PCM Service"}} 0.0' in text
        assert f'ffmpeg_gui_service_fps{{id="{svc_na_id}",name="Audio Only PCM Service"}} 0.0' in text
        assert f'ffmpeg_gui_service_speed_ratio{{id="{svc_na_id}",name="Audio Only PCM Service"}} 1.0' in text

    finally:
        with SessionLocal() as db:
            db.query(Service).filter(Service.id.in_([svc_id, svc_na_id])).delete()
            db.commit()


def test_prometheus_metrics_with_gui_password_configured(client):
    from main import _AUTH_PW_CACHE
    with SessionLocal() as db:
        settings = db.query(SystemSettings).first()
        if not settings:
            settings = SystemSettings()
            db.add(settings)
        settings.metrics_exporter_enabled = True
        settings.metrics_exporter_token = "metrics_secret_tok"
        settings.metrics_exporter_allowed_ips = None
        settings.gui_password = "admin_super_secret_gui_password"
        db.commit()

    _AUTH_PW_CACHE["password"] = "admin_super_secret_gui_password"
    _AUTH_PW_CACHE["timestamp"] = 99999999999.0

    try:
        # Scraper requesting with metrics bearer token must pass through AuthBarrierMiddleware
        resp = client.get(
            "/metrics",
            headers={"Authorization": "Bearer metrics_secret_tok"}
        )
        assert resp.status_code == 200
        assert "ffmpeg_gui_system_cpu_percent" in resp.text

        # Invalid metrics token must return 401 from get_prometheus_metrics with specific detail
        resp_invalid = client.get(
            "/metrics",
            headers={"Authorization": "Bearer bad_tok"}
        )
        assert resp_invalid.status_code == 401
        assert "Unauthorized metrics access" in resp_invalid.json().get("detail", "")
    finally:
        with SessionLocal() as db:
            settings = db.query(SystemSettings).first()
            if settings:
                settings.gui_password = None
                db.commit()
        _AUTH_PW_CACHE["password"] = None
        _AUTH_PW_CACHE["timestamp"] = 0.0

