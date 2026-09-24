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
