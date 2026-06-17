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
            name = proc.info['name']
            if name and 'ffmpeg' in name.lower():
                env = proc.environ()
                pid = proc.info['pid']
                
                gui_proc_id = env.get("FFMPEG_GUI_PROCESS_ID")
                gui_exec_id = env.get("FFMPEG_GUI_EXECUTION_ID")
                
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
