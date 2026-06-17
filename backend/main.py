from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
import shutil
import uuid
import shlex
from PIL import Image
from fastapi.responses import StreamingResponse, FileResponse, HTMLResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from database.db import init_db, get_db, SessionLocal
from database.models import FfmpegBuild, MediaProcess, ProcessLog, ScheduledTask, TaskExecution, TaskExecutionLog
from core.process_manager import ProcessManager
from core.preview_manager import PreviewManager
from core.build_manager import BuildManager
from core.sdk_manager import SdkManager
from utils.gpu_sensor import GPUSensor
from utils.alsa_v4l2_helper import get_v4l2_devices, get_alsa_devices, get_v4l2_formats
import psutil
import logging
import asyncio
import datetime
from fastapi import BackgroundTasks

import time

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("FFMPEG-GUI")

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
            
            log_line = f'{client_host} - {remote_user} [{time_local}] "{request_line}" {status_code[0]} {content_length[0]} "{referer}" "{user_agent}"'
            logger.info(log_line)
            
            access_log_path = os.getenv("ACCESS_LOG_PATH")
            if access_log_path:
                try:
                    with open(access_log_path, "a") as f:
                        f.write(log_line + "\n")
                except Exception:
                    pass

app = FastAPI(title="FFMPEG Orchestrator API")

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

from core.task_manager import TaskManager
from core.scheduler import Scheduler
from utils.cron_helper import CronHelper

task_manager = TaskManager(db_session_factory=SessionLocal)
scheduler = Scheduler(db_session_factory=SessionLocal, task_manager=task_manager)


# ── Pydantic Schemas ──────────────────────────────────────────────

class BuildCreate(BaseModel):
    name: str
    ffmpeg_version: str
    srt_version: Optional[str] = None
    build_options: dict
    sdk_paths: Optional[dict] = None
    auto_clean: Optional[bool] = False

class BuildUpdate(BaseModel):
    name: Optional[str] = None
    ffmpeg_version: Optional[str] = None
    srt_version: Optional[str] = None
    build_options: Optional[dict] = None
    sdk_paths: Optional[dict] = None
    auto_clean: Optional[bool] = None

class ProcessCreate(BaseModel):
    name: str
    type: str
    input_config: dict
    output_config: dict
    codec_config: dict
    filter_config: Optional[dict] = None
    ffmpeg_build_id: Optional[int] = None
    auto_start: Optional[bool] = False
    watchdog_enabled: Optional[bool] = False
    watchdog_retries: Optional[int] = 5

class ProcessUpdate(BaseModel):
    name: Optional[str] = None
    input_config: Optional[dict] = None
    output_config: Optional[dict] = None
    codec_config: Optional[dict] = None
    filter_config: Optional[dict] = None
    ffmpeg_build_id: Optional[int] = None
    auto_start: Optional[bool] = None
    watchdog_enabled: Optional[bool] = None
    watchdog_retries: Optional[int] = None

class SettingsUpdate(BaseModel):
    node_name: Optional[str] = None
    gui_password: Optional[str] = None
    logo_text: Optional[str] = None
    accent_color: Optional[str] = None
    lcd_enabled: Optional[bool] = None
    lcd_port: Optional[str] = None
    lcd_model: Optional[str] = None

class LoginRequest(BaseModel):
    password: str


# ── System Settings & Auth ────────────────────────────────────────

@app.get("/settings")
def get_settings(db: Session = Depends(get_db)):
    from database.models import SystemSettings
    settings = db.query(SystemSettings).first()
    if not settings:
        settings = SystemSettings()
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings

