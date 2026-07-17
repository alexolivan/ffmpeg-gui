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
            # Query media_processes columns using SQLAlchemy connection execution
            result = conn.execute(text("PRAGMA table_info(media_processes)"))
            columns = [row[1] for row in result.fetchall()]
            
            if "auto_start" not in columns:
                conn.execute(text("ALTER TABLE media_processes ADD COLUMN auto_start BOOLEAN DEFAULT 0"))
            if "watchdog_enabled" not in columns:
                conn.execute(text("ALTER TABLE media_processes ADD COLUMN watchdog_enabled BOOLEAN DEFAULT 0"))
            if "watchdog_retries" not in columns:
                conn.execute(text("ALTER TABLE media_processes ADD COLUMN watchdog_retries INTEGER DEFAULT 5"))
            if "last_started_config" not in columns:
                conn.execute(text("ALTER TABLE media_processes ADD COLUMN last_started_config JSON DEFAULT NULL"))
            if "alias" not in columns:
                conn.execute(text("ALTER TABLE media_processes ADD COLUMN alias TEXT DEFAULT NULL"))
            if "restart_count" not in columns:
                conn.execute(text("ALTER TABLE media_processes ADD COLUMN restart_count INTEGER DEFAULT 0"))
            if "network_timeout" not in columns:
                conn.execute(text("ALTER TABLE media_processes ADD COLUMN network_timeout INTEGER DEFAULT 15"))
            if "debug_mode" not in columns:
                conn.execute(text("ALTER TABLE media_processes ADD COLUMN debug_mode BOOLEAN DEFAULT 0"))
            if "log_storage_id" not in columns:
                conn.execute(text("ALTER TABLE media_processes ADD COLUMN log_storage_id INTEGER REFERENCES storages(id)"))
                
            # Migración para la tabla scheduled_tasks
            result = conn.execute(text("PRAGMA table_info(scheduled_tasks)"))
            task_columns = [row[1] for row in result.fetchall()]
            if "alias" not in task_columns:
                conn.execute(text("ALTER TABLE scheduled_tasks ADD COLUMN alias TEXT DEFAULT NULL"))
            if "is_system" not in task_columns:
                conn.execute(text("ALTER TABLE scheduled_tasks ADD COLUMN is_system BOOLEAN DEFAULT 0"))
            if "command" not in task_columns:
                conn.execute(text("ALTER TABLE scheduled_tasks ADD COLUMN command TEXT DEFAULT NULL"))
            
            # Migración para la columna auto_clean en ffmpeg_builds
            result = conn.execute(text("PRAGMA table_info(ffmpeg_builds)"))
            build_columns = [row[1] for row in result.fetchall()]
            if "auto_clean" not in build_columns:
                conn.execute(text("ALTER TABLE ffmpeg_builds ADD COLUMN auto_clean BOOLEAN DEFAULT 0"))
            if "storage_id" not in build_columns:
                conn.execute(text("ALTER TABLE ffmpeg_builds ADD COLUMN storage_id INTEGER REFERENCES storages(id) NULL"))
                
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
                task = ScheduledTask(
                    name="System Log Rotation and Retention Cleanup",
                    command="system://log_rotate",
                    is_system=True,
                    is_active=True,
                    schedule_type="recurring",
                    schedule_cron="0 0 * * *",
                    next_run=CronHelper.get_next_run("0 0 * * *"),
                    input_config={},
                    output_config={},
                    codec_config={}
                )
                db.add(task)
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
