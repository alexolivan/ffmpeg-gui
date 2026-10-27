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
from typing import Any, Dict, Optional, Tuple

# Ensure backend directory is in sys.path
backend_dir = os.path.dirname(os.path.abspath(__file__))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

# Early check for custom config or database before DB engine initialization
for idx, arg in enumerate(sys.argv):
    if arg == "--database" and idx + 1 < len(sys.argv):
        os.environ["DATABASE_PATH"] = os.path.abspath(sys.argv[idx + 1])
    elif arg.startswith("--database="):
        os.environ["DATABASE_PATH"] = os.path.abspath(arg.split("=", 1)[1])
    elif arg == "--config" and idx + 1 < len(sys.argv):
        os.environ["CONFIG_FILE_PATH"] = os.path.abspath(sys.argv[idx + 1])
    elif arg.startswith("--config="):
        os.environ["CONFIG_FILE_PATH"] = os.path.abspath(arg.split("=", 1)[1])

from database.db import DB_PATH, SessionLocal, init_db
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


def check_service_active() -> Tuple[bool, Optional[str]]:
    """Checks whether ffmpeg-gui is currently active as system-wide or user service."""
    for unit_cmd in [
        ["systemctl", "is-active", "ffmpeg-gui.service"],
        ["systemctl", "--user", "is-active", "ffmpeg-gui.service"],
    ]:
        try:
            res = subprocess.run(unit_cmd, capture_output=True, text=True, timeout=2)
            if res.returncode == 0 and res.stdout.strip() == "active":
                return True, "system-wide" if "--user" not in unit_cmd else "user-service"
        except Exception:
            pass
    return False, None


def restart_service() -> bool:
    """Restarts ffmpeg-gui service if active."""
    is_active, s_type = check_service_active()
    if not is_active:
        return False
    cmd = ["systemctl", "restart", "ffmpeg-gui.service"]
    if s_type == "user-service":
        cmd = ["systemctl", "--user", "restart", "ffmpeg-gui.service"]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        return res.returncode == 0
    except Exception:
        return False


def update_config_file(
    bind_address: Optional[str] = None,
    port: Optional[int] = None,
    ssl_enabled: Optional[bool] = None,
) -> None:
    """Synchronizes network listen and SSL settings into ffmpeg-gui.conf."""
    root_dir = os.path.abspath(os.path.join(backend_dir, ".."))
    config_candidates = [
        os.environ.get("CONFIG_FILE_PATH"),
        "/etc/ffmpeg-gui/ffmpeg-gui.conf",
        os.path.expanduser("~/.config/ffmpeg-gui/ffmpeg-gui.conf"),
        os.path.join(root_dir, "ffmpeg-gui.conf"),
        "ffmpeg-gui.conf",
    ]
    config_path = "ffmpeg-gui.conf"
    for candidate in config_candidates:
        if candidate and os.path.exists(candidate):
            config_path = candidate
            break

    import configparser
    cp = configparser.ConfigParser()
    if os.path.exists(config_path):
        cp.read(config_path)

    if "network" not in cp:
        cp["network"] = {}
    if "server" not in cp:
        cp["server"] = {}

    if bind_address is not None:
        cp["network"]["bind_address"] = str(bind_address)
    if port is not None:
        cp["network"]["http_port"] = str(port)
        cp["server"]["port"] = str(port)
    if ssl_enabled is not None:
        cp["network"]["ssl_enabled"] = str(ssl_enabled).lower()
        if "ssl" in cp:
            cp["ssl"]["enabled"] = str(ssl_enabled).lower()
            if not ssl_enabled:
                cp["ssl"]["mode"] = "disabled"

    try:
        with open(config_path, "w") as f:
            cp.write(f)
    except Exception:
        pass


