# FFmpeg Process Debugging and Log Buffer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture real-time FFmpeg stderr output in an in-memory buffer for active processes, expose it to the UI, and automatically persist crash logs to SQLite when processes fail with non-zero exit codes.

**Architecture:** Keep the last 100 log lines in a per-process RAM buffer (`collections.deque`) during execution. Update the GET logs API to return RAM buffers for active processes and DB logs for inactive ones. Persist the RAM buffer to the SQLite database in a single transaction if a process exits with an error code.

**Tech Stack:** Python, FastAPI, SQLAlchemy, SQLite, asyncio.subprocess

---

### Task 1: Process Log Model Tuning

**Files:**
- Modify: `/home/alex/LocalRepositories/FFMPEG-GUI/backend/database/models.py`

- [ ] **Step 1: Modify the logs relationship ordering to chronological (id ascending)**
Edit `/home/alex/LocalRepositories/FFMPEG-GUI/backend/database/models.py` at line 95 to sort logs by `ProcessLog.id` ascending instead of timestamp, guaranteeing exact chronological rendering of log line chunks in the UI.

```python
MediaProcess.logs = relationship("ProcessLog", order_by=ProcessLog.id, back_populates="process")
```

- [ ] **Step 2: Commit changes**

```bash
git add backend/database/models.py
git commit -m "refactor(db): sort process logs relationship by ID ascending for chronological ordering"
```

---

### Task 2: In-Memory Logging Buffer and Classification

**Files:**
- Modify: `/home/alex/LocalRepositories/FFMPEG-GUI/backend/core/process_manager.py`

- [ ] **Step 1: Import collections deque and update ProcessManager initialization**
Modify `/home/alex/LocalRepositories/FFMPEG-GUI/backend/core/process_manager.py` to import `collections` and initialize `self.log_buffers` in the `__init__` constructor.

```python
import collections
# Inside __init__:
self.log_buffers: Dict[int, collections.deque] = {}
```

- [ ] **Step 2: Initialize deque on process start**
Modify `/home/alex/LocalRepositories/FFMPEG-GUI/backend/core/process_manager.py` inside `async def start_process` (right before `asyncio.create_subprocess_exec` or right inside the `try` block) to initialize the deque for the starting process.

```python
# Initialize 100-line buffer for this process
self.log_buffers[process_id] = collections.deque(maxlen=100)
```

- [ ] **Step 3: Update log reader to populate buffer and classify lines**
Modify `/home/alex/LocalRepositories/FFMPEG-GUI/backend/core/process_manager.py` inside `async def _log_reader`. Decode each stderr line, classify the log level to `ERROR` if the line contains keywords indicating failures (e.g. `error`, `fail`, `invalid`, `could not`), and append the formatted dict to the deque.

```python
    async def _log_reader(self, process_id: int, proc: asyncio.subprocess.Process):
        import re
        import datetime
        status_re = re.compile(r"fps=\s*([\d.]+).*bitrate=\s*([\d.]+kbits/s).*speed=\s*([\d.]+x)")
        
        while True:
            line = await proc.stderr.readline()
            if not line:
                break
            msg = line.decode('utf-8', errors='replace').strip()
            if not msg:
                continue
            
            # Check for error signature
            lower_msg = msg.lower()
            if any(kw in lower_msg for kw in ["error", "failed", "invalid", "could not", "cannot"]):
                level = "ERROR"
            else:
                level = "INFO"
            
            # Append to in-memory deque
            if process_id in self.log_buffers:
                self.log_buffers[process_id].append({
                    "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
                    "level": level,
                    "message": msg
                })
            
            # Update real-time stats if it's a status line
            match = status_re.search(msg)
            if match:
                fps, bitrate, speed = match.groups()
                with self.db_session_factory() as session:
                    from database.models import MediaProcess
                    media_proc = session.query(MediaProcess).get(process_id)
                    if media_proc:
                        media_proc.fps = fps
                        media_proc.bitrate = bitrate
                        media_proc.speed = speed
                        session.commit()
            
            self.logger.debug(f"[{process_id}] {msg}")
```

- [ ] **Step 4: Commit changes**

```bash
git add backend/core/process_manager.py
git commit -m "feat(core): collect stderr output in circular RAM buffer with log level classification"
```

---

### Task 3: Error Exit Log Database Persistence

**Files:**
- Modify: `/home/alex/LocalRepositories/FFMPEG-GUI/backend/core/process_manager.py`

- [ ] **Step 1: Write log buffer to SQLite on crash in _watchdog**
Modify `/home/alex/LocalRepositories/FFMPEG-GUI/backend/core/process_manager.py` inside `async def _watchdog` to fetch all collected logs from the in-memory buffer and write them to the `ProcessLog` table when the process exits with a non-zero code. Clean up the RAM buffer afterwards.

