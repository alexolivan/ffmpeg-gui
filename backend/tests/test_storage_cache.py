import os
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from database.models import Base, Storage, Service
from database.db import init_db, SessionLocal

def test_cache_storage_seeded():
    """Verify that init_db() seeds a Default Cache Storage pointing to /dev/shm (or fallback)."""
    init_db()
    with SessionLocal() as db:
        cache_storages = db.query(Storage).filter(Storage.type == "cache").all()
        assert len(cache_storages) >= 1
        default_cache = next((s for s in cache_storages if s.is_default), None)
        assert default_cache is not None
        assert "cache" in default_cache.name.lower()
        if os.path.exists("/dev/shm"):
            assert "/dev/shm" in default_cache.path


def test_clear_kiosk_cache_running_conflict():
    from fastapi.testclient import TestClient
    from main import app
    client = TestClient(app)
    with SessionLocal() as db:
        svc = Service(
            name="Running Kiosk",
            type="service",
            service_type="kiosk_browser",
            status="running",
            config={"kiosk_config": {"engine_id": "chromium"}}
        )
        db.add(svc)
        db.commit()
        svc_id = svc.id

    res = client.post(f"/api/processes/{svc_id}/kiosk/clear-cache")
    assert res.status_code == 409
    assert "running" in res.json().get("detail", "").lower()


def test_clear_kiosk_cache_stopped_success():
    from fastapi.testclient import TestClient
    from main import app, process_manager
    client = TestClient(app)
    with SessionLocal() as db:
        svc = Service(
            name="Stopped Kiosk",
            type="service",
            service_type="kiosk_browser",
            status="stopped",
            config={"kiosk_config": {"engine_id": "chromium"}}
        )
        db.add(svc)
        db.commit()
        svc_id = svc.id

    cache_dir = process_manager.get_kiosk_cache_dir(svc_id)
    os.makedirs(cache_dir, exist_ok=True)
    dummy_file = os.path.join(cache_dir, "dummy_asset.bin")
    with open(dummy_file, "wb") as f:
        f.write(b"X" * 1024)

    res = client.post(f"/api/processes/{svc_id}/kiosk/clear-cache")
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["freed_bytes"] >= 1024
    assert not os.path.exists(dummy_file)

