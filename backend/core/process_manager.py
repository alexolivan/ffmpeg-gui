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

class ProcessManager:
    def __init__(self, db_session_factory):
        self.processes: Dict[int, asyncio.subprocess.Process] = {}
        self.log_buffers: Dict[int, collections.deque] = {}
        self.restart_counts: Dict[int, int] = {}
        self.pending_restarts: Dict[int, asyncio.Task] = {}
        self.db_session_factory = db_session_factory
        self.logger = logging.getLogger("ProcessManager")
        self.ffmpeg_path = self._detect_ffmpeg()

    def _detect_ffmpeg(self):
        local_bin = os.path.abspath("./ffmpeg_bin/bin/ffmpeg")
        if os.path.exists(local_bin):
            self.logger.info(f"Using local FFMPEG binary: {local_bin}")
            return local_bin
        return "ffmpeg"

    async def start_process(self, process_id: int, is_restart: bool = False):
        with self.db_session_factory() as session:
            from database.models import MediaProcess, FfmpegBuild, ProcessLog
            media_proc = session.query(MediaProcess).get(process_id)
            if not media_proc:
                self.logger.error(f"Process {process_id} not found in DB")
                return

            # Clear old logs from DB to prevent mixing previous execution output
            session.query(ProcessLog).filter(ProcessLog.process_id == process_id).delete()

            # Save configuration snapshot at launch
            media_proc.last_started_config = {
                "name": media_proc.name,
                "ffmpeg_build_id": media_proc.ffmpeg_build_id,
                "input_config": media_proc.input_config,
                "output_config": media_proc.output_config,
                "codec_config": media_proc.codec_config,
                "filter_config": media_proc.filter_config,
                "auto_start": media_proc.auto_start,
                "watchdog_enabled": media_proc.watchdog_enabled,
                "watchdog_retries": media_proc.watchdog_retries,
            }
            if not is_restart:
                self.restart_counts.pop(process_id, None)
            
            pending = self.pending_restarts.pop(process_id, None)
            if pending:
                pending.cancel()

            # Determine which FFmpeg binary to use
            ffmpeg_bin = self.ffmpeg_path  # Default fallback
            if media_proc.ffmpeg_build_id:
                build = session.query(FfmpegBuild).get(media_proc.ffmpeg_build_id)
                if build and build.ffmpeg_binary and os.path.exists(build.ffmpeg_binary):
                    ffmpeg_bin = build.ffmpeg_binary
                    self.logger.info(f"Using profile-specific binary: {ffmpeg_bin}")

            cmd = self._build_ffmpeg_cmd(media_proc, ffmpeg_bin)
            self.logger.info(f"Starting FFMPEG for {media_proc.name}: {shlex.join(cmd)}")
            
            try:
                self.log_buffers[process_id] = collections.deque(maxlen=100)
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    stdin=asyncio.subprocess.PIPE
                )
                self.processes[process_id] = proc
                media_proc.pid = proc.pid
                media_proc.status = 'running'
                media_proc.last_start = datetime.utcnow()
                session.commit()
                
                # Start watchdog and log reader tasks
                asyncio.create_task(self._log_reader(process_id, proc))
                asyncio.create_task(self._watchdog(process_id, proc))
                
            except Exception as e:
                self.logger.exception(f"Failed to start process {process_id}")
                media_proc.status = 'error'
                session.commit()

    async def stop_process(self, process_id: int, graceful: bool = True):
        pending = self.pending_restarts.pop(process_id, None)
        if pending:
            try:
                pending.cancel()
            except Exception as e:
                self.logger.warning(f"Error cancelling pending restart task for process {process_id}: {e}")

        proc = self.processes.get(process_id)
        self.restart_counts.pop(process_id, None)
        
        if proc:
            if graceful:
                if proc.stdin:
                    try:
                        proc.stdin.write(b'q')
                        await proc.stdin.drain()
                    except Exception as e:
                        self.logger.warning(f"Failed to write 'q' to stdin for process {process_id}: {e}")
                
                try:
                    await asyncio.wait_for(proc.wait(), timeout=4.0)
                except asyncio.TimeoutError:
                    self.logger.warning(f"Process {process_id} did not stop gracefully. Escalating to SIGTERM.")
            
            if proc.returncode is None:
                try:
                    proc.terminate()
                    await asyncio.wait_for(proc.wait(), timeout=3.0)
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

        with self.db_session_factory() as session:
            from database.models import MediaProcess
            media_proc = session.query(MediaProcess).get(process_id)
            if media_proc:
                media_proc.status = 'stopped'
                media_proc.pid = None
                media_proc.cpu_usage = 0
                media_proc.ram_usage = 0
                media_proc.fps = "0"
                media_proc.bitrate = "0 kb/s"
                media_proc.speed = "0x"
                media_proc.last_stop = datetime.utcnow()
                session.commit()

    def _build_ffmpeg_cmd(self, media_proc, ffmpeg_bin):
        """Build the ffmpeg command line from the process configuration.
        
        Supports two input_config formats:
        - Legacy (flat): { "type": "srt", "host": "...", "port": "..." }
        - New (dual-input): { "has_video": true, "has_audio": true, 
                              "use_secondary_input": false,
                              "input1": {...}, "input2": {...} }
        """
        cmd = [ffmpeg_bin, "-hide_banner", "-y"]
        
        input_cfg = media_proc.input_config
        codec_cfg = media_proc.codec_config
        filter_cfg = media_proc.filter_config or {}
        advanced = filter_cfg.get('advanced', {})

        # ── Detect format and resolve primary input type ──
        is_new_format = 'input1' in input_cfg
        primary_input_type = (
            input_cfg['input1'].get('type', '') if is_new_format
            else input_cfg.get('type', '')
        )

        # ── Advanced pre-input flags ──
        # These must appear BEFORE -i for ffmpeg to honor them.

        # Threads (CPU core limit for the entire ffmpeg process)
        threads = advanced.get('threads', 0)
        if threads and int(threads) > 0:
            cmd += ["-threads", str(int(threads))]

        # Hardware acceleration
        hwaccel = advanced.get('hwaccel', 'none')
        if hwaccel and hwaccel != 'none':
            cmd += ["-hwaccel", hwaccel]
            # Output format defaults to match hwaccel (vaapi→vaapi, cuda→cuda)
            hwaccel_out = advanced.get('hwaccel_output_format', '')
            if not hwaccel_out:
                hwaccel_out = hwaccel
            if hwaccel_out and hwaccel_out != 'none':
                cmd += ["-hwaccel_output_format", hwaccel_out]

        # Probe size (analysis buffer for input detection)
        probesize = advanced.get('probesize', '')
        if probesize:
            cmd += ["-probesize", str(probesize)]

        # Thread queue size (demuxer buffer depth)
        tqs = advanced.get('thread_queue_size', 0)
        if tqs and int(tqs) > 0:
            cmd += ["-thread_queue_size", str(int(tqs))]

        # Realtime flag (-re): throttles input read to native framerate.
        # Essential for file/lavfi sources in live streaming to prevent
        # runaway encoding at 16x+ speed. Network sources (srt, udp, etc.)
        # are already rate-limited by the sender, so -re is unnecessary.
        _SELF_PACED_INPUTS = {'file', 'lavfi_video', 'lavfi_audio'}
        is_service = getattr(media_proc, 'type', 'service') == 'service'
        realtime = advanced.get('realtime')
        if realtime is None:
            # Auto-enable for services with self-paced inputs
            realtime = is_service and primary_input_type in _SELF_PACED_INPUTS
        if realtime:
            cmd += ["-re"]

        # Stream loop (-stream_loop): only meaningful for file inputs in services.
        # -1 = infinite loop (typical for 24/7 channel playout from file)
        stream_loop = advanced.get('stream_loop')
        if stream_loop is not None and primary_input_type == 'file' and is_service:
            cmd += ["-stream_loop", str(int(stream_loop))]

        # ── Build inputs ──
        if is_new_format:
            has_video = input_cfg.get('has_video', True)
            has_audio = input_cfg.get('has_audio', True)
            use_secondary = input_cfg.get('use_secondary_input', False)
            
            # Input 1
            self._append_input(cmd, input_cfg['input1'])
            
            # Input 2 (if separate source enabled)
            if use_secondary and 'input2' in input_cfg:
                self._append_input(cmd, input_cfg['input2'])
        else:
            # Legacy format: single input
            has_video = True
            has_audio = True
            use_secondary = False
            self._append_input(cmd, input_cfg)

        # ── HLS ABR detection ──
        output_cfg = media_proc.output_config
        variants = output_cfg.get('variants', [])
        is_abr = output_cfg.get('type') == 'hls' and len(variants) > 0

        if is_abr:
            # ── HLS ABR processing ──
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
                
            cmd += [variant_playlist]

        else:
            # ── Stream mapping ──
            if is_new_format and use_secondary:
                if has_video:
                    cmd += ["-map", "0:v"]
                if has_audio:
                    cmd += ["-map", "1:a"]
            else:
                if has_video:
                    cmd += ["-map", "0:v"]
                if has_audio:
                    cmd += ["-map", "0:a"]

            # ── Video processing ──
            if not has_video:
                cmd += ["-vn"]
            else:
                # Video filters
                vf = []
                if filter_cfg.get('scale'):
                    scale_val = filter_cfg['scale'].replace('x', ':')
                    vf.append(f"scale={scale_val}")
                if filter_cfg.get('deinterlace'):
                    vf.append("yadif")
                if filter_cfg.get('framerate'):
                    vf.append(f"fps={filter_cfg['framerate']}")
                
                vcodec = codec_cfg.get('vcodec', 'libx264')
                hwaccel = advanced.get('hwaccel', 'none')
                if vcodec in ('h264_vaapi', 'hevc_vaapi') and hwaccel != 'vaapi':
                    vf.append("format=nv12")
                    vf.append("hwupload")
                    
                if output_cfg.get('type') == 'decklink':
                    if output_cfg.get('video_size'):
                        size_arg = output_cfg['video_size'].replace('x', ':')
                        vf.append(f"scale={size_arg}")
                    if output_cfg.get('framerate'):
                        vf.append(f"fps={output_cfg['framerate']}")
                    vf.append("format=yuv422p")
                        
                if vf:
                    cmd += ["-vf", ",".join(vf)]

                # Video codec
                vcodec = codec_cfg.get('vcodec', 'libx264')
                if output_cfg.get('type') == 'decklink' and vcodec == 'rawvideo':
                    cmd += ["-c:v", "wrapped_avframe"]
                else:
                    cmd += ["-c:v", vcodec]
                
                # Video codec parameters (new format)
                video_params = codec_cfg.get('video_params', {})
                if video_params:
                    self._append_video_codec_params(cmd, vcodec, video_params)
                else:
                    # Legacy fallback: basic preset for x264
                    if vcodec == 'libx264':
                        cmd += ["-preset", "veryfast", "-tune", "zerolatency"]
                    # Legacy bitrate
                    if codec_cfg.get('bitrate'):
                        cmd += ["-b:v", codec_cfg['bitrate']]

            # ── Audio processing ──
            if not has_audio:
                cmd += ["-an"]
            else:
                acodec = codec_cfg.get('acodec', 'aac')
                cmd += ["-c:a", acodec]
                
                # Audio codec parameters (new format)
                audio_params = codec_cfg.get('audio_params', {})
                if audio_params:
                    self._append_audio_codec_params(cmd, acodec, audio_params)

            # ── Output ──
            self._append_output(cmd, output_cfg, codec_cfg)
            
        # ── Secondary Preview Output ──
        is_service = getattr(media_proc, 'type', 'service') == 'service'
        if is_service and has_video:
            import os
            from database.db import BASE_DIR
            previews_dir = os.path.join(BASE_DIR, "data", "previews")
            os.makedirs(previews_dir, exist_ok=True)
            preview_path = os.path.join(previews_dir, f"preview_{media_proc.id}.jpg")
            cmd += [
                "-map", "0:v",
                "-c:v", "mjpeg",
                "-vf", "fps=1,scale=480:-1",
                "-update", "1",
                "-y", preview_path
            ]

        return cmd

    def _append_input(self, cmd: list, input_cfg: dict):
        """Append a single -i input to the command."""
        input_type = input_cfg.get('type')
        
        if input_type == 'file':
            cmd += ["-i", input_cfg.get('path', '')]
        elif input_type == 'srt':
            mode = input_cfg.get('mode', 'listener')
            latency = input_cfg.get('latency', 200)
            host = input_cfg.get('host', '')
            port = input_cfg.get('port', '9000')
            cmd += ["-i", f"srt://{host}:{port}?mode={mode}&latency={latency}"]
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
        elif input_type == 'udp':
            host = input_cfg.get('host', '')
            port = input_cfg.get('port', '1234')
            cmd += ["-i", f"udp://{host}:{port}?fifo_size=1000000"]
        elif input_type == 'rtp':
            host = input_cfg.get('host', '')
            port = input_cfg.get('port', '5004')
            cmd += ["-i", f"rtp://{host}:{port}"]
        elif input_type == 'alsa':
            device = input_cfg.get('device', 'hw:0,0')
            cmd += ["-f", "alsa", "-i", device]
        elif input_type == 'v4l2':
            device = input_cfg.get('device', '/dev/video0')
            pixel_format = input_cfg.get('pixel_format')
            size = input_cfg.get('size')
            if pixel_format:
                cmd += ["-input_format", pixel_format]
            if size:
                cmd += ["-video_size", size]
            cmd += ["-f", "v4l2", "-i", device]
        elif input_type in ('http_audio', 'rtmp', 'hls'):
            cmd += ["-i", input_cfg.get('path', '')]
        elif input_type == 'lavfi_video':
            pattern = input_cfg.get('pattern', 'testsrc')
            size = input_cfg.get('size')
            rate = input_cfg.get('rate')
            
            lavfi_str = pattern
            params = []
            if size:
                params.append(f"size={size}")
            if rate:
                params.append(f"rate={rate}")
                
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

    def _append_video_codec_params(self, cmd: list, vcodec: str, params: dict):
        """Append video codec-specific parameters to the command."""
        rc_mode = params.get('rc_mode', '')
        
        if vcodec in ('libx264', 'libx265'):
            # Rate control
            if rc_mode == 'crf':
                crf = params.get('crf', 23)
                cmd += ["-crf", str(crf)]
            elif rc_mode in ('cbr', 'vbr'):
                bitrate = params.get('bitrate', '4000k')
                cmd += ["-b:v", bitrate]
                if params.get('maxrate'):
                    cmd += ["-maxrate", params['maxrate']]
                if params.get('bufsize'):
                    cmd += ["-bufsize", params['bufsize']]
            
            # Preset & tune
            if params.get('preset'):
                cmd += ["-preset", params['preset']]
            tune = params.get('tune', 'none')
            if tune and tune != 'none':
                cmd += ["-tune", tune]
            if params.get('profile'):
                cmd += ["-profile:v", params['profile']]
            if params.get('g'):
                cmd += ["-g", str(params['g'])]
            if params.get('bf') is not None:
                cmd += ["-bf", str(params['bf'])]
            
            # Prevent 4:4:4 crashes with baseline/main profiles by defaulting to yuv420p
            pix_fmt = params.get('pix_fmt', 'yuv420p')
            cmd += ["-pix_fmt", pix_fmt]
                
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
            # VAAPI HW encoding
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
        """Append audio codec-specific parameters to the command."""
        # Common: bitrate
        if params.get('b:a'):
            cmd += ["-b:a", params['b:a']]
        
        # Common: channels
        if params.get('ac'):
            cmd += ["-ac", str(params['ac'])]
        
        # Common: sample rate
        if params.get('ar'):
            cmd += ["-ar", str(params['ar'])]
        
        # Codec-specific
        if acodec == 'aac' and params.get('profile:a'):
            cmd += ["-profile:a", params['profile:a']]
        elif acodec == 'libopus':
            if params.get('application'):
                cmd += ["-application", params['application']]
            if params.get('vbr'):
                cmd += ["-vbr", params['vbr']]

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
                    
        elif vcodec in ('h264_vaapi', 'hevc_vaapi'):
            pass

    def _append_audio_codec_params_indexed(self, cmd: list, acodec: str, params: dict, idx: int, bitrate: str):
        """Append audio codec-specific parameters to the command for a specific stream index."""
        cmd += [f"-b:a:{idx}", bitrate]
        if params.get('ac'):
            cmd += [f"-ac:a:{idx}", str(params['ac'])]
        if params.get('ar'):
            cmd += [f"-ar:a:{idx}", str(params['ar'])]
        if acodec == 'aac' and params.get('profile:a'):
            cmd += [f"-profile:a:{idx}", params['profile:a']]
        elif acodec == 'libopus':
            if params.get('application'):
                cmd += [f"-application:a:{idx}", params['application']]
            if params.get('vbr'):
                cmd += [f"-vbr:a:{idx}", params['vbr']]

    def _append_output(self, cmd: list, output_cfg: dict, codec_cfg: dict):
        """Append output destination to the command."""
        output_type = output_cfg.get('type')
        
        if output_type == 'file':
            path = output_cfg.get('path', 'output.mp4')
            container = output_cfg.get('container', '')
            # If container hint doesn't match extension, let ffmpeg figure it out
            cmd += [path]
        elif output_type == 'udp':
            host = output_cfg.get('host', '127.0.0.1')
            port = output_cfg.get('port', '1234')
            cmd += ["-f", "mpegts", f"udp://{host}:{port}"]
        elif output_type == 'srt':
            host = output_cfg.get('host', '127.0.0.1')
            port = output_cfg.get('port', '1234')
            mode = output_cfg.get('mode', 'caller')
            latency = output_cfg.get('latency', 200)
            cmd += ["-f", "mpegts", f"srt://{host}:{port}?mode={mode}&latency={latency}"]
        elif output_type == 'rtmp':
            cmd += ["-f", "flv", output_cfg.get('url', '')]
        elif output_type == 'ndi':
            name = output_cfg.get('path', 'FFMPEG-OUTPUT')
            cmd += ["-f", "libndi_newtek", "-ndi_name", name, "output.ndi"]
        elif output_type == 'decklink':
            device = output_cfg.get('device', 'DeckLink Mini Monitor')
            cmd += ["-f", "decklink"]
            format_code = output_cfg.get('format_code')
            if format_code:
                cmd += ["-format_code", format_code]
                code_lower = format_code.lower()
                if code_lower in ('pal', 'ntsc') or code_lower.startswith('hi'):
                    if code_lower == 'ntsc':
                        cmd += ["-field_order", "bb"]
                    else:
                        cmd += ["-field_order", "tt"]
                else:
                    cmd += ["-field_order", "progressive"]
            cmd += [device]
        elif output_type == 'rtp':
            host = output_cfg.get('host', '127.0.0.1')
            port = output_cfg.get('port', '5004')
            cmd += ["-f", "rtp", f"rtp://{host}:{port}"]
        elif output_type == 'icecast':
            host = output_cfg.get('host', 'localhost')
            port = output_cfg.get('port', '8000')
            mount = output_cfg.get('icecast_mount', '/live')
            password = output_cfg.get('icecast_password', 'hackme')
            cmd += ["-f", "ogg", "-content_type", "application/ogg",
                    f"icecast://source:{password}@{host}:{port}{mount}"]
        elif output_type == 'hls':
            path = output_cfg.get('path', '')
            method = output_cfg.get('hls_method', 'local')
            hls_time = output_cfg.get('hls_time', 2)
            hls_list_size = output_cfg.get('hls_list_size', 5)
            hls_delete = output_cfg.get('hls_delete_segments', True)
            headers = output_cfg.get('headers', '')

            cmd += ["-f", "hls"]
            cmd += ["-hls_time", str(hls_time)]
            cmd += ["-hls_list_size", str(hls_list_size)]

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
                
                if path.endswith('.m3u8'):
                    segment_pattern = path.replace('.m3u8', '_%03d.ts')
                    cmd += ["-hls_segment_filename", segment_pattern]

            cmd += [path]

    async def _log_reader(self, process_id: int, proc: asyncio.subprocess.Process):
        import re
        # Regex for ffmpeg status line
        status_re = re.compile(r"fps=\s*([\d.]+).*bitrate=\s*([\d.]+kbits/s).*speed=\s*([\d.]+x)")
        
        buffer = bytearray()
        while True:
            chunk = await proc.stderr.read(4096)
            if not chunk:
                if buffer:
                    msg = buffer.decode('utf-8', errors='replace').strip()
                    if msg:
                        self._handle_log_msg(process_id, msg, status_re)
                break
            
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
                from database.models import MediaProcess
                media_proc = session.query(MediaProcess).get(process_id)
                if media_proc:
                    media_proc.fps = fps
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

    async def _delayed_restart(self, process_id: int):
        try:
            await asyncio.sleep(5)
            if process_id in self.processes:
                return

            with self.db_session_factory() as session:
                from database.models import MediaProcess, ProcessLog
                media_proc = session.query(MediaProcess).get(process_id)
                if not media_proc or media_proc.status == 'stopped':
                    self.logger.info(f"Watchdog: Process {process_id} status is stopped or deleted. Aborting restart.")
                    return

                self.logger.info(f"Watchdog triggering restart for process {process_id}")
                log = ProcessLog(
                    process_id=process_id,
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

    async def _watchdog(self, process_id: int, proc: asyncio.subprocess.Process):
        was_unexpected = False
        try:
            p = psutil.Process(proc.pid)
            # Initialize cpu_percent to discard the first meaningless 0.0 value
            p.cpu_percent(interval=None)
            
            last_ffprobe_check = datetime.utcnow()
            last_activity_check = datetime.utcnow()
            
            while proc.returncode is None:
                # non-blocking call to compute CPU usage since last call
                cpu_raw = p.cpu_percent(interval=None)
                num_cores = psutil.cpu_count() or 1
                cpu = cpu_raw / num_cores
                mem = p.memory_info().rss / (1024 * 1024)  # MB
                
                with self.db_session_factory() as session:
                    from database.models import MediaProcess
                    media_proc = session.query(MediaProcess).get(process_id)
                    if media_proc:
                        media_proc.cpu_usage = int(cpu)
                        media_proc.ram_usage = int(mem)
                        session.commit()
                        
                        # Active stream check (UDP, RTP, SRT)
                        if media_proc.type == 'service' and media_proc.watchdog_enabled:
                            now = datetime.utcnow()
                            if (now - last_ffprobe_check).total_seconds() > 30:
                                last_ffprobe_check = now
                                input_cfg = media_proc.input_config
                                inputs_to_check = []
                                if 'input1' in input_cfg:
                                    inputs_to_check.append(input_cfg['input1'])
                                    if input_cfg.get('use_secondary_input') and 'input2' in input_cfg:
                                        inputs_to_check.append(input_cfg['input2'])
                                else:
                                    inputs_to_check.append(input_cfg)
                                
                                for inp in inputs_to_check:
                                    inp_type = inp.get('type')
                                    if inp_type in ('udp', 'rtp', 'srt'):
                                        url = None
                                        if inp_type == 'udp':
                                            url = f"udp://{inp.get('host', '')}:{inp.get('port', '1234')}"
                                        elif inp_type == 'rtp':
                                            url = f"rtp://{inp.get('host', '')}:{inp.get('port', '5004')}"
                                        elif inp_type == 'srt':
                                            if inp.get('mode', 'listener') == 'caller':
                                                url = f"srt://{inp.get('host', '')}:{inp.get('port', '9000')}?mode=caller"
                                        
                                        if url:
                                            # Find build-specific ffprobe
                                            ffprobe_bin = "ffprobe"
                                            if media_proc.ffmpeg_build_id:
                                                from database.models import FfmpegBuild
                                                build = session.query(FfmpegBuild).get(media_proc.ffmpeg_build_id)
                                                if build and build.ffprobe_binary and os.path.exists(build.ffprobe_binary):
                                                    ffprobe_bin = build.ffprobe_binary
                                            
                                            self.logger.info(f"Watchdog probing network stream: {url}")
                                            alive = await self._probe_url(url, ffprobe_bin)
                                            if not alive:
                                                self.logger.warning(f"Watchdog probe failed for: {url}")
                                                from database.models import ProcessLog
                                                log = ProcessLog(
                                                    process_id=process_id,
                                                    level='ERROR',
                                                    message=f"Watchdog: Active probe failed for network input: {url}."
                                                )
                                                session.add(log)
                                                session.commit()
                                                proc.kill()
                                                break
                                        
                                        # SRT listener fallback check (check if bitrate or fps has activity)
                                        if inp_type == 'srt' and inp.get('mode', 'listener') == 'listener':
                                            if (now - last_activity_check).total_seconds() > 30:
                                                last_activity_check = now
                                                bitrate_str = (media_proc.bitrate or "0").lower()
                                                fps_str = (media_proc.fps or "0")
                                                if "0" in bitrate_str or fps_str == "0" or not bitrate_str:
                                                    self.logger.warning("Watchdog: SRT listener stream has no bitrate/fps activity. Restarting service.")
                                                    from database.models import ProcessLog
                                                    log = ProcessLog(
                                                        process_id=process_id,
                                                        level='ERROR',
                                                        message="Watchdog: SRT listener has no incoming data stream activity. Restarting service."
                                                    )
                                                    session.add(log)
                                                    session.commit()
                                                    proc.kill()
                                                    break
                
                await asyncio.sleep(2)
        except psutil.NoSuchProcess:
            pass
        finally:
            # Check if this exit was unexpected (process was in self.processes and not stopped manually)
            if process_id in self.processes:
                was_unexpected = True
                
            await proc.wait()
            exit_code = proc.returncode
            
            with self.db_session_factory() as session:
                from database.models import MediaProcess, ProcessLog
                media_proc = session.query(MediaProcess).get(process_id)
                if media_proc:
                    # Clean up stats
                    media_proc.cpu_usage = 0
                    media_proc.ram_usage = 0
                    media_proc.fps = "0"
                    media_proc.bitrate = "0 kb/s"
                    media_proc.speed = "0x"
                    
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
                    
                    # Handle automatic restart if enabled and unexpected
                    if was_unexpected and media_proc.type == 'service' and media_proc.watchdog_enabled:
                        retries = media_proc.watchdog_retries
                        current_restarts = self.restart_counts.get(process_id, 0)
                        if retries == -1 or current_restarts < retries:
                            self.restart_counts[process_id] = current_restarts + 1
                            self.logger.info(f"Watchdog: unexpectedly exited. Scheduling restart attempt {self.restart_counts[process_id]}/{retries if retries != -1 else 'inf'}...")
                            restart_log = ProcessLog(
                                process_id=process_id,
                                level='WARNING',
                                message=f"Watchdog: Unexpected exit detected. Restarting (attempt {self.restart_counts[process_id]}/{retries if retries != -1 else 'inf'}) in 5 seconds..."
                            )
                            session.add(restart_log)
                            session.commit()
                            old_task = self.pending_restarts.pop(process_id, None)
                            if old_task:
                                try:
                                    old_task.cancel()
                                except Exception:
                                    pass
                            task = asyncio.create_task(self._delayed_restart(process_id))
                            self.pending_restarts[process_id] = task
                        else:
                            self.logger.warning(f"Watchdog: Max restart attempts ({retries}) reached for process {process_id}. Giving up.")
                            limit_log = ProcessLog(
                                process_id=process_id,
                                level='ERROR',
                                message=f"Watchdog: Max restart attempts ({retries}) reached. Service stopped."
                            )
                            session.add(limit_log)
                            session.commit()
            
            # Clean up memory buffer
            if process_id in self.log_buffers:
                del self.log_buffers[process_id]
        
            if process_id in self.processes:
                del self.processes[process_id]
