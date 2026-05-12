import asyncio
import subprocess
import psutil
import logging
import os
from datetime import datetime
from typing import Dict, Optional
import json

class ProcessManager:
    def __init__(self, db_session_factory):
        self.processes: Dict[int, asyncio.subprocess.Process] = {}
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
        cmd = [ffmpeg_bin, "-hide_banner", "-y"]
        
        # HW Acceleration (VAAPI as default for Linux)
        # cmd += ["-hwaccel", "vaapi", "-hwaccel_device", "/dev/dri/renderD128"]

        # Input
        input_cfg = media_proc.input_config
        input_type = input_cfg.get('type')
        
        if input_type == 'file':
            cmd += ["-i", input_cfg.get('path')]
        elif input_type == 'srt':
            mode = input_cfg.get('mode', 'listener')
            cmd += ["-i", f"srt://{input_cfg.get('host')}:{input_cfg.get('port')}?mode={mode}"]
        elif input_type == 'ndi':
            cmd += ["-f", "libndi_newtek", "-find_sources", "1", "-i", input_cfg.get('name')]
        elif input_type == 'decklink':
            cmd += ["-f", "decklink", "-i", input_cfg.get('device')]
        elif input_type == 'udp':
            cmd += ["-i", f"udp://{input_cfg.get('host')}:{input_cfg.get('port')}?fifo_size=1000000"]
        
        # Processing / Filters
        filter_cfg = media_proc.filter_config or {}
        vf = []
        if filter_cfg.get('scale'):
            vf.append(f"scale={filter_cfg['scale']}")
        if filter_cfg.get('deinterlace'):
            vf.append("yadif")
        
        if vf:
            cmd += ["-vf", ",".join(vf)]

        # Codecs
        codec_cfg = media_proc.codec_config
        cmd += ["-c:v", codec_cfg.get('vcodec', 'libx264')]
        if codec_cfg.get('vcodec') == 'libx264':
            cmd += ["-preset", "veryfast", "-tune", "zerolatency"]
        
        cmd += ["-c:a", codec_cfg.get('acodec', 'aac')]
        
        # Output
        output_cfg = media_proc.output_config
        output_type = output_cfg.get('type')
        
        if output_type == 'file':
            cmd += [output_cfg.get('path')]
        elif output_type == 'udp':
            host = output_cfg.get('host', '127.0.0.1')
            port = output_cfg.get('port', '1234')
            cmd += ["-f", "mpegts", f"udp://{host}:{port}?pkt_size=1316&bitrate={codec_cfg.get('bitrate', '4000k')}"]
        elif output_type == 'srt':
            host = output_cfg.get('host', '127.0.0.1')
            port = output_cfg.get('port', '1234')
            mode = output_cfg.get('mode', 'caller')
            latency = output_cfg.get('latency', 200)
            cmd += ["-f", "mpegts", f"srt://{host}:{port}?mode={mode}&latency={latency}"]
        elif output_type == 'rtmp':
            cmd += ["-f", "flv", output_cfg.get('url')]
            
        return cmd

    async def _log_reader(self, process_id: int, proc: asyncio.subprocess.Process):
        import re
        # Regex for ffmpeg status line
        # frame=  151 fps= 30 q=28.0 size=    1536kB time=00:00:05.03 bitrate=2501.1kbits/s speed=   1x
        status_re = re.compile(r"fps=\s*([\d.]+).*bitrate=\s*([\d.]+kbits/s).*speed=\s*([\d.]+x)")
        
        while True:
            line = await proc.stderr.readline()
            if not line:
                break
            msg = line.decode().strip()
            
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
