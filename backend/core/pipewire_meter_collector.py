import array
import asyncio
import logging
import os
import shutil
import time
from typing import Any, Dict, List, Optional, Set, Tuple

logger = logging.getLogger("PipeWireMeterCollector")


class PipeWireMeterCollector:
    """
    On-demand lightweight audio peak level meter collector for active PipeWire Hub nodes.
    Only spawns low-rate (8 kHz) pw-record processes for nodes that are currently
    in state 'running' and have at least one active route/link.
    Automatically terminates capture processes when subscribers disconnect.
    """

    def __init__(self, hub_service_id: int, process_manager: Any):
        self.hub_id = int(hub_service_id)
        self.pm = process_manager
        self.tasks: Dict[int, asyncio.Task] = {}
        self.procs: Dict[int, asyncio.subprocess.Process] = {}
        self.latest_levels: Dict[int, List[float]] = {}
        self._last_sync_ts: float = 0.0
        self._running: bool = False

    def _resolve_sub_env(self) -> Dict[str, str]:
        runtime_dir = f"/tmp/ffmpeg-gui/pipewire-{self.hub_id}"
        sub_env = {
            **os.environ,
            "PIPEWIRE_RUNTIME_DIR": runtime_dir,
            "PIPEWIRE_REMOTE": "pipewire-0",
            "XDG_RUNTIME_DIR": runtime_dir,
            "PULSE_RUNTIME_PATH": runtime_dir,
            "PIPEWIRE_NO_DBUS": "1",
            "PIPEWIRE_NO_RT": "1",
            "DBUS_SESSION_BUS_ADDRESS": "none",
        }
        if hasattr(self.pm, "_get_pipewire_tool_binary"):
            _, install_dir = self.pm._get_pipewire_tool_binary(self.hub_id, "pw-record")
            if install_dir and os.path.isdir(install_dir):
                lib_dirs = [
                    os.path.join(install_dir, "lib"),
                    os.path.join(install_dir, "lib64"),
                    os.path.join(install_dir, "lib/x86_64-linux-gnu"),
                    os.path.join(install_dir, "lib/aarch64-linux-gnu"),
                ]
                valid_libs = [p for p in lib_dirs if os.path.isdir(p)]
                if valid_libs:
                    cur_ld = sub_env.get("LD_LIBRARY_PATH", "")
                    sub_env["LD_LIBRARY_PATH"] = ":".join(valid_libs + ([cur_ld] if cur_ld else []))
        return sub_env

    def _get_pw_record_bin(self) -> Optional[str]:
        if hasattr(self.pm, "_get_pipewire_tool_binary"):
            pw_bin, _ = self.pm._get_pipewire_tool_binary(self.hub_id, "pw-record")
            if pw_bin:
                return pw_bin
        return shutil.which("pw-record") or shutil.which("pw-cat")

    async def sync_active_nodes(self, graph_telemetry: Optional[dict] = None) -> None:
        """
        Reconciles capture sessions against nodes currently 'running' and linked.
        Stops capture for nodes that transitioned to idle/suspended or lost links.
        """
        now = time.time()
        self._last_sync_ts = now

        if graph_telemetry is None and hasattr(self.pm, "get_pipewire_telemetry"):
            try:
                graph_telemetry = await self.pm.get_pipewire_telemetry(self.hub_id)
            except Exception as e:
                logger.debug(f"[PipeWireMeters #{self.hub_id}] Error querying telemetry for sync: {e}")
                return

        if not graph_telemetry or not graph_telemetry.get("active"):
            await self.stop()
            return

        nodes = graph_telemetry.get("nodes", []) or []
        links = graph_telemetry.get("links", []) or []

        # Find nodes that are currently running AND have at least 1 link
        linked_node_ids: Set[int] = set()
        for link in links:
            out_id = link.get("output_node_id")
            in_id = link.get("input_node_id")
            if out_id is not None:
                linked_node_ids.add(int(out_id))
            if in_id is not None:
                linked_node_ids.add(int(in_id))

        active_running_ids: Set[int] = set()
        for node in nodes:
            nid = node.get("id")
            if nid is None:
                continue
            nid_int = int(nid)
            state = str(node.get("state", "")).lower()
            if state == "running" and nid_int in linked_node_ids:
                active_running_ids.add(nid_int)

        # 1. Stop capture for nodes that are no longer eligible
        current_monitored = list(self.tasks.keys())
        for nid in current_monitored:
            if nid not in active_running_ids:
                task = self.tasks.pop(nid, None)
                if task and not task.done():
                    task.cancel()
                proc = self.procs.pop(nid, None)
                if proc:
                    try:
                        proc.terminate()
                    except Exception:
                        pass
                self.latest_levels.pop(nid, None)

        # 2. Start capture for new eligible nodes
        pw_rec = self._get_pw_record_bin()
        if not pw_rec:
            return

        for nid in active_running_ids:
            if nid not in self.tasks or self.tasks[nid].done():
                self.latest_levels[nid] = [0.0, 0.0]
                self.tasks[nid] = asyncio.create_task(self._monitor_node(nid, pw_rec))

    async def _monitor_node(self, node_id: int, pw_record_bin: str) -> None:
        """Runs a continuous raw PCM stream capture with pw-record and computes peaks."""
        sub_env = self._resolve_sub_env()
        cmd = [
            pw_record_bin,
            "-R", "pipewire-0",
            "--target", str(node_id),
            "--rate", "8000",
            "--channels", "2",
            "--format", "s16",
            "--latency", "100ms",
            "--raw",
            "-"
        ]

        proc = None
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
                env=sub_env
            )
            self.procs[node_id] = proc

            # Read 100ms chunks (8000 frames/s * 2 ch * 2 bytes = 32000 bytes/s -> 3200 bytes per 100ms)
            chunk_size = 3200
            while True:
                data = await proc.stdout.read(chunk_size)
                if not data:
                    break

                # Parse signed 16-bit little-endian samples
                samples = array.array("h")
                # Truncate to even byte count if split frame
                even_len = len(data) - (len(data) % 2)
                samples.frombytes(data[:even_len])

                if len(samples) >= 2:
                    l_samples = samples[0::2]
                    r_samples = samples[1::2]
                    peak_l = max(abs(s) for s in l_samples) / 32768.0 if l_samples else 0.0
                    peak_r = max(abs(s) for s in r_samples) / 32768.0 if r_samples else 0.0
                    self.latest_levels[node_id] = [round(peak_l, 3), round(peak_r, 3)]
                else:
                    self.latest_levels[node_id] = [0.0, 0.0]

        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.debug(f"[PipeWireMeters #{self.hub_id}] Monitoring node #{node_id} error: {e}")
        finally:
            if proc:
                try:
                    proc.terminate()
                    await asyncio.wait_for(proc.wait(), timeout=1.0)
                except Exception:
                    try:
                        proc.kill()
                    except Exception:
                        pass
            self.procs.pop(node_id, None)
            self.latest_levels.pop(node_id, None)

    async def get_meters(self) -> Dict[str, List[float]]:
        """Returns map of {node_id_str: [peak_l, peak_r]}."""
        # Sync nodes periodically every 1.5 seconds
        if time.time() - self._last_sync_ts > 1.5:
            await self.sync_active_nodes()

        return {str(nid): levels for nid, levels in self.latest_levels.items()}

    async def stop(self) -> None:
        """Terminates all active node monitor processes and tasks cleanly."""
        for nid, task in list(self.tasks.items()):
            if not task.done():
                task.cancel()
        self.tasks.clear()

        for nid, proc in list(self.procs.items()):
            try:
                proc.terminate()
            except Exception:
                pass
        self.procs.clear()
        self.latest_levels.clear()
