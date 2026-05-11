from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from database.db import init_db, get_db, SessionLocal
from core.process_manager import ProcessManager
from core.preview_manager import PreviewManager
import logging
import asyncio
from typing import List
from fastapi import BackgroundTasks
from core.build_manager import BuildManager

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

# Initialize Process Manager & Preview Manager
process_manager = ProcessManager(db_session_factory=SessionLocal)
preview_manager = PreviewManager()
build_manager = BuildManager(install_dir="./ffmpeg_bin", build_dir="./build")

# WebSocket Connection Manager
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

@app.websocket("/ws/telemetry")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

async def telemetry_broadcast_loop():
    while True:
        with SessionLocal() as db:
            from database.models import MediaProcess
            processes = db.query(MediaProcess).all()
            data = [
                {
                    "id": p.id,
                    "name": p.name,
                    "status": p.status,
                    "cpu": p.cpu_usage,
                    "ram": p.ram_usage,
                    "bitrate": p.bitrate,
                    "fps": p.fps,
                    "speed": p.speed
                } for p in processes
            ]
            await manager.broadcast({"type": "telemetry", "data": data})
        await asyncio.sleep(1)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(telemetry_broadcast_loop())

@app.get("/")
def read_root():
    return {"status": "online", "message": "FFMPEG Orchestrator API is running"}

@app.get("/processes")
def list_processes(db: Session = Depends(get_db)):
    from database.models import MediaProcess
    return db.query(MediaProcess).all()

class ProcessCreate(BaseModel):
    name: str
    type: str
    input_config: dict
    output_config: dict
    codec_config: dict
    filter_config: Optional[dict] = None

@app.post("/processes")
def create_process(proc_in: ProcessCreate, db: Session = Depends(get_db)):
    from database.models import MediaProcess
    db_proc = MediaProcess(**proc_in.dict())
    db.add(db_proc)
    db.commit()
    db.refresh(db_proc)
    return db_proc

@app.get("/processes/{process_id}/logs")
def get_process_logs(process_id: int, db: Session = Depends(get_db)):
    from database.models import ProcessLog
    return db.query(ProcessLog).filter(ProcessLog.process_id == process_id).order_by(ProcessLog.timestamp.desc()).limit(100).all()

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
    from database.models import MediaProcess
    proc = db.query(MediaProcess).get(process_id)
    if not proc:
        raise HTTPException(status_code=404, detail="Process not found")
    
    # Return a clean JSON for sharing
    return {
        "name": proc.name,
        "input_config": proc.input_config,
        "output_config": proc.output_config,
        "codec_config": proc.codec_config,
        "filter_config": proc.filter_config
    }

@app.post("/processes/import")
def import_process(profile: dict, db: Session = Depends(get_db)):
    from database.models import MediaProcess
    db_proc = MediaProcess(
        name=f"Imported: {profile.get('name', 'Untitled')}",
        type='service',
        input_config=profile.get('input_config', {}),
        output_config=profile.get('output_config', {}),
        codec_config=profile.get('codec_config', {}),
        filter_config=profile.get('filter_config', {})
    )
    db.add(db_proc)
    db.commit()
    db.refresh(db_proc)
    return db_proc

@app.get("/processes/{process_id}/preview")
async def get_preview(process_id: int, db: Session = Depends(get_db)):
    from database.models import MediaProcess
    media_proc = db.query(MediaProcess).get(process_id)
    if not media_proc:
        raise HTTPException(status_code=404, detail="Process not found")
        
    return StreamingResponse(
        preview_manager.get_mjpeg_stream(media_proc.input_config),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

# Build Assistant Endpoints
build_log_queue = asyncio.Queue()

@app.websocket("/ws/build")
async def websocket_build(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            log_line = await build_log_queue.get()
            await websocket.send_text(log_line)
    except Exception:
        pass

@app.post("/build")
async def start_build(options: dict, background_tasks: BackgroundTasks):
    if build_manager.is_building:
        return {"status": "error", "message": "Build already in progress"}
    
    async def log_cb(msg):
        await build_log_queue.put(msg)

    background_tasks.add_task(build_manager.run_build, options, log_cb)
    return {"status": "ok", "message": "Build started"}

@app.get("/build/check")
def check_build_deps():
    logger.info("GET /build/check received")
    return build_manager.check_dependencies()

@app.post("/build/stop")
async def stop_build():
    success = await build_manager.stop_build()
    return {"status": "ok" if success else "error"}

@app.post("/build/clean")
def clean_build():
    success = build_manager.clean_build()
    return {"status": "ok" if success else "error"}

# TODO: Add endpoints for creating/editing processes