@app.post("/settings")
def update_settings(settings_in: SettingsUpdate, db: Session = Depends(get_db)):
    from database.models import SystemSettings
    settings = db.query(SystemSettings).first()
    if not settings:
        settings = SystemSettings()
        db.add(settings)
    
    if settings_in.node_name is not None: settings.node_name = settings_in.node_name
    if settings_in.gui_password is not None: settings.gui_password = settings_in.gui_password
    if settings_in.logo_text is not None: settings.logo_text = settings_in.logo_text
    if settings_in.accent_color is not None: settings.accent_color = settings_in.accent_color
    if settings_in.lcd_enabled is not None: settings.lcd_enabled = settings_in.lcd_enabled
    if settings_in.lcd_port is not None: settings.lcd_port = settings_in.lcd_port
    if settings_in.lcd_model is not None: settings.lcd_model = settings_in.lcd_model
    
    db.commit()
    db.refresh(settings)
    return settings

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

    # V4L2
    v4l2_devices = glob.glob("/dev/video*")
    v4l2_available = len(v4l2_devices) > 0
    v4l2_details = f"Detected video nodes: {', '.join(v4l2_devices)}" if v4l2_available else "No video nodes found in /dev/video*"

    # ALSA
    alsa_available = os.path.exists("/proc/asound/cards") or os.path.exists("/dev/snd")
    alsa_details = "ALSA sound card node(s) present" if alsa_available else "No ALSA interface found"

    # DeckLink
    import glob
    decklink_nodes = glob.glob("/dev/blackmagic/io*") + glob.glob("/dev/blackmagic/dv*") + glob.glob("/dev/bm*")
    decklink_available = len(decklink_nodes) > 0
    decklink_details = f"Detected DeckLink card nodes: {', '.join(decklink_nodes)}" if decklink_available else "No physical DeckLink cards detected"

    return {
        "vaapi": {"available": vaapi_available, "details": vaapi_details},
        "nvenc": {"available": nvenc_available, "details": nvenc_details},
        "v4l2": {"available": v4l2_available, "details": v4l2_details},
        "alsa": {"available": alsa_available, "details": alsa_details},
        "decklink": {"available": decklink_available, "details": decklink_details}
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
            with SessionLocal() as db:
                processes = db.query(MediaProcess).all()
                data = [
                    {
                        "id": p.id,
                        "name": p.name,
                        "type": p.type,
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
                        "watchdog_enabled": p.watchdog_enabled,
                        "watchdog_retries": p.watchdog_retries,
                        "pending_changes": p.pending_changes,
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
                
                # Gather global host system metrics
                sys_cpu = psutil.cpu_percent(interval=None)
                sys_ram = psutil.virtual_memory()
                gpu_stats = await asyncio.to_thread(gpu_sensor.get_stats)
                
                global lcd_manager
                system_data = {
                    "cpu": sys_cpu,
                    "ram_used": int(sys_ram.used / (1024 * 1024)), # MB
                    "ram_total": int(sys_ram.total / (1024 * 1024)), # MB
                    "gpu": gpu_stats,
                    "lcd": {
                        "connected": lcd_manager is not None and lcd_manager._running,
                        "port": lcd_manager.port if lcd_manager else None
                    }
                }

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
                
                await manager.broadcast({
                    "type": "telemetry",
                    "data": data,
                    "task_executions": exec_data,
                    "system": system_data,
                    "task_stats": {
                        "active": active_exec_count,
                        "scheduled": scheduled_count,
                        "inactive": inactive_count
                    }
                })
        except Exception as e:
            logger.exception(f"Error in telemetry broadcast loop: {e}")
        await asyncio.sleep(1)

async def auto_start_services():
    await asyncio.sleep(2)
    logger.info("Watchdog / Auto-start: Initializing service startup checks...")
    with SessionLocal() as db:
        from database.models import MediaProcess
        services = db.query(MediaProcess).filter(
            MediaProcess.type == 'service',
            MediaProcess.auto_start == True
        ).all()
        for service in services:
            logger.info(f"Auto-starting service: {service.name} (ID: {service.id})")
            try:
                asyncio.create_task(process_manager.start_process(service.id))
            except Exception as e:
                logger.error(f"Failed to auto-start service {service.id}: {e}")

# Global LCD Manager instance
lcd_manager = None

@app.on_event("startup")
async def startup_event():
    logger.info("Startup: Checking and cleaning up stale build profiles, processes and tasks...")
    try:
        with SessionLocal() as db:
            stale_builds = db.query(FfmpegBuild).filter(FfmpegBuild.status == "building").all()
            for build in stale_builds:
                build.status = "failed"
                build.build_log_summary = "Build aborted (server restarted)"
                logger.info(f"Cleaned up stale build profile ID {build.id} on startup.")
            
            stale_processes = db.query(MediaProcess).filter(MediaProcess.status == "running").all()
            for p in stale_processes:
                p.status = "stopped"
                p.pid = None
                p.cpu_usage = 0
                p.ram_usage = 0
                p.fps = "0"
                p.bitrate = "0 kb/s"
                p.speed = "0x"
                logger.info(f"Cleaned up stale running process '{p.name}' (ID: {p.id}) on startup.")
            
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

    asyncio.create_task(telemetry_broadcast_loop())
    asyncio.create_task(auto_start_services())
    await scheduler.start()

@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Shutdown: Stopping scheduler...")
    await scheduler.stop()
    
    global lcd_manager
    if lcd_manager:
        logger.info("Shutdown: Stopping LCD manager...")
        lcd_manager.stop()


# ── Build WebSocket (per-build log streaming) ────────────────────

@app.websocket("/ws/build/{build_id}")
async def websocket_build(websocket: WebSocket, build_id: int):
    await websocket.accept()
    
    # Send existing logs from file if it exists
    log_file_path = os.path.join(build_manager.get_build_path(build_id), "build.log")
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
def read_root():
    global lcd_manager
    return {
        "status": "online", 
        "message": "FFMPEG Orchestrator API is running",
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

@app.get("/builds/disk-info")
def get_disk_info():
    """Get free space on the partition where builds are stored."""
    return build_manager.get_partition_free_space()

@app.get("/builds/check")
def check_build_deps():
    """Pre-flight check of required system build dependencies."""
    logger.info("GET /builds/check received")
    return build_manager.check_dependencies()


@app.get("/sdks/{sdk_type}")
def get_sdks(sdk_type: str):
    """List installed versions of the specified SDK type (decklink or ndi)."""
    return sdk_manager.list_installed_sdks(sdk_type)

@app.post("/sdks/upload")
async def upload_sdk(sdk_type: str = File(...), file: UploadFile = File(...)):
    """Upload and process a DeckLink or NDI SDK archive."""
    # Ensure temporary upload directory exists
    temp_dir = os.path.join(sdk_manager.workspace_root, "data", "temp_uploads")
    os.makedirs(temp_dir, exist_ok=True)
    
    # Save uploaded file temporarily
    temp_file_path = os.path.join(temp_dir, f"upload_{uuid.uuid4().hex}_{file.filename}")
    try:
        with open(temp_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        result = sdk_manager.process_sdk_upload(
            file_path=temp_file_path,
            original_filename=file.filename,
            sdk_type=sdk_type
        )
        if not result.get("success"):
            raise HTTPException(status_code=400, detail=result.get("error"))
        return result
    except Exception as e:
        if os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except OSError:
                pass
        raise HTTPException(status_code=500, detail=str(e))


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
    # Check for duplicate name
    existing = db.query(FfmpegBuild).filter(FfmpegBuild.name == data.name).first()
    if existing:
        raise HTTPException(status_code=409, detail="A build with this name already exists")

    build = FfmpegBuild(
        name=data.name,
        ffmpeg_version=data.ffmpeg_version,
        srt_version=data.srt_version,
        build_options=data.build_options,
        sdk_paths=data.sdk_paths,
        auto_clean=data.auto_clean or False,
        install_path="",  # Will be set after we have the ID
        status="pending",
    )
    db.add(build)
    db.commit()
    db.refresh(build)

    # Set install_path now that we have the ID
    build.install_path = build_manager.get_install_path(build.id)
    # If this is the first build, make it default
    other_builds = db.query(FfmpegBuild).filter(FfmpegBuild.id != build.id).count()
    if other_builds == 0:
        build.is_default = True
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

    if data.name is not None:
        # Check uniqueness
        dup = db.query(FfmpegBuild).filter(
            FfmpegBuild.name == data.name, FfmpegBuild.id != build_id
        ).first()
        if dup:
            raise HTTPException(status_code=409, detail="A build with this name already exists")
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
    build_manager.delete_build(build_id)
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

    # Prepare log file path
    build_path = build_manager.get_build_path(build_id)
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
            result = await build_manager.run_build(
                build_id=build_id,
                ffmpeg_version=build.ffmpeg_version,
                srt_version=build.srt_version,
                options=build.build_options,
                sdk_paths=build.sdk_paths,
                sources_cleaned=clean or build.sources_cleaned,
                log_callback=_log_callback,
                auto_clean=build.auto_clean or False,
            )
            # Persist results to DB
            with SessionLocal() as session:
                db_build = session.query(FfmpegBuild).get(build_id)
                if result.get("success"):
                    db_build.status = "ready"
                    db_build.ffmpeg_binary = result.get("ffmpeg_binary")
                    db_build.ffprobe_binary = result.get("ffprobe_binary")
                    db_build.ffmpeg_version_output = result.get("version_output")
                    db_build.disk_usage_mb = result.get("disk_usage_mb")
                    db_build.built_at = datetime.datetime.utcnow()
                    db_build.sources_cleaned = db_build.auto_clean  # If auto_clean was true, sources are now cleaned
                    if result.get("sdk_paths"):
                        # SQLAlchemy flag mutation for JSON fields
                        from sqlalchemy.orm.attributes import flag_modified
                        db_build.sdk_paths = result.get("sdk_paths")
                        flag_modified(db_build, "sdk_paths")
                else:
                    db_build.status = "failed"
                    db_build.build_log_summary = result.get("error", "Unknown error")
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

    background_tasks.add_task(_run_compile)
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

    # Unset any previous default
    db.query(FfmpegBuild).filter(FfmpegBuild.is_default == True).update(
        {"is_default": False}
    )
    build.is_default = True
    db.commit()
    return {"status": "ok", "message": f"'{build.name}' is now the default build"}

@app.post("/builds/{build_id}/clean-sources")
def clean_build_sources(build_id: int, db: Session = Depends(get_db)):
    """Remove source code, keeping only compiled binaries and libraries."""
    build = db.query(FfmpegBuild).get(build_id)
    if not build:
        raise HTTPException(status_code=404, detail="Build profile not found")
    if build.status == "building":
        raise HTTPException(status_code=409, detail="Cannot clean during compilation")

    result = build_manager.clean_sources(build_id)
    if result.get("cleaned"):
        build.sources_cleaned = True
        build.disk_usage_mb = result.get("disk_usage_mb")
        db.commit()
    return result

@app.get("/builds/{build_id}/validate")
async def validate_build(build_id: int, db: Session = Depends(get_db)):
    """Run ffmpeg -version on the build's binary."""
    build = db.query(FfmpegBuild).get(build_id)
    if not build:
        raise HTTPException(status_code=404, detail="Build profile not found")

    result = await build_manager.validate_build(build.ffmpeg_binary)
    if result.get("valid"):
        build.ffmpeg_version_output = result["output"]
        db.commit()
    return result




# ══════════════════════════════════════════════════════════════════
# PROCESSES
# ══════════════════════════════════════════════════════════════════

@app.get("/processes")
def list_processes(db: Session = Depends(get_db)):
    processes = db.query(MediaProcess).all()
    return [
        {
            "id": p.id,
            "name": p.name,
            "type": p.type,
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
            "watchdog_enabled": p.watchdog_enabled,
            "watchdog_retries": p.watchdog_retries,
            "pending_changes": p.pending_changes,
        } for p in processes
    ]

@app.post("/processes")
def create_process(proc_in: ProcessCreate, db: Session = Depends(get_db)):
    # If no build specified, use the default
    build_id = proc_in.ffmpeg_build_id
    if build_id is None:
        default_build = db.query(FfmpegBuild).filter(
            FfmpegBuild.is_default == True
        ).first()
        if default_build:
            build_id = default_build.id

    db_proc = MediaProcess(
        name=proc_in.name,
        type=proc_in.type,
        input_config=proc_in.input_config,
        output_config=proc_in.output_config,
        codec_config=proc_in.codec_config,
        filter_config=proc_in.filter_config,
        ffmpeg_build_id=build_id,
        auto_start=proc_in.auto_start,
        watchdog_enabled=proc_in.watchdog_enabled,
        watchdog_retries=proc_in.watchdog_retries,
    )
    db.add(db_proc)
    db.commit()
    db.refresh(db_proc)
    return db_proc

@app.post("/processes/preview-cmd")
def preview_command(proc_in: ProcessCreate, db: Session = Depends(get_db)):
    db_proc = MediaProcess(
        name=proc_in.name,
        type=proc_in.type,
        input_config=proc_in.input_config,
        output_config=proc_in.output_config,
        codec_config=proc_in.codec_config,
        filter_config=proc_in.filter_config,
        ffmpeg_build_id=proc_in.ffmpeg_build_id,
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
    if proc_in.input_config is not None: db_proc.input_config = proc_in.input_config
    if proc_in.output_config is not None: db_proc.output_config = proc_in.output_config
    if proc_in.codec_config is not None: db_proc.codec_config = proc_in.codec_config
    if proc_in.filter_config is not None: db_proc.filter_config = proc_in.filter_config
    if proc_in.ffmpeg_build_id is not None: db_proc.ffmpeg_build_id = proc_in.ffmpeg_build_id
    if proc_in.auto_start is not None: db_proc.auto_start = proc_in.auto_start
    if proc_in.watchdog_enabled is not None: db_proc.watchdog_enabled = proc_in.watchdog_enabled
    if proc_in.watchdog_retries is not None: db_proc.watchdog_retries = proc_in.watchdog_retries

    db.commit()
    db.refresh(db_proc)
    return db_proc

@app.delete("/processes/{process_id}")
async def delete_process(process_id: int, db: Session = Depends(get_db)):
    db_proc = db.query(MediaProcess).get(process_id)
    if not db_proc:
        raise HTTPException(status_code=404, detail="Process not found")

    try:
        await process_manager.stop_process(process_id)
    except Exception as e:
        logger.warning(f"Error stopping process {process_id} before delete: {e}")

    db.delete(db_proc)
    db.commit()
    return {"status": "deleted", "process_id": process_id}

@app.get("/processes/{process_id}/logs")
def get_process_logs(process_id: int, db: Session = Depends(get_db)):
    # Check if process is active and has a memory buffer
    if process_id in process_manager.processes and process_id in process_manager.log_buffers:
        # Return serialized memory buffer (already formatted with timestamp, level, message)
        return list(process_manager.log_buffers[process_id])
        
    # Fall back to database query, sorting by id ascending for chronological order
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
    await process_manager.stop_process(process_id)
    await process_manager.start_process(process_id)
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
            "type": proc.type,
            "input_config": proc.input_config,
            "output_config": proc.output_config,
            "codec_config": proc.codec_config,
            "filter_config": proc.filter_config,
            "ffmpeg_build_id": proc.ffmpeg_build_id,
            "auto_start": proc.auto_start,
            "watchdog_enabled": proc.watchdog_enabled,
            "watchdog_retries": proc.watchdog_retries,
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
        type=profile.get('type', 'service'),
        input_config=profile.get('input_config', {}),
        output_config=profile.get('output_config', {}),
        codec_config=profile.get('codec_config', {}),
        filter_config=profile.get('filter_config', {}),
        ffmpeg_build_id=profile.get('ffmpeg_build_id'),
        auto_start=profile.get('auto_start', False),
        watchdog_enabled=profile.get('watchdog_enabled', False),
        watchdog_retries=profile.get('watchdog_retries', 5),
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
    base_name = recipe.get("name", "Imported-Build")
    name = base_name
    counter = 1
    while db.query(FfmpegBuild).filter(FfmpegBuild.name == name).first():
        name = f"{base_name}-Imported-{counter}"
        counter += 1
        
    db_build = FfmpegBuild(
        name=name,
        ffmpeg_version=recipe.get("ffmpeg_version", "6.0"),
        srt_version=recipe.get("srt_version"),
        build_options=build_options,
        sdk_paths=sdk_paths,
        auto_clean=recipe.get("auto_clean", False),
        status="pending",
        install_path="",
    )
    db.add(db_build)
    db.commit()
    db.refresh(db_build)
    
    db_build.install_path = build_manager.get_install_path(db_build.id)
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
        "disk_usage_mb": build.disk_usage_mb,
        "build_log_summary": build.build_log_summary,
        "ffmpeg_version_output": build.ffmpeg_version_output,
        "created_at": build.created_at.isoformat() if build.created_at else None,
        "built_at": build.built_at.isoformat() if build.built_at else None,
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


# ── Scheduled Tasks API Endpoints ─────────────────────────────────

@app.get("/tasks")
def list_tasks(db: Session = Depends(get_db)):
    tasks = db.query(ScheduledTask).all()
    res = []
    for t in tasks:
        # Find last execution
        last_exec = db.query(TaskExecution).filter(TaskExecution.task_id == t.id).order_by(TaskExecution.id.desc()).first()
        res.append({
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
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "updated_at": t.updated_at.isoformat() if t.updated_at else None,
            "last_execution": {
                "id": last_exec.id,
                "status": last_exec.status,
                "started_at": last_exec.started_at.isoformat() if last_exec.started_at else None,
                "stopped_at": last_exec.stopped_at.isoformat() if last_exec.stopped_at else None,
                "exit_code": last_exec.exit_code,
                "error_message": last_exec.error_message,
            } if last_exec else None
        })
    return res

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
        retry_policy=payload.retry_policy
    )
    db.add(db_task)
    db.commit()
    db.refresh(db_task)
    return db_task

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
            "retry_policy": t.retry_policy
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
            "retry_policy": t.retry_policy
        }
    }

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
            is_active=td.get("is_active", True),
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
            retry_policy=td.get("retry_policy")
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
    db.refresh(task)
    return task

@app.delete("/tasks/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db)):
    task = db.query(ScheduledTask).get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    db.delete(task)
    db.commit()
    return {"status": "success", "message": f"Task {task_id} and its executions deleted."}

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

# Mounting static files and SPA fallback
FRONTEND_DIST_DIR = os.getenv("FRONTEND_DIST_DIR", "../frontend/dist")
os.makedirs(os.path.join(FRONTEND_DIST_DIR, "assets"), exist_ok=True)
app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST_DIR, "assets")), name="assets")

@app.get("/{catchall:path}")
def serve_spa(catchall: str):
    api_prefixes = ["ws", "settings", "login", "builds", "processes", "tasks", "sdks", "uploads", "system", "decklink"]
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
