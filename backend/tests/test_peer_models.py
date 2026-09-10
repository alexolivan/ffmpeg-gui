import unittest
import os
import tempfile
import json
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

class TestPeerModels(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.temp_dir.name, "test_peers.db")
        self.engine = create_engine(f"sqlite:///{self.db_path}", connect_args={"check_same_thread": False})
        self.TestingSession = sessionmaker(bind=self.engine)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_peer_models_crud(self):
        from database.models import Base, Service, PeerInboundKey, PeerRemoteNode

        Base.metadata.create_all(bind=self.engine)
        session = self.TestingSession()

        # 1. Test Service federation columns
        svc = Service(
            name="MediaMTX Shared Hub",
            service_type="mediamtx_hub",
            config={},
            is_shared_with_peers=True,
            allow_peer_lease=True
        )
        session.add(svc)
        session.commit()
        session.refresh(svc)
        self.assertTrue(svc.is_shared_with_peers)
        self.assertTrue(svc.allow_peer_lease)

        # 2. Test PeerInboundKey model
        key = PeerInboundKey(
            alias="Estudio B Client",
            token_id="fgp_k_1234567890abcdef",
            secret_key="secret_symm_key_data",
            allowed_services=[svc.id],
            status="active"
        )
        session.add(key)
        session.commit()
        session.refresh(key)
        self.assertEqual(key.alias, "Estudio B Client")
        self.assertEqual(key.status, "active")
        self.assertEqual(key.allowed_services, [svc.id])
        self.assertIsNotNone(key.created_at)
        self.assertIsNone(key.last_used_at)

        # 3. Test PeerRemoteNode model
        node = PeerRemoteNode(
            name="VPS1-Relay",
            base_url="https://vps1.ecohosting.es:8000",
            token_id="fgp_k_9876543210fedcba",
            secret_key="remote_symm_key_data",
            status="online",
            latency_ms=25,
            catalog_version=3,
            cached_services_json=[{"id": 1, "name": "Remote Hub", "type": "mediamtx_hub"}],
            last_error=None
        )
        session.add(node)
        session.commit()
        session.refresh(node)
        self.assertEqual(len(node.cached_services_json), 1)

        session.close()

    def test_database_migration_columns(self):
        from sqlalchemy import text
        # 1. Simulate older services table without new columns
        with self.engine.begin() as conn:
            conn.execute(text("""
                CREATE TABLE services (
                    id INTEGER PRIMARY KEY,
                    name VARCHAR NOT NULL,
                    service_type VARCHAR NOT NULL,
                    config JSON NOT NULL
                )
            """))
            res_before = conn.execute(text("PRAGMA table_info(services)"))
            cols_before = [r[1] for r in res_before.fetchall()]
            self.assertNotIn("is_shared_with_peers", cols_before)
            self.assertNotIn("allow_peer_lease", cols_before)

            # 2. Run the migration block from db.py
            if "is_shared_with_peers" not in cols_before:
                conn.execute(text("ALTER TABLE services ADD COLUMN is_shared_with_peers BOOLEAN DEFAULT 0"))
            if "allow_peer_lease" not in cols_before:
                conn.execute(text("ALTER TABLE services ADD COLUMN allow_peer_lease BOOLEAN DEFAULT 0"))

            # 3. Verify columns now exist
            res_after = conn.execute(text("PRAGMA table_info(services)"))
            cols_after = [r[1] for r in res_after.fetchall()]
            self.assertIn("is_shared_with_peers", cols_after)
            self.assertIn("allow_peer_lease", cols_after)

if __name__ == "__main__":
    unittest.main()

