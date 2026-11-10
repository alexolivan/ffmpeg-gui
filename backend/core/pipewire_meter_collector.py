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
    Spawns low-rate (8 kHz) pw-record processes for audio nodes (sinks, sources, streams).
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

    @staticmethod
    def _is_audio_node(node: Dict[str, Any]) -> bool:
        """Determines if a PipeWire node is an audio sink, source, or stream that produces or consumes audio."""
        nid = node.get("id")
        if nid is None:
            return False
        name = str(node.get("name") or "").lower()
        if not name or "driver" in name or name in ("dummy-driver", "freewheel-driver"):
            return False
        state = str(node.get("state") or "").lower()
        if state == "error":
            return False
        media_class = str(node.get("media_class") or "").lower()
        if any(mc in media_class for mc in ("audio/sink", "audio/source", "stream/output/audio", "stream/input/audio", "audio")):
            return True
        if any(k in name for k in ("aes", "rtp", "sink", "source", "ffmpeg", "remote", "kiosk", "desktop", "alsa")):
            return True
        return False

    async def sync_active_nodes(self, graph_telemetry: Optional[dict] = None) -> None:
        """
        Reconciles capture sessions against eligible audio nodes present in the graph.
        Stops capture for removed nodes.
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

        eligible_nodes: Dict[int, Dict[str, Any]] = {}
        for node in nodes:
            if self._is_audio_node(node):
                nid_int = int(node["id"])
                eligible_nodes[nid_int] = node

        # 1. Stop capture for nodes that are no longer eligible or disappeared
        current_monitored = list(self.tasks.keys())
        for nid in current_monitored:
            if nid not in eligible_nodes:
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

        # 2. Start capture for new eligible audio nodes
        pw_rec = self._get_pw_record_bin()
        if not pw_rec:
            return

        for nid, node_info in eligible_nodes.items():
            if nid not in self.tasks or self.tasks[nid].done():
                self.latest_levels[nid] = [0.0, 0.0]
                self.tasks[nid] = asyncio.create_task(self._monitor_node(node_info, pw_rec))

    def _process_pcm_data(self, node_id: int, data: bytes) -> None:
        if not data:
            return
        samples = array.array("h")
        even_len = len(data) - (len(data) % 2)
        samples.frombytes(data[:even_len])

        if len(samples) >= 2:
            l_samples = samples[0::2]
            r_samples = samples[1::2]
            peak_l = max(abs(s) for s in l_samples) / 32768.0 if l_samples else 0.0
            peak_r = max(abs(s) for s in r_samples) / 32768.0 if r_samples else 0.0
            self.latest_levels[node_id] = [round(peak_l, 3), round(peak_r, 3)]
        elif len(samples) == 1:
            val = abs(samples[0]) / 32768.0
            self.latest_levels[node_id] = [round(val, 3), round(val, 3)]
        else:
            self.latest_levels[node_id] = [0.0, 0.0]

    async def _monitor_node(self, node: Dict[str, Any], pw_record_bin: str) -> None:
        """Runs a continuous raw PCM stream capture with pw-record and computes peaks."""
        node_id = int(node["id"])
        node_name = str(node.get("name") or node_id)
        media_class = str(node.get("media_class") or "").lower()
        is_sink = "sink" in media_class

        sub_env = self._resolve_sub_env()

        # Build prioritized target candidates for resilient attachment
        targets: List[Tuple[bool, str]] = []
        if is_sink:
            targets.append((True, node_name))
            targets.append((False, f"{node_name}.monitor"))
            targets.append((True, str(node_id)))
        else:
            targets.append((False, node_name))
            targets.append((False, str(node_id)))

        proc: Optional[asyncio.subprocess.Process] = None
        chunk_size = 3200  # 100ms chunks (8000 frames/s * 2 ch * 2 bytes = 3200 bytes per 100ms)

        try:
            for use_sink_prop, target_val in targets:
                cmd = [pw_record_bin, "-R", "pipewire-0"]
                if use_sink_prop:
                    cmd.extend(["-P", "{ stream.capture.sink = true }"])
                cmd.extend([
                    "--target", target_val,
                    "--rate", "8000",
                    "--channels", "2",
                    "--format", "s16",
                    "--latency", "100ms",
                    "--raw",
                    "-"
                ])

                try:
                    p = await asyncio.create_subprocess_exec(
                        *cmd,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                        env=sub_env
                    )
                    # Check if process dies immediately (target resolution error)
                    try:
                        first_data = await asyncio.wait_for(p.stdout.read(chunk_size), timeout=0.3)
                        if not first_data and p.returncode is not None:
                            err_out = await p.stderr.read()
                            logger.debug(
                                f"[PipeWireMeters #{self.hub_id}] Target '{target_val}' failed for node #{node_id}: "
                                f"{err_out.decode('utf-8', errors='replace').strip()}"
                            )
                            continue
                        # Successfully linked and receiving data
                        proc = p
                        self.procs[node_id] = proc
                        self._process_pcm_data(node_id, first_data)
                        break
                    except asyncio.TimeoutError:
                        # Process running and waiting for audio buffers
                        if p.returncode is None:
                            proc = p
                            self.procs[node_id] = proc
                            break
                        continue
                except Exception as ex:
                    logger.debug(f"[PipeWireMeters #{self.hub_id}] Failed candidate target '{target_val}': {ex}")
                    continue

            if not proc or proc.returncode is not None:
                logger.debug(f"[PipeWireMeters #{self.hub_id}] Could not attach monitor to node #{node_id} ({node_name})")
                return

            while True:
                data = await proc.stdout.read(chunk_size)
                if not data:
                    break
                self._process_pcm_data(node_id, data)

        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.debug(f"[PipeWireMeters #{self.hub_id}] Monitoring node #{node_id} ({node_name}) error: {e}")
        finally:
            if proc:
                try:
                    proc.terminate()
                    await asyncio.wait_for(proc.wait(), timeout=0.5)
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
