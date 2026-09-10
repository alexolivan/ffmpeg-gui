import unittest
import os
import tempfile
import time
from unittest.mock import patch, MagicMock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database.models import Base, Service, PeerInboundKey, PeerRemoteNode
from core.peer_crypto import PeerCrypto
from core.peer_manager import PeerManager

class TestPeerManager(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.temp_dir.name, "test_peer_mgr.db")
        self.engine = create_engine(f"sqlite:///{self.db_path}", connect_args={"check_same_thread": False})
        self.TestingSession = sessionmaker(bind=self.engine)
        Base.metadata.create_all(bind=self.engine)

        self.session = self.TestingSession()
        
        # Setup shared service and unshared service
        self.shared_svc = Service(
            name="Shared MediaMTX",
            service_type="mediamtx_hub",
            config={
                "mediamtx_config": {
                    "srt_enabled": True,
                    "srt_port": 8890,
                    "rtmp_enabled": True,
                    "rtmp_port": 1935,
                    "paths": [{"path_id": "live1", "auth_mode": "open"}]
                }
            },
            is_shared_with_peers=True,
            allow_peer_lease=True,
            status="running"
        )
        self.private_svc = Service(
            name="Private Stream",
            service_type="ffmpeg_stream",
            config={},
            is_shared_with_peers=False,
            allow_peer_lease=False,
            status="running"
        )
        self.session.add_all([self.shared_svc, self.private_svc])
        self.session.commit()
        self.session.refresh(self.shared_svc)
        self.session.refresh(self.private_svc)

        # Setup inbound key
        self.token_id, self.secret_key = PeerCrypto.generate_keypair()
        self.inbound_key = PeerInboundKey(
            alias="Test Consumer Node",
            token_id=self.token_id,
            secret_key=self.secret_key,
            allowed_services=None,
            status="active"
        )
        self.session.add(self.inbound_key)
        self.session.commit()

        self.peer_mgr = PeerManager()

    def tearDown(self):
        self.session.close()
        self.temp_dir.cleanup()

    def test_shared_catalog_filtering(self):
        catalog = self.peer_mgr.get_shared_catalog(self.session)
        self.assertEqual(len(catalog), 1)
        self.assertEqual(catalog[0]["id"], self.shared_svc.id)
        self.assertEqual(catalog[0]["name"], "Shared MediaMTX")
        self.assertEqual(catalog[0]["service_type"], "mediamtx_hub")
        self.assertIn("srt_port", catalog[0]["protocols"])
        self.assertEqual(catalog[0]["protocols"]["srt_port"], 8890)

    def test_inbound_rpc_discover_services(self):
        # 1. First discovery: expected CHANGED
        req_payload = {"action": "DISCOVER_SERVICES", "known_version": 0}
        enc_req = PeerCrypto.encrypt_payload(req_payload, self.secret_key)
        
        status_code, enc_res = self.peer_mgr.handle_inbound_rpc(
            token_id=self.token_id,
            encrypted_pkg=enc_req,
            db_session=self.session
        )
        self.assertEqual(status_code, 200)
        res = PeerCrypto.decrypt_payload(enc_res, self.secret_key)
        self.assertEqual(res["status"], "CHANGED")
        self.assertEqual(len(res["services"]), 1)
        version = res["version"]
        self.assertGreater(version, 0)

        # 2. Second discovery with known_version: expected UNCHANGED
        req_unchanged = {"action": "DISCOVER_SERVICES", "known_version": version}
        enc_unchanged = PeerCrypto.encrypt_payload(req_unchanged, self.secret_key)
        status_code2, enc_res2 = self.peer_mgr.handle_inbound_rpc(
            token_id=self.token_id,
            encrypted_pkg=enc_unchanged,
            db_session=self.session
        )
        self.assertEqual(status_code2, 200)
        res2 = PeerCrypto.decrypt_payload(enc_res2, self.secret_key)
        self.assertEqual(res2["status"], "UNCHANGED")

    def test_inbound_rpc_invalid_or_revoked_token(self):
        # 1. Unknown token
        req_payload = {"action": "DISCOVER_SERVICES"}
        enc_req = PeerCrypto.encrypt_payload(req_payload, self.secret_key)
        code, err_res = self.peer_mgr.handle_inbound_rpc("non_existent_token", enc_req, self.session)
        self.assertEqual(code, 401)
        self.assertIn("detail", err_res)

        # 2. Revoked token
        self.inbound_key.status = "revoked"
        self.session.commit()
        code_rev, _ = self.peer_mgr.handle_inbound_rpc(self.token_id, enc_req, self.session)
        self.assertEqual(code_rev, 401)

    def test_inbound_rpc_lease_lifecycle(self):
        svc_id = self.shared_svc.id
        
        # 1. Acquire lease
        req_acquire = {"action": "ACQUIRE_LEASE", "service_id": svc_id}
        enc_acquire = PeerCrypto.encrypt_payload(req_acquire, self.secret_key)
        code, enc_res = self.peer_mgr.handle_inbound_rpc(self.token_id, enc_acquire, self.session)
        self.assertEqual(code, 200)
        res = PeerCrypto.decrypt_payload(enc_res, self.secret_key)
        self.assertEqual(res["status"], "LEASE_ACQUIRED")
        self.assertEqual(self.peer_mgr.get_active_remote_lease_count(svc_id), 1)

        # 2. Heartbeat
        req_hb = {"action": "HEARTBEAT", "service_id": svc_id}
        enc_hb = PeerCrypto.encrypt_payload(req_hb, self.secret_key)
        code_hb, enc_res_hb = self.peer_mgr.handle_inbound_rpc(self.token_id, enc_hb, self.session)
        self.assertEqual(code_hb, 200)
        res_hb = PeerCrypto.decrypt_payload(enc_res_hb, self.secret_key)
        self.assertEqual(res_hb["status"], "HEARTBEAT_ACK")

        # 3. Release lease
        req_rel = {"action": "RELEASE_LEASE", "service_id": svc_id}
        enc_rel = PeerCrypto.encrypt_payload(req_rel, self.secret_key)
        code_rel, enc_res_rel = self.peer_mgr.handle_inbound_rpc(self.token_id, enc_rel, self.session)
        self.assertEqual(code_rel, 200)
        res_rel = PeerCrypto.decrypt_payload(enc_res_rel, self.secret_key)
        self.assertEqual(res_rel["status"], "LEASE_RELEASED")
        self.assertEqual(self.peer_mgr.get_active_remote_lease_count(svc_id), 0)

    @patch("requests.post")
    def test_outbound_remote_lease_rpcs(self, mock_post):
        # Create a remote node record
        node = PeerRemoteNode(
            name="Remote Peer Node",
            base_url="http://192.168.1.100:8000",
            token_id=self.token_id,
            secret_key=self.secret_key,
            status="online"
        )
        self.session.add(node)
        self.session.commit()
        self.session.refresh(node)

        # Mock successful acquire response
        acquire_resp_payload = {"success": True, "status": "LEASE_ACQUIRED"}
        enc_acquire_resp = PeerCrypto.encrypt_payload(acquire_resp_payload, self.secret_key)
        
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = enc_acquire_resp
        mock_post.return_value = mock_resp

        # 1. Acquire remote lease
        ok, err = self.peer_mgr.acquire_remote_lease(self.session, node.id, 42)
        self.assertTrue(ok)
        self.assertIsNone(err)
        mock_post.assert_called()

        # Mock heartbeat response
        hb_resp_payload = {"success": True, "status": "HEARTBEAT_ACK"}
        mock_resp.json.return_value = PeerCrypto.encrypt_payload(hb_resp_payload, self.secret_key)
        ok_hb, err_hb = self.peer_mgr.send_remote_heartbeat(self.session, node.id, 42)
        self.assertTrue(ok_hb)
        self.assertIsNone(err_hb)

        # Mock release response
        rel_resp_payload = {"success": True, "status": "LEASE_RELEASED"}
        mock_resp.json.return_value = PeerCrypto.encrypt_payload(rel_resp_payload, self.secret_key)
        ok_rel, err_rel = self.peer_mgr.release_remote_lease(self.session, node.id, 42)
        self.assertTrue(ok_rel)
        self.assertIsNone(err_rel)

    @patch("requests.post")
    def test_active_remote_leases_resolution_and_heartbeats(self, mock_post):
        # Setup inbound key
        key = PeerInboundKey(
            alias="test-client-1",
            token_id="tok_abc123",
            secret_key=self.secret_key,
            allowed_services=[]
        )
        self.session.add(key)
        self.session.commit()

        # Simulate inbound lease
        self.peer_mgr._active_remote_leases[10] = {"tok_abc123": time.time()}
        leases = self.peer_mgr.get_active_remote_leases(10, self.session)
        self.assertEqual(leases, ["peer:test-client-1"])

        # Setup running service with remote peer lease
        svc = Service(
            name="Streaming to remote",
            service_type="ffmpeg_stream",
            status="running",
            config={
                "output_config": {
                    "type": "srt",
                    "peer_node_id": 1,
                    "peer_service_id": 42
                }
            }
        )
        self.session.add(svc)
        node = PeerRemoteNode(
            id=1,
            name="vps1",
            base_url="https://vps1.example.com",
            token_id="tok_vps1",
            secret_key=self.secret_key,
            status="online"
        )
        self.session.add(node)
        self.session.commit()

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = PeerCrypto.encrypt_payload({"status": "HEARTBEAT_ACK"}, self.secret_key)
        mock_post.return_value = mock_resp

        self.peer_mgr.send_all_active_remote_heartbeats(self.session)
        mock_post.assert_called()

    def test_shared_catalog_icecast_legacy_export(self):
        # Add a shared Icecast 2.3.3 server
        ice_legacy = Service(
            name="Icecast 2.3.3 Server",
            alias="Legacy Radio",
            service_type="icecast_server",
            config={
                "icecast_config": {
                    "port": 8000,
                    "ssl_enabled": False,
                    "mounts": [{"mount_name": "/live.mp3"}],
                    "source_password": "pass"
                }
            },
            is_shared_with_peers=True,
            allow_peer_lease=True,
            status="running"
        )
        self.session.add(ice_legacy)
        self.session.commit()

        catalog = self.peer_mgr.get_shared_catalog(self.session)
        ice_entry = next((s for s in catalog if s["id"] == ice_legacy.id), None)
        self.assertIsNotNone(ice_entry)
        self.assertTrue(ice_entry["is_legacy"])
        self.assertTrue(ice_entry["protocols"]["is_legacy"])
        self.assertFalse(ice_entry["protocols"]["ssl_enabled"])
        self.assertEqual(ice_entry["protocols"]["port"], 8000)

if __name__ == "__main__":
    unittest.main()