```python
        finally:
            # Handle termination
            await proc.wait()
            exit_code = proc.returncode
            
            with self.db_session_factory() as session:
                from database.models import MediaProcess, ProcessLog
                media_proc = session.query(MediaProcess).get(process_id)
                if media_proc:
                    if media_proc.type == 'batch':
                        media_proc.status = 'finished' if exit_code == 0 else 'error'
                    else: # service
                        if exit_code != 0:
                            media_proc.status = 'error'
                        else:
                            media_proc.status = 'stopped'
                    
                    media_proc.pid = None
                    media_proc.last_stop = datetime.utcnow()
                    
                    # Persist log buffer if there was an error exit
                    if exit_code != 0 and process_id in self.log_buffers:
                        log_entries = list(self.log_buffers[process_id])
                        db_logs = []
                        for entry in log_entries:
                            # Parse stored ISO timestamp
                            ts_str = entry["timestamp"].rstrip("Z")
                            ts = datetime.fromisoformat(ts_str)
                            db_logs.append(ProcessLog(
                                process_id=process_id,
                                timestamp=ts,
                                level=entry["level"],
                                message=entry["message"]
                            ))
                        if db_logs:
                            session.add_all(db_logs)
                    
                    # Log the exit summary
                    log = ProcessLog(
                        process_id=process_id,
                        level='INFO' if exit_code == 0 else 'ERROR',
                        message=f"Process exited with code {exit_code}"
                    )
                    session.add(log)
                    session.commit()
            
            # Clean up memory buffer
            if process_id in self.log_buffers:
                del self.log_buffers[process_id]
        
            if process_id in self.processes:
                del self.processes[process_id]
```

- [ ] **Step 2: Commit changes**

```bash
git add backend/core/process_manager.py
git commit -m "feat(core): persist log buffer to SQLite on non-zero exit codes"
```

---

### Task 4: Log Retrieval Endpoint Integration

**Files:**
- Modify: `/home/alex/LocalRepositories/FFMPEG-GUI/backend/main.py`

- [ ] **Step 1: Check active buffer in GET logs route**
Modify `backend/main.py` at `get_process_logs` to return the RAM buffer logs if the process is active, and fall back to the database sorted in ascending chronological order if inactive.

```python
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
```

- [ ] **Step 2: Commit changes**

```bash
git add backend/main.py
git commit -m "feat(api): update logs endpoint to serve memory buffer for active processes"
```

---

### Task 5: Verification

**Files:**
- Test: `/home/alex/LocalRepositories/FFMPEG-GUI/backend/utils/test_logging.py` [NEW]

- [ ] **Step 1: Create a simple verification test script**
Create a script to verify the logging backend functionality end-to-end.

```python
import asyncio
from sqlalchemy.orm import sessionmaker
from sqlalchemy import create_engine
import sys
import os

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from database.models import Base, MediaProcess, FfmpegBuild, ProcessLog
from core.process_manager import ProcessManager

def test_flow():
    # Setup test in-memory/temp database
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    
    # Instantiate manager
    pm = ProcessManager(db_session_factory=Session)
    
    # Insert dummy build and process
    with Session() as s:
        build = FfmpegBuild(
            name="system_ffmpeg", ffmpeg_version="system",
            install_path="/usr", ffmpeg_binary="ffmpeg", status="ready", is_default=True
        )
        s.add(build)
        s.commit()
        
        # Define process designed to fail (RGB24 input mapped to H.264 high profile)
        proc = MediaProcess(
            name="verify-fail",
            type="service",
            input_config={
                "has_video": True, "has_audio": False,
                "input1": {"type": "lavfi_video", "pattern": "testsrc"}
            },
            output_config={"type": "udp", "host": "127.0.0.1", "port": "9898"},
            codec_config={
                "vcodec": "libx264",
                "video_params": {"rc_mode": "crf", "crf": 23, "profile": "high"}
            },
            ffmpeg_build_id=build.id
        )
        s.add(proc)
        s.commit()
        proc_id = proc.id

    print(f"Starting process {proc_id} which should fail...")
    asyncio.run(pm.start_process(proc_id))
    
    # Wait for the process watchdog to clean up
    loop = asyncio.get_event_loop()
    async def wait_cleanup():
        for _ in range(10):
            await asyncio.sleep(0.5)
            if proc_id not in pm.processes:
                break
    asyncio.run(wait_cleanup())
    
    with Session() as s:
        db_proc = s.query(MediaProcess).get(proc_id)
        logs = s.query(ProcessLog).filter(ProcessLog.process_id == proc_id).all()
        
        print(f"Process final status: {db_proc.status}")
        print(f"Logs retrieved from database (count: {len(logs)}):")
        for log in logs:
            print(f"[{log.level}] {log.message}")
            
        assert db_proc.status == 'error', "Process should have failed"
        assert len(logs) > 1, "Should have saved FFmpeg failure log lines in database"
        assert any("high profile doesn't support 4:4:4" in l.message for l in logs), "Should contain encoder error"
        print("Verification SUCCESSFUL!")

if __name__ == "__main__":
    test_flow()
```

- [ ] **Step 2: Run verification script**
Run: `python3 backend/utils/test_logging.py`
Expected: Outputs "Verification SUCCESSFUL!" and lists the exact stderr lines from FFmpeg including the profile error.

- [ ] **Step 3: Commit and clean up test script**

```bash
rm backend/utils/test_logging.py
git add -A
git commit -m "test(core): verify process error logging and persistence works end-to-end"
```
