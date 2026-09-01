from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File, Form, Request, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
import re
import json
import copy
import shutil
import uuid
import shlex
import platform
import configparser
import threading
from PIL import Image
from fastapi.responses import StreamingResponse, FileResponse, HTMLResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel, validator
from typing import List, Optional, Dict, Any
from database.db import init_db, get_db, SessionLocal
from database.models import FfmpegBuild, Service as MediaProcess, ServiceLog as ProcessLog, ScheduledTask, TaskExecution, TaskExecutionLog, Storage
from core.process_manager import ProcessManager
from core.preview_manager import PreviewManager
from core.build_manager import BuildManager
from core.sdk_manager import SdkManager
from core.patch_manager import PatchManager
from core.notification_manager import NotificationManager
notification_manager = NotificationManager()
from core.alsa_manager import alsa_manager
try:
    from core.decklink_manager import DecklinkManager
except ImportError:
    from backend.core.decklink_manager import DecklinkManager
decklink_manager = DecklinkManager()
try:
    from core.magewell_manager import MagewellManager
except ImportError:
    from backend.core.magewell_manager import MagewellManager
magewell_manager = MagewellManager()
try:
    from core.software_manager import software_manager
except ImportError:
    from backend.core.software_manager import software_manager
from utils.gpu_sensor import GPUSensor
from utils.alsa_v4l2_helper import get_v4l2_devices, get_alsa_devices, get_v4l2_formats, get_alsa_playback_devices
import psutil
import logging
import asyncio
import datetime
from fastapi import BackgroundTasks
from utils.process_utils import cleanup_rogue_processes, prepare_process_file_permissions
from version import __version__ as backend_version
from database.version import __schema_version__ as schema_version

SUPPORTED_LANGUAGES = ['en', 'es', 'ca']

import time

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("FFMPEG-GUI")

# Disable uvicorn's raw access logger to prevent duplicate access logs (handled by NginxAccessLogMiddleware)
uv_access = logging.getLogger("uvicorn.access")
uv_access.handlers.clear()
uv_access.addHandler(logging.NullHandler())
uv_access.propagate = False
uv_access.disabled = True

class NginxAccessLogMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        status_code = [200]
        content_length = ["-"]

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                status_code[0] = message["status"]
                headers = message.get("headers", [])
                for key, val in headers:
                    if key.lower() == b"content-length":
                        content_length[0] = val.decode("utf-8")
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            client = scope.get("client")
            client_host = client[0] if client else "-"
            remote_user = "-"
            
            now = datetime.datetime.now(datetime.timezone.utc)
            time_local = now.strftime("%d/%b/%Y:%H:%M:%S +0000")
            
            method = scope.get("method", "-")
            path = scope.get("path", "-")
            query_string = scope.get("query_string", b"").decode("utf-8")
            if query_string:
                path = f"{path}?{query_string}"
                
            http_version = scope.get("http_version", "1.1")
            request_line = f"{method} {path} HTTP/{http_version}"
            
            headers = scope.get("headers", [])
            referer = "-"
            user_agent = "-"
            for key, val in headers:
                if key.lower() == b"referer":
                    referer = val.decode("utf-8")
                elif key.lower() == b"user-agent":
                    user_agent = val.decode("utf-8")
            
            access_log_path = os.getenv("ACCESS_LOG_PATH")
            if access_log_path:
                try:
                    nginx_line = f'{client_host} - {remote_user} [{time_local}] "{request_line}" {status_code[0]} {content_length[0]} "{referer}" "{user_agent}"'
                    with open(access_log_path, "a") as f:
                        f.write(nginx_line + "\n")
                except Exception:
                    pass
            else:
                console_msg = f'HTTP {request_line} -> {status_code[0]} ({client_host})'
                logger.info(console_msg)

app = FastAPI(title="FFMPEG Orchestrator API")

is_reload_mode: bool = False
_startup_lock = threading.Lock()
_startup_initialized = False
_shutdown_lock = threading.Lock()
_shutdown_initialized = False

def set_reload_mode(val: bool = True):
    global is_reload_mode
    is_reload_mode = val

app.add_middleware(NginxAccessLogMiddleware)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize DB
init_db()

UPLOAD_DIR = "data/uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# Initialize Managers
process_manager = ProcessManager(db_session_factory=SessionLocal)
preview_manager = PreviewManager()
build_manager = BuildManager(builds_root="./ffmpeg_builds")
sdk_manager = SdkManager(workspace_root=".")
patch_manager = PatchManager(workspace_root=".")

from core.dependency_manager import dependency_manager
dependency_manager.db_session_factory = SessionLocal
dependency_manager.process_manager = process_manager

from core.task_manager import TaskManager
from core.scheduler import Scheduler
from utils.cron_helper import CronHelper

task_manager = TaskManager(db_session_factory=SessionLocal, process_manager=process_manager)
scheduler = Scheduler(db_session_factory=SessionLocal, task_manager=task_manager)


# ── Pydantic Schemas ──────────────────────────────────────────────

class BuildCreate(BaseModel):
    name: str
    ffmpeg_version: str
    srt_version: Optional[str] = None
    build_options: dict
    sdk_paths: Optional[dict] = None
    auto_clean: Optional[bool] = False
    storage_id: Optional[int] = None
    software_type: Optional[str] = "ffmpeg"

class BuildUpdate(BaseModel):
    name: Optional[str] = None
    ffmpeg_version: Optional[str] = None
    srt_version: Optional[str] = None
    build_options: Optional[dict] = None
    sdk_paths: Optional[dict] = None
    auto_clean: Optional[bool] = None
    storage_id: Optional[int] = None
    software_type: Optional[str] = None

class ProcessCreate(BaseModel):
    name: str
    type: str = "service"
    service_type: Optional[str] = "ffmpeg_stream"
    config: Optional[dict] = None
    input_config: Optional[dict] = None
    output_config: Optional[dict] = None
    codec_config: Optional[dict] = None
    filter_config: Optional[dict] = None
    ffmpeg_build_id: Optional[int] = None
    auto_start: Optional[bool] = False
    startup_order: Optional[int] = 1
    startup_delay: Optional[int] = 0
    watchdog_enabled: Optional[bool] = False
    watchdog_retries: Optional[int] = 5
    watchdog_min_speed: Optional[float] = None
    watchdog_min_speed_duration: Optional[int] = 30
    alias: Optional[str] = None
    network_timeout: Optional[int] = 15
    debug_mode: Optional[bool] = False
    log_storage_id: Optional[int] = None

    @validator('alias')
    def validate_alias(cls, v):
        if v is None:
            return v
        v = v.strip()
        if not v:
            return None
        if len(v) > 12:
            raise ValueError("Alias must be 12 characters or less")
        import re
        if not re.match(r"^[a-zA-Z0-9\s\-_]+$", v):
            raise ValueError("Alias must contain only alphanumeric characters, spaces, dashes, or underscores")
        return v

class ProcessUpdate(BaseModel):
    name: Optional[str] = None
    service_type: Optional[str] = None
    config: Optional[dict] = None
    input_config: Optional[dict] = None
    output_config: Optional[dict] = None
    codec_config: Optional[dict] = None
    filter_config: Optional[dict] = None
    ffmpeg_build_id: Optional[int] = None
    auto_start: Optional[bool] = None
    startup_order: Optional[int] = None
    startup_delay: Optional[int] = None
    watchdog_enabled: Optional[bool] = None
    watchdog_retries: Optional[int] = None
    watchdog_min_speed: Optional[float] = None
    watchdog_min_speed_duration: Optional[int] = None
    alias: Optional[str] = None
    network_timeout: Optional[int] = None
    debug_mode: Optional[bool] = None
    log_storage_id: Optional[int] = None

    @validator('alias')
    def validate_alias(cls, v):
        if v is None:
            return v
        v = v.strip()
        if not v:
            return None
        if len(v) > 12:
            raise ValueError("Alias must be 12 characters or less")
        import re
        if not re.match(r"^[a-zA-Z0-9\s\-_]+$", v):
            raise ValueError("Alias must contain only alphanumeric characters, spaces, dashes, or underscores")
        return v

class ServiceCreate(BaseModel):
    name: str
    service_type: str
    config: dict
    is_active: Optional[bool] = True
    alias: Optional[str] = None

    @validator('alias')
    def validate_alias(cls, v):
        if v is None:
            return v
        v = v.strip()
        if not v:
            return None
        if len(v) > 12:
            raise ValueError("Alias must be 12 characters or less")
        import re
        if not re.match(r"^[a-zA-Z0-9\s\-_]+$", v):
            raise ValueError("Alias must contain only alphanumeric characters, spaces, dashes, or underscores")
        return v

class ServiceUpdate(BaseModel):
    name: Optional[str] = None
    service_type: Optional[str] = None
    config: Optional[dict] = None
    is_active: Optional[bool] = None
    alias: Optional[str] = None

    @validator('alias')
    def validate_alias(cls, v):
        if v is None:
            return v
        v = v.strip()
        if not v:
            return None
        if len(v) > 12:
            raise ValueError("Alias must be 12 characters or less")
        import re
        if not re.match(r"^[a-zA-Z0-9\s\-_]+$", v):
            raise ValueError("Alias must contain only alphanumeric characters, spaces, dashes, or underscores")
        return v

class NotificationSettings(BaseModel):
    enabled: bool = False
    smtp_host: str = "localhost"
    smtp_port: int = 587
    smtp_encryption: str = "tls"
    smtp_user: str = ""
    smtp_password: Optional[str] = ""
    sender_email: str = ""
    recipient_email: str = ""
    notify_service_failures: bool = True
    notify_build_results: bool = True
    notify_task_failures: bool = True
    notify_ssl_alerts: bool = True
    notify_storage_alerts: bool = True

class BackupExportRequest(BaseModel):
    gui_general: bool = True
    gui_network_ssl: bool = True
    lcd_display: bool = True
    logging_retention: bool = True
    watchdog_grace: bool = True
    services: bool = True
    tasks: bool = True
    storage_volumes: bool = True
    notifications: bool = True

class BackupImportPayload(BaseModel):
    app: str
    version: str
    exported_at: Optional[str] = None
    sections: dict

class NotificationSettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_encryption: Optional[str] = None
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None
    sender_email: Optional[str] = None
    recipient_email: Optional[str] = None
    notify_service_failures: Optional[bool] = None
    notify_build_results: Optional[bool] = None
    notify_task_failures: Optional[bool] = None
    notify_ssl_alerts: Optional[bool] = None
    notify_storage_alerts: Optional[bool] = None

class WatchdogSettings(BaseModel):
    startup_grace_delay: int = 10
    network_wait_timeout: int = 60
    watchdog_max_backoff: int = 30

class WatchdogSettingsUpdate(BaseModel):
    startup_grace_delay: Optional[int] = None
    network_wait_timeout: Optional[int] = None
    watchdog_max_backoff: Optional[int] = None

class SettingsResponse(BaseModel):
    id: Optional[int] = None
    node_name: Optional[str] = None
    gui_password: Optional[str] = None
    logo_text: Optional[str] = None
    logo_path: Optional[str] = None
    accent_color: Optional[str] = None
    lcd_enabled: Optional[bool] = None
    lcd_alias: Optional[str] = None
    lcd_port: Optional[str] = None
    lcd_model: Optional[str] = None
    lcd_brightness: Optional[int] = None
    lcd_dim_brightness: Optional[int] = None
    lcd_dim_timeout: Optional[int] = None
    lcd_led0_profile: Optional[str] = None
    lcd_led1_profile: Optional[str] = None
    lcd_led2_profile: Optional[str] = None
    lcd_led3_profile: Optional[str] = None
    gui_port: Optional[int] = None
    restart_required: Optional[bool] = False
    restart_reasons: List[str] = []
    logging_mode: Optional[str] = None
    logging_storage_id: Optional[int] = None
    logging_relative_path: Optional[str] = None
    logging_rotation_enabled: Optional[bool] = None
    logging_rotation_max_bytes: Optional[int] = None
    logging_rotation_backup_count: Optional[int] = None
    logging_compression_enabled: Optional[bool] = None
    logging_retention_days: Optional[int] = None
    logging_timestamp_tz: Optional[str] = "utc"
    language: str = "en"
    theme: str = "studio-dark"
    bind_address: Optional[str] = "0.0.0.0"
    http_port: Optional[int] = 8080
    https_port: Optional[int] = 8443
    ssl_enabled: Optional[bool] = False
    force_https_redirect: Optional[bool] = False
    ssl_mode: Optional[str] = "disabled"
    ssl_domain: Optional[str] = None
    ssl_email: Optional[str] = None
    ssl_challenge_type: Optional[str] = "http-01"
    ssl_auto_renew: Optional[bool] = True
    auto_reload_ssl_services: Optional[bool] = True
    notifications: NotificationSettings = NotificationSettings()
    watchdog: WatchdogSettings = WatchdogSettings()

class SettingsUpdate(BaseModel):
    node_name: Optional[str] = None
    lcd_alias: Optional[str] = None
    gui_password: Optional[str] = None
    logo_text: Optional[str] = None
    logo_path: Optional[str] = None
    accent_color: Optional[str] = None
    auto_reload_ssl_services: Optional[bool] = None
    lcd_enabled: Optional[bool] = None
    language: Optional[str] = None
    theme: Optional[str] = None

    bind_address: Optional[str] = None
    http_port: Optional[int] = None
    https_port: Optional[int] = None
    ssl_enabled: Optional[bool] = None
    force_https_redirect: Optional[bool] = None
    ssl_mode: Optional[str] = None
    ssl_domain: Optional[str] = None
    ssl_email: Optional[str] = None
    ssl_challenge_type: Optional[str] = None
    ssl_auto_renew: Optional[bool] = None

    logging_mode: Optional[str] = None
    logging_storage_id: Optional[int] = None
    logging_relative_path: Optional[str] = None
    logging_rotation_enabled: Optional[bool] = None
    logging_rotation_max_bytes: Optional[int] = None
    logging_rotation_backup_count: Optional[int] = None
    logging_compression_enabled: Optional[bool] = None
    logging_retention_days: Optional[int] = None
    logging_timestamp_tz: Optional[str] = None
    notifications: Optional[NotificationSettingsUpdate] = None
    watchdog: Optional[WatchdogSettingsUpdate] = None

    @validator('lcd_alias')
    def validate_lcd_alias(cls, v):
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("LCD Alias cannot be empty")
        if len(v) > 12:
            raise ValueError("LCD Alias must be 12 characters or less")
        import re
        if not re.match(r"^[a-zA-Z0-9\s\-_]+$", v):
            raise ValueError("LCD Alias must contain only alphanumeric characters, spaces, dashes, or underscores")
        return v
    lcd_port: Optional[str] = None
    lcd_model: Optional[str] = None
    lcd_brightness: Optional[int] = None
    lcd_dim_brightness: Optional[int] = None
    lcd_dim_timeout: Optional[int] = None
    lcd_led0_profile: Optional[str] = None
    lcd_led1_profile: Optional[str] = None
    lcd_led2_profile: Optional[str] = None
    lcd_led3_profile: Optional[str] = None
    gui_port: Optional[int] = None

class LoginRequest(BaseModel):
    password: str

class StorageCreate(BaseModel):
    name: str
    path: str
    type: str  # 'build', 'media', 'hls', 'logs', 'sdk', 'preview'

class StorageUpdate(BaseModel):
    name: str
    path: str

class StorageTest(BaseModel):
    path: str

class SdkMigrateRequest(BaseModel):
    target_storage_id: int


# ── System Settings & Auth ────────────────────────────────────────

def make_settings_response(settings, current_request_port: Optional[int] = None):
    config_path = os.environ.get("CONFIG_FILE_PATH")
    if not config_path:
        config_path = "ffmpeg-gui.conf"
    
    env_active_port = os.environ.get("ACTIVE_PORT")
    if env_active_port:
        active_port = int(env_active_port)
    elif current_request_port:
        active_port = current_request_port
    else:
        active_port = 8000

    gui_port = active_port
    restart_required = False
    restart_reasons = []
    language = "en"
    theme = "studio-dark"

    # Default logging values
    logging_mode = "journalctl"
    logging_storage_id = None
    logging_relative_path = "ffmpeg-gui.log"
    logging_rotation_enabled = False
    logging_rotation_max_bytes = 10485760
    logging_rotation_backup_count = 5
    logging_compression_enabled = False
    logging_retention_days = 30
    logging_timestamp_tz = "utc"

    # Default network & SSL values
    bind_address = "0.0.0.0"
    http_port = 8080
    https_port = 8443
    ssl_enabled = False
    force_https_redirect = False
    ssl_mode = "disabled"
    ssl_domain = None
    ssl_email = None
    ssl_challenge_type = "http-01"
    ssl_auto_renew = True
    auto_reload_ssl_services = getattr(settings, "auto_reload_ssl_services", True) if settings else True
    if auto_reload_ssl_services is None:
        auto_reload_ssl_services = True

    # Default notifications values
    notifications_data = {
        "enabled": False,
        "smtp_host": "localhost",
        "smtp_port": 587,
        "smtp_encryption": "tls",
        "smtp_user": "",
        "smtp_password": "",
        "sender_email": "",
        "recipient_email": "",
        "notify_service_failures": True,
        "notify_build_results": True,
        "notify_task_failures": True,
        "notify_ssl_alerts": True,
        "notify_storage_alerts": True,
    }

    # Default watchdog values
    watchdog_data = {
        "startup_grace_delay": 10,
        "network_wait_timeout": 60,
        "watchdog_max_backoff": 30,
    }

    if config_path and os.path.exists(config_path):
        try:
            import configparser
            config = configparser.ConfigParser()
            config.read(config_path)
            if "general" in config:
                language = config.get("general", "language", fallback="en")
                theme = config.get("general", "theme", fallback="studio-dark")
            if "network" in config:
                net_cfg = config["network"]
                bind_address = net_cfg.get("bind_address", fallback=bind_address)
                try: http_port = net_cfg.getint("http_port", fallback=http_port)
                except ValueError: pass
                try: https_port = net_cfg.getint("https_port", fallback=https_port)
                except ValueError: pass
                try: ssl_enabled = net_cfg.getboolean("ssl_enabled", fallback=ssl_enabled)
                except ValueError: pass
                try: force_https_redirect = net_cfg.getboolean("force_https_redirect", fallback=force_https_redirect)
                except ValueError: pass
            if "ssl" in config:
                ssl_cfg = config["ssl"]
                ssl_mode = ssl_cfg.get("mode", fallback=ssl_mode)
                ssl_domain = ssl_cfg.get("domain", fallback=ssl_domain)
                ssl_email = ssl_cfg.get("email", fallback=ssl_email)
                ssl_challenge_type = ssl_cfg.get("challenge_type", fallback=ssl_challenge_type)
                try: ssl_auto_renew = ssl_cfg.getboolean("auto_renew", fallback=ssl_auto_renew)
                except ValueError: pass
                try: auto_reload_ssl_services = ssl_cfg.getboolean("auto_reload_ssl_services", fallback=auto_reload_ssl_services)
                except ValueError: pass
            if "notifications" in config:
                notif_cfg = config["notifications"]
                try: notifications_data["enabled"] = notif_cfg.getboolean("enabled", fallback=notifications_data["enabled"])
                except ValueError: pass
                notifications_data["smtp_host"] = notif_cfg.get("smtp_host", fallback=notifications_data["smtp_host"])
                try: notifications_data["smtp_port"] = notif_cfg.getint("smtp_port", fallback=notifications_data["smtp_port"])
                except ValueError: pass
                notifications_data["smtp_encryption"] = notif_cfg.get("smtp_encryption", fallback=notifications_data["smtp_encryption"])
                notifications_data["smtp_user"] = notif_cfg.get("smtp_user", fallback=notifications_data["smtp_user"])
                raw_pwd = notif_cfg.get("smtp_password", fallback="")
                notifications_data["smtp_password"] = "*****" if raw_pwd else ""
                notifications_data["sender_email"] = notif_cfg.get("sender_email", fallback=notifications_data["sender_email"])
                notifications_data["recipient_email"] = notif_cfg.get("recipient_email", fallback=notifications_data["recipient_email"])
                try: notifications_data["notify_service_failures"] = notif_cfg.getboolean("notify_service_failures", fallback=notifications_data["notify_service_failures"])
                except ValueError: pass
                try: notifications_data["notify_build_results"] = notif_cfg.getboolean("notify_build_results", fallback=notifications_data["notify_build_results"])
                except ValueError: pass
                try: notifications_data["notify_task_failures"] = notif_cfg.getboolean("notify_task_failures", fallback=notifications_data["notify_task_failures"])
                except ValueError: pass
                try: notifications_data["notify_ssl_alerts"] = notif_cfg.getboolean("notify_ssl_alerts", fallback=notifications_data["notify_ssl_alerts"])
                except ValueError: pass
                try: notifications_data["notify_storage_alerts"] = notif_cfg.getboolean("notify_storage_alerts", fallback=notifications_data["notify_storage_alerts"])
                except ValueError: pass
            if "software_engines" in config:
                software_manager.load_config(dict(config["software_engines"]))
            if "server" in config and "port" in config["server"]:
                gui_port = int(config["server"]["port"])
                if gui_port != active_port:
                    restart_required = True
                    restart_reasons.append("port")
            
            if "logging" in config:
                logging_cfg = config["logging"]
                logging_mode = logging_cfg.get("mode", logging_mode)
                
                storage_id_str = logging_cfg.get("storage_id", "")
                if storage_id_str.strip():
                    try:
                        logging_storage_id = int(storage_id_str)
                    except ValueError:
                        pass
                
                logging_relative_path = logging_cfg.get("relative_path", logging_relative_path)
                
                try:
                    logging_rotation_enabled = logging_cfg.getboolean("rotation_enabled", logging_rotation_enabled)
                except ValueError:
                    pass
                
                try:
                    logging_rotation_max_bytes = logging_cfg.getint("rotation_max_bytes", logging_rotation_max_bytes)
                except ValueError:
                    pass
                    
                try:
                    logging_rotation_backup_count = logging_cfg.getint("rotation_backup_count", logging_rotation_backup_count)
                except ValueError:
                    pass
                    
                try:
                    logging_compression_enabled = logging_cfg.getboolean("compression_enabled", logging_compression_enabled)
                except ValueError:
                    pass
                    
                try:
                    logging_retention_days = logging_cfg.getint("retention_days", logging_retention_days)
                except ValueError:
                    pass
                logging_timestamp_tz = logging_cfg.get("timestamp_tz", logging_timestamp_tz)
            if "watchdog" in config:
                wd_cfg = config["watchdog"]
                try: watchdog_data["startup_grace_delay"] = wd_cfg.getint("startup_grace_delay", fallback=10)
                except ValueError: pass
                try: watchdog_data["network_wait_timeout"] = wd_cfg.getint("network_wait_timeout", fallback=60)
                except ValueError: pass
                try: watchdog_data["watchdog_max_backoff"] = wd_cfg.getint("watchdog_max_backoff", fallback=30)
                except ValueError: pass
        except Exception as e:
            logger.error(f"Error reading settings from config file: {e}")

    # Check if active settings differ from .conf settings
    try:
        import logging.handlers
        
        # 1. Locate active file handler and console handler
        active_fh = None
        has_console = False
        
        logger_inst = logging.getLogger("FFMPEG-GUI")
        all_handlers = []
        if logger_inst.handlers:
            all_handlers.extend(logger_inst.handlers)
        root_handlers = logging.getLogger().handlers
        for h in root_handlers:
            if h not in all_handlers:
                all_handlers.append(h)
                
        for h in all_handlers:
            if isinstance(h, logging.FileHandler):
                active_fh = h
            elif isinstance(h, logging.StreamHandler):
                has_console = True
                
        has_file = active_fh is not None
        
        if has_console and has_file:
            active_mode = "both"
        elif has_file:
            active_mode = "file"
        else:
            active_mode = "journalctl"
            
        active_file_path = os.path.abspath(active_fh.baseFilename) if active_fh else None
        
        active_rotation_enabled = False
        active_max_bytes = None
        active_backup_count = None
        active_compression_enabled = False
        
        if active_fh:
            if isinstance(active_fh, logging.handlers.RotatingFileHandler):
                active_rotation_enabled = True
                active_max_bytes = getattr(active_fh, "maxBytes", 10485760)
                active_backup_count = getattr(active_fh, "backupCount", 5)
                active_compression_enabled = "Gzipped" in active_fh.__class__.__name__
                
        # Get expected file path from config
        expected_file_path = None
        if config_path and os.path.exists(config_path):
            try:
                import configparser
                config = configparser.ConfigParser()
                config.read(config_path)
                if "logging" in config:
                    expected_file_path = config["logging"].get("file_path", None)
                if not expected_file_path and "server" in config:
                    expected_file_path = config["server"].get("log_file", None)
            except Exception:
                pass
                
        if logging_mode in ("both", "file"):
            if not expected_file_path:
                expected_file_path = logging_relative_path
            if expected_file_path:
                expected_file_path = os.path.abspath(expected_file_path)
        else:
            expected_file_path = None
            
        # Compare
        logging_diff = False
        if logging_mode != active_mode:
            logging_diff = True
        elif expected_file_path and active_file_path and os.path.normpath(expected_file_path) != os.path.normpath(active_file_path):
            logging_diff = True
        elif (expected_file_path is None) != (active_file_path is None):
            logging_diff = True
        elif logging_rotation_enabled != active_rotation_enabled:
            logging_diff = True
        elif logging_rotation_enabled and (logging_rotation_max_bytes != active_max_bytes):
            logging_diff = True
        elif logging_rotation_enabled and (logging_rotation_backup_count != active_backup_count):
            logging_diff = True
        elif logging_rotation_enabled and (logging_compression_enabled != active_compression_enabled):
            logging_diff = True
            
        if logging_diff:
            restart_required = True
            restart_reasons.append("logging")
            
    except Exception as e:
        logger.error(f"Error checking active logging diff: {e}")

    res = {c.name: getattr(settings, c.name) for c in settings.__table__.columns}
    res["gui_port"] = gui_port
    res["restart_required"] = restart_required
    res["restart_reasons"] = restart_reasons
    
    # Populate logging configuration fields
    res["logging_mode"] = logging_mode
    res["logging_storage_id"] = logging_storage_id
    res["logging_relative_path"] = logging_relative_path
    res["logging_rotation_enabled"] = logging_rotation_enabled
    res["logging_rotation_max_bytes"] = logging_rotation_max_bytes
    res["logging_rotation_backup_count"] = logging_rotation_backup_count
    res["logging_compression_enabled"] = logging_compression_enabled
    res["logging_retention_days"] = logging_retention_days
    res["logging_timestamp_tz"] = logging_timestamp_tz
    res["language"] = language
    res["theme"] = theme
    res["bind_address"] = bind_address
    res["http_port"] = http_port
    res["https_port"] = https_port
    res["ssl_enabled"] = ssl_enabled
    res["force_https_redirect"] = force_https_redirect
    res["ssl_mode"] = ssl_mode
    res["ssl_domain"] = ssl_domain
    res["ssl_email"] = ssl_email
    res["ssl_challenge_type"] = ssl_challenge_type
    res["ssl_auto_renew"] = ssl_auto_renew
    res["auto_reload_ssl_services"] = auto_reload_ssl_services
    res["notifications"] = notifications_data
    res["watchdog"] = watchdog_data
    
    return SettingsResponse(**res).model_dump()


