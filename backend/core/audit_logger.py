"""
Audit Logger: Dedicated, human-only operational change and lifecycle tracking.
Provides atomic dual-write to disk (single-line structured text) and SQLite,
with real-time WebSocket forwarding to CloudHub.
"""

import os
import json
import time
import datetime
import threading
import logging
from typing import Dict, Any, Optional, Tuple, List

from backend.database.db import SessionLocal
from backend.database.models import AuditLog

logger = logging.getLogger("ffmpeg_gui.audit")

SENSITIVE_KEYS = {
    "gui_password",
    "tunnel_secret",
    "secret_key",
    "password",
    "auth_token",
    "token",
}


def mask_sensitive_value(key: str, val: Any) -> Any:
    """Mask credentials and secrets in audit logs."""
    if any(s in key.lower() for s in SENSITIVE_KEYS):
        return "***"
    return val


def calculate_dict_delta(
    old_data: Optional[Dict[str, Any]],
    new_data: Optional[Dict[str, Any]],
    ignored_keys: Optional[List[str]] = None,
) -> Tuple[str, Dict[str, Any]]:
    """
    Compute concise semantic delta between two dictionary states.
    Returns:
        (human_readable_summary, structured_delta_dict)
    """
    old_dict = old_data or {}
    new_dict = new_data or {}
    ignored = set(ignored_keys or [])
    ignored.update({"updated_at", "last_seen", "created_at", "status", "pid", "id"})

    delta_dict: Dict[str, Dict[str, Any]] = {}
    summary_parts: List[str] = []

    all_keys = set(old_dict.keys()).union(new_dict.keys())

    for key in sorted(all_keys):
        if key in ignored:
            continue

        val_old = old_dict.get(key)
        val_new = new_dict.get(key)

        if val_old != val_new:
            # Mask if sensitive
            masked_old = mask_sensitive_value(key, val_old)
            masked_new = mask_sensitive_value(key, val_new)

            delta_dict[key] = {"old": masked_old, "new": masked_new}

            # Human friendly summary
            if val_old is None:
                summary_parts.append(f"{key}: set to {json.dumps(masked_new)}")
            elif val_new is None:
                summary_parts.append(f"{key}: removed")
            else:
                summary_parts.append(f"{key}: {json.dumps(masked_old)} -> {json.dumps(masked_new)}")

    summary_str = ", ".join(summary_parts) if summary_parts else "no configuration changes"
    return summary_str, delta_dict


class AuditLogger:
    """Singleton operational audit logger."""

    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super(AuditLogger, cls).__new__(cls)
                cls._instance._init_logger()
            return cls._instance

    def _init_logger(self):
        self._file_lock = threading.Lock()
        self._audit_log_path = self._resolve_log_path()

    def _resolve_log_path(self) -> str:
        """Resolve destination path for audit.log."""
        env_path = os.getenv("AUDIT_LOG_PATH")
        if env_path:
            target = os.path.abspath(env_path)
        else:
            access_log = os.getenv("ACCESS_LOG_PATH")
            if access_log:
                log_dir = os.path.dirname(os.path.abspath(access_log))
            else:
                log_dir = os.path.join(os.getcwd(), "data", "logs")
            target = os.path.join(log_dir, "audit.log")

        try:
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(target, "a", encoding="utf-8"):
                pass
        except Exception as e:
            logger.warning("Could not initialize audit.log at '%s': %s", target, e)
        return target

    def get_log_path(self) -> str:
        return self._audit_log_path

    def extract_actor_info(self, request: Optional[Any] = None) -> Dict[str, str]:
        """
        Extract actor identity and channel from FastAPI request.
        """
        if request is None:
            return {
                "channel": "local_cli",
                "username": "admin",
                "ip_address": "127.0.0.1",
            }

        headers = getattr(request, "headers", {})
        channel = headers.get("x-authenticated-channel")
        auth_user = headers.get("x-authenticated-user")

        if channel == "cloudhub" or auth_user:
            return {
                "channel": "cloudhub",
                "username": auth_user or "cloudhub_operator",
                "ip_address": "cloudhub-tunnel",
            }

        # Local direct web request
        from backend.main import get_real_client_ip
        client_ip = get_real_client_ip(request) if hasattr(request, "client") else "127.0.0.1"

        return {
            "channel": "local_gui",
            "username": "admin",
            "ip_address": client_ip,
        }

    def log(
        self,
        action: str,
        target_type: str,
        target_id: Optional[Any] = None,
        target_name: Optional[str] = None,
        channel: str = "local_gui",
        username: str = "admin",
        ip_address: Optional[str] = None,
        changes: Optional[str] = None,
        details: Optional[str] = None,
        structured_diff: Optional[Dict[str, Any]] = None,
    ) -> AuditLog:
        """
        Record an immutable audit event:
        1. Write single-line entry to disk (audit.log).
        2. Persist to SQLite table (audit_logs).
        3. Relay upstream to CloudHub via WebSocket tunnel if connected.
        """
        now = datetime.datetime.now(datetime.timezone.utc)
        iso_ts = now.isoformat()
        t_id_str = str(target_id) if target_id is not None else ""
        t_name_str = target_name or ""
        ip_str = ip_address or "127.0.0.1"
        changes_str = changes or ""
        details_str = details or ""

        # 1. Dual-Write: Disk Single-Line Text
        log_line = (
            f'{iso_ts} | [{channel.upper()}] {username} ({ip_str}) | '
            f'{action.upper()} {target_type}#{t_id_str} ("{t_name_str}") | '
            f'{changes_str or details_str}'
        ).strip()

        try:
            with self._file_lock:
                with open(self._audit_log_path, "a", encoding="utf-8") as f:
                    f.write(log_line + "\n")
        except Exception as file_err:
            logger.error("Failed to write to audit.log: %s", file_err)

        # 2. Dual-Write: Local SQLite Database
        db_entry = AuditLog(
            timestamp=now,
            channel=channel,
            username=username,
            ip_address=ip_str,
            action=action.upper(),
            target_type=target_type,
            target_id=t_id_str,
            target_name=t_name_str,
            changes=changes_str,
            details=details_str,
        )

        try:
            with SessionLocal() as session:
                session.add(db_entry)
                session.commit()
                session.refresh(db_entry)
        except Exception as db_err:
            logger.error("Failed to persist audit log to SQLite: %s", db_err)

        # 3. Stream to CloudHub reverse tunnel if connected
        try:
            from backend.core.cloud_tunnel_client import cloud_tunnel_client
            event_payload = {
                "timestamp": iso_ts,
                "channel": channel,
                "username": username,
                "ip_address": ip_str,
                "action": action.upper(),
                "target_type": target_type,
                "target_id": t_id_str,
                "target_name": t_name_str,
                "changes": changes_str,
                "details": details_str,
                "structured_diff": structured_diff,
            }
            cloud_tunnel_client.schedule_audit_event(event_payload)
        except Exception as relay_err:
            logger.debug("CloudHub audit relay error: %s", relay_err)

        return db_entry


audit_logger = AuditLogger()
