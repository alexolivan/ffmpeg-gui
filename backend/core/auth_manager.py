import base64
import hashlib
import hmac
import logging
import os
import secrets
import time
from typing import Optional

logger = logging.getLogger("AuthManager")


class AuthManager:
    COOKIE_NAME: str = "gui_session"
    DEFAULT_EXPIRY_SECONDS: int = 7 * 86400  # 7 days

    def __init__(self, secret_key: Optional[str] = None):
        """
        Initializes AuthManager. If secret_key is not supplied, uses an environment variable
        or a persistent machine-level secret to ensure signatures are consistent across restarts.
        """
        if secret_key:
            self._secret_key = secret_key.encode("utf-8")
        else:
            env_secret = os.environ.get("FFMPEG_GUI_SECRET_KEY")
            if env_secret:
                self._secret_key = env_secret.encode("utf-8")
            else:
                # Persistent local secret fallback in data directory
                secret_path = os.path.join(os.path.dirname(__file__), "..", "data", ".auth_secret")
                secret_path = os.path.abspath(secret_path)
                os.makedirs(os.path.dirname(secret_path), exist_ok=True)
                if os.path.exists(secret_path):
                    try:
                        with open(secret_path, "r", encoding="utf-8") as f:
                            self._secret_key = f.read().strip().encode("utf-8")
                    except Exception as e:
                        logger.warning(f"Failed to read auth secret from {secret_path}: {e}")
                        self._secret_key = secrets.token_bytes(32)
                else:
                    new_secret = secrets.token_hex(32)
                    try:
                        with open(secret_path, "w", encoding="utf-8") as f:
                            f.write(new_secret)
                        self._secret_key = new_secret.encode("utf-8")
                    except Exception as e:
                        logger.warning(f"Failed to write auth secret to {secret_path}: {e}")
                        self._secret_key = new_secret.encode("utf-8")

    def _derive_key(self, current_password: str) -> bytes:
        """
        Derives an HMAC signing key combining the server's master secret and the current GUI password.
        This guarantees that if the password is changed, all previously issued tokens are automatically invalidated.
        """
        return hmac.new(self._secret_key, current_password.encode("utf-8"), hashlib.sha256).digest()

    def create_session(self, current_password: str, expiry_seconds: Optional[int] = None) -> str:
        """
        Creates a time-bound, cryptographically signed session token.
        Format: base64(payload).base64(signature)
        Payload: expires_at_timestamp:random_nonce
        """
        if expiry_seconds is None:
            expiry_seconds = self.DEFAULT_EXPIRY_SECONDS
        
        expires_at = int(time.time()) + expiry_seconds
        nonce = secrets.token_hex(8)
        payload_str = f"{expires_at}:{nonce}"
        payload_bytes = payload_str.encode("utf-8")
        
        signing_key = self._derive_key(current_password)
        signature = hmac.new(signing_key, payload_bytes, hashlib.sha256).digest()
        
        token = f"{base64.urlsafe_b64encode(payload_bytes).decode('ascii')}.{base64.urlsafe_b64encode(signature).decode('ascii')}"
        return token

    def validate_session(self, token: Optional[str], current_password: Optional[str]) -> bool:
        """
        Validates the session token against the current password and expiry timestamp.
        Returns True if valid and non-expired; False otherwise.
        """
        if not token or not current_password:
            return False
        
        parts = token.split(".")
        if len(parts) != 2:
            return False
        
        payload_b64, signature_b64 = parts
        try:
            payload_bytes = base64.urlsafe_b64decode(payload_b64.encode("ascii"))
            provided_signature = base64.urlsafe_b64decode(signature_b64.encode("ascii"))
            
            payload_str = payload_bytes.decode("utf-8")
            expires_at_str, _ = payload_str.split(":", 1)
            expires_at = int(expires_at_str)
            
            if time.time() > expires_at:
                return False
            
            signing_key = self._derive_key(current_password)
            expected_signature = hmac.new(signing_key, payload_bytes, hashlib.sha256).digest()
            
            return hmac.compare_digest(provided_signature, expected_signature)
        except Exception:
            return False

    def set_session_cookie(
        self,
        response,
        token: str,
        is_https: bool = False,
        max_age: Optional[int] = None
    ) -> None:
        """
        Sets the HttpOnly session cookie on the given FastAPI/Starlette Response.
        """
        if max_age is None:
            max_age = self.DEFAULT_EXPIRY_SECONDS
            
        response.set_cookie(
            key=self.COOKIE_NAME,
            value=token,
            max_age=max_age,
            path="/",
            httponly=True,
            samesite="lax",
            secure=is_https
        )

    def clear_session_cookie(self, response) -> None:
        """
        Deletes the session cookie on the given FastAPI/Starlette Response.
        """
        response.delete_cookie(
            key=self.COOKIE_NAME,
            path="/",
            httponly=True,
            samesite="lax"
        )


auth_manager = AuthManager()
