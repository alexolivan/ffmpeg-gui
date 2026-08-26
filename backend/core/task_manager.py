import asyncio
import psutil
import logging
import os
import shlex
from datetime import datetime
import re
from typing import Optional
from database.models import ScheduledTask, TaskExecution, TaskExecutionLog, FfmpegBuild
from utils.process_utils import cleanup_rogue_processes, prepare_process_file_permissions

class TaskManager:
    def __init__(self, db_session_factory, ffmpeg_path="ffmpeg"):
        self.db_session_factory = db_session_factory
        self.ffmpeg_path = ffmpeg_path
        self.logger = logging.getLogger("TaskManager")
        self.running_processes = {}
        self.last_activity = {}
        self._notified_failed_executions = set()

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
            allow_start = getattr(task, 'allow_auto_start_deps', True)
            session.commit()  # Release write locks immediately before slow spawn!
            
        # Acquire dependency leases
        from core.dependency_manager import dependency_manager
        dependency_manager.acquire_dependencies('task', task_id, allow_auto_start=allow_start)

        # 2. Spawn subprocess (outside database session)
        prepare_process_file_permissions(execution_id=execution_id, logger=self.logger)
        self.logger.info(f"Starting scheduled task FFmpeg cmd: {shlex.join(cmd)}")
        try:
            sub_env = {**os.environ, "FFMPEG_GUI_EXECUTION_ID": str(execution_id)}
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                stdin=asyncio.subprocess.PIPE,
                env=sub_env
            )
            self.running_processes[execution_id] = proc
            self.last_activity[execution_id] = datetime.utcnow()
            
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
                    session.commit()

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

    def _build_ffmpeg_cmd(self, task, ffmpeg_bin, limit_sec=None, execution_id=None):
        from core.builders.ffmpeg_builder import FFmpegCommandBuilder
        return FFmpegCommandBuilder.build_cmd(
            task, ffmpeg_bin, limit_sec=limit_sec, execution_id=execution_id, db_session_factory=self.db_session_factory
        )

    async def stop_execution(self, execution_id: int, status="stopped", error_msg=None):
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
            dependency_manager.release_dependencies('task', task_id, allow_auto_stop=allow_stop)

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
        try:
            with self.db_session_factory() as session:
                match = status_re.search(msg)
                if match:
                    fps, bitrate, speed = match.groups()
                    execution = session.query(TaskExecution).get(execution_id)
                    if execution:
                        execution.fps = fps if fps is not None else "N/A"
                        execution.bitrate = bitrate
                        execution.speed = speed
                        session.commit()
                
                log = TaskExecutionLog(execution_id=execution_id, level=level, message=msg)
                session.add(log)
                session.commit()
        except Exception as e:
            self.logger.error(f"Failed to write log line/stats to DB for execution {execution_id}: {e}")

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
            
            with self.db_session_factory() as session:
                execution = session.query(TaskExecution).get(execution_id)
                if execution and execution.status == 'running':
                    if exit_code == 0:
                        execution.status = 'finished'
                        execution.exit_code = 0
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
            
            if should_retry:
                self.logger.info(f"Task execution {execution_id} failed. Waiting {retry_delay}s before retry attempt...")
                await asyncio.sleep(retry_delay)
                asyncio.create_task(self.start_execution(execution_id))

    async def _run_system_task(self, execution_id: int, command: str):
        self.logger.info(f"Running system task {command} for execution {execution_id}")
        
        logs = []
        status = 'finished'
        error_msg = None
        
        def log_info(msg: str):
            self.logger.info(f"[Execution {execution_id}] {msg}")
            logs.append(("INFO", msg))
            
        def log_error(msg: str):
            self.logger.error(f"[Execution {execution_id}] {msg}")
            logs.append(("ERROR", msg))
            
        try:
            if command == "system://log_rotate":
                await self._execute_log_rotate(log_info, log_error)
            elif command == "system://ssl_renew":
                await self._execute_ssl_renew(log_info, log_error)
            else:
                raise ValueError(f"Unknown system command: {command}")
        except Exception as e:
            self.logger.exception(f"System task {command} failed")
            log_error(f"Error executing system task: {str(e)}")
            status = 'error'
            error_msg = str(e)
            
        # Write logs and update execution status in DB
        try:
            with self.db_session_factory() as session:
                execution = session.query(TaskExecution).get(execution_id)
                if execution:
                    execution.status = status
                    if error_msg:
                        execution.error_message = error_msg
                    execution.stopped_at = datetime.utcnow()
                    
                    for level, msg in logs:
                        log_record = TaskExecutionLog(
                            execution_id=execution_id,
                            level=level,
                            message=msg
                        )
                        session.add(log_record)
                    session.commit()
                    if status == 'error':
                        task_name = execution.task.name if execution.task else command
                        self.notify_task_failure(execution_id, task_name, error_msg)
        except Exception as db_err:
            self.logger.error(f"Failed to save system task execution results: {db_err}")

    async def _execute_log_rotate(self, log_info, log_error):
        import time
        config_path = os.environ.get("CONFIG_FILE_PATH")
        retention_days = 30
        logging_mode = "both"
        logging_file_path = None

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
                if "server" in config and not logging_file_path:
                    logging_file_path = config["server"].get("log_file", None)
            except Exception as cfg_err:
                log_error(f"Error reading config for log rotation: {cfg_err}")

        log_info(f"Retention days: {retention_days}")

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

        # 2. Clean up rotated log files (.gz) if file logging is configured
        use_file = bool(logging_file_path and logging_mode in ("file", "both"))
        if use_file and os.path.exists(os.path.dirname(os.path.abspath(logging_file_path))):
            abs_log_path = os.path.abspath(logging_file_path)
            log_dir = os.path.dirname(abs_log_path)
            log_filename = os.path.basename(abs_log_path)
            
            import time
            now = time.time()
            deleted_count = 0
            preserved_count = 0
            
            for name in os.listdir(log_dir):
                if name.startswith(log_filename) and name.endswith(".gz"):
                    file_path = os.path.join(log_dir, name)
                    if not os.path.isfile(file_path):
                        continue
                    mtime = os.path.getmtime(file_path)
                    age_days = (now - mtime) / (24 * 3600)
                    if age_days > retention_days:
                        try:
                            os.remove(file_path)
                            log_info(f"Deleted expired rotated log file: {name} (age: {age_days:.1f} days)")
                            deleted_count += 1
                        except Exception as e:
                            log_error(f"Failed to delete {name}: {e}")
                    else:
                        log_info(f"Preserved rotated log file: {name} (age: {age_days:.1f} days)")
                        preserved_count += 1
            log_info(f"Cleanup finished. Deleted {deleted_count} files, preserved {preserved_count} files.")

        # Clean up orphaned temporary progress logs in /dev/shm or /tmp older than 1 day
        for temp_dir in ["/dev/shm", "/tmp"]:
            if os.path.exists(temp_dir) and os.access(temp_dir, os.W_OK):
                try:
                    now_ts = time.time()
                    for fname in os.listdir(temp_dir):
                        if fname.startswith("ffmpeg_progress_") and fname.endswith(".log"):
                            fpath = os.path.join(temp_dir, fname)
                            if os.path.isfile(fpath):
                                f_age = (now_ts - os.path.getmtime(fpath)) / (24 * 3600)
                                if f_age > 1:
                                    try:
                                        os.remove(fpath)
                                        log_info(f"Cleaned up orphaned progress log: {fname}")
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
