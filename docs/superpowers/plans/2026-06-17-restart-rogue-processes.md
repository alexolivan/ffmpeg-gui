# Restart Rogue Processes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up orphan and rogue `ffmpeg` processes automatically during startup, before launching services/tasks, and as a fallback during stops, utilizing safe environment variables to protect system processes.

**Architecture:** 
1. Inject `FFMPEG_GUI_PROCESS_ID` or `FFMPEG_GUI_EXECUTION_ID` into spawned `ffmpeg` subprocesses' environment.
2. Scan active system processes via `psutil` and selectively send `SIGKILL` to matching processes.
3. Integrate cleanup calls at key states in `ProcessManager`, `TaskManager`, and the startup lifespan in `main.py`.

**Tech Stack:** Python 3.13, psutil, asyncio

---

### Task 1: Create Process Utilities and Unit Tests

**Files:**
- Create: `backend/utils/process_utils.py`
- Create: `backend/tests/test_process_utils.py`

- [ ] **Step 1: Write unit tests for the process cleanup helper**
  Create `backend/tests/test_process_utils.py` with the following content:
  ```python
  import unittest
  from unittest.mock import patch, MagicMock
  import psutil
  import signal
  from utils.process_utils import cleanup_rogue_processes

  class TestProcessUtils(unittest.TestCase):
      @patch('psutil.process_iter')
      def test_cleanup_rogue_processes(self, mock_iter):
          # Mock processes
          mock_proc1 = MagicMock()
          mock_proc1.info = {'pid': 101, 'name': 'ffmpeg'}
          mock_proc1.environ.return_value = {"FFMPEG_GUI_PROCESS_ID": "5"}

          mock_proc2 = MagicMock()
          mock_proc2.info = {'pid': 102, 'name': 'ffmpeg'}
          mock_proc2.environ.return_value = {"FFMPEG_GUI_EXECUTION_ID": "42"}

          mock_proc3 = MagicMock()
          mock_proc3.info = {'pid': 103, 'name': 'ffmpeg'}
          mock_proc3.environ.return_value = {}  # User-run ffmpeg

          mock_proc4 = MagicMock()
          mock_proc4.info = {'pid': 104, 'name': 'nginx'}  # Other service
          mock_proc4.environ.return_value = {}

          mock_iter.return_value = [mock_proc1, mock_proc2, mock_proc3, mock_proc4]

          # Test case 1: target process_id = 5
          cleanup_rogue_processes(process_id=5)
          mock_proc1.send_signal.assert_called_once_with(signal.SIGKILL)
          mock_proc2.send_signal.assert_not_called()

          # Reset mocks
          mock_proc1.reset_mock()
          mock_proc2.reset_mock()

          # Test case 2: target execution_id = 42
          cleanup_rogue_processes(execution_id=42)
          mock_proc1.send_signal.assert_not_called()
          mock_proc2.send_signal.assert_called_once_with(signal.SIGKILL)

          # Reset mocks
          mock_proc1.reset_mock()
          mock_proc2.reset_mock()

          # Test case 3: Startup cleanup with active PIDs = {101}
          cleanup_rogue_processes(active_pids={101})
          mock_proc1.send_signal.assert_not_called()  # Active, do not kill
          mock_proc2.send_signal.assert_called_once_with(signal.SIGKILL)  # Stale, kill
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `PYTHONPATH=backend venv/bin/python3 -m unittest backend/tests/test_process_utils.py`
  Expected: FAIL (ModuleNotFoundError or ImportError on `utils.process_utils`)

- [ ] **Step 3: Write process utilities implementation**
  Create `backend/utils/process_utils.py` with the following content:
  ```python
  import psutil
  import signal
  import logging

  logger = logging.getLogger("ProcessCleanup")

  def cleanup_rogue_processes(process_id: int = None, execution_id: int = None, active_pids = None):
      """
      Iterates over all running system processes and safely kills matching
      orphan or rogue ffmpeg processes started by ffmpeg-gui.
      """
      active_pids = active_pids or set()
      for proc in psutil.process_iter(['pid', 'name']):
          try:
              name = proc.info['name']
              if name and 'ffmpeg' in name.lower():
                  env = proc.environ()
                  pid = proc.info['pid']
                  
                  gui_proc_id = env.get("FFMPEG_GUI_PROCESS_ID")
                  gui_exec_id = env.get("FFMPEG_GUI_EXECUTION_ID")
                  
                  if not gui_proc_id and not gui_exec_id:
                      continue
                  
                  should_kill = False
                  reason = ""
                  
                  if process_id is not None and gui_proc_id == str(process_id):
                      should_kill = True
                      reason = f"matches target process_id {process_id}"
                  elif execution_id is not None and gui_exec_id == str(execution_id):
                      should_kill = True
                      reason = f"matches target execution_id {execution_id}"
                  elif process_id is None and execution_id is None:
                      if gui_proc_id and pid not in active_pids:
                          should_kill = True
                          reason = f"stale process (process_id={gui_proc_id}) not in active list"
                      elif gui_exec_id and pid not in active_pids:
                          should_kill = True
                          reason = f"stale execution (execution_id={gui_exec_id}) not in active list"
                  
                  if should_kill:
                      logger.warning(f"Terminating rogue ffmpeg process {pid} because: {reason}")
                      try:
                          proc.send_signal(signal.SIGKILL)
                      except Exception as e:
                          logger.error(f"Failed to SIGKILL rogue process {pid}: {e}")
          except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
              continue
  ```

- [ ] **Step 4: Run test to verify it passes**
  Run: `PYTHONPATH=backend venv/bin/python3 -m unittest backend/tests/test_process_utils.py`
  Expected: PASS

- [ ] **Step 5: Commit changes**
  Run:
  ```bash
  git add backend/utils/process_utils.py backend/tests/test_process_utils.py
  git commit -m "feat(backend): add custom env-based rogue process cleanup helper and tests"
  ```

---

### Task 2: Integrate in ProcessManager

**Files:**
- Modify: `backend/core/process_manager.py`
- Test: `backend/tests/test_process_manager_restarts.py`

- [ ] **Step 1: Update ProcessManager to run cleanup and inject env**
  In `backend/core/process_manager.py`, import the utility function:
  ```python
  # at the top
  from utils.process_utils import cleanup_rogue_processes
  import os
  ```
  Modify `start_process` around line 50-70 to clean up pre-existing rogue processes and pass `env` to `create_subprocess_exec`:
  ```python
          # Before starting, clean up any pre-existing rogue processes for this process_id
          cleanup_rogue_processes(process_id=process_id)

          with self.db_session_factory() as session:
              from database.models import MediaProcess
              media_proc = session.query(MediaProcess).get(process_id)
              # ...
              
              # When starting, inject environment variable
              sub_env = {**os.environ, "FFMPEG_GUI_PROCESS_ID": str(process_id)}
              
              try:
                  proc = await asyncio.create_subprocess_exec(
                      *cmd,
                      stdout=asyncio.subprocess.PIPE,
                      stderr=asyncio.subprocess.PIPE,
                      stdin=asyncio.subprocess.PIPE,
                      env=sub_env
                  )
  ```
  And in `stop_process` around line 130-136, run cleanup as a final fallback:
  ```python
              if process_id in self.processes:
                  del self.processes[process_id]

              # Run cleanup as fallback to ensure the process and any orphans are dead
              cleanup_rogue_processes(process_id=process_id)
  ```

- [ ] **Step 2: Add test assertion for process cleanup and env injection**
  In `backend/tests/test_process_manager_restarts.py`, patch `cleanup_rogue_processes` and verify it gets called when processes start and stop.
  Run the test suite to verify the mock handles `env` argument properly.
  Run: `PYTHONPATH=backend venv/bin/python3 -m unittest discover -s backend/tests`
  Expected: PASS

- [ ] **Step 3: Commit changes**
  Run:
  ```bash
  git add backend/core/process_manager.py backend/tests/test_process_manager_restarts.py
  git commit -m "feat(backend): integrate rogue process cleanup and environment tagging in ProcessManager"
  ```

---

### Task 3: Integrate in TaskManager

**Files:**
- Modify: `backend/core/task_manager.py`
- Test: `backend/tests/test_task_manager.py`

- [ ] **Step 1: Update TaskManager to run cleanup and inject env**
  In `backend/core/task_manager.py`, import the utility function:
  ```python
  # at the top
  from utils.process_utils import cleanup_rogue_processes
  ```
  Modify `start_execution` around line 50-60 to clean up pre-existing processes and pass `env` to `create_subprocess_exec`:
  ```python
              # Clean up any rogue execution before starting
              cleanup_rogue_processes(execution_id=execution_id)

              # When starting, inject environment variable
              sub_env = {**os.environ, "FFMPEG_GUI_EXECUTION_ID": str(execution_id)}

              try:
                  proc = await asyncio.create_subprocess_exec(
                      *cmd,
                      stdout=asyncio.subprocess.PIPE,
                      stderr=asyncio.subprocess.PIPE,
                      stdin=asyncio.subprocess.PIPE,
                      env=sub_env
                  )
  ```
  And in `stop_execution` around line 615, run cleanup as fallback:
  ```python
              self.running_processes.pop(execution_id, None)
              self.last_activity.pop(execution_id, None)
              
              # Clean up rogue process fallback
              cleanup_rogue_processes(execution_id=execution_id)
  ```

- [ ] **Step 2: Run all tests to verify TaskManager still functions**
  Run: `PYTHONPATH=backend venv/bin/python3 -m unittest discover -s backend/tests`
  Expected: PASS

- [ ] **Step 3: Commit changes**
  Run:
  ```bash
  git add backend/core/task_manager.py
  git commit -m "feat(backend): integrate rogue process cleanup and environment tagging in TaskManager"
  ```

---

### Task 4: Startup Cleanup in main.py

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Query database at startup and run global cleanup**
  In `backend/main.py`, import `cleanup_rogue_processes`:
  ```python
  from utils.process_utils import cleanup_rogue_processes
  ```
  In the `lifespan` function (or startup handler), collect active PIDs from both `MediaProcess` and `TaskExecution` tables in the database.
  Around line 800 (or the startup event / lifespan handler):
  ```python
      # Retrieve active/running PIDs from database
      active_pids = set()
      with SessionLocal() as db:
          running_processes = db.query(MediaProcess).filter(MediaProcess.status == 'running').all()
          for p in running_processes:
              if p.pid:
                  active_pids.add(p.pid)
          
          running_executions = db.query(TaskExecution).filter(TaskExecution.status == 'running').all()
          for ex in running_executions:
              if ex.pid:
                  active_pids.add(ex.pid)

      # Clean up any rogue ffmpeg process started by ffmpeg-gui that is NOT in the active database list
      cleanup_rogue_processes(active_pids=active_pids)
  ```

- [ ] **Step 2: Run all unit tests to ensure main startup doesn't break**
  Run: `PYTHONPATH=backend venv/bin/python3 -m unittest discover -s backend/tests`
  Expected: PASS

- [ ] **Step 3: Commit changes**
  Run:
  ```bash
  git add backend/main.py
  git commit -m "feat(backend): clean up stale and rogue ffmpeg processes on startup in main.py"
  ```