@app.get("/settings")
@app.get("/api/settings")
def get_settings(request: Request, db: Session = Depends(get_db)):
    from database.models import SystemSettings
    settings = db.query(SystemSettings).first()
    if not settings:
        settings = SystemSettings()
        db.add(settings)
        db.commit()
        db.refresh(settings)
    
    current_port = request.url.port if request else None
    return make_settings_response(settings, current_request_port=current_port)
    
    # Backwards compatibility auto-normalization for pre-existing rows
    dirty = False
    if settings.lcd_alias is None:
        settings.lcd_alias = "NODE-01"
        dirty = True
    if settings.lcd_brightness is None:
        settings.lcd_brightness = 100
        dirty = True
    if settings.lcd_dim_brightness is None:
        settings.lcd_dim_brightness = 20
        dirty = True
    if settings.lcd_dim_timeout is None:
        settings.lcd_dim_timeout = 30
        dirty = True
    if settings.lcd_led0_profile is None:
        settings.lcd_led0_profile = "heartbeat"
        dirty = True
    if settings.lcd_led1_profile is None:
        settings.lcd_led1_profile = "streams"
        dirty = True
    if settings.lcd_led2_profile is None:
        settings.lcd_led2_profile = "tasks"
        dirty = True
    if settings.lcd_led3_profile is None:
        settings.lcd_led3_profile = "alert"
        dirty = True
        
    if dirty:
        db.commit()
        db.refresh(settings)
        
    return make_settings_response(settings)


def is_port_in_use_by_os(port: int, host: str = "0.0.0.0") -> bool:
    import socket
    active_port = int(os.environ.get("ACTIVE_PORT", 8000))
    if port == active_port:
        return False
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((host, port))
            return False
        except socket.error:
            return True


def is_port_allocated_in_db(port: int, db: Session) -> bool:
    from database.models import MediaProcess
    processes = db.query(MediaProcess).all()
    port_str = str(port)

    def extract_ports(cfg):
        ports = []
        if not cfg:
            return ports
        if isinstance(cfg, list):
            for item in cfg:
                if isinstance(item, dict) and "port" in item:
                    try:
                        ports.append(str(item["port"]))
                    except (ValueError, TypeError):
                        pass
        elif isinstance(cfg, dict):
            if "port" in cfg:
                try:
                    ports.append(str(cfg["port"]))
                except (ValueError, TypeError):
                    pass
            for key in ["input1", "input2"]:
                if key in cfg and isinstance(cfg[key], dict) and "port" in cfg[key]:
                    try:
                        ports.append(str(cfg[key]["port"]))
                    except (ValueError, TypeError):
                        pass
        return ports

    for p in processes:
        if port_str in extract_ports(p.input_config) or port_str in extract_ports(p.output_config):
            return True
    return False


def check_media_process_port_conflicts(input_config: dict, output_config: list, db: Optional[Session] = None, service_id: Optional[int] = None):
    from utils.port_validator import validate_service_port_conflicts, get_gui_reserved_ports
    gui_ports = get_gui_reserved_ports()
    if db is not None:
        validate_service_port_conflicts(
            db=db,
            service_id=service_id,
            service_name="Service",
            service_type="ffmpeg_stream",
            config={},
            input_config=input_config,
            output_config=output_config
        )
    else:
        # Fallback basic GUI port check
        def extract_ports(cfg):
            ports = []
            if not cfg: return ports
            if isinstance(cfg, list):
                for item in cfg:
                    if isinstance(item, dict) and "port" in item:
                        try: ports.append(int(item["port"]))
                        except (ValueError, TypeError): pass
            elif isinstance(cfg, dict):
                if "port" in cfg:
                    try: ports.append(int(cfg["port"]))
                    except (ValueError, TypeError): pass
                for key in ["input1", "input2"]:
                    if key in cfg and isinstance(cfg[key], dict) and "port" in cfg[key]:
                        try: ports.append(int(cfg[key]["port"]))
                        except (ValueError, TypeError): pass
            return ports

        for p in extract_ports(input_config) + extract_ports(output_config):
            if p in gui_ports:
                raise HTTPException(
                    status_code=400,
                    detail=f"Port {p} is reserved for the GUI web panel."
                )


@app.post("/settings")
@app.post("/api/settings")
def update_settings(settings_in: SettingsUpdate, db: Session = Depends(get_db)):
    if settings_in.language is not None:
        if settings_in.language not in SUPPORTED_LANGUAGES:
            raise HTTPException(status_code=400, detail="Invalid language code")
        
        config_path = os.environ.get("CONFIG_FILE_PATH")
        if not config_path:
            config_path = "ffmpeg-gui.conf"
            
        import configparser
        config = configparser.ConfigParser()
        if os.path.exists(config_path):
            config.read(config_path)
            
        if "general" not in config:
            config["general"] = {}
        config["general"]["language"] = settings_in.language
        
        with open(config_path, "w") as f:
            config.write(f)
    if settings_in.theme is not None:
        if settings_in.theme not in ['studio-dark', 'cyberpunk', 'nordic-frost', 'broadcast-light', 'warm-paper']:
            raise HTTPException(status_code=400, detail="Invalid theme name")
        
        config_path = os.environ.get("CONFIG_FILE_PATH")
        if not config_path:
            config_path = "ffmpeg-gui.conf"
            
        import configparser
        config = configparser.ConfigParser()
        if os.path.exists(config_path):
            config.read(config_path)
            
        if "general" not in config:
            config["general"] = {}
        config.set('general', 'theme', settings_in.theme)
        
        with open(config_path, "w") as f:
            config.write(f)
    if settings_in.gui_port is not None:
        if settings_in.gui_port < 1 or settings_in.gui_port > 65535:
            raise HTTPException(status_code=400, detail="Port must be between 1 and 65535.")
        if is_port_allocated_in_db(settings_in.gui_port, db):
            raise HTTPException(status_code=400, detail=f"Port {settings_in.gui_port} is already configured in one of the media processes.")
        if is_port_in_use_by_os(settings_in.gui_port):
            raise HTTPException(status_code=400, detail=f"Port {settings_in.gui_port} is already in use on the system.")
            
        config_path = os.environ.get("CONFIG_FILE_PATH")
        if config_path and os.path.exists(config_path):
            import configparser
            config = configparser.ConfigParser()
            config.read(config_path)
            if "server" not in config:
                config["server"] = {}
            config["server"]["port"] = str(settings_in.gui_port)
            with open(config_path, "w") as f:
                config.write(f)

    # ── Handle Logging Settings update ──
    logging_fields = [
        "logging_mode",
        "logging_storage_id",
        "logging_relative_path",
        "logging_rotation_enabled",
        "logging_rotation_max_bytes",
        "logging_rotation_backup_count",
        "logging_compression_enabled",
        "logging_retention_days",
    ]
    
    has_logging_updates = any(getattr(settings_in, field) is not None for field in logging_fields)
    
    if has_logging_updates:
        config_path = os.environ.get("CONFIG_FILE_PATH")
        if not config_path:
            config_path = "ffmpeg-gui.conf"
            
        import configparser
        config = configparser.ConfigParser()
        if os.path.exists(config_path):
            config.read(config_path)
            
        if "logging" not in config:
            config["logging"] = {}
            
        if settings_in.logging_mode is not None:
            config["logging"]["mode"] = settings_in.logging_mode
            # Synchronize system task active state
            from database.models import ScheduledTask
            from utils.cron_helper import CronHelper
            sys_task = db.query(ScheduledTask).filter(ScheduledTask.command == "system://log_rotate").first()
            if sys_task:
                is_active = settings_in.logging_mode in ("file", "both")
                sys_task.is_active = is_active
                sys_task.next_run = CronHelper.get_next_run("0 0 * * *") if is_active else None
            
            
        existing_rel_path = config["logging"].get("relative_path", "ffmpeg-gui.log")
        rel_path = settings_in.logging_relative_path if settings_in.logging_relative_path is not None else existing_rel_path
        if settings_in.logging_relative_path is not None:
            config["logging"]["relative_path"] = settings_in.logging_relative_path
            
        # Check if we have storage_id (either from input or from config file) to resolve absolute file_path
        storage_id_to_use = settings_in.logging_storage_id
        if storage_id_to_use is None:
            conf_storage_id = config["logging"].get("storage_id", "")
            if conf_storage_id.strip():
                try:
                    storage_id_to_use = int(conf_storage_id)
                except ValueError:
                    pass
                    
        if storage_id_to_use is not None:
            storage = db.query(Storage).filter(Storage.id == storage_id_to_use).first()
            if not storage or storage.type != "logs":
                raise HTTPException(status_code=400, detail="Invalid storage type selected for logging. Must be of type 'logs'.")
            if settings_in.logging_storage_id is not None:
                config["logging"]["storage_id"] = str(settings_in.logging_storage_id)
            if settings_in.logging_storage_id is not None or settings_in.logging_relative_path is not None:
                resolved_file_path = os.path.abspath(os.path.join(storage.path, rel_path))
                config["logging"]["file_path"] = resolved_file_path
                
        if settings_in.logging_rotation_enabled is not None:
            config["logging"]["rotation_enabled"] = str(settings_in.logging_rotation_enabled).lower()
        if settings_in.logging_rotation_max_bytes is not None:
            config["logging"]["rotation_max_bytes"] = str(settings_in.logging_rotation_max_bytes)
        if settings_in.logging_rotation_backup_count is not None:
            config["logging"]["rotation_backup_count"] = str(settings_in.logging_rotation_backup_count)
        if settings_in.logging_compression_enabled is not None:
            config["logging"]["compression_enabled"] = str(settings_in.logging_compression_enabled).lower()
        if settings_in.logging_retention_days is not None:
            config["logging"]["retention_days"] = str(settings_in.logging_retention_days)
        if settings_in.logging_timestamp_tz is not None:
            config["logging"]["timestamp_tz"] = settings_in.logging_timestamp_tz
            
        with open(config_path, "w") as f:
            config.write(f)

    # ── Handle Notification Settings update ──
    if settings_in.notifications is not None:
        config_path = os.environ.get("CONFIG_FILE_PATH")
        if not config_path:
            config_path = "ffmpeg-gui.conf"

        import configparser
        config = configparser.ConfigParser()
        if os.path.exists(config_path):
            config.read(config_path)

        if "notifications" not in config:
            config["notifications"] = {}

        notif_update = settings_in.notifications
        for field, val in notif_update.model_dump(exclude_unset=True).items():
            if val is not None:
                if field == "smtp_password":
                    if val != "*****":
                        config["notifications"]["smtp_password"] = str(val)
                elif isinstance(val, bool):
                    config["notifications"][field] = str(val).lower()
                else:
                    config["notifications"][field] = str(val)

        with open(config_path, "w") as f:
            config.write(f)

        notification_manager.load_config(dict(config["notifications"]))

    # ── Handle Watchdog Settings update ──
    if settings_in.watchdog is not None:
        config_path = os.environ.get("CONFIG_FILE_PATH")
        if not config_path:
            config_path = "ffmpeg-gui.conf"

        import configparser
        config = configparser.ConfigParser()
        if os.path.exists(config_path):
            config.read(config_path)

        if "watchdog" not in config:
            config["watchdog"] = {}

        wd_update = settings_in.watchdog
        for field, val in wd_update.model_dump(exclude_unset=True).items():
            if val is not None:
                config["watchdog"][field] = str(val)

        with open(config_path, "w") as f:
            config.write(f)

    # ── Handle Network & SSL Settings update ──
    network_ssl_fields = [
        "bind_address", "http_port", "https_port", "ssl_enabled",
        "force_https_redirect", "ssl_mode", "ssl_domain", "ssl_email",
        "ssl_challenge_type", "ssl_auto_renew"
    ]
    has_net_ssl_updates = any(getattr(settings_in, field) is not None for field in network_ssl_fields)

    if has_net_ssl_updates:
        from services.cert_manager import CertificateManager
        cert_mgr = CertificateManager()

        if settings_in.ssl_enabled is True:
            cert_status = cert_mgr.get_cert_status()
            if not cert_status["valid"]:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot enable HTTPS encryption without a valid active SSL certificate and keypair."
                )

        config_path = os.environ.get("CONFIG_FILE_PATH")
        if not config_path:
            config_path = "ffmpeg-gui.conf"

        import configparser
        config = configparser.ConfigParser()
        if os.path.exists(config_path):
            config.read(config_path)

        if "network" not in config:
            config["network"] = {}
        if "ssl" not in config:
            config["ssl"] = {}

        if settings_in.bind_address is not None:
            config["network"]["bind_address"] = settings_in.bind_address
        if settings_in.http_port is not None:
            config["network"]["http_port"] = str(settings_in.http_port)
            if "server" not in config: config["server"] = {}
            config["server"]["port"] = str(settings_in.http_port)
        if settings_in.https_port is not None:
            config["network"]["https_port"] = str(settings_in.https_port)
        if settings_in.ssl_enabled is not None:
            config["network"]["ssl_enabled"] = str(settings_in.ssl_enabled).lower()
        if settings_in.force_https_redirect is not None:
            config["network"]["force_https_redirect"] = str(settings_in.force_https_redirect).lower()

        if settings_in.ssl_mode is not None:
            config["ssl"]["mode"] = settings_in.ssl_mode
        if settings_in.ssl_domain is not None:
            config["ssl"]["domain"] = settings_in.ssl_domain
        if settings_in.ssl_email is not None:
            config["ssl"]["email"] = settings_in.ssl_email
        if settings_in.ssl_challenge_type is not None:
            config["ssl"]["challenge_type"] = settings_in.ssl_challenge_type
        if settings_in.ssl_auto_renew is not None:
            config["ssl"]["auto_renew"] = str(settings_in.ssl_auto_renew).lower()
        if settings_in.auto_reload_ssl_services is not None:
            config["ssl"]["auto_reload_ssl_services"] = str(settings_in.auto_reload_ssl_services).lower()

        with open(config_path, "w") as f:
            config.write(f)

        # Synchronize System Task #2 (SSL Auto-Renewal Routine) active status
        from database.models import ScheduledTask
        from utils.cron_helper import CronHelper
        from services.cert_manager import CertificateManager
        cert_mgr = CertificateManager()
        cert_status = cert_mgr.get_cert_status()

        ssl_sys_task = db.query(ScheduledTask).filter(ScheduledTask.command == "system://ssl_renew").first()
        if ssl_sys_task:
            mode = config["ssl"].get("mode", "disabled")
            auto_renew_str = config["ssl"].get("auto_renew", "true").lower()
            auto_renew = auto_renew_str in ("true", "1", "yes")
            is_active = (mode == "acme" and auto_renew and cert_status.get("valid", False) and cert_status.get("mode") == "acme")
            ssl_sys_task.is_active = is_active
            ssl_sys_task.next_run = CronHelper.get_next_run("0 3 * * *") if is_active else None
            db.commit()

    from database.models import SystemSettings
    settings = db.query(SystemSettings).first()
    if not settings:
        settings = SystemSettings()
        db.add(settings)
    
    if settings_in.node_name is not None: settings.node_name = settings_in.node_name
    if settings_in.lcd_alias is not None: settings.lcd_alias = settings_in.lcd_alias
    if settings_in.gui_password is not None:
        if settings_in.gui_password.strip() == "":
            settings.gui_password = None
        else:
            settings.gui_password = settings_in.gui_password
    if settings_in.logo_text is not None: settings.logo_text = settings_in.logo_text
    if settings_in.logo_path is not None:
        if settings_in.logo_path.strip() == "":
            settings.logo_path = None
        else:
            settings.logo_path = settings_in.logo_path
    if settings_in.accent_color is not None: settings.accent_color = settings_in.accent_color
    if settings_in.auto_reload_ssl_services is not None: settings.auto_reload_ssl_services = settings_in.auto_reload_ssl_services
    
    lcd_core_changed = (
        (settings_in.lcd_enabled is not None and settings_in.lcd_enabled != settings.lcd_enabled) or
        (settings_in.lcd_port is not None and settings_in.lcd_port != settings.lcd_port) or
        (settings_in.lcd_model is not None and settings_in.lcd_model != settings.lcd_model)
    )

    if settings_in.lcd_enabled is not None: settings.lcd_enabled = settings_in.lcd_enabled
    if settings_in.lcd_port is not None: settings.lcd_port = settings_in.lcd_port
    if settings_in.lcd_model is not None: settings.lcd_model = settings_in.lcd_model
    if settings_in.lcd_brightness is not None: settings.lcd_brightness = settings_in.lcd_brightness
    if settings_in.lcd_dim_brightness is not None: settings.lcd_dim_brightness = settings_in.lcd_dim_brightness
    if settings_in.lcd_dim_timeout is not None: settings.lcd_dim_timeout = settings_in.lcd_dim_timeout
    if settings_in.lcd_led0_profile is not None: settings.lcd_led0_profile = settings_in.lcd_led0_profile
    if settings_in.lcd_led1_profile is not None: settings.lcd_led1_profile = settings_in.lcd_led1_profile
    if settings_in.lcd_led2_profile is not None: settings.lcd_led2_profile = settings_in.lcd_led2_profile
    if settings_in.lcd_led3_profile is not None: settings.lcd_led3_profile = settings_in.lcd_led3_profile

    db.commit()
    db.refresh(settings)

    global lcd_manager
    if lcd_core_changed:
        if lcd_manager:
            try:
                lcd_manager.stop()
            except Exception:
                pass
            lcd_manager = None
        
        if settings.lcd_enabled:
            try:
                from core.lcd.manager import LCDManager
                lcd_manager = LCDManager(
                    db_session_factory=SessionLocal,
                    process_manager=process_manager,
                    task_manager=task_manager,
                    port=settings.lcd_port
                )
                lcd_manager.start()
            except Exception:
                pass
    else:
        if lcd_manager and lcd_manager._running:
            if settings_in.lcd_brightness is not None:
                lcd_manager.active_brightness = settings_in.lcd_brightness
                try:
                    lcd_manager._register_activity()
                except Exception:
                    pass
            if settings_in.lcd_dim_brightness is not None:
                lcd_manager.dim_brightness = settings_in.lcd_dim_brightness
            if settings_in.lcd_dim_timeout is not None:
                lcd_manager.dim_timeout = settings_in.lcd_dim_timeout
            if settings_in.lcd_led0_profile is not None:
                lcd_manager.lcd_led0_profile = settings_in.lcd_led0_profile
            if settings_in.lcd_led1_profile is not None:
                lcd_manager.lcd_led1_profile = settings_in.lcd_led1_profile
            if settings_in.lcd_led2_profile is not None:
                lcd_manager.lcd_led2_profile = settings_in.lcd_led2_profile
            if settings_in.lcd_led3_profile is not None:
                lcd_manager.lcd_led3_profile = settings_in.lcd_led3_profile

    return make_settings_response(settings)


def execute_system_restart():
    import time
    import os
    set_reload_mode(True)
    time.sleep(2.5) # Wait 2.5s to let the API response flush completely
    logger.warning("Restart triggered from Web UI (Warm Reload). Terminating process now...")
    os._exit(0)


@app.post("/settings/restart")
def restart_panel(background_tasks: BackgroundTasks):
    background_tasks.add_task(execute_system_restart)
    return {"status": "ok", "message": "Panel is restarting"}


@app.post("/notifications/test")
@app.post("/api/notifications/test")
def send_test_notification(payload: Optional[Dict[str, Any]] = Body(None)):
    success, msg = notification_manager.send_test_email(override_config=payload)
    if not success:
        raise HTTPException(status_code=400, detail=msg)
    return {"success": success, "message": msg}

@app.post("/api/backup/export")
def export_backup_json(req: BackupExportRequest, db: Session = Depends(get_db)):
    sections = {}
    config_path = os.environ.get("CONFIG_FILE_PATH") or "ffmpeg-gui.conf"
    import configparser
    config = configparser.ConfigParser()
    if os.path.exists(config_path):
        config.read(config_path)

    # 1. General Panel
    if req.gui_general:
        gen_dict = {}
        if "general" in config:
            for k in ["language", "theme", "node_name", "logo_text", "lcd_alias", "gui_password"]:
                if k in config["general"]:
                    gen_dict[k] = config["general"][k]
        sections["gui_general"] = gen_dict

    # 2. Network & SSL
    if req.gui_network_ssl:
        net_dict = {}
        if "general" in config:
            for k in ["bind_address", "gui_port", "http_port", "https_port", "ssl_enabled", "force_https_redirect", "ssl_mode", "ssl_domain", "ssl_email", "ssl_challenge_type"]:
                if k in config["general"]:
                    net_dict[k] = config["general"][k]
        sections["gui_network_ssl"] = net_dict

    # 3. LCD Display
    if req.lcd_display:
        lcd_dict = {}
        if "lcd" in config:
            lcd_dict = dict(config["lcd"])
        elif "general" in config:
            for k in ["lcd_enabled", "lcd_port", "lcd_model", "lcd_brightness", "lcd_dim_brightness", "lcd_dim_timeout", "lcd_led0_profile", "lcd_led1_profile", "lcd_led2_profile", "lcd_led3_profile"]:
                if k in config["general"]:
                    lcd_dict[k] = config["general"][k]
        sections["lcd_display"] = lcd_dict

    # 4. Logging & Retention
    if req.logging_retention:
        log_dict = {}
        if "general" in config:
            for k in ["logging_mode", "logging_storage_id", "logging_relative_path", "logging_rotation_enabled", "logging_rotation_max_bytes", "logging_rotation_backup_count", "logging_compression_enabled", "logging_retention_days", "logging_timestamp_tz"]:
                if k in config["general"]:
                    log_dict[k] = config["general"][k]
        sections["logging_retention"] = log_dict

    # 5. Watchdog & Grace Delay
    if req.watchdog_grace:
        wd_dict = {}
        if "watchdog" in config:
            wd_dict = dict(config["watchdog"])
        sections["watchdog_grace"] = wd_dict

    # 6. Notifications
    if req.notifications:
        notif_dict = {}
        if "notifications" in config:
            notif_dict = dict(config["notifications"])
            if "smtp_password" in notif_dict and notif_dict["smtp_password"]:
                notif_dict["smtp_password"] = "*****"
        sections["notifications"] = notif_dict

    # 7. Services
    if req.services:
        procs = db.query(MediaProcess).filter(MediaProcess.service_type == "ffmpeg_stream").all()
        sections["services"] = [
            {
                "name": p.name,
                "input_config": p.input_config,
                "output_config": p.output_config,
                "codec_config": p.codec_config,
                "filter_config": p.filter_config,
                "auto_start": p.auto_start,
                "startup_order": p.startup_order,
                "startup_delay": p.startup_delay,
                "watchdog_enabled": p.watchdog_enabled,
                "watchdog_retries": p.watchdog_retries,
                "watchdog_min_speed": p.watchdog_min_speed,
                "watchdog_min_speed_duration": p.watchdog_min_speed_duration,
                "alias": p.alias,
                "network_timeout": p.network_timeout,
                "debug_mode": p.debug_mode,
            }
            for p in procs
        ]

    # 8. Scheduled Tasks
    if req.tasks:
        tasks = db.query(ScheduledTask).filter(ScheduledTask.is_system == False).all()
        sections["tasks"] = [
            {
                "name": t.name,
                "input_config": t.input_config,
                "output_config": t.output_config,
                "codec_config": t.codec_config,
                "filter_config": t.filter_config,
                "schedule_type": t.schedule_type,
                "schedule_cron": t.schedule_cron,
                "schedule_datetime": t.schedule_datetime.isoformat() if t.schedule_datetime else None,
                "duration_type": t.duration_type,
                "duration_seconds": t.duration_seconds,
                "duration_end_time": t.duration_end_time.isoformat() if t.duration_end_time else None,
                "is_active": t.is_active,
                "retry_policy": t.retry_policy,
                "alias": t.alias,
            }
            for t in tasks
        ]

    # 9. Storage Volumes
    if req.storage_volumes:
        storages = db.query(Storage).all()
        sections["storage_volumes"] = [
            {
                "name": s.name,
                "path": s.path,
                "type": s.type,
                "is_default": s.is_default
            }
            for s in storages
        ]

    return {
        "app": "ffmpeg-gui",
        "version": backend_version,
        "exported_at": datetime.datetime.utcnow().isoformat() + "Z",
        "sections": sections
    }


