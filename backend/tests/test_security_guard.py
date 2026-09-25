import time
import pytest
from core.security_guard import SecurityGuard, is_loopback, is_whitelisted


def test_is_loopback():
    assert is_loopback("127.0.0.1") is True
    assert is_loopback("127.0.0.2") is True
    assert is_loopback("127.255.255.254") is True
    assert is_loopback("::1") is True
    assert is_loopback("localhost") is True
    assert is_loopback("0.0.0.0") is True
    assert is_loopback("192.168.1.1") is False
    assert is_loopback("10.0.0.5") is False
    assert is_loopback("8.8.8.8") is False
    assert is_loopback("") is False


def test_is_whitelisted():
    whitelist = ["192.168.1.50", "10.0.0.0/24"]
    # Loopback is always whitelisted
    assert is_whitelisted("127.0.0.1", whitelist) is True
    assert is_whitelisted("localhost", whitelist) is True
    assert is_whitelisted("::1", whitelist) is True

    # Single IP match
    assert is_whitelisted("192.168.1.50", whitelist) is True
    assert is_whitelisted("192.168.1.51", whitelist) is False

    # CIDR match
    assert is_whitelisted("10.0.0.1", whitelist) is True
    assert is_whitelisted("10.0.0.254", whitelist) is True
    assert is_whitelisted("10.0.1.1", whitelist) is False


def test_security_guard_lockout_flow():
    guard = SecurityGuard()
    guard.configure(
        enabled=True,
        max_attempts=3,
        window_seconds=10,
        lockout_seconds=60,
        whitelist="192.168.1.99",
    )

    test_ip = "203.0.113.10"

    # Initially not blocked
    blocked, rem = guard.is_blocked(test_ip)
    assert blocked is False
    assert rem is None

    # Failure 1
    now_blocked, count, sec = guard.record_failure(test_ip)
    assert now_blocked is False
    assert count == 1
    assert sec is None
    assert guard.is_blocked(test_ip)[0] is False

    # Failure 2
    now_blocked, count, sec = guard.record_failure(test_ip)
    assert now_blocked is False
    assert count == 2
    assert guard.is_blocked(test_ip)[0] is False

    # Failure 3 -> triggers lockout
    now_blocked, count, sec = guard.record_failure(test_ip)
    assert now_blocked is True
    assert count == 3
    assert sec == 60

    # IP is now blocked
    blocked, rem = guard.is_blocked(test_ip)
    assert blocked is True
    assert rem is not None
    assert 50 <= rem <= 60

    # Status inspection
    status = guard.get_status()
    assert status["active_lockout_count"] == 1
    assert status["active_lockouts"][0]["ip"] == test_ip

    # Manual unblock
    assert guard.unblock(test_ip) is True
    assert guard.is_blocked(test_ip)[0] is False
    assert guard.get_status()["active_lockout_count"] == 0


def test_loopback_and_whitelist_immunity():
    guard = SecurityGuard()
    guard.configure(
        enabled=True,
        max_attempts=2,
        window_seconds=10,
        lockout_seconds=60,
        whitelist="192.168.1.99",
    )

    # Loopback attempts
    for _ in range(10):
        now_blocked, count, _ = guard.record_failure("127.0.0.1")
        assert now_blocked is False
        assert count == 0

    assert guard.is_blocked("127.0.0.1")[0] is False

    # Whitelisted IP attempts
    for _ in range(10):
        now_blocked, count, _ = guard.record_failure("192.168.1.99")
        assert now_blocked is False
        assert count == 0

    assert guard.is_blocked("192.168.1.99")[0] is False


def test_success_resets_failure_counter():
    guard = SecurityGuard()
    guard.configure(enabled=True, max_attempts=3, window_seconds=10, lockout_seconds=60)
    test_ip = "198.51.100.5"

    guard.record_failure(test_ip)
    guard.record_failure(test_ip)
    assert guard.is_blocked(test_ip)[0] is False

    # Password was correct
    guard.record_success(test_ip)

    # Next failure should be attempt 1 again, not attempt 3
    now_blocked, count, _ = guard.record_failure(test_ip)
    assert now_blocked is False
    assert count == 1


def test_lockout_expiration():
    guard = SecurityGuard()
    # 1 second lockout
    guard.configure(enabled=True, max_attempts=1, window_seconds=5, lockout_seconds=1)
    test_ip = "198.51.100.20"

    guard.record_failure(test_ip)
    assert guard.is_blocked(test_ip)[0] is True

    # Sleep past lockout expiration
    time.sleep(1.1)

    blocked, rem = guard.is_blocked(test_ip)
    assert blocked is False
    assert rem is None
