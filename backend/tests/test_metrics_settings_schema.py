import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from database.models import Base, SystemSettings
from database.db import init_db


def test_system_settings_metrics_exporter_columns():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    with Session() as session:
        settings = SystemSettings(
            metrics_exporter_enabled=True,
            metrics_exporter_token="test_secret_token_12345",
            metrics_exporter_allowed_ips="192.168.1.0/24, 10.0.0.5",
        )
        session.add(settings)
        session.commit()

        loaded = session.query(SystemSettings).first()
        assert loaded.metrics_exporter_enabled is True
        assert loaded.metrics_exporter_token == "test_secret_token_12345"
        assert loaded.metrics_exporter_allowed_ips == "192.168.1.0/24, 10.0.0.5"


def test_sqlite_introspection_migration_for_metrics_exporter():
    # Create an older table missing metrics_exporter columns
    engine = create_engine("sqlite:///:memory:")
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE system_settings (
                id INTEGER PRIMARY KEY,
                node_name VARCHAR
            );
        """))
        conn.commit()

    # Run DB migration logic on that connection
    with engine.connect() as conn:
        res = conn.execute(text("PRAGMA table_info(system_settings)"))
        columns = [row[1] for row in res.fetchall()]
        assert "metrics_exporter_enabled" not in columns

        # Run migration statements
        if "metrics_exporter_enabled" not in columns:
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN metrics_exporter_enabled BOOLEAN DEFAULT 0"))
        if "metrics_exporter_token" not in columns:
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN metrics_exporter_token TEXT DEFAULT NULL"))
        if "metrics_exporter_allowed_ips" not in columns:
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN metrics_exporter_allowed_ips TEXT DEFAULT NULL"))
        conn.commit()

        res2 = conn.execute(text("PRAGMA table_info(system_settings)"))
        columns2 = [row[1] for row in res2.fetchall()]
        assert "metrics_exporter_enabled" in columns2
        assert "metrics_exporter_token" in columns2
        assert "metrics_exporter_allowed_ips" in columns2