@app.post("/api/backup/import")
def import_backup_json(payload: BackupImportPayload, db: Session = Depends(get_db)):
    if payload.app != "ffmpeg-gui":
        raise HTTPException(status_code=400, detail="Invalid backup file app identifier")

    imported_summary = {
        "gui_general": False,
        "gui_network_ssl": False,
        "lcd_display": False,
        "logging_retention": False,
        "watchdog_grace": False,
        "services": 0,
        "tasks": 0,
        "storage_volumes": 0,
        "notifications": False
    }
    sections = payload.sections or {}
    config_path = os.environ.get("CONFIG_FILE_PATH") or "ffmpeg-gui.conf"

    import configparser
    config = configparser.ConfigParser()
    if os.path.exists(config_path):
        config.read(config_path)

    if "general" not in config:
        config["general"] = {}
    if "lcd" not in config:
        config["lcd"] = {}
    if "watchdog" not in config:
        config["watchdog"] = {}
    if "notifications" not in config:
        config["notifications"] = {}

    # Legacy system_settings
    if "system_settings" in sections and isinstance(sections["system_settings"], dict):
        for sec_name, sec_vals in sections["system_settings"].items():
            if isinstance(sec_vals, dict):
                if sec_name not in config:
                    config[sec_name] = {}
                for k, v in sec_vals.items():
                    config.set(sec_name, k, str(v))
        imported_summary["gui_general"] = True

    # Granular subsections
    if "gui_general" in sections and isinstance(sections["gui_general"], dict):
        for k, v in sections["gui_general"].items():
            config.set("general", k, str(v))
        imported_summary["gui_general"] = True

    if "gui_network_ssl" in sections and isinstance(sections["gui_network_ssl"], dict):
        for k, v in sections["gui_network_ssl"].items():
            config.set("general", k, str(v))
        imported_summary["gui_network_ssl"] = True

    if "lcd_display" in sections and isinstance(sections["lcd_display"], dict):
        for k, v in sections["lcd_display"].items():
            config.set("lcd", k, str(v))
        imported_summary["lcd_display"] = True

    if "logging_retention" in sections and isinstance(sections["logging_retention"], dict):
        for k, v in sections["logging_retention"].items():
            config.set("general", k, str(v))
        imported_summary["logging_retention"] = True

    if "watchdog_grace" in sections and isinstance(sections["watchdog_grace"], dict):
        for k, v in sections["watchdog_grace"].items():
            config.set("watchdog", k, str(v))
        imported_summary["watchdog_grace"] = True

    if "notifications" in sections and isinstance(sections["notifications"], dict):
        for k, v in sections["notifications"].items():
            if k == "smtp_password" and v == "*****":
                continue
            config.set("notifications", k, str(v))
        notification_manager.load_config(dict(config["notifications"]))
        imported_summary["notifications"] = True

    with open(config_path, "w") as f:
        config.write(f)

    # Restore Storage Volumes
    if "storage_volumes" in sections and isinstance(sections["storage_volumes"], list):
        for s_data in sections["storage_volumes"]:
            existing = db.query(Storage).filter(Storage.path == s_data.get("path")).first()
            if not existing:
                st = Storage(
                    name=s_data.get("name"),
                    path=s_data.get("path"),
                    type=s_data.get("type", "generic"),
                    is_default=s_data.get("is_default", False)
                )
                db.add(st)
                imported_summary["storage_volumes"] += 1

    # Restore Services
    if "services" in sections and isinstance(sections["services"], list):
        for p_data in sections["services"]:
            existing = db.query(MediaProcess).filter(MediaProcess.name == p_data.get("name")).first()
            if not existing:
                proc = MediaProcess(
                    name=p_data.get("name"),
                    type="service",
                    status="stopped",
                    input_config=p_data.get("input_config") or {},
                    output_config=p_data.get("output_config") or {},
                    codec_config=p_data.get("codec_config") or {},
                    filter_config=p_data.get("filter_config") or {},
                    auto_start=p_data.get("auto_start", False),
                    startup_order=p_data.get("startup_order", 1),
                    startup_delay=p_data.get("startup_delay", 0),
                    watchdog_enabled=p_data.get("watchdog_enabled", True),
                    watchdog_retries=p_data.get("watchdog_retries", 3),
                    watchdog_min_speed=p_data.get("watchdog_min_speed", 0.85),
                    watchdog_min_speed_duration=p_data.get("watchdog_min_speed_duration", 30),
                    alias=p_data.get("alias"),
                    network_timeout=p_data.get("network_timeout", 30),
                    debug_mode=p_data.get("debug_mode", False),
                )
                db.add(proc)
                imported_summary["services"] += 1

    # Restore Scheduled Tasks
    if "tasks" in sections and isinstance(sections["tasks"], list):
        for t_data in sections["tasks"]:
            existing = db.query(ScheduledTask).filter(ScheduledTask.name == t_data.get("name")).first()
            if not existing:
                sched_dt = None
                if t_data.get("schedule_datetime"):
                    try:
                        sched_dt = datetime.datetime.fromisoformat(t_data["schedule_datetime"])
                    except Exception:
                        pass
                dur_end = None
                if t_data.get("duration_end_time"):
                    try:
                        dur_end = datetime.datetime.fromisoformat(t_data["duration_end_time"])
                    except Exception:
                        pass
                task = ScheduledTask(
                    name=t_data.get("name"),
                    command="ffmpeg",
                    input_config=t_data.get("input_config") or {},
                    output_config=t_data.get("output_config") or {},
                    codec_config=t_data.get("codec_config") or {},
                    filter_config=t_data.get("filter_config") or {},
                    schedule_type=t_data.get("schedule_type", "manual"),
                    schedule_cron=t_data.get("schedule_cron"),
                    schedule_datetime=sched_dt,
                    duration_type=t_data.get("duration_type", "timer"),
                    duration_seconds=t_data.get("duration_seconds", 3600),
                    duration_end_time=dur_end,
                    is_active=t_data.get("is_active", False),
                    retry_policy=t_data.get("retry_policy", {"max_retries": 3, "retry_delay": 5}),
                    alias=t_data.get("alias"),
                )
                db.add(task)
                imported_summary["tasks"] += 1

    db.commit()
    return {
        "status": "success",
        "message": "Backup configuration imported successfully",
        "imported": imported_summary
    }


