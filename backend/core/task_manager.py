import asyncio
import errno
import gzip
import psutil
import logging
import os
import shlex
import shutil
import time
from datetime import datetime
import re
from typing import Optional
from database.models import ScheduledTask, TaskExecution, TaskExecutionLog, FfmpegBuild
from utils.process_utils import cleanup_rogue_processes, prepare_process_file_permissions, cleanup_task_progress_files

class TaskManager:
    def __init__(self, db_session_factory, ffmpeg_path="ffmpeg", process_manager=None, build_manager=None):
        self.db_session_factory = db_session_factory
        self.ffmpeg_path = ffmpeg_path
        self.process_manager = process_manager
        self.build_manager = build_manager
        self.logger = logging.getLogger("TaskManager")
        self.running_processes = {}
        self.last_activity = {}
        self._last_status_commit = {}
        self._notified_failed_executions = set()
        self._aborted_executions = set()
        self._active_forge_exec_id: Optional[int] = None
        self._last_log_cleanup_ts = 0.0
        self._log_monitor_task = None

    def notify_task_failure(self, execution_id: int, task_name: str, error_msg: Optional[str] = None):
        if execution_id in self._notified_failed_executions:
            return
        self._notified_failed_executions.add(execution_id)

        from core.notification_manager import NotificationManager
        nm = NotificationManager()
        if nm.is_enabled() and nm.config.get("notify_task_failures", True):
            body = f"Scheduled task '{task_name}' (Execution ID: {execution_id}) failed."
            if error_msg:
                body += f"\nDetails: {error_msg}"
            nm.enqueue_notification({
                "subject": f"[FFmpeg-GUI Alert] Task Execution Failed: {task_name}",
                "body": body
            })

    def _detect_ffmpeg(self):
        local_bin = os.path.abspath("./ffmpeg_bin/bin/ffmpeg")
        if os.path.exists(local_bin):
            return local_bin
        return self.ffmpeg_path

    async def start_execution(self, execution_id: int):
        cleanup_rogue_processes(execution_id=execution_id)
        
        # Check active thermal protection gate
        try:
            from core.hardware_health import hardware_health_manager
            if hardware_health_manager.active_protection_enabled:
                snap = hardware_health_manager.get_health_snapshot()
                if snap.get("status") == "critical":
                    err_msg = (
                        f"Thermal protection active: execution halted due to critical hardware "
                        f"temperature ({snap.get('max_temp_c')}°C >= {hardware_health_manager.critical_threshold_c}°C)"
                    )
                    with self.db_session_factory() as session:
                        ex = session.query(TaskExecution).get(execution_id)
                        if ex:
                            ex.status = 'error'
                            ex.error_message = err_msg
                            ex.stopped_at = datetime.utcnow()
                            session.commit()
                            t_name = getattr(ex.task, 'name', f"Task #{execution_id}") if ex.task else f"Task #{execution_id}"
                            self.notify_task_failure(execution_id, t_name, error_msg=err_msg)
                    raise RuntimeError(err_msg)
        except RuntimeError:
            raise
        except Exception as e:
            logger.debug(f"Thermal protection check error: {e}")

        # 1. Fetch task and calculate limits in a quick database transaction
        with self.db_session_factory() as session:
            execution = session.query(TaskExecution).get(execution_id)

            if not execution:
                return
            task = execution.task

            # If task command starts with "system://", run it internally
            if task.command and task.command.startswith("system://"):
                execution.started_at = datetime.utcnow()
                execution.status = 'running'
                session.commit()
                # Run the system task asynchronously and return!
                asyncio.create_task(self._run_system_task(execution_id, task.command))
                return

            # Calculate duration limit
            limit_sec = None
            if task.duration_type == 'timer':
                limit_sec = task.duration_seconds
            elif task.duration_type == 'end_time' and task.duration_end_time:
                now = datetime.utcnow()
                diff = (task.duration_end_time - now).total_seconds()
                limit_sec = max(1, int(diff))

            execution.duration_limit_seconds = limit_sec
            execution.started_at = datetime.utcnow()
            execution.status = 'running'

            # Command building
            ffmpeg_bin = self._detect_ffmpeg()
            if task.ffmpeg_build_id:
                build = session.query(FfmpegBuild).get(task.ffmpeg_build_id)
                if build and build.ffmpeg_binary and os.path.exists(build.ffmpeg_binary):
                    ffmpeg_bin = build.ffmpeg_binary

            # Resolve and validate paths before starting
            import copy
            val_input = copy.deepcopy(task.input_config)
            val_output = copy.deepcopy(task.output_config)
            val_filter = copy.deepcopy(task.filter_config or {})
            self._resolve_config_paths(val_input, val_output, val_filter)
            try:
                self._validate_paths(val_input, val_output, val_filter)
            except Exception as val_err:
                execution.status = 'error'
                execution.error_message = str(val_err)
                execution.stopped_at = datetime.utcnow()
                session.commit()
                raise val_err

            cmd = self._build_ffmpeg_cmd(task, ffmpeg_bin, limit_sec, execution_id=execution_id)
            task_id = task.id
            task_name = getattr(task, 'name', f"Task {task_id}")
            allow_start = getattr(task, 'allow_auto_start_deps', True)
            session.commit()  # Release write locks immediately before slow spawn!
            
        try:
            # Acquire dependency leases
            from core.dependency_manager import dependency_manager
            await dependency_manager.acquire_dependencies('task', task_id, allow_auto_start=allow_start)

            # Check and acquire exclusive resource lock for publisher outputs
            from core.resource_lock_manager import resource_lock_manager
            ok_lock, err_lock, lock_info = resource_lock_manager.acquire_lock(
                owner_type="task",
                owner_id=execution_id,
                output_config=val_output,
                owner_name=task_name
            )
            if not ok_lock:
                self.logger.error(f"Cannot start task execution {execution_id}: {err_lock}")
                with self.db_session_factory() as session:
                    execution = session.query(TaskExecution).get(execution_id)
                    if execution:
                        execution.status = 'error'
                        execution.error_message = err_lock
                        execution.stopped_at = datetime.utcnow()
                        session.commit()
                await dependency_manager.release_dependencies('task', task_id, allow_auto_stop=True)
                raise RuntimeError(err_lock)

            # 2. Spawn subprocess (outside database session)
            prepare_process_file_permissions(execution_id=execution_id, logger=self.logger)
            self.logger.info(f"Starting scheduled task FFmpeg cmd: {shlex.join(cmd)}")
            
            # Check if this scheduled task consumes or produces to a PipeWire Hub
            pw_provider_id = None
            check_targets = [val_input, val_output]
            if isinstance(val_input, dict):
                if "input1" in val_input:
                    check_targets.append(val_input.get("input1"))
                if "input2" in val_input:
                    check_targets.append(val_input.get("input2"))
            for c in check_targets:
                if c and isinstance(c, dict) and c.get("type") in ("pipewire", "pipewire_hub"):
                    cand_id = c.get("provider_service_id") or c.get("pipewire_service_id")
                    if cand_id:
                        try:
                            pw_provider_id = int(cand_id)
                            break
                        except (ValueError, TypeError):
                            pass

            if not pw_provider_id:
                for c in check_targets:
                    if c and isinstance(c, dict) and c.get("type") in ("pipewire", "pipewire_hub"):
                        try:
                            with self.db_session_factory() as session:
                                from database.models import Service
                                pw_hubs = session.query(Service).filter(Service.service_type == "pipewire_hub").all()
                                if len(pw_hubs) == 1:
                                    pw_provider_id = pw_hubs[0].id
                                    break
                        except Exception:
                            pass

            sub_env = {**os.environ, "FFMPEG_GUI_EXECUTION_ID": str(execution_id)}
            if pw_provider_id:
                sub_env["PULSE_SERVER"] = f"unix:/tmp/ffmpeg-gui/pipewire-{pw_provider_id}/pulse.sock"
                sub_env["PIPEWIRE_RUNTIME_DIR"] = f"/tmp/ffmpeg-gui/pipewire-{pw_provider_id}"
                sub_env["PULSE_RUNTIME_PATH"] = f"/tmp/ffmpeg-gui/pipewire-{pw_provider_id}"
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                stdin=asyncio.subprocess.PIPE,
                env=sub_env
            )
            self.running_processes[execution_id] = proc
            self.last_activity[execution_id] = datetime.utcnow()
            if self.process_manager and hasattr(self.process_manager, "notify_pipewire_matrix_change"):
                self.process_manager.notify_pipewire_matrix_change()
            
            # 3. Update execution PID and status in a second short transaction
            with self.db_session_factory() as session:
                execution = session.query(TaskExecution).get(execution_id)
                if execution:
                    execution.pid = proc.pid
                    session.commit()
            
            asyncio.create_task(self._log_reader(execution_id, proc))
            asyncio.create_task(self._watchdog(execution_id, proc, limit_sec))
            
        except Exception as e:
            self.logger.exception(f"Failed to start task execution {execution_id}")
            with self.db_session_factory() as session:
                execution = session.query(TaskExecution).get(execution_id)
                if execution:
                    execution.status = 'error'
                    execution.error_message = str(e)
                    execution.stopped_at = datetime.utcnow()
                    execution.pid = None
                    execution.cpu_usage = 0
                    execution.ram_usage = 0
                    session.commit()
                    task_name = execution.task.name if execution.task else str(execution_id)
                    self.notify_task_failure(execution_id, task_name, str(e))
            from core.dependency_manager import dependency_manager
            await dependency_manager.release_dependencies('task', task_id, allow_auto_stop=True)
            from core.resource_lock_manager import resource_lock_manager
            resource_lock_manager.release_lock('task', execution_id)

    def _resolve_storage_path(self, storage_id: Optional[int], relative_path: Optional[str]) -> Optional[str]:
        if not storage_id:
            return None
        with self.db_session_factory() as session:
            from database.models import Storage
            storage = session.query(Storage).get(storage_id)
            if storage and storage.path:
                return os.path.join(storage.path, relative_path or '')
        return None

    def _resolve_config_paths(self, input_cfg: dict, output_cfg: dict, filter_cfg: dict):
        # Resolve input_cfg paths
        if 'input1' in input_cfg:
            for key in ['input1', 'input2']:
                if key in input_cfg and isinstance(input_cfg[key], dict):
                    inp = input_cfg[key]
                    if inp.get('storage_id'):
                        resolved = self._resolve_storage_path(inp.get('storage_id'), inp.get('relative_path'))
                        if resolved:
                            inp['path'] = resolved
        else:
            if input_cfg.get('storage_id'):
                resolved = self._resolve_storage_path(input_cfg.get('storage_id'), input_cfg.get('relative_path'))
                if resolved:
                    input_cfg['path'] = resolved

        # Resolve output_cfg paths
        if output_cfg.get('storage_id'):
            resolved = self._resolve_storage_path(output_cfg.get('storage_id'), output_cfg.get('relative_path'))
            if resolved:
                output_cfg['path'] = resolved

        # Resolve filter_cfg overlays paths
        overlays = filter_cfg.get('overlays', [])
        for overlay in overlays:
            if isinstance(overlay, dict) and overlay.get('storage_id'):
                resolved = self._resolve_storage_path(overlay.get('storage_id'), overlay.get('relative_path'))
                if resolved:
                    overlay['path'] = resolved

    def _validate_paths(self, input_cfg: dict, output_cfg: dict, filter_cfg: dict):
        inputs = []
        if 'input1' in input_cfg:
            inputs.append(input_cfg['input1'])
            if input_cfg.get('use_secondary_input') and 'input2' in input_cfg:
                inputs.append(input_cfg['input2'])
        else:
            inputs.append(input_cfg)

        for inp in inputs:
            if inp.get('type') == 'file':
                path = inp.get('path')
                if not path:
                    raise ValueError("Input file path is required")
                if not os.path.exists(path):
                    raise FileNotFoundError(f"Input file does not exist: {path}")

        out_type = output_cfg.get('type')
        if out_type == 'file':
            path = output_cfg.get('path')
            if not path:
                raise ValueError("Output file path is required")
            out_dir = os.path.dirname(os.path.abspath(path))
            if not os.path.exists(out_dir):
                try:
                    os.makedirs(out_dir, exist_ok=True)
                except Exception as e:
                    raise ValueError(f"Output directory does not exist and cannot be created: {out_dir}. Error: {e}")
            if not os.access(out_dir, os.W_OK):
                raise PermissionError(f"Output directory is not writeable: {out_dir}")
        elif out_type == 'hls' and output_cfg.get('hls_method', 'local') == 'local':
            path = output_cfg.get('path')
            if not path:
                raise ValueError("HLS directory path is required")
            out_dir = os.path.abspath(path)
            if not os.path.exists(out_dir):
                try:
                    os.makedirs(out_dir, exist_ok=True)
                except Exception as e:
                    raise ValueError(f"HLS output directory does not exist and cannot be created: {out_dir}. Error: {e}")
            if not os.access(out_dir, os.W_OK):
                raise PermissionError(f"HLS output directory is not writeable: {out_dir}")

        overlays = filter_cfg.get('overlays', [])
        for overlay in overlays:
            if isinstance(overlay, dict) and overlay.get('type') == 'image':
                path = overlay.get('path')
                if not path:
                    raise ValueError("Overlay image path is required")
                if not os.path.exists(path):
                    raise FileNotFoundError(f"Overlay image does not exist: {path}")

    @staticmethod
    def _build_srt_url(srt_cfg: dict, direction: str = "output", ffmpeg_bin: str = "ffmpeg", network_timeout: int = 15) -> str:
        """Helper to build formatted SRT URL supporting MediaMTX access control."""
        from core.builders.ffmpeg_builder import FFmpegCommandBuilder
        return FFmpegCommandBuilder._build_srt_url(srt_cfg, direction=direction, ffmpeg_bin=ffmpeg_bin, network_timeout=network_timeout)

    def _build_ffmpeg_cmd(self, task, ffmpeg_bin, limit_sec=None, execution_id=None):
        from core.builders.ffmpeg_builder import FFmpegCommandBuilder
        return FFmpegCommandBuilder.build_cmd(
            task, ffmpeg_bin, limit_sec=limit_sec, execution_id=execution_id, db_session_factory=self.db_session_factory
        )

    async def stop_execution(self, execution_id: int, status="stopped", error_msg=None):
        self._aborted_executions.add(execution_id)
        if self._active_forge_exec_id == execution_id and self.build_manager and getattr(self.build_manager, "is_building", False):
            try:
                await self.build_manager.stop_build()
            except Exception as exc:
                self.logger.error(f"Failed stopping active Forge build for execution {execution_id}: {exc}")
        proc = self.running_processes.get(execution_id)
        if proc:
            if proc.stdin:
                try:
                    proc.stdin.write(b'q')
                    await proc.stdin.drain()
                    await asyncio.wait_for(proc.wait(), timeout=5.0)
                except Exception:
                    try: proc.kill()
                    except Exception: pass
            else:
                try: proc.kill()
                except Exception: pass
            try: await proc.wait()
            except Exception: pass
            self.running_processes.pop(execution_id, None)
            self.last_activity.pop(execution_id, None)

        cleanup_rogue_processes(execution_id=execution_id)
        cleanup_task_progress_files(execution_id)

        task_id = None
        allow_stop = True
        with self.db_session_factory() as session:
            execution = session.query(TaskExecution).get(execution_id)
            if execution:
                task_id = execution.task_id
                if execution.task:
                    allow_stop = getattr(execution.task, 'allow_auto_stop_deps', True)
                execution.status = status
                if error_msg:
                    execution.error_message = error_msg
                execution.stopped_at = datetime.utcnow()
                execution.pid = None
                execution.cpu_usage = 0
                execution.ram_usage = 0
                session.commit()
                if status == 'error':
                    task_name = execution.task.name if execution.task else str(execution_id)
                    self.notify_task_failure(execution_id, task_name, error_msg)

        if task_id:
            from core.dependency_manager import dependency_manager
            await dependency_manager.release_dependencies('task', task_id, allow_auto_stop=allow_stop)

        from core.resource_lock_manager import resource_lock_manager
        resource_lock_manager.release_lock('task', execution_id)

    async def _log_reader(self, execution_id: int, proc):
        # Regex for ffmpeg status line (supports bitrate=N/A for DeckLink/NDI outputs, and optional fps for audio-only outputs)
        status_re = re.compile(r"(?:fps=\s*([\d.]+).*?)?bitrate=\s*([\d.]+kbits/s|N/A).*speed=\s*([\d.]+x)")
        buffer = bytearray()
        
        while True:
            chunk = await proc.stderr.read(4096)
            if not chunk:
                if buffer:
                    msg = buffer.decode('utf-8', errors='replace').strip()
                    if msg:
                        self._handle_log_line(execution_id, msg, status_re)
                break
            for b in chunk:
                char = bytes([b])
                if char in (b'\r', b'\n'):
                    if buffer:
                        msg = buffer.decode('utf-8', errors='replace').strip()
                        buffer.clear()
                        if msg:
                            self._handle_log_line(execution_id, msg, status_re)
                else:
                    buffer.extend(char)

    def _handle_log_line(self, execution_id: int, msg: str, status_re):
        self.last_activity[execution_id] = datetime.utcnow()
        level = "ERROR" if any(kw in msg.lower() for kw in ["error", "failed", "invalid"]) else "INFO"

        # Check if it is an ephemeral status update line
        match = status_re.search(msg) if status_re else None
        if match:
            import time
            now = time.time()
            # Throttle database metrics commit to at most once per 2 seconds
            if now - self._last_status_commit.get(execution_id, 0.0) >= 2.0:
                self._last_status_commit[execution_id] = now
                fps, bitrate, speed = match.groups()
                try:
                    with self.db_session_factory() as session:
                        execution = session.query(TaskExecution).get(execution_id)
                        if execution:
                            execution.fps = fps if fps is not None else "N/A"
                            execution.bitrate = bitrate
                            execution.speed = speed
                            session.commit()
                except Exception as e:
                    self.logger.error(f"Failed to update task metrics in DB for execution {execution_id}: {e}")
            # Do NOT persist high-frequency ephemeral status updates into TaskExecutionLog table
            return

        try:
            with self.db_session_factory() as session:
                log = TaskExecutionLog(execution_id=execution_id, level=level, message=msg)
                session.add(log)
                session.commit()
        except Exception as e:
            self.logger.error(f"Failed to write log line to DB for execution {execution_id}: {e}")

    async def _watchdog(self, execution_id: int, proc, limit_sec):
        start_time = datetime.utcnow()
        hard_limit = (limit_sec * 5 + 600) if limit_sec else 3600 * 12
        
        try:
            p = psutil.Process(proc.pid)
            p.cpu_percent(interval=None)
            while proc.returncode is None:
                now = datetime.utcnow()
                
                # Check 1: Hard timeout limit
                if (now - start_time).total_seconds() > hard_limit:
                    self.logger.warning(f"Safety watchdog: execution {execution_id} exceeded hard time limit. Force killing...")
                    await self.stop_execution(execution_id, status="error", error_msg="Execution timed out (exceeded hard limit)")
                    return

                # Check 2: Inactivity timeout (no logs)
                last_active = self.last_activity.get(execution_id, start_time)
                if (now - last_active).total_seconds() > 60:
                    self.logger.warning(f"Safety watchdog: execution {execution_id} stopped producing logs for 60s. Force killing...")
                    await self.stop_execution(execution_id, status="error", error_msg="Execution hung (no log activity for 60s)")
                    return

                try:
                    cpu_raw = p.cpu_percent(interval=None)
                    num_cores = psutil.cpu_count() or 1
                    cpu = int(cpu_raw / num_cores)
                    mem = int(p.memory_info().rss / (1024 * 1024))
                except Exception:
                    cpu, mem = 0, 0
                
                try:
                    with self.db_session_factory() as session:
                        execution = session.query(TaskExecution).get(execution_id)
                        if execution:
                            execution.cpu_usage = cpu
                            execution.ram_usage = mem
                            session.commit()
                except Exception as e:
                    self.logger.error(f"Watchdog failed to update task metrics in DB for execution {execution_id}: {e}")

                await asyncio.sleep(1)
        except Exception:
            pass
        finally:
            await proc.wait()
            exit_code = proc.returncode
            
            should_retry = False
            retry_delay = 10
            max_retries = 0
            
            task_id = None
            allow_stop = True
            with self.db_session_factory() as session:
                execution = session.query(TaskExecution).get(execution_id)
                if execution:
                    task_id = execution.task_id
                    if execution.task:
                        allow_stop = getattr(execution.task, 'allow_auto_stop_deps', True)
                    if execution.status == 'running':
                        if exit_code == 0:
                            execution.status = 'finished'
                            execution.exit_code = 0
                            execution.error_message = None
                            execution.stopped_at = datetime.utcnow()
                            execution.pid = None
                            execution.cpu_usage = 0
                            execution.ram_usage = 0
                            session.commit()
                        else:
                            retry_policy = (execution.task.retry_policy or {}) if execution.task else {}
                            max_retries = int(retry_policy.get('max_retries', 0) or 0)
                            retry_delay = int(retry_policy.get('retry_delay', 10) or 10)
                            current_retries = execution.retry_count or 0
                            
                            if current_retries < max_retries:
                                should_retry = True
                                execution.retry_count = current_retries + 1
                                execution.status = 'retrying'
                                execution.error_message = f"Failed with exit code {exit_code}. Retry {execution.retry_count}/{max_retries} scheduled in {retry_delay}s..."
                                session.commit()
                            else:
                                execution.status = 'error'
                                execution.exit_code = exit_code
                                execution.stopped_at = datetime.utcnow()
                                execution.pid = None
                                execution.cpu_usage = 0
                                execution.ram_usage = 0
                                session.commit()
                                task_name = execution.task.name if execution.task else str(execution_id)
                                self.notify_task_failure(execution_id, task_name, f"Exited with code {exit_code} (All {max_retries} retries exhausted)")

            self.running_processes.pop(execution_id, None)
            self.last_activity.pop(execution_id, None)
            cleanup_task_progress_files(execution_id)
            if self.process_manager and hasattr(self.process_manager, "notify_pipewire_matrix_change"):
                self.process_manager.notify_pipewire_matrix_change()
            
            if not should_retry:
                from core.resource_lock_manager import resource_lock_manager
                resource_lock_manager.release_lock('task', execution_id)
                if task_id:
                    from core.dependency_manager import dependency_manager
                    await dependency_manager.release_dependencies('task', task_id, allow_auto_stop=allow_stop)

            if should_retry:
                self.logger.info(f"Task execution {execution_id} failed. Waiting {retry_delay}s before retry attempt...")
                await asyncio.sleep(retry_delay)
                asyncio.create_task(self.start_execution(execution_id))

    async def _run_system_task(self, execution_id: int, command: str):
        self.logger.info(f"Running system task {command} for execution {execution_id}")
        
        status = 'finished'
        error_msg = None
        
        def _append_live_log(level: str, msg: str):
            log_level = logging.ERROR if level == 'ERROR' else logging.WARNING if level == 'WARN' else logging.INFO
            self.logger.log(log_level, f"[Execution {execution_id}] {msg}")
            try:
                with self.db_session_factory() as session:
                    log_record = TaskExecutionLog(
                        execution_id=execution_id,
                        level=level,
                        message=msg
                    )
                    session.add(log_record)
                    session.commit()
            except Exception as e:
                self.logger.error(f"Failed to append live task log: {e}")

        def log_info(msg: str):
            _append_live_log("INFO", msg)

        def log_warn(msg: str):
            _append_live_log("WARN", msg)

        def log_error(msg: str):
            _append_live_log("ERROR", msg)
            
        try:
            if command == "system://log_rotate":
                await self._execute_log_rotate(log_info, log_error)
            elif command == "system://ssl_renew":
                await self._execute_ssl_renew(log_info, log_error)
            elif command == "system://service_restart":
                input_cfg = {}
                with self.db_session_factory() as session:
                    ex = session.query(TaskExecution).get(execution_id)
                    if ex and ex.task and ex.task.input_config:
                        input_cfg = ex.task.input_config
                ok = await self._execute_service_restart(execution_id, input_cfg, log_info, log_warn, log_error)
                if not ok:
                    status = 'error'
                    error_msg = "One or more services failed to restart"
            elif command == "system://forge_build":
                input_cfg = {}
                with self.db_session_factory() as session:
                    ex = session.query(TaskExecution).get(execution_id)
                    if ex and ex.task and ex.task.input_config:
                        input_cfg = ex.task.input_config
                ok = await self._execute_forge_build(execution_id, input_cfg, log_info, log_warn, log_error)
                if not ok:
                    status = 'error'
                    error_msg = "One or more Forge build profiles failed to compile"
            else:
                raise ValueError(f"Unknown system command: {command}")
        except Exception as e:
            self.logger.exception(f"System task {command} failed")
            log_error(f"Error executing system task: {str(e)}")
            status = 'error'
            error_msg = str(e)
            
        # Update execution status in DB (respecting cancellation)
        is_aborted = execution_id in self._aborted_executions
        self._aborted_executions.discard(execution_id)

        try:
            with self.db_session_factory() as session:
                execution = session.query(TaskExecution).get(execution_id)
                if execution:
                    if is_aborted:
                        execution.status = 'stopped'
                    else:
                        execution.status = status
                        if error_msg:
                            execution.error_message = error_msg
                    execution.stopped_at = datetime.utcnow()
                    session.commit()
                    if execution.status == 'error':
                        task_name = execution.task.name if execution.task else command
                        self.notify_task_failure(execution_id, task_name, error_msg)
        except Exception as db_err:
            self.logger.error(f"Failed to save system task execution results: {db_err}")

    async def _execute_service_restart(self, execution_id: int, input_config: dict, log_info, log_warn, log_error) -> bool:
        from database.models import Service
        from core.audit_logger import audit_logger

        if not self.process_manager:
            log_error("ProcessManager is not available on TaskManager.")
            return False

        service_ids = input_config.get("service_ids", [])
        if not service_ids or not isinstance(service_ids, list):
            log_warn("No services specified in service restart sequence.")
            return True

        only_if_running = bool(input_config.get("only_if_running", True))
        stagger_delay = max(0, int(input_config.get("stagger_delay_seconds", 5) or 0))

        log_info(f"Starting service maintenance restart sequence for {len(service_ids)} service(s) (stagger delay: {stagger_delay}s, only_if_running: {only_if_running}).")

        all_success = True
        for idx, sid in enumerate(service_ids):
            # Cancellation check
            if execution_id in self._aborted_executions:
                log_warn("Service maintenance restart sequence aborted by user.")
                return False

            try:
                target_id = int(sid)
            except (ValueError, TypeError):
                log_warn(f"Invalid service ID '{sid}' in sequence (skipped).")
                continue

            with self.db_session_factory() as session:
                svc = session.query(Service).get(target_id)
                if not svc:
                    log_warn(f"Service #{target_id} not found in database (skipped).")
                    continue
                svc_name = svc.name
                svc_status = svc.status

            # Check if running
            is_active = (svc_status in ("running", "starting", "restarting")) or (target_id in getattr(self.process_manager, "processes", {}))
            if only_if_running and not is_active:
                log_info(f"[{idx + 1}/{len(service_ids)}] Service '{svc_name}' (#{target_id}) is currently {svc_status} (skipped).")
                continue

            log_info(f"[{idx + 1}/{len(service_ids)}] Restarting service '{svc_name}' (#{target_id})...")
            try:
                await self.process_manager.stop_process(target_id, is_restart=True)
                await asyncio.sleep(0.5)
                start_res = await self.process_manager.start_process(target_id, is_restart=True)
                if start_res is False:
                    all_success = False
                    log_error(f"Failed to restart service '{svc_name}' (#{target_id}): start_process returned failure.")
                else:
                    log_info(f"Service '{svc_name}' (#{target_id}) restarted successfully.")
                    try:
                        audit_logger.log(
                            action="SERVICE_RESTART",
                            target_type="service",
                            target_id=target_id,
                            target_name=svc_name,
                            channel="SYSTEM_TASK",
                            username="scheduler",
                            details=f"Preventive maintenance restart via task execution #{execution_id}"
                        )
                    except Exception as audit_err:
                        self.logger.debug(f"Audit log failed for service restart: {audit_err}")
            except Exception as restart_err:
                all_success = False
                log_error(f"Exception restarting service '{svc_name}' (#{target_id}): {restart_err}")

            # If more services remain and not aborted, apply stagger delay
            if idx < len(service_ids) - 1:
                elapsed = 0.0
                while elapsed < stagger_delay:
                    if execution_id in self._aborted_executions:
                        log_warn("Service maintenance restart sequence aborted by user during stagger delay.")
                        return False
                    step = min(0.25, stagger_delay - elapsed)
                    await asyncio.sleep(step)
                    elapsed += step

        log_info(f"Service maintenance restart sequence finished {'with errors' if not all_success else 'successfully'}.")
        return all_success

    async def _execute_forge_build(self, execution_id: int, input_config: dict, log_info, log_warn, log_error) -> bool:
        """Execute scheduled Forge compilations (nightly/deferred) sequentially."""
        from core.forge_executor import build_needs_recompile, execute_forge_build_pipeline
        from database.models import SoftwareBuild

        if not self.build_manager:
            log_error("BuildManager is not available on TaskManager.")
            return False

        raw_bids = input_config.get("build_ids")
        target_mode = input_config.get("target_mode") or ("all_pending" if not raw_bids else "selected")
        only_if_pending = True if target_mode == "all_pending" else bool(input_config.get("only_if_pending", True))
        max_jobs = input_config.get("max_jobs")
        low_priority = bool(input_config.get("low_priority", True))
        clean = bool(input_config.get("clean", True))

        candidates: list[tuple[int, str]] = []
        with self.db_session_factory() as session:
            if target_mode == "all_pending":
                all_compiled = (
                    session.query(SoftwareBuild)
                    .filter(SoftwareBuild.source_type == "compiled")
                    .order_by(SoftwareBuild.id.asc())
                    .all()
                )
                for b in all_compiled:
                    needs, _, _ = build_needs_recompile(b)
                    if needs:
                        candidates.append((b.id, b.name))
            else:
                req_ids = raw_bids if isinstance(raw_bids, list) else []
                for raw_bid in req_ids:
                    try:
                        bid = int(raw_bid)
                    except (TypeError, ValueError):
                        log_warn(f"Invalid build ID '{raw_bid}' in Forge task (skipped).")
                        continue
                    b = session.query(SoftwareBuild).get(bid)
                    if not b:
                        log_warn(f"Build profile #{bid} not found (skipped).")
                        continue
                    if (getattr(b, "source_type", "compiled") or "compiled") != "compiled":
                        log_warn(f"Build profile '{b.name}' (#{bid}) is not Forge-compiled (skipped).")
                        continue
                    if only_if_pending:
                        needs, _, _ = build_needs_recompile(b)
                        if not needs:
                            log_info(f"Skipping '{b.name}' (#{bid}): already up-to-date with active recipe.")
                            continue
                    candidates.append((b.id, b.name))

        if not candidates:
            log_info("All target Forge profiles are already up-to-date. Nothing to compile.")
            return True

        log_info(
            f"Starting Forge scheduled build queue for {len(candidates)} profile(s) "
            f"(max_jobs={max_jobs or 'auto'}, low_priority={low_priority}, clean={clean})."
        )

        all_success = True
        for bid, bname in candidates:
            if execution_id in self._aborted_executions:
                log_warn("Scheduled Forge build queue aborted by user.")
                return False

            if self.build_manager.is_building:
                log_warn("Waiting because another manual compilation is currently active...")
                for _ in range(12):
                    if not self.build_manager.is_building or execution_id in self._aborted_executions:
                        break
                    await asyncio.sleep(5)
                if execution_id in self._aborted_executions:
                    log_warn("Scheduled Forge build queue aborted by user.")
                    return False
                if self.build_manager.is_building:
                    log_error(f"Timed out waiting for active compilation before '{bname}' (#{bid}).")
                    all_success = False
                    break

            log_info(f"Compiling Forge profile '{bname}' (#{bid})...")

            def _forward_stage_log(msg: str):
                text = (msg or "").strip()
                if not text:
                    return
                if "━━━" in text or text.startswith("FATAL") or text.startswith("ERROR"):
                    for line in text.splitlines():
                        line = line.strip()
                        if line:
                            if line.startswith(("FATAL", "ERROR")):
                                log_error(f"[{bname}] {line}")
                            else:
                                log_info(f"[{bname}] {line}")

            self._active_forge_exec_id = execution_id
            try:
                res = await execute_forge_build_pipeline(
                    bid,
                    self.db_session_factory,
                    self.build_manager,
                    clean=clean,
                    max_jobs=max_jobs,
                    low_priority=low_priority,
                    extra_log_callback=_forward_stage_log,
                )
            finally:
                if self._active_forge_exec_id == execution_id:
                    self._active_forge_exec_id = None

            if res.get("success"):
                log_info(f"Forge profile '{bname}' (#{bid}) compiled and swapped successfully.")
            else:
                all_success = False
                log_error(f"Forge profile '{bname}' (#{bid}) failed: {res.get('error', 'Unknown error')}")

        return all_success

    @staticmethod
    def _is_icecast_archive_name(filename: str) -> bool:
        """Recognize Icecast rotated logs: .old, .N, .YYYYMMDD_HHMMSS, and .gz variants."""
        if filename.endswith(".old") or filename.endswith(".gz"):
            return True
        if re.search(r"\.\d+(\.gz)?$", filename):
            return True
        if re.search(r"\.\d{8}_\d{6}(\.gz)?$", filename):
            return True
        return False

    @staticmethod
    def _is_compression_enforced(target_dir: str, configured_compression: bool) -> bool:
        """Enable compression if configured, on small volumes (<=512 MB tmpfs), or above 70% disk usage."""
        if configured_compression:
            return True
        try:
            usage = shutil.disk_usage(target_dir)
            if usage.total > 0:
                if usage.total <= 512 * 1024 * 1024:
                    return True
                if (usage.used / usage.total) >= 0.70:
                    return True
        except Exception:
            pass
        return False

    @staticmethod
    def _extract_numeric_archive_index(filename: str, base_name: str) -> Optional[int]:
        if not filename.startswith(base_name + "."):
            return None
        rest = filename[len(base_name) + 1:]
        m = re.match(r"^(\d+)(?:\.gz)?$", rest)
        return int(m.group(1)) if m else None

    def _compress_file_atomic(self, src_path: str, log_info, log_error) -> Optional[str]:
        gz_path = f"{src_path}.gz"
        tmp_path = f"{gz_path}.rot_tmp"
        try:
            st = os.stat(src_path)
            with open(src_path, "rb") as f_in:
                with gzip.open(tmp_path, "wb") as f_out:
                    shutil.copyfileobj(f_in, f_out)
            os.replace(tmp_path, gz_path)
            try:
                os.utime(gz_path, (st.st_atime, st.st_mtime))
            except Exception:
                pass
            os.remove(src_path)
            log_info(f"Compressed archive: {os.path.basename(src_path)} -> {os.path.basename(gz_path)}")
            return gz_path
        except Exception as comp_err:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass
            log_error(f"Failed to compress {os.path.basename(src_path)}: {comp_err}")
            return None

    def _shift_numbered_archives(self, base_path: str, backup_count: int, log_info):
        backup_count = max(1, int(backup_count or 5))
        parent_dir = os.path.dirname(os.path.abspath(base_path))
        base_name = os.path.basename(base_path)
        if not os.path.isdir(parent_dir):
            return
        # Remove any existing archives >= backup_count first
        for fname in os.listdir(parent_dir):
            idx = self._extract_numeric_archive_index(fname, base_name)
            if idx is not None and idx >= backup_count:
                try:
                    os.remove(os.path.join(parent_dir, fname))
                    log_info(f"Pruned excess log archive: {fname}")
                except Exception:
                    pass
        # Shift i -> i + 1 descending from backup_count - 1 down to 1
        for i in range(backup_count - 1, 0, -1):
            for ext in (".gz", ""):
                src = os.path.join(parent_dir, f"{base_name}.{i}{ext}")
                dst = os.path.join(parent_dir, f"{base_name}.{i + 1}{ext}")
                if os.path.exists(src):
                    try:
                        os.replace(src, dst)
                    except Exception:
                        pass

    def _rotate_active_file(
        self,
        active_path: str,
        max_bytes: int,
        backup_count: int,
        compression_enabled: bool,
        log_info,
        log_error,
        shift_backups: bool = True,
    ):
        if not active_path or not os.path.isfile(active_path):
            return
        try:
            sz = os.path.getsize(active_path)
        except OSError:
            return
        if sz <= max_bytes:
            return

        parent_dir = os.path.dirname(os.path.abspath(active_path))
        use_gzip = self._is_compression_enforced(parent_dir, compression_enabled)
        if shift_backups:
            self._shift_numbered_archives(active_path, backup_count, log_info)

        arch_path = f"{active_path}.1.gz" if use_gzip else f"{active_path}.1"
        tmp_path = f"{arch_path}.rot_tmp"
        try:
            usage = shutil.disk_usage(parent_dir)
            needed = max(sz // 4, 65536) if use_gzip else sz
            if usage.free < needed:
                raise OSError(errno.ENOSPC, f"Insufficient free space ({usage.free} bytes) to rotate {os.path.basename(active_path)}")

            if use_gzip:
                with open(active_path, "rb") as f_in:
                    with gzip.open(tmp_path, "wb") as f_out:
                        shutil.copyfileobj(f_in, f_out)
            else:
                shutil.copyfile(active_path, tmp_path)

            os.replace(tmp_path, arch_path)
            with open(active_path, "r+b") as f_trunc:
                f_trunc.truncate(0)
            log_info(f"Rotated oversized log {os.path.basename(active_path)} ({sz / (1024*1024):.2f} MB -> {os.path.basename(arch_path)})")
        except Exception as rot_err:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass
            log_error(f"Failed to rotate oversized log {os.path.basename(active_path)}: {rot_err}")
            is_enospc = getattr(rot_err, "errno", None) == errno.ENOSPC or "space" in str(rot_err).lower()
            if is_enospc:
                try:
                    with open(active_path, "r+b") as f_trunc:
                        f_trunc.truncate(0)
                    log_error(f"Emergency truncated {os.path.basename(active_path)} in-place due to low disk/tmpfs space.")
                except Exception as trunc_err:
                    log_error(f"Failed emergency truncate on {os.path.basename(active_path)}: {trunc_err}")

    def _collect_log_dirs_for_pressure_check(self) -> list:
        dirs = set()
        default_logs_dir = os.path.abspath("data/logs")
        if os.path.isdir(default_logs_dir):
            dirs.add(default_logs_dir)
        config_path = os.environ.get("CONFIG_FILE_PATH")
        if config_path and os.path.exists(config_path):
            try:
                import configparser
                cfg = configparser.ConfigParser()
                cfg.read(config_path)
                if "logging" in cfg:
                    fp = cfg["logging"].get("file_path")
                    ap = cfg["logging"].get("access_log_path")
                    for p in (fp, ap):
                        if p:
                            d = os.path.dirname(os.path.abspath(p))
                            if os.path.isdir(d):
                                dirs.add(d)
            except Exception:
                pass
        try:
            with self.db_session_factory() as session:
                from database.models import Storage
                for st in session.query(Storage).filter(Storage.type == "logs").all():
                    if st.path and os.path.isdir(st.path):
                        dirs.add(os.path.abspath(st.path))
        except Exception:
            pass
        return sorted(dirs)

    def _enforce_log_storage_quota(
        self,
        log_dirs: set,
        log_base_names: set,
        log_info,
        log_error,
        high_watermark: float = 0.80,
        target_watermark: float = 0.75,
        emergency_watermark: float = 0.92,
    ):
        """Enforces storage pressure protection across unique mountpoints (e.g. 256MB tmpfs)."""
        dev_groups = {}
        for ldir in log_dirs:
            if not ldir or not os.path.isdir(ldir) or not os.access(ldir, os.W_OK):
                continue
            try:
                st_dev = os.stat(ldir).st_dev
                dev_groups.setdefault(st_dev, []).append(ldir)
            except Exception:
                continue

        for st_dev, dirs_on_dev in dev_groups.items():
            rep_dir = dirs_on_dev[0]
            try:
                usage = shutil.disk_usage(rep_dir)
            except Exception:
                continue
            if usage.total <= 0:
                continue
            used_ratio = usage.used / usage.total
            if used_ratio < high_watermark:
                continue

            log_info(
                f"Log storage pressure detected on {rep_dir}: "
                f"{used_ratio * 100:.1f}% used ({usage.used / (1024*1024):.1f}/{usage.total / (1024*1024):.1f} MB). Pruning oldest archives..."
            )

            # 1. Gather all rotated archives across dirs_on_dev
            archives = []
            active_logs = []
            for ldir in dirs_on_dev:
                try:
                    for entry in os.listdir(ldir):
                        ep = os.path.join(ldir, entry)
                        if os.path.isfile(ep):
                            if re.match(r"^(process|ptp4l|phc2sys)_(\d+)\.log$", entry) or entry in log_base_names:
                                active_logs.append((os.path.getsize(ep), ep))
                            elif (
                                re.match(r"^(process|ptp4l|phc2sys)_(\d+)\.log\..+$", entry)
                                or any(entry.startswith(b + ".") for b in log_base_names)
                                or entry.endswith(".rot_tmp")
                            ):
                                archives.append((os.path.getmtime(ep), os.path.getsize(ep), ep))
                        elif os.path.isdir(ep) and re.match(r"^icecast_(\d+)$", entry):
                            for sub in os.listdir(ep):
                                sp = os.path.join(ep, sub)
                                if not os.path.isfile(sp):
                                    continue
                                if self._is_icecast_archive_name(sub) or sub.endswith(".rot_tmp"):
                                    archives.append((os.path.getmtime(sp), os.path.getsize(sp), sp))
                                elif sub in ("access.log", "error.log"):
                                    active_logs.append((os.path.getsize(sp), sp))
                except Exception:
                    continue

            # Delete oldest archives first (smallest mtime, largest size tie-breaker)
            archives.sort(key=lambda item: (item[0], -item[1]))
            for _mtime, _sz, arch_p in archives:
                try:
                    usage_now = shutil.disk_usage(rep_dir)
                    if usage_now.total > 0 and (usage_now.used / usage_now.total) <= target_watermark:
                        break
                    os.remove(arch_p)
                    log_info(f"Storage-pressure purge deleted archive: {os.path.basename(arch_p)}")
                except Exception as del_err:
                    log_error(f"Failed storage-pressure delete on {arch_p}: {del_err}")

            # 2. Emergency fallback: if disk is STILL critically full (>= emergency_watermark), truncate largest active logs in-place
            try:
                usage_after = shutil.disk_usage(rep_dir)
                if usage_after.total > 0 and (usage_after.used / usage_after.total) >= emergency_watermark:
                    active_logs.sort(key=lambda item: -item[0])
                    for sz, act_p in active_logs:
                        if sz < 512 * 1024:
                            continue
                        usage_chk = shutil.disk_usage(rep_dir)
                        if usage_chk.total > 0 and (usage_chk.used / usage_chk.total) <= 0.85:
                            break
                        try:
                            with open(act_p, "r+b") as f_trunc:
                                f_trunc.truncate(0)
                            log_error(f"Emergency storage-pressure truncate on active log {os.path.basename(act_p)} (was {sz / (1024*1024):.2f} MB).")
                        except Exception as t_err:
                            log_error(f"Failed emergency truncate on {act_p}: {t_err}")
            except Exception:
                pass

    async def start_log_monitor(self):
        if self._log_monitor_task and not self._log_monitor_task.done():
            return
        self._log_monitor_task = asyncio.create_task(self._log_pressure_monitor_loop())

    async def stop_log_monitor(self):
        if self._log_monitor_task and not self._log_monitor_task.done():
            self._log_monitor_task.cancel()
            try:
                await self._log_monitor_task
            except (asyncio.CancelledError, Exception):
                pass
        self._log_monitor_task = None

    async def _log_pressure_monitor_loop(self):
        """Lightweight 15-min loop checking log volume pressure & periodic Icecast/FFmpeg rotation."""
        def _log_info(msg):
            self.logger.info(f"[LogMonitor] {msg}")
        def _log_err(msg):
            self.logger.error(f"[LogMonitor] {msg}")

        while True:
            try:
                await asyncio.sleep(900)
                now_ts = time.time()
                needs_cleanup = (now_ts - self._last_log_cleanup_ts) >= (6 * 3600)
                if not needs_cleanup:
                    for d in self._collect_log_dirs_for_pressure_check():
                        try:
                            u = shutil.disk_usage(d)
                            if u.total > 0 and (u.used / u.total) >= 0.75:
                                needs_cleanup = True
                                break
                        except Exception:
                            continue
                if needs_cleanup:
                    await self._execute_log_rotate(_log_info, _log_err)
            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.debug(f"Log pressure monitor tick error: {e}")

    async def _execute_log_rotate(self, log_info, log_error):
        config_path = os.environ.get("CONFIG_FILE_PATH")
        retention_days = 30
        rotation_max_bytes = 10485760  # 10 MB default
        rotation_backup_count = 5
        rotation_enabled = False
        logging_mode = "both"
        logging_file_path = None
        compression_enabled = True
        access_log_path = None

        if config_path and os.path.exists(config_path):
            try:
                import configparser
                config = configparser.ConfigParser()
                config.read(config_path)
                if "logging" in config:
                    logging_cfg = config["logging"]
                    logging_mode = logging_cfg.get("mode", logging_mode)
                    logging_file_path = logging_cfg.get("file_path", logging_file_path)
                    try:
                        retention_days = logging_cfg.getint("retention_days", 30)
                    except Exception:
                        pass
                    try:
                        rotation_max_bytes = logging_cfg.getint("rotation_max_bytes", 10485760)
                    except Exception:
                        pass
                    try:
                        rotation_backup_count = logging_cfg.getint("rotation_backup_count", 5)
                    except Exception:
                        pass
                    try:
                        rotation_enabled = logging_cfg.getboolean("rotation_enabled", False)
                    except Exception:
                        pass
                    try:
                        compression_enabled = logging_cfg.getboolean("compression_enabled", True)
                    except Exception:
                        pass
                    access_log_path = logging_cfg.get("access_log_path", None)
                if "server" in config and not logging_file_path:
                    logging_file_path = config["server"].get("log_file", None)
            except Exception as cfg_err:
                log_error(f"Error reading config for log rotation: {cfg_err}")

        # Ensure sensible bounds
        if retention_days <= 0:
            retention_days = 30
        if rotation_max_bytes <= 0:
            rotation_max_bytes = 10485760
        if rotation_backup_count <= 0:
            rotation_backup_count = 5

        log_info(
            f"Log retention policy: {retention_days} days, max file size: {rotation_max_bytes / (1024 * 1024):.1f} MB, "
            f"max backups: {rotation_backup_count}, compression: {compression_enabled}."
        )

        # 1. Clean up expired TaskExecution and ProcessLog records from SQLite database
        try:
            with self.db_session_factory() as session:
                from datetime import datetime, timedelta
                from database.models import TaskExecution, ProcessLog
                cutoff = datetime.utcnow() - timedelta(days=retention_days)
                
                expired_execs = session.query(TaskExecution).filter(
                    TaskExecution.started_at.isnot(None),
                    TaskExecution.started_at < cutoff,
                    TaskExecution.status.in_(["finished", "stopped", "error", "interrupted"])
                ).all()
                if expired_execs:
                    for ex in expired_execs:
                        session.delete(ex)
                    session.commit()
                    log_info(f"Purged {len(expired_execs)} TaskExecution database records older than {retention_days} days.")

                expired_logs = session.query(ProcessLog).filter(
                    ProcessLog.timestamp < cutoff
                ).all()
                if expired_logs:
                    for pl in expired_logs:
                        session.delete(pl)
                    session.commit()
                    log_info(f"Purged {len(expired_logs)} ProcessLog database records older than {retention_days} days.")
        except Exception as db_clean_err:
            log_error(f"Failed to prune old task/process log records from DB: {db_clean_err}")

        resolved_log_dirs = set()
        log_base_names = {"access.log", "ffmpeg-gui.log"}

        # 2. Clean up and rotate application server log and HTTP access log files
        use_file = bool(logging_file_path and logging_mode in ("file", "both"))
        if use_file and os.path.exists(os.path.dirname(os.path.abspath(logging_file_path))):
            abs_log_path = os.path.abspath(logging_file_path)
            log_dir = os.path.dirname(abs_log_path)
            log_filename = os.path.basename(abs_log_path)
            resolved_log_dirs.add(log_dir)
            log_base_names.add(log_filename)
            
            now = time.time()
            deleted_count = 0
            preserved_count = 0
            
            # 2a. Purge expired / excess server log archives and compress if enforced
            eff_app_comp = self._is_compression_enforced(log_dir, compression_enabled)
            for name in os.listdir(log_dir):
                if name.endswith(".rot_tmp") and name.startswith(log_filename):
                    try:
                        os.remove(os.path.join(log_dir, name))
                    except Exception:
                        pass
                    continue
                if name.startswith(log_filename + ".") and (name.endswith(".gz") or re.search(r"\.\d+$", name)):
                    file_path = os.path.join(log_dir, name)
                    if not os.path.isfile(file_path):
                        continue
                    mtime = os.path.getmtime(file_path)
                    age_days = (now - mtime) / (24 * 3600)
                    idx = self._extract_numeric_archive_index(name, log_filename)
                    if age_days > retention_days or (idx is not None and idx > rotation_backup_count):
                        try:
                            os.remove(file_path)
                            if age_days > retention_days:
                                log_info(f"Deleted expired rotated log file: {name} (age: {age_days:.1f} days)")
                            else:
                                log_info(f"Pruned excess rotated log file: {name}")
                            deleted_count += 1
                        except Exception as e:
                            log_error(f"Failed to delete {name}: {e}")
                    else:
                        if eff_app_comp and not name.endswith(".gz"):
                            self._compress_file_atomic(file_path, log_info, log_error)
                        log_info(f"Preserved rotated log file: {name} (age: {age_days:.1f} days)")
                        preserved_count += 1

            # Fallback rotation of server log when live RotatingFileHandler is disabled
            if not rotation_enabled and os.path.isfile(abs_log_path):
                self._rotate_active_file(
                    abs_log_path, rotation_max_bytes, rotation_backup_count, compression_enabled, log_info, log_error
                )

            # 2b. Purge and rotate HTTP access log files
            resolved_access_log = access_log_path or os.environ.get("ACCESS_LOG_PATH") or os.path.join(log_dir, "access.log")
            if resolved_access_log:
                access_dir = os.path.dirname(os.path.abspath(resolved_access_log))
                access_base = os.path.basename(resolved_access_log)
                resolved_log_dirs.add(access_dir)
                log_base_names.add(access_base)
                if os.path.exists(access_dir):
                    eff_acc_comp = self._is_compression_enforced(access_dir, compression_enabled)
                    for name in os.listdir(access_dir):
                        if name.endswith(".rot_tmp") and name.startswith(access_base):
                            try:
                                os.remove(os.path.join(access_dir, name))
                            except Exception:
                                pass
                            continue
                        if name.startswith(access_base + ".") and (name.endswith(".gz") or re.search(r"\.\d+$", name)):
                            file_path = os.path.join(access_dir, name)
                            if not os.path.isfile(file_path):
                                continue
                            mtime = os.path.getmtime(file_path)
                            age_days = (now - mtime) / (24 * 3600)
                            idx = self._extract_numeric_archive_index(name, access_base)
                            if age_days > retention_days or (idx is not None and idx > rotation_backup_count):
                                try:
                                    os.remove(file_path)
                                    log_info(f"Deleted expired/excess access log: {name} (age: {age_days:.1f} days)")
                                    deleted_count += 1
                                except Exception as e:
                                    log_error(f"Failed to delete {name}: {e}")
                            elif eff_acc_comp and not name.endswith(".gz"):
                                self._compress_file_atomic(file_path, log_info, log_error)

                if os.path.isfile(resolved_access_log):
                    self._rotate_active_file(
                        resolved_access_log, rotation_max_bytes, rotation_backup_count, compression_enabled, log_info, log_error,
                        shift_backups=False,
                    )

            log_info(f"Cleanup finished. Deleted {deleted_count} files, preserved {preserved_count} files.")

        # 3. Clean up, rotate, compress, and enforce retention on Services logs (FFmpeg, MediaMTX, Icecast, PTP sidecars)
        try:
            now_ts = time.time()
            active_service_ids = set()

            default_logs_dir = os.path.abspath("data/logs")
            if os.path.exists(default_logs_dir):
                resolved_log_dirs.add(default_logs_dir)

            with self.db_session_factory() as session:
                from database.models import Storage, Service
                for st in session.query(Storage).filter(Storage.type == "logs").all():
                    if st.path and os.path.exists(st.path):
                        resolved_log_dirs.add(os.path.abspath(st.path))

                for svc in session.query(Service).all():
                    active_service_ids.add(svc.id)
                    if svc.config and isinstance(svc.config, dict):
                        st_id = svc.config.get("log_storage_id")
                        if st_id:
                            st = session.query(Storage).get(st_id)
                            if st and st.path and os.path.exists(st.path):
                                resolved_log_dirs.add(os.path.abspath(st.path))

            for ldir in resolved_log_dirs:
                if not os.path.exists(ldir) or not os.access(ldir, os.W_OK):
                    continue

                eff_dir_comp = self._is_compression_enforced(ldir, compression_enabled)

                # Clean up any leftover partial .rot_tmp files from crashed rotations
                for entry in list(os.listdir(ldir)):
                    if entry.endswith(".rot_tmp"):
                        try:
                            os.remove(os.path.join(ldir, entry))
                        except Exception:
                            pass

                # --- A. Process & Sidecar Logs: Pass 1 = archives/orphans, Pass 2 = active logs ---
                active_proc_paths = []
                for entry in list(os.listdir(ldir)):
                    entry_path = os.path.join(ldir, entry)
                    m_proc = re.match(r"^(process|ptp4l|phc2sys)_(\d+)\.log(.*)$", entry)
                    if m_proc:
                        kind_prefix = m_proc.group(1)
                        srv_id = int(m_proc.group(2))
                        suffix = m_proc.group(3)

                        if srv_id not in active_service_ids:
                            try:
                                if os.path.isfile(entry_path):
                                    os.remove(entry_path)
                                    log_info(f"Deleted orphaned {kind_prefix} log: {entry}")
                            except Exception as o_err:
                                log_error(f"Failed to delete orphaned log {entry}: {o_err}")
                            continue

                        if suffix:
                            base_proc_name = f"{kind_prefix}_{srv_id}.log"
                            idx = self._extract_numeric_archive_index(entry, base_proc_name)
                            mtime = os.path.getmtime(entry_path)
                            age_days = max(0.0, (now_ts - mtime) / (24 * 3600))
                            if age_days > retention_days or (idx is not None and idx > rotation_backup_count):
                                try:
                                    os.remove(entry_path)
                                    log_info(f"Deleted expired/excess process log archive: {entry} (age: {age_days:.1f} days)")
                                except Exception as d_err:
                                    log_error(f"Failed to delete expired archive {entry}: {d_err}")
                            elif eff_dir_comp and not entry.endswith(".gz"):
                                self._compress_file_atomic(entry_path, log_info, log_error)
                        else:
                            active_proc_paths.append(entry_path)

                for entry_path in active_proc_paths:
                    self._rotate_active_file(
                        entry_path, rotation_max_bytes, rotation_backup_count, compression_enabled, log_info, log_error
                    )

                for entry in list(os.listdir(ldir)):
                    entry_path = os.path.join(ldir, entry)
                    # --- B. Icecast directories: icecast_{id} ---
                    m_ice = re.match(r"^icecast_(\d+)$", entry)
                    if m_ice and os.path.isdir(entry_path):
                        ice_id = int(m_ice.group(1))

                        if ice_id not in active_service_ids:
                            try:
                                shutil.rmtree(entry_path)
                                log_info(f"Deleted orphaned Icecast directory: {entry}")
                            except Exception as o_err:
                                log_error(f"Failed to delete orphaned Icecast directory {entry}: {o_err}")
                            continue

                        try:
                            # Remove leftover temp files first
                            for sub_entry in list(os.listdir(entry_path)):
                                if sub_entry.endswith(".rot_tmp"):
                                    try:
                                        os.remove(os.path.join(entry_path, sub_entry))
                                    except Exception:
                                        pass

                            # Phase 1: Prune 0-byte or expired archives
                            remaining_by_stream = {"access.log": [], "error.log": []}
                            for sub_entry in list(os.listdir(entry_path)):
                                sub_path = os.path.join(entry_path, sub_entry)
                                if not os.path.isfile(sub_path):
                                    continue

                                if self._is_icecast_archive_name(sub_entry):
                                    sz = os.path.getsize(sub_path)
                                    mtime = os.path.getmtime(sub_path)
                                    age_days = max(0.0, (now_ts - mtime) / (24 * 3600))
                                    if sz == 0:
                                        try:
                                            os.remove(sub_path)
                                            log_info(f"Deleted empty Icecast log archive: {entry}/{sub_entry}")
                                        except Exception:
                                            pass
                                        continue
                                    if age_days > retention_days:
                                        try:
                                            os.remove(sub_path)
                                            log_info(f"Deleted expired Icecast log archive: {entry}/{sub_entry} (age: {age_days:.1f} days)")
                                        except Exception as d_err:
                                            log_error(f"Failed to delete expired Icecast log {sub_entry}: {d_err}")
                                        continue

                                    stream_key = "access.log" if sub_entry.startswith("access.log.") else ("error.log" if sub_entry.startswith("error.log.") else "access.log")
                                    remaining_by_stream[stream_key].append((mtime, sub_path))

                            # Phase 2: Enforce rotation_backup_count per stream prefix, then compress remaining
                            for stream_key, items in remaining_by_stream.items():
                                items.sort(key=lambda x: x[0], reverse=True)
                                for keep_item in items[rotation_backup_count:]:
                                    try:
                                        os.remove(keep_item[1])
                                        log_info(f"Pruned excess Icecast archive ({stream_key}): {entry}/{os.path.basename(keep_item[1])}")
                                    except Exception as p_err:
                                        log_error(f"Failed to prune excess Icecast log {keep_item[1]}: {p_err}")
                                for _mtime, arch_p in items[:rotation_backup_count]:
                                    if eff_dir_comp and not arch_p.endswith(".gz") and os.path.exists(arch_p):
                                        self._compress_file_atomic(arch_p, log_info, log_error)

                            # Phase 3: Rotate oversized active Icecast access.log / error.log if needed
                            for active_name in ("access.log", "error.log"):
                                active_sub = os.path.join(entry_path, active_name)
                                if os.path.isfile(active_sub):
                                    self._rotate_active_file(
                                        active_sub, rotation_max_bytes, rotation_backup_count, compression_enabled, log_info, log_error
                                    )
                        except Exception as ice_scan_err:
                            log_error(f"Failed scanning Icecast directory {entry}: {ice_scan_err}")

            # 3b. Global Storage-Pressure Guardrail across unique log filesystems
            self._enforce_log_storage_quota(resolved_log_dirs, log_base_names, log_info, log_error)

        except Exception as svc_log_err:
            log_error(f"Error during service log lifecycle management: {svc_log_err}")

        self._last_log_cleanup_ts = time.time()

        # 4. Clean up temporary files in /dev/shm or /tmp older than 1 day
        for temp_dir in ["/dev/shm", "/tmp"]:
            if os.path.exists(temp_dir) and os.access(temp_dir, os.W_OK):
                try:
                    now_ts = time.time()
                    for fname in os.listdir(temp_dir):
                        fpath = os.path.join(temp_dir, fname)

                        # Clean progress logs older than 1 day
                        if fname.startswith("ffmpeg_progress_") and fname.endswith(".log"):
                            if os.path.isfile(fpath):
                                f_age = (now_ts - os.path.getmtime(fpath)) / (24 * 3600)
                                if f_age > 1:
                                    try:
                                        os.remove(fpath)
                                        log_info(f"Cleaned up orphaned progress log: {fname}")
                                    except Exception:
                                        pass

                        # Clean ephemeral Icecast xml/ssl configs older than 1 day
                        elif fname.startswith("ffmpeg_gui_icecast_") and (fname.endswith(".xml") or fname.endswith(".pem")):
                            if os.path.isfile(fpath):
                                f_age = (now_ts - os.path.getmtime(fpath)) / (24 * 3600)
                                if f_age > 1:
                                    try:
                                        os.remove(fpath)
                                        log_info(f"Cleaned up ephemeral Icecast config: {fname}")
                                    except Exception:
                                        pass

                        # Clean ephemeral Icecast logs directories in /dev/shm
                        elif fname.startswith("ffmpeg_gui_icecast_logs_") and os.path.isdir(fpath):
                            f_age = (now_ts - os.path.getmtime(fpath)) / (24 * 3600)
                            if f_age > 1:
                                try:
                                    shutil.rmtree(fpath)
                                    log_info(f"Cleaned up ephemeral Icecast logs directory: {fname}")
                                except Exception:
                                    pass
                except Exception as t_err:
                    log_error(f"Failed to clean temporary progress files in {temp_dir}: {t_err}")

    async def execute_on_boot_cleanup(self):
        """Run system retention cleanup asynchronously on server boot."""
        self.logger.info("TaskManager: Executing on-boot system retention & log cleanup...")
        def log_info(msg):
            self.logger.info(f"[OnBootCleanup] {msg}")
        def log_error(msg):
            self.logger.error(f"[OnBootCleanup] {msg}")
        try:
            await self._execute_log_rotate(log_info, log_error)
            self.logger.info("TaskManager: On-boot system retention & log cleanup completed.")
        except Exception as e:
            self.logger.error(f"TaskManager: On-boot cleanup encountered an error: {e}")

    async def _execute_ssl_renew(self, log_info, log_error):
        from services.cert_manager import CertificateManager
        cert_mgr = CertificateManager()
        status = cert_mgr.get_cert_status()
        log_info(f"Checking SSL certificate status: {status['status']} (expires in {status['days_remaining']} days).")

        domain = status.get("domain") or "localhost"
        email = f"admin@{domain}"
        success, msg = cert_mgr.renew_acme_certificate(domain, email, log_info=log_info, log_error=log_error)
        if not success:
            raise RuntimeError(f"ACME SSL renewal failed: {msg}")
        log_info(f"SSL renewal routine finished successfully: {msg}")

        # Cascade reload of running SSL services
        if self.process_manager:
            reloaded = await self.process_manager.reload_ssl_services(log_fn=log_info)
            if reloaded:
                log_info(f"Cascade reloaded {len(reloaded)} active SSL-enabled service(s): {', '.join([s['name'] for s in reloaded])}.")
            else:
                log_info("No active SSL-enabled services requiring restart.")
