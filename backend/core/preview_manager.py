import asyncio
import os
import logging
import shlex

class PreviewManager:
    def __init__(self):
        self.logger = logging.getLogger("PreviewManager")

    async def get_mjpeg_stream(self, process_id: int, input_config: dict, is_running: bool, is_task: bool = False):
        if is_running:
            # Stream the generated JPEG thumbnail from disk
            from database.db import BASE_DIR
            prefix = "preview_task" if is_task else "preview"
            preview_path = os.path.join(BASE_DIR, "data", "previews", f"{prefix}_{process_id}.jpg")
            
            last_mtime = 0
            while True:
                if os.path.exists(preview_path):
                    try:
                        mtime = os.path.getmtime(preview_path)
                        # Only stream if modified or first frame
                        if mtime != last_mtime:
                            with open(preview_path, 'rb') as f:
                                img_data = f.read()
                            last_mtime = mtime
                            yield (
                                b'--ffmpeg\r\n'
                                b'Content-Type: image/jpeg\r\n'
                                b'Content-Length: ' + str(len(img_data)).encode() + b'\r\n\r\n'
                                + img_data + b'\r\n'
                            )
                    except Exception as e:
                        self.logger.error(f"Error reading preview file: {e}")
                await asyncio.sleep(1.0)
        else:
            # Fallback: Build a lightweight command to generate MJPEG from the source
            cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error"]
            
            # Resolve the active input config (support both legacy flat and new dual-input format)
            if 'input1' in input_config:
                active_input = input_config['input1']
            else:
                active_input = input_config

            input_type = active_input.get('type')
            if input_type == 'file':
                cmd += ["-re", "-i", active_input.get('path')]
            elif input_type == 'srt':
                cmd += ["-i", f"srt://{active_input.get('host')}:{active_input.get('port')}?mode={active_input.get('mode', 'listener')}"]
            elif input_type == 'udp':
                cmd += ["-i", f"udp://{active_input.get('host')}:{active_input.get('port')}"]
            elif input_type == 'lavfi_video':
                pattern = active_input.get('pattern', 'testsrc')
                size = active_input.get('size')
                rate = active_input.get('rate')
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
