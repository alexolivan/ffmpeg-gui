from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
import uuid
from PIL import Image
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from database.db import init_db, get_db, SessionLocal
from database.models import FfmpegBuild, MediaProcess, ProcessLog
from core.process_manager import ProcessManager
from core.preview_manager import PreviewManager
from core.build_manager import BuildManager
import logging
import asyncio
import datetime
from fastapi import BackgroundTasks

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("FFMPEG-GUI")

app = FastAPI(title="FFMPEG Orchestrator API")

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


# ── Pydantic Schemas ──────────────────────────────────────────────

class BuildCreate(BaseModel):
    name: str
    ffmpeg_version: str
    srt_version: Optional[str] = None
    build_options: dict
    sdk_paths: Optional[dict] = None

class BuildUpdate(BaseModel):
    name: Optional[str] = None
    ffmpeg_version: Optional[str] = None
    srt_version: Optional[str] = None
    build_options: Optional[dict] = None
    sdk_paths: Optional[dict] = None

class ProcessCreate(BaseModel):
    name: str
    type: str
    input_config: dict
    output_config: dict
    codec_config: dict
    filter_config: Optional[dict] = None
    ffmpeg_build_id: Optional[int] = None

class SettingsUpdate(BaseModel):
    node_name: Optional[str] = None
    gui_password: Optional[str] = None
    logo_text: Optional[str] = None
    accent_color: Optional[str] = None

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
    while True:
        with SessionLocal() as db:
            processes = db.query(MediaProcess).all()
            data = [
                {
                    "id": p.id,
                    "name": p.name,
                    "type": p.type,
                    "status": p.status,
                    "cpu": p.cpu_usage,
                    "ram": p.ram_usage,
                    "bitrate": p.bitrate,
                    "fps": p.fps,
                    "speed": p.speed,
                    "ffmpeg_build_id": p.ffmpeg_build_id,
                } for p in processes
            ]
            await manager.broadcast({"type": "telemetry", "data": data})
        await asyncio.sleep(1)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(telemetry_broadcast_loop())


# ── Build WebSocket (per-build log streaming) ────────────────────

@app.websocket("/ws/build/{build_id}")
async def websocket_build(websocket: WebSocket, build_id: int):
    await websocket.accept()
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

@app.get("/")
def read_root():
    return {"status": "online", "message": "FFMPEG Orchestrator API is running"}


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

@app.get("/builds/disk-info")
def get_disk_info():
    """Get free space on the partition where builds are stored."""
    return build_manager.get_partition_free_space()

@app.get("/builds/check")
def check_build_deps():
    """Pre-flight check of required system build dependencies."""
    logger.info("GET /builds/check received")
    return build_manager.check_dependencies()


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
                        db: Session = Depends(get_db)):
    """Start compilation of a build profile."""
    build = db.query(FfmpegBuild).get(build_id)
    if not build:
        raise HTTPException(status_code=404, detail="Build profile not found")
    if build_manager.is_building:
        raise HTTPException(status_code=409, detail="Another build is already in progress")

    # Mark as building
    build.status = "building"
    build.build_log_summary = None
    db.commit()

    async def _log_callback(msg: str):
        """Broadcast log lines to all WebSocket clients watching this build."""
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
                sources_cleaned=build.sources_cleaned,
                log_callback=_log_callback,
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
                    db_build.sources_cleaned = False  # Sources are fresh after build
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
    if build_manager.active_build_id != build_id:
        raise HTTPException(status_code=409, detail="This build is not currently compiling")

    success = await build_manager.stop_build()
    if success:
        build = db.query(FfmpegBuild).get(build_id)
        if build:
            build.status = "failed"
            build.build_log_summary = "Build aborted by user"
            db.commit()
    return {"status": "ok" if success else "error"}

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
    return db.query(MediaProcess).all()

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
    )
    db.add(db_proc)
    db.commit()
    db.refresh(db_proc)
    return db_proc

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

@app.get("/processes/{process_id}/export")
def export_process(process_id: int, db: Session = Depends(get_db)):
    proc = db.query(MediaProcess).get(process_id)
    if not proc:
        raise HTTPException(status_code=404, detail="Process not found")

    return {
        "name": proc.name,
        "input_config": proc.input_config,
        "output_config": proc.output_config,
        "codec_config": proc.codec_config,
        "filter_config": proc.filter_config,
        "ffmpeg_build_id": proc.ffmpeg_build_id,
    }

@app.post("/processes/import")
def import_process(profile: dict, db: Session = Depends(get_db)):
    db_proc = MediaProcess(
        name=f"Imported: {profile.get('name', 'Untitled')}",
        type='service',
        input_config=profile.get('input_config', {}),
        output_config=profile.get('output_config', {}),
        codec_config=profile.get('codec_config', {}),
        filter_config=profile.get('filter_config', {}),
        ffmpeg_build_id=profile.get('ffmpeg_build_id'),
    )
    db.add(db_proc)
    db.commit()
    db.refresh(db_proc)
    return db_proc

@app.get("/processes/{process_id}/preview")
async def get_preview(process_id: int, db: Session = Depends(get_db)):
    media_proc = db.query(MediaProcess).get(process_id)
    if not media_proc:
        raise HTTPException(status_code=404, detail="Process not found")

    return StreamingResponse(
        preview_manager.get_mjpeg_stream(media_proc.input_config),
        media_type="multipart/x-mixed-replace; boundary=frame"
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
        "disk_usage_mb": build.disk_usage_mb,
        "build_log_summary": build.build_log_summary,
        "ffmpeg_version_output": build.ffmpeg_version_output,
        "created_at": build.created_at.isoformat() if build.created_at else None,
        "built_at": build.built_at.isoformat() if build.built_at else None,
    }
