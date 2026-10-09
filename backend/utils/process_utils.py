import os
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
            is_candidate = any(target in name.lower() for target in ['ffmpeg', 'mediamtx', 'icecast', 'cog', 'xvfb', 'x11vnc'])
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

                # Fallback: check command line arguments for mediamtx ephemeral file or progress log pattern
                if not gui_proc_id and not gui_exec_id:
                    try:
                        cmdline = " ".join(proc.cmdline())
                        import re
                        m_proc = re.search(r"ffmpeg_gui_mediamtx_(\d+)_", cmdline)
                        if m_proc:
                            gui_proc_id = m_proc.group(1)
                        else:
                            m_s = re.search(r"ffmpeg_progress_(\d+)s\.log", cmdline)
                            if m_s:
                                gui_proc_id = m_s.group(1)
                            else:
                                m_t = re.search(r"ffmpeg_progress_(\d+)t\.log", cmdline)
                                if m_t:
                                    gui_exec_id = m_t.group(1)
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
                    proc_desc = name if name else "process"
                    logger.warning(f"Terminating rogue {proc_desc} process {pid} because: {reason}")
                    try:
                        proc.send_signal(signal.SIGKILL)
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
        # Match pattern like "ffmpeg version 7.1", "version n7.0.2", "version v6.1", "version 5.1-css"
        match = re.search(r'version\s+(?:v|n|git-)?([0-9]+(?:\.[0-9]+)?)', first_line, re.IGNORECASE)
        if match:
            return float(match.group(1))
        # Secondary fallback: search for major.minor anywhere in first line
        match_secondary = re.search(r'([0-9]+\.[0-9]+)', first_line)
        if match_secondary:
            return float(match_secondary.group(1))
        # If it's a git snapshot or trunk build (e.g. N-118000...), modern FFmpeg is guaranteed
        if "version" in first_line:
            return 7.0
    except Exception:
        pass
    return 7.0  # Default fallback for modern systems (FFmpeg 5.1+ uses -fps_mode)

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


def read_tail_progress(file_path: str, max_bytes: int = 4096) -> dict:
    """
    Reads only the tail (last max_bytes) of an ffmpeg -progress output file in O(1) time,
    parsing key-value status lines without reading or allocating the entire file in memory.
    """
    result = {
        "frame": None,
        "fps": None,
        "bitrate": None,
        "speed": None,
        "out_time": None,
        "out_time_us": None,
        "dup_frames": None,
        "drop_frames": None,
        "progress": None,
    }
    if not file_path or not os.path.exists(file_path):
        return result

    try:
        size = os.path.getsize(file_path)
        if size == 0:
            return result
        offset = max(0, size - max_bytes)
        with open(file_path, "rb") as f:
            if offset > 0:
                f.seek(offset)
            raw_data = f.read()

        text = raw_data.decode("utf-8", errors="replace")
        for line in text.splitlines():
            line = line.strip()
            if "=" in line:
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip()
                if k == "frame":
                    try:
                        result["frame"] = int(v)
                    except ValueError:
                        pass
                elif k == "fps":
                    result["fps"] = v
                elif k == "bitrate":
                    result["bitrate"] = v
                elif k == "speed":
                    result["speed"] = v
                elif k == "out_time":
                    result["out_time"] = v
                elif k == "out_time_us":
                    try:
                        result["out_time_us"] = int(v)
                    except ValueError:
                        pass
                elif k == "dup_frames":
                    try:
                        result["dup_frames"] = int(v)
                    except ValueError:
                        pass
                elif k == "drop_frames":
                    try:
                        result["drop_frames"] = int(v)
                    except ValueError:
                        pass
                elif k == "progress":
                    result["progress"] = v
    except Exception:
        pass

    return result


def truncate_progress_log_if_large(file_path: str, max_size_bytes: int = 2 * 1024 * 1024, keep_bytes: int = 32768):
    """
    If a progress log file exceeds max_size_bytes (default 2MB), truncates it keeping only the last keep_bytes
    to prevent disk space exhaustion in /dev/shm.
    """
    try:
        if not file_path or not os.path.exists(file_path):
            return
        size = os.path.getsize(file_path)
        if size > max_size_bytes:
            with open(file_path, "rb") as f:
                f.seek(size - keep_bytes)
                tail = f.read()
            with open(file_path, "wb") as f:
                f.write(tail)
    except Exception:
        pass


def cleanup_task_progress_files(execution_id: int):
    """Removes /dev/shm and /tmp progress files for completed task executions."""
    for p in [f"/dev/shm/ffmpeg_progress_{execution_id}t.log", f"/tmp/ffmpeg_progress_{execution_id}t.log"]:
        try:
            if os.path.exists(p):
                os.remove(p)
        except Exception:
            pass