def read_network_config() -> Dict[str, Any]:
    """Reads network and SSL configuration from ffmpeg-gui.conf."""
    root_dir = os.path.abspath(os.path.join(backend_dir, ".."))
    config_candidates = [
        os.environ.get("CONFIG_FILE_PATH"),
        "/etc/ffmpeg-gui/ffmpeg-gui.conf",
        os.path.expanduser("~/.config/ffmpeg-gui/ffmpeg-gui.conf"),
        os.path.join(root_dir, "ffmpeg-gui.conf"),
        "ffmpeg-gui.conf",
    ]
    config_path = "ffmpeg-gui.conf"
    for candidate in config_candidates:
        if candidate and os.path.exists(candidate):
            config_path = candidate
            break

    res: Dict[str, Any] = {
        "bind_address": "0.0.0.0",
        "gui_port": 8000,
        "https_port": 8443,
        "ssl_enabled": False,
        "ssl_mode": "disabled",
        "config_path": config_path,
    }

    if os.path.exists(config_path):
        import configparser
        cp = configparser.ConfigParser()
        try:
            cp.read(config_path)
            if "server" in cp:
                res["bind_address"] = cp["server"].get("host", res["bind_address"])
                if cp["server"].get("port"):
                    try:
                        res["gui_port"] = cp["server"].getint("port")
                    except ValueError:
                        pass
            if "network" in cp:
                net = cp["network"]
                res["bind_address"] = net.get("bind_address", res["bind_address"])
                port_val = net.get("http_port") or net.get("gui_port")
                if port_val:
                    try:
                        res["gui_port"] = int(port_val)
                    except ValueError:
                        pass
                if net.get("https_port"):
                    try:
                        res["https_port"] = net.getint("https_port")
                    except ValueError:
                        pass
                if net.get("ssl_enabled"):
                    try:
                        res["ssl_enabled"] = net.getboolean("ssl_enabled")
                    except ValueError:
                        pass
            if "ssl" in cp:
                ssl_cfg = cp["ssl"]
                res["ssl_mode"] = ssl_cfg.get("mode", res["ssl_mode"])
                if "enabled" in ssl_cfg:
                    try:
                        res["ssl_enabled"] = ssl_cfg.getboolean("enabled")
                    except ValueError:
                        pass
        except Exception:
            pass

    return res


def handle_enroll_cloudhub(
    hub_url: str,
    token: str,
    disable_local_ssl: Optional[bool] = None,
    non_interactive: bool = False,
) -> bool:
    """Enrolls this appliance into a CloudHub orchestrator, with automated SSL conflict prevention."""
    try:
        from core.cloud_tunnel_client import CloudTunnelClient
    except ImportError:
        from backend.core.cloud_tunnel_client import CloudTunnelClient

    hub_url_clean = hub_url.strip().rstrip("/")
    token_clean = token.strip()

    # Check for local SSL / public bind conflict using config file
    net_cfg = read_network_config()
    has_ssl = bool(net_cfg["ssl_enabled"]) or (net_cfg["ssl_mode"] and net_cfg["ssl_mode"] != "disabled")
    is_public = net_cfg["bind_address"] not in ("127.0.0.1", "localhost", "::1")

    if has_ssl or is_public:
        if disable_local_ssl is None:
            if non_interactive:
                disable_local_ssl = True
            else:
                print("\n[!] Notice: This ffmpeg-gui node currently has local SSL enabled or is listening publicly.")
                print("    When paired with CloudHub on the same machine, disabling local SSL and binding")
                print("    to 127.0.0.1 avoids port 80/443 conflicts and secures backend communication.")
                try:
                    ans = input("    Disable local SSL and bind to 127.0.0.1? [Y/n]: ").strip().lower()
                    disable_local_ssl = ans in ("", "y", "yes")
                except (KeyboardInterrupt, EOFError):
                    print("\nAborted.")
                    return False

        if disable_local_ssl:
            print("[-] Disabling local SSL and moving bind address to 127.0.0.1...")
            update_config_file(bind_address="127.0.0.1", ssl_enabled=False)

    print(f"[*] Contacting CloudHub orchestrator at {hub_url_clean}...")
    try:
        client = CloudTunnelClient(asgi_app=None, db_session_factory=SessionLocal)
        enroll_res = client.enroll(hub_url_clean, token_clean)
        node_id = enroll_res.get("node_id", "unknown")
        print(f"✓ Success: Enrolled into CloudHub successfully as Node ID: {node_id}")
    except Exception as e:
        print(f"[-] Enrollment Error: {e}", file=sys.stderr)
        return False

    fix_db_permissions()

    # Check systemd status
    is_active, s_type = check_service_active()
    if is_active:
        print(f"[*] ffmpeg-gui service is currently running ({s_type}). Restarting service to establish tunnel...")
        if restart_service():
            print("✓ Service restarted. Reverse tunnel is now active.")
        else:
            print("[-] Note: Could not auto-restart systemd unit. Please run: sudo systemctl restart ffmpeg-gui")
    else:
        print("[*] ffmpeg-gui service is currently stopped.")
        print("    Configuration saved. The tunnel will connect automatically when ffmpeg-gui starts.")

    return True


