"""
PipeWire Matrix Supervisor
==========================
Dedicated, per-hub companion supervisor that actively reconciles and manages
dynamic audio patchbay connections (PipeWire links) for a PipeWire Hub service.

Key Features:
- 1:1 Lifecycle binding with the parent PipeWire Hub service process.
- Dynamic Hot-Piping: applies changes in real-time without restarting PipeWire.
- Reconciles sources (Desktops/Kiosks, FFmpeg playback) to virtual sinks.
- Reconciles sink monitors to consumers (FFmpeg recording/monitoring).
- Resilient: handles mute/buffering, track changes, and PipeWire daemon restarts.
- Zero spam: state transitions logged cleanly; quiet during steady state.
"""

import asyncio
import os
import re
import shlex
import logging
import psutil
from typing import Dict, List, Optional, Set, Tuple, Any

logger = logging.getLogger("PipeWireSupervisor")


class DesiredLink:
    """Represents a desired audio link between a source and a target port."""

    def __init__(
        self,
        source_id: str,
        target_id: str,
        source_ports: List[str],
        target_ports: List[str],
        link_type: str = "playback",
        description: str = "",
        source_entity_type: str = "service",
        source_entity_id: Optional[int] = None,
        target_entity_type: str = "service",
        target_entity_id: Optional[int] = None,
        source_aliases: Optional[List[str]] = None,
        target_aliases: Optional[List[str]] = None,
        client_name_aliases: Optional[List[str]] = None,
        source_label: Optional[str] = None,
        target_label: Optional[str] = None
    ):
        self.source_id = source_id
        self.target_id = target_id
        self.source_ports = source_ports
        self.target_ports = target_ports
        self.link_type = link_type  # 'playback' or 'monitor_capture'
        self.description = description
        self.source_entity_type = source_entity_type
        self.source_entity_id = source_entity_id
        self.target_entity_type = target_entity_type
        self.target_entity_id = target_entity_id
        self.source_aliases = source_aliases or client_name_aliases or []
        self.target_aliases = target_aliases or []
        self.source_label = source_label or source_id
        self.target_label = target_label or target_id
        # Maintain backward compatibility attribute
        self.client_name_aliases = self.source_aliases


