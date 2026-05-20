import asyncio
import subprocess
import psutil
import logging
import os
from datetime import datetime
from typing import Dict, Optional
import json
import collections

class ProcessManager:
    def __init__(self, db_session_factory):
        self.processes: Dict[int, asyncio.subprocess.Process] = {}
        self.log_buffers: Dict[int, collections.deque] = {}
        self.db_session_factory = db_session_factory
        self.logger = logging.getLogger("ProcessManager")
        self.ffmpeg_path = self._detect_ffmpeg()

    def _detect_ffmpeg(self):
        local_bin = os.path.abspath("./ffmpeg_bin/bin/ffmpeg")
        if os.path.exists(local_bin):
            self.logger.info(f"Using local FFMPEG binary: {local_bin}")
            return local_bin
        return "ffmpeg"

    async def start_process(self, process_id: int):
        with self.db_session_factory() as session:
            from database.models import MediaProcess, FfmpegBuild
            media_proc = session.query(MediaProcess).get(process_id)
            if not media_proc:
                self.logger.error(f"Process {process_id} not found in DB")
                return

            # Determine which FFmpeg binary to use
            ffmpeg_bin = self.ffmpeg_path  # Default fallback
            if media_proc.ffmpeg_build_id:
                build = session.query(FfmpegBuild).get(media_proc.ffmpeg_build_id)
                if build and build.ffmpeg_binary and os.path.exists(build.ffmpeg_binary):
                    ffmpeg_bin = build.ffmpeg_binary
                    self.logger.info(f"Using profile-specific binary: {ffmpeg_bin}")

            cmd = self._build_ffmpeg_cmd(media_proc, ffmpeg_bin)
            self.logger.info(f"Starting FFMPEG for {media_proc.name}: {' '.join(cmd)}")
            
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
        proc = self.processes.get(process_id)
        if not proc:
            return

        if graceful:
            # Send 'q' to stdin for FFMPEG graceful stop
            if proc.stdin:
                proc.stdin.write(b'q')
                await proc.stdin.drain()
            
            try:
                await asyncio.wait_for(proc.wait(), timeout=10.0)
            except asyncio.TimeoutError:
                proc.terminate()
        else:
            proc.kill()

        with self.db_session_factory() as session:
            from database.models import MediaProcess
            media_proc = session.query(MediaProcess).get(process_id)
            if media_proc:
                media_proc.status = 'stopped'
                media_proc.pid = None
                media_proc.last_stop = datetime.utcnow()
                session.commit()
        
        del self.processes[process_id]

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

        # ── Detect format and build inputs ──
        is_new_format = 'input1' in input_cfg
        
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

        # ── Video processing ──
        if not has_video:
            cmd += ["-vn"]
        else:
            # Video filters
            vf = []
            if filter_cfg.get('scale'):
                vf.append(f"scale={filter_cfg['scale']}")
            if filter_cfg.get('deinterlace'):
                vf.append("yadif")
            if filter_cfg.get('framerate'):
                vf.append(f"fps={filter_cfg['framerate']}")
            if vf:
                cmd += ["-vf", ",".join(vf)]

            # Video codec
            vcodec = codec_cfg.get('vcodec', 'libx264')
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

        # ── Stream mapping for dual input ──
        if is_new_format and use_secondary:
            # Map video from input 0, audio from input 1 (or vice versa)
            # Default: input1=video, input2=audio
            if has_video:
                cmd += ["-map", "0:v"]
            if has_audio:
                cmd += ["-map", "1:a"]

        # ── Output ──
        output_cfg = media_proc.output_config
        self._append_output(cmd, output_cfg, codec_cfg)
            
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
            cmd += ["-f", "v4l2", "-i", device]
        elif input_type == 'lavfi_video':
            pattern = input_cfg.get('pattern', 'testsrc')
            cmd += ["-f", "lavfi", "-i", pattern]
        elif input_type == 'lavfi_audio':
            pattern = input_cfg.get('pattern', 'sine')
            cmd += ["-f", "lavfi", "-i", pattern]

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
            if params.get('bitrate'):
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
            bitrate = codec_cfg.get('bitrate', codec_cfg.get('video_params', {}).get('bitrate', '4000k'))
            cmd += ["-f", "mpegts", f"udp://{host}:{port}?pkt_size=1316&bitrate={bitrate}"]
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
            cmd += ["-f", "decklink", device]
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

    async def _log_reader(self, process_id: int, proc: asyncio.subprocess.Process):
        import re
        # Regex for ffmpeg status line
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

    async def _watchdog(self, process_id: int, proc: asyncio.subprocess.Process):
        try:
            p = psutil.Process(proc.pid)
            while proc.returncode is None:
                cpu = p.cpu_percent(interval=1.0)
                mem = p.memory_info().rss / (1024 * 1024) # MB
                
                with self.db_session_factory() as session:
                    from database.models import MediaProcess
                    media_proc = session.query(MediaProcess).get(process_id)
                    if media_proc:
                        media_proc.cpu_usage = int(cpu)
                        media_proc.ram_usage = int(mem)
                        session.commit()
                
                await asyncio.sleep(2)
        except psutil.NoSuchProcess:
            pass
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
                            # Here we could implement auto-restart logic
                        else:
                            media_proc.status = 'stopped'
                    
                    media_proc.pid = None
                    media_proc.last_stop = datetime.utcnow()
                    
                    # Log the exit
                    log = ProcessLog(
                        process_id=process_id,
                        level='INFO' if exit_code == 0 else 'ERROR',
                        message=f"Process exited with code {exit_code}"
                    )
                    session.add(log)
                    session.commit()
        
            if process_id in self.processes:
                del self.processes[process_id]