@app.post("/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    from database.models import SystemSettings
    settings = db.query(SystemSettings).first()
    if not settings or not settings.gui_password:
        return {"authenticated": True}
    if req.password == settings.gui_password:
        return {"authenticated": True}
    raise HTTPException(status_code=401, detail="Invalid password")

@app.post("/settings/logo")
@app.post("/api/settings/logo")
async def upload_logo(file: UploadFile = File(...), db: Session = Depends(get_db)):
    from database.models import SystemSettings
    settings = db.query(SystemSettings).first()
    if not settings:
        settings = SystemSettings()
        db.add(settings)
    
    try:
        img = Image.open(file.file)
        img = img.convert("RGBA")
        img.thumbnail((256, 256), Image.Resampling.LANCZOS)
        
        filename = f"logo_{uuid.uuid4().hex[:8]}.png"
        url_path = f"/uploads/{filename}"
        disk_path = os.path.join(UPLOAD_DIR, filename)
        img.save(disk_path, format="PNG")
        
        # Remove old logo if exists
        if settings.logo_path and settings.logo_path.startswith("/uploads/"):
            old_disk_path = os.path.join(UPLOAD_DIR, settings.logo_path.split("/")[-1])
            if os.path.exists(old_disk_path):
                try:
                    os.remove(old_disk_path)
                except Exception:
                    pass
                
        settings.logo_path = url_path
        db.commit()
        db.refresh(settings)
        return {"logo_path": url_path}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {str(e)}")

def parse_vainfo_capabilities() -> dict:
    """Run vainfo and parse supported profiles and entrypoints for hardware acceleration capabilities."""
    import shutil
    import subprocess
    import re
    
    caps = {
        "decoders": [],
        "encoders": [],
        "vaapi_version": None,
        "libva_version": None,
        "driver_version": None
    }
    
    vainfo_bin = shutil.which("vainfo")
    if not vainfo_bin:
        return caps
        
    try:
        env = os.environ.copy()
        env["DISPLAY"] = ""
        env["XDG_RUNTIME_DIR"] = ""
        
        res = subprocess.run(
            [vainfo_bin],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=3,
            env=env
        )
        output = (res.stdout or "") + "\n" + (res.stderr or "")
        
        # Parse version info
        va_api_match = re.search(r"VA-API version\s*:\s*([0-9.]+)", output, re.IGNORECASE)
        if not va_api_match:
            # Fallback to search in lines like "libva info: VA-API version 1.22.0"
            va_api_match = re.search(r"VA-API version\s*([0-9.]+)", output, re.IGNORECASE)
        if va_api_match:
            caps["vaapi_version"] = va_api_match.group(1)

        libva_match = re.search(r"libva\s*([0-9.]+)", output, re.IGNORECASE)
        if libva_match:
            caps["libva_version"] = libva_match.group(1)

        driver_match = re.search(r"Driver version\s*:\s*([^\n]+)", output, re.IGNORECASE)
        if driver_match:
            caps["driver_version"] = driver_match.group(1).strip()
            
        pattern = re.compile(r"^\s*(VAProfile[a-zA-Z0-9_]+)\s*:\s*(VAEntrypoint[a-zA-Z0-9_]+)", re.MULTILINE)
        for match in pattern.finditer(output):
            profile = match.group(1)
            entrypoint = match.group(2)
            
            profile_lower = profile.lower()
            codec_name = None
            
            if "h264" in profile_lower or "avc" in profile_lower:
                codec_name = "h264"
            elif "hevc" in profile_lower or "h265" in profile_lower:
                codec_name = "hevc"
            elif "vp9" in profile_lower:
                codec_name = "vp9"
            elif "vp8" in profile_lower:
                codec_name = "vp8"
            elif "mpeg2" in profile_lower:
                codec_name = "mpeg2"
            elif "jpeg" in profile_lower:
                codec_name = "mjpeg"
            elif "av1" in profile_lower:
                codec_name = "av1"
                
            if codec_name:
                entry_lower = entrypoint.lower()
                if "enc" in entry_lower:
                    if codec_name not in caps["encoders"]:
                        caps["encoders"].append(codec_name)
                elif "vld" in entry_lower:
                    if codec_name not in caps["decoders"]:
                        caps["decoders"].append(codec_name)
    except Exception as e:
        logger.warning(f"Failed to parse vainfo: {e}")
        
    return caps


def parse_nvenc_capabilities() -> dict:
    """Run nvidia-smi -q -x and parse driver, CUDA, and GPU hardware generations."""
    import shutil
    import subprocess
    import xml.etree.ElementTree as ET
    
    caps = {
        "gpu_name": None,
        "gpu_arch": None,
        "driver_version": None,
        "cuda_version": None,
        "encoders": [],
        "decoders": []
    }
    
    nvsmi_bin = shutil.which("nvidia-smi")
    if not nvsmi_bin:
        return caps
        
    try:
        res = subprocess.run(
            [nvsmi_bin, "-q", "-x"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=2
        )
        if res.returncode == 0:
            root = ET.fromstring(res.stdout)
            
            driver_el = root.find("driver_version")
            if driver_el is not None:
                caps["driver_version"] = driver_el.text.strip()
                
            cuda_el = root.find("cuda_version")
            if cuda_el is not None:
                caps["cuda_version"] = cuda_el.text.strip()
                
            gpu_el = root.find("gpu")
            if gpu_el is not None:
                prod_el = gpu_el.find("product_name")
                if prod_el is not None:
                    caps["gpu_name"] = prod_el.text.strip()
                arch_el = gpu_el.find("product_architecture")
                if arch_el is not None:
                    caps["gpu_arch"] = arch_el.text.strip()
    except Exception as e:
        logger.warning(f"Failed to parse nvidia-smi XML: {e}")
        
    return caps


def get_nvidia_codec_caps(gpu_name: str, gpu_arch: str, ffmpeg_encoders: list, ffmpeg_decoders: list) -> tuple:
    encoders = []
    decoders = []
    
    if not gpu_name:
        return encoders, decoders
        
    name = gpu_name.lower()
    arch = (gpu_arch or "").lower()
    
    # Base H.264/HEVC support (Kepler/Maxwell onwards)
    if "h264_nvenc" in ffmpeg_encoders:
        encoders.append("h264")
    if "hevc_nvenc" in ffmpeg_encoders:
        encoders.append("hevc")
        
    if "h264_cuvid" in ffmpeg_decoders:
        decoders.append("h264")
    if "hevc_cuvid" in ffmpeg_decoders:
        decoders.append("hevc")
    if "mjpeg_cuvid" in ffmpeg_decoders:
        decoders.append("mjpeg")
        
    # VP9 Decode support (Pascal onwards)
    is_pascal_or_newer = "pascal" in arch or "volta" in arch or "turing" in arch or "ampere" in arch or "ada" in arch or "hopper" in arch or "blackwell" in arch
    if not gpu_arch:
        is_pascal_or_newer = any(x in name for x in ["gtx 10", "rtx", "quadro p", "quadro rtx", "tesla p", "tesla t", "tesla v", "volta", "turing", "ampere", "ada", "grace", "blackwell", "a10", "a16", "a2", "a30", "a40", "l4"])
    if is_pascal_or_newer:
        if "vp9_cuvid" in ffmpeg_decoders:
            decoders.append("vp9")
            
    # AV1 Decode support (Ampere onwards)
    is_ampere_or_newer = "ampere" in arch or "ada" in arch or "hopper" in arch or "blackwell" in arch
    if not gpu_arch:
        is_ampere_or_newer = any(x in name for x in ["rtx 30", "rtx 40", "rtx a", "rtx 6000", "tesla a", "ada", "l4", "l40", "blackwell", "grace", "a10", "a16", "a2", "a30", "a40"])
    if is_ampere_or_newer:
        if "av1_cuvid" in ffmpeg_decoders:
            decoders.append("av1")
            
    # AV1 Encode support (Ada Lovelace onwards)
    is_ada_or_newer = "ada" in arch or "blackwell" in arch
    if not gpu_arch:
        is_ada_or_newer = any(x in name for x in ["rtx 40", "rtx 6000 ada", "l4", "l40", "blackwell", "ada"])
    if is_ada_or_newer:
        if "av1_nvenc" in ffmpeg_encoders:
            encoders.append("av1")
            
    return encoders, decoders


@app.get("/system/capabilities")
def get_system_capabilities():
    """Detect host system hardware capabilities (VAAPI, NVENC, V4L2, ALSA, DeckLink)."""
    import glob
    import shutil

    # VAAPI (Intel: 0x8086, AMD: 0x1002)
    vaapi_available = False
    vaapi_details = "No VAAPI compatible render nodes (Intel/AMD) found"
    
    render_nodes = glob.glob("/sys/class/drm/renderD*")
    detected_vendors = []
    for node in render_nodes:
        vendor_path = os.path.join(node, "device/vendor")
        if os.path.exists(vendor_path):
            try:
                with open(vendor_path, "r") as f:
                    vendor_id = f.read().strip().lower()
                detected_vendors.append(vendor_id)
                # 0x8086 = Intel, 0x1002 = AMD
                if "0x8086" in vendor_id or "0x1002" in vendor_id:
                    vaapi_available = True
                    vaapi_details = f"VAAPI compatible GPU detected (Intel/AMD) on node {os.path.basename(node)}"
                    break
            except Exception as e:
                pass
                
    if not vaapi_available and detected_vendors:
        vaapi_details = f"Render nodes found but no compatible Intel/AMD GPU (vendors: {', '.join(detected_vendors)})"

    # NVENC
    has_nvidia_hardware = shutil.which("nvidia-smi") is not None or os.path.exists("/dev/nvidia0")
    libcuda_loadable = False
    libnvenc_loadable = False

    if has_nvidia_hardware:
        import ctypes
        try:
            ctypes.CDLL("libcuda.so.1")
            libcuda_loadable = True
        except Exception:
            pass

        try:
            ctypes.CDLL("libnvidia-encode.so.1")
            libnvenc_loadable = True
        except Exception:
            pass

    nvenc_available = has_nvidia_hardware and libcuda_loadable and libnvenc_loadable

    if not has_nvidia_hardware:
        nvenc_details = "NVIDIA GPU not detected"
    elif not libcuda_loadable and not libnvenc_loadable:
        nvenc_details = "NVIDIA GPU detected, but libcuda.so.1 and libnvidia-encode.so.1 are missing. Install libcuda1 and libnvidia-encode1."
    elif not libcuda_loadable:
        nvenc_details = "NVIDIA GPU detected, but libcuda.so.1 is missing. Install libcuda1."
    elif not libnvenc_loadable:
        nvenc_details = "NVIDIA GPU detected, but libnvidia-encode.so.1 is missing. Install libnvidia-encode1."
    else:
        nvenc_details = "NVIDIA GPU and driver libraries detected"

    # Magewell Capture Hardware
    magewell_cards = []
    magewell_status = "NO_DEVICES"
    magewell_available = False
    magewell_details = "No Magewell capture hardware detected"
    magewell_driver_ver = None
    magewell_video_nodes = set()
    try:
        with SessionLocal() as db_session:
            mw_stat = magewell_manager.get_system_status(db_session)
        magewell_status = mw_stat.get("status", "NO_DEVICES")
        magewell_available = (magewell_status == "READY")
        magewell_driver_ver = mw_stat.get("driver_version")
        for card in mw_stat.get("cards", []):
            p_name = card.get("product_name", "Magewell Card")
            n_ch = card.get("num_channels", 1)
            if n_ch > 1:
                magewell_cards.append(f"{p_name} ({n_ch} channels)")
            else:
                magewell_cards.append(p_name)
            for ch in card.get("channels", []):
                if ch.get("device_path"):
                    magewell_video_nodes.add(ch.get("device_path"))
        
        if magewell_available:
            magewell_details = f"Detected {len(mw_stat.get('cards', []))} Magewell card(s) ({mw_stat.get('total_channels', 0)} channel(s))"
        elif magewell_status == "SETUP_REQUIRED":
            magewell_details = f"Magewell hardware detected on PCIe ({len(mw_stat.get('pcie_devices', []))} device(s)), but driver is not loaded"
            for dev in mw_stat.get("pcie_devices", []):
                magewell_cards.append(f"{dev.get('slot', 'PCIe')} (Driver Missing)")
    except Exception as e:
        logger.warning(f"Error querying Magewell devices for system_info: {e}")

    # V4L2
    v4l2_devices = glob.glob("/dev/video*")
    v4l2_available = len(v4l2_devices) > 0
    non_magewell_nodes = [d for d in v4l2_devices if d not in magewell_video_nodes]
    if non_magewell_nodes:
        v4l2_details = f"Detected generic video node(s): {', '.join(non_magewell_nodes)}"
    elif v4l2_devices and magewell_video_nodes:
        v4l2_details = f"Kernel V4L2 active ({len(v4l2_devices)} node(s) mapped to Magewell hardware)"
    elif v4l2_available:
        v4l2_details = f"Detected video nodes: {', '.join(v4l2_devices)}"
    else:
        v4l2_details = "No video nodes found in /dev/video*"

    # ALSA
    alsa_cards = []
    if os.path.exists("/proc/asound/cards"):
        try:
            import re
            with open("/proc/asound/cards", "r") as f:
                for line in f:
                    match = re.match(r"^\s*\d+\s*\[([^\]]+)\]", line)
                    if match:
                         card_name = match.group(1).strip()
                         if card_name not in alsa_cards:
                             alsa_cards.append(card_name)
            alsa_cards.sort()
        except Exception as e:
            logger.warning(f"Error parsing /proc/asound/cards: {e}")

    # DeckLink
    import glob
    decklink_cards = []
    decklink_nodes = glob.glob("/dev/blackmagic/io*") + glob.glob("/dev/blackmagic/dv*") + glob.glob("/dev/bm*")
    try:
        from core.decklink_manager import decklink_manager
        with SessionLocal() as db_session:
            devices = decklink_manager.list_devices_sync(db_session)
        if devices:
            seen_models = {}
            for d in devices:
                m = d.get("model_name") or d.get("display_name") or "DeckLink Device"
                seen_models[m] = seen_models.get(m, 0) + 1
            
            for m, count in seen_models.items():
                if count > 1:
                    decklink_cards.append(f"{m} ({count} sub-devices)")
                else:
                    decklink_cards.append(m)
    except Exception as e:
        logger.warning(f"Error querying DeckLink devices for system_info: {e}")

    decklink_available = len(decklink_cards) > 0 or len(decklink_nodes) > 0
    if decklink_cards:
        decklink_details = f"Detected {len(decklink_cards)} DeckLink / Intensity card(s)"
    elif decklink_available:
        decklink_details = f"DeckLink video driver active ({len(decklink_nodes)} device node(s) present)"
    else:
        decklink_details = "No physical DeckLink cards detected"

    # LCD Display Hardware
    lcd_available = False
    lcd_details = "No compatible Crystalfontz LCD detected"
    try:
        from core.lcd.driver_cfa635 import CFA635Driver
        detected_lcds = CFA635Driver.find_devices()
        lcd_available = len(detected_lcds) > 0
        if lcd_available:
            lcd_details = f"Detected LCD display device(s): {', '.join([d.get('port', '') for d in detected_lcds if d.get('port')])}"
        elif settings.lcd_enabled:
            lcd_available = True
            lcd_details = f"LCD enabled on configured port: {settings.lcd_port}"
    except Exception as e:
        logger.debug(f"Error checking LCD hardware for capabilities: {e}")

    # Avahi
    avahi_installed = os.path.exists("/usr/sbin/avahi-daemon") or shutil.which("avahi-daemon") is not None
    avahi_running = os.path.exists("/var/run/avahi-daemon/socket")
    avahi_available = avahi_installed and avahi_running
    if not avahi_installed:
        avahi_details = "Avahi daemon is not installed. Install avahi-daemon."
    elif not avahi_running:
        avahi_details = "Avahi daemon is installed but not running. Start avahi-daemon service."
    else:
        avahi_details = "Avahi daemon is active and running."

    # Dynamic FFmpeg capability discovery
    ffmpeg_bin = get_effective_ffmpeg_path()
    supported_filters = []
    supported_encoders = []
    supported_decoders = []
    
    ffmpeg_exists = os.path.exists(ffmpeg_bin) if os.path.isabs(ffmpeg_bin) else shutil.which(ffmpeg_bin) is not None
    if ffmpeg_exists:
        import subprocess
        try:
            # Query filters
            res_filters = subprocess.run([ffmpeg_bin, "-filters"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=2)
            if res_filters.returncode == 0:
                for line in res_filters.stdout.split('\n'):
                    parts = line.split()
                    if len(parts) >= 2 and not parts[0].startswith('-') and not parts[0].startswith('F'):
                        supported_filters.append(parts[1])
            
            # Query encoders
            res_encoders = subprocess.run([ffmpeg_bin, "-encoders"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=2)
            if res_encoders.returncode == 0:
                for line in res_encoders.stdout.split('\n'):
                    parts = line.split()
                    if len(parts) >= 2 and not parts[0].startswith('-') and not parts[0].startswith('E'):
                        supported_encoders.append(parts[1])

            # Query decoders
            res_decoders = subprocess.run([ffmpeg_bin, "-decoders"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=2)
            if res_decoders.returncode == 0:
                for line in res_decoders.stdout.split('\n'):
                    parts = line.split()
                    if len(parts) >= 2 and not parts[0].startswith('-') and not parts[0].startswith('D'):
                        supported_decoders.append(parts[1])
        except Exception as e:
            logger.warning(f"Error querying active ffmpeg binary capabilities at {ffmpeg_bin}: {e}")

    # VA-API codecs dynamic discovery
    vaapi_caps = parse_vainfo_capabilities()
    vainfo_installed = shutil.which("vainfo") is not None

    # NVENC codecs dynamic discovery
    nvenc_caps = parse_nvenc_capabilities()
    if nvenc_available:
        gpu_name = nvenc_caps["gpu_name"] or "Generic NVIDIA GPU"
        nv_encs, nv_decs = get_nvidia_codec_caps(
            gpu_name,
            nvenc_caps["gpu_arch"],
            supported_encoders,
            supported_decoders
        )
        nvenc_caps["encoders"] = nv_encs
        nvenc_caps["decoders"] = nv_decs

    return {
        "vaapi": {
            "available": vaapi_available,
            "details": vaapi_details,
            "encoders": vaapi_caps["encoders"],
            "decoders": vaapi_caps["decoders"],
            "vainfo_installed": vainfo_installed,
            "vaapi_version": vaapi_caps["vaapi_version"],
            "libva_version": vaapi_caps["libva_version"],
            "driver_version": vaapi_caps["driver_version"]
        },
        "nvenc": {
            "available": nvenc_available,
            "details": nvenc_details,
            "gpu_name": nvenc_caps["gpu_name"],
            "gpu_arch": nvenc_caps["gpu_arch"],
            "driver_version": nvenc_caps["driver_version"],
            "cuda_version": nvenc_caps["cuda_version"],
            "encoders": nvenc_caps["encoders"],
            "decoders": nvenc_caps["decoders"]
        },
        "v4l2": {"available": v4l2_available, "details": v4l2_details},
        "alsa": {"available": len(alsa_cards) > 0, "details": f"Detected {len(alsa_cards)} ALSA sound card(s)" if alsa_cards else "No physical or virtual ALSA sound cards detected", "cards": alsa_cards},
        "decklink": {"available": decklink_available, "details": decklink_details, "cards": decklink_cards},
        "magewell": {
            "available": magewell_available,
            "status": magewell_status,
            "details": magewell_details,
            "cards": magewell_cards,
            "driver_version": magewell_driver_ver
        },
        "lcd": {"available": lcd_available, "details": lcd_details},
        "avahi": {"available": avahi_available, "details": avahi_details},
        "ffmpeg": {
            "filters": supported_filters,
            "encoders": supported_encoders,
            "decoders": supported_decoders
        }
    }


def get_effective_ffmpeg_path() -> str:
    from database.models import FfmpegBuild
    from database.db import SessionLocal
    import os
    
    db = SessionLocal()
    try:
        build = db.query(FfmpegBuild).filter(FfmpegBuild.is_default == True, FfmpegBuild.status == 'ready').first()
        if not build:
            build = db.query(FfmpegBuild).filter(FfmpegBuild.status == 'ready').first()
            
        if build and build.ffmpeg_binary and os.path.exists(build.ffmpeg_binary):
            return build.ffmpeg_binary
    except Exception as e:
        logger.warning(f"Error querying active ffmpeg build from DB: {e}")
    finally:
        db.close()
        
    return process_manager.ffmpeg_path


@app.get("/v4l2/devices")
async def get_v4l2_devices_route():
    return await get_v4l2_devices()


@app.get("/v4l2/formats")
async def get_v4l2_formats_route(device: str):
    ffmpeg_bin = get_effective_ffmpeg_path()
    return await get_v4l2_formats(device, ffmpeg_binary=ffmpeg_bin)


@app.get("/alsa/devices")
async def get_alsa_devices_route():
    return await get_alsa_devices()


@app.get("/alsa/playback-devices")
async def get_alsa_playback_devices_route():
    return await get_alsa_playback_devices()



@app.get("/decklink/devices")
async def get_decklink_devices():
    import re
    ffmpeg_bin = get_effective_ffmpeg_path()
    inputs = []
    outputs = []

    # 1. Query inputs
    try:
        proc = await asyncio.create_subprocess_exec(
            ffmpeg_bin, "-sources", "decklink",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=5.0)
        output = stdout.decode('utf-8', errors='replace') + stderr.decode('utf-8', errors='replace')
        
        for line in output.splitlines():
            line = line.strip()
            brackets = re.findall(r'\[([^\]]+)\]', line)
            for item in brackets:
                item_clean = item.strip()
                if not any(p in item_clean for p in ("decklink", "in#", "out#", "@")):
                    inputs.append(item_clean)
    except Exception as e:
        logger.warning(f"Error querying decklink sources: {e}")

    if not inputs:
        try:
            proc = await asyncio.create_subprocess_exec(
                ffmpeg_bin, "-f", "decklink", "-list_devices", "1", "-i", "dummy",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=5.0)
            output = stderr.decode('utf-8', errors='replace')
            
            in_input_devices = False
            for line in output.splitlines():
                line = line.strip()
                if "Blackmagic DeckLink input devices:" in line:
                    in_input_devices = True
                    continue
                elif "devices:" in line:
                    in_input_devices = False
                    continue
                
                if in_input_devices and not any(k in line for k in ("Error", "opening", "Failed")):
                    match = re.search(r"'(.*?)'", line)
                    if match:
                        inputs.append(match.group(1))
        except Exception as e:
            logger.warning(f"Error fallback querying decklink sources: {e}")

    # 2. Query outputs
    try:
        proc = await asyncio.create_subprocess_exec(
            ffmpeg_bin, "-sinks", "decklink",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=5.0)
        output = stdout.decode('utf-8', errors='replace') + stderr.decode('utf-8', errors='replace')
        
        for line in output.splitlines():
            line = line.strip()
            brackets = re.findall(r'\[([^\]]+)\]', line)
            for item in brackets:
                item_clean = item.strip()
                if not any(p in item_clean for p in ("decklink", "in#", "out#", "@")):
                    outputs.append(item_clean)
    except Exception as e:
        logger.warning(f"Error querying decklink sinks: {e}")

    if not outputs:
        try:
            proc = await asyncio.create_subprocess_exec(
                ffmpeg_bin, "-f", "lavfi", "-t", "1", "-i", "nullsrc", "-f", "decklink", "-list_devices", "1", "dummy",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=5.0)
            output = stderr.decode('utf-8', errors='replace')
            
            in_output_devices = False
            for line in output.splitlines():
                line = line.strip()
                if "Blackmagic DeckLink output devices:" in line:
                    in_output_devices = True
                    continue
                elif "devices:" in line:
                    in_output_devices = False
                    continue
                
                if in_output_devices and not any(k in line for k in ("Error", "opening", "Failed")):
                    match = re.search(r"'(.*?)'", line)
                    if match:
                        outputs.append(match.group(1))
        except Exception as e:
            logger.warning(f"Error fallback querying decklink sinks: {e}")

    return {
        "inputs": list(dict.fromkeys(inputs)),
        "outputs": list(dict.fromkeys(outputs))
    }


@app.get("/decklink/formats")
async def get_decklink_formats(device: str):
    import re
    ffmpeg_bin = get_effective_ffmpeg_path()
    formats = []
    try:
        proc = await asyncio.create_subprocess_exec(
            ffmpeg_bin, "-f", "decklink", "-list_formats", "1", "-i", device,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=5.0)
        output = stderr.decode('utf-8', errors='replace')
        
        start_parsing = False
        for line in output.splitlines():
            line = line.strip()
            if "Error opening" in line or "Unsupported" in line:
                continue
            if "format_code" in line and "description" in line:
                start_parsing = True
                continue
            if start_parsing:
                line_clean = re.sub(r'^\[[^\]]+\]\s*', '', line).strip()
                if not line_clean:
                    continue
                parts = line_clean.split(None, 1)
                if len(parts) == 2:
                    code, desc = parts
                    if re.match(r'^[a-zA-Z0-9]{3,6}$', code) and code != "format":
                        formats.append({"code": code, "description": desc.strip()})
    except Exception as e:
        logger.warning(f"Error listing decklink formats: {e}")
    
    return formats


@app.get("/ndi/sources")
async def get_ndi_sources(build_id: Optional[int] = None):
    import re
    import os
    from database.models import FfmpegBuild
    from database.db import SessionLocal

    # 1. Resolve ffmpeg binary
    ffmpeg_bin = None
    if build_id is not None:
        db = SessionLocal()
        try:
            build = db.query(FfmpegBuild).filter(FfmpegBuild.id == build_id, FfmpegBuild.status == 'ready').first()
            if build and build.ffmpeg_binary and os.path.exists(build.ffmpeg_binary):
                ffmpeg_bin = build.ffmpeg_binary
        except Exception as e:
            logger.warning(f"Error querying ffmpeg build {build_id} from DB: {e}")
        finally:
            db.close()

    if not ffmpeg_bin:
        ffmpeg_bin = get_effective_ffmpeg_path()

    sources = []
    logger.info(f"Scanning NDI sources using binary: {ffmpeg_bin} (build_id query param: {build_id})")
    try:
        proc = await asyncio.create_subprocess_exec(
            ffmpeg_bin, "-f", "libndi_newtek", "-find_sources", "1", "-i", "dummy",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10.0)
            output = stdout.decode('utf-8', errors='replace') + stderr.decode('utf-8', errors='replace')
        except asyncio.TimeoutExpired:
            logger.warning("NDI sources scan timed out. Killing subprocess.")
            proc.kill()
            stdout, stderr = await proc.communicate()
            output = stdout.decode('utf-8', errors='replace') + stderr.decode('utf-8', errors='replace')

        logger.info(f"NDI scan finished with return code {proc.returncode}")
        logger.info(f"NDI scan raw output:\n{output}")

        for line in output.splitlines():
            if "[libndi_newtek" in line:
                quotes = re.findall(r"'([^']+)'", line)
                if quotes:
                    name = quotes[0]
                    if name not in sources:
                        sources.append(name)
                        logger.info(f"Detected NDI source: {name}")
    except Exception as e:
        logger.error(f"Error scanning NDI sources: {e}")

    return {"sources": sources}





# ── WebSocket Connection Manager ──────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            await connection.send_json(message)

manager = ConnectionManager()

# Per-build WebSocket connections for compile logs
build_ws_connections: dict[int, list[WebSocket]] = {}


# ── Telemetry WebSocket ──────────────────────────────────────────

@app.websocket("/ws/telemetry")
async def websocket_telemetry(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

async def telemetry_broadcast_loop():
    gpu_sensor = GPUSensor()
    psutil.cpu_percent(interval=None)
    while True:
        try:
            processes_data = []
            exec_data = []
            task_stats = {}
            storages_data = []
            
            with SessionLocal() as db:
                from core.dependency_manager import dependency_manager
                from database.models import ServiceDependency
                all_deps = db.query(ServiceDependency).all()
                deps_by_proc = {}
                for d in all_deps:
                    if d.consumer_type == 'service':
                        if d.consumer_id not in deps_by_proc:
                            deps_by_proc[d.consumer_id] = []
                        deps_by_proc[d.consumer_id].append({
                            "provider_service_id": d.provider_service_id,
                            "provider_name": d.provider_service.name if d.provider_service else f"Service #{d.provider_service_id}",
                            "is_auto_managed": d.is_auto_managed
                        })

                processes = db.query(MediaProcess).all()
                processes_data = [
                    {
                        "id": p.id,
                        "name": p.name,
                        "alias": p.alias,
                        "type": p.type,
                        "service_type": getattr(p, "service_type", "ffmpeg_stream") or "ffmpeg_stream",
                        "config": p.config or {},
                        "status": p.status,
                        "pid": p.pid,
                        "cpu": p.cpu_usage,
                        "ram": p.ram_usage,
                        "bitrate": p.bitrate,
                        "fps": p.fps,
                        "speed": p.speed,
                        "ffmpeg_build_id": p.ffmpeg_build_id,
                        "input_config": p.input_config,
                        "output_config": p.output_config,
                        "codec_config": p.codec_config,
                        "filter_config": p.filter_config,
                        "auto_start": p.auto_start,
                        "startup_order": getattr(p, 'startup_order', 1) or 1,
                        "startup_delay": getattr(p, 'startup_delay', 0) or 0,
                        "watchdog_enabled": p.watchdog_enabled,
                        "watchdog_retries": p.watchdog_retries,
                        "watchdog_min_speed": p.watchdog_min_speed,
                        "watchdog_min_speed_duration": p.watchdog_min_speed_duration,
                        "pending_changes": p.pending_changes,
                        "allow_auto_start_deps": getattr(p, 'allow_auto_start_deps', True),
                        "allow_auto_stop_deps": getattr(p, 'allow_auto_stop_deps', True),
                        "active_leases": dependency_manager.get_active_leases(p.id),
                        "is_pinned": dependency_manager.is_pinned(p.id),
                        "dependencies": deps_by_proc.get(p.id, []),
                        "last_start": p.last_start.isoformat() + "Z" if p.last_start else None,
                        "last_stop": p.last_stop.isoformat() + "Z" if p.last_stop else None,
                        "restart_count": p.restart_count,
                        "network_timeout": p.network_timeout,
                        "debug_mode": p.debug_mode,
                        "log_storage_id": p.log_storage_id,
                    } for p in processes
                ]

                active_executions = db.query(TaskExecution).filter(TaskExecution.status.in_(["running", "pending"])).all()
                exec_data = [
                    {
                        "id": ex.id,
                        "task_id": ex.task_id,
                        "task_name": ex.task.name if ex.task else "Unknown",
                        "status": ex.status,
                        "pid": ex.pid,
                        "cpu": ex.cpu_usage,
                        "ram": ex.ram_usage,
                        "bitrate": ex.bitrate,
                        "fps": ex.fps,
                        "speed": ex.speed,
                        "started_at": ex.started_at.isoformat() if ex.started_at else None,
                    } for ex in active_executions
                ]
                
                # Task statistics
                scheduled_count = db.query(ScheduledTask).filter(
                    ScheduledTask.is_active == True,
                    ScheduledTask.schedule_type.in_(["recurring", "one_shot"])
                ).count()
                
                inactive_count = db.query(ScheduledTask).filter(
                    (ScheduledTask.is_active == False) | (ScheduledTask.schedule_type == "manual")
                ).count()
                
                active_exec_count = db.query(TaskExecution).filter(
                    TaskExecution.status == "running"
                ).count()
                
                task_stats = {
                    "active": active_exec_count,
                    "scheduled": scheduled_count,
                    "inactive": inactive_count
                }

                # Query upcoming scheduled tasks ordered by next_run
                upcoming_tasks = db.query(ScheduledTask).filter(
                    ScheduledTask.is_active == True,
                    ScheduledTask.schedule_type.in_(["recurring", "one_shot"]),
                    ScheduledTask.next_run != None
                ).order_by(ScheduledTask.next_run.asc()).limit(5).all()

                upcoming_data = [
                    {
                        "id": t.id,
                        "name": t.name,
                        "alias": t.alias,
                        "is_system": t.is_system,
                        "schedule_type": t.schedule_type,
                        "schedule_cron": t.schedule_cron,
                        "next_run": t.next_run.isoformat() + ("Z" if not t.next_run.isoformat().endswith("Z") else "") if t.next_run else None,
                    } for t in upcoming_tasks
                ]

                # Query all configured storages
                storages = db.query(Storage).all()
                for s in storages:
                    try:
                        usage = shutil.disk_usage(s.path)
                        total = usage.total
                        used = usage.used
                        free = usage.free
                        percent = round((used / total) * 100, 2) if total > 0 else 0.0
                    except (FileNotFoundError, PermissionError):
                        total = 0
                        used = 0
                        free = 0
                        percent = 0.0
                    
                    if percent > 90.0:
                        if s.id not in alerted_storages:
                            alerted_storages.add(s.id)
                            notify_storage_alert(storage_id=s.id, storage_name=s.name, storage_path=s.path, percent=percent)
                    else:
                        alerted_storages.discard(s.id)

                    storages_data.append({
                        "id": s.id,
                        "name": s.name,
                        "type": s.type,
                        "path": s.path,
                        "is_default": s.is_default,
                        "total_gb": round(total / (1024 ** 3), 2),
                        "used_gb": round(used / (1024 ** 3), 2),
                        "free_gb": round(free / (1024 ** 3), 2),
                        "percent": percent
                    })
            
            # Gather global host system metrics (outside database session block)
            sys_cpu = psutil.cpu_percent(interval=None)
            sys_ram = psutil.virtual_memory()
            gpu_stats = await asyncio.to_thread(gpu_sensor.get_stats)
            
            global lcd_manager
            system_data = {
                "cpu": sys_cpu,
                "ram_used": int(sys_ram.used / (1024 * 1024)), # MB
                "ram_total": int(sys_ram.total / (1024 * 1024)), # MB
                "gpu": gpu_stats,
                "host_os_arch": f"{platform.system()} {platform.machine()}",
                "backend_version": backend_version,
                "schema_version": schema_version,
                "lcd": {
                    "connected": lcd_manager is not None and lcd_manager._running,
                    "port": lcd_manager.port if lcd_manager else None
                }
            }

            await manager.broadcast({
                "type": "telemetry",
                "data": processes_data,
                "task_executions": exec_data,
                "upcoming_tasks": upcoming_data,
                "system": system_data,
                "task_stats": task_stats,
                "storages": storages_data
            })
        except Exception as e:
            logger.exception(f"Error in telemetry broadcast loop: {e}")
        await asyncio.sleep(1)

async def auto_start_services():
    config_path = os.environ.get("CONFIG_FILE_PATH")
    if not config_path:
        config_path = "ffmpeg-gui.conf"
    grace_delay = 10
    if os.path.exists(config_path):
        try:
            import configparser
            cfg = configparser.ConfigParser()
            cfg.read(config_path)
            if "watchdog" in cfg:
                grace_delay = cfg.getint("watchdog", "startup_grace_delay", fallback=10)
        except Exception:
            pass

    logger.info(f"Watchdog / Auto-start: Waiting startup grace delay ({grace_delay}s)...")
    await asyncio.sleep(grace_delay)
    logger.info("Watchdog / Auto-start: Initializing service startup checks...")
    
    with SessionLocal() as db:
        all_services = db.query(MediaProcess).all()
        auto_start_services = [s for s in all_services if getattr(s, 'auto_start', False)]

        sorted_services = sorted(
            auto_start_services,
            key=lambda s: (
                s.startup_order if getattr(s, 'startup_order', None) is not None else 1,
                s.startup_delay if getattr(s, 'startup_delay', None) is not None else 0,
                s.id
            )
        )
        service_data = [
            {
                "id": s.id,
                "name": s.name,
                "order": getattr(s, 'startup_order', 1) or 1,
                "delay": getattr(s, 'startup_delay', 0) or 0
            }
            for s in sorted_services
        ]
        
    import random
    current_order = None
    for s_info in service_data:
        s_id = s_info["id"]
        s_name = s_info["name"]
        s_order = s_info["order"]
        s_delay = s_info["delay"]

        if s_id in process_manager.processes:
            logger.info(f"Auto-start: Service '{s_name}' (ID {s_id}) is already running/reattached. Skipping auto-start.")
            continue
            
        if current_order is not None and s_order != current_order:
            logger.info(f"Auto-start: Moving to Boot Order Tier #{s_order}...")
        current_order = s_order

        if s_delay > 0:
            logger.info(f"Auto-start [Order #{s_order}]: Service '{s_name}' (ID {s_id}) waiting configured startup delay ({s_delay}s)...")
            await asyncio.sleep(s_delay)

        jitter = random.uniform(0.05, 0.25)
        await asyncio.sleep(jitter)

        logger.info(f"Auto-starting service '{s_name}' (ID: {s_id}, Order #{s_order}, Delay: {s_delay}s)")
        try:
            await process_manager.start_process(s_id)
        except Exception as e:
            logger.error(f"Failed to auto-start service {s_id} ({s_name}): {e}")

# Global LCD Manager instance
lcd_manager = None

def sanitize_process_config_data(input_config: dict, filter_config: dict) -> bool:
    """
    Sanitize input_config and filter_config for non-decodable inputs.
    Mutates dicts in-place. Returns True if any changes were made.
    """
    _HWACCEL_UNSUPPORTED_INPUT_TYPES = {'lavfi_video', 'lavfi_audio', 'alsa'}
    is_dirty = False
    
    if not input_config:
        return is_dirty
        
    # Check input1 / input2 or flat config
    if 'input1' in input_config:
        inp1 = input_config['input1']
        if inp1.get('type') in _HWACCEL_UNSUPPORTED_INPUT_TYPES:
            if inp1.get('hwaccel') != 'none' or inp1.get('frames_destination') != 'cpu' or inp1.get('hwaccel_output_format') != '':
                inp1['hwaccel'] = 'none'
                inp1['frames_destination'] = 'cpu'
                inp1['hwaccel_output_format'] = ''
                is_dirty = True
        if input_config.get('use_secondary_input') and 'input2' in input_config:
            inp2 = input_config['input2']
            if inp2.get('type') in _HWACCEL_UNSUPPORTED_INPUT_TYPES:
                if inp2.get('hwaccel') != 'none' or inp2.get('frames_destination') != 'cpu' or inp2.get('hwaccel_output_format') != '':
                    inp2['hwaccel'] = 'none'
                    inp2['frames_destination'] = 'cpu'
                    inp2['hwaccel_output_format'] = ''
                    is_dirty = True
    else:
        if input_config.get('type') in _HWACCEL_UNSUPPORTED_INPUT_TYPES:
            if input_config.get('hwaccel') != 'none' or input_config.get('frames_destination') != 'cpu' or input_config.get('hwaccel_output_format') != '':
                input_config['hwaccel'] = 'none'
                input_config['frames_destination'] = 'cpu'
                input_config['hwaccel_output_format'] = ''
                is_dirty = True

    # Check global/advanced hwaccel if primary input is unsupported
    primary_input_type = (
        input_config['input1'].get('type', '') if 'input1' in input_config
        else input_config.get('type', '')
    )
    if primary_input_type in _HWACCEL_UNSUPPORTED_INPUT_TYPES and filter_config:
        advanced = filter_config.get('advanced', {})
        if advanced.get('hwaccel') and advanced.get('hwaccel') != 'none':
            advanced['hwaccel'] = 'none'
            advanced['hwaccel_output_format'] = ''
            filter_config['advanced'] = advanced
            is_dirty = True

    return is_dirty

def sanitize_database_processes(db: Session):
    """Scan all processes in the database and fix invalid GPU/VRAM configs."""
    from sqlalchemy.orm.attributes import flag_modified
    import copy
    processes = db.query(MediaProcess).all()
    updated_count = 0
    for p in processes:
        input_cfg = copy.deepcopy(p.input_config) if p.input_config else {}
        filter_cfg = copy.deepcopy(p.filter_config) if p.filter_config else {}
        if sanitize_process_config_data(input_cfg, filter_cfg):
            p.input_config = input_cfg
            p.filter_config = filter_cfg
            try:
                flag_modified(p, "input_config")
                flag_modified(p, "filter_config")
            except Exception:
                pass
            updated_count += 1
            
    if updated_count > 0:
        db.commit()
        logger.info(f"Sanitized {updated_count} process configurations in database with inconsistent GPU settings.")

@app.on_event("startup")
async def startup_event():
    global _startup_initialized
    with _startup_lock:
        if _startup_initialized:
            logger.debug("Startup: Background services already initialized for this process. Skipping duplicate startup invocation.")
            return
        _startup_initialized = True

    logger.info("Startup: Checking and cleaning up stale build profiles, processes and tasks...")
    active_pids = set()
    try:
        with SessionLocal() as db:
            # Clean up stale DB configurations on startup
            try:
                sanitize_database_processes(db)
            except Exception as e:
                logger.error(f"Failed to sanitize database processes on startup: {e}")

            stale_builds = db.query(FfmpegBuild).filter(FfmpegBuild.status == "building").all()
            for build in stale_builds:
                build.status = "failed"
                build.build_log_summary = "Build aborted (server restarted)"
                logger.info(f"Cleaned up stale build profile ID {build.id} on startup.")
            
            non_stopped_processes = db.query(MediaProcess).filter(MediaProcess.status.in_(["running", "starting", "restarting", "error"])).all()
            for p in non_stopped_processes:
                if p.status == "running" and p.pid and psutil.pid_exists(p.pid):
                    if p.debug_mode:
                        logger.info(f"Startup: Process '{p.name}' (ID: {p.id}) is in debug mode. Cannot re-attach live pipes. Marking as stopped to force restart.")
                        p.status = "stopped"
                        p.restart_count = 0
                        p.pid = None
                        p.cpu_usage = 0
                        p.ram_usage = 0
                        p.fps = "0"
                        p.bitrate = "0 kb/s"
                        p.speed = "0x"
                    else:
                        logger.info(f"Startup: Process '{p.name}' (ID: {p.id}) is alive with PID {p.pid}. Re-attaching watchdog.")
                        process_manager.reattach_process(p.id, p.pid)
                        active_pids.add(p.pid)
                else:
                    logger.info(f"Startup: Process '{p.name}' (ID: {p.id}) is NOT alive in OS (status was {p.status}). Cleaning up.")
                    p.status = "stopped"
                    p.restart_count = 0
                    p.pid = None
                    p.cpu_usage = 0
                    p.ram_usage = 0
                    p.fps = "0"
                    p.bitrate = "0 kb/s"
                    p.speed = "0x"
            
            all_processes = db.query(MediaProcess).all()
            for p in all_processes:
                if p.id in process_manager.processes or (p.status == "running" and p.pid and psutil.pid_exists(p.pid)):
                    logger.info(f"Startup: Skipping file permissions reset for running process '{p.name}' (ID: {p.id}) to preserve active progress logs.")
                    continue
                try:
                    prepare_process_file_permissions(process_id=p.id, logger=logger)
                except Exception as p_err:
                    logger.debug(f"Failed to prepare file permissions for process {p.id}: {p_err}")

            stale_executions = db.query(TaskExecution).filter(TaskExecution.status == "running").all()
            for ex in stale_executions:
                ex.status = "interrupted"
                ex.error_message = "Server restarted during execution"
                ex.stopped_at = datetime.datetime.utcnow()
                ex.pid = None
                ex.cpu_usage = 0
                ex.ram_usage = 0
                logger.info(f"Cleaned up stale running task execution ID {ex.id} on startup.")
            db.commit()
    except Exception as e:
        logger.error(f"Failed to clean up stale builds/processes/tasks on startup: {e}")

    try:
        cleanup_rogue_processes(active_pids=active_pids)
    except Exception as e:
        logger.error(f"Failed to clean up rogue processes on startup: {e}")

    # Start LCD Manager if enabled
    global lcd_manager
    try:
        with SessionLocal() as db:
            from database.models import SystemSettings
            settings = db.query(SystemSettings).first()
            if settings and settings.lcd_enabled:
                from core.lcd.manager import LCDManager
                lcd_manager = LCDManager(
                    db_session_factory=SessionLocal,
                    process_manager=process_manager,
                    task_manager=task_manager,
                    port=settings.lcd_port
                )
                lcd_manager.start()
    except Exception as e:
        logger.error(f"Failed to start LCD manager on startup: {e}")

    # Synchronize and auto-detect dependencies for all existing services and tasks
    try:
        with SessionLocal() as db:
            from core.dependency_manager import dependency_manager
            from database.models import Service, ScheduledTask
            for s in db.query(Service).all():
                dependency_manager.sync_auto_dependencies('service', s.id, s.input_config, s.output_config, db)
            for t in db.query(ScheduledTask).all():
                dependency_manager.sync_auto_dependencies('task', t.id, t.input_config, t.output_config, db)
            logger.info("Auto-synchronized service and task dependencies on startup.")
    except Exception as e:
        logger.error(f"Failed to auto-sync dependencies on startup: {e}")

    asyncio.create_task(telemetry_broadcast_loop())
    asyncio.create_task(auto_start_services())
    asyncio.create_task(task_manager.execute_on_boot_cleanup())
    await scheduler.start()

    try:
        config_path = os.environ.get("CONFIG_FILE_PATH") or "ffmpeg-gui.conf"
        if os.path.exists(config_path):
            import configparser
            config = configparser.ConfigParser()
            config.read(config_path)
            if "notifications" in config:
                notification_manager.load_config(dict(config["notifications"]))
    except Exception as e:
        logger.error(f"Failed to load notification config on startup: {e}")

    try:
        notification_manager.start_worker()
    except Exception as e:
        logger.error(f"Failed to start notification worker on startup: {e}")

@app.on_event("shutdown")
async def shutdown_event():
    global _shutdown_initialized
    with _shutdown_lock:
        if _shutdown_initialized:
            logger.debug("Shutdown: Orchestrator teardown already executed for this process. Skipping duplicate shutdown call.")
            return
        _shutdown_initialized = True

    logger.info("Shutdown: Stopping scheduler...")
    await scheduler.stop()
    
    try:
        notification_manager.stop_worker()
    except Exception as e:
        logger.error(f"Failed to stop notification worker on shutdown: {e}")

    global lcd_manager
    if lcd_manager:
        logger.info("Shutdown: Stopping LCD manager...")
        lcd_manager.stop()

    if is_reload_mode:
        logger.info("Shutdown: Warm Reload mode active. Preserving child stream processes for re-attach on reload.")
    else:
        logger.info("Shutdown: Clean Stop mode active. Stopping all managed child stream processes...")
        try:
            await process_manager.stop_all_processes(graceful=True)
        except Exception as e:
            logger.error(f"Failed to stop all processes on shutdown: {e}")


alerted_storages = set()

def notify_build_result(build_id: int, build_name: str, success: bool, version_output: Optional[str] = None, disk_usage_mb: Optional[float] = None, auto_clean: bool = False, error_msg: Optional[str] = None):
    nm = NotificationManager()
    if nm.is_enabled() and nm.config.get("notify_build_results", True):
        if success:
            subject = f"[FFmpeg-GUI Alert] FFmpeg Build Successful: {build_name}"
            body_parts = [
                f"FFmpeg compilation for profile '{build_name}' (ID: {build_id}) completed successfully.\n",
                "━━━ FFMPEG BUILD SUCCESSFUL ━━━\n"
            ]
            if version_output:
                body_parts.append(version_output.strip())
            else:
                body_parts.append("FFmpeg binary created and verified.")

            if disk_usage_mb is not None:
                body_parts.append(f"\nDisk Usage: {disk_usage_mb} MB")

            if auto_clean:
                body_parts.append("\n━━━ AUTO-CLEAN ENABLED ━━━\nCleaning temporary build sources to save space...\nSources cleaned successfully.")

            body = "\n".join(body_parts)
        else:
            subject = f"[FFmpeg-GUI Alert] FFmpeg Build Failed: {build_name}"
            body = f"FFmpeg compilation for profile '{build_name}' (ID: {build_id}) failed.\n\n━━━ FFMPEG BUILD FAILED ━━━\n\nError details / Log summary:\n{error_msg or 'Unknown compilation error.'}"

        nm.enqueue_notification({
            "subject": subject,
            "body": body
        })

def notify_ssl_warning(domain: str, days_remaining: int, error_msg: Optional[str] = None):
    nm = NotificationManager()
    if nm.is_enabled() and nm.config.get("notify_ssl_alerts", True):
        body = f"SSL Certificate for domain '{domain}' expires in {days_remaining} days."
        if error_msg:
            body += f"\nDetails: {error_msg}"
        nm.enqueue_notification({
            "subject": f"[FFmpeg-GUI Alert] SSL Certificate Warning: {domain}",
            "body": body
        })

def notify_storage_alert(storage_id: int, storage_name: str, storage_path: str, percent: float):
    nm = NotificationManager()
    if nm.is_enabled() and nm.config.get("notify_storage_alerts", True):
        nm.enqueue_notification({
            "subject": f"[FFmpeg-GUI Alert] Storage Space Warning: {storage_name}",
            "body": f"Storage '{storage_name}' ({storage_path}) space usage is at {percent}%, exceeding the 90% threshold."
        })


# ── Build WebSocket (per-build log streaming) ────────────────────

@app.websocket("/ws/build/{build_id}")
async def websocket_build(websocket: WebSocket, build_id: int):
    await websocket.accept()
    
    # Send existing logs from file if it exists
    with SessionLocal() as db_session:
        build = db_session.query(FfmpegBuild).get(build_id)
        storage_path = build.storage.path if build and build.storage else None
    log_file_path = os.path.join(build_manager.get_build_path(build_id, builds_root=storage_path), "build.log")
    if os.path.exists(log_file_path):
        try:
            with open(log_file_path, "r", errors="replace") as f:
                content = f.read()
                if content:
                    # Send split lines to match line-by-line format expected by frontend
                    for line in content.splitlines(keepends=True):
                        await websocket.send_text(line)
        except Exception as e:
            logger.error(f"Error sending initial build logs: {e}")

    if build_id not in build_ws_connections:
        build_ws_connections[build_id] = []
    build_ws_connections[build_id].append(websocket)
    try:
        while True:
            await websocket.receive_text()
    except (WebSocketDisconnect, Exception):
        build_ws_connections[build_id].remove(websocket)
        if not build_ws_connections[build_id]:
            del build_ws_connections[build_id]


# ── Root ──────────────────────────────────────────────────────────

@app.get("/api/status")
def read_root() -> dict:
    global lcd_manager
    return {
        "status": "online", 
        "message": "FFMPEG Orchestrator API is running",
        "version": backend_version,
        "schema_version": schema_version,
        "lcd": {
            "connected": lcd_manager is not None and lcd_manager._running,
            "port": lcd_manager.port if lcd_manager else None
        }
    }

@app.post("/settings/lcd/probe")
def probe_lcd_ports():
    import serial.tools.list_ports
    from core.lcd.drivers.cfa635 import Cfa635Driver
    
    ports = serial.tools.list_ports.comports()
    detected_ports = []
    
    global lcd_manager
    
    # List of registered drivers to try
    drivers = [Cfa635Driver]
    
    for port_info in ports:
        port_device = port_info.device
        
        # If the port is currently used by our active manager, skip serial open probe
        if lcd_manager and lcd_manager._running and lcd_manager.port == port_device:
            detected_ports.append({
                "port": port_device,
                "driver": "Cfa635Driver",
                "description": f"{port_info.description} (Active)"
            })
            continue
            
        for driver in drivers:
            if driver.probe(port_device):
                detected_ports.append({
                    "port": port_device,
                    "driver": driver.__name__,
                    "description": port_info.description
                })
                break
                
    return {"ports": detected_ports}

class LocatorRequest(BaseModel):
    active: bool

@app.post("/api/lcd/locator")
def toggle_lcd_locator(req: LocatorRequest):
    global lcd_manager
    if not lcd_manager or not lcd_manager._running:
        raise HTTPException(status_code=400, detail="LCD subsystem not connected")
    lcd_manager.locator_active = req.active
    return {"status": "ok", "active": req.active}

@app.get("/api/lcd/locator")
def get_lcd_locator_status():
    global lcd_manager
    active = lcd_manager.locator_active if (lcd_manager and lcd_manager._running) else False
    return {"active": active}


# ══════════════════════════════════════════════════════════════════
# BUILD PROFILES CRUD
# ══════════════════════════════════════════════════════════════════

@app.get("/builds")
def list_builds(db: Session = Depends(get_db)):
    """List all build profiles."""
    builds = db.query(FfmpegBuild).order_by(FfmpegBuild.created_at.desc()).all()
    return [_serialize_build(b) for b in builds]


# ── Static /builds/* routes (must be declared BEFORE /builds/{build_id}) ──

@app.get("/builds/tags/ffmpeg")
async def get_ffmpeg_tags():
    """List available FFmpeg git tags from the remote repository."""
    tags = await build_manager.fetch_available_tags("ffmpeg")
    return {"tags": tags}

@app.get("/builds/tags/srt")
async def get_srt_tags():
    """List available LibSRT git tags from the remote repository."""
    tags = await build_manager.fetch_available_tags("srt")
    return {"tags": tags}

@app.get("/builds/tags/nvenc")
async def get_nvenc_tags():
    """List available nv-codec-headers git tags from the remote repository."""
    tags = await build_manager.fetch_available_tags("nvenc")
    return {"tags": tags}

@app.get("/builds/tags/{software_type}")
async def get_software_tags(software_type: str):
    """List available tags for the specified software type."""
    if software_type == "icecast2":
        tags = await build_manager.fetch_available_tags("https://github.com/xiph/icecast-server.git")
    elif software_type == "mediamtx":
        tags = await build_manager.fetch_available_tags("https://github.com/bluenviron/mediamtx.git")
    elif software_type == "kiosk_cog":
        tags = await build_manager.fetch_available_tags("https://github.com/Igalia/cog.git")
    elif software_type == "decklink_tools":
        tags = ["1.0.1", "1.0.0"]
    else:
        tags = await build_manager.fetch_available_tags(software_type)
    
    # Si por algún motivo no hay tags o falla, retornar un fallback básico
    if not tags:
        if software_type == "icecast2":
            tags = ["2.4.4", "2.4.3", "2.4.2"]
        elif software_type == "mediamtx":
            tags = ["v1.9.0", "v1.8.0", "v1.7.0"]
        elif software_type == "kiosk_cog":
            tags = ["v0.18.0", "v0.16.0"]
        elif software_type == "decklink_tools":
            tags = ["1.0.1", "1.0.0"]
            
    return {"tags": tags}

@app.get("/builds/disk-info")
def get_disk_info():
    """Get free space on the partition where builds are stored."""
    return build_manager.get_partition_free_space()

@app.get("/builds/check")
def check_build_deps():
    """Pre-flight check of required system build dependencies."""
    logger.info("GET /builds/check received")
    return build_manager.check_dependencies()


@app.get("/sdks")
def list_sdks(
    sdk_type: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """List installed SDKs with build dependency references."""
    return sdk_manager.list_installed_sdks(sdk_type=sdk_type, db=db)


@app.get("/sdks/{sdk_type}")
def get_sdks_by_type(sdk_type: str, db: Session = Depends(get_db)):
    """List installed versions of the specified SDK type (decklink or ndi)."""
    return sdk_manager.list_installed_sdks(sdk_type=sdk_type, db=db)


@app.post("/sdks/upload")
async def upload_sdk(
    file: UploadFile = File(...),
    sdk_type: str = Form(...),
    storage_id: Optional[int] = Form(None),
    db: Session = Depends(get_db)
):
    """Upload and process a DeckLink or NDI SDK archive."""
    temp_dir = os.path.join(sdk_manager.workspace_root, "data", "temp_uploads")
    os.makedirs(temp_dir, exist_ok=True)

    temp_file_path = os.path.join(temp_dir, f"upload_{uuid.uuid4().hex}_{file.filename}")
    try:
        with open(temp_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        result = sdk_manager.process_sdk_upload(
            file_path=temp_file_path,
            original_filename=file.filename,
            sdk_type=sdk_type,
            storage_id=storage_id,
            db=db
        )
        if not result.get("success"):
            raise HTTPException(status_code=400, detail=result.get("error", "SDK upload failed"))
        return result
    except HTTPException:
        raise
    except Exception as e:
        if os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except OSError:
                pass
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/sdks/{sdk_id}")
def delete_sdk_endpoint(
    sdk_id: int,
    force: bool = Query(False),
    db: Session = Depends(get_db)
):
    """Delete installed SDK record and files or soft delete if force flag is set when referenced."""
    result = sdk_manager.delete_sdk(sdk_id=sdk_id, force=force, db=db)
    if not result.get("success"):
        if result.get("in_use") and not force:
            raise HTTPException(
                status_code=409,
                detail=result.get("error", "SDK is currently in use by build profiles")
            )
        if "not found" in result.get("error", "").lower():
            raise HTTPException(status_code=404, detail=result.get("error"))
        raise HTTPException(status_code=400, detail=result.get("error", "Failed to delete SDK"))
    return result


@app.post("/sdks/{sdk_id}/migrate")
def migrate_sdk_endpoint(
    sdk_id: int,
    request: SdkMigrateRequest,
    db: Session = Depends(get_db)
):
    """Migrate installed SDK files to target storage drive."""
    result = sdk_manager.migrate_sdk_storage(
        sdk_id=sdk_id,
        target_storage_id=request.target_storage_id,
        db=db
    )
    if not result.get("success"):
        if "not found" in result.get("error", "").lower():
            raise HTTPException(status_code=404, detail=result.get("error"))
        raise HTTPException(status_code=400, detail=result.get("error", "SDK migration failed"))
    return result


@app.get("/system/patches")
def get_patches():
    """List all NDI/compilation patches available in the system."""
    return patch_manager.list_patches()

@app.post("/system/patches/upload")
async def upload_patch(
    file: UploadFile = File(...),
    display_name: str = Form(...),
    ffmpeg_version_major: str = Form(...)
):
    """Upload a custom compilation patch with metadata."""
    content = await file.read()
    result = patch_manager.upload_patch(
        file_content=content,
        original_filename=file.filename,
        display_name=display_name,
        ffmpeg_version_major=ffmpeg_version_major
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result

@app.delete("/system/patches/{filename}")
def delete_patch(filename: str):
    """Delete a custom patch."""
    result = patch_manager.delete_patch(filename)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@app.get("/builds/{build_id}")
def get_build(build_id: int, db: Session = Depends(get_db)):
    """Get details of a specific build profile."""
    build = db.query(FfmpegBuild).get(build_id)
    if not build:
        raise HTTPException(status_code=404, detail="Build profile not found")
    return _serialize_build(build)

@app.post("/builds")
def create_build(data: BuildCreate, db: Session = Depends(get_db)):
    """Create a new build profile."""
    software_type = data.software_type or "ffmpeg"
    # Check for duplicate name within the same software engine
    existing = db.query(FfmpegBuild).filter(
        FfmpegBuild.name == data.name,
        FfmpegBuild.software_type == software_type
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="A build with this name already exists for this engine")

    if data.storage_id is not None:
        storage = db.query(Storage).get(data.storage_id)
        if not storage or storage.type != "build":
            raise HTTPException(status_code=400, detail="Invalid storage selected for build")

    build = FfmpegBuild(
        name=data.name,
        ffmpeg_version=data.ffmpeg_version,
        srt_version=data.srt_version,
        build_options=data.build_options,
        sdk_paths=data.sdk_paths,
        auto_clean=data.auto_clean or False,
        install_path="",  # Will be set after we have the ID
        status="pending",
        storage_id=data.storage_id,
        software_type=software_type,
    )
    db.add(build)
    db.commit()
    db.refresh(build)

    # Set install_path now that we have the ID
    storage_path = build.storage.path if build.storage else None
    build.install_path = build_manager.get_install_path(build.id, builds_root=storage_path)
    build.is_default = False
    db.commit()
    db.refresh(build)

    return _serialize_build(build)

@app.put("/builds/{build_id}")
def update_build(build_id: int, data: BuildUpdate, db: Session = Depends(get_db)):
    """Update a build profile (only if not currently building)."""
    build = db.query(FfmpegBuild).get(build_id)
    if not build:
        raise HTTPException(status_code=404, detail="Build profile not found")
    if build.status == "building":
        raise HTTPException(status_code=409, detail="Cannot modify a build in progress")

    if data.storage_id is not None and data.storage_id != build.storage_id:
        if build.status == "building":
            raise HTTPException(status_code=409, detail="Cannot modify a build in progress")
        new_storage = db.query(Storage).get(data.storage_id)
        if not new_storage or new_storage.type != "build":
            raise HTTPException(status_code=400, detail="Invalid storage selected for build")
        old_storage_path = build.storage.path if build.storage else build_manager.builds_root
        new_storage_path = new_storage.path
        old_build_dir = os.path.join(old_storage_path, str(build_id))
        new_build_dir = os.path.join(new_storage_path, str(build_id))
        if os.path.exists(old_build_dir):
            try:
                os.makedirs(new_storage_path, exist_ok=True)
                shutil.move(old_build_dir, new_build_dir)
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Failed to move build directory: {str(e)}")
        build.storage_id = data.storage_id
        build.install_path = build_manager.get_install_path(build_id, builds_root=new_storage_path)
        if build.ffmpeg_binary:
            build.ffmpeg_binary = os.path.join(build.install_path, "bin", "ffmpeg")
        if build.ffprobe_binary:
            build.ffprobe_binary = os.path.join(build.install_path, "bin", "ffprobe")

    if data.name is not None:
        # Check uniqueness per software_type
        dup = db.query(FfmpegBuild).filter(
            FfmpegBuild.name == data.name,
            FfmpegBuild.software_type == build.software_type,
            FfmpegBuild.id != build_id
        ).first()
        if dup:
            raise HTTPException(status_code=409, detail="A build with this name already exists for this engine")
        build.name = data.name
    if data.ffmpeg_version is not None:
        build.ffmpeg_version = data.ffmpeg_version
    if data.srt_version is not None:
        build.srt_version = data.srt_version
    if data.build_options is not None:
        build.build_options = data.build_options
    if data.sdk_paths is not None:
        build.sdk_paths = data.sdk_paths
    if data.auto_clean is not None:
        build.auto_clean = data.auto_clean
    if data.software_type is not None:
        build.software_type = data.software_type

    db.commit()
    db.refresh(build)
    return _serialize_build(build)

@app.delete("/builds/{build_id}")
def delete_build(build_id: int, db: Session = Depends(get_db)):
    """Delete a build profile and its files from disk."""
    build = db.query(FfmpegBuild).get(build_id)
    if not build:
        raise HTTPException(status_code=404, detail="Build profile not found")
    if build.status == "building":
        raise HTTPException(status_code=409, detail="Cannot delete a build in progress")

    # Check if any processes reference this build
    referencing = db.query(MediaProcess).filter(
        MediaProcess.ffmpeg_build_id == build_id
    ).count()
    if referencing > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete: {referencing} process(es) are using this build"
        )

    # Remove from filesystem
    storage_path = build.storage.path if build.storage else None
    build_manager.delete_build(build_id, builds_root=storage_path)
    # Remove from DB
    db.delete(build)
    db.commit()
    return {"status": "ok", "message": f"Build '{build.name}' deleted"}


# ── Build Actions ─────────────────────────────────────────────────

@app.post("/builds/{build_id}/compile")
async def compile_build(build_id: int, background_tasks: BackgroundTasks,
                        clean: bool = False, db: Session = Depends(get_db)):
    """Start compilation of a build profile."""
    build = db.query(FfmpegBuild).get(build_id)
    if not build:
        raise HTTPException(status_code=404, detail="Build profile not found")
    if build_manager.is_building:
        raise HTTPException(status_code=409, detail="Another build is already in progress")

    # Mark as building
    build.status = "building"
    build.build_log_summary = None
    if clean:
        build.sources_cleaned = False
    db.commit()

    storage_path = build.storage.path if build.storage else None

    # Prepare log file path
    build_path = build_manager.get_build_path(build_id, builds_root=storage_path)
    os.makedirs(build_path, exist_ok=True)
    log_file_path = os.path.join(build_path, "build.log")

    # Clear the file first
    try:
        with open(log_file_path, "w") as f:
            f.write("")
    except Exception as e:
        logger.error(f"Failed to clear build log file: {e}")

    async def _log_callback(msg: str):
        """Broadcast log lines to all WebSocket clients and write to file."""
        try:
            with open(log_file_path, "a") as f:
                f.write(msg)
        except Exception as e:
            logger.error(f"Failed to write to build log file: {e}")

        if build_id in build_ws_connections:
            dead = []
            for ws in build_ws_connections[build_id]:
                try:
                    await ws.send_text(msg)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                build_ws_connections[build_id].remove(ws)

    async def _run_compile():
        try:
            try:
                result = await build_manager.run_build(
                    build_id=build_id,
                    ffmpeg_version=build.ffmpeg_version,
                    srt_version=build.srt_version,
                    options=build.build_options,
                    sdk_paths=build.sdk_paths,
                    sources_cleaned=clean or build.sources_cleaned,
                    log_callback=_log_callback,
                    auto_clean=build.auto_clean or False,
                    builds_root=storage_path,
                    software_type=build.software_type or "ffmpeg",
                )
                # Persist results to DB
                with SessionLocal() as session:
                    db_build = session.query(FfmpegBuild).get(build_id)
                    if result.get("success"):
                        db_build.status = "ready"
                        db_build.ffmpeg_binary = result.get("ffmpeg_binary")
                        db_build.ffprobe_binary = result.get("ffprobe_binary")
                        db_build.ffmpeg_version_output = result.get("version_output")
                        db_build.binary_path = result.get("binary_path")
                        db_build.version_output = result.get("version_output")
                        if result.get("version_tag"):
                            db_build.ffmpeg_version = result.get("version_tag")
                            db_build.version_tag = result.get("version_tag")
                        db_build.disk_usage_mb = result.get("disk_usage_mb")
                        db_build.built_at = datetime.datetime.utcnow()
                        db_build.sources_cleaned = db_build.auto_clean  # If auto_clean was true, sources are now cleaned
                        if result.get("sdk_paths"):
                            # SQLAlchemy flag mutation for JSON fields
                            from sqlalchemy.orm.attributes import flag_modified
                            db_build.sdk_paths = result.get("sdk_paths")
                            flag_modified(db_build, "sdk_paths")
                        
                        # Set default if no other ready build exists for this engine
                        existing_default = session.query(FfmpegBuild).filter(
                            FfmpegBuild.software_type == db_build.software_type,
                            FfmpegBuild.is_default == True,
                            FfmpegBuild.status == "ready",
                            FfmpegBuild.id != db_build.id
                        ).first()
                        if not existing_default:
                            db_build.is_default = True

                        notify_build_result(
                            build_id=build_id,
                            build_name=db_build.name,
                            success=True,
                            version_output=result.get("version_output"),
                            disk_usage_mb=result.get("disk_usage_mb"),
                            auto_clean=bool(db_build.auto_clean)
                        )
                    else:
                        db_build.status = "failed"
                        db_build.build_log_summary = result.get("error", "Unknown error")
                        notify_build_result(build_id=build_id, build_name=db_build.name, success=False, error_msg=result.get("error", "Unknown error"))
                    session.commit()
            except Exception as e:
                logger.error(f"Build {build_id} failed with exception: {str(e)}")
                await _log_callback(f"\nFATAL ERROR: {str(e)}\n")
                with SessionLocal() as session:
                    db_build = session.query(FfmpegBuild).get(build_id)
                    if db_build:
                        db_build.status = "failed"
                        db_build.build_log_summary = str(e)
                        session.commit()
                        notify_build_result(build_id=build_id, build_name=db_build.name, success=False, error_msg=str(e))
                    else:
                        notify_build_result(build_id=build_id, build_name=str(build_id), success=False, error_msg=str(e))
        finally:
            if build_manager.current_task == asyncio.current_task():
                build_manager.current_task = None

    task = asyncio.create_task(_run_compile())
    build_manager.current_task = task
    return {"status": "ok", "message": "Compilation started"}

@app.post("/builds/{build_id}/stop")
async def stop_build(build_id: int, db: Session = Depends(get_db)):
    """Stop a running compilation."""
    build = db.query(FfmpegBuild).get(build_id)
    if not build:
        raise HTTPException(status_code=404, detail="Build profile not found")

    # Case A: Build is active in build manager memory
    if build_manager.active_build_id == build_id:
        success = await build_manager.stop_build()
        if success:
            build.status = "failed"
            build.build_log_summary = "Build aborted by user"
            db.commit()
            return {"status": "ok"}
        else:
            return {"status": "error", "detail": "Failed to kill compile process"}

    # Case B: Build is not active in memory, but database status is 'building' (stale state)
    if build.status == "building":
        build.status = "failed"
        build.build_log_summary = "Build aborted by user (stale status reset)"
        db.commit()
        return {"status": "ok", "message": "Stale build state reset"}

    # Case C: Build is neither active nor in building status in database
    raise HTTPException(status_code=409, detail="This build is not currently compiling")

@app.post("/builds/{build_id}/set-default")
def set_default_build(build_id: int, db: Session = Depends(get_db)):
    """Mark a build as the default for new processes."""
    build = db.query(FfmpegBuild).get(build_id)
    if not build:
        raise HTTPException(status_code=404, detail="Build profile not found")
    if build.status != "ready":
        raise HTTPException(status_code=409, detail="Only 'ready' builds can be set as default")

    stype = build.software_type or ("decklink_tools" if "decklink" in (build.name or "").lower() else "ffmpeg")
    build.software_type = stype

    # Unset any previous default for the SAME software_type
    db.query(FfmpegBuild).filter(
        FfmpegBuild.software_type == stype,
        FfmpegBuild.is_default == True,
        FfmpegBuild.id != build_id
    ).update(
        {"is_default": False},
        synchronize_session=False
    )
    build.is_default = True
    db.commit()
    db.refresh(build)
    return {"status": "ok", "message": f"'{build.name}' is now the default build"}

@app.post("/builds/{build_id}/clean-sources")
def clean_build_sources(build_id: int, db: Session = Depends(get_db)):
    """Remove source code, keeping only compiled binaries and libraries."""
    build = db.query(FfmpegBuild).get(build_id)
    if not build:
        raise HTTPException(status_code=404, detail="Build profile not found")
    if build.status == "building":
        raise HTTPException(status_code=409, detail="Cannot clean during compilation")

    storage_path = build.storage.path if build.storage else None
    result = build_manager.clean_sources(build_id, builds_root=storage_path)
    if result.get("cleaned"):
        build.sources_cleaned = True
        build.disk_usage_mb = result.get("disk_usage_mb")
        db.commit()
    return result

@app.get("/builds/{build_id}/validate")
async def validate_build(build_id: int, db: Session = Depends(get_db)):
    """Run validation command on the build's binary."""
    build = db.query(FfmpegBuild).get(build_id)
    if not build:
        raise HTTPException(status_code=404, detail="Build profile not found")

    stype = getattr(build, 'software_type', 'ffmpeg') or 'ffmpeg'
    binary_path = build.binary_path
    if not binary_path or not os.path.isfile(binary_path):
        # Fallback candidates based on install_path
        storage_path = build.storage.path if build.storage else None
        install_path = build.install_path or build_manager.get_install_path(build.id, builds_root=storage_path)
        if stype == "decklink_tools":
            candidate = os.path.join(install_path, "decklink-ctl")
        else:
            candidate = os.path.join(install_path, "bin", "ffmpeg")
        if os.path.isfile(candidate):
            binary_path = candidate
            build.binary_path = candidate
            db.commit()

    result = await build_manager.validate_build(
        binary_path=binary_path,
        software_type=stype
    )
    if result.get("valid"):
        build.version_output = result["output"]
        db.commit()
    return result




# ══════════════════════════════════════════════════════════════════
# PROCESSES
# ══════════════════════════════════════════════════════════════════

@app.get("/processes")
def list_processes(db: Session = Depends(get_db)):
    from database.models import ServiceDependency
    processes = db.query(MediaProcess).all()
    from core.dependency_manager import dependency_manager
    
    all_deps = db.query(ServiceDependency).all()
    deps_by_consumer = {}
    for d in all_deps:
        key = (d.consumer_type, d.consumer_id)
        if key not in deps_by_consumer:
            deps_by_consumer[key] = []
        deps_by_consumer[key].append({
            "provider_service_id": d.provider_service_id,
            "provider_name": d.provider_service.name if d.provider_service else f"Service #{d.provider_service_id}",
            "is_auto_managed": d.is_auto_managed
        })

    return [
        {
            "id": p.id,
            "name": p.name,
            "alias": p.alias,
            "type": p.type,
            "service_type": getattr(p, "service_type", "ffmpeg_stream") or "ffmpeg_stream",
            "config": p.config or {},
            "status": p.status,
            "pid": p.pid,
            "cpu": p.cpu_usage,
            "ram": p.ram_usage,
            "bitrate": p.bitrate,
            "fps": p.fps,
            "speed": p.speed,
            "ffmpeg_build_id": p.ffmpeg_build_id,
            "input_config": p.input_config,
            "output_config": p.output_config,
            "codec_config": p.codec_config,
            "filter_config": p.filter_config,
            "auto_start": p.auto_start,
            "startup_order": getattr(p, 'startup_order', 1) or 1,
            "startup_delay": getattr(p, 'startup_delay', 0) or 0,
            "watchdog_enabled": p.watchdog_enabled,
            "watchdog_retries": p.watchdog_retries,
            "watchdog_min_speed": p.watchdog_min_speed,
            "watchdog_min_speed_duration": p.watchdog_min_speed_duration,
            "allow_auto_start_deps": getattr(p, 'allow_auto_start_deps', True),
            "allow_auto_stop_deps": getattr(p, 'allow_auto_stop_deps', True),
            "active_leases": dependency_manager.get_active_leases(p.id),
            "is_pinned": dependency_manager.is_pinned(p.id),
            "dependencies": deps_by_consumer.get(('service', p.id), []),
            "pending_changes": p.pending_changes,
            "last_start": p.last_start.isoformat() + "Z" if p.last_start else None,
            "last_stop": p.last_stop.isoformat() + "Z" if p.last_stop else None,
            "restart_count": p.restart_count,
            "network_timeout": p.network_timeout,
            "debug_mode": p.debug_mode,
            "log_storage_id": p.log_storage_id,
        } for p in processes
    ]

@app.post("/processes")
def create_process(proc_in: ProcessCreate, db: Session = Depends(get_db)):
    svc_type = proc_in.service_type or "ffmpeg_stream"
    
    # If no build specified and ffmpeg_stream, use default ffmpeg build
    build_id = proc_in.ffmpeg_build_id
    if build_id is None and svc_type == "ffmpeg_stream":
        default_build = db.query(FfmpegBuild).filter(
            FfmpegBuild.is_default == True,
            (FfmpegBuild.software_type == 'ffmpeg') | (FfmpegBuild.software_type == None)
        ).first()
        if default_build:
            build_id = default_build.id
    elif build_id is None and svc_type == "mediamtx_hub":
        mtx_build = db.query(FfmpegBuild).filter(
            FfmpegBuild.software_type == 'mediamtx',
            FfmpegBuild.status == 'ready'
        ).first()
        if mtx_build:
            build_id = mtx_build.id

    input_cfg = dict(proc_in.input_config) if proc_in.input_config is not None else None
    filter_cfg = dict(proc_in.filter_config) if proc_in.filter_config is not None else None
    output_cfg = dict(proc_in.output_config) if proc_in.output_config is not None else None
    codec_cfg = dict(proc_in.codec_config) if proc_in.codec_config is not None else None

    from utils.port_validator import validate_service_port_conflicts
    validate_service_port_conflicts(
        db=db,
        service_id=None,
        service_name=proc_in.name,
        service_type=svc_type,
        config=proc_in.config,
        input_config=input_cfg,
        output_config=output_cfg
    )

    if svc_type == "ffmpeg_stream" and input_cfg is not None:
        # Sanitize configs on creation
        sanitize_process_config_data(input_cfg, filter_cfg or {})

    db_proc = MediaProcess(
        name=proc_in.name,
        service_type=svc_type,
        config=proc_in.config if proc_in.config is not None else {},
        input_config=input_cfg,
        output_config=output_cfg,
        codec_config=codec_cfg,
        filter_config=filter_cfg,
        ffmpeg_build_id=build_id,
        auto_start=proc_in.auto_start,
        startup_order=proc_in.startup_order if proc_in.startup_order is not None else 1,
        startup_delay=proc_in.startup_delay if proc_in.startup_delay is not None else 0,
        watchdog_enabled=proc_in.watchdog_enabled,
        watchdog_retries=proc_in.watchdog_retries,
        watchdog_min_speed=proc_in.watchdog_min_speed,
        watchdog_min_speed_duration=proc_in.watchdog_min_speed_duration if proc_in.watchdog_min_speed_duration is not None else 30,
        alias=proc_in.alias,
        network_timeout=proc_in.network_timeout if proc_in.network_timeout is not None else 15,
        debug_mode=proc_in.debug_mode if proc_in.debug_mode is not None else False,
        log_storage_id=proc_in.log_storage_id,
    )
    db.add(db_proc)
    db.commit()

    from core.dependency_manager import dependency_manager
    dependency_manager.sync_auto_dependencies('service', db_proc.id, db_proc.input_config, db_proc.output_config, db)
    db.refresh(db_proc)
    return db_proc

@app.get("/api/services/mediamtx/next-available-ports")
@app.get("/services/mediamtx/next-available-ports")
def get_mediamtx_next_available_ports(exclude_service_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    from utils.port_validator import get_next_available_mediamtx_ports
    return get_next_available_mediamtx_ports(db, exclude_service_id=exclude_service_id)

@app.post("/processes/preview-cmd")
def preview_command(proc_in: ProcessCreate, process_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    # Sanitize configs for preview
    input_cfg = dict(proc_in.input_config or {})
    filter_cfg = dict(proc_in.filter_config) if proc_in.filter_config is not None else {}
    sanitize_process_config_data(input_cfg, filter_cfg)

    db_proc = MediaProcess(
        id=process_id,
        name=proc_in.name,
        type=proc_in.type,
        input_config=input_cfg,
        output_config=proc_in.output_config,
        codec_config=proc_in.codec_config,
        filter_config=filter_cfg if proc_in.filter_config is not None else None,
        ffmpeg_build_id=proc_in.ffmpeg_build_id,
        network_timeout=proc_in.network_timeout if proc_in.network_timeout is not None else 15,
        debug_mode=proc_in.debug_mode if proc_in.debug_mode is not None else False,
        log_storage_id=proc_in.log_storage_id,
    )
    ffmpeg_bin = process_manager.ffmpeg_path
    if db_proc.ffmpeg_build_id:
        build = db.query(FfmpegBuild).get(db_proc.ffmpeg_build_id)
        if build and build.ffmpeg_binary and os.path.exists(build.ffmpeg_binary):
            ffmpeg_bin = build.ffmpeg_binary
            
    cmd = process_manager._build_ffmpeg_cmd(db_proc, ffmpeg_bin)
    return {"command": shlex.join(cmd)}

@app.put("/processes/{process_id}")
def update_process(process_id: int, proc_in: ProcessUpdate, db: Session = Depends(get_db)):
    db_proc = db.query(MediaProcess).get(process_id)
    if not db_proc:
        raise HTTPException(status_code=404, detail="Process not found")

    if proc_in.name is not None: db_proc.name = proc_in.name
    if proc_in.service_type is not None: db_proc.service_type = proc_in.service_type
    
    import copy
    from sqlalchemy.orm.attributes import flag_modified
    if proc_in.config is not None:
        db_proc.config = proc_in.config
        try:
            flag_modified(db_proc, "config")
        except Exception:
            pass

    # Handle config sanitization on update for ffmpeg streams
    if db_proc.service_type == "ffmpeg_stream":
        input_cfg = copy.deepcopy(proc_in.input_config) if proc_in.input_config is not None else copy.deepcopy(db_proc.input_config)
        filter_cfg = copy.deepcopy(proc_in.filter_config) if proc_in.filter_config is not None else copy.deepcopy(db_proc.filter_config)
        
        if input_cfg:
            sanitize_process_config_data(input_cfg, filter_cfg or {})
            db_proc.input_config = input_cfg
            try:
                flag_modified(db_proc, "input_config")
            except Exception:
                pass
            
        if filter_cfg is not None:
            db_proc.filter_config = filter_cfg
            try:
                flag_modified(db_proc, "filter_config")
            except Exception:
                pass

        output_cfg = proc_in.output_config if proc_in.output_config is not None else db_proc.output_config
        check_media_process_port_conflicts(input_cfg, output_cfg)

        if proc_in.output_config is not None:
            db_proc.output_config = proc_in.output_config
            try:
                flag_modified(db_proc, "output_config")
            except Exception:
                pass

        if proc_in.codec_config is not None:
            db_proc.codec_config = proc_in.codec_config
            try:
                flag_modified(db_proc, "codec_config")
            except Exception:
                pass

    if proc_in.ffmpeg_build_id is not None: db_proc.ffmpeg_build_id = proc_in.ffmpeg_build_id
    if proc_in.auto_start is not None: db_proc.auto_start = proc_in.auto_start
    if proc_in.startup_order is not None: db_proc.startup_order = proc_in.startup_order
    if proc_in.startup_delay is not None: db_proc.startup_delay = proc_in.startup_delay
    if proc_in.watchdog_enabled is not None: db_proc.watchdog_enabled = proc_in.watchdog_enabled
    if proc_in.watchdog_retries is not None: db_proc.watchdog_retries = proc_in.watchdog_retries
    if proc_in.watchdog_min_speed is not None: db_proc.watchdog_min_speed = proc_in.watchdog_min_speed
    if proc_in.watchdog_min_speed_duration is not None: db_proc.watchdog_min_speed_duration = proc_in.watchdog_min_speed_duration
    if proc_in.alias is not None: db_proc.alias = proc_in.alias
    if proc_in.network_timeout is not None: db_proc.network_timeout = proc_in.network_timeout
    if proc_in.debug_mode is not None: db_proc.debug_mode = proc_in.debug_mode
    if proc_in.log_storage_id is not None: db_proc.log_storage_id = proc_in.log_storage_id

    from utils.port_validator import validate_service_port_conflicts
    validate_service_port_conflicts(
        db=db,
        service_id=db_proc.id,
        service_name=db_proc.name,
        service_type=db_proc.service_type,
        config=db_proc.config,
        input_config=db_proc.input_config,
        output_config=db_proc.output_config
    )

    db.commit()

    from core.dependency_manager import dependency_manager
    dependency_manager.sync_auto_dependencies('service', db_proc.id, db_proc.input_config, db_proc.output_config, db)
    db.refresh(db_proc)
    return db_proc

@app.delete("/processes/{process_id}")
async def delete_process(process_id: int, db: Session = Depends(get_db)):
    db_proc = db.query(MediaProcess).get(process_id)
    if not db_proc:
        raise HTTPException(status_code=404, detail="Process not found")

    # Resolve logs storage directory for this process
    log_storage_path = None
    if db_proc.log_storage_id:
        storage = db.query(Storage).get(db_proc.log_storage_id)
        if storage:
            log_storage_path = storage.path
    
    if not log_storage_path:
        default_storage = db.query(Storage).filter(Storage.type == "logs", Storage.is_default == True).first()
        if not default_storage:
            default_storage = db.query(Storage).filter(Storage.type == "logs").first()
        if default_storage:
            log_storage_path = default_storage.path
    
    if not log_storage_path:
        log_storage_path = os.path.abspath("data/logs")

    try:
        await process_manager.stop_process(process_id)
    except Exception as e:
        logger.warning(f"Error stopping process {process_id} before delete: {e}")

    # Physically delete process_{process_id}.log if it exists
    log_file = os.path.join(log_storage_path, f"process_{process_id}.log")
    if os.path.exists(log_file):
        try:
            os.remove(log_file)
        except Exception as e:
            logger.error(f"Error deleting log file {log_file} for process {process_id}: {e}")

    db.delete(db_proc)
    db.commit()
    return {"status": "deleted", "process_id": process_id}

@app.post("/processes/{process_id}/clone-as-task")
def clone_process_as_task(process_id: int, db: Session = Depends(get_db)):
    db_proc = db.query(MediaProcess).get(process_id)
    if not db_proc:
        raise HTTPException(status_code=404, detail="Process not found")

    new_task_name = f"Copy of {db_proc.name}"
    
    input_cfg = copy.deepcopy(db_proc.input_config or {})
    output_cfg = copy.deepcopy(db_proc.output_config or {})
    codec_cfg = copy.deepcopy(db_proc.codec_config or {})
    filter_cfg = copy.deepcopy(db_proc.filter_config or {})

    new_task = ScheduledTask(
        name=new_task_name,
        command="ffmpeg",
        schedule_type="manual",
        schedule_cron=None,
        is_active=False,
        is_system=False,
        duration_type="timer",
        duration_seconds=3600,
        input_config=input_cfg,
        output_config=output_cfg,
        codec_config=codec_cfg,
        filter_config=filter_cfg,
        retry_policy={"max_retries": 3, "retry_delay": 5}
    )
    db.add(new_task)
    db.commit()
    db.refresh(new_task)
    return new_task

@app.get("/api/processes/{process_id}/log-exists")
def get_process_log_exists(process_id: int, db: Session = Depends(get_db)):
    db_proc = db.query(MediaProcess).get(process_id)
    if not db_proc:
        raise HTTPException(status_code=404, detail="Process not found")
        
    log_storage_path = None
    if db_proc.log_storage_id:
        storage = db.query(Storage).get(db_proc.log_storage_id)
        if storage:
            log_storage_path = storage.path
            
    if not log_storage_path:
        default_storage = db.query(Storage).filter(Storage.type == "logs", Storage.is_default == True).first()
        if not default_storage:
            default_storage = db.query(Storage).filter(Storage.type == "logs").first()
        if default_storage:
            log_storage_path = default_storage.path
            
    if not log_storage_path:
        log_storage_path = os.path.abspath("data/logs")
        
    log_file = os.path.join(log_storage_path, f"process_{process_id}.log")
    exists = False
    if os.path.exists(log_file):
        try:
            exists = os.path.getsize(log_file) > 0
        except OSError:
            pass
    return {"exists": exists}

@app.get("/api/processes/{process_id}/download-log")
def download_process_log(process_id: int, db: Session = Depends(get_db)):
    db_proc = db.query(MediaProcess).get(process_id)
    if not db_proc:
        raise HTTPException(status_code=404, detail="Process not found")
        
    log_storage_path = None
    if db_proc.log_storage_id:
        storage = db.query(Storage).get(db_proc.log_storage_id)
        if storage:
            log_storage_path = storage.path
            
    if not log_storage_path:
        default_storage = db.query(Storage).filter(Storage.type == "logs", Storage.is_default == True).first()
        if not default_storage:
            default_storage = db.query(Storage).filter(Storage.type == "logs").first()
        if default_storage:
            log_storage_path = default_storage.path
            
    if not log_storage_path:
        log_storage_path = os.path.abspath("data/logs")
        
    log_file = os.path.join(log_storage_path, f"process_{process_id}.log")
    if not os.path.exists(log_file):
        raise HTTPException(status_code=404, detail="Log file not found")
        
    return FileResponse(log_file, media_type="text/plain", filename=f"process_{process_id}.log")

@app.get("/api/processes/{process_id}/progress")
def get_process_progress(process_id: int):
    # Path fallbacks
    paths = [
        f"/dev/shm/ffmpeg_progress_{process_id}s.log",
        f"/tmp/ffmpeg_progress_{process_id}s.log"
    ]
    
    # Default values
    result = {
        "frame": 0,
        "fps": 0.0,
        "bitrate": "N/A",
        "speed": "N/A",
        "out_time": "N/A",
        "dup_frames": 0,
        "drop_frames": 0,
        "progress": "N/A"
    }
    
    found_file = None
    for p in paths:
        if os.path.exists(p):
            found_file = p
            break
            
    if not found_file:
        return result
        
    try:
        with open(found_file, "r") as f:
            content = f.read()
    except Exception as e:
        logger.error(f"Error reading progress file {found_file}: {e}")
        return result

    # Parse lines from the file
    for line in content.splitlines():
        line = line.strip()
        if not line or "=" not in line:
            continue
        try:
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip()
            
            if k == "frame":
                try:
                    result["frame"] = int(v)
                except ValueError:
                    pass
            elif k == "fps":
                try:
                    result["fps"] = float(v)
                except ValueError:
                    pass
            elif k == "bitrate":
                result["bitrate"] = v
            elif k == "speed":
                result["speed"] = v
            elif k == "out_time":
                result["out_time"] = v
            elif k == "dup_frames":
                try:
                    result["dup_frames"] = int(v)
                except ValueError:
                    pass
            elif k == "drop_frames":
                try:
                    result["drop_frames"] = int(v)
                except ValueError:
                    pass
            elif k == "progress":
                result["progress"] = v
        except Exception:
            continue
            
    return result


@app.get("/processes/{process_id}/logs")
def get_process_logs(process_id: int, db: Session = Depends(get_db)):
    # 1. If process is actively running and has an in-memory buffer, return it
    if process_id in process_manager.log_buffers and len(process_manager.log_buffers[process_id]) > 0:
        return list(process_manager.log_buffers[process_id])

    # 2. Read log file from disk (process_{process_id}.log) if process has completed / stopped
    db_proc = db.query(MediaProcess).get(process_id)
    if db_proc:
        log_storage_path = None
        if db_proc.log_storage_id:
            storage = db.query(Storage).get(db_proc.log_storage_id)
            if storage:
                log_storage_path = storage.path

        if not log_storage_path:
            default_storage = db.query(Storage).filter(Storage.type == "logs", Storage.is_default == True).first()
            if not default_storage:
                default_storage = db.query(Storage).filter(Storage.type == "logs").first()
            if default_storage:
                log_storage_path = default_storage.path

        if not log_storage_path:
            log_storage_path = os.path.abspath("data/logs")

        log_file = os.path.join(log_storage_path, f"process_{process_id}.log")
        if os.path.exists(log_file):
            try:
                with open(log_file, "r", encoding="utf-8", errors="replace") as f:
                    lines = f.readlines()
                    parsed_logs = []
                    for line in lines[-100:]:
                        line_str = line.strip()
                        if not line_str:
                            continue
                        lower = line_str.lower()
                        level = "ERROR" if any(kw in lower for kw in ["error", "failed", "invalid", "could not", "cannot"]) else "INFO"
                        parsed_logs.append({
                            "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
                            "level": level,
                            "message": line_str
                        })
                    return parsed_logs
            except Exception as e:
                logger.error(f"Error reading log file {log_file} for process {process_id}: {e}")

    # 3. Fall back to database query
    return db.query(ProcessLog).filter(
        ProcessLog.process_id == process_id
    ).order_by(ProcessLog.id.asc()).limit(100).all()

@app.post("/processes/{process_id}/start")
async def start_process(process_id: int):
    await process_manager.start_process(process_id)
    return {"status": "starting", "process_id": process_id}

@app.post("/processes/{process_id}/stop")
async def stop_process(process_id: int):
    await process_manager.stop_process(process_id)
    return {"status": "stopping", "process_id": process_id}

@app.post("/processes/{process_id}/restart")
async def restart_process(process_id: int):
    await process_manager.stop_process(process_id, is_restart=True)
    # Short grace gap to allow hardware (ALSA/DeckLink) and network sockets to unbind cleanly
    await asyncio.sleep(0.5)
    await process_manager.start_process(process_id, is_restart=True)
    return {"status": "restarting", "process_id": process_id}

def migrate_and_validate_profile(payload: dict, db: Session) -> dict:
    if "profile" in payload and isinstance(payload["profile"], dict):
        profile = payload["profile"]
    else:
        profile = payload
        
    input_cfg = profile.get("input_config", {})
    
    # Migration from flat input layout (v1) to nested input1 structure (v2)
    if "type" in input_cfg and "input1" not in input_cfg:
        old_type = input_cfg.get("type")
        input1 = {"type": old_type}
        for key in ["host", "port", "mode", "path", "url", "interface", "stream_key", "channel", "device"]:
            if key in input_cfg:
                input1[key] = input_cfg.pop(key)
        
        input_cfg["input1"] = input1
        input_cfg["use_secondary_input"] = False
        input_cfg["has_video"] = input_cfg.get("has_video", True)
        input_cfg["has_audio"] = input_cfg.get("has_audio", True)
        
    profile["input_config"] = input_cfg
    if "output_config" not in profile:
        profile["output_config"] = {"type": "udp", "host": "239.0.0.1", "port": "1234"}
    if "codec_config" not in profile:
        profile["codec_config"] = {}
    if "filter_config" not in profile:
        profile["filter_config"] = {}
        
    # Gracefully resolve missing or invalid Build IDs
    from database.models import FfmpegBuild
    build_id = profile.get("ffmpeg_build_id")
    if build_id:
        build_exists = db.query(FfmpegBuild).filter(FfmpegBuild.id == build_id).first()
        if not build_exists:
            default_build = db.query(FfmpegBuild).filter(FfmpegBuild.is_default == True, FfmpegBuild.status == 'ready').first()
            if default_build:
                profile["ffmpeg_build_id"] = default_build.id
            else:
                any_build = db.query(FfmpegBuild).filter(FfmpegBuild.status == 'ready').first()
                if any_build:
                    profile["ffmpeg_build_id"] = any_build.id
                else:
                    profile["ffmpeg_build_id"] = None

    # Validate alias if present
    alias = profile.get("alias")
    if alias:
        import re
        alias = str(alias).strip()
        if len(alias) > 12:
            alias = alias[:12]
        alias = re.sub(r"[^a-zA-Z0-9\s\-_]", "", alias)
        profile["alias"] = alias
    else:
        profile["alias"] = None
                    
    return profile

@app.get("/processes/{process_id}/export")
def export_process(process_id: int, db: Session = Depends(get_db)):
    proc = db.query(MediaProcess).get(process_id)
    if not proc:
        raise HTTPException(status_code=404, detail="Process not found")

    return {
        "version": 2,
        "exported_at": datetime.datetime.utcnow().isoformat(),
        "profile": {
            "name": proc.name,
            "alias": proc.alias,
            "type": proc.type,
            "input_config": proc.input_config,
            "output_config": proc.output_config,
            "codec_config": proc.codec_config,
            "filter_config": proc.filter_config,
            "ffmpeg_build_id": proc.ffmpeg_build_id,
            "auto_start": proc.auto_start,
            "startup_order": getattr(proc, 'startup_order', 1) or 1,
            "startup_delay": getattr(proc, 'startup_delay', 0) or 0,
            "watchdog_enabled": proc.watchdog_enabled,
            "watchdog_retries": proc.watchdog_retries,
            "watchdog_min_speed": proc.watchdog_min_speed,
            "watchdog_min_speed_duration": proc.watchdog_min_speed_duration,
        }
    }

@app.post("/processes/import")
def import_process(payload: dict, db: Session = Depends(get_db)):
    try:
        profile = migrate_and_validate_profile(payload, db)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid configuration format: {str(e)}")
        
    db_proc = MediaProcess(
        name=f"Imported: {profile.get('name', 'Untitled')}",
        alias=profile.get('alias'),
        type=profile.get('type', 'service'),
        input_config=profile.get('input_config', {}),
        output_config=profile.get('output_config', {}),
        codec_config=profile.get('codec_config', {}),
        filter_config=profile.get('filter_config', {}),
        ffmpeg_build_id=profile.get('ffmpeg_build_id'),
        auto_start=profile.get('auto_start', False),
        startup_order=profile.get('startup_order', 1),
        startup_delay=profile.get('startup_delay', 0),
        watchdog_enabled=profile.get('watchdog_enabled', False),
        watchdog_retries=profile.get('watchdog_retries', 5),
        watchdog_min_speed=profile.get('watchdog_min_speed'),
        watchdog_min_speed_duration=profile.get('watchdog_min_speed_duration', 30),
    )
    db.add(db_proc)
    db.commit()
    db.refresh(db_proc)
    return db_proc

@app.get("/builds/{build_id}/export")
def export_build_recipe(build_id: int, db: Session = Depends(get_db)):
    build = db.query(FfmpegBuild).get(build_id)
    if not build:
        raise HTTPException(status_code=404, detail="Build profile not found")
    return {
        "type": "ffmpeg_build_recipe",
        "version": 1,
        "recipe": {
            "name": build.name,
            "ffmpeg_version": build.ffmpeg_version,
            "srt_version": build.srt_version,
            "build_options": build.build_options,
            "sdk_paths": build.sdk_paths,
            "auto_clean": build.auto_clean,
            "storage_id": build.storage_id,
        }
    }

@app.post("/builds/import")
def import_build_recipe(payload: dict, db: Session = Depends(get_db)):
    if payload.get("type") != "ffmpeg_build_recipe":
        raise HTTPException(status_code=400, detail="Invalid file format. Not a compilation recipe.")
    
    recipe = payload.get("recipe", {})
    if not recipe:
        raise HTTPException(status_code=400, detail="Missing recipe payload.")
        
    build_options = recipe.get("build_options", {})
    sdk_paths = recipe.get("sdk_paths", {}) or {}
    
    # 1. SDK Dependency checking
    if build_options.get("enable_ndi"):
        ndi_ver = sdk_paths.get("ndi")
        if not ndi_ver:
            raise HTTPException(status_code=400, detail="NDI enabled but no version specified in recipe")
        installed_ndis = sdk_manager.list_installed_sdks("ndi")
        installed_versions = [s["version"] for s in installed_ndis]
        if ndi_ver not in installed_versions:
            raise HTTPException(
                status_code=400, 
                detail=f"Missing required NDI SDK Version '{ndi_ver}'. Please install/upload it first, or edit the compilation options."
            )
            
    if build_options.get("enable_decklink"):
        dl_ver = sdk_paths.get("decklink")
        if not dl_ver:
            raise HTTPException(status_code=400, detail="DeckLink enabled but no version specified in recipe")
        installed_dls = sdk_manager.list_installed_sdks("decklink")
        installed_versions = [s["version"] for s in installed_dls]
        if dl_ver not in installed_versions:
            raise HTTPException(
                status_code=400, 
                detail=f"Missing required DeckLink SDK Version '{dl_ver}'. Please install/upload it first, or edit the compilation options."
            )
    
    # 2. Check name duplication and rename
    stype = recipe.get("software_type", "ffmpeg")
    base_name = recipe.get("name", "Imported-Build")
    name = base_name
    counter = 1
    while db.query(FfmpegBuild).filter(FfmpegBuild.name == name, FfmpegBuild.software_type == stype).first():
        name = f"{base_name}-Imported-{counter}"
        counter += 1
        
    recipe_storage_id = recipe.get("storage_id")
    if recipe_storage_id is not None:
        storage = db.query(Storage).get(recipe_storage_id)
        if not storage or storage.type != "build":
            raise HTTPException(status_code=400, detail="Invalid storage selected for build")

    db_build = FfmpegBuild(
        name=name,
        ffmpeg_version=recipe.get("ffmpeg_version", "6.0"),
        srt_version=recipe.get("srt_version"),
        build_options=build_options,
        sdk_paths=sdk_paths,
        auto_clean=recipe.get("auto_clean", False),
        status="pending",
        install_path="",
        storage_id=recipe_storage_id,
    )
    db.add(db_build)
    db.commit()
    db.refresh(db_build)
    
    storage_path = db_build.storage.path if db_build.storage else None
    db_build.install_path = build_manager.get_install_path(db_build.id, builds_root=storage_path)
    db.commit()
    db.refresh(db_build)
    
    return _serialize_build(db_build)


@app.get("/processes/{process_id}/preview")
async def get_preview(process_id: int, db: Session = Depends(get_db)):
    media_proc = db.query(MediaProcess).get(process_id)
    if not media_proc:
        raise HTTPException(status_code=404, detail="Process not found")

    is_running = media_proc.status == 'running'
    return StreamingResponse(
        preview_manager.get_mjpeg_stream(media_proc.id, media_proc.input_config, is_running),
        media_type="multipart/x-mixed-replace; boundary=ffmpeg"
    )





# ══════════════════════════════════════════════════════════════════
# SERVICES (v2.0)
# ══════════════════════════════════════════════════════════════════

@app.get("/api/services")
def list_services(db: Session = Depends(get_db)):
    services = db.query(MediaProcess).all()
    return [
        {
            "id": s.id,
            "name": s.name,
            "service_type": s.service_type,
            "config": s.config,
            "is_active": s.is_active,
            "status": s.status,
            "pid": s.pid,
            "cpu": s.cpu_usage,
            "ram": s.ram_usage,
            "bitrate": s.bitrate,
            "fps": s.fps,
            "speed": s.speed,
            "last_start": s.last_start.isoformat() + "Z" if s.last_start else None,
            "last_stop": s.last_stop.isoformat() + "Z" if s.last_stop else None,
            "restart_count": s.restart_count,
            "pending_changes": s.pending_changes,
        } for s in services
    ]

@app.post("/api/services")
def create_service(svc_in: ServiceCreate, db: Session = Depends(get_db)):
    svc = MediaProcess(
        name=svc_in.name,
        service_type=svc_in.service_type,
        config=svc_in.config,
        is_active=svc_in.is_active,
        alias=svc_in.alias
    )
    db.add(svc)
    db.commit()
    db.refresh(svc)
    return svc

@app.get("/api/services/{service_id}")
def get_service(service_id: int, db: Session = Depends(get_db)):
    svc = db.query(MediaProcess).get(service_id)
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    return svc

@app.put("/api/services/{service_id}")
def update_service(service_id: int, svc_in: ServiceUpdate, db: Session = Depends(get_db)):
    svc = db.query(MediaProcess).get(service_id)
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    if svc_in.name is not None:
        svc.name = svc_in.name
    if svc_in.service_type is not None:
        svc.service_type = svc_in.service_type
    if svc_in.config is not None:
        svc.config = svc_in.config
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(svc, 'config')
    if svc_in.is_active is not None:
        svc.is_active = svc_in.is_active
    if svc_in.alias is not None:
        svc.alias = svc_in.alias
    db.commit()
    db.refresh(svc)
    return svc

@app.delete("/api/services/{service_id}")
def delete_service(service_id: int, db: Session = Depends(get_db)):
    svc = db.query(MediaProcess).get(service_id)
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    if svc.status == 'running':
        raise HTTPException(status_code=400, detail="Cannot delete a running service")
    db.delete(svc)
    db.commit()
    return {"detail": "Service deleted"}

@app.post("/api/services/{service_id}/start")
async def start_service_endpoint(service_id: int):
    await process_manager.start_process(service_id)
    return {"status": "starting"}

@app.post("/api/services/{service_id}/stop")
async def stop_service_endpoint(service_id: int):
    await process_manager.stop_process(service_id)
    return {"status": "stopping"}

@app.post("/api/services/{service_id}/restart")
async def restart_service_endpoint(service_id: int):
    await process_manager.stop_process(service_id)
    await process_manager.start_process(service_id)
    return {"status": "restarting"}

@app.get("/api/services/{service_id}/logs")
def get_service_logs(service_id: int, limit: int = 100, db: Session = Depends(get_db)):
    svc = db.query(MediaProcess).get(service_id)
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    from database.models import ServiceLog
    logs = db.query(ServiceLog).filter(ServiceLog.service_id == service_id).order_by(ServiceLog.id.desc()).limit(limit).all()
    return [{"timestamp": l.timestamp.isoformat() + "Z", "level": l.level, "message": l.message} for l in reversed(logs)]

@app.get("/api/services/{service_id}/preview")
async def get_service_preview(service_id: int, db: Session = Depends(get_db)):
    media_proc = db.query(MediaProcess).get(service_id)
    if not media_proc:
        raise HTTPException(status_code=404, detail="Service not found")
    is_running = media_proc.status == 'running'
    input_config = media_proc.config.get("input_config", {}) if media_proc.config else {}
    return StreamingResponse(
        preview_manager.get_mjpeg_stream(media_proc.id, input_config, is_running),
        media_type="multipart/x-mixed-replace; boundary=ffmpeg"
    )

@app.get("/api/services/{service_id}/dependencies")
def list_service_dependencies(service_id: int, db: Session = Depends(get_db)):
    from database.models import ServiceDependency
    deps = db.query(ServiceDependency).filter(
        ServiceDependency.consumer_type == 'service',
        ServiceDependency.consumer_id == service_id
    ).all()
    return [
        {
            "id": d.id,
            "provider_service_id": d.provider_service_id,
            "is_auto_managed": d.is_auto_managed,
            "provider_name": d.provider_service.name if d.provider_service else "Unknown"
        } for d in deps
    ]

@app.post("/api/services/{service_id}/dependencies")
def add_service_dependency(
    service_id: int, 
    provider_service_id: int = Body(..., embed=True),
    is_auto_managed: bool = Body(True, embed=True),
    db: Session = Depends(get_db)
):
    from database.models import ServiceDependency
    consumer = db.query(MediaProcess).get(service_id)
    provider = db.query(MediaProcess).get(provider_service_id)
    if not consumer or not provider:
        raise HTTPException(status_code=404, detail="Consumer or provider service not found")
        
    exists = db.query(ServiceDependency).filter(
        ServiceDependency.consumer_type == 'service',
        ServiceDependency.consumer_id == service_id,
        ServiceDependency.provider_service_id == provider_service_id
    ).first()
    if exists:
        return exists

    dep = ServiceDependency(
        consumer_type='service',
        consumer_id=service_id,
        provider_service_id=provider_service_id,
        is_auto_managed=is_auto_managed
    )
    db.add(dep)
    db.commit()
    db.refresh(dep)
    return dep

@app.delete("/api/services/{service_id}/dependencies/{provider_service_id}")
def remove_service_dependency(service_id: int, provider_service_id: int, db: Session = Depends(get_db)):
    from database.models import ServiceDependency
    dep = db.query(ServiceDependency).filter(
        ServiceDependency.consumer_type == 'service',
        ServiceDependency.consumer_id == service_id,
        ServiceDependency.provider_service_id == provider_service_id
    ).first()
    if not dep:
        raise HTTPException(status_code=404, detail="Dependency not found")
    db.delete(dep)
    db.commit()
    return {"detail": "Dependency removed"}


@app.get("/api/dependencies/providers")
def list_available_dependency_providers(db: Session = Depends(get_db)):
    """List auxiliary services that can act as stream routing or protocol hubs (MediaMTX, Icecast)."""
    providers = db.query(MediaProcess).filter(
        MediaProcess.service_type.in_(["mediamtx_hub", "icecast_server"])
    ).all()
    
    result = []
    for p in providers:
        cfg = p.config or {}
        mtx_cfg = cfg.get("mediamtx_config", cfg)
        result.append({
            "id": p.id,
            "name": p.name,
            "alias": p.alias,
            "service_type": p.service_type,
            "status": p.status,
            "config": mtx_cfg
        })
    return result


@app.get("/tasks/executions/{execution_id}/preview")
async def get_task_preview(execution_id: int, db: Session = Depends(get_db)):
    execution = db.query(TaskExecution).get(execution_id)
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")

    is_running = execution.status == 'running'
    input_config = execution.task.input_config if execution.task else {}
    return StreamingResponse(
        preview_manager.get_mjpeg_stream(execution.id, input_config, is_running, is_task=True),
        media_type="multipart/x-mixed-replace; boundary=ffmpeg"
    )


# ── Serialization helpers ─────────────────────────────────────────

def _serialize_build(build: FfmpegBuild) -> dict:
    """Convert a FfmpegBuild ORM object to a JSON-safe dict."""
    disk_mb = build.disk_usage_mb
    if (disk_mb is None or disk_mb == 0) and build.status == 'ready':
        storage_path = build.storage.path if build.storage else None
        disk_mb = build_manager.get_disk_usage(build.id, builds_root=storage_path)

    from forge.recipes import get_recipe_version
    recipe_version = get_recipe_version(build.software_type or "ffmpeg")
    is_outdated = False
    if recipe_version and build.status == "ready":
        current_ver = build.version_tag or build.ffmpeg_version or "1.0.0"
        if build.version_output:
            match = re.search(r'v(\d+\.\d+(?:\.\d+)?)', build.version_output)
            if match:
                current_ver = match.group(1)
        if "v" in str(current_ver).lower():
            current_ver = current_ver.lower().replace("v", "").strip()
        try:
            from packaging import version
            is_outdated = version.parse(str(current_ver)) < version.parse(str(recipe_version))
        except Exception:
            is_outdated = str(current_ver) != str(recipe_version)

    return {
        "id": build.id,
        "name": build.name,
        "ffmpeg_version": build.ffmpeg_version,
        "srt_version": build.srt_version,
        "build_options": build.build_options,
        "sdk_paths": build.sdk_paths,
        "install_path": build.install_path,
        "ffmpeg_binary": build.ffmpeg_binary,
        "ffprobe_binary": build.ffprobe_binary,
        "status": build.status,
        "is_default": build.is_default,
        "sources_cleaned": build.sources_cleaned,
        "auto_clean": build.auto_clean,
        "disk_usage_mb": disk_mb,
        "build_log_summary": build.build_log_summary,
        "ffmpeg_version_output": build.ffmpeg_version_output,
        "created_at": build.created_at.isoformat() if build.created_at else None,
        "built_at": build.built_at.isoformat() if build.built_at else None,
        "storage_id": build.storage_id,
        "software_type": build.software_type or "ffmpeg",
        "source_type": getattr(build, "source_type", "compiled") or "compiled",
        "system_path": getattr(build, "system_path", None),
        "is_managed": getattr(build, "is_managed", True),
        "version_tag": build.version_tag,
        "binary_path": build.binary_path,
        "version_output": build.version_output,
        "recipe_version": recipe_version,
        "is_outdated": is_outdated,
    }


# ── Scheduled Tasks Pydantic Schemas ──────────────────────────────

class ScheduledTaskCreate(BaseModel):
    name: str
    is_active: Optional[bool] = True
    input_config: dict
    output_config: dict
    codec_config: dict
    filter_config: Optional[dict] = None
    ffmpeg_build_id: Optional[int] = None
    schedule_type: str
    schedule_cron: Optional[str] = None
    schedule_datetime: Optional[datetime.datetime] = None
    duration_type: Optional[str] = 'input_dependent'
    duration_seconds: Optional[int] = None
    duration_end_time: Optional[datetime.datetime] = None
    retry_policy: Optional[dict] = None
    alias: Optional[str] = None

    @validator('alias')
    def validate_alias(cls, v):
        if v is None:
            return v
        v = v.strip()
        if not v:
            return None
        if len(v) > 12:
            raise ValueError("Alias must be 12 characters or less")
        import re
        if not re.match(r"^[a-zA-Z0-9\s\-_]+$", v):
            raise ValueError("Alias must contain only alphanumeric characters, spaces, dashes, or underscores")
        return v

class ScheduledTaskUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    input_config: Optional[dict] = None
    output_config: Optional[dict] = None
    codec_config: Optional[dict] = None
    filter_config: Optional[dict] = None
    ffmpeg_build_id: Optional[int] = None
    schedule_type: Optional[str] = None
    schedule_cron: Optional[str] = None
    schedule_datetime: Optional[datetime.datetime] = None
    duration_type: Optional[str] = None
    duration_seconds: Optional[int] = None
    duration_end_time: Optional[datetime.datetime] = None
    retry_policy: Optional[dict] = None
    alias: Optional[str] = None

    @validator('alias')
    def validate_alias(cls, v):
        if v is None:
            return v
        v = v.strip()
        if not v:
            return None
        if len(v) > 12:
            raise ValueError("Alias must be 12 characters or less")
        import re
        if not re.match(r"^[a-zA-Z0-9\s\-_]+$", v):
            raise ValueError("Alias must contain only alphanumeric characters, spaces, dashes, or underscores")
        return v


# ── Scheduled Tasks API Endpoints ─────────────────────────────────

def serialize_task_item(t: ScheduledTask, db: Session, deps_list: Optional[list] = None) -> dict:
    from database.models import ServiceDependency
    if deps_list is None:
        deps = db.query(ServiceDependency).filter(
            ServiceDependency.consumer_type == 'task',
            ServiceDependency.consumer_id == t.id
        ).all()
        deps_list = [{
            "provider_service_id": d.provider_service_id,
            "provider_name": d.provider_service.name if d.provider_service else f"Service #{d.provider_service_id}",
            "is_auto_managed": d.is_auto_managed
        } for d in deps]

    last_exec = db.query(TaskExecution).filter(TaskExecution.task_id == t.id).order_by(TaskExecution.id.desc()).first()
    return {
        "id": t.id,
        "name": t.name,
        "is_active": t.is_active,
        "input_config": t.input_config,
        "output_config": t.output_config,
        "codec_config": t.codec_config,
        "filter_config": t.filter_config,
        "ffmpeg_build_id": t.ffmpeg_build_id,
        "schedule_type": t.schedule_type,
        "schedule_cron": t.schedule_cron,
        "schedule_datetime": t.schedule_datetime.isoformat() if t.schedule_datetime else None,
        "next_run": t.next_run.isoformat() if t.next_run else None,
        "duration_type": t.duration_type,
        "duration_seconds": t.duration_seconds,
        "duration_end_time": t.duration_end_time.isoformat() if t.duration_end_time else None,
        "retry_policy": t.retry_policy,
        "allow_auto_start_deps": getattr(t, 'allow_auto_start_deps', True),
        "allow_auto_stop_deps": getattr(t, 'allow_auto_stop_deps', True),
        "dependencies": deps_list,
        "alias": t.alias,
        "is_system": t.is_system,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
        "last_execution": {
            "id": last_exec.id,
            "status": last_exec.status,
            "pid": last_exec.pid,
            "started_at": last_exec.started_at.isoformat() if last_exec.started_at else None,
            "stopped_at": last_exec.stopped_at.isoformat() if last_exec.stopped_at else None,
            "exit_code": last_exec.exit_code,
            "error_message": last_exec.error_message,
            "cpu": last_exec.cpu_usage,
            "ram": last_exec.ram_usage,
            "fps": last_exec.fps,
            "bitrate": last_exec.bitrate,
            "speed": last_exec.speed,
            "retry_count": getattr(last_exec, 'retry_count', 0),
        } if last_exec else None
    }

@app.get("/tasks")
def list_tasks(db: Session = Depends(get_db)):
    from database.models import ServiceDependency
    tasks = db.query(ScheduledTask).all()
    
    all_deps = db.query(ServiceDependency).filter(ServiceDependency.consumer_type == 'task').all()
    deps_by_task = {}
    for d in all_deps:
        if d.consumer_id not in deps_by_task:
            deps_by_task[d.consumer_id] = []
        deps_by_task[d.consumer_id].append({
            "provider_service_id": d.provider_service_id,
            "provider_name": d.provider_service.name if d.provider_service else f"Service #{d.provider_service_id}",
            "is_auto_managed": d.is_auto_managed
        })

    return [serialize_task_item(t, db, deps_by_task.get(t.id, [])) for t in tasks]

@app.post("/tasks")
def create_task(payload: ScheduledTaskCreate, db: Session = Depends(get_db)):
    # Validate cron expression if recurring
    next_run = None
    if payload.schedule_type == 'recurring':
        if not payload.schedule_cron or not CronHelper.validate_cron(payload.schedule_cron):
            raise HTTPException(status_code=400, detail="A valid cron expression is required for recurring tasks")
        next_run = CronHelper.get_next_run(payload.schedule_cron)
    elif payload.schedule_type == 'one_shot':
        if not payload.schedule_datetime:
            raise HTTPException(status_code=400, detail="schedule_datetime is required for one_shot tasks")
        next_run = payload.schedule_datetime

    db_task = ScheduledTask(
        name=payload.name,
        is_active=payload.is_active,
        input_config=payload.input_config,
        output_config=payload.output_config,
        codec_config=payload.codec_config,
        filter_config=payload.filter_config,
        ffmpeg_build_id=payload.ffmpeg_build_id,
        schedule_type=payload.schedule_type,
        schedule_cron=payload.schedule_cron,
        schedule_datetime=payload.schedule_datetime,
        next_run=next_run,
        duration_type=payload.duration_type,
        duration_seconds=payload.duration_seconds,
        duration_end_time=payload.duration_end_time,
        retry_policy=payload.retry_policy,
        allow_auto_start_deps=payload.allow_auto_start_deps if hasattr(payload, 'allow_auto_start_deps') and payload.allow_auto_start_deps is not None else True,
        allow_auto_stop_deps=payload.allow_auto_stop_deps if hasattr(payload, 'allow_auto_stop_deps') and payload.allow_auto_stop_deps is not None else True,
        alias=payload.alias,
    )
    db.add(db_task)
    db.commit()

    from core.dependency_manager import dependency_manager
    dependency_manager.sync_auto_dependencies('task', db_task.id, db_task.input_config, db_task.output_config, db)
    db.refresh(db_task)
    return serialize_task_item(db_task, db)

@app.get("/tasks/export")
def export_tasks(db: Session = Depends(get_db)):
    tasks = db.query(ScheduledTask).all()
    exported = []
    for t in tasks:
        exported.append({
            "name": t.name,
            "is_active": t.is_active,
            "input_config": t.input_config,
            "output_config": t.output_config,
            "codec_config": t.codec_config,
            "filter_config": t.filter_config,
            "ffmpeg_build_id": t.ffmpeg_build_id,
            "schedule_type": t.schedule_type,
            "schedule_cron": t.schedule_cron,
            "schedule_datetime": t.schedule_datetime.isoformat() if t.schedule_datetime else None,
            "duration_type": t.duration_type,
            "duration_seconds": t.duration_seconds,
            "duration_end_time": t.duration_end_time.isoformat() if t.duration_end_time else None,
            "retry_policy": t.retry_policy,
            "alias": t.alias,
        })
    return {
        "version": 2,
        "exported_at": datetime.datetime.utcnow().isoformat(),
        "tasks": exported
    }

@app.get("/tasks/{task_id}/export")
def export_single_task(task_id: int, db: Session = Depends(get_db)):
    t = db.query(ScheduledTask).get(task_id)
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
        
    return {
        "version": 2,
        "exported_at": datetime.datetime.utcnow().isoformat(),
        "task": {
            "name": t.name,
            "is_active": t.is_active,
            "input_config": t.input_config,
            "output_config": t.output_config,
            "codec_config": t.codec_config,
            "filter_config": t.filter_config,
            "ffmpeg_build_id": t.ffmpeg_build_id,
            "schedule_type": t.schedule_type,
            "schedule_cron": t.schedule_cron,
            "schedule_datetime": t.schedule_datetime.isoformat() if t.schedule_datetime else None,
            "duration_type": t.duration_type,
            "duration_seconds": t.duration_seconds,
            "duration_end_time": t.duration_end_time.isoformat() if t.duration_end_time else None,
            "retry_policy": t.retry_policy,
            "alias": t.alias,
        }
    }

def _serialize_service(p) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "alias": p.alias,
        "type": p.type,
        "service_type": getattr(p, "service_type", "ffmpeg_stream") or "ffmpeg_stream",
        "config": p.config or {},
        "status": p.status,
        "pid": p.pid,
        "cpu": p.cpu_usage,
        "ram": p.ram_usage,
        "bitrate": p.bitrate,
        "fps": p.fps,
        "speed": p.speed,
        "ffmpeg_build_id": p.ffmpeg_build_id,
        "input_config": p.input_config,
        "output_config": p.output_config,
        "codec_config": p.codec_config,
        "filter_config": p.filter_config,
        "auto_start": p.auto_start,
        "startup_order": getattr(p, 'startup_order', 1) or 1,
        "startup_delay": getattr(p, 'startup_delay', 0) or 0,
        "watchdog_enabled": p.watchdog_enabled,
        "watchdog_retries": p.watchdog_retries,
        "watchdog_min_speed": p.watchdog_min_speed,
        "watchdog_min_speed_duration": p.watchdog_min_speed_duration,
        "pending_changes": p.pending_changes,
        "last_start": p.last_start.isoformat() + "Z" if p.last_start else None,
        "last_stop": p.last_stop.isoformat() + "Z" if p.last_stop else None,
        "restart_count": p.restart_count,
        "network_timeout": p.network_timeout,
        "debug_mode": p.debug_mode,
        "log_storage_id": p.log_storage_id,
    }

@app.post("/tasks/{task_id}/clone-as-service")
def clone_task_as_service(task_id: int, db: Session = Depends(get_db)):
    db_task = db.query(ScheduledTask).get(task_id)
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")

    new_proc_name = f"Copy of {db_task.name}"
    
    input_cfg = copy.deepcopy(db_task.input_config or {})
    output_cfg = copy.deepcopy(db_task.output_config or {})
    codec_cfg = copy.deepcopy(db_task.codec_config or {})
    filter_cfg = copy.deepcopy(db_task.filter_config or {})

    # Ensure realtime flag for file inputs when cloned as a service
    for input_key, input_val in input_cfg.items():
        if isinstance(input_val, dict) and input_val.get('type') == 'file':
            input_val['re'] = True

    new_proc = MediaProcess(
        name=new_proc_name,
        type="service",
        status="stopped",
        auto_start=False,
        restart_count=0,
        ffmpeg_build_id=db_task.ffmpeg_build_id,
        input_config=input_cfg,
        output_config=output_cfg,
        codec_config=codec_cfg,
        filter_config=filter_cfg,
        watchdog_enabled=True,
        watchdog_retries=3,
        watchdog_min_speed=0.85,
        watchdog_min_speed_duration=30
    )
    db.add(new_proc)
    db.commit()
    db.refresh(new_proc)
    return _serialize_service(new_proc)

@app.post("/tasks/preview-cmd")
def preview_task_command(payload: ScheduledTaskCreate, db: Session = Depends(get_db)):
    db_task = ScheduledTask(
        name=payload.name,
        input_config=payload.input_config,
        output_config=payload.output_config,
        codec_config=payload.codec_config,
        filter_config=payload.filter_config,
        ffmpeg_build_id=payload.ffmpeg_build_id,
        duration_type=payload.duration_type,
        duration_seconds=payload.duration_seconds,
        duration_end_time=payload.duration_end_time,
    )
    limit_sec = None
    if db_task.duration_type == 'timer':
        limit_sec = db_task.duration_seconds
    elif db_task.duration_type == 'end_time' and db_task.duration_end_time:
        now = datetime.datetime.utcnow()
        diff = (db_task.duration_end_time - now).total_seconds()
        limit_sec = max(1, int(diff))

    ffmpeg_bin = task_manager._detect_ffmpeg()
    if db_task.ffmpeg_build_id:
        build = db.query(FfmpegBuild).get(db_task.ffmpeg_build_id)
        if build and build.ffmpeg_binary and os.path.exists(build.ffmpeg_binary):
            ffmpeg_bin = build.ffmpeg_binary
            
    cmd = task_manager._build_ffmpeg_cmd(db_task, ffmpeg_bin, limit_sec)
    return {"command": shlex.join(cmd)}

@app.post("/tasks/import")
def import_tasks(payload: dict, db: Session = Depends(get_db)):
    version = payload.get("version", 2)
    tasks_data = payload.get("tasks", [])
    if not tasks_data:
        if "task" in payload:
            tasks_data = [payload["task"]]
        elif "profile" in payload:
            tasks_data = [payload["profile"]]
            
    imported = []
    for td in tasks_data:
        next_run = None
        stype = td.get("schedule_type", "manual")
        if stype == "recurring" and td.get("schedule_cron"):
            next_run = CronHelper.get_next_run(td["schedule_cron"])
        elif stype == "one_shot" and td.get("schedule_datetime"):
            next_run = datetime.datetime.fromisoformat(td["schedule_datetime"])

        db_task = ScheduledTask(
            name=f"Imported: {td.get('name', 'Untitled')}",
            is_system=False,
            command=None,
            is_active=td.get("is_active", False),
            input_config=td.get("input_config", {}),
            output_config=td.get("output_config", {}),
            codec_config=td.get("codec_config", {}),
            filter_config=td.get("filter_config"),
            ffmpeg_build_id=td.get("ffmpeg_build_id"),
            schedule_type=stype,
            schedule_cron=td.get("schedule_cron"),
            schedule_datetime=datetime.datetime.fromisoformat(td["schedule_datetime"]) if td.get("schedule_datetime") else None,
            next_run=next_run,
            duration_type=td.get("duration_type", "input_dependent"),
            duration_seconds=td.get("duration_seconds"),
            duration_end_time=datetime.datetime.fromisoformat(td["duration_end_time"]) if td.get("duration_end_time") else None,
            retry_policy=td.get("retry_policy"),
            alias=td.get("alias")
        )
        db.add(db_task)
        imported.append(db_task)
        
    db.commit()
    return {"status": "success", "count": len(imported)}

@app.get("/tasks/{task_id}")
def get_task(task_id: int, db: Session = Depends(get_db)):
    task = db.query(ScheduledTask).get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    executions = db.query(TaskExecution).filter(TaskExecution.task_id == task_id).order_by(TaskExecution.id.desc()).all()
    
    return {
        "task": {
            "id": task.id,
            "name": task.name,
            "is_active": task.is_active,
            "input_config": task.input_config,
            "output_config": task.output_config,
            "codec_config": task.codec_config,
            "filter_config": task.filter_config,
            "ffmpeg_build_id": task.ffmpeg_build_id,
            "schedule_type": task.schedule_type,
            "schedule_cron": task.schedule_cron,
            "schedule_datetime": task.schedule_datetime.isoformat() if task.schedule_datetime else None,
            "next_run": task.next_run.isoformat() if task.next_run else None,
            "duration_type": task.duration_type,
            "duration_seconds": task.duration_seconds,
            "duration_end_time": task.duration_end_time.isoformat() if task.duration_end_time else None,
            "retry_policy": task.retry_policy,
            "alias": task.alias,
        },
        "executions": [
            {
                "id": ex.id,
                "status": ex.status,
                "pid": ex.pid,
                "started_at": ex.started_at.isoformat() if ex.started_at else None,
                "stopped_at": ex.stopped_at.isoformat() if ex.stopped_at else None,
                "cpu": ex.cpu_usage,
                "ram": ex.ram_usage,
                "bitrate": ex.bitrate,
                "fps": ex.fps,
                "speed": ex.speed,
                "exit_code": ex.exit_code,
                "error_message": ex.error_message,
                "retry_count": ex.retry_count
            } for ex in executions
        ]
    }

@app.put("/tasks/{task_id}")
def update_task(task_id: int, payload: ScheduledTaskUpdate, db: Session = Depends(get_db)):
    task = db.query(ScheduledTask).get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.is_system:
        raise HTTPException(status_code=400, detail="Cannot edit system-defined tasks.")
    
    update_data = payload.dict(exclude_unset=True)
    
    sched_changed = ('schedule_type' in update_data or 
                     'schedule_cron' in update_data or 
                     'schedule_datetime' in update_data or
                     'is_active' in update_data)
    
    for k, v in update_data.items():
        setattr(task, k, v)
        
    if sched_changed:
        if not task.is_active:
            task.next_run = None
        else:
            if task.schedule_type == 'recurring':
                if not task.schedule_cron or not CronHelper.validate_cron(task.schedule_cron):
                    raise HTTPException(status_code=400, detail="A valid cron expression is required for recurring tasks")
                task.next_run = CronHelper.get_next_run(task.schedule_cron)
            elif task.schedule_type == 'one_shot':
                if not task.schedule_datetime:
                    raise HTTPException(status_code=400, detail="schedule_datetime is required for one_shot tasks")
                task.next_run = task.schedule_datetime
            else:
                task.next_run = None

    db.commit()

    from core.dependency_manager import dependency_manager
    dependency_manager.sync_auto_dependencies('task', task.id, task.input_config, task.output_config, db)
    db.refresh(task)
    return serialize_task_item(task, db)

@app.delete("/tasks/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db)):
    task = db.query(ScheduledTask).get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.is_system:
        raise HTTPException(status_code=400, detail="Cannot delete system-defined tasks.")
    db.delete(task)
    db.commit()
    return {"status": "success", "message": f"Task {task_id} and its executions deleted."}

@app.delete("/tasks/{task_id}/executions")
def clear_task_executions(task_id: int, db: Session = Depends(get_db)):
    task = db.query(ScheduledTask).get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    executions = db.query(TaskExecution).filter(TaskExecution.task_id == task_id).all()
    count = len(executions)
    for exec_item in executions:
        db.delete(exec_item)
    db.commit()
    return {"status": "success", "message": f"Cleared {count} execution records for task {task_id}."}

@app.post("/tasks/{task_id}/trigger")
async def trigger_task(task_id: int, db: Session = Depends(get_db)):
    task = db.query(ScheduledTask).get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    execution = TaskExecution(
        task_id=task.id,
        status="pending",
        retry_count=0
    )
    db.add(execution)
    db.commit()
    db.refresh(execution)
    
    asyncio.create_task(task_manager.start_execution(execution.id))
    return {"status": "success", "execution_id": execution.id}

@app.post("/tasks/executions/{execution_id}/stop")
async def stop_task_execution(execution_id: int, db: Session = Depends(get_db)):
    execution = db.query(TaskExecution).get(execution_id)
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")
    
    await task_manager.stop_execution(execution_id, status="stopped", error_msg="Stopped manually by user")
    return {"status": "success", "message": f"Execution {execution_id} stopped."}

@app.get("/tasks/executions/{execution_id}/logs")
def get_execution_logs(execution_id: int, db: Session = Depends(get_db)):
    logs = db.query(TaskExecutionLog).filter(TaskExecutionLog.execution_id == execution_id).order_by(TaskExecutionLog.id.asc()).all()
    return [
        {
            "id": l.id,
            "timestamp": l.timestamp.isoformat(),
            "level": l.level,
            "message": l.message
        } for l in logs
    ]

# ── Storage Settings API ──────────────────────────────────────────

def get_disk_stats(path: str) -> dict:
    try:
        abs_path = os.path.abspath(path)
        usage = shutil.disk_usage(abs_path)
        total = usage.total
        used = usage.used
        free = usage.free
        percent = round((used / total) * 100, 2) if total > 0 else 0.0
        return {
            "total": total,
            "used": used,
            "free": free,
            "percent": percent
        }
    except (FileNotFoundError, PermissionError, OSError):
        return {
            "total": 0,
            "used": 0,
            "free": 0,
            "percent": 0.0
        }

@app.get("/settings/storages")
@app.get("/api/settings/storages")
def get_storages(db: Session = Depends(get_db)):
    storages = db.query(Storage).all()
    results = []
    for s in storages:
        stats = get_disk_stats(s.path)
        results.append({
            "id": s.id,
            "name": s.name,
            "path": s.path,
            "type": s.type,
            "is_default": s.is_default,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "total": stats["total"],
            "used": stats["used"],
            "free": stats["free"],
            "percent": stats["percent"],
            "stats": stats
        })
    return results

@app.post("/settings/storages")
@app.post("/api/settings/storages")
def create_storage(storage_in: StorageCreate, db: Session = Depends(get_db)):
    valid_types = {'build', 'media', 'hls', 'logs', 'sdk', 'preview'}
    if storage_in.type not in valid_types:
        raise HTTPException(status_code=400, detail="Invalid storage type. Must be one of build, media, hls, logs, sdk, preview.")
        
    abs_path = os.path.abspath(storage_in.path)
    
    if not os.path.exists(abs_path):
        try:
            os.makedirs(abs_path, exist_ok=True)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to create storage path: {str(e)}")
            
    if not os.access(abs_path, os.R_OK | os.W_OK):
        raise HTTPException(status_code=400, detail="Storage path is not readable and writeable.")
        
    existing = db.query(Storage).filter(Storage.type == storage_in.type, Storage.path == abs_path).first()
    if existing:
        raise HTTPException(status_code=400, detail="A storage with the same type and path already exists.")
        
    db_storage = Storage(
        name=storage_in.name,
        path=abs_path,
        type=storage_in.type,
        is_default=False
    )
    db.add(db_storage)
    db.commit()
    db.refresh(db_storage)
    return db_storage

@app.put("/settings/storages/{id}")
@app.put("/api/settings/storages/{id}")
def update_storage(id: int, storage_in: StorageUpdate, db: Session = Depends(get_db)):
    db_storage = db.query(Storage).filter(Storage.id == id).first()
    if not db_storage:
        raise HTTPException(status_code=404, detail="Storage not found")
        
    if db_storage.is_default:
        raise HTTPException(status_code=400, detail="Cannot edit a default storage")
        
    new_abs_path = os.path.abspath(storage_in.path)
    if db_storage.path != new_abs_path:
        if not os.path.exists(new_abs_path):
            try:
                os.makedirs(new_abs_path, exist_ok=True)
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Failed to create storage path: {str(e)}")
                
        if not os.access(new_abs_path, os.R_OK | os.W_OK):
            raise HTTPException(status_code=400, detail="Storage path is not readable and writeable.")
            
        existing = db.query(Storage).filter(
            Storage.type == db_storage.type,
            Storage.path == new_abs_path,
            Storage.id != id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="A storage with the same type and path already exists.")
            
        db_storage.path = new_abs_path
        
    db_storage.name = storage_in.name
    db.commit()
    db.refresh(db_storage)
    return db_storage

@app.delete("/settings/storages/{id}")
@app.delete("/api/settings/storages/{id}")
def delete_storage(id: int, db: Session = Depends(get_db)):
    db_storage = db.query(Storage).filter(Storage.id == id).first()
    if not db_storage:
        raise HTTPException(status_code=404, detail="Storage not found")
        
    if db_storage.is_default:
        raise HTTPException(status_code=400, detail="Cannot delete default storages")
        
    in_use = db.query(FfmpegBuild).filter(FfmpegBuild.storage_id == id).first()
    if in_use:
        raise HTTPException(status_code=400, detail="Cannot delete storage: it is currently in use by build profile(s).")
        
    db.delete(db_storage)
    db.commit()
    return {"status": "deleted", "id": id}

@app.post("/settings/storages/test")
@app.post("/api/settings/storages/test")
def test_storage_path(test_in: StorageTest, db: Session = Depends(get_db)):
    abs_path = os.path.abspath(test_in.path)
    
    if not os.path.exists(abs_path):
        try:
            os.makedirs(abs_path, exist_ok=True)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to create storage path: {str(e)}")
            
    if not os.access(abs_path, os.R_OK | os.W_OK):
        raise HTTPException(status_code=400, detail="Storage path is not readable and writeable.")
        
    stats = get_disk_stats(abs_path)
    return {
        "path": abs_path,
        "valid": True,
        "total": stats["total"],
        "used": stats["used"],
        "free": stats["free"],
        "percent": stats["percent"],
        "stats": stats
    }

# ── SSL & Certificate Management API Endpoints ──
@app.get("/api/settings/ssl/status")
def get_ssl_status():
    from services.cert_manager import CertificateManager
    status_data = CertificateManager().get_cert_status()
    if status_data.get("valid") and status_data.get("days_remaining", 999) <= 30:
        notify_ssl_warning(domain=status_data.get("domain") or "localhost", days_remaining=status_data.get("days_remaining", 0))
    return status_data


@app.post("/api/settings/ssl/upload-custom")
async def upload_custom_ssl(cert_file: UploadFile = File(...), key_file: UploadFile = File(...), db: Session = Depends(get_db)):
    from services.cert_manager import CertificateManager
    cert_mgr = CertificateManager()
    cert_bytes = await cert_file.read()
    key_bytes = await key_file.read()

    success, err = cert_mgr.save_custom_cert(cert_bytes, key_bytes, mode="custom")
    if not success:
        raise HTTPException(status_code=400, detail=err or "Invalid SSL certificate or keypair.")
    
    reloaded = await process_manager.reload_ssl_services(db_session=db)
    return {"success": True, "status": cert_mgr.get_cert_status(), "reloaded_services": reloaded}


class AcmeRenewRequest(BaseModel):
    domain: Optional[str] = None
    email: Optional[str] = None
    challenge_type: Optional[str] = "http-01"


@app.post("/api/settings/ssl/renew")
async def renew_ssl_certificate(body: Optional[AcmeRenewRequest] = None, db: Session = Depends(get_db)):
    config_path = os.environ.get("CONFIG_FILE_PATH")
    if not config_path:
        config_path = "ffmpeg-gui.conf"
    import configparser
    config = configparser.ConfigParser()
    if os.path.exists(config_path):
        config.read(config_path)

    domain = (body and body.domain) or config.get("ssl", "domain", fallback="")
    email = (body and body.email) or config.get("ssl", "email", fallback="")
    challenge_type = (body and body.challenge_type) or config.get("ssl", "challenge_type", fallback="http-01")

    if not domain or domain == "localhost":
        raise HTTPException(status_code=400, detail="Please specify a valid public Domain Name (FQDN) in SSL Settings first (e.g. stream.example.com).")
    if not email:
        raise HTTPException(status_code=400, detail="Please specify an ACME Contact Email in SSL Settings first.")

    # Save updated domain & email to config
    if "ssl" not in config: config["ssl"] = {}
    config["ssl"]["domain"] = domain
    config["ssl"]["email"] = email
    config["ssl"]["challenge_type"] = challenge_type
    with open(config_path, "w") as f:
        config.write(f)

    from services.cert_manager import CertificateManager
    cert_mgr = CertificateManager()
    success, msg = cert_mgr.renew_acme_certificate(domain, email, challenge_type)
    if not success:
        notify_ssl_warning(domain=domain, days_remaining=0, error_msg=msg)
        raise HTTPException(status_code=400, detail=msg)

    # Activate System SSL Renewal task upon first successful ACME issuance
    from database.models import ScheduledTask
    from utils.cron_helper import CronHelper
    ssl_sys_task = db.query(ScheduledTask).filter(ScheduledTask.command == "system://ssl_renew").first()
    if ssl_sys_task:
        ssl_sys_task.is_active = True
        ssl_sys_task.next_run = CronHelper.get_next_run("0 3 * * *")
        db.commit()

    reloaded = await process_manager.reload_ssl_services(db_session=db)
    return {"success": True, "message": msg, "status": cert_mgr.get_cert_status(), "reloaded_services": reloaded}


ACME_CHALLENGES: dict[str, str] = {}


@app.get("/.well-known/acme-challenge/{token}")
def get_acme_challenge(token: str):
    if token in ACME_CHALLENGES:
        return PlainTextResponse(content=ACME_CHALLENGES[token])
    return PlainTextResponse(content=token)


class AlsaControlUpdate(BaseModel):
    card_index: int
    numid: int
    values: List[Any]


@app.get("/api/settings/alsa/cards")
def get_alsa_cards():
    return alsa_manager.get_cards()


def analyze_alsa_process_info(cmd_str: str, config_json_str: str) -> Dict[str, Any]:
    cmd_lower = (str(cmd_str or "") + " " + str(config_json_str or "")).lower()

    # Capture vs Playout detection
    has_input = bool(re.search(r'-f\s+alsa[^\n\r]*?-i\b', cmd_lower) or re.search(r'-i\s+(?:hw|plughw|dsnoop|dmix|alsa):', cmd_lower))
    has_output = bool(re.search(r'-f\s+alsa\s+(?:hw|plughw|dsnoop|dmix):', cmd_lower) or re.search(r'(?:hw|plughw|dsnoop|dmix):\d+[^\s]*\s*$', cmd_lower))

    direction = "both" if (has_input and has_output) else ("capture" if has_input else "playout")

    match = re.search(r'(?:hw|plughw|dsnoop|dmix):(?:card=)?(\d+)(?:,(\d+))?(?:,(\d+))?', cmd_lower)
    device_target = ""
    pcm_index = None
    subdev_index = None

    if match:
        card = match.group(1)
        pcm_index = int(match.group(2)) if match.group(2) is not None else 0
        subdev_index = int(match.group(3)) if match.group(3) is not None else 0
        device_target = f"hw:{card},{pcm_index},{subdev_index}"

    return {
        "direction": direction,
        "device_target": device_target,
        "pcm_index": pcm_index,
        "subdevice_index": subdev_index
    }


def is_cmd_using_alsa_card(cmd_str: str, config_json_str: str, card_index: int, card_id: str) -> bool:
    combined_str = (str(cmd_str or "") + " " + str(config_json_str or "")).lower()
    if not combined_str.strip():
        return False
    
    # Check for ALSA driver / sound card keywords
    has_alsa_driver = (
        "-f alsa" in combined_str or 
        "alsa" in combined_str or 
        "hw:" in combined_str or 
        "plughw:" in combined_str or 
        "dsnoop:" in combined_str or 
        "dmix:" in combined_str or 
        "asihpi" in combined_str or 
        "subdevice" in combined_str
    )
    if not has_alsa_driver:
        return False

    c_idx_str = str(card_index)
    c_id_lower = str(card_id).lower()
    
    # Matches hw:0, hw:0,0, hw:0,0,0, ASI58100, card=ASI58100, etc.
    card_patterns = [
        f"hw:{c_idx_str}",
        f"plughw:{c_idx_str}",
        f"dsnoop:{c_idx_str}",
        f"dmix:{c_idx_str}",
        f"card={c_id_lower}",
        f"card={c_idx_str}",
        c_id_lower
    ]
    
    for pat in card_patterns:
        if pat in combined_str:
            return True
            
    # Fallback for card 0 if default / sysdefault / alsa is used without specifying a non-zero card
    if card_index == 0:
        other_cards = [f"hw:{i}" for i in range(1, 16)] + [f"plughw:{i}" for i in range(1, 16)]
        if not any(oc in combined_str for oc in other_cards):
            return True

    return False


@app.get("/api/settings/alsa/card/{card_index}/topology")
def get_alsa_topology(card_index: int, db: Session = Depends(get_db)):
    try:
        topology = alsa_manager.get_card_topology(card_index)

        cards = alsa_manager.get_cards()
        target_card = next((c for c in cards if c["card_index"] == card_index), None)
        card_id = target_card["card_id"] if target_card else f"hw:{card_index}"

        alsa_badges = []

        # 1. Active Services (MediaProcess)
        try:
            active_procs = db.query(MediaProcess).filter(MediaProcess.status.in_(["running", "active", "starting"])).all()
            for proc in active_procs:
                cmd_str = ""
                try:
                    ffmpeg_bin = process_manager.ffmpeg_path
                    if proc.ffmpeg_build_id:
                        build = db.query(FfmpegBuild).get(proc.ffmpeg_build_id)
                        if build and build.ffmpeg_binary and os.path.exists(build.ffmpeg_binary):
                            ffmpeg_bin = build.ffmpeg_binary
                    cmd_list = process_manager._build_ffmpeg_cmd(proc, ffmpeg_bin)
                    cmd_str = shlex.join(cmd_list)
                except Exception as build_err:
                    logger.debug(f"Could not build command for service {proc.id}: {build_err}")

                config_json_str = json.dumps({
                    "input": proc.input_config,
                    "output": proc.output_config,
                    "codec": proc.codec_config,
                    "last_started": proc.last_started_config
                }, default=str)

                if is_cmd_using_alsa_card(cmd_str, config_json_str, card_index, card_id):
                    info = analyze_alsa_process_info(cmd_str, config_json_str)
                    alsa_badges.append({
                        "process_id": proc.id,
                        "alias": proc.alias or proc.name or f"Service #{proc.id}",
                        "status": proc.status,
                        "type": "service",
                        "direction": info["direction"],
                        "device_target": info["device_target"],
                        "pcm_index": info["pcm_index"],
                        "subdevice_index": info["subdevice_index"],
                        "cmd": cmd_str
                    })
        except Exception as proc_err:
            logger.warning(f"Error matching active services to ALSA card {card_index}: {proc_err}")

        # 2. Active Tasks (TaskExecution / ScheduledTask)
        try:
            active_execs = db.query(TaskExecution).filter(TaskExecution.status.in_(["running", "in_progress", "starting"])).all()
            for task_exec in active_execs:
                task = task_exec.task
                cmd_str = ""
                config_json_str = ""
                if task:
                    try:
                        ffmpeg_bin = task_manager._detect_ffmpeg()
                        cmd_list = task_manager._build_ffmpeg_cmd(task, ffmpeg_bin, None)
                        cmd_str = shlex.join(cmd_list)
                    except Exception:
                        pass

                    config_json_str = json.dumps({
                        "input": getattr(task, "input_config", None),
                        "output": getattr(task, "output_config", None),
                        "params": getattr(task, "params_json", None)
                    }, default=str)

                task_alias = (task.alias if task else None) or (task.name if task else None) or f"Task #{task_exec.id}"

                if is_cmd_using_alsa_card(cmd_str, config_json_str, card_index, card_id):
                    info = analyze_alsa_process_info(cmd_str, config_json_str)
                    alsa_badges.append({
                        "process_id": task_exec.id,
                        "alias": task_alias,
                        "status": task_exec.status,
                        "type": "task",
                        "direction": info["direction"],
                        "device_target": info["device_target"],
                        "pcm_index": info["pcm_index"],
                        "subdevice_index": info["subdevice_index"],
                        "cmd": cmd_str
                    })
        except Exception as task_err:
            logger.warning(f"Error matching active tasks to ALSA card {card_index}: {task_err}")
        except Exception as task_err:
            logger.warning(f"Error matching active tasks to ALSA card {card_index}: {task_err}")

        topology["active_processes"] = alsa_badges
        return topology
    except Exception as e:
        logger.error(f"Error generating ALSA topology for card {card_index}: {e}")
        return {
            "card_index": card_index,
            "virtual_playout": [],
            "hardware_outputs": [],
            "virtual_capture": [],
            "hardware_inputs": [],
            "global_controls": [],
            "active_processes": [],
            "error": str(e)
        }


@app.post("/api/settings/alsa/control")
def write_alsa_control(payload: AlsaControlUpdate):
    success = alsa_manager.write_control_value(
        card_idx=payload.card_index,
        numid=payload.numid,
        values=payload.values
    )
    if not success:
        raise HTTPException(status_code=400, detail="Failed to write ALSA control value")
    return {"status": "ok", "message": f"Control numid={payload.numid} updated successfully"}


@app.websocket("/ws/alsa/meters/{card_index}")
async def websocket_alsa_meters(websocket: WebSocket, card_index: int):
    await websocket.accept()
    try:
        while True:
            meters = alsa_manager.read_meters(card_index)
            jacks = alsa_manager.read_jack_sensors(card_index)
            await websocket.send_json({"meters": meters, "jacks": jacks})
            await asyncio.sleep(0.033)  # ~30Hz
    except WebSocketDisconnect:
        logger.info(f"WebSocket client disconnected from ALSA meters card {card_index}")
    except Exception as e:
        logger.error(f"WebSocket ALSA meters error: {e}")


# ── Blackmagic DeckLink Settings Endpoints ───────────────────────────
@app.get("/api/settings/decklink/status")
async def get_decklink_status(db: Session = Depends(get_db)):
    """Retorna el estado global del subsistema DeckLink, compatibilidad y lista de tarjetas."""
    return await decklink_manager.get_system_status(db, process_manager=process_manager)

@app.get("/api/settings/decklink/{device_id}/telemetry")
async def get_decklink_telemetry(device_id: str, db: Session = Depends(get_db)):
    """Retorna la telemetría y estado de señal en tiempo real de un dispositivo DeckLink."""
    res = await decklink_manager.get_device_telemetry(device_id, db)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Error consultando telemetría"))
    return res

@app.post("/api/settings/decklink/{device_id}/configure")
async def configure_decklink_device(device_id: str, payload: dict = Body(...), db: Session = Depends(get_db)):
    """Aplica configuraciones en un subdispositivo DeckLink garantizando no interferir con procesos activos."""
    res = await decklink_manager.configure_device(device_id, payload, db, process_manager)
    if res.get("conflict"):
        raise HTTPException(status_code=409, detail=res.get("error"))
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Error aplicando configuración DeckLink"))
    return res

@app.post("/api/settings/decklink/{device_index}/firmware-update")
async def update_decklink_firmware(device_index: int):
    """Ejecuta la actualización de firmware de una tarjeta DeckLink mediante BlackmagicFirmwareUpdater."""
    res = await decklink_manager.update_firmware(device_index)
    if not res.get("success"):
        raise HTTPException(status_code=500, detail=res.get("error", "Fallo en la actualización de firmware"))
    return res


# ── Magewell Capture Settings Endpoints ────────────────────────────────
class MagewellChannelConfigureRequest(BaseModel):
    video_input: Optional[str] = None
    audio_input: Optional[str] = None
    low_latency: Optional[bool] = None
    deinterlace: Optional[str] = None
    led_mode: Optional[str] = None


@app.get("/api/settings/magewell/status")
def get_magewell_status(db: Session = Depends(get_db)):
    """Retorna el estado del driver mwcap, utilidades y telemetría en vivo de tarjetas Magewell."""
    return magewell_manager.get_system_status(db_session=db)


@app.post("/api/settings/magewell/{device_id:path}/configure")
async def configure_magewell_channel(
    device_id: str,
    payload: MagewellChannelConfigureRequest,
    db: Session = Depends(get_db)
):
    """Aplica configuraciones de hardware en un canal de captura Magewell vía mwcap-control."""
    target_dev = device_id
    if target_dev.startswith("dev-"):
        target_dev = "/" + target_dev.replace("-", "/")
    elif not target_dev.startswith("/") and ":" not in target_dev:
        target_dev = f"/dev/{target_dev}"

    res = await magewell_manager.configure_channel(
        device_id=target_dev,
        config_payload=payload.model_dump(exclude_unset=True),
        db_session=db
    )
    if not res.get("success"):
        err_msg = res.get("error", "Error configurando canal Magewell")
        status_code = 409 if "active service" in err_msg.lower() else 400
        raise HTTPException(status_code=status_code, detail=err_msg)
    return res


# ── Software Engine Registry Endpoints ──────────────────────────────────
class ToggleInstalledSoftwareRequest(BaseModel):
    enabled: bool
    alias: Optional[str] = None


class DownloadMediaMtxReleaseRequest(BaseModel):
    version: str


@app.get("/api/settings/software")
def get_software_settings(db: Session = Depends(get_db)):
    """Retorna el estado agregado de todos los motores de software soportados."""
    return software_manager.get_engines_status(db_session=db)


@app.post("/api/settings/software/config")
def update_software_config(payload: Dict[str, Any], db: Session = Depends(get_db)):
    """Actualiza la configuración de motores y valida los invariantes de seguridad."""
    # Validar invariantes en cada motor
    for s_type in ["ffmpeg", "mediamtx", "icecast2", "kiosk_cog"]:
        try:
            software_manager.validate_safety_invariants(s_type, payload)
        except ValueError as val_err:
            raise HTTPException(status_code=400, detail=str(val_err))

    # Persistir en archivo de configuración .conf
    config_path = os.environ.get("CONFIG_FILE_PATH", "ffmpeg-gui.conf")
    if not os.path.exists(config_path) and os.path.exists("/etc/ffmpeg-gui/ffmpeg-gui.conf"):
        config_path = "/etc/ffmpeg-gui/ffmpeg-gui.conf"

    import configparser
    c_parser = configparser.ConfigParser()
    if os.path.exists(config_path):
        c_parser.read(config_path)

    if not c_parser.has_section("software_engines"):
        c_parser.add_section("software_engines")

    for k, v in payload.items():
        c_parser.set("software_engines", str(k), str(v).lower())

    try:
        with open(config_path, "w", encoding="utf-8") as f:
            c_parser.write(f)
    except Exception as e:
        logger.warning(f"No se pudo escribir en {config_path}: {e}")

    software_manager.load_config(payload)
    return {"success": True, "config": software_manager.get_config()}


@app.post("/api/settings/software/{software_type}/installed/toggle")
def toggle_installed_software(
    software_type: str,
    payload: ToggleInstalledSoftwareRequest,
    db: Session = Depends(get_db)
):
    """Registra o desregistra un binario instalado en el sistema ($PATH)."""
    try:
        res = software_manager.toggle_installed_binary(
            software_type=software_type,
            enabled=payload.enabled,
            alias=payload.alias,
            db_session=db
        )
        return res
    except FileNotFoundError as fnf:
        raise HTTPException(status_code=404, detail=str(fnf))
    except RuntimeError as r_err:
        raise HTTPException(status_code=409, detail=str(r_err))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/settings/software/mediamtx/releases")
def get_mediamtx_releases():
    """Retorna la lista de releases oficiales de MediaMTX en GitHub."""
    return software_manager.get_mediamtx_releases()


@app.post("/api/settings/software/mediamtx/download")
def download_mediamtx_release(
    payload: DownloadMediaMtxReleaseRequest,
    db: Session = Depends(get_db)
):
    """Descarga, valida y aprovisiona una release precompilada de MediaMTX."""
    from database.models import Storage
    build_storage = db.query(Storage).filter(Storage.type.in_(["build", "builds"])).first()
    storage_path = build_storage.path if build_storage else os.path.abspath("data/builds")

    try:
        res = software_manager.provision_mediamtx_release(
            version_tag=payload.version,
            db_session=db,
            builds_storage_dir=storage_path
        )
        return res
    except Exception as e:
        logger.error(f"Error aprovisionando MediaMTX: {e}")
        raise HTTPException(status_code=500, detail=f"Fallo al descargar o validar MediaMTX: {e}")


@app.post("/api/settings/software/{software_type}/icon")
async def upload_software_icon(
    software_type: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """Guarda un icono personalizado para un motor de software."""
    from database.models import Storage
    storage = db.query(Storage).first()
    base_dir = storage.path if storage else os.path.abspath("data")

    contents = await file.read()
    if len(contents) > 2 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="El archivo excede el tamaño máximo permitido (2MB)")

    try:
        saved_path = software_manager.save_engine_icon(
            software_type=software_type,
            image_bytes=contents,
            filename=file.filename or f"{software_type}.png",
            storage_base_dir=base_dir
        )
        return {"success": True, "icon_path": saved_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error guardando icono: {e}")


@app.get("/api/settings/software/{software_type}/icon")
def get_software_icon(software_type: str, db: Session = Depends(get_db)):
    """Sirve el icono personalizado o 404."""
    from database.models import Storage
    storage = db.query(Storage).first()
    base_dir = storage.path if storage else os.path.abspath("data")
    icon_path = software_manager.get_engine_icon_path(software_type, base_dir)
    if icon_path and os.path.isfile(icon_path):
        return FileResponse(icon_path)
    raise HTTPException(status_code=404, detail="Icon not found")


@app.delete("/api/settings/software/{software_type}/icon")
def delete_software_icon(software_type: str, db: Session = Depends(get_db)):
    """Elimina el icono personalizado y vuelve al icono por defecto."""
    from database.models import Storage
    storage = db.query(Storage).first()
    base_dir = storage.path if storage else os.path.abspath("data")
    deleted = software_manager.delete_engine_icon(software_type, base_dir)
    return {"success": True, "deleted": deleted}


# Mounting static files and SPA fallback
FRONTEND_DIST_DIR = os.getenv("FRONTEND_DIST_DIR")
if not FRONTEND_DIST_DIR:
    cand = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"))
    if os.path.exists(cand):
        FRONTEND_DIST_DIR = cand
    else:
        FRONTEND_DIST_DIR = os.path.abspath("../frontend/dist")

assets_dir = os.path.join(FRONTEND_DIST_DIR, "assets")
try:
    os.makedirs(assets_dir, exist_ok=True)
except Exception:
    pass

if os.path.exists(assets_dir):
    try:
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")
    except Exception as e:
        logger.warning(f"Could not mount static assets: {e}")

@app.get("/{catchall:path}")
def serve_spa(catchall: str):
    api_prefixes = ["api", "ws", "settings", "login", "builds", "processes", "tasks", "sdks", "uploads", "system", "decklink", "magewell"]
    first_part = catchall.split("/")[0] if catchall else ""
    if first_part in api_prefixes:
        raise HTTPException(status_code=404, detail="Not Found")

    index_path = os.path.join(FRONTEND_DIST_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)

    return HTMLResponse(
        content="<h1>FFmpeg-GUI Backend</h1><p>Frontend assets not found. Build the frontend or configure FRONTEND_DIST_DIR.</p>",
        status_code=200
    )
