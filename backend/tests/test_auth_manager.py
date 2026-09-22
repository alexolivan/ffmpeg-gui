import time
import pytest
from core.auth_manager import AuthManager


def test_session_token_creation_and_validation():
    auth = AuthManager()
    password = "MySecurePassword123!"
    
    token = auth.create_session(password)
    assert token is not None
    assert isinstance(token, str)
    assert len(token) > 20
    
    # Valid session with correct password
    assert auth.validate_session(token, password) is True


def test_session_token_invalid_password():
    auth = AuthManager()
    token = auth.create_session("PasswordOne")
    
    # Validating with different password (e.g. after password change or brute force)
    assert auth.validate_session(token, "PasswordTwo") is False


def test_session_token_tampered():
    auth = AuthManager()
    token = auth.create_session("PasswordOne")
    
    # Tampering with token
    tampered = token[:-4] + "xxxx"
    assert auth.validate_session(tampered, "PasswordOne") is False
    assert auth.validate_session("invalid.token.structure", "PasswordOne") is False
    assert auth.validate_session("", "PasswordOne") is False
    assert auth.validate_session(None, "PasswordOne") is False


def test_session_token_expired():
    auth = AuthManager()
    password = "PasswordOne"
    # Create token expired 1 second ago
    token = auth.create_session(password, expiry_seconds=-1)
    assert auth.validate_session(token, password) is False
