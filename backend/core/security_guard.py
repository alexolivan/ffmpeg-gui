import datetime
import ipaddress
import logging
import threading
import time
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger("FFMPEG-GUI.Security")


def is_loopback(ip_str: str) -> bool:
    """
    Determines if an IP address or hostname is a loopback address.
    Always immune to brute-force locking.
    """
    if not ip_str:
        return False
    ip_clean = ip_str.strip().lower()
    if ip_clean in ("localhost", "127.0.0.1", "::1", "0.0.0.0", "testclient"):
        return True
    try:
        ip = ipaddress.ip_address(ip_clean)
        return ip.is_loopback
    except ValueError:
        return False


def is_whitelisted(ip_str: str, whitelist_entries: List[str]) -> bool:
    """
    Checks if a client IP is immune to brute-force lockout, either via
    permanent loopback immunity or configured whitelist rules (single IPs or CIDRs).
    """
    if is_loopback(ip_str):
        return True

    if not whitelist_entries:
        return False

    try:
        client_obj = ipaddress.ip_address(ip_str.strip())
    except ValueError:
        return False

    for entry in whitelist_entries:
        entry_clean = entry.strip()
        if not entry_clean:
            continue
        try:
            if "/" in entry_clean:
                network = ipaddress.ip_network(entry_clean, strict=False)
                if client_obj in network:
                    return True
            else:
                target_obj = ipaddress.ip_address(entry_clean)
                if client_obj == target_obj:
                    return True
        except ValueError:
            continue

    return False


class SecurityGuard:
    """
    In-memory, thread-safe brute-force protection guard.
    Maintains failed login counters and lockout states in RAM without SQLite queries.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self.enabled: bool = True
        self.max_attempts: int = 5
        self.window_seconds: int = 300  # 5 minutes
        self.lockout_seconds: int = 900  # 15 minutes
        self.raw_whitelist: str = ""
        self._whitelist_entries: List[str] = []

        # In-memory RAM tracking
        self._failed_attempts: Dict[str, List[float]] = {}
        self._locked_out: Dict[str, float] = {}

    def configure(
        self,
        enabled: Optional[bool] = None,
        max_attempts: Optional[int] = None,
        window_seconds: Optional[int] = None,
        lockout_seconds: Optional[int] = None,
        whitelist: Optional[str] = None,
    ) -> None:
        """
        Reconfigures guard parameters at runtime without server restart.
        """
        with self._lock:
            if enabled is not None:
                self.enabled = bool(enabled)
            if max_attempts is not None and max_attempts > 0:
                self.max_attempts = int(max_attempts)
            if window_seconds is not None and window_seconds > 0:
                self.window_seconds = int(window_seconds)
            if lockout_seconds is not None and lockout_seconds > 0:
                self.lockout_seconds = int(lockout_seconds)
            if whitelist is not None:
                self.raw_whitelist = whitelist
                # Parse comma or newline separated entries
                entries: List[str] = []
                for chunk in whitelist.replace("\n", ",").split(","):
                    item = chunk.strip()
                    if item:
                        entries.append(item)
                self._whitelist_entries = entries

    def is_blocked(self, client_ip: str) -> Tuple[bool, Optional[int]]:
        """
        Fast O(1) in-memory check to see if an IP is currently locked out.
        Returns (is_blocked, remaining_lockout_seconds).
        """
        if not self.enabled:
            return False, None

        if is_whitelisted(client_ip, self._whitelist_entries):
            return False, None

        now = time.time()
        with self._lock:
            expiry = self._locked_out.get(client_ip)
            if expiry is not None:
                if now < expiry:
                    remaining = int(expiry - now) + 1
                    return True, remaining
                else:
                    # Expired ban
                    self._locked_out.pop(client_ip, None)
                    self._failed_attempts.pop(client_ip, None)

        return False, None

    def record_failure(self, client_ip: str) -> Tuple[bool, int, Optional[int]]:
        """
        Records a failed authentication attempt in RAM.
        Returns (is_now_blocked, attempt_count, lockout_seconds).
        """
        if not self.enabled or is_whitelisted(client_ip, self._whitelist_entries):
            return False, 0, None

        now = time.time()
        with self._lock:
            # Clean expired lockouts and prune old attempt window
            self._cleanup_stale_records(now)

            attempts = self._failed_attempts.get(client_ip, [])
            # Retain attempts within the observation window
            valid_attempts = [ts for ts in attempts if now - ts <= self.window_seconds]
            valid_attempts.append(now)
            self._failed_attempts[client_ip] = valid_attempts

            count = len(valid_attempts)
            if count >= self.max_attempts:
                # Lockout triggered
                self._locked_out[client_ip] = now + self.lockout_seconds
                self._failed_attempts.pop(client_ip, None)
                return True, count, self.lockout_seconds

            return False, count, None

    def record_success(self, client_ip: str) -> None:
        """
        Clears failed attempt history upon successful authentication.
        """
        with self._lock:
            self._failed_attempts.pop(client_ip, None)

    def unblock(self, client_ip: str) -> bool:
        """
        Manually clears lockout for an IP address.
        """
        with self._lock:
            was_locked = client_ip in self._locked_out or client_ip in self._failed_attempts
            self._locked_out.pop(client_ip, None)
            self._failed_attempts.pop(client_ip, None)
            return was_locked

    def get_status(self) -> Dict:
        """
        Returns real-time status and active lockouts for administrative inspection.
        """
        now = time.time()
        with self._lock:
            self._cleanup_stale_records(now)
            active_lockouts = []
            for ip, expiry in self._locked_out.items():
                if expiry > now:
                    remaining = int(expiry - now)
                    expires_at_iso = datetime.datetime.fromtimestamp(
                        expiry, tz=datetime.timezone.utc
                    ).isoformat()
                    active_lockouts.append(
                        {
                            "ip": ip,
                            "remaining_seconds": remaining,
                            "expires_at": expires_at_iso,
                        }
                    )

            return {
                "enabled": self.enabled,
                "max_attempts": self.max_attempts,
                "window_seconds": self.window_seconds,
                "lockout_seconds": self.lockout_seconds,
                "whitelist": self.raw_whitelist,
                "active_lockouts": active_lockouts,
                "active_lockout_count": len(active_lockouts),
            }

    def _cleanup_stale_records(self, now: float) -> None:
        """
        Internal prune of expired lockouts and stale attempt timestamps.
        Must be called within self._lock.
        """
        # Prune expired lockouts
        expired_ips = [ip for ip, exp in self._locked_out.items() if now >= exp]
        for ip in expired_ips:
            del self._locked_out[ip]

        # Prune stale attempt windows
        stale_ips = []
        for ip, attempts in self._failed_attempts.items():
            valid = [ts for ts in attempts if now - ts <= self.window_seconds]
            if not valid:
                stale_ips.append(ip)
            else:
                self._failed_attempts[ip] = valid
        for ip in stale_ips:
            del self._failed_attempts[ip]


# Singleton instance
security_guard = SecurityGuard()
