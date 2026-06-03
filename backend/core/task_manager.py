import asyncio
import psutil
import logging
import os
import shlex
from datetime import datetime
import re
from database.models import ScheduledTask, TaskExecution, TaskExecutionLog, FfmpegBuild

class TaskManager:
    def __init__(self, db_session_factory, ffmpeg_path="ffmpeg"):
        self.db_session_factory = db_session_factory
        self.ffmpeg_path = ffmpeg_path
        self.logger = logging.getLogger("TaskManager")
        self.running_processes = {}

    def _detect_ffmpeg(self):
        local_bin = os.path.abspath("./ffmpeg_bin/bin/ffmpeg")
        if os.path.exists(local_bin):
            return local_bin
        return self.ffmpeg_path

    async def start_execution(self, execution_id: int):
        with self.db_session_factory() as session:
            execution = session.query(TaskExecution).get(execution_id)
            if not execution:
                return
            task = execution.task

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
            session.commit()

            # Command building
            ffmpeg_bin = self._detect_ffmpeg()
            if task.ffmpeg_build_id:
                build = session.query(FfmpegBuild).get(task.ffmpeg_build_id)
                if build and build.ffmpeg_binary and os.path.exists(build.ffmpeg_binary):
                    ffmpeg_bin = build.ffmpeg_binary

            cmd = self._build_ffmpeg_cmd(task, ffmpeg_bin, limit_sec)
            self.logger.info(f"Starting scheduled task FFmpeg cmd: {shlex.join(cmd)}")
            
            try:
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    stdin=asyncio.subprocess.PIPE
                )
                self.running_processes[execution_id] = proc
                execution.pid = proc.pid
                session.commit()
                
                asyncio.create_task(self._log_reader(execution_id, proc))
                asyncio.create_task(self._watchdog(execution_id, proc, limit_sec))
            except Exception as e:
                self.logger.exception(f"Failed to start task execution {execution_id}")
                execution.status = 'error'
                execution.error_message = str(e)
                execution.stopped_at = datetime.utcnow()
                session.commit()

    def _build_ffmpeg_cmd(self, task, ffmpeg_bin, limit_sec):
        cmd = [ffmpeg_bin, "-hide_banner", "-y"]
        
        input_cfg = task.input_config
        codec_cfg = task.codec_config
        filter_cfg = task.filter_config or {}
        advanced = filter_cfg.get('advanced', {})

        is_new_format = 'input1' in input_cfg
        primary_input_type = (
            input_cfg['input1'].get('type', '') if is_new_format
            else input_cfg.get('type', '')
        )

        # Threads
        threads = advanced.get('threads', 0)
        if threads and int(threads) > 0:
            cmd += ["-threads", str(int(threads))]

        # HW Accel
        hwaccel = advanced.get('hwaccel', 'none')
        if hwaccel and hwaccel != 'none':
            cmd += ["-hwaccel", hwaccel]
            hwaccel_out = advanced.get('hwaccel_output_format', hwaccel)
            cmd += ["-hwaccel_output_format", hwaccel_out]

        # Probe size
        probesize = advanced.get('probesize', '')
        if probesize:
            cmd += ["-probesize", str(probesize)]

        # Thread queue size
        tqs = advanced.get('thread_queue_size', 0)
        if tqs and int(tqs) > 0:
            cmd += ["-thread_queue_size", str(int(tqs))]

        # Inputs
        if is_new_format:
            has_video = input_cfg.get('has_video', True)
            has_audio = input_cfg.get('has_audio', True)
            use_secondary = input_cfg.get('use_secondary_input', False)
            
            self._append_input(cmd, input_cfg['input1'])
            if use_secondary and 'input2' in input_cfg:
                self._append_input(cmd, input_cfg['input2'])
        else:
            has_video = True
            has_audio = True
            use_secondary = False
            self._append_input(cmd, input_cfg)

        # Video processing
        if not has_video:
            cmd += ["-vn"]
        else:
            vf = []
            if filter_cfg.get('scale'):
                vf.append(f"scale={filter_cfg['scale']}")
            if filter_cfg.get('deinterlace'):
                vf.append("yadif")
            if filter_cfg.get('framerate'):
                vf.append(f"fps={filter_cfg['framerate']}")
            if vf:
                cmd += ["-vf", ",".join(vf)]

            vcodec = codec_cfg.get('vcodec', 'libx264')
            cmd += ["-c:v", vcodec]
            
            video_params = codec_cfg.get('video_params', {})
            if video_params:
                self._append_video_codec_params(cmd, vcodec, video_params)
            else:
                if vcodec == 'libx264':
                    cmd += ["-preset", "veryfast", "-tune", "zerolatency"]
                if codec_cfg.get('bitrate'):
                    cmd += ["-b:v", codec_cfg['bitrate']]

        # Audio processing
        if not has_audio:
            cmd += ["-an"]
        else:
            acodec = codec_cfg.get('acodec', 'aac')
            cmd += ["-c:a", acodec]
            audio_params = codec_cfg.get('audio_params', {})
            if audio_params:
                self._append_audio_codec_params(cmd, acodec, audio_params)

        # Stream mapping
        if is_new_format and use_secondary:
            if has_video:
                cmd += ["-map", "0:v"]
            if has_audio:
                cmd += ["-map", "1:a"]

        # Native duration limit (placed before output)
        if limit_sec:
            cmd += ["-t", str(limit_sec)]

        # Output
        self._append_output(cmd, task.output_config, codec_cfg)
        return cmd

    def _append_input(self, cmd: list, input_cfg: dict):
        input_type = input_cfg.get('type')
        if input_type == 'file':
            cmd += ["-i", input_cfg.get('path', '')]
        elif input_type == 'lavfi':
            cmd += ["-f", "lavfi", "-i", input_cfg.get('path', 'testsrc')]
        elif input_type == 'lavfi_video':
            pattern = input_cfg.get('pattern', 'testsrc')
            size = input_cfg.get('size')
            rate = input_cfg.get('rate')
            lavfi_str = pattern
            params = []
            if size: params.append(f"size={size}")
            if rate: params.append(f"rate={rate}")
            if params:
                if '=' in pattern:
                    lavfi_str = f"{pattern}:{':'.join(params)}"
                else:
                    lavfi_str = f"{pattern}={':'.join(params)}"
            cmd += ["-f", "lavfi", "-i", lavfi_str]
        elif input_type == 'lavfi_audio':
            pattern = input_cfg.get('pattern', 'sine')
            frequency = input_cfg.get('frequency')
            lavfi_str = pattern
            if pattern == 'sine' and frequency:
                lavfi_str = f"sine=frequency={frequency}"
            cmd += ["-f", "lavfi", "-i", lavfi_str]
        elif input_type == 'srt':
            mode = input_cfg.get('mode', 'listener')
            latency = input_cfg.get('latency', 200)
            host = input_cfg.get('host', '')
            port = input_cfg.get('port', '9000')
            cmd += ["-i", f"srt://{host}:{port}?mode={mode}&latency={latency}"]
        elif input_type == 'udp':
            host = input_cfg.get('host', '')
            port = input_cfg.get('port', '1234')
            cmd += ["-i", f"udp://{host}:{port}?fifo_size=1000000"]
        elif input_type == 'rtp':
            host = input_cfg.get('host', '')
            port = input_cfg.get('port', '5004')
            cmd += ["-i", f"rtp://{host}:{port}"]
        elif input_type == 'ndi':
            name = input_cfg.get('name', '')
            cmd += ["-f", "libndi_newtek", "-find_sources", "1", "-i", name]
        elif input_type == 'decklink':
            cmd += ["-f", "decklink", "-i", input_cfg.get('device', '')]

    def _append_video_codec_params(self, cmd: list, vcodec: str, params: dict):
        rc_mode = params.get('rc_mode', '')
        if vcodec in ('libx264', 'libx265'):
            if rc_mode == 'crf':
                cmd += ["-crf", str(params.get('crf', 23))]
            elif rc_mode in ('cbr', 'vbr'):
                cmd += ["-b:v", params.get('bitrate', '4000k')]
                if params.get('maxrate'): cmd += ["-maxrate", params['maxrate']]
                if params.get('bufsize'): cmd += ["-bufsize", params['bufsize']]
            if params.get('preset'): cmd += ["-preset", params['preset']]
            tune = params.get('tune', 'none')
            if tune and tune != 'none': cmd += ["-tune", tune]
            if params.get('profile'): cmd += ["-profile:v", params['profile']]
            if params.get('g'): cmd += ["-g", str(params['g'])]
            if params.get('bf') is not None: cmd += ["-bf", str(params['bf'])]
            cmd += ["-pix_fmt", params.get('pix_fmt', 'yuv420p')]

    def _append_audio_codec_params(self, cmd: list, acodec: str, params: dict):
        if params.get('b:a'): cmd += ["-b:a", params['b:a']]
        if params.get('ac'): cmd += ["-ac", str(params['ac'])]
        if params.get('ar'): cmd += ["-ar", str(params['ar'])]

    def _append_output(self, cmd: list, output_cfg: dict, codec_cfg: dict):
        output_type = output_cfg.get('type')
        if output_type == 'file':
            cmd += [output_cfg.get('path', 'output.mp4')]
        elif output_type == 'udp':
            cmd += ["-f", "mpegts", f"udp://{output_cfg.get('host', '127.0.0.1')}:{output_cfg.get('port', '1234')}"]
        elif output_type == 'srt':
            h, p = output_cfg.get('host', '127.0.0.1'), output_cfg.get('port', '1234')
            m, l = output_cfg.get('mode', 'caller'), output_cfg.get('latency', 200)
            cmd += ["-f", "mpegts", f"srt://{h}:{p}?mode={m}&latency={l}"]
        elif output_type == 'rtmp':
            cmd += ["-f", "flv", output_cfg.get('url', '')]

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

        with self.db_session_factory() as session:
            execution = session.query(TaskExecution).get(execution_id)
            if execution:
                execution.status = status
                if error_msg:
                    execution.error_message = error_msg
                execution.stopped_at = datetime.utcnow()
                execution.pid = None
                execution.cpu_usage = 0
                execution.ram_usage = 0
                session.commit()

    async def _log_reader(self, execution_id: int, proc):
        status_re = re.compile(r"fps=\s*([\d.]+).*bitrate=\s*([\d.]+kbits/s).*speed=\s*([\d.]+x)")
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
        level = "ERROR" if any(kw in msg.lower() for kw in ["error", "failed", "invalid"]) else "INFO"
        with self.db_session_factory() as session:
            match = status_re.search(msg)
            if match:
                fps, bitrate, speed = match.groups()
                execution = session.query(TaskExecution).get(execution_id)
                if execution:
                    execution.fps = fps
                    execution.bitrate = bitrate
                    execution.speed = speed
                    session.commit()
            
            log = TaskExecutionLog(execution_id=execution_id, level=level, message=msg)
            session.add(log)
            session.commit()

    async def _watchdog(self, execution_id: int, proc, limit_sec):
        start_time = datetime.utcnow()
        limit = (limit_sec + 30) if limit_sec else None
        
        try:
            p = psutil.Process(proc.pid)
            p.cpu_percent(interval=None)
            while proc.returncode is None:
                if limit and (datetime.utcnow() - start_time).total_seconds() > limit:
                    self.logger.warning(f"Safety watchdog: execution {execution_id} exceeded time limits. Force killing...")
                    await self.stop_execution(execution_id, status="error", error_msg="Execution timed out (force terminated by watchdog)")
                    return

                try:
                    cpu_raw = p.cpu_percent(interval=None)
                    num_cores = psutil.cpu_count() or 1
                    cpu = int(cpu_raw / num_cores)
                    mem = int(p.memory_info().rss / (1024 * 1024))
                except Exception:
                    cpu, mem = 0, 0
                
                with self.db_session_factory() as session:
                    execution = session.query(TaskExecution).get(execution_id)
                    if execution:
                        execution.cpu_usage = cpu
                        execution.ram_usage = mem
                        session.commit()

                await asyncio.sleep(1)
        except Exception:
            pass
        finally:
            await proc.wait()
            exit_code = proc.returncode
            
            with self.db_session_factory() as session:
                execution = session.query(TaskExecution).get(execution_id)
                if execution and execution.status == 'running':
                    execution.status = 'finished' if exit_code == 0 else 'error'
                    execution.exit_code = exit_code
                    execution.stopped_at = datetime.utcnow()
                    execution.pid = None
                    execution.cpu_usage = 0
                    execution.ram_usage = 0
                    session.commit()
            self.running_processes.pop(execution_id, None)
