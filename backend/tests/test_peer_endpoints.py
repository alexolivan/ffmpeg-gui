import unittest
from unittest.mock import patch, MagicMock
import os
import sys
import json
import time
from fastapi.testclient import TestClient

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from main import app
from database.db import SessionLocal, init_db
from database.models import PeerInboundKey, PeerRemoteNode, Service as MediaProcess, SystemSettings
from core.peer_crypto import PeerCrypto

class TestPeerEndpoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()

    def setUp(self):
        self.client = TestClient(app)
        self.db = SessionLocal()

        # Ensure a clean slate for peer test records
        self.db.query(PeerInboundKey).filter(PeerInboundKey.alias.like("Test Peer%")).delete(synchronize_session=False)
        self.db.query(PeerRemoteNode).filter(PeerRemoteNode.name.like("Test Remote%")).delete(synchronize_session=False)
        self.db.query(MediaProcess).filter(MediaProcess.name.like("Federated Service%")).delete(synchronize_session=False)
        
        # Reset SystemSettings gui_password to None for open tests
        settings = self.db.query(SystemSettings).first()
        if not settings:
            settings = SystemSettings()
            self.db.add(settings)
        self.original_password = settings.gui_password
        settings.gui_password = None
        self.db.commit()

    def tearDown(self):
        # Restore settings
        settings = self.db.query(SystemSettings).first()
        if settings:
            settings.gui_password = self.original_password
            self.db.commit()

        # Clean up test artifacts
        self.db.query(PeerInboundKey).filter(PeerInboundKey.alias.like("Test Peer%")).delete(synchronize_session=False)
        self.db.query(PeerRemoteNode).filter(PeerRemoteNode.name.like("Test Remote%")).delete(synchronize_session=False)
        self.db.query(MediaProcess).filter(MediaProcess.name.like("Federated Service%")).delete(synchronize_session=False)
        self.db.commit()
        self.db.close()

    def test_candidate_endpoints_listing(self):
        # Open access (no password)
        res = self.client.get("/api/peers/candidate-endpoints")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("node_name", data)
        self.assertIn("port", data)
        self.assertIn("scheme", data)
        self.assertIn("candidates", data)
        self.assertIsInstance(data["candidates"], list)
        self.assertGreater(len(data["candidates"]), 0)
        for cand in data["candidates"]:
            self.assertIn("interface", cand)
            self.assertIn("ip", cand)
            self.assertIn("url", cand)

    def test_candidate_endpoints_auth(self):
        # Set a gui_password to test authentication
        settings = self.db.query(SystemSettings).first()
        settings.gui_password = "supersecretpass"
        self.db.commit()

        # Unauthenticated request should fail with 401
        res_fail = self.client.get("/api/peers/candidate-endpoints")
        self.assertEqual(res_fail.status_code, 401)

        # Authenticated request with Bearer header should succeed
        headers = {"Authorization": "Bearer supersecretpass"}
        res_ok = self.client.get("/api/peers/candidate-endpoints", headers=headers)
        self.assertEqual(res_ok.status_code, 200)

    def test_inbound_keys_crud(self):
        # 1. Create Inbound Key
        payload = {
            "alias": "Test Peer Key Alpha",
            "endpoint": "http://192.168.1.100:8000",
            "allowed_services": [1, 2]
        }
        res_create = self.client.post("/api/peers/inbound-keys", json=payload)
        self.assertEqual(res_create.status_code, 200)
        created = res_create.json()
        key_id = created["id"]
        token_id = created["token_id"]
        join_token = created["join_token"]

        self.assertEqual(created["alias"], "Test Peer Key Alpha")
        self.assertEqual(created["status"], "active")
        self.assertTrue(token_id.startswith("fgp_k_"))
        self.assertTrue(join_token.startswith("FGPEER-"))

        # Verify parsed token matches creation parameters
        parsed = PeerCrypto.parse_join_token(join_token)
        self.assertEqual(parsed["token_id"], token_id)
        self.assertEqual(parsed["endpoint"], "http://192.168.1.100:8000")

        # 2. List Inbound Keys
        res_list = self.client.get("/api/peers/inbound-keys")
        self.assertEqual(res_list.status_code, 200)
        keys = res_list.json()
        matching = [k for k in keys if k["id"] == key_id]
        self.assertEqual(len(matching), 1)
        # Verify secret_key is not exposed in list
        self.assertNotIn("secret_key", matching[0])
        self.assertEqual(matching[0]["alias"], "Test Peer Key Alpha")

        # 3. Update Inbound Key
        update_payload = {
            "alias": "Test Peer Key Alpha Renamed",
            "status": "suspended",
            "allowed_services": [1]
        }
        res_update = self.client.put(f"/api/peers/inbound-keys/{key_id}", json=update_payload)
        self.assertEqual(res_update.status_code, 200)
        updated = res_update.json()
        self.assertEqual(updated["alias"], "Test Peer Key Alpha Renamed")
        self.assertEqual(updated["status"], "suspended")
        self.assertEqual(updated["allowed_services"], [1])

        # 4. Delete Inbound Key
        res_del = self.client.delete(f"/api/peers/inbound-keys/{key_id}")
        self.assertEqual(res_del.status_code, 200)
        self.assertEqual(res_del.json()["detail"], "Inbound key deleted")

        # Verify deletion
        res_del2 = self.client.delete(f"/api/peers/inbound-keys/{key_id}")
        self.assertEqual(res_del2.status_code, 404)

    def test_peer_rpc_flow(self):
        # 1. Create Inbound Key in DB
        token_id, secret_key = PeerCrypto.generate_keypair()
        inbound_key = PeerInboundKey(
            alias="Test Peer Key RPC",
            token_id=token_id,
            secret_key=secret_key,
            allowed_services=None,
            status="active"
        )
        self.db.add(inbound_key)
        self.db.commit()

        # 2. Test missing X-Peer-Key-ID header -> 400
        res_missing_hdr = self.client.post("/api/peer-federation/v1/rpc", json={})
        self.assertEqual(res_missing_hdr.status_code, 400)

        # 3. Test unknown token ID -> 401
        headers_unknown = {"X-Peer-Key-ID": "fgp_k_nonexistent"}
        enc_dummy = PeerCrypto.encrypt_payload({"action": "DISCOVER_SERVICES"}, secret_key)
        res_unknown = self.client.post("/api/peer-federation/v1/rpc", json=enc_dummy, headers=headers_unknown)
        self.assertEqual(res_unknown.status_code, 401)

        # 4. Test valid RPC call: DISCOVER_SERVICES
        headers_valid = {"X-Peer-Key-ID": token_id}
        req_payload = {"action": "DISCOVER_SERVICES", "known_version": 0}
        enc_req = PeerCrypto.encrypt_payload(req_payload, secret_key)

        res_rpc = self.client.post("/api/peer-federation/v1/rpc", json=enc_req, headers=headers_valid)
        self.assertEqual(res_rpc.status_code, 200)
        res_body = res_rpc.json()
        self.assertIn("nonce", res_body)
        self.assertIn("ciphertext", res_body)

        # Decrypt response
        dec_res = PeerCrypto.decrypt_payload(res_body, secret_key)
        self.assertIn("status", dec_res)
        self.assertIn(dec_res["status"], ["CHANGED", "UNCHANGED"])

        # 5. Test suspended key rejection
        inbound_key.status = "suspended"
        self.db.commit()
        res_suspended = self.client.post("/api/peer-federation/v1/rpc", json=enc_req, headers=headers_valid)
        self.assertEqual(res_suspended.status_code, 401)

    def test_remote_nodes_crud_and_sync(self):
        # Generate token
        token_id, secret_key = PeerCrypto.generate_keypair()
        join_token = PeerCrypto.create_join_token(
            node_name="Remote Node Studio Beta",
            endpoint="http://192.168.20.10:8000",
            token_id=token_id,
            secret_key_b64=secret_key
        )

        # Mock requests.post so initial sync succeeds
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        dec_catalog = {
            "status": "CHANGED",
            "version": 1,
            "hash": "abc12345",
            "services": [{"id": 10, "name": "Remote Cam 1", "type": "ffmpeg_stream", "status": "running"}]
        }
        enc_catalog = PeerCrypto.encrypt_payload(dec_catalog, secret_key)
        mock_resp.json.return_value = enc_catalog

        with patch("requests.post", return_value=mock_resp):
            # 1. Create Remote Node
            create_payload = {
                "join_token": join_token,
                "name": "Test Remote Node 1"
            }
            res_create = self.client.post("/api/peers/remote-nodes", json=create_payload)
            self.assertEqual(res_create.status_code, 200)
            created = res_create.json()
            node_id = created["id"]
            self.assertEqual(created["name"], "Test Remote Node 1")
            self.assertEqual(created["status"], "online")
            self.assertEqual(created["catalog_version"], 1)
            self.assertEqual(len(created["cached_services_json"]), 1)

            # 2. Duplicate token creation fails with 400
            res_dup = self.client.post("/api/peers/remote-nodes", json=create_payload)
            self.assertEqual(res_dup.status_code, 400)

            # 3. List Remote Nodes
            res_list = self.client.get("/api/peers/remote-nodes")
            self.assertEqual(res_list.status_code, 200)
            nodes = res_list.json()
            self.assertTrue(any(n["id"] == node_id for n in nodes))

            # 4. Manual Sync Endpoint
            res_sync = self.client.post(f"/api/peers/remote-nodes/{node_id}/sync")
            self.assertEqual(res_sync.status_code, 200)
            synced = res_sync.json()
            self.assertEqual(synced["status"], "online")

            # 5. Delete Remote Node
            res_del = self.client.delete(f"/api/peers/remote-nodes/{node_id}")
            self.assertEqual(res_del.status_code, 200)
            self.assertEqual(res_del.json()["detail"], "Remote node deleted")

            # Verify deleted
            res_sync_after = self.client.post(f"/api/peers/remote-nodes/{node_id}/sync")
            self.assertEqual(res_sync_after.status_code, 404)

    def test_service_sharing_and_leasing_fields(self):
        # 1. Create service with peer sharing enabled
        svc_payload = {
            "name": "Federated Service Stream 1",
            "service_type": "ffmpeg_stream",
            "config": {
                "input_config": {"type": "lavfi", "path": "testsrc"},
                "output_config": {"type": "null", "path": "-"},
                "codec_config": {"vcodec": "libx264"}
            },
            "is_shared_with_peers": True,
            "allow_peer_lease": True
        }
        res_create = self.client.post("/api/services", json=svc_payload)
        self.assertEqual(res_create.status_code, 200)
        svc_data = res_create.json()
        svc_id = svc_data["id"]
        self.assertTrue(svc_data.get("is_shared_with_peers"))
        self.assertTrue(svc_data.get("allow_peer_lease"))

        # 2. List services and verify flags
        res_list = self.client.get("/api/services")
        self.assertEqual(res_list.status_code, 200)
        services = res_list.json()
        matching = [s for s in services if s["id"] == svc_id]
        self.assertEqual(len(matching), 1)
        self.assertTrue(matching[0]["is_shared_with_peers"])
        self.assertTrue(matching[0]["allow_peer_lease"])

        # 3. Update service to disable sharing
        update_payload = {
            "is_shared_with_peers": False,
            "allow_peer_lease": False
        }
        res_update = self.client.put(f"/api/services/{svc_id}", json=update_payload)
        self.assertEqual(res_update.status_code, 200)
        updated = res_update.json()
        self.assertFalse(updated.get("is_shared_with_peers"))
        self.assertFalse(updated.get("allow_peer_lease"))

        # Clean up
        res_del = self.client.delete(f"/api/services/{svc_id}")
        self.assertEqual(res_del.status_code, 200)

if __name__ == "__main__":
    unittest.main()
