#!/usr/bin/env python3
"""
FFMPEG-GUI Administration & Rescue CLI
Emergency command-line tool for password reset, security guard lockout recovery,
and quick system diagnostics.
"""

import argparse
import getpass
import json
import os
import subprocess
import sys
from typing import Any, Dict, Optional

# Ensure backend directory is in sys.path
backend_dir = os.path.dirname(os.path.abspath(__file__))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from database.db import DB_PATH, SessionLocal
from database.models import SystemSettings
from database.version import __schema_version__
from version import __version__


def get_git_info() -> Dict[str, str]:
    """Retrieves current git branch and HEAD commit."""
    root_dir = os.path.abspath(os.path.join(backend_dir, ".."))
    branch = "unknown"
    commit = "unknown"
    try:
        branch = subprocess.check_output(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=root_dir,
            stderr=subprocess.DEVNULL,
        ).decode().strip()
        commit = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=root_dir,
            stderr=subprocess.DEVNULL,
        ).decode().strip()
    except Exception:
        pass
    return {"branch": branch, "commit": commit}


def fix_db_permissions() -> None:
    """Safeguard: If executed under sudo, restore DB ownership to normal user."""
    if os.geteuid() == 0 and "SUDO_UID" in os.environ and os.path.exists(DB_PATH):
        try:
            uid = int(os.environ["SUDO_UID"])
            gid = int(os.environ.get("SUDO_GID", uid))
            os.chown(DB_PATH, uid, gid)
        except Exception:
            pass


def handle_reset_password(password: Optional[str] = None) -> bool:
    """Sets a new web administrator password."""
    if not password:
        try:
            p1 = getpass.getpass("Enter new admin password: ")
            p2 = getpass.getpass("Confirm new admin password: ")
            if p1 != p2:
                print("Error: Passwords do not match.", file=sys.stderr)
                return False
            password = p1
        except (KeyboardInterrupt, EOFError):
            print("\nAborted.")
            return False

    password = password.strip()
    if len(password) < 6:
        print("Error: Password must be at least 6 characters long.", file=sys.stderr)
        return False

    with SessionLocal() as db:
        settings = db.query(SystemSettings).first()
        if not settings:
            settings = SystemSettings()
            db.add(settings)
        settings.gui_password = password
        db.commit()

    fix_db_permissions()
    print("✓ Success: Administrator password has been updated successfully.")
    return True


def handle_clear_password() -> bool:
    """Clears the admin password, switching panel to open access mode."""
    with SessionLocal() as db:
        settings = db.query(SystemSettings).first()
        if not settings:
            settings = SystemSettings()
            db.add(settings)
        settings.gui_password = None
        db.commit()

    fix_db_permissions()
    print("✓ Success: Administrator password removed. Web GUI is now in open access mode.")
    return True


