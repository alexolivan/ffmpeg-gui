# Design Spec: FFmpeg Process Debugging and Log Buffer Architecture

This document describes the design for capturing and exposing real-time FFmpeg process output (stderr) to the frontend console, and persisting the exact failure logs on crash exits (such as exit code 234) without degrading SQLite database performance.

---

## 1. Problem & Context
When an orchestrated FFmpeg process fails (e.g., exit code `234` due to signed `-22 / EINVAL` on encoder setup), the frontend console is empty because the backend logs only the exit status line. All diagnostic stderr output from the running process is currently read and discarded to python's standard logger at `debug` level. 

---

## 2. Architecture & Data Flow

### A. In-Memory Circular Buffers (Active Processes)
- For every active process started, `ProcessManager` maintains a `collections.deque(maxlen=100)` in a dictionary `self.log_buffers: Dict[int, deque]`.
- Each entry in the deque stores a tuple: `(timestamp, level, message)`.
- During stderr streaming:
  - If a line contains error indicators (case-insensitive regex or substrings like `"error"`, `"failed"`, `"invalid"`, `"could not"`), it is marked as `ERROR` or `WARNING`.
  - Otherwise, it is marked as `INFO`.
  - Status lines (parsed via `status_re`) are kept as `INFO` but throttled or kept normally to maintain progress visibility.

### B. REST API Endpoint Integration
- `/processes/{process_id}/logs` is updated:
  - If `process_id` is currently running: it reads the in-memory deque, serializes it to JSON, and returns it.
  - If `process_id` is stopped/failed: it falls back to querying the database table `process_logs` (sorted chronologically).
  
### C. Fault Persistence (Atomic Fail-Save)
- In the watchdog termination logic (`_watchdog` in `ProcessManager`):
  - If `exit_code != 0` (the process crashed/exited with an error):
    - The backend reads the entire contents of `self.log_buffers[process_id]`.
    - It maps these in-memory lines to `ProcessLog` database records and saves them in a single bulk transaction.
    - We ensure the timestamps are incremented slightly (e.g. by milliseconds) or sorted appropriately to preserve the exact sequence.
  - Regardless of the exit code, once the process exits, we remove the entry from `self.log_buffers` to reclaim RAM.

---

## 3. Proposed Changes

### `backend/core/process_manager.py`
- Initialize `self.log_buffers: Dict[int, collections.deque]` in constructor.
- Inside `start_process`:
  - Initialize `self.log_buffers[process_id] = deque(maxlen=100)`.
- Inside `_log_reader`:
  - Decode and clean stderr line.
  - Classify line level (`ERROR` if text contains error keywords, else `INFO`).
  - Append `{"timestamp": datetime.utcnow(), "level": level, "message": message}` to `self.log_buffers[process_id]`.
- Inside `_watchdog` finally block:
  - Extract exit code.
  - If `exit_code != 0`, fetch all logs from `self.log_buffers[process_id]`.
  - Perform bulk insert of these log lines into SQLite `process_logs` table.
  - Clear `self.log_buffers[process_id]`.

### `backend/main.py`
- Update `/processes/{process_id}/logs` route:
  - Check if `process_id` is active in `process_manager.processes` and if a log buffer exists in `process_manager.log_buffers`.
  - If yes, return the serialized in-memory deque.
  - If no, query `ProcessLog` from database. Ensure the query returns logs sorted chronologically (ascending) so the terminal simulator displays them in order.

### `backend/database/models.py`
- Verify relationship ordering. Changing `ProcessLog` sorting from `.desc()` to `.asc()` or sorting by ID/timestamp to guarantee correct chronological order in the frontend terminal pane.

---

## 4. Verification Plan

### Automated/Local Tests
1. **Valid stream run:** Start a correct process. Verify the logs panel in the UI updates dynamically with transcoding stats. Ensure no records are added to `process_logs` in SQLite during execution.
2. **Invalid parameters run (Simulation of Error 234):**
   - Run a process with `rgb24` lavfi source and `libx264` high profile.
   - Verify status goes to `error` immediately.
   - Verify the console logs panel shows the full startup output and the encoder setup error (e.g., `high profile doesn't support 4:4:4`) marked in red.
   - Verify the database `process_logs` has recorded exactly the error logs.
