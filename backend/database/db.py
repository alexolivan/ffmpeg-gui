from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from .models import Base
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.environ.get("DATABASE_PATH", os.path.join(BASE_DIR, "ffmpeg_gui.db"))
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def init_db():
    Base.metadata.create_all(bind=engine)
    import sqlite3
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(media_processes)")
        columns = [col[1] for col in cursor.fetchall()]
        
        if "auto_start" not in columns:
            cursor.execute("ALTER TABLE media_processes ADD COLUMN auto_start BOOLEAN DEFAULT 0")
        if "watchdog_enabled" not in columns:
            cursor.execute("ALTER TABLE media_processes ADD COLUMN watchdog_enabled BOOLEAN DEFAULT 0")
        if "watchdog_retries" not in columns:
            cursor.execute("ALTER TABLE media_processes ADD COLUMN watchdog_retries INTEGER DEFAULT 5")
        if "last_started_config" not in columns:
            cursor.execute("ALTER TABLE media_processes ADD COLUMN last_started_config JSON DEFAULT NULL")
        
        # Migración para la columna auto_clean en ffmpeg_builds
        cursor.execute("PRAGMA table_info(ffmpeg_builds)")
        build_columns = [col[1] for col in cursor.fetchall()]
        if "auto_clean" not in build_columns:
            cursor.execute("ALTER TABLE ffmpeg_builds ADD COLUMN auto_clean BOOLEAN DEFAULT 0")
            
        conn.commit()
    except Exception as e:
        print(f"Database migration failed: {e}")
    finally:
        conn.close()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