def handle_unlock_ips() -> bool:
    """
    Clears all temporary IP lockouts in the SecurityGuard.
    If the systemd service or background daemon is running, sends a warm reload signal (SIGHUP)
    to reset the in-memory guard without dropping active streaming processes.
    """
    # 1. Reset in-process guard if available
    try:
        from core.security_guard import security_guard
        security_guard.reset_all()
    except Exception:
        pass

    # 2. If systemd service is active, trigger warm reload (preserves active streams)
    reloaded = False
    try:
        res = subprocess.run(
            ["systemctl", "is-active", "ffmpeg-gui.service"],
            capture_output=True,
            text=True,
            timeout=2,
        )
        if res.stdout.strip() == "active":
            reload_res = subprocess.run(
                ["systemctl", "reload", "ffmpeg-gui.service"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if reload_res.returncode == 0:
                reloaded = True
    except Exception:
        pass

    # 3. Fallback: try user service if system-wide service was not active
    if not reloaded:
        try:
            res_user = subprocess.run(
                ["systemctl", "--user", "is-active", "ffmpeg-gui.service"],
                capture_output=True,
                text=True,
                timeout=2,
            )
            if res_user.stdout.strip() == "active":
                reload_res = subprocess.run(
                    ["systemctl", "--user", "reload", "ffmpeg-gui.service"],
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                if reload_res.returncode == 0:
                    reloaded = True
        except Exception:
            pass

    # 4. Fallback: try pkill -HUP on run_server.py
    if not reloaded:
        try:
            subprocess.run(
                ["pkill", "-HUP", "-f", "backend/run_server.py"],
                capture_output=True,
                timeout=2,
            )
        except Exception:
            pass

    print("✓ Success: All temporary IP lockouts have been reset.")
    return True


def handle_status(as_json: bool = False) -> Dict[str, Any]:
    """Queries and displays overall system health and configuration."""
    git_info = get_git_info()

    # Query systemd status
    service_active = False
    service_unit = "inactive"
    for unit_cmd in [
        ["systemctl", "is-active", "ffmpeg-gui.service"],
        ["systemctl", "--user", "is-active", "ffmpeg-gui.service"],
    ]:
        try:
            res = subprocess.run(unit_cmd, capture_output=True, text=True, timeout=2)
            if res.returncode == 0 and res.stdout.strip() == "active":
                service_active = True
                service_unit = "system-wide" if "--user" not in unit_cmd else "user-service"
                break
        except Exception:
            pass

    # Query database settings
    db_size = 0
    if os.path.exists(DB_PATH):
        db_size = os.path.getsize(DB_PATH)

    bind_address = "0.0.0.0"
    gui_port = 8000
    https_port = 8443
    ssl_enabled = False
    has_password = False

    try:
        with SessionLocal() as db:
            settings = db.query(SystemSettings).first()
            if settings:
                bind_address = settings.bind_address or "0.0.0.0"
                gui_port = settings.gui_port or settings.http_port or 8000
                https_port = settings.https_port or 8443
                ssl_enabled = bool(settings.ssl_enabled)
                has_password = bool(settings.gui_password)
    except Exception:
        pass

    info = {
        "version": __version__,
        "schema_version": __schema_version__,
        "git_branch": git_info["branch"],
        "git_commit": git_info["commit"],
        "service_active": service_active,
        "service_unit": service_unit,
        "database_path": DB_PATH,
        "database_size_bytes": db_size,
        "bind_address": bind_address,
        "http_port": gui_port,
        "https_port": https_port,
        "ssl_enabled": ssl_enabled,
        "has_password": has_password,
    }

    if as_json:
        print(json.dumps(info, indent=2))
        return info

    print("=================================================================")
    print("                     FFMPEG-GUI SYSTEM STATUS                    ")
    print("=================================================================")
    print(f" Software Version : v{info['version']} (Schema: v{info['schema_version']})")
    print(f" Git State        : {info['git_branch']} @ {info['git_commit']}")
    svc_status_str = f"ACTIVE ({info['service_unit']})" if service_active else "INACTIVE / STOPPED"
    print(f" System Service   : {svc_status_str}")
    print(f" Database Path    : {info['database_path']} ({info['database_size_bytes'] / 1024:.1f} KB)")
    print(f" Listen Address   : {info['bind_address']}")
    print(f" HTTP Port        : {info['http_port']}")
    if ssl_enabled:
        print(f" HTTPS Port       : {info['https_port']} (SSL Enabled)")
    auth_str = "ENABLED (Password Protected)" if has_password else "DISABLED (Open Access Mode)"
    print(f" Web GUI Auth     : {auth_str}")
    print("=================================================================")

    return info


def main():
    parser = argparse.ArgumentParser(
        description="FFMPEG-GUI Administration & Rescue CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Examples:
  ffmpeg-gui-admin status
  ffmpeg-gui-admin reset-admin (or reset-password)
  ffmpeg-gui-admin reset-lockout (or unlock-ips)
  ffmpeg-gui-admin clear-admin (or clear-password)
  ffmpeg-gui-admin reset-all
""",
    )
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # reset-password / reset-admin
    p_reset = subparsers.add_parser(
        "reset-password",
        aliases=["reset-admin"],
        help="Update admin password",
    )
    p_reset.add_argument("password", nargs="?", default=None, help="New admin password (prompts if omitted)")

    # clear-password / clear-admin
    subparsers.add_parser(
        "clear-password",
        aliases=["clear-admin"],
        help="Remove admin password (open access)",
    )

    # unlock-ips / reset-lockout
    subparsers.add_parser(
        "unlock-ips",
        aliases=["reset-lockout"],
        help="Clear all temporary IP lockouts in SecurityGuard",
    )

    # reset-all
    p_all = subparsers.add_parser(
        "reset-all",
        help="Reset IP lockouts and update admin password in a single step",
    )
    p_all.add_argument("password", nargs="?", default=None, help="New admin password (prompts if omitted)")

    # status
    p_status = subparsers.add_parser("status", help="Inspect system health, versions, and ports")
    p_status.add_argument("--json", action="store_true", help="Output status in JSON format")

    args = parser.parse_args()

    if not args.command or args.command == "status":
        handle_status(as_json=getattr(args, "json", False))
    elif args.command in ("reset-password", "reset-admin"):
        success = handle_reset_password(args.password)
        sys.exit(0 if success else 1)
    elif args.command in ("clear-password", "clear-admin"):
        success = handle_clear_password()
        sys.exit(0 if success else 1)
    elif args.command in ("unlock-ips", "reset-lockout"):
        success = handle_unlock_ips()
        sys.exit(0 if success else 1)
    elif args.command == "reset-all":
        print("--- Step 1: Clearing IP lockouts ---")
        s1 = handle_unlock_ips()
        print("--- Step 2: Setting Admin Password ---")
        s2 = handle_reset_password(args.password)
        sys.exit(0 if (s1 and s2) else 1)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
