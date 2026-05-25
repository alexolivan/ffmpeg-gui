import asyncio
import subprocess
import logging
import shlex

class PreviewManager:
    def __init__(self):
        self.logger = logging.getLogger("PreviewManager")

    async def get_mjpeg_stream(self, input_config: dict):
        # Build a lightweight command to generate MJPEG from the source
        cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error"]
        
        # Input selection based on config
        input_type = input_config.get('type')
        if input_type == 'file':
            cmd += ["-re", "-i", input_config.get('path')]
        elif input_type == 'srt':
            cmd += ["-i", f"srt://{input_config.get('host')}:{input_config.get('port')}?mode={input_config.get('mode', 'listener')}"]
        elif input_type == 'udp':
            cmd += ["-i", f"udp://{input_config.get('host')}:{input_config.get('port')}"]
        else:
            # Fallback for unsupported types in preview
            return

        # Output MJPEG to stdout
        cmd += [
            "-vf", "scale=640:-1", # Low res
            "-r", "10",            # Low fps
            "-c:v", "mjpeg",
            "-f", "mpjpeg",
            "-"
        ]

        self.logger.info(f"Starting preview stream: {shlex.join(cmd)}")
        
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL
        )

        try:
            while True:
                # Read chunks from stdout
                data = await proc.stdout.read(4096)
                if not data:
                    break
                yield data
        except Exception as e:
            self.logger.error(f"Preview stream error: {e}")
        finally:
            if proc.returncode is None:
                proc.terminate()
                await proc.wait()
