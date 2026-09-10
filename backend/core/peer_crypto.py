import os
import json
import time
import base64
import secrets
from typing import Tuple, Dict, Any, Optional
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

TOKEN_PREFIX = "FGPEER-"
MAX_SKEW_SECONDS_DEFAULT = 60

class PeerCrypto:
    @classmethod
    def generate_keypair(cls) -> Tuple[str, str]:
        """
        Generates a unique token_id (fgp_k_...) and a 256-bit symmetric AES-GCM key.
        Returns: (token_id: str, secret_key_b64: str)
        """
        token_id = f"fgp_k_{secrets.token_hex(8)}"
        raw_key = AESGCM.generate_key(bit_length=256)
        secret_key_b64 = base64.b64encode(raw_key).decode("utf-8")
        return token_id, secret_key_b64

    @classmethod
    def create_join_token(
        cls,
        node_name: str,
        endpoint: str,
        token_id: str,
        secret_key_b64: str,
        allowed_services: Optional[list] = None
    ) -> str:
        """
        Packages node connection details and secret key into a portable base64 string.
        Format: FGPEER-<base64url>
        """
        payload = {
            "v": 1,
            "name": node_name.strip(),
            "endpoint": endpoint.strip().rstrip("/"),
            "token_id": token_id.strip(),
            "secret_key": secret_key_b64.strip()
        }
        if allowed_services:
            payload["allowed_services"] = allowed_services
        json_bytes = json.dumps(payload, separators=(',', ':')).encode("utf-8")
        b64_str = base64.urlsafe_b64encode(json_bytes).decode("utf-8").rstrip("=")
        return f"{TOKEN_PREFIX}{b64_str}"

    @classmethod
    def parse_join_token(cls, token_str: str) -> Dict[str, Any]:
        """
        Validates and parses a join token string into its constituent parameters.
        """
        token_str = token_str.strip()
        if not token_str.startswith(TOKEN_PREFIX):
            raise ValueError(f"Invalid token prefix. Expected '{TOKEN_PREFIX}'")
        raw_b64 = token_str[len(TOKEN_PREFIX):]
        # Restore padding if needed
        rem = len(raw_b64) % 4
        if rem > 0:
            raw_b64 += "=" * (4 - rem)
        try:
            json_bytes = base64.urlsafe_b64decode(raw_b64.encode("utf-8"))
            data = json.loads(json_bytes.decode("utf-8"))
        except Exception as e:
            raise ValueError(f"Failed to decode token payload: {str(e)}")

        required = ["v", "name", "endpoint", "token_id", "secret_key"]
        for field in required:
            if field not in data:
                raise ValueError(f"Missing required token field '{field}'")
        return data

    @classmethod
    def encrypt_payload(
        cls,
        payload_dict: Dict[str, Any],
        secret_key_b64: str,
        timestamp: Optional[float] = None
    ) -> Dict[str, str]:
        """
        Encrypts a dictionary payload using AES-256-GCM.
        Embeds a timestamp for replay protection.
        """
        raw_key = base64.b64decode(secret_key_b64)
        aesgcm = AESGCM(raw_key)
        nonce = os.urandom(12)
        
        envelope = dict(payload_dict)
        envelope["timestamp"] = timestamp if timestamp is not None else time.time()
        
        plain_bytes = json.dumps(envelope, separators=(',', ':')).encode("utf-8")
        ciphertext_with_tag = aesgcm.encrypt(nonce, plain_bytes, None)
        
        return {
            "nonce": base64.b64encode(nonce).decode("utf-8"),
            "ciphertext": base64.b64encode(ciphertext_with_tag).decode("utf-8")
        }

    @classmethod
    def decrypt_payload(
        cls,
        encrypted_pkg: Dict[str, str],
        secret_key_b64: str,
        max_skew_seconds: int = MAX_SKEW_SECONDS_DEFAULT
    ) -> Dict[str, Any]:
        """
        Decrypts an AES-256-GCM package, checks authentication tag, and validates anti-replay timestamp window.
        """
        if "nonce" not in encrypted_pkg or "ciphertext" not in encrypted_pkg:
            raise ValueError("Invalid encrypted package format: missing nonce or ciphertext")

        try:
            raw_key = base64.b64decode(secret_key_b64)
            nonce = base64.b64decode(encrypted_pkg["nonce"])
            ciphertext_with_tag = base64.b64decode(encrypted_pkg["ciphertext"])
            aesgcm = AESGCM(raw_key)
            plain_bytes = aesgcm.decrypt(nonce, ciphertext_with_tag, None)
            envelope = json.loads(plain_bytes.decode("utf-8"))
        except Exception as e:
            raise ValueError(f"Decryption failed or invalid authentication tag: {str(e)}")

        ts = envelope.get("timestamp")
        if ts is None or abs(time.time() - ts) > max_skew_seconds:
            raise ValueError(f"Timestamp out of bounds (replay protection). Skew exceeds {max_skew_seconds}s")

        return envelope
