import psutil
import signal
import logging

logger = logging.getLogger("ProcessCleanup")

def cleanup_rogue_processes(process_id: int = None, execution_id: int = None, active_pids = None):
    """
    Iterates over all running system processes and safely kills matching
    orphan or rogue ffmpeg processes started by ffmpeg-gui.
    """
    active_pids = active_pids or set()
    for proc in psutil.process_iter(['pid', 'name']):
        try:
            name = proc.info['name'] or ''
            # Check if it is a managed process binary
            is_candidate = any(target in name.lower() for target in ['ffmpeg', 'mediamtx', 'icecast', 'cog'])
            if is_candidate:
                pid = proc.info['pid']
                gui_proc_id = None
                gui_exec_id = None
                try:
                    env = proc.environ()
                    gui_proc_id = env.get("FFMPEG_GUI_PROCESS_ID")
                    gui_exec_id = env.get("FFMPEG_GUI_EXECUTION_ID")
                except Exception:
                    pass

                # Fallback: check command line arguments for mediamtx ephemeral file pattern
                if not gui_proc_id and not gui_exec_id:
                    try:
                        cmdline = " ".join(proc.cmdline())
                        import re
                        m_proc = re.search(r"ffmpeg_gui_mediamtx_(\d+)_", cmdline)
                        if m_proc:
                            gui_proc_id = m_proc.group(1)
                    except Exception:
                        pass

                if not gui_proc_id and not gui_exec_id:
                    continue
                
                should_kill = False
                reason = ""
                
                if process_id is not None and gui_proc_id == str(process_id):
                    should_kill = True
                    reason = f"matches target process_id {process_id}"
                elif execution_id is not None and gui_exec_id == str(execution_id):
                    should_kill = True
                    reason = f"matches target execution_id {execution_id}"
                elif process_id is None and execution_id is None:
                    if gui_proc_id and pid not in active_pids:
                        should_kill = True
                        reason = f"stale process (process_id={gui_proc_id}) not in active list"
                    elif gui_exec_id and pid not in active_pids:
                        should_kill = True
                        reason = f"stale execution (execution_id={gui_exec_id}) not in active list"
                
                if should_kill:
                    logger.warning(f"Terminating rogue ffmpeg process {pid} because: {reason}")
                    try:
                        proc.send_signal(signal.SIGKILL)
                      # Wait for the process to be terminated (zombie status)
                    except Exception as e:
                        logger.error(f"Failed to SIGKILL rogue process {pid}: {e}")
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue

def get_ffmpeg_version(binary_path: str = "ffmpeg") -> float:
    import subprocess
    import re
    try:
        res = subprocess.run([binary_path, "-version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=2)
        first_line = res.stdout.split('\n')[0]
        # Match pattern like "ffmpeg version 4.4" or "version 5.1-css"
        match = re.search(r'version\s+([0-9]+\.[0-9]+)', first_line)
        if match:
            return float(match.group(1))
    except Exception:
        pass
    return 4.4  # Default fallback

def prepare_process_file_permissions(process_id: int = None, execution_id: int = None, logger=None):
    """
    Ensures that temporary progress log files (/dev/shm/ffmpeg_progress_*.log, /tmp/ffmpeg_progress_*.log)
    and preview images (/tmp/ffmpeg-gui-previews/preview_*.jpg) are safely reset with 0o666 (world read/write)
    permissions before FFmpeg is executed. This prevents Permission Denied crashes when switching between systemd
    service (ffmpeg-gui user) and manual terminal commands (root).
    """
    import os
    preview_dir = "/tmp/ffmpeg-gui-previews"
    try:
        os.makedirs(preview_dir, mode=0o777, exist_ok=True)
        try:
            os.chmod(preview_dir, 0o777)
        except Exception:
            pass
    except Exception as e:
        if logger:
            logger.warning(f"Could not create preview dir {preview_dir}: {e}")

    target_files = []
    if process_id is not None:
        target_files.extend([
            f"/dev/shm/ffmpeg_progress_{process_id}s.log",
            f"/tmp/ffmpeg_progress_{process_id}s.log",
            f"/tmp/ffmpeg-gui-previews/preview_{process_id}.jpg",
        ])
    if execution_id is not None:
        target_files.extend([
            f"/dev/shm/ffmpeg_progress_{execution_id}t.log",
            f"/tmp/ffmpeg_progress_{execution_id}t.log",
            f"/tmp/ffmpeg-gui-previews/preview_task_{execution_id}.jpg",
        ])

    for path in target_files:
        try:
            if os.path.exists(path):
                os.remove(path)
        except Exception as err:
            if logger:
                logger.warning(f"Could not remove stale file {path}: {err}. Attempting truncate...")
            try:
                with open(path, "w") as f:
                    pass
            except Exception as trunc_err:
                if logger:
                    logger.error(f"Failed to truncate {path}: {trunc_err}")

        try:
            with open(path, "a") as f:
                pass
            os.chmod(path, 0o666)
        except Exception as chmod_err:
            if logger:
                logger.debug(f"Could not chmod 0666 on {path}: {chmod_err}")

