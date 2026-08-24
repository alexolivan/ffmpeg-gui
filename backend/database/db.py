import logging
import os

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from .models import Base
from .version import __schema_version__

logger = logging.getLogger("database")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.environ.get("DATABASE_PATH", os.path.join(BASE_DIR, "ffmpeg_gui.db"))
DATABASE_URL = f"sqlite:///{DB_PATH}"
PREVIEWS_DIR = os.environ.get("PREVIEWS_DIR", "/tmp/ffmpeg-gui-previews")

engine = create_engine(
    DATABASE_URL, connect_args={"check_same_thread": False, "timeout": 10}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def init_db():
    try:
        Base.metadata.create_all(bind=engine)
        with engine.begin() as conn:
            # 1. Migrate media_processes to services if it exists
            result = conn.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name='media_processes'"))
            if result.fetchone():
                logger.info("Migrating media_processes table to services table...")
                
                # Fetch all columns info
                cols_result = conn.execute(text("PRAGMA table_info(media_processes)"))
                col_names = [r[1] for r in cols_result.fetchall()]
                
                # Fetch all processes
                procs = conn.execute(text("SELECT * FROM media_processes")).fetchall()
                
                import json
                for p in procs:
                    row_dict = dict(zip(col_names, p))
                    
                    def parse_json(val):
                        if isinstance(val, (dict, list)):
                            return val
                        if val:
                            try:
                                return json.loads(val)
                            except Exception:
                                pass
                        return {}
                        
                    config_data = {
                        "input_config": parse_json(row_dict.get("input_config")),
                        "output_config": parse_json(row_dict.get("output_config")),
                        "codec_config": parse_json(row_dict.get("codec_config")),
                        "filter_config": parse_json(row_dict.get("filter_config")),
                        "ffmpeg_build_id": row_dict.get("ffmpeg_build_id"),
                        "network_timeout": row_dict.get("network_timeout", 15),
                        "debug_mode": bool(row_dict.get("debug_mode", False)),
                        "log_storage_id": row_dict.get("log_storage_id"),
                        "auto_start": bool(row_dict.get("auto_start", False)),
                        "startup_order": row_dict.get("startup_order", 1),
                        "startup_delay": row_dict.get("startup_delay", 0),
                        "watchdog_enabled": bool(row_dict.get("watchdog_enabled", False)),
                        "watchdog_retries": row_dict.get("watchdog_retries", 5),
                        "watchdog_min_speed": row_dict.get("watchdog_min_speed"),
                        "watchdog_min_speed_duration": row_dict.get("watchdog_min_speed_duration", 30)
                    }
                    
                    conn.execute(
                        text("""
                            INSERT INTO services (
                                id, name, service_type, config, is_active, status, pid,
                                last_start, last_stop, cpu_usage, ram_usage, restart_count,
                                last_started_config, bitrate, fps, speed, alias, created_at
                            ) VALUES (
                                :id, :name, :service_type, :config, :is_active, :status, :pid,
                                :last_start, :last_stop, :cpu_usage, :ram_usage, :restart_count,
                                :last_started_config, :bitrate, :fps, :speed, :alias, :created_at
                            )
                        """),
                        {
                            "id": row_dict.get("id"),
                            "name": row_dict.get("name"),
                            "service_type": "ffmpeg_stream",
                            "config": json.dumps(config_data),
                            "is_active": True,
                            "status": row_dict.get("status", "stopped"),
                            "pid": row_dict.get("pid"),
                            "last_start": row_dict.get("last_start"),
                            "last_stop": row_dict.get("last_stop"),
                            "cpu_usage": row_dict.get("cpu_usage", 0),
                            "ram_usage": row_dict.get("ram_usage", 0),
                            "restart_count": row_dict.get("restart_count", 0),
                            "last_started_config": json.dumps(parse_json(row_dict.get("last_started_config"))) if row_dict.get("last_started_config") else None,
                            "bitrate": row_dict.get("bitrate"),
                            "fps": row_dict.get("fps"),
                            "speed": row_dict.get("speed"),
                            "alias": row_dict.get("alias"),
                            "created_at": row_dict.get("created_at")
                        }
                    )
                
                # Check and migrate process_logs to service_logs
                res_logs = conn.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name='process_logs'"))
                if res_logs.fetchone():
                    logger.info("Migrating process_logs to service_logs...")
                    conn.execute(text("""
                        INSERT INTO service_logs (id, service_id, timestamp, level, message)
                        SELECT id, process_id, timestamp, level, message FROM process_logs
                    """))
                    conn.execute(text("DROP TABLE process_logs"))
                
                # Drop media_processes table
                logger.info("Dropping media_processes table...")
                conn.execute(text("DROP TABLE media_processes"))
                
            # Migración para la tabla scheduled_tasks
            result = conn.execute(text("PRAGMA table_info(scheduled_tasks)"))
            task_columns = [row[1] for row in result.fetchall()]
            if "alias" not in task_columns:
                conn.execute(text("ALTER TABLE scheduled_tasks ADD COLUMN alias TEXT DEFAULT NULL"))
            if "is_system" not in task_columns:
                conn.execute(text("ALTER TABLE scheduled_tasks ADD COLUMN is_system BOOLEAN DEFAULT 0"))
            if "command" not in task_columns:
                conn.execute(text("ALTER TABLE scheduled_tasks ADD COLUMN command TEXT DEFAULT NULL"))
            
            # Migración para la columna auto_clean en software_builds
            result = conn.execute(text("PRAGMA table_info(software_builds)"))
            build_columns = [row[1] for row in result.fetchall()]
            if "auto_clean" not in build_columns:
                conn.execute(text("ALTER TABLE software_builds ADD COLUMN auto_clean BOOLEAN DEFAULT 0"))
            if "storage_id" not in build_columns:
                conn.execute(text("ALTER TABLE software_builds ADD COLUMN storage_id INTEGER REFERENCES storages(id) NULL"))

            # Migración para reemplazar UNIQUE(name) por UNIQUE(name, software_type) en software_builds
            result = conn.execute(text("SELECT sql FROM sqlite_master WHERE type='table' AND name='software_builds'"))
            table_sql_row = result.fetchone()
            if table_sql_row and table_sql_row[0]:
                table_sql = table_sql_row[0]
                if "UNIQUE (name)" in table_sql or "name VARCHAR NOT NULL UNIQUE" in table_sql or "name TEXT NOT NULL UNIQUE" in table_sql or "UNIQUE(name)" in table_sql:
                    logger.info("Migrating software_builds to remove single-column UNIQUE(name) constraint...")
                    conn.execute(text("""
                        CREATE TABLE software_builds_mig_tmp (
                            id INTEGER PRIMARY KEY,
                            name VARCHAR NOT NULL,
                            software_type VARCHAR DEFAULT 'ffmpeg' NOT NULL,
                            version_tag VARCHAR NOT NULL,
                            binary_path VARCHAR,
                            build_options JSON NOT NULL,
                            sdk_paths JSON,
                            install_path VARCHAR NOT NULL,
                            status VARCHAR DEFAULT 'pending',
                            is_default BOOLEAN DEFAULT 0,
                            sources_cleaned BOOLEAN DEFAULT 0,
                            auto_clean BOOLEAN DEFAULT 0,
                            disk_usage_mb INTEGER,
                            build_log_summary VARCHAR,
                            version_output VARCHAR,
                            created_at DATETIME,
                            built_at DATETIME,
                            storage_id INTEGER REFERENCES storages(id)
                        )
                    """))
                    conn.execute(text("""
                        INSERT INTO software_builds_mig_tmp (
                            id, name, software_type, version_tag, binary_path,
                            build_options, sdk_paths, install_path, status,
                            is_default, sources_cleaned, auto_clean,
                            disk_usage_mb, build_log_summary, version_output,
                            created_at, built_at, storage_id
                        )
                        SELECT
                            id, name, software_type, version_tag, binary_path,
                            build_options, sdk_paths, install_path, status,
                            is_default, sources_cleaned, auto_clean,
                            disk_usage_mb, build_log_summary, version_output,
                            created_at, built_at, storage_id
                        FROM software_builds
                    """))
                    conn.execute(text("DROP TABLE software_builds"))
                    conn.execute(text("ALTER TABLE software_builds_mig_tmp RENAME TO software_builds"))
            
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_software_builds_name_type ON software_builds(name, software_type)"))
                
            # Migración para la tabla system_settings
            result = conn.execute(text("PRAGMA table_info(system_settings)"))
            settings_columns = [row[1] for row in result.fetchall()]
            if "lcd_alias" not in settings_columns:
                conn.execute(text("ALTER TABLE system_settings ADD COLUMN lcd_alias TEXT DEFAULT 'NODE-01'"))
            if "lcd_enabled" not in settings_columns:
                conn.execute(text("ALTER TABLE system_settings ADD COLUMN lcd_enabled BOOLEAN DEFAULT 0"))
            if "lcd_port" not in settings_columns:
                conn.execute(text("ALTER TABLE system_settings ADD COLUMN lcd_port TEXT DEFAULT '/dev/ttyACM0'"))
            if "lcd_model" not in settings_columns:
                conn.execute(text("ALTER TABLE system_settings ADD COLUMN lcd_model TEXT DEFAULT 'cfa635'"))
            if "lcd_brightness" not in settings_columns:
                conn.execute(text("ALTER TABLE system_settings ADD COLUMN lcd_brightness INTEGER DEFAULT 100"))
            if "lcd_dim_brightness" not in settings_columns:
                conn.execute(text("ALTER TABLE system_settings ADD COLUMN lcd_dim_brightness INTEGER DEFAULT 20"))
            if "lcd_dim_timeout" not in settings_columns:
                conn.execute(text("ALTER TABLE system_settings ADD COLUMN lcd_dim_timeout INTEGER DEFAULT 30"))
            if "lcd_led0_profile" not in settings_columns:
                conn.execute(text("ALTER TABLE system_settings ADD COLUMN lcd_led0_profile TEXT DEFAULT 'heartbeat'"))
            if "lcd_led1_profile" not in settings_columns:
                conn.execute(text("ALTER TABLE system_settings ADD COLUMN lcd_led1_profile TEXT DEFAULT 'streams'"))
            if "lcd_led2_profile" not in settings_columns:
                conn.execute(text("ALTER TABLE system_settings ADD COLUMN lcd_led2_profile TEXT DEFAULT 'tasks'"))
            if "lcd_led3_profile" not in settings_columns:
                conn.execute(text("ALTER TABLE system_settings ADD COLUMN lcd_led3_profile TEXT DEFAULT 'alert'"))

            # Verify/insert schema version
            result = conn.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_info'"))
            if result.fetchone():
                res_ver = conn.execute(text("SELECT version FROM schema_info ORDER BY id DESC LIMIT 1"))
                row = res_ver.fetchone()
                if not row:
                    conn.execute(
                        text("INSERT INTO schema_info (version, applied_at) VALUES (:version, datetime('now'))"),
                        {"version": __schema_version__}
                    )
                else:
                    db_version = row[0]
                    if db_version != __schema_version__:
                        conn.execute(
                            text("INSERT INTO schema_info (version, applied_at) VALUES (:version, datetime('now'))"),
                            {"version": __schema_version__}
                        )
        
        # Seed default storages if the table is empty
        from database.models import Storage
        db = SessionLocal()
        try:
            if db.query(Storage).count() == 0:
                default_storages = [
                    Storage(
                        name="Default Build Storage",
                        path=os.path.abspath("ffmpeg_builds"),
                        type="build",
                        is_default=True
                    ),
                    Storage(
                        name="Default Media Storage",
                        path=os.path.abspath("data/uploads"),
                        type="media",
                        is_default=True
                    ),
                    Storage(
                        name="Default SDK Storage",
                        path=os.path.abspath("data/sdks"),
                        type="sdk",
                        is_default=True
                    ),
                    Storage(
                        name="Default Preview Storage",
                        path=os.path.abspath("/tmp/ffmpeg-gui-previews"),
                        type="preview",
                        is_default=True
                    ),
                    Storage(
                        name="Default Logs Storage",
                        path=os.path.abspath("data/logs"),
                        type="logs",
                        is_default=True
                    )
                ]
                db.add_all(default_storages)
                db.commit()
            else:
                # Ensure Default Logs Storage is seeded if logs type storages are missing
                if db.query(Storage).filter(Storage.type == "logs").count() == 0:
                    db.add(Storage(
                        name="Default Logs Storage",
                        path=os.path.abspath("data/logs"),
                        type="logs",
                        is_default=True
                    ))
                    db.commit()

            # Seed system log rotation task if missing
            from database.models import ScheduledTask
            from utils.cron_helper import CronHelper
            log_rotate_task = db.query(ScheduledTask).filter(ScheduledTask.command == "system://log_rotate").first()
            if not log_rotate_task:
                is_active = False
                config_path = os.environ.get("CONFIG_FILE_PATH")
                if config_path and os.path.exists(config_path):
                    try:
                        import configparser
                        config = configparser.ConfigParser()
                        config.read(config_path)
                        if "logging" in config:
                            mode = config["logging"].get("mode", "journalctl")
                            is_active = (mode in ("file", "both"))
                    except Exception:
                        pass
                
                task = ScheduledTask(
                    name="System Log Rotation and Retention Cleanup",
                    command="system://log_rotate",
                    is_system=True,
                    is_active=is_active,
                    schedule_type="recurring",
                    schedule_cron="0 0 * * *",
                    next_run=CronHelper.get_next_run("0 0 * * *") if is_active else None,
                    input_config={},
                    output_config={},
                    codec_config={}
                )
                db.add(task)
                db.commit()

            # Seed & normalize System Task #2: SSL Auto-Renewal Routine
            ssl_renew_task = db.query(ScheduledTask).filter(ScheduledTask.command == "system://ssl_renew").first()
            is_ssl_acme = False
            config_path = os.environ.get("CONFIG_FILE_PATH")
            if config_path and os.path.exists(config_path):
                try:
                    import configparser
                    from services.cert_manager import CertificateManager
                    config = configparser.ConfigParser()
                    config.read(config_path)
                    cert_mgr = CertificateManager()
                    cert_status = cert_mgr.get_cert_status()
                    if "ssl" in config:
                        mode = config["ssl"].get("mode", "disabled")
                        is_ssl_acme = (mode == "acme" and cert_status.get("valid", False) and cert_status.get("mode") == "acme")
                except Exception:
                    pass

            if not ssl_renew_task:
                ssl_task = ScheduledTask(
                    name="System SSL/TLS Certificate Auto-Renewal Routine",
                    command="system://ssl_renew",
                    is_system=True,
                    is_active=is_ssl_acme,
                    schedule_type="recurring",
                    schedule_cron="0 3 * * *",
                    next_run=CronHelper.get_next_run("0 3 * * *") if is_ssl_acme else None,
                    input_config={},
                    output_config={},
                    codec_config={}
                )
                db.add(ssl_task)
                db.commit()
            else:
                if ssl_renew_task.is_active != is_ssl_acme:
                    ssl_renew_task.is_active = is_ssl_acme
                    ssl_renew_task.next_run = CronHelper.get_next_run("0 3 * * *") if is_ssl_acme else None
                    db.commit()

            # Seed pre-existing SDKs on disk if not registered in InstalledSdk
            from database.models import InstalledSdk
            default_sdk_storage = db.query(Storage).filter(Storage.type == "sdk", Storage.is_default == True).first()
            sdk_base_path = default_sdk_storage.path if default_sdk_storage else os.path.abspath("data/sdks")
            if os.path.exists(sdk_base_path):
                for sdk_type in ["decklink", "ndi"]:
                    type_dir = os.path.join(sdk_base_path, sdk_type)
                    if os.path.exists(type_dir) and os.path.isdir(type_dir):
                        for version in os.listdir(type_dir):
                            version_path = os.path.join(type_dir, version)
                            if not os.path.isdir(version_path):
                                continue
                            existing = db.query(InstalledSdk).filter(
                                InstalledSdk.target_app == "ffmpeg",
                                InstalledSdk.sdk_type == sdk_type,
                                InstalledSdk.version == version
                            ).first()
                            if not existing:
                                total_bytes = 0
                                for root_d, _, files in os.walk(version_path):
                                    for f in files:
                                        try:
                                            total_bytes += os.path.getsize(os.path.join(root_d, f))
                                        except OSError:
                                            pass
                                name = f"Blackmagic DeckLink SDK v{version}" if sdk_type == "decklink" else f"NewTek NDI SDK v{version}"
                                new_sdk = InstalledSdk(
                                    target_app="ffmpeg",
                                    sdk_type=sdk_type,
                                    name=name,
                                    version=version,
                                    storage_id=default_sdk_storage.id if default_sdk_storage else None,
                                    relative_path=os.path.join(sdk_type, version),
                                    size_bytes=total_bytes,
                                    status="ready"
                                )
                                db.add(new_sdk)
                                logger.info(f"Seeded pre-existing disk SDK: {sdk_type} v{version}")
                db.commit()
        finally:
            db.close()
    except Exception as e:
        logger.exception(f"Database initialization failed: {e}")
        raise e

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
