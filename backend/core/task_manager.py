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
        self.last_activity = {}

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

            cmd = self._build_ffmpeg_cmd(task, ffmpeg_bin, limit_sec, execution_id=execution_id)
            self.logger.info(f"Starting scheduled task FFmpeg cmd: {shlex.join(cmd)}")
            
            try:
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    stdin=asyncio.subprocess.PIPE
                )
                self.running_processes[execution_id] = proc
                self.last_activity[execution_id] = datetime.utcnow()
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

    def _build_ffmpeg_cmd(self, task, ffmpeg_bin, limit_sec, execution_id=None):
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

        # Realtime flag (-re): throttles input read to native framerate.
        _SELF_PACED_INPUTS = {'file', 'lavfi_video', 'lavfi_audio'}
        realtime = advanced.get('realtime')
        if realtime is None:
            realtime = limit_sec is not None and primary_input_type in _SELF_PACED_INPUTS
        if realtime:
            cmd += ["-re"]

        # Stream loop (-stream_loop)
        stream_loop = advanced.get('stream_loop')
        if stream_loop is not None and primary_input_type == 'file':
            cmd += ["-stream_loop", str(int(stream_loop))]

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

        # ── HLS ABR detection ──
        output_cfg = task.output_config
        variants = output_cfg.get('variants', [])
        is_abr = output_cfg.get('type') == 'hls' and len(variants) > 0

        if is_abr:
            vcodec = codec_cfg.get('vcodec', 'libx264')
            video_params = codec_cfg.get('video_params', {})
            hwaccel = advanced.get('hwaccel', 'none')
            
            # Video variant scale and mapping
            if not has_video:
                cmd += ["-vn"]
            else:
                for idx, v in enumerate(variants):
                    cmd += ["-map", "0:v"]
                    
                    # Video filters
                    scale_filter = "scale"
                    if hwaccel == 'vaapi':
                        scale_filter = "scale_vaapi"
                    elif hwaccel in ('cuda', 'npp'):
                        scale_filter = "scale_npp"
                        
                    vf_list = []
                    if filter_cfg.get('deinterlace'):
                        vf_list.append("yadif")
                    vf_list.append(f"{scale_filter}={v['resolution']}")
                    if filter_cfg.get('framerate'):
                        vf_list.append(f"fps={filter_cfg['framerate']}")
                        
                    if vcodec in ('h264_vaapi', 'hevc_vaapi') and hwaccel != 'vaapi':
                        vf_list.append("format=nv12")
                        vf_list.append("hwupload")
                        
                    cmd += [f"-filter:v:{idx}", ",".join(vf_list)]
                    cmd += [f"-c:v:{idx}", vcodec]
                    
                    self._append_video_codec_params_indexed(cmd, vcodec, video_params, idx, v['video_bitrate'])

            # Audio variant mapping (deduplication)
            if not has_audio:
                cmd += ["-an"]
            else:
                acodec = codec_cfg.get('acodec', 'aac')
                audio_params = codec_cfg.get('audio_params', {})
                
                unique_audios = list(dict.fromkeys([v['audio_bitrate'] for v in variants if v.get('audio_bitrate')]))
                if not unique_audios:
                    unique_audios = [audio_params.get('b:a', '128k')]
                
                audio_map_idx = 1 if (is_new_format and use_secondary) else 0
                for idx, audio_bitrate in enumerate(unique_audios):
                    cmd += ["-map", f"{audio_map_idx}:a"]
                    cmd += [f"-c:a:{idx}", acodec]
                    self._append_audio_codec_params_indexed(cmd, acodec, audio_params, idx, audio_bitrate)

            # Output Muxer ABR
            path = output_cfg.get('path', '')
            method = output_cfg.get('hls_method', 'local')
            hls_time = output_cfg.get('hls_time', 2)
            hls_list_size = output_cfg.get('hls_list_size', 5)
            hls_delete = output_cfg.get('hls_delete_segments', True)
            headers = output_cfg.get('headers', '')
            
            cmd += ["-f", "hls"]
            cmd += ["-hls_time", str(hls_time)]
            cmd += ["-hls_list_size", str(hls_list_size)]
            
            cmd += ["-master_pl_name", "master.m3u8"]
            
            # Map stream configs to index mappings
            unique_audios = list(dict.fromkeys([v['audio_bitrate'] for v in variants if v.get('audio_bitrate')]))
            if not unique_audios:
                unique_audios = [audio_params.get('b:a', '128k')]
                
            stream_maps = []
            for idx, v in enumerate(variants):
                a_bitrate = v.get('audio_bitrate', unique_audios[0])
                try:
                    a_idx = unique_audios.index(a_bitrate)
                except ValueError:
                    a_idx = 0
                if has_audio:
                    stream_maps.append(f"v:{idx},a:{a_idx}")
                else:
                    stream_maps.append(f"v:{idx}")
                    
            cmd += ["-var_stream_map", " ".join(stream_maps)]
            
            if path.endswith('.m3u8'):
                base_path = path[:-5]
                segment_pattern = f"{base_path}_%v_%03d.ts"
                variant_playlist = f"{base_path}_%v.m3u8"
            else:
                segment_pattern = f"{path}_%v_%03d.ts"
                variant_playlist = f"{path}_%v.m3u8"
                
            if method in ('PUT', 'POST'):
                cmd += ["-method", method]
                if headers:
                    formatted_headers = headers.strip()
                    if not formatted_headers.endswith('\r\n'):
                        formatted_headers += '\r\n'
                    cmd += ["-headers", formatted_headers]
            else:
                if hls_delete:
                    cmd += ["-hls_flags", "delete_segments"]
                cmd += ["-hls_segment_filename", segment_pattern]
            
            if limit_sec:
                cmd += ["-t", str(limit_sec)]
                
            cmd += [variant_playlist]

        else:
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
                
                vcodec = codec_cfg.get('vcodec', 'libx264')
                hwaccel = advanced.get('hwaccel', 'none')
                if vcodec in ('h264_vaapi', 'hevc_vaapi') and hwaccel != 'vaapi':
                    vf.append("format=nv12")
                    vf.append("hwupload")
                    
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

        # ── Secondary Preview Output ──
        if execution_id and has_video:
            import os
            from database.db import BASE_DIR
            previews_dir = os.path.join(BASE_DIR, "data", "previews")
            os.makedirs(previews_dir, exist_ok=True)
            preview_path = os.path.join(previews_dir, f"preview_task_{execution_id}.jpg")
            cmd += [
                "-map", "0:v",
                "-c:v", "mjpeg",
                "-vf", "fps=1,scale=480:-1",
            ]
            if limit_sec:
                cmd += ["-t", str(limit_sec)]
            cmd += [
                "-update", "1",
                "-y", preview_path
            ]

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
            video_input = input_cfg.get('video_input')
            if video_input and video_input != 'unset':
                cmd += ["-video_input", video_input]
            audio_input = input_cfg.get('audio_input')
            if audio_input and audio_input != 'unset':
                cmd += ["-audio_input", audio_input]
            format_code = input_cfg.get('format_code')
            if format_code and format_code != 'unset':
                cmd += ["-format_code", format_code]
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
            
        elif vcodec == 'prores_ks':
            if params.get('profile') is not None:
                cmd += ["-profile:v", str(params['profile'])]
            if params.get('vendor'):
                cmd += ["-vendor", params['vendor']]
                
        elif vcodec == 'dnxhd':
            profile = params.get('profile', 'dnxhr_hq')
            if profile == 'dnxhd':
                if params.get('bitrate'):
                    cmd += ["-b:v", params['bitrate']]
            else:
                cmd += ["-profile:v", profile]
                
        elif vcodec in ('h264_vaapi', 'hevc_vaapi'):
            cmd += ["-vaapi_device", "/dev/dri/renderD128"]
            rc_mode_vaapi = params.get('rc_mode', 'CBR')
            cmd += ["-rc_mode", rc_mode_vaapi]
            if rc_mode_vaapi != 'CQP' and params.get('bitrate'):
                cmd += ["-b:v", params['bitrate']]
            if rc_mode_vaapi == 'CQP' and params.get('qp') is not None:
                cmd += ["-qp", str(params['qp'])]
            if params.get('profile'):
                cmd += ["-profile:v", params['profile']]
            if params.get('g'):
                cmd += ["-g", str(params['g'])]
                
        elif vcodec in ('h264_qsv',):
            if params.get('preset'):
                cmd += ["-preset", params['preset']]
            if params.get('bitrate'):
                cmd += ["-b:v", params['bitrate']]
            if params.get('global_quality') is not None:
                cmd += ["-global_quality", str(params['global_quality'])]
            if params.get('g'):
                cmd += ["-g", str(params['g'])]
                
        elif vcodec in ('h264_nvenc', 'hevc_nvenc'):
            if params.get('preset'):
                cmd += ["-preset", params['preset']]
            rc = params.get('rc', 'cbr')
            cmd += ["-rc", rc]
            if params.get('bitrate'):
                cmd += ["-b:v", params['bitrate']]
            if rc in ('constqp', 'vbr') and params.get('cq') is not None:
                cmd += ["-cq", str(params['cq'])]
            if params.get('profile'):
                cmd += ["-profile:v", params['profile']]
            if params.get('g'):
                cmd += ["-g", str(params['g'])]
            if params.get('bf') is not None:
                cmd += ["-bf", str(params['bf'])]
                
        elif vcodec == 'rawvideo':
            pix_fmt = params.get('pix_fmt', 'uyvy422')
            cmd += ["-pix_fmt", pix_fmt]
            
        elif vcodec == 'v210':
            pass

    def _append_audio_codec_params(self, cmd: list, acodec: str, params: dict):
        if params.get('b:a'): cmd += ["-b:a", params['b:a']]
        if params.get('ac'): cmd += ["-ac", str(params['ac'])]
        if params.get('ar'): cmd += ["-ar", str(params['ar'])]

    def _append_video_codec_params_indexed(self, cmd: list, vcodec: str, params: dict, idx: int, bitrate: str):
        """Append video codec-specific parameters to the command for a specific stream index."""
        cmd += [f"-b:v:{idx}", bitrate]
        rc_mode = params.get('rc_mode', '')
        
        if vcodec in ('libx264', 'libx265'):
            if params.get('preset'):
                cmd += [f"-preset:v:{idx}", params['preset']]
            tune = params.get('tune', 'none')
            if tune and tune != 'none':
                cmd += [f"-tune:v:{idx}", tune]
            if params.get('profile'):
                cmd += [f"-profile:v:{idx}", params['profile']]
            if params.get('g'):
                cmd += [f"-g:v:{idx}", str(params['g'])]
            if params.get('bf') is not None:
                cmd += [f"-bf:v:{idx}", str(params['bf'])]
            
            pix_fmt = params.get('pix_fmt', 'yuv420p')
            cmd += [f"-pix_fmt:v:{idx}", pix_fmt]
            
            if rc_mode == 'crf':
                crf = params.get('crf', 23)
                cmd += [f"-crf:v:{idx}", str(crf)]
            elif rc_mode in ('cbr', 'vbr'):
                if params.get('maxrate'):
                    cmd += [f"-maxrate:v:{idx}", params['maxrate']]
                if params.get('bufsize'):
                    cmd += [f"-bufsize:v:{idx}", params['bufsize']]

    def _append_audio_codec_params_indexed(self, cmd: list, acodec: str, params: dict, idx: int, bitrate: str):
        """Append audio codec-specific parameters to the command for a specific stream index."""
        cmd += [f"-b:a:{idx}", bitrate]
        if params.get('ac'):
            cmd += [f"-ac:a:{idx}", str(params['ac'])]
        if params.get('ar'):
            cmd += [f"-ar:a:{idx}", str(params['ar'])]

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
            self.last_activity.pop(execution_id, None)

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
        self.last_activity[execution_id] = datetime.utcnow()
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
            self.last_activity.pop(execution_id, None)
