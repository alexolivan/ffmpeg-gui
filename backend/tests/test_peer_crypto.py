import unittest
import time
from core.peer_crypto import PeerCrypto

class TestPeerCrypto(unittest.TestCase):
    def test_key_generation_and_token_packaging(self):
        token_id, secret_key_b64 = PeerCrypto.generate_keypair()
        self.assertTrue(token_id.startswith("fgp_k_"))
        self.assertEqual(len(token_id), 22) # fgp_k_ + 16 chars
        
        # Test token creation
        token_str = PeerCrypto.create_join_token(
            node_name="VPS1-Hub",
            endpoint="http://10.8.0.1:8000",
            token_id=token_id,
            secret_key_b64=secret_key_b64
        )
        self.assertTrue(token_str.startswith("FGPEER-"))
        
        # Test token parsing
        parsed = PeerCrypto.parse_join_token(token_str)
        self.assertEqual(parsed["v"], 1)
        self.assertEqual(parsed["name"], "VPS1-Hub")
        self.assertEqual(parsed["endpoint"], "http://10.8.0.1:8000")
        self.assertEqual(parsed["token_id"], token_id)
        self.assertEqual(parsed["secret_key"], secret_key_b64)

    def test_encrypt_decrypt_roundtrip(self):
        token_id, secret_key_b64 = PeerCrypto.generate_keypair()
        payload = {
            "action": "DISCOVER_SERVICES",
            "known_version": 4,
            "data": {"foo": "bar"}
        }
        
        encrypted_pkg = PeerCrypto.encrypt_payload(payload, secret_key_b64)
        self.assertIn("nonce", encrypted_pkg)
        self.assertIn("ciphertext", encrypted_pkg)
        
        decrypted = PeerCrypto.decrypt_payload(encrypted_pkg, secret_key_b64)
        self.assertEqual(decrypted["action"], "DISCOVER_SERVICES")
        self.assertEqual(decrypted["known_version"], 4)
        self.assertEqual(decrypted["data"]["foo"], "bar")
        self.assertIn("timestamp", decrypted)

    def test_tamper_detection(self):
        token_id, secret_key_b64 = PeerCrypto.generate_keypair()
        payload = {"action": "PING"}
        pkg = PeerCrypto.encrypt_payload(payload, secret_key_b64)
        
        # Tamper with ciphertext
        import base64
        raw = base64.b64decode(pkg["ciphertext"])
        tampered_raw = bytearray(raw)
        tampered_raw[0] ^= 0xFF
        pkg["ciphertext"] = base64.b64encode(tampered_raw).decode("utf-8")
        
        with self.assertRaises(ValueError):
            PeerCrypto.decrypt_payload(pkg, secret_key_b64)

    def test_wrong_key_rejection(self):
        _, key1 = PeerCrypto.generate_keypair()
        _, key2 = PeerCrypto.generate_keypair()
        pkg = PeerCrypto.encrypt_payload({"hello": "world"}, key1)
        with self.assertRaises(ValueError):
            PeerCrypto.decrypt_payload(pkg, key2)

    def test_replay_window_expiration(self):
        _, key = PeerCrypto.generate_keypair()
        payload = {"action": "HEARTBEAT"}
        pkg = PeerCrypto.encrypt_payload(payload, key, timestamp=time.time() - 120)
        with self.assertRaises(ValueError) as ctx:
            PeerCrypto.decrypt_payload(pkg, key, max_skew_seconds=60)
        self.assertIn("Timestamp out of bounds", str(ctx.exception))

if __name__ == "__main__":
    unittest.main()
