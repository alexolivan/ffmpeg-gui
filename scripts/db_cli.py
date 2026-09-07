#!/usr/bin/env python3
"""
FFMPEG-GUI Database CLI Helper

Utility to inspect and query the SQLite database across development,
user-space, and system-wide installations without requiring the system 'sqlite3' package.
"""

import argparse
import configparser
import os
import sqlite3
import sys
from typing import List, Optional, Tuple


def find_database_path(explicit_path: Optional[str] = None) -> str:
    """Resolves the SQLite database path by checking CLI args, environment, config files, and standard locations."""
    if explicit_path:
        return os.path.abspath(explicit_path)

    if os.environ.get("DATABASE_PATH"):
        return os.path.abspath(os.environ["DATABASE_PATH"])

    # Check known configuration files
    config_candidates = [
        os.environ.get("CONFIG_FILE_PATH"),
        "/etc/ffmpeg-gui/ffmpeg-gui.conf",
        os.path.expanduser("~/.config/ffmpeg-gui/ffmpeg-gui.conf"),
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ffmpeg-gui.conf"),
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend", "ffmpeg-gui.conf"),
        "ffmpeg-gui.conf",
    ]

    for conf in config_candidates:
        if conf and os.path.exists(conf):
            try:
                cp = configparser.ConfigParser()
                cp.read(conf)
                if cp.has_section("server") and cp.has_option("server", "database"):
                    db_val = cp.get("server", "database").strip()
                    if db_val:
                        return os.path.abspath(os.path.expanduser(db_val))
            except Exception:
                pass

    # Check standard filesystem paths
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    standard_paths = [
        "/var/lib/ffmpeg-gui/ffmpeg_gui.db",
        os.path.expanduser("~/.local/share/ffmpeg-gui/ffmpeg_gui.db"),
        os.path.join(repo_root, "backend", "ffmpeg_gui.db"),
        os.path.join(repo_root, "ffmpeg_gui.db"),
        "ffmpeg_gui.db",
    ]

    for p in standard_paths:
        if os.path.exists(p):
            return os.path.abspath(p)

    # Fallback default if not found
    return "/var/lib/ffmpeg-gui/ffmpeg_gui.db" if os.getuid() == 0 else os.path.join(repo_root, "backend", "ffmpeg_gui.db")


def format_table(headers: List[str], rows: List[Tuple]) -> str:
    """Formats rows into an aligned ASCII table."""
    if not headers and not rows:
        return "(empty result)"

    str_rows = [[str(col) if col is not None else "NULL" for col in row] for row in rows]
    col_widths = [len(h) for h in headers]
    for row in str_rows:
        for idx, col in enumerate(row):
            if idx < len(col_widths):
                col_widths[idx] = max(col_widths[idx], len(col))
            else:
                col_widths.append(len(col))

    header_line = " | ".join(h.ljust(col_widths[i]) for i, h in enumerate(headers))
    separator_line = "-+-".join("-" * col_widths[i] for i in range(len(col_widths)))
    row_lines = [
        " | ".join(c.ljust(col_widths[i]) for i, c in enumerate(row))
        for row in str_rows
    ]

    return "\n".join([header_line, separator_line] + row_lines)