def handle_unlink_cloudhub() -> bool:
    """Disconnects and unlinks this appliance from CloudHub."""
    try:
        from core.cloud_tunnel_client import CloudTunnelClient
    except ImportError:
        from backend.core.cloud_tunnel_client import CloudTunnelClient

    client = CloudTunnelClient(asgi_app=None, db_session_factory=SessionLocal)
    client.disconnect_hub()
    fix_db_permissions()
    print("✓ Success: Appliance unlinked and disconnected from CloudHub.")

    is_active, s_type = check_service_active()
    if is_active:
        print(f"[*] ffmpeg-gui service is running ({s_type}). Restarting to terminate tunnel...")
        if restart_service():
            print("✓ Service restarted.")
        else:
            print("[-] Please run: sudo systemctl restart ffmpeg-gui")
    return True


def handle_set_listen(
    bind_address: str,
    port: Optional[int] = None,
    disable_ssl: bool = False,
) -> bool:
    """Rescue command to configure listen address and port without Web UI access."""
    update_config_file(
        bind_address=bind_address,
        port=port,
        ssl_enabled=False if disable_ssl else None,
    )

    port_str = f":{port}" if port else ""
    ssl_str = " (SSL disabled)" if disable_ssl else ""
    print(f"✓ Success: Listen address set to {bind_address}{port_str}{ssl_str}")

    is_active, s_type = check_service_active()
    if is_active:
        print(f"[*] Restarting {s_type} service to apply network binding...")
        if restart_service():
            print("✓ Service restarted.")
        else:
            print("[-] Please run: sudo systemctl restart ffmpeg-gui")
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

    net_cfg = read_network_config()
    bind_address = net_cfg["bind_address"]
    gui_port = net_cfg["gui_port"]
    https_port = net_cfg["https_port"]
    ssl_enabled = net_cfg["ssl_enabled"]
    has_password = False
    cloudhub_enabled = False
    cloudhub_url = None
    cloudhub_node_id = None

    try:
        with SessionLocal() as db:
            settings = db.query(SystemSettings).first()
            if settings:
                has_password = bool(settings.gui_password)
                cloudhub_enabled = bool(settings.cloudhub_enabled)
                cloudhub_url = settings.cloudhub_url
                cloudhub_node_id = settings.cloudhub_node_id
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
        "cloudhub_enabled": cloudhub_enabled,
        "cloudhub_url": cloudhub_url,
        "cloudhub_node_id": cloudhub_node_id,
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
    ch_str = f"ENROLLED ({cloudhub_node_id} @ {cloudhub_url})" if cloudhub_enabled else "NOT ENROLLED"
    print(f" CloudHub Tunnel  : {ch_str}")
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
    parser.add_argument("--config", help="Explicit path to ffmpeg-gui.conf")
    parser.add_argument("--database", help="Explicit path to ffmpeg_gui.db SQLite database")
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

    # enroll-cloudhub
    p_enroll = subparsers.add_parser("enroll-cloudhub", help="Pair appliance with a central CloudHub orchestrator")
    p_enroll.add_argument("hub_url", help="CloudHub URL (e.g. http://127.0.0.1:9000 or https://hub.example.com)")
    p_enroll.add_argument("token", help="One-time enrollment token")
    p_enroll.add_argument("--disable-local-ssl", action="store_true", help="Disable local SSL and bind to 127.0.0.1")
    p_enroll.add_argument("-y", "--yes", action="store_true", help="Non-interactive mode (assume Yes to prompts)")

    # unlink-cloudhub
    subparsers.add_parser("unlink-cloudhub", help="Unlink appliance and terminate CloudHub reverse tunnel")

    # set-listen
    p_listen = subparsers.add_parser("set-listen", help="Rescue command to configure bind address and port")
    p_listen.add_argument("address", help="Bind IP address (e.g. 127.0.0.1 or 0.0.0.0)")
    p_listen.add_argument("port", nargs="?", type=int, default=None, help="HTTP listen port (optional)")
    p_listen.add_argument("--disable-ssl", action="store_true", help="Disable local SSL/TLS")

    args = parser.parse_args()

    # Ensure database schema is migrated and tables exist
    try:
        init_db()
    except Exception:
        pass

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
    elif args.command == "enroll-cloudhub":
        disable_ssl = True if args.disable_local_ssl else None
        success = handle_enroll_cloudhub(
            hub_url=args.hub_url,
            token=args.token,
            disable_local_ssl=disable_ssl,
            non_interactive=args.yes,
        )
        sys.exit(0 if success else 1)
    elif args.command == "unlink-cloudhub":
        success = handle_unlink_cloudhub()
        sys.exit(0 if success else 1)
    elif args.command == "set-listen":
        success = handle_set_listen(
            bind_address=args.address,
            port=args.port,
            disable_ssl=args.disable_ssl,
        )
        sys.exit(0 if success else 1)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