class PipeWireMatrixSupervisor:
    """
    Supervises the PipeWire audio graph for a specific PipeWire Hub instance.
    Runs as an asynchronous background companion worker.
    """

    def __init__(self, hub_service_id: int, process_manager):
        self.hub_id = int(hub_service_id)
        self.pm = process_manager
        self.runtime_dir = f"/tmp/ffmpeg-gui/pipewire-{self.hub_id}"
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._trigger_event = asyncio.Event()
        self._matrix_status: Dict[str, Any] = {
            "hub_id": self.hub_id,
            "running": False,
            "desired_links_count": 0,
            "active_links_count": 0,
            "pending_links_count": 0,
            "routes": []
        }
        self._logged_established: Set[Tuple[str, str]] = set()
        self._missing_node_counts: Dict[int, int] = {}
        self._last_reconnect_attempt: Dict[int, float] = {}

    async def start(self):
        """Starts the supervisor background task."""
        if self._running:
            return
        self._running = True
        self._matrix_status["running"] = True
        self._trigger_event.clear()
        self._task = asyncio.create_task(self._run_loop())
        logger.info(f"[PipeWireSupervisor #{self.hub_id}] Started companion matrix supervisor.")

    async def stop(self):
        """Stops the supervisor background task cleanly."""
        if not self._running:
            return
        self._running = False
        self._trigger_event.set()
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            except Exception as e:
                logger.debug(f"[PipeWireSupervisor #{self.hub_id}] Stop notice: {e}")
        self._task = None
        self._matrix_status["running"] = False
        logger.info(f"[PipeWireSupervisor #{self.hub_id}] Stopped companion matrix supervisor.")

    def trigger_reconcile(self):
        """Notifies the supervisor to immediately reconcile connections (e.g. after config change)."""
        self._trigger_event.set()

    def get_matrix_status(self) -> Dict[str, Any]:
        """Returns real-time status of desired and active matrix routes."""
        return dict(self._matrix_status)

    async def _run_loop(self):
        """Main supervision loop."""
        self._matrix_status["running"] = True
        while self._running:
            try:
                await self.reconcile()
            except Exception as e:
                logger.warning(f"[PipeWireSupervisor #{self.hub_id}] Reconcile loop error: {e}")

            try:
                # Sleep up to 1.5 seconds, or wake up instantly on trigger_reconcile
                await asyncio.wait_for(self._trigger_event.wait(), timeout=1.5)
            except asyncio.TimeoutError:
                pass
            finally:
                self._trigger_event.clear()

    def _resolve_desired_links(self) -> List[DesiredLink]:
        """
        Queries the database for all declared sources and consumers configured
        to route audio through this PipeWire Hub.
        """
        desired: List[DesiredLink] = []
        if not self.pm or not getattr(self.pm, "db_session_factory", None):
            return desired

        try:
            with self.pm.db_session_factory() as session:
                from database.models import Service, ScheduledTask, TaskExecution

                # 1. Fetch Hub definition to discover declared virtual sinks
                hub_svc = session.get(Service, self.hub_id) if hasattr(session, "get") else session.query(Service).get(self.hub_id)
                if not hub_svc:
                    return desired

                h_cfg = hub_svc.config or {}
                pw_cfg = h_cfg.get("pipewire_config", h_cfg)
                sinks = pw_cfg.get("virtual_sinks", [])
                sink_name_map: Dict[str, str] = {s.get("id"): (s.get("name") or s.get("id")) for s in sinks if s.get("id")}
                valid_sink_ids = {s.get("id") for s in sinks if s.get("id")}
                if not valid_sink_ids:
                    valid_sink_ids.add("master_bus")
                    sink_name_map["master_bus"] = "Master Bus"

                default_sink = next(iter(valid_sink_ids), "master_bus")

                # Detect if this is the only PipeWire Hub in DB for implicit binding fallback
                all_hubs = session.query(Service).filter(Service.service_type == "pipewire_hub").all()
                is_single_hub = (len(all_hubs) == 1 and all_hubs[0].id == self.hub_id)

                # 2. Virtual Desktops & Kiosks routing to this Hub
                desktops = session.query(Service).filter(Service.service_type == "desktop").all()
                pw_desktops: Dict[int, str] = {}
                for desk in desktops:
                    d_cfg = (desk.config or {}).get("desktop_config", desk.config or {})
                    if d_cfg.get("audio_backend") == "pipewire_hub":
                        pw_id = d_cfg.get("pipewire_service_id")
                        if (pw_id and int(pw_id) == self.hub_id) or (not pw_id and is_single_hub):
                            target_sink = d_cfg.get("pipewire_sink_id") or default_sink
                            pw_desktops[desk.id] = target_sink

                # Match active kiosks pointing to these desktops
                if pw_desktops:
                    kiosks = session.query(Service).filter(Service.service_type == "kiosk_browser").all()
                    for kiosk in kiosks:
                        k_cfg = (kiosk.config or {}).get("kiosk_config", kiosk.config or {})
                        desk_id = k_cfg.get("target_desktop_service_id") or k_cfg.get("desktop_service_id")
                        if desk_id and int(desk_id) in pw_desktops:
                            target_sink = pw_desktops[int(desk_id)]
                            source_node = f"kiosk_{kiosk.id}"
                            is_active = (
                                (kiosk.id in getattr(self.pm, "processes", {}))
                                or (kiosk.id in getattr(self.pm, "reattached_pids", {}))
                                or (kiosk.status == "running")
                            )
                            if is_active:
                                kiosk_label = kiosk.alias or kiosk.name or f"Kiosk #{kiosk.id}"
                                target_sink_label = sink_name_map.get(target_sink, target_sink)
                                description = f"{kiosk_label} → {target_sink_label}"
                                desired.append(
                                    DesiredLink(
                                        source_id=source_node,
                                        target_id=target_sink,
                                        source_ports=[f"{source_node}:output_FL", f"{source_node}:output_FR"],
                                        target_ports=[f"{target_sink}:playback_FL", f"{target_sink}:playback_FR"],
                                        link_type="playback",
                                        description=description,
                                        source_entity_type="kiosk",
                                        source_entity_id=kiosk.id,
                                        target_entity_type="sink",
                                        source_label=kiosk_label,
                                        target_label=target_sink_label,
                                        source_aliases=["Chromium", "Firefox", "chrome", "firefox", "cubeb"]
                                    )
                                )

                # 3. FFmpeg Services (Input from PipeWire monitor or Output to PipeWire sink)
                ffmpeg_services = session.query(Service).filter(
                    Service.service_type.in_(["ffmpeg_stream", "stream", "service"])
                ).all()

                for svc in ffmpeg_services:
                    is_active = (
                        (svc.id in getattr(self.pm, "processes", {}))
                        or (svc.id in getattr(self.pm, "reattached_pids", {}))
                        or (svc.status == "running")
                    )
                    if not is_active:
                        continue
                    cfg = svc.config or {}
                    inp_cfg = cfg.get("input_config", {})
                    out_cfg = cfg.get("output_config", {})
                    svc_label = svc.alias or svc.name or f"FFmpeg Service #{svc.id}"

                    # A. Ingest from PipeWire (FFmpeg captures from sink.monitor)
                    check_inputs = [inp_cfg]
                    if isinstance(inp_cfg, dict):
                        if "input1" in inp_cfg:
                            check_inputs.append(inp_cfg.get("input1"))
                        if "input2" in inp_cfg:
                            check_inputs.append(inp_cfg.get("input2"))

                    for inp in check_inputs:
                        if isinstance(inp, dict) and inp.get("type") in ("pipewire", "pipewire_hub"):
                            cand_id = inp.get("provider_service_id") or inp.get("pipewire_service_id")
                            if (cand_id and int(cand_id) == self.hub_id) or (not cand_id and is_single_hub):
                                sink_id = inp.get("sink_id") or inp.get("device") or default_sink
                                clean_sink = sink_id.replace(".monitor", "")
                                consumer_node = f"ffmpeg_service_{svc.id}"
                                sink_label = sink_name_map.get(clean_sink, clean_sink)
                                description = f"{sink_label}.monitor → {svc_label}"
                                desired.append(
                                    DesiredLink(
                                        source_id=f"{clean_sink}.monitor",
                                        target_id=consumer_node,
                                        source_ports=[f"{clean_sink}:monitor_FL", f"{clean_sink}:monitor_FR"],
                                        target_ports=[f"{consumer_node}:input_FL", f"{consumer_node}:input_FR"],
                                        link_type="monitor_capture",
                                        description=description,
                                        source_entity_type="sink",
                                        target_entity_type="service",
                                        target_entity_id=svc.id,
                                        source_label=f"{sink_label}.monitor",
                                        target_label=svc_label,
                                        target_aliases=[f"ffmpeg_service_{svc.id}", f"ffmpeg_proc_{svc.id}", f"ffmpeg_{svc.id}", svc.name, "ffmpeg"]
                                    )
                                )

                    # B. Publish to PipeWire (FFmpeg outputs sound to virtual sink)
                    if isinstance(out_cfg, dict) and out_cfg.get("type") in ("pipewire", "pipewire_hub"):
                        cand_id = out_cfg.get("provider_service_id") or out_cfg.get("pipewire_service_id")
                        if (cand_id and int(cand_id) == self.hub_id) or (not cand_id and is_single_hub):
                            sink_id = out_cfg.get("sink_id") or out_cfg.get("device") or default_sink
                            clean_sink = sink_id.replace(".monitor", "")
                            producer_node = f"ffmpeg_service_{svc.id}"
                            sink_label = sink_name_map.get(clean_sink, clean_sink)
                            description = f"{svc_label} → {sink_label}"
                            desired.append(
                                DesiredLink(
                                    source_id=producer_node,
                                    target_id=clean_sink,
                                    source_ports=[f"{producer_node}:output_FL", f"{producer_node}:output_FR"],
                                    target_ports=[f"{clean_sink}:playback_FL", f"{clean_sink}:playback_FR"],
                                    link_type="playback",
                                    description=description,
                                    source_entity_type="service",
                                    source_entity_id=svc.id,
                                    target_entity_type="sink",
                                    source_label=svc_label,
                                    target_label=sink_label,
                                    source_aliases=[f"ffmpeg_service_{svc.id}", f"ffmpeg_proc_{svc.id}", f"ffmpeg_{svc.id}", svc.name, "ffmpeg"]
                                )
                            )

                # 4. FFmpeg Tasks (Ingest from PipeWire or Publish to PipeWire)
                running_execs = session.query(TaskExecution).filter(TaskExecution.status == "running").all()
                for exec_item in running_execs:
                    task = exec_item.task or session.get(ScheduledTask, exec_item.task_id)
                    if not task:
                        continue
                    inp_cfg = task.input_config or {}
                    task_label = task.alias or task.name or f"FFmpeg Task #{task.id}"
                    check_task_inputs = [inp_cfg]
                    if isinstance(inp_cfg, dict):
                        if "input1" in inp_cfg:
                            check_task_inputs.append(inp_cfg.get("input1"))
                        if "input2" in inp_cfg:
                            check_task_inputs.append(inp_cfg.get("input2"))

                    for inp in check_task_inputs:
                        if isinstance(inp, dict) and inp.get("type") in ("pipewire", "pipewire_hub"):
                            cand_id = inp.get("provider_service_id") or inp.get("pipewire_service_id")
                            if (cand_id and int(cand_id) == self.hub_id) or (not cand_id and is_single_hub):
                                sink_id = inp.get("sink_id") or inp.get("device") or default_sink
                                clean_sink = sink_id.replace(".monitor", "")
                                consumer_node = f"ffmpeg_task_{task.id}"
                                sink_label = sink_name_map.get(clean_sink, clean_sink)
                                description = f"{sink_label}.monitor → {task_label}"
                                desired.append(
                                    DesiredLink(
                                        source_id=f"{clean_sink}.monitor",
                                        target_id=consumer_node,
                                        source_ports=[f"{clean_sink}:monitor_FL", f"{clean_sink}:monitor_FR"],
                                        target_ports=[f"{consumer_node}:input_FL", f"{consumer_node}:input_FR"],
                                        link_type="monitor_capture",
                                        description=description,
                                        source_entity_type="sink",
                                        target_entity_type="task",
                                        target_entity_id=task.id,
                                        source_label=f"{sink_label}.monitor",
                                        target_label=task_label,
                                        target_aliases=[f"ffmpeg_task_{task.id}", f"ffmpeg_proc_{task.id}", f"ffmpeg_{task.id}", f"ffmpeg_task_{exec_item.id}", "ffmpeg"]
                                    )
                                )

                    out_task_cfg = task.output_config or {}
                    if isinstance(out_task_cfg, dict) and out_task_cfg.get("type") in ("pipewire", "pipewire_hub"):
                        cand_id = out_task_cfg.get("provider_service_id") or out_task_cfg.get("pipewire_service_id")
                        if (cand_id and int(cand_id) == self.hub_id) or (not cand_id and is_single_hub):
                            sink_id = out_task_cfg.get("sink_id") or out_task_cfg.get("device") or default_sink
                            clean_sink = sink_id.replace(".monitor", "")
                            producer_node = f"ffmpeg_task_{task.id}"
                            sink_label = sink_name_map.get(clean_sink, clean_sink)
                            description = f"{task_label} → {sink_label}"
                            desired.append(
                                DesiredLink(
                                    source_id=producer_node,
                                    target_id=clean_sink,
                                    source_ports=[f"{producer_node}:output_FL", f"{producer_node}:output_FR"],
                                    target_ports=[f"{clean_sink}:playback_FL", f"{clean_sink}:playback_FR"],
                                    link_type="playback",
                                    description=description,
                                    source_entity_type="task",
                                    source_entity_id=task.id,
                                    target_entity_type="sink",
                                    source_label=task_label,
                                    target_label=sink_label,
                                    source_aliases=[f"ffmpeg_task_{task.id}", f"ffmpeg_proc_{task.id}", f"ffmpeg_{task.id}", f"ffmpeg_task_{exec_item.id}", "ffmpeg"]
                                )
                            )

        except Exception as e:
            logger.warning(f"[PipeWireSupervisor #{self.hub_id}] Error resolving desired links: {e}")

        return desired

    async def reconcile(self):
        """
        Polls PipeWire graph state via pw-link, compares against desired links,
        and establishes missing connections atomically.
        """
        pulse_sock = os.path.join(self.runtime_dir, "pulse.sock")
        if not os.path.exists(pulse_sock):
            # Hub socket is not yet ready or daemon is restarting
            return

        pw_link_bin, install_dir = self.pm._get_pipewire_tool_binary(self.hub_id, "pw-link")
        if not pw_link_bin:
            logger.warning(f"[PipeWireSupervisor #{self.hub_id}] pw-link CLI binary not available.")
            return

        sub_env = {
            **os.environ,
            "PIPEWIRE_RUNTIME_DIR": self.runtime_dir,
            "PIPEWIRE_REMOTE": "pipewire-0",
            "XDG_RUNTIME_DIR": self.runtime_dir,
            "PULSE_RUNTIME_PATH": self.runtime_dir,
        }
        if install_dir and os.path.isdir(install_dir):
            lib_dir = os.path.join(install_dir, "lib")
            existing_ld = sub_env.get("LD_LIBRARY_PATH", "")
            sub_env["LD_LIBRARY_PATH"] = f"{lib_dir}:{existing_ld}".rstrip(":")

        # 1. Query current links (-l), output ports (-o), and input ports (-i)
        try:
            proc_l = await asyncio.create_subprocess_exec(
                pw_link_bin, "-l",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=sub_env
            )
            stdout_l, _ = await asyncio.wait_for(proc_l.communicate(), timeout=2.0)
            lines_l = stdout_l.decode("utf-8", errors="replace").splitlines() if stdout_l else []
        except Exception as err:
            logger.debug(f"[PipeWireSupervisor #{self.hub_id}] Error querying pw-link -l: {err}")
            return

        active_links: Set[Tuple[str, str]] = set()
        available_ports: Set[str] = set()

        current_target = None
        for line in lines_l:
            raw = line.rstrip()
            if not raw:
                continue
            if line.startswith(" ") or line.startswith("\t"):
                cleaned = line.strip()
                if cleaned.startswith("|<-") or cleaned.startswith("<-"):
                    src = cleaned.replace("|<-", "").replace("<-", "").strip()
                    if current_target and src:
                        active_links.add((src, current_target))
                elif cleaned.startswith("|->") or cleaned.startswith("->"):
                    dst = cleaned.replace("|->", "").replace("->", "").strip()
                    if current_target and dst:
                        active_links.add((current_target, dst))
            else:
                current_target = raw.strip()
                if current_target:
                    available_ports.add(current_target)

        # 2. Query -o (outputs) and -i (inputs)
        available_output_ports: Set[str] = set()
        available_input_ports: Set[str] = set()

        try:
            proc_o = await asyncio.create_subprocess_exec(
                pw_link_bin, "-o",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=sub_env
            )
            stdout_o, _ = await asyncio.wait_for(proc_o.communicate(), timeout=2.0)
            if stdout_o:
                for line in stdout_o.decode("utf-8", errors="replace").splitlines():
                    p = line.strip()
                    if p:
                        available_output_ports.add(p)
        except Exception:
            pass

        try:
            proc_i = await asyncio.create_subprocess_exec(
                pw_link_bin, "-i",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=sub_env
            )
            stdout_i, _ = await asyncio.wait_for(proc_i.communicate(), timeout=2.0)
            if stdout_i:
                for line in stdout_i.decode("utf-8", errors="replace").splitlines():
                    p = line.strip()
                    if p:
                        available_input_ports.add(p)
        except Exception:
            pass

        # 3. Resolve desired matrix
        desired_links = self._resolve_desired_links()

        routes_telemetry: List[Dict[str, Any]] = []
        active_count = 0
        pending_count = 0

        for dl in desired_links:
            resolved_src_ports = self._match_ports(
                candidate_node=dl.source_id,
                desired_ports=dl.source_ports,
                aliases=dl.source_aliases,
                available_ports=available_output_ports
            )
            resolved_dst_ports = self._match_ports(
                candidate_node=dl.target_id,
                desired_ports=dl.target_ports,
                aliases=dl.target_aliases,
                available_ports=available_input_ports
            )

            # Determine route readiness
            src_ready = bool(resolved_src_ports) and (len(resolved_src_ports) == len(dl.source_ports))
            dst_ready = bool(resolved_dst_ports) and (len(resolved_dst_ports) == len(dl.target_ports))

            pairs_to_link: List[Tuple[str, str]] = []
            is_fully_linked = True

            if src_ready and dst_ready:
                for s_port, d_port in zip(resolved_src_ports, resolved_dst_ports):
                    if (s_port, d_port) not in active_links:
                        is_fully_linked = False
                        pairs_to_link.append((s_port, d_port))
            else:
                is_fully_linked = False

            # Establish missing links immediately
            if pairs_to_link:
                for s_port, d_port in pairs_to_link:
                    try:
                        res = await asyncio.create_subprocess_exec(
                            pw_link_bin, s_port, d_port,
                            stdout=asyncio.subprocess.PIPE,
                            stderr=asyncio.subprocess.PIPE,
                            env=sub_env
                        )
                        await asyncio.wait_for(res.communicate(), timeout=1.0)
                        active_links.add((s_port, d_port))
                        if (s_port, d_port) not in self._logged_established:
                            self._logged_established.add((s_port, d_port))
                            logger.info(
                                f"[PipeWireSupervisor #{self.hub_id}] Linked audio route: {s_port} -> {d_port} ({dl.description})"
                            )
                    except Exception as link_err:
                        logger.warning(
                            f"[PipeWireSupervisor #{self.hub_id}] Failed linking {s_port} -> {d_port}: {link_err}"
                        )

            # Re-evaluate status after linking attempt
            all_linked = (
                src_ready
                and dst_ready
                and all((sp, dp) in active_links for sp, dp in zip(resolved_src_ports, resolved_dst_ports))
            )
            if all_linked:
                status_str = "linked"
                active_count += 1
            elif not src_ready:
                status_str = "pending_source"  # Audio source is muted, buffering, or not started
                pending_count += 1
            elif not dst_ready:
                status_str = "pending_target"
                pending_count += 1
            else:
                status_str = "linking"
                pending_count += 1

            routes_telemetry.append({
                "source": dl.source_id,
                "source_label": dl.source_label or dl.source_id,
                "target": dl.target_id,
                "target_label": dl.target_label or dl.target_id,
                "description": dl.description,
                "type": dl.link_type,
                "status": status_str,
                "source_ports": resolved_src_ports if src_ready else dl.source_ports,
                "target_ports": resolved_dst_ports if dst_ready else dl.target_ports,
                "source_entity_type": dl.source_entity_type,
                "source_entity_id": dl.source_entity_id,
                "target_entity_type": dl.target_entity_type,
                "target_entity_id": dl.target_entity_id,
            })

            # Watchdog for running FFmpeg services: if alive in OS but missing from PipeWire graph
            if dl.target_entity_type == "service" and dl.target_entity_id:
                if dst_ready:
                    self._missing_node_counts.pop(dl.target_entity_id, None)
                else:
                    self._check_and_trigger_ffmpeg_reconnect(dl.target_entity_id, "consumer")
            elif dl.source_entity_type == "service" and dl.source_entity_id:
                if src_ready:
                    self._missing_node_counts.pop(dl.source_entity_id, None)
                else:
                    self._check_and_trigger_ffmpeg_reconnect(dl.source_entity_id, "producer")

        self._matrix_status.update({
            "hub_id": self.hub_id,
            "running": True,
            "desired_links_count": len(desired_links),
            "active_links_count": active_count,
            "pending_links_count": pending_count,
            "routes": routes_telemetry
        })

    def _check_and_trigger_ffmpeg_reconnect(self, svc_id: int, role: str):
        """
        Detects if a running FFmpeg service is missing its PipeWire audio port/node
        (e.g. after a PipeWire restart or severed Pulse socket) and triggers reconnect.
        """
        if not self.pm:
            return
        target_pid = getattr(self.pm, "reattached_pids", {}).get(svc_id)
        proc = getattr(self.pm, "processes", {}).get(svc_id)
        is_alive = (proc is not None and getattr(proc, "returncode", None) is None) or (bool(target_pid) and psutil.pid_exists(target_pid))
        if not is_alive:
            self._missing_node_counts.pop(svc_id, None)
            return

        count = self._missing_node_counts.get(svc_id, 0) + 1
        self._missing_node_counts[svc_id] = count

        try:
            loop = asyncio.get_running_loop()
            now_t = loop.time()
        except RuntimeError:
            now_t = 0.0

        last_t = self._last_reconnect_attempt.get(svc_id, 0.0)

        # After >= 4 consecutive ticks (~6 seconds) and >= 30 seconds cooldown
        if count >= 4 and (now_t - last_t > 30.0):
            self._last_reconnect_attempt[svc_id] = now_t
            self._missing_node_counts[svc_id] = 0
            logger.info(
                f"[PipeWireSupervisor #{self.hub_id}] Active FFmpeg {role} service #{svc_id} missing "
                f"from PipeWire graph after {count * 1.5:.1f}s. Requesting reconnection restart..."
            )
            if hasattr(self.pm, "restart_process"):
                asyncio.create_task(self.pm.restart_process(svc_id))

    @staticmethod
    def _match_ports(
        candidate_node: str,
        desired_ports: List[str],
        aliases: List[str],
        available_ports: Set[str]
    ) -> List[str]:
        """
        Resolves physical PipeWire port names for a desired node and port list.
        Supports:
        1. Exact port name matches (e.g. kiosk_13:output_FL).
        2. Known client aliases (e.g. Chromium:output_FL, Firefox:output_FL).
        3. Flexible channel-aware matching (e.g. matching Left/Right or 0/1 ports).
        """
        # 1. Exact match
        if desired_ports and all(p in available_ports for p in desired_ports):
            return desired_ports

        # 2. Match with aliases preserving port suffix
        for alias in aliases:
            if not alias:
                continue
            cand_ports = []
            for p in desired_ports:
                suffix = p.split(":", 1)[1] if ":" in p else p
                cand_ports.append(f"{alias}:{suffix}")
            if all(cp in available_ports for cp in cand_ports):
                return cand_ports

        # 3. Flexible channel-aware matching
        clean_cand = candidate_node.replace(".monitor", "")
        all_names = [clean_cand] + [a for a in aliases if a]
        lower_names = {n.lower() for n in all_names}

        # Filter available ports belonging to candidate nodes
        matched_node_ports: List[str] = []
        for p in available_ports:
            p_node = p.split(":", 1)[0] if ":" in p else p
            if p_node.lower() in lower_names:
                matched_node_ports.append(p)

        if not matched_node_ports:
            return []

        # If 1 port expected (mono)
        if len(desired_ports) == 1:
            return [matched_node_ports[0]]

        # If stereo (2 ports expected: FL / FR)
        ch0_tokens = ("_fl", "_l", "output_0", "input_0", "playback_fl", "monitor_fl", ":output_0", ":output_fl", ":input_fl")
        ch1_tokens = ("_fr", "_r", "output_1", "input_1", "output_2", "input_2", "playback_fr", "monitor_fr", ":output_1", ":output_fr", ":input_fr")

        ch0_candidates = [
            p for p in matched_node_ports
            if any(tok in p.lower() for tok in ch0_tokens)
        ]
        ch1_candidates = [
            p for p in matched_node_ports
            if any(tok in p.lower() for tok in ch1_tokens)
        ]

        if ch0_candidates and ch1_candidates:
            p0 = ch0_candidates[0]
            # Avoid picking identical port for both channels
            p1_opts = [p for p in ch1_candidates if p != p0]
            if p1_opts:
                return [p0, p1_opts[0]]

        if len(matched_node_ports) >= len(desired_ports):
            return matched_node_ports[:len(desired_ports)]

        return []