def run_query(db_path: str, sql: str):
    """Executes a SQL statement and pretty prints the results."""
    if not os.path.exists(db_path):
        print(f"Error: Database file does not exist at '{db_path}'", file=sys.stderr)
        sys.exit(1)

    con = sqlite3.connect(db_path)
    cur = con.cursor()
    try:
        cur.execute(sql)
        if sql.strip().upper().startswith(("SELECT", "PRAGMA", "EXPLAIN")):
            headers = [desc[0] for desc in cur.description] if cur.description else []
            rows = cur.fetchall()
            print(format_table(headers, rows))
            print(f"\n({len(rows)} row{'s' if len(rows) != 1 else ''})")
        else:
            con.commit()
            print(f"Query executed successfully. Rows affected: {cur.rowcount}")
    except Exception as e:
        print(f"SQL Error: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        con.close()


def show_tables(db_path: str):
    """Lists all tables with their respective row counts."""
    con = sqlite3.connect(db_path)
    cur = con.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    tables = [r[0] for r in cur.fetchall()]

    rows = []
    for t in tables:
        try:
            cur.execute(f"SELECT count(*) FROM \"{t}\"")
            count = cur.fetchone()[0]
            rows.append((t, count))
        except Exception:
            rows.append((t, "err"))
    con.close()
    print(format_table(["Table Name", "Row Count"], rows))


def show_schema(db_path: str, table_name: Optional[str] = None):
    """Displays table schema."""
    con = sqlite3.connect(db_path)
    cur = con.cursor()
    if table_name:
        cur.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table_name,))
        row = cur.fetchone()
        if row and row[0]:
            print(row[0] + ";")
        else:
            print(f"Table '{table_name}' not found.", file=sys.stderr)
    else:
        cur.execute("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        rows = cur.fetchall()
        for name, sql in rows:
            if sql:
                print(f"-- Table: {name}\n{sql};\n")
    con.close()


def show_services(db_path: str):
    """Shows an overview of configured services and processes."""
    import json
    con = sqlite3.connect(db_path)
    cur = con.cursor()
    # Check if services or media_processes exists
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='services'")
    table = "services" if cur.fetchone() else "media_processes"

    # In services table, schema has service_type and config JSON (type, watchdog_enabled, auto_start are inside config)
    query = f"SELECT id, name, service_type, status, pid, restart_count, config FROM {table} ORDER BY id"
    try:
        cur.execute(query)
        rows = cur.fetchall()
        headers = ["id", "name", "service_type", "status", "pid", "restarts", "watchdog", "auto_start"]
        formatted_rows = []
        for r in rows:
            svc_id, name, svc_type, status, pid, restarts, raw_cfg = r
            cfg = {}
            if raw_cfg:
                try:
                    cfg = json.loads(raw_cfg) if isinstance(raw_cfg, str) else raw_cfg
                except Exception:
                    pass
            watchdog = "yes" if cfg.get("watchdog_enabled") else "no"
            auto_start = "yes" if cfg.get("auto_start") else "no"
            formatted_rows.append((
                svc_id,
                name,
                svc_type or "ffmpeg_stream",
                status or "stopped",
                pid if pid else "-",
                restarts if restarts is not None else 0,
                watchdog,
                auto_start
            ))
        print(format_table(headers, formatted_rows))
        print(f"\n({len(rows)} service{'s' if len(rows) != 1 else ''})")
    except Exception as e:
        print(f"Error fetching services: {e}", file=sys.stderr)
    finally:
        con.close()


def show_service_logs(db_path: str, service_id: int, limit: int = 25):
    """Fetches recent service or process logs for a given service ID from DB and disk log file."""
    con = sqlite3.connect(db_path)
    cur = con.cursor()

    # 1. Check database events (watchdog / crashes / circuit breaker)
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='service_logs'")
    table = "service_logs" if cur.fetchone() else "process_logs"
    col_id = "service_id" if table == "service_logs" else "process_id"

    db_rows = []
    try:
        cur.execute(f"SELECT timestamp, level, message FROM {table} WHERE {col_id}=? ORDER BY id DESC LIMIT ?", (service_id, limit))
        db_rows = cur.fetchall()
    except Exception as e:
        print(f"Notice: Error querying {table}: {e}", file=sys.stderr)

    if db_rows:
        print(f"--- DATABASE WATCHDOG / SYSTEM EVENTS ({table}) ---")
        headers = ["Timestamp", "Level", "Message"]
        print(format_table(headers, list(reversed(db_rows))))
        print()
    else:
        print(f"(No watchdog/crash events recorded in DB table '{table}' for service ID {service_id})")

    # 2. Check physical log file on disk
    log_candidates = []
    try:
        cur.execute("SELECT config FROM services WHERE id=?", (service_id,))
        s_row = cur.fetchone()
        if s_row and s_row[0]:
            import json
            cfg = json.loads(s_row[0]) if isinstance(s_row[0], str) else s_row[0]
            log_storage_id = cfg.get("log_storage_id")
            if log_storage_id:
                cur.execute("SELECT path FROM storages WHERE id=?", (log_storage_id,))
                st = cur.fetchone()
                if st and st[0]:
                    log_candidates.append(os.path.join(st[0], f"process_{service_id}.log"))
    except Exception:
        pass

    try:
        cur.execute("SELECT path FROM storages WHERE type='logs' ORDER BY is_default DESC")
        for row in cur.fetchall():
            if row[0]:
                log_candidates.append(os.path.join(row[0], f"process_{service_id}.log"))
    except Exception:
        pass
    con.close()

    log_candidates.extend([
        f"/var/log/ffmpeg-gui/process_{service_id}.log",
        f"/var/log/ffmpeg-gui/process_{service_id}s.log",
        os.path.expanduser(f"~/.local/share/ffmpeg-gui/logs/process_{service_id}.log"),
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "logs", f"process_{service_id}.log"),
        f"data/logs/process_{service_id}.log",
    ])

    existing_logs = [cand for cand in set(log_candidates) if cand and os.path.exists(cand)]
    if existing_logs:
        # Sort by mtime descending (most recently updated first)
        existing_logs.sort(key=lambda p: os.path.getmtime(p), reverse=True)
        found_log = existing_logs[0]
        if len(existing_logs) > 1:
            print(f"(Note: Found {len(existing_logs)} candidate log files on disk. Showing most recently modified: {found_log})")
    else:
        found_log = None

    if found_log:
        print(f"\n--- DISK CONSOLE LOG ({found_log}, last {limit} lines) ---")
        try:
            with open(found_log, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
            tail_lines = lines[-limit:] if len(lines) > limit else lines
            print("".join(tail_lines).rstrip())
        except Exception as read_err:
            print(f"Error reading log file {found_log}: {read_err}", file=sys.stderr)
    else:
        print(f"\n(No physical log file found on disk for process_{service_id}.log)")



def main():
    parser = argparse.ArgumentParser(
        description="FFMPEG-GUI Database CLI - Query and inspect SQLite without sqlite3 CLI binary.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Examples:
  ./scripts/db_cli.py --services
  ./scripts/db_cli.py --logs 7 -n 20
  ./scripts/db_cli.py --tables
  ./scripts/db_cli.py --schema services
  ./scripts/db_cli.py "SELECT id, name, status, pid FROM services"
  ./scripts/db_cli.py --db /path/to/ffmpeg_gui.db "SELECT count(*) FROM service_logs"
"""
    )
    parser.add_argument("query", nargs="?", help="SQL query to execute")
    parser.add_argument("-q", "--query-flag", dest="query_flag", help="SQL query to execute (alternative to positional argument)")
    parser.add_argument("--db", dest="db_path", help="Explicit path to SQLite database file")
    parser.add_argument("--tables", action="store_true", help="List all tables and row counts")
    parser.add_argument("--schema", nargs="?", const="", help="Show schema of all tables or a specific table")
    parser.add_argument("--services", action="store_true", help="List all services / processes with status and PID")
    parser.add_argument("--logs", type=int, metavar="SERVICE_ID", help="Show recent logs for a given service ID")
    parser.add_argument("-n", "--limit", type=int, default=25, help="Number of rows to limit for logs (default: 25)")
    parser.add_argument("--path-only", action="store_true", help="Print the resolved database path and exit")

    args = parser.parse_args()

    db_path = find_database_path(args.db_path)

    if args.path_only:
        print(db_path)
        return

    sql_query = args.query or args.query_flag

    if args.tables:
        print(f"Database: {db_path}\n")
        show_tables(db_path)
    elif args.schema is not None:
        print(f"Database: {db_path}\n")
        show_schema(db_path, args.schema if args.schema else None)
    elif args.services:
        print(f"Database: {db_path}\n")
        show_services(db_path)
    elif args.logs is not None:
        print(f"Database: {db_path}\n")
        show_service_logs(db_path, args.logs, limit=args.limit)
    elif sql_query:
        print(f"Database: {db_path}\n")
        run_query(db_path, sql_query)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
