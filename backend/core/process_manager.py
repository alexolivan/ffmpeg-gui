import asyncio
import subprocess
import psutil
import logging
import os
import shlex
from datetime import datetime
from typing import Dict, Optional
import json
import collections
import random
from utils.process_utils import cleanup_rogue_processes, prepare_process_file_permissions

class ProcessManager:
    def __init__(self, db_session_factory):
        self.processes: Dict[int, asyncio.subprocess.Process] = {}
        self.log_buffers: Dict[int, collections.deque] = {}
        self.restart_counts: Dict[int, int] = {}
        self.pending_restarts: Dict[int, asyncio.Task] = {}
        self.watchdog_tasks: Dict[int, asyncio.Task] = {}
        self.stopping_processes: Set[int] = set()
        self.stopped_pids: Set[int] = set()
        self.srt_has_had_activity: Dict[int, bool] = {}
        self.watchdog_stalled_since: Dict[int, Optional[datetime]] = {}
        self.watchdog_low_speed_since: Dict[int, Optional[datetime]] = {}
        self.db_session_factory = db_session_factory
        self.logger = logging.getLogger("ProcessManager")
        self.ffmpeg_path = self._detect_ffmpeg()
        self._spawn_lock: Optional[asyncio.Lock] = None
        self.ephemeral_configs: Dict[int, str] = {}

    def _get_spawn_lock(self) -> asyncio.Lock:
        if self._spawn_lock is None:
            self._spawn_lock = asyncio.Lock()
        return self._spawn_lock

    def _detect_ffmpeg(self):
        local_bin = os.path.abspath("./ffmpeg_bin/bin/ffmpeg")
        if os.path.exists(local_bin):
            self.logger.info(f"Using local FFMPEG binary: {local_bin}")
            return local_bin
        return "ffmpeg"

    def get_service_ref_count(self, provider_id: int) -> int:
        from core.dependency_manager import dependency_manager
        return len(dependency_manager.get_active_leases(provider_id))

    async def start_dependencies(self, process_id: int, allow_auto_start: bool = True):
        from core.dependency_manager import dependency_manager
        await dependency_manager.acquire_dependencies('service', process_id, allow_auto_start=allow_auto_start)

    async def stop_unused_dependencies(self, process_id: int, allow_auto_stop: bool = True):
        from core.dependency_manager import dependency_manager
        await dependency_manager.release_dependencies('service', process_id, allow_auto_stop=allow_auto_stop)

    async def start_process(self, process_id: int, is_restart: bool = False, is_on_demand: bool = False):
        cleanup_rogue_processes(process_id=process_id)
        
        from core.dependency_manager import dependency_manager
        if not is_restart and not is_on_demand:
            dependency_manager.mark_pinned(process_id)

        # Get service config to check dependency permissions
        allow_start_deps = True
        with self.db_session_factory() as session:
            from database.models import Service
            svc = session.get(Service, process_id)
            if svc:
                allow_start_deps = getattr(svc, 'allow_auto_start_deps', True)

        # Start auto-managed dependencies first
        await self.start_dependencies(process_id, allow_auto_start=allow_start_deps)
        
        logs_dir = None
        debug_mode = False
        
        # 1. Fetch config and prepare snap in a quick database transaction
        with self.db_session_factory() as session:
            from database.models import Service, FfmpegBuild, ServiceLog, Storage
            media_proc = session.query(Service).get(process_id)
            if not media_proc:
                self.logger.error(f"Service {process_id} not found in DB")
                return

            # Clear old logs from DB to prevent mixing previous execution output
            session.query(ServiceLog).filter(ServiceLog.service_id == process_id).delete()

            # Save configuration snapshot at launch
            media_proc.last_started_config = {
                "name": media_proc.name,
                "config": media_proc.config
            }
            if not is_restart:
                self.restart_counts.pop(process_id, None)
                media_proc.restart_count = 0
            self.srt_has_had_activity[process_id] = False
            
            pending = self.pending_restarts.pop(process_id, None)
            if pending and pending != asyncio.current_task():
                pending.cancel()

            cfg = media_proc.config or {}

            # Resolve log_storage
            log_storage_path = None
            log_storage_id = cfg.get("log_storage_id")
            if log_storage_id:
                storage = session.query(Storage).get(log_storage_id)
                if storage:
                    log_storage_path = storage.path
            
            if not log_storage_path:
                default_storage = session.query(Storage).filter(Storage.type == "logs", Storage.is_default == True).first()
                if not default_storage:
                    default_storage = session.query(Storage).filter(Storage.type == "logs").first()
                if default_storage:
                    log_storage_path = default_storage.path
            
            if not log_storage_path:
                log_storage_path = os.path.abspath("data/logs")
            
            logs_dir = log_storage_path
            debug_mode = cfg.get("debug_mode", False)
            svc_type = getattr(media_proc, "service_type", "ffmpeg_stream") or "ffmpeg_stream"

            if svc_type == "mediamtx_hub":
                mediamtx_bin = "mediamtx"
                build_id = cfg.get("ffmpeg_build_id") or cfg.get("build_id")
                if build_id:
                    build = session.query(FfmpegBuild).get(build_id)
                    if build and build.binary_path and os.path.exists(build.binary_path):
                        mediamtx_bin = build.binary_path
                elif shutil.which("mediamtx"):
                    mediamtx_bin = shutil.which("mediamtx")

                cmd, ephem_path = self._build_mediamtx_config_and_cmd(media_proc, mediamtx_bin, session)
                self.ephemeral_configs[process_id] = ephem_path
            else:
                # Determine which FFmpeg binary to use
                ffmpeg_bin = self.ffmpeg_path  # Default fallback
                ffmpeg_build_id = cfg.get("ffmpeg_build_id") or cfg.get("build_id")
                if ffmpeg_build_id:
                    build = session.query(FfmpegBuild).get(ffmpeg_build_id)
                    if build and build.ffmpeg_binary and os.path.exists(build.ffmpeg_binary):
                        ffmpeg_bin = build.ffmpeg_binary
                        self.logger.info(f"Using profile-specific binary: {ffmpeg_bin}")

                # Resolve and validate paths before starting
                import copy
                val_input = copy.deepcopy(cfg.get("input_config", {}))
                val_output = copy.deepcopy(cfg.get("output_config", {}))
                val_filter = copy.deepcopy(cfg.get("filter_config", {}) or {})
                self._resolve_config_paths(val_input, val_output, val_filter)
                try:
                    self._validate_paths(val_input, val_output, val_filter)
                except Exception as val_err:
                    media_proc.status = 'error'
                    session.commit()
                    raise val_err

                cmd = self._build_ffmpeg_cmd(media_proc, ffmpeg_bin)

            proc_name = media_proc.name
            session.commit()  # Save changes and release write lock immediately!
            
        # Ensure log directory exists and prepare file permissions for progress/preview files
        os.makedirs(logs_dir, exist_ok=True)
        log_path = os.path.join(logs_dir, f"process_{process_id}.log")
        prepare_process_file_permissions(process_id=process_id, logger=self.logger)

        # 2. Spawn subprocess (outside of any database session locks)
        self.logger.info(f"Starting service '{proc_name}' ({svc_type}): {shlex.join(cmd)}")
        try:
            self.log_buffers[process_id] = collections.deque(maxlen=100)
            sub_env = {**os.environ, "FFMPEG_GUI_PROCESS_ID": str(process_id)}
            
            try:
                raw_cmd_str = shlex.join(cmd)
                config_path = os.environ.get("CONFIG_FILE_PATH", "/etc/ffmpeg-gui/ffmpeg-gui.conf")
                if not os.path.exists(config_path):
                    config_path = "ffmpeg-gui.conf"
                
                tz_pref = "utc"
                if os.path.exists(config_path):
                    try:
                        import configparser
                        c_parser = configparser.ConfigParser()
                        c_parser.read(config_path)
                        tz_pref = c_parser.get("logging", "timestamp_tz", fallback="utc")
                    except Exception:
                        pass
                
                if tz_pref == "local":
                    now_str = datetime.now().astimezone().isoformat()
                else:
                    from datetime import timezone
                    now_str = datetime.now(timezone.utc).isoformat()
                    if not now_str.endswith("Z") and not "+" in now_str:
                        now_str += "Z"

                if is_restart:
                    with open(log_path, "ab") as f:
                        header = f"\n--- PROCESS RESTART AT {now_str} (Attempt {self.restart_counts.get(process_id, 1)}) ---\nEXACT CLI COMMAND:\n{raw_cmd_str}\n\n".encode("utf-8")
                        f.write(header)
                else:
                    with open(log_path, "wb") as f:
                        header = f"--- PROCESS LAUNCH AT {now_str} ---\nEXACT CLI COMMAND:\n{raw_cmd_str}\n\n".encode("utf-8")
                        f.write(header)
            except Exception as file_err:
                self.logger.error(f"Failed to prepare log file: {file_err}")
                
            spawn_lock = self._get_spawn_lock()
            async with spawn_lock:
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                    stdin=asyncio.subprocess.PIPE,
                    env=sub_env
                )
                self.processes[process_id] = proc
                # Start log reader IMMEDIATELY to capture early startup errors or exit messages
                asyncio.create_task(self._log_reader(process_id, proc, log_path=log_path))
                
                # Short hardware initialization grace gap to allow CUDA / DeckLink / NVENC drivers to bind
                await asyncio.sleep(1.0)
            
            # 3. Update PID and status in a second short database transaction
            with self.db_session_factory() as session:
                from database.models import Service
                media_proc = session.query(Service).get(process_id)
                if media_proc:
                    media_proc.pid = proc.pid
                    media_proc.status = 'running'
                    media_proc.last_start = datetime.utcnow()
                    media_proc.fps = "0"
                    media_proc.bitrate = "0 kb/s"
                    media_proc.speed = "0x"
                    media_proc.cpu_usage = 0
                    media_proc.ram_usage = 0
                    session.commit()
            
            # Start watchdog task
            self.watchdog_tasks[process_id] = asyncio.create_task(self._watchdog(process_id, proc))
            
        except Exception as e:
            self.logger.exception(f"Failed to start process {process_id}")
            with self.db_session_factory() as session:
                from database.models import Service
                media_proc = session.query(Service).get(process_id)
                if media_proc:
                    media_proc.status = 'error'
                    session.commit()

    def notify_service_crash(self, process_id: int, process_name: str, exit_code: int = 1, is_initial_crash: bool = True):
        from core.notification_manager import NotificationManager
        nm = NotificationManager()
        if nm.is_enabled() and nm.config.get("notify_service_failures", True):
            if nm.should_notify_service_failure(proc_id=process_id, proc_name=process_name, is_initial_crash=is_initial_crash, is_recovered=False):
                nm.enqueue_notification({
                    "subject": f"[FFmpeg-GUI Alert] Service Failure: {process_name}",
                    "body": f"Service '{process_name}' (ID: {process_id}) failed/crashed unexpectedly with exit code {exit_code}."
                })

    def notify_service_recovery(self, process_id: int, process_name: str):
        from core.notification_manager import NotificationManager
        nm = NotificationManager()
        if nm.is_enabled() and nm.config.get("notify_service_failures", True):
            if nm.should_notify_service_failure(proc_id=process_id, proc_name=process_name, is_initial_crash=False, is_recovered=True):
                nm.enqueue_notification({
                    "subject": f"[FFmpeg-GUI Alert] Service Recovered: {process_name}",
                    "body": f"Service '{process_name}' (ID: {process_id}) has successfully recovered and is running."
                })

    def notify_service_exhausted(self, process_id: int, process_name: str, retries: int):
        from core.notification_manager import NotificationManager
        nm = NotificationManager()
        if nm.is_enabled() and nm.config.get("notify_service_failures", True):
            nm.enqueue_notification({
                "subject": f"[FFmpeg-GUI Alert] Service Failed (Max Retries Reached): {process_name}",
                "body": f"Service '{process_name}' (ID: {process_id}) failed to start after exhausting all {retries} automatic restart attempts. Service stopped."
            })

    async def stop_process(self, process_id: int, graceful: bool = True, is_restart: bool = False):
        self.stopping_processes.add(process_id)
        try:
            watchdog_task = self.watchdog_tasks.pop(process_id, None)
            if watchdog_task:
                try:
                    watchdog_task.cancel()
                    await watchdog_task
                except (asyncio.CancelledError, Exception):
                    pass

            pending = self.pending_restarts.pop(process_id, None)
            if pending:
                try:
                    pending.cancel()
                    await pending
                except (asyncio.CancelledError, Exception):
                    pass

            proc = self.processes.get(process_id)
            self.restart_counts.pop(process_id, None)
            
            if proc:
                if hasattr(proc, 'pid') and proc.pid:
                    self.stopped_pids.add(proc.pid)
                if graceful:
                    if proc.stdin:
                        try:
                            proc.stdin.write(b'q')
                            await proc.stdin.drain()
                        except Exception:
                            pass
                    
                    try:
                        await asyncio.wait_for(proc.wait(), timeout=1.5)
                    except asyncio.TimeoutError:
                        pass
                
                if proc.returncode is None:
                    try:
                        proc.terminate()
                        await asyncio.wait_for(proc.wait(), timeout=2.0)
                    except asyncio.TimeoutError:
                        self.logger.warning(f"Process {process_id} ignored SIGTERM. Escalating to SIGKILL.")
                    except Exception as e:
                        self.logger.warning(f"Error terminating process {process_id}: {e}")
                
                if proc.returncode is None:
                    try:
                        proc.kill()
                        await asyncio.wait_for(proc.wait(), timeout=2.0)
                    except Exception as e:
                        self.logger.error(f"Failed to kill process {process_id}: {e}")
                
                if process_id in self.processes:
                    del self.processes[process_id]

            # Clean up ephemeral RAM configuration file if present
            ephem = self.ephemeral_configs.pop(process_id, None)
            if ephem and os.path.exists(ephem):
                try:
                    os.remove(ephem)
                except Exception:
                    pass

            cleanup_rogue_processes(process_id=process_id)

            # Unmark pinned state if stopped intentionally
            from core.dependency_manager import dependency_manager
            if not is_restart:
                dependency_manager.unmark_pinned(process_id)

            allow_stop_deps = True
            with self.db_session_factory() as session:
                from database.models import Service
                media_proc = session.query(Service).get(process_id)
                if media_proc:
                    allow_stop_deps = getattr(media_proc, 'allow_auto_stop_deps', True)
                    media_proc.status = 'restarting' if is_restart else 'stopped'
                    media_proc.pid = None
                    media_proc.cpu_usage = 0
                    media_proc.ram_usage = 0
                    media_proc.fps = "0"
                    media_proc.bitrate = "0 kb/s"
                    media_proc.speed = "0x"
                    media_proc.last_stop = datetime.utcnow()
                    media_proc.restart_count = 0
                    session.commit()

            # Stop any auto-managed dependencies that are no longer needed
            await self.stop_unused_dependencies(process_id, allow_auto_stop=allow_stop_deps)
        finally:
            self.stopping_processes.discard(process_id)

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

    def _build_ffmpeg_cmd(self, media_proc, ffmpeg_bin, limit_sec=None, execution_id=None):
        """Build the ffmpeg command line using the dedicated FFmpegCommandBuilder."""
        from core.builders.ffmpeg_builder import FFmpegCommandBuilder
        return FFmpegCommandBuilder.build_cmd(
            media_proc, ffmpeg_bin, limit_sec=limit_sec, execution_id=execution_id, db_session_factory=self.db_session_factory
        )

    def _build_mediamtx_config_and_cmd(self, media_proc, mediamtx_bin: str, session):
        """
        Builds dynamic configuration for MediaMTX in ephemeral RAM (/dev/shm) and returns subprocess command.
        """
        import uuid
        import yaml
        from database.models import Storage

        cfg = media_proc.config or {}
        mtx_cfg = cfg.get("mediamtx_config", {})

        config_dict = {}
        config_dict["logLevel"] = mtx_cfg.get("log_level", "info")
        config_dict["logDestinations"] = ["stdout"]

        # Protocols & Ports
        rtsp_enabled = mtx_cfg.get("rtsp_enabled", True)
        config_dict["rtsp"] = rtsp_enabled
        if rtsp_enabled:
            config_dict["rtspAddress"] = f":{int(mtx_cfg.get('rtsp_port', 8554))}"
            config_dict["rtpAddress"] = f":{int(mtx_cfg.get('rtp_port', 8000))}"
            config_dict["rtcpAddress"] = f":{int(mtx_cfg.get('rtcp_port', 8001))}"

        rtmp_enabled = mtx_cfg.get("rtmp_enabled", True)
        config_dict["rtmp"] = rtmp_enabled
        if rtmp_enabled:
            config_dict["rtmpAddress"] = f":{int(mtx_cfg.get('rtmp_port', 1935))}"

        hls_enabled = mtx_cfg.get("hls_enabled", True)
        if hls_enabled:
            # Resolve HLS storage path - strictly require a storage volume of type 'hls'
            hls_storage_id = mtx_cfg.get("hls_storage_id") or cfg.get("hls_storage_id")
            hls_storage = None
            if hls_storage_id:
                hls_storage = session.query(Storage).get(hls_storage_id)
            if not hls_storage:
                hls_storage = session.query(Storage).filter(Storage.type == "hls").first()

            if not hls_storage:
                hls_enabled = False
                config_dict["hls"] = False
                logger.warning(
                    f"[MediaMTX] HLS disabled for service {media_proc.id} ({media_proc.name}) "
                    "because no dedicated storage volume of type 'hls' exists in the database."
                )
            else:
                config_dict["hls"] = True
                config_dict["hlsAddress"] = f":{int(mtx_cfg.get('hls_port', 8888))}"
                config_dict["hlsSegmentCount"] = int(mtx_cfg.get("hls_segment_count", 5))
                config_dict["hlsSegmentDuration"] = f"{mtx_cfg.get('hls_segment_duration', 2)}s"
                hls_dir = os.path.join(hls_storage.path, f"mediamtx_svc_{media_proc.id}")
                os.makedirs(hls_dir, exist_ok=True)
                config_dict["hlsDirectory"] = hls_dir
        else:
            config_dict["hls"] = False

        webrtc_enabled = mtx_cfg.get("webrtc_enabled", False)
        config_dict["webrtc"] = webrtc_enabled
        if webrtc_enabled:
            config_dict["webrtcAddress"] = f":{int(mtx_cfg.get('webrtc_port', 8889))}"
            webrtc_udp = int(mtx_cfg.get("webrtc_udp_port", 8189))
            config_dict["webrtcLocalUDPAddress"] = f":{webrtc_udp}"

        srt_enabled = mtx_cfg.get("srt_enabled", False)
        config_dict["srt"] = srt_enabled
        if srt_enabled:
            config_dict["srtAddress"] = f":{int(mtx_cfg.get('srt_port', 8890))}"

        # API & Diagnostics
        api_enabled = mtx_cfg.get("api_enabled", True)
        config_dict["api"] = api_enabled
        if api_enabled:
            config_dict["apiAddress"] = f":{int(mtx_cfg.get('api_port', 9997))}"

        # Resolve build version if available to adapt YAML schema safely across releases
        build_ver_major = 1
        build_ver_minor = 19
        build_id = getattr(media_proc, "ffmpeg_build_id", None) or cfg.get("ffmpeg_build_id") or cfg.get("build_id")
        if build_id:
            from database.models import FfmpegBuild
            build = session.query(FfmpegBuild).get(build_id)
            if build and build.version:
                import re
                clean = re.sub(r'^[^\d]*', '', build.version)
                parts = clean.split('.')
                try:
                    build_ver_major = int(parts[0])
                    build_ver_minor = int(parts[1]) if len(parts) > 1 else 0
                except Exception:
                    pass

        # MoQ was introduced in MediaMTX v1.19.0
        if (build_ver_major > 1) or (build_ver_major == 1 and build_ver_minor >= 19):
            config_dict["moq"] = False

        # Playback server was introduced in MediaMTX v1.8.0
        if (build_ver_major > 1) or (build_ver_major == 1 and build_ver_minor >= 8):
            config_dict["playback"] = False

        config_dict["metrics"] = False
        config_dict["pprof"] = False

        # Paths / Stream routing
        paths = mtx_cfg.get("paths", {})
        if not paths:
            paths = {"all_others": {}}
        config_dict["paths"] = paths

        # Custom raw YAML overrides if provided
        raw_yaml = mtx_cfg.get("raw_yaml", "").strip()
        if raw_yaml:
            try:
                parsed_raw = yaml.safe_load(raw_yaml)
                if isinstance(parsed_raw, dict):
                    config_dict.update(parsed_raw)
            except Exception as e:
                self.logger.warning(f"Error parsing raw_yaml for MediaMTX service {media_proc.id}: {e}")

        # Choose RAM filesystem (/dev/shm) with fallback to /tmp
        shm_dir = "/dev/shm" if os.path.exists("/dev/shm") and os.path.isdir("/dev/shm") else "/tmp"
        token = uuid.uuid4().hex[:8]
        ephem_file = os.path.join(shm_dir, f"ffmpeg_gui_mediamtx_{media_proc.id}_{token}.yml")

        yaml_content = yaml.dump(config_dict, default_flow_style=False)
        with open(ephem_file, "w", encoding="utf-8") as f:
            f.write(yaml_content)

        try:
            os.chmod(ephem_file, 0o600)
        except Exception:
            pass

        return [mediamtx_bin, ephem_file], ephem_file

    async def _log_reader(self, process_id: int, proc: asyncio.subprocess.Process, log_path: Optional[str] = None):
        import re
        # Regex for ffmpeg status line (supports bitrate=N/A for DeckLink/NDI outputs, and optional fps for audio-only outputs)
        status_re = re.compile(r"(?:fps=\s*([\d.]+).*?)?bitrate=\s*([\d.]+kbits/s|N/A).*speed=\s*([\d.]+x)")
        buffer = bytearray()
        
        log_file = None
        if log_path:
            try:
                log_file = open(log_path, "ab", buffering=0)
            except Exception as e:
                self.logger.error(f"Failed to open log file {log_path} for writing: {e}")
                
        try:
            while True:
                if proc is None or proc.stdout is None:
                    break
                chunk = await proc.stdout.read(4096)
                if not chunk:
                    if buffer:
                        msg = buffer.decode('utf-8', errors='replace').strip()
                        if msg:
                            self._handle_log_msg(process_id, msg, status_re)
                    break
                
                if log_file:
                    try:
                        log_file.write(chunk)
                    except Exception as e:
                        self.logger.error(f"Error writing log chunk for process {process_id}: {e}")
                
                for b in chunk:
                    char = bytes([b])
                    if char in (b'\r', b'\n'):
                        if buffer:
                            msg = buffer.decode('utf-8', errors='replace').strip()
                            buffer.clear()
                            if msg:
                                self._handle_log_msg(process_id, msg, status_re)
                    else:
                        buffer.extend(char)
                        if len(buffer) > 65536:
                            msg = buffer.decode('utf-8', errors='replace').strip()
                            buffer.clear()
                            if msg:
                                self._handle_log_msg(process_id, msg, status_re)
        finally:
            if log_file:
                try:
                    log_file.close()
                except Exception:
                    pass

    def _handle_log_msg(self, process_id: int, msg: str, status_re):
        lower_msg = msg.lower()
        if any(kw in lower_msg for kw in ["error", "failed", "invalid", "could not", "cannot"]):
            level = "ERROR"
        else:
            level = "INFO"
        
        # Append to in-memory deque
        if process_id in self.log_buffers:
            self.log_buffers[process_id].append({
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "level": level,
                "message": msg
            })
        
        # Update real-time stats if it's a status line
        match = status_re.search(msg)
        if match:
            fps, bitrate, speed = match.groups()
            with self.db_session_factory() as session:
                from database.models import Service
                media_proc = session.query(Service).get(process_id)
                if media_proc:
                    media_proc.fps = fps if fps is not None else "N/A"
                    media_proc.bitrate = bitrate
                    media_proc.speed = speed
                    session.commit()
        
        self.logger.debug(f"[{process_id}] {msg}")

    async def _probe_url(self, url: str, ffprobe_bin: str) -> bool:
        cmd = [ffprobe_bin, "-t", "2", "-v", "quiet", url]
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            await asyncio.wait_for(proc.wait(), timeout=4.0)
            return proc.returncode == 0
        except Exception:
            return False

    def get_watchdog_max_backoff(self) -> int:
        config_path = os.environ.get("CONFIG_FILE_PATH", "ffmpeg-gui.conf")
        if os.path.exists(config_path):
            try:
                import configparser
                cfg = configparser.ConfigParser()
                cfg.read(config_path)
                if "watchdog" in cfg:
                    return cfg.getint("watchdog", "watchdog_max_backoff", fallback=30)
            except Exception:
                pass
        return 30

    def get_network_wait_timeout(self) -> int:
        config_path = os.environ.get("CONFIG_FILE_PATH", "ffmpeg-gui.conf")
        if os.path.exists(config_path):
            try:
                import configparser
                cfg = configparser.ConfigParser()
                cfg.read(config_path)
                if "watchdog" in cfg:
                    return cfg.getint("watchdog", "network_wait_timeout", fallback=60)
            except Exception:
                pass
        return 60

    async def _async_check_network_readiness(self, input_config: dict, timeout: float = 60.0) -> bool:
        """
        Asynchronously check if a network-dependent input (RTMP, SRT, RTSP, HTTP, UDP) has network connectivity
        and DNS resolution ready. Returns True if ready or non-network input.
        """
        if not input_config:
            return True

        url = str(input_config.get("url") or input_config.get("path") or "")
        if not url:
            return True

        url_lower = url.lower()
        is_network = any(url_lower.startswith(p) for p in ["rtmp://", "rtmps://", "srt://", "rtsp://", "http://", "https://", "udp://"])
        if not is_network:
            return True

        import re
        match = re.search(r'://([^/:\?]+)', url)
        if not match:
            return True

        host = match.group(1)
        if host in ["0.0.0.0", "127.0.0.1", "localhost"]:
            return True

        loop = asyncio.get_event_loop()
        start_time = loop.time()
        check_interval = 5.0

        while loop.time() - start_time < timeout:
            try:
                await loop.getaddrinfo(host, None)
                return True
            except Exception:
                await asyncio.sleep(check_interval)

        return False

    async def _delayed_restart(self, process_id: int, delay: float = 5.0):
        try:
            await asyncio.sleep(delay)
            if process_id in self.processes:
                return

            with self.db_session_factory() as session:
                from database.models import Service, ServiceLog
                media_proc = session.query(Service).get(process_id)
                if not media_proc or media_proc.status == 'stopped':
                    self.logger.info(f"Watchdog: Service {process_id} status is stopped or deleted. Aborting restart.")
                    return

                # Pre-flight network readiness check
                net_timeout = self.get_network_wait_timeout()
                cfg = media_proc.config or {}
                is_net_ready = await self._async_check_network_readiness(cfg.get('input_config', {}), timeout=net_timeout)
                if not is_net_ready:
                    self.logger.warning(f"Watchdog: Network/DNS not ready for service {process_id} after {net_timeout}s timeout. Aborting restart attempt.")
                    return

                self.logger.info(f"Watchdog triggering restart for service {process_id}")
                log = ServiceLog(
                    service_id=process_id,
                    level='INFO',
                    message="Watchdog: Triggering automatic restart."
                )
                session.add(log)
                session.commit()

            await self.start_process(process_id, is_restart=True)
        except asyncio.CancelledError:
            self.logger.info(f"Watchdog: Cancelled pending restart for process {process_id}")
            raise
        finally:
            if self.pending_restarts.get(process_id) == asyncio.current_task():
                self.pending_restarts.pop(process_id, None)

    async def _watchdog(self, process_id: int, proc: Optional[asyncio.subprocess.Process] = None, pid: Optional[int] = None):
        pid = pid or (proc.pid if proc else None)
        if not pid:
            self.logger.error(f"Watchdog: No PID found for process {process_id}")
            return

        # Access progress log file (Xs suffix = service)
        shm_path = f"/dev/shm/ffmpeg_progress_{process_id}s.log"
        tmp_path = f"/tmp/ffmpeg_progress_{process_id}s.log"
        if os.path.exists("/dev/shm") and os.access("/dev/shm", os.W_OK):
            progress_log_path = shm_path
        else:
            progress_log_path = tmp_path

        was_unexpected = False
        is_cancelled = False
        self.watchdog_stalled_since[process_id] = None
        self.watchdog_low_speed_since[process_id] = None

        try:
            p = psutil.Process(pid)
            p.cpu_percent(interval=None)
        except Exception:
            p = None

        prev_frame = None
        prev_out_time_us = None
        has_had_activity = False
        start_time = datetime.utcnow()
        recovery_notified = False

        try:
            while True:
                # Check if running
                if proc is not None:
                    running = (proc.returncode is None)
                else:
                    running = psutil.pid_exists(pid)

                if not running:
                    break

                # Get system metrics
                cpu = 0
                mem = 0
                if p:
                    try:
                        cpu_raw = p.cpu_percent(interval=None)
                        num_cores = psutil.cpu_count() or 1
                        cpu = cpu_raw / num_cores
                        mem = p.memory_info().rss / (1024 * 1024)  # MB
                    except Exception as e:
                        self.logger.warning(f"Watchdog failed to get psutil metrics for PID {pid}: {e}")

                # Read progress log file
                frame = None
                fps = None
                bitrate = None
                speed = None
                out_time_us = None

                if os.path.exists(progress_log_path):
                    try:
                        with open(progress_log_path, "r") as f:
                            lines = f.readlines()
                        for line in lines:
                            if "=" in line:
                                k, v = line.split("=", 1)
                                k = k.strip()
                                v = v.strip()
                                if k == "frame":
                                    try:
                                        frame = int(v)
                                    except ValueError:
                                        pass
                                elif k == "fps":
                                    fps = v
                                elif k == "bitrate":
                                    bitrate = v
                                elif k == "speed":
                                    speed = v
                                elif k == "out_time_us":
                                    try:
                                        out_time_us = int(v)
                                    except ValueError:
                                        pass
                    except Exception as read_err:
                        self.logger.error(f"Watchdog failed to read progress file {progress_log_path}: {read_err}")

                # Update database
                try:
                    with self.db_session_factory() as session:
                        from database.models import Service
                        media_proc = session.query(Service).get(process_id)
                        if media_proc:
                            media_proc.fps = fps if fps is not None else "0"
                            media_proc.bitrate = bitrate if bitrate is not None else "0 kb/s"
                            media_proc.speed = speed if speed is not None else "0x"
                            media_proc.cpu_usage = int(cpu)
                            media_proc.ram_usage = int(mem)
                            session.commit()

                            if not recovery_notified:
                                elapsed = (datetime.utcnow() - start_time).total_seconds()
                                if elapsed > 60:
                                    recovery_notified = True
                                    self.notify_service_recovery(process_id, media_proc.name)

                            # Check for initial activity (e.g. frame > 0 or out_time_us > 0 at least once)
                            if (frame is not None and frame > 0) or (out_time_us is not None and out_time_us > 0):
                                has_had_activity = True

                            is_ffmpeg_service = (getattr(media_proc, 'service_type', 'ffmpeg_stream') == 'ffmpeg_stream')

                            # FFmpeg-specific Deep Transcode Watchdog Checks
                            if is_ffmpeg_service:
                                # Check speed degradation
                                speed_val = None
                                if speed and speed != "N/A":
                                    try:
                                        speed_val = float(speed.replace("x", "").strip())
                                    except ValueError:
                                        pass

                                cfg = media_proc.config or {}
                                watchdog_enabled = cfg.get('watchdog_enabled', False)
                                watchdog_min_speed = cfg.get('watchdog_min_speed')
                                if watchdog_enabled and watchdog_min_speed is not None:
                                    elapsed = (datetime.utcnow() - start_time).total_seconds()
                                    if elapsed > 30:
                                        if speed_val is not None and speed_val < watchdog_min_speed:
                                            if self.watchdog_low_speed_since.get(process_id) is None:
                                                self.watchdog_low_speed_since[process_id] = datetime.utcnow()
                                            else:
                                                watchdog_min_speed_duration = cfg.get('watchdog_min_speed_duration', 30)
                                                duration = watchdog_min_speed_duration if watchdog_min_speed_duration is not None else 30
                                                low_speed_duration = (datetime.utcnow() - self.watchdog_low_speed_since[process_id]).total_seconds()
                                                if low_speed_duration > duration:
                                                    log_msg = f"Watchdog: Stream speed ({speed_val}x) fell below minimum threshold ({watchdog_min_speed}x) for more than {duration}s. Force killing..."
                                                    self.logger.error(log_msg)
                                                    
                                                    from database.models import ProcessLog
                                                    log = ProcessLog(
                                                        process_id=process_id,
                                                        level='ERROR',
                                                        message=log_msg
                                                    )
                                                    session.add(log)
                                                    session.commit()

                                                    if proc is not None:
                                                        try:
                                                            proc.kill()
                                                        except Exception as kerr:
                                                            self.logger.error(f"Failed to kill process via proc.kill(): {kerr}")
                                                    else:
                                                        import signal
                                                        try:
                                                            os.kill(pid, signal.SIGKILL)
                                                        except Exception as kerr:
                                                            self.logger.error(f"Failed to kill PID {pid} via os.kill: {kerr}")
                                        else:
                                            self.watchdog_low_speed_since[process_id] = None

                                # Check startup stall (process running for > network_wait_timeout with zero activity/frames)
                                elapsed_since_start = (datetime.utcnow() - start_time).total_seconds()
                                net_timeout_cfg = self.get_network_wait_timeout()
                                
                                # Do not force kill listeners awaiting connections on startup (Rule XIII)
                                cfg_str = str(media_proc.config or {}).lower()
                                is_listener = ("mode=listener" in cfg_str) or \
                                              (isinstance(media_proc.input_config, dict) and media_proc.input_config.get('mode') == 'listener') or \
                                              (isinstance(media_proc.output_config, dict) and media_proc.output_config.get('mode') == 'listener')
                                              
                                if media_proc.type == 'service' and media_proc.watchdog_enabled and not has_had_activity and not is_listener:
                                    if elapsed_since_start > net_timeout_cfg:
                                        log_msg = f"Watchdog: Service failed to produce any frames/progress after {int(elapsed_since_start)}s (hung at startup/network connection). Force killing..."
                                        self.logger.error(log_msg)
                                        from database.models import ProcessLog
                                        log = ProcessLog(
                                            process_id=process_id,
                                            level='ERROR',
                                            message=log_msg
                                        )
                                        session.add(log)
                                        session.commit()

                                        if proc is not None:
                                            try:
                                                proc.kill()
                                            except Exception as kerr:
                                                self.logger.error(f"Failed to kill process via proc.kill(): {kerr}")
                                        else:
                                            import signal
                                            try:
                                                os.kill(pid, signal.SIGKILL)
                                            except Exception as kerr:
                                                self.logger.error(f"Failed to kill process PID {pid} via os.kill: {kerr}")

                                # Compare with previous iteration when activity is present
                                if has_had_activity:
                                    if prev_out_time_us is None:
                                        prev_frame = frame
                                        prev_out_time_us = out_time_us
                                        self.watchdog_stalled_since[process_id] = None
                                    else:
                                        if frame == prev_frame and out_time_us == prev_out_time_us:
                                            if self.watchdog_stalled_since.get(process_id) is None:
                                                self.watchdog_stalled_since[process_id] = datetime.utcnow()
                                            elif (datetime.utcnow() - self.watchdog_stalled_since[process_id]).total_seconds() > 15:
                                                if media_proc.type == 'service' and media_proc.watchdog_enabled:
                                                    log_msg = "Watchdog: Stream pipeline has frozen (frame/time count stalled for 15s). Force killing..."
                                                    self.logger.error(log_msg)
                                                    
                                                    from database.models import ProcessLog
                                                    log = ProcessLog(
                                                        process_id=process_id,
                                                        level='ERROR',
                                                        message=log_msg
                                                    )
                                                    session.add(log)
                                                    session.commit()

                                                    # Kill the process
                                                    if proc is not None:
                                                        try:
                                                            proc.kill()
                                                        except Exception as kerr:
                                                            self.logger.error(f"Failed to kill process via proc.kill(): {kerr}")
                                                    else:
                                                        import signal
                                                        try:
                                                            os.kill(pid, signal.SIGKILL)
                                                        except Exception as kerr:
                                                            self.logger.error(f"Failed to kill process PID {pid} via os.kill: {kerr}")

                                                    self.watchdog_stalled_since[process_id] = None
                                        else:
                                            # They have changed
                                            self.watchdog_stalled_since[process_id] = None
                                            prev_frame = frame
                                            prev_out_time_us = out_time_us
                except Exception as db_err:
                    self.logger.error(f"Watchdog database error for process {process_id}: {db_err}")

                await asyncio.sleep(2)
        except asyncio.CancelledError:
            is_cancelled = True
            self.logger.info(f"Watchdog for process {process_id} (PID {pid}) cancelled.")
        except psutil.NoSuchProcess:
            self.logger.warning(f"Watchdog: Process PID {pid} disappeared.")
        except Exception as loop_err:
            self.logger.error(f"Watchdog loop encountered error for process {process_id}: {loop_err}")
        finally:
            if self.watchdog_tasks.get(process_id) == asyncio.current_task():
                self.watchdog_tasks.pop(process_id, None)

            if is_cancelled:
                return

            if proc is not None:
                await proc.wait()
                exit_code = proc.returncode
            else:
                exit_code = 0

            # If process was stopped/restarted intentionally or replaced by a new process instance,
            # exit cleanly without overwriting DB state or triggering false watchdog recovery.
            is_intentional_stop = pid in self.stopped_pids or process_id in self.stopping_processes or self.processes.get(process_id) is not proc
            self.stopped_pids.discard(pid)

            if is_intentional_stop:
                self.logger.info(f"Watchdog for process {process_id} (PID {pid}) exiting cleanly without DB update (replaced or stopped).")
                return

            was_unexpected = True

            try:
                with self.db_session_factory() as session:
                    from database.models import Service, ServiceLog
                    media_proc = session.query(Service).get(process_id)
                    if media_proc:
                        # Clean up stats
                        media_proc.cpu_usage = 0
                        media_proc.ram_usage = 0
                        media_proc.fps = "0"
                        media_proc.bitrate = "0 kb/s"
                        media_proc.speed = "0x"

                        cfg = media_proc.config or {}
                        watchdog_enabled = cfg.get('watchdog_enabled', False)
                        watchdog_retries = cfg.get('watchdog_retries', 5)

                        will_restart = False
                        if was_unexpected and watchdog_enabled:
                            retries = watchdog_retries
                            current_restarts = self.restart_counts.get(process_id, 0)
                            if retries == -1 or current_restarts < retries:
                                will_restart = True

                        if will_restart:
                            media_proc.status = 'error'
                        else:
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
                                ts_str = entry["timestamp"].rstrip("Z")
                                ts = datetime.fromisoformat(ts_str)
                                db_logs.append(ServiceLog(
                                    service_id=process_id,
                                    timestamp=ts,
                                    level=entry["level"],
                                    message=entry["message"]
                                ))
                            if db_logs:
                                session.add_all(db_logs)

                        # Log the exit summary
                        log = ServiceLog(
                            service_id=process_id,
                            level='INFO' if exit_code == 0 else 'ERROR',
                            message=f"Process exited with code {exit_code}"
                        )
                        session.add(log)
                        session.commit()

                        # Handle notification hook for unexpected exit
                        if was_unexpected:
                            current_restarts = self.restart_counts.get(process_id, 0)
                            if not watchdog_enabled or watchdog_retries == 0:
                                # No watchdog: notify single crash immediately
                                self.notify_service_crash(process_id, media_proc.name, exit_code=exit_code, is_initial_crash=True)
                            elif watchdog_retries == -1:
                                # Infinite retries: notify on initial crash (attempt 0), silence intermediate retries
                                is_initial = (current_restarts == 0)
                                self.notify_service_crash(process_id, media_proc.name, exit_code=exit_code, is_initial_crash=is_initial)
                            else:
                                # Finite retries (N > 0): mute intermediate retries.
                                # Notification is sent ONLY when max retries is reached below.
                                pass

                        # Handle automatic restart if enabled and unexpected
                        if was_unexpected and watchdog_enabled:
                            retries = watchdog_retries
                            current_restarts = self.restart_counts.get(process_id, 0)
                            if retries == -1 or current_restarts < retries:
                                self.restart_counts[process_id] = current_restarts + 1
                                media_proc.restart_count = self.restart_counts[process_id]

                                base_delay = 5
                                max_cap = self.get_watchdog_max_backoff()
                                # Add random jitter (0.5s - 2.5s) to break lockstep concurrent retries
                                jitter = round(random.uniform(0.5, 2.5), 1)
                                backoff_delay = min(max_cap, base_delay * (2 ** max(0, self.restart_counts[process_id] - 1))) + jitter

                                self.logger.info(f"Watchdog: unexpectedly exited. Scheduling restart attempt {self.restart_counts[process_id]}/{retries if retries != -1 else 'inf'} in {backoff_delay}s...")
                                restart_log = ServiceLog(
                                    service_id=process_id,
                                    level='WARNING',
                                    message=f"Watchdog: Unexpected exit detected. Restarting (attempt {self.restart_counts[process_id]}/{retries if retries != -1 else 'inf'}) in {backoff_delay} seconds..."
                                )
                                session.add(restart_log)
                                session.commit()
                                old_task = self.pending_restarts.pop(process_id, None)
                                if old_task:
                                    try:
                                        old_task.cancel()
                                    except Exception:
                                        pass
                                task = asyncio.create_task(self._delayed_restart(process_id, delay=backoff_delay))
                                self.pending_restarts[process_id] = task
                            else:
                                self.logger.warning(f"Watchdog: Max restart attempts ({retries}) reached for service {process_id}. Giving up.")
                                limit_log = ServiceLog(
                                    service_id=process_id,
                                    level='ERROR',
                                    message=f"Watchdog: Max restart attempts ({retries}) reached. Service stopped."
                                )
                                session.add(limit_log)
                                media_proc.status = 'stopped'
                                media_proc.restart_count = 0
                                media_proc.pid = None
                                media_proc.cpu_usage = 0
                                media_proc.ram_usage = 0
                                media_proc.fps = "0"
                                media_proc.bitrate = "0 kb/s"
                                media_proc.speed = "0x"
                                self.restart_counts.pop(process_id, None)
                                session.commit()
                                # Notify finite retry exhaustion (1 single email when max retries reached!)
                                self.notify_service_exhausted(process_id, media_proc.name, retries=retries)
            except Exception as db_err:
                self.logger.error(f"Watchdog cleanup database error for service {process_id}: {db_err}")

            # Clean up memory buffer and tracking flags
            self.srt_has_had_activity.pop(process_id, None)
            self.watchdog_stalled_since.pop(process_id, None)
            self.watchdog_low_speed_since.pop(process_id, None)
            if process_id in self.log_buffers:
                del self.log_buffers[process_id]

            if process_id in self.processes:
                del self.processes[process_id]

    def reattach_process(self, process_id: int, pid: int):
        with self.db_session_factory() as session:
            from database.models import Service
            media_proc = session.query(Service).get(process_id)
            if not media_proc:
                self.logger.error(f"Cannot reattach service {process_id}: not found in DB")
                return

        self.processes[process_id] = None
        self.watchdog_tasks[process_id] = asyncio.create_task(self._watchdog(process_id, pid=pid))

