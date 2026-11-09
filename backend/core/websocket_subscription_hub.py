import asyncio
import json
import logging
import os
from typing import Any, Dict, List, Optional, Set, Tuple

logger = logging.getLogger("telemetry.subscriptions")


class WebSocketSubscriptionHub:
    """
    Manages on-demand bidirectional topic subscriptions for WebSocket clients.
    Eradicates client-side HTTP polling for logs, progress deltas, graph data, and locks.
    """

    def __init__(self):
        # topic -> {item_id: Set[WebSocket]}
        # item_id can be None for global topics like 'resource_locks'
        self._topics: Dict[str, Dict[Any, Set[Any]]] = {
            "process_logs": {},
            "sidecar_logs": {},
            "task_logs": {},
            "pipewire_graph": {},
            "resource_locks": {},
            "service_metrics_rrd": {},
        }
        # Reverse mapping: WebSocket -> Set[(topic, item_id)]
        self._client_subs: Dict[Any, Set[Tuple[str, Any]]] = {}
        # Client position tracking: (WebSocket, topic, item_id) -> last_seen_index/timestamp
        self._client_offsets: Dict[Tuple[Any, str, Any], int] = {}
        # Client options tracking: (WebSocket, topic, item_id) -> dict(range, metric, etc.)
        self._client_options: Dict[Tuple[Any, str, Any], Dict[str, Any]] = {}
        # Cache for diffing changes
        self._last_resource_locks: Optional[List[Any]] = None
        # PipeWire Graph subscription cache & rate limiting
        self._last_pipewire_graph_sig: Dict[int, str] = {}
        self._last_pipewire_poll_ts: Dict[int, float] = {}

    def invalidate_pipewire_graph(self, hub_id: int) -> None:
        """Forces immediate re-evaluation and broadcast on next cycle for hub_id."""
        target_id = int(hub_id) if (isinstance(hub_id, (int, str)) and str(hub_id).isdigit()) else hub_id
        if target_id is not None:
            self._last_pipewire_poll_ts[target_id] = 0.0

    @staticmethod
    def _compute_pipewire_graph_signature(graph: Any) -> str:
        """
        Computes a stable hash signature of the pipewire graph for change detection,
        ignoring volatile timestamps like 'last_seen'.
        """
        import hashlib
        def _strip_volatile(obj):
            if isinstance(obj, dict):
                return {k: _strip_volatile(v) for k, v in obj.items() if k not in ("last_seen", "timestamp")}
            elif isinstance(obj, list):
                return [_strip_volatile(item) for item in obj]
            return obj

        clean = _strip_volatile(graph)
        try:
            dumped = json.dumps(clean, sort_keys=True, default=str)
            return hashlib.md5(dumped.encode("utf-8")).hexdigest()
        except Exception:
            return ""

    def has_subscribers(self, topic: str, item_id: Any = None) -> bool:
        """Check if any client is currently subscribed to topic and item_id."""
        if topic not in self._topics:
            return False
        topic_map = self._topics[topic]
        if item_id not in topic_map:
            return False
        return len(topic_map[item_id]) > 0

    def unregister_client(self, ws: Any) -> None:
        """Purge all topic subscriptions and tracking state for a disconnected WebSocket."""
        if ws not in self._client_subs:
            return
        subs = list(self._client_subs[ws])
        for topic, item_id in subs:
            if topic in self._topics and item_id in self._topics[topic]:
                self._topics[topic][item_id].discard(ws)
                if not self._topics[topic][item_id]:
                    del self._topics[topic][item_id]
            offset_key = (ws, topic, item_id)
            if offset_key in self._client_offsets:
                del self._client_offsets[offset_key]
            self._client_options.pop(offset_key, None)

        # Cleanup pipewire caches for hubs that have no more subscribers
        for hub_id in list(self._last_pipewire_poll_ts.keys()):
            if not self.has_subscribers("pipewire_graph", hub_id):
                self._last_pipewire_graph_sig.pop(hub_id, None)
                self._last_pipewire_poll_ts.pop(hub_id, None)

        del self._client_subs[ws]
        logger.debug(f"Unregistered WebSocket client subscriptions: {len(subs)} topics cleared")

    async def handle_client_message(
        self,
        ws: Any,
        raw_msg: str,
        process_manager: Any = None,
        db_session_factory: Any = None
    ) -> None:
        """
        Parse and dispatch inbound JSON command frame from WebSocket client.
        Expected format:
          {"action": "subscribe"|"unsubscribe", "topic": str, "id": Optional[int]}
        """
        try:
            payload = json.loads(raw_msg)
        except Exception:
            return

        if not isinstance(payload, dict):
            return

        action = payload.get("action")
        topic = payload.get("topic")
        item_id = payload.get("id")

        if not action or not topic:
            return

        if action == "subscribe":
            await self._handle_subscribe(ws, topic, item_id, process_manager, db_session_factory, options=payload)
        elif action == "unsubscribe":
            self._handle_unsubscribe(ws, topic, item_id)

    async def _handle_subscribe(
        self,
        ws: Any,
        topic: str,
        item_id: Any,
        process_manager: Any,
        db_session_factory: Any,
        options: Optional[Dict[str, Any]] = None,
    ) -> None:
        if topic not in self._topics:
            self._topics[topic] = {}
        if item_id not in self._topics[topic]:
            self._topics[topic][item_id] = set()

        self._topics[topic][item_id].add(ws)

        if ws not in self._client_subs:
            self._client_subs[ws] = set()
        self._client_subs[ws].add((topic, item_id))

        if options:
            self._client_options[(ws, topic, item_id)] = options

        # Immediately send initial snapshot for the subscribed topic
        await self._send_initial_snapshot(ws, topic, item_id, process_manager, db_session_factory, options=options)

    def _handle_unsubscribe(self, ws: Any, topic: str, item_id: Any) -> None:
        if topic in self._topics and item_id in self._topics[topic]:
            self._topics[topic][item_id].discard(ws)
            if not self._topics[topic][item_id]:
                del self._topics[topic][item_id]

        if ws in self._client_subs:
            self._client_subs[ws].discard((topic, item_id))

        offset_key = (ws, topic, item_id)
        if offset_key in self._client_offsets:
            del self._client_offsets[offset_key]
        self._client_options.pop(offset_key, None)

        if topic == "pipewire_graph" and item_id is not None:
            target_id = int(item_id) if (isinstance(item_id, (int, str)) and str(item_id).isdigit()) else item_id
            if not self.has_subscribers("pipewire_graph", target_id):
                self._last_pipewire_graph_sig.pop(target_id, None)
                self._last_pipewire_poll_ts.pop(target_id, None)

    async def _send_initial_snapshot(
        self,
        ws: Any,
        topic: str,
        item_id: Any,
        process_manager: Any,
        db_session_factory: Any,
        options: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Send current state / logs upon subscription so client has immediate data."""
        try:
            if topic == "process_logs" and item_id is not None:
                lines = []
                target_id = int(item_id) if (isinstance(item_id, (int, str)) and str(item_id).isdigit()) else item_id
                if process_manager and hasattr(process_manager, "log_buffers"):
                    if target_id in process_manager.log_buffers:
                        lines = [
                            entry for entry in process_manager.log_buffers[target_id]
                            if "missing timeout" not in entry.get("message", "").lower()
                        ]

                # If no in-memory buffer, check if log file exists on disk
                if not lines and db_session_factory and process_manager:
                    try:
                        with db_session_factory() as session:
                            try:
                                from database.models import MediaProcess
                            except ImportError:
                                from backend.database.models import MediaProcess
                            proc = session.get(MediaProcess, target_id) if hasattr(session, "get") else session.query(MediaProcess).get(target_id)
                            if proc:
                                log_file = process_manager.get_process_log_path(
                                    target_id, proc.log_storage_id, session=session
                                )
                                if os.path.exists(log_file):
                                    f_size = os.path.getsize(log_file)
                                    with open(log_file, "rb") as f:
                                        if f_size > 65536:
                                            f.seek(f_size - 65536)
                                        chunk = f.read().decode("utf-8", errors="replace")
                                    raw_lines = [
                                        l.strip() for l in chunk.splitlines()
                                        if l.strip() and "missing timeout" not in l.lower()
                                    ][-100:]
                                    lines = [
                                        {"timestamp": "", "level": "INFO", "message": l}
                                        for l in raw_lines
                                    ]
                    except Exception as e:
                        logger.error(f"Error fetching initial log file for process {target_id}: {e}")

                self._client_offsets[(ws, topic, item_id)] = len(lines)
                await ws.send_json({
                    "type": "process_logs",
                    "id": item_id,
                    "lines": lines,
                    "reset": True
                })

            elif topic == "sidecar_logs" and item_id is not None:
                lines = []
                if process_manager and hasattr(process_manager, "sidecar_log_buffers"):
                    if item_id in process_manager.sidecar_log_buffers:
                        lines = list(process_manager.sidecar_log_buffers[item_id])

                # If no in-memory buffer, check if sidecar log file exists on disk
                if not lines and db_session_factory and process_manager and ":" in str(item_id):
                    try:
                        svc_part, sidecar_name = str(item_id).split(":", 1)
                        if svc_part.isdigit() and sidecar_name in ("ptp4l", "phc2sys"):
                            target_svc_id = int(svc_part)
                            with db_session_factory() as session:
                                try:
                                    from database.models import MediaProcess
                                except ImportError:
                                    from backend.database.models import MediaProcess
                                proc = session.get(MediaProcess, target_svc_id) if hasattr(session, "get") else session.query(MediaProcess).get(target_svc_id)
                                if proc:
                                    log_storage_id = (proc.config or {}).get("log_storage_id")
                                    logs_dir = process_manager.get_process_log_storage_path(
                                        process_id=target_svc_id, log_storage_id=log_storage_id, session=session
                                    )
                                    sidecar_log_file = os.path.join(logs_dir, f"{sidecar_name}_{target_svc_id}.log")
                                    if os.path.exists(sidecar_log_file):
                                        f_size = os.path.getsize(sidecar_log_file)
                                        with open(sidecar_log_file, "rb") as f:
                                            if f_size > 65536:
                                                f.seek(f_size - 65536)
                                            chunk = f.read().decode("utf-8", errors="replace")
                                        raw_lines = [l.strip() for l in chunk.splitlines() if l.strip()][-100:]
                                        lines = [
                                            {
                                                "timestamp": "",
                                                "level": "ERROR" if any(kw in l.lower() for kw in ["error", "failed", "invalid", "could not", "cannot", "fatal"]) else ("WARN" if "warn" in l.lower() else "INFO"),
                                                "message": l
                                            }
                                            for l in raw_lines
                                        ]
                    except Exception as e:
                        logger.error(f"Error fetching initial sidecar log file for {item_id}: {e}")

                self._client_offsets[(ws, topic, item_id)] = len(lines)
                await ws.send_json({
                    "type": "sidecar_logs",
                    "id": item_id,
                    "lines": lines,
                    "reset": True
                })

            elif topic == "task_logs" and item_id is not None and db_session_factory:
                lines = []
                try:
                    with db_session_factory() as session:
                        from backend.database.models import TaskExecutionLog
                        logs = (
                            session.query(TaskExecutionLog)
                            .filter(TaskExecutionLog.execution_id == int(item_id))
                            .order_by(TaskExecutionLog.id.asc())
                            .all()
                        )
                        lines = [
                            {
                                "id": l.id,
                                "timestamp": l.timestamp.isoformat(),
                                "level": l.level,
                                "message": l.message
                            } for l in logs
                        ]
                except Exception as e:
                    logger.error(f"Error fetching task logs for execution {item_id}: {e}")

                self._client_offsets[(ws, topic, item_id)] = len(lines)
                await ws.send_json({
                    "type": "task_logs",
                    "id": item_id,
                    "lines": lines,
                    "reset": True
                })

            elif topic == "resource_locks":
                locks = []
                try:
                    from backend.core.resource_lock_manager import resource_lock_manager
                    locks = resource_lock_manager.get_active_locks()
                except Exception:
                    pass
                await ws.send_json({
                    "type": "resource_locks",
                    "locks": locks
                })

            elif topic == "service_metrics_rrd" and item_id is not None:
                from core.rrd_store import volatile_rrd_store
                target_id = int(item_id) if (isinstance(item_id, (int, str)) and str(item_id).isdigit()) else item_id
                tracker = volatile_rrd_store.get(target_id)
                opts_dict = options if isinstance(options, dict) else {}
                if isinstance(opts_dict.get("options"), dict):
                    opts_dict = {**opts_dict, **opts_dict["options"]}
                range_val = str(opts_dict.get("range", "24h"))
                metric_val = str(opts_dict.get("metric", "bitrate"))

                if tracker:
                    series = tracker.get_series(metric=metric_val, range=range_val)
                else:
                    series = {
                        "metric": metric_val,
                        "range": range_val,
                        "service_id": target_id,
                        "timestamps": [],
                        "avg": [],
                        "min": [],
                        "max": [],
                        "anomaly_summary": {
                            "min_value": 0.0,
                            "min_timestamp": None,
                            "max_value": 0.0,
                            "max_timestamp": None,
                            "has_outliers": False,
                        },
                    }
                await ws.send_json({
                    "type": "service_metrics_rrd",
                    "id": target_id,
                    "data": series,
                })

            elif topic == "pipewire_graph" and item_id is not None and process_manager:
                target_id = int(item_id) if (isinstance(item_id, (int, str)) and str(item_id).isdigit()) else item_id
                graph_data = None
                if hasattr(process_manager, "get_pipewire_telemetry"):
                    try:
                        graph_data = await process_manager.get_pipewire_telemetry(target_id)
                    except Exception as e:
                        logger.debug(f"Error fetching initial pipewire graph for #{target_id}: {e}")

                if graph_data:
                    import time
                    sig = self._compute_pipewire_graph_signature(graph_data)
                    self._last_pipewire_graph_sig[target_id] = sig
                    self._last_pipewire_poll_ts[target_id] = time.time()
                    await ws.send_json({
                        "type": "pipewire_graph",
                        "id": target_id,
                        "graph": graph_data
                    })

            elif topic == "pipewire_meters" and item_id is not None:
                target_id = int(item_id) if (isinstance(item_id, (int, str)) and str(item_id).isdigit()) else item_id
                meters = {}
                if process_manager and hasattr(process_manager, "get_or_create_pipewire_meter_collector"):
                    collector = process_manager.get_or_create_pipewire_meter_collector(target_id)
                    if collector:
                        meters = await collector.get_meters()
                await ws.send_json({
                    "type": "pipewire_meters",
                    "id": target_id,
                    "meters": meters
                })

        except Exception as err:
            logger.debug(f"Failed to send initial snapshot for {topic}:{item_id}: {err}")

    async def broadcast_deltas(
        self,
        process_manager: Any = None,
        db_session_factory: Any = None
    ) -> None:
        """
        Periodically broadcast new log lines and state changes exclusively
        to clients subscribed to those specific entities.
        """
        # 1. Process log deltas
        if process_manager and hasattr(process_manager, "log_buffers"):
            active_proc_subs = self._topics.get("process_logs", {})
            for proc_id, subscribers in list(active_proc_subs.items()):
                if not subscribers:
                    continue
                target_id = int(proc_id) if (isinstance(proc_id, (int, str)) and str(proc_id).isdigit()) else proc_id
                buffer = process_manager.log_buffers.get(target_id)
                if not buffer:
                    continue

                all_lines = list(buffer)
                total_len = len(all_lines)

                dead_clients = []
                for ws in subscribers:
                    last_idx = self._client_offsets.get((ws, "process_logs", proc_id), 0)
                    if total_len > last_idx:
                        delta = all_lines[last_idx:total_len]
                        self._client_offsets[(ws, "process_logs", proc_id)] = total_len
                        try:
                            await ws.send_json({
                                "type": "process_logs",
                                "id": proc_id,
                                "lines": delta,
                                "reset": False
                            })
                        except Exception:
                            dead_clients.append(ws)

                for dead in dead_clients:
                    self.unregister_client(dead)

        # 1.5. Sidecar log deltas
        if process_manager and hasattr(process_manager, "sidecar_log_buffers"):
            active_sidecar_subs = self._topics.get("sidecar_logs", {})
            for sidecar_id, subscribers in list(active_sidecar_subs.items()):
                if not subscribers:
                    continue
                buffer = process_manager.sidecar_log_buffers.get(sidecar_id)
                if not buffer:
                    continue

                all_lines = list(buffer)
                total_len = len(all_lines)

                dead_clients = []
                for ws in subscribers:
                    last_idx = self._client_offsets.get((ws, "sidecar_logs", sidecar_id), 0)
                    if total_len > last_idx:
                        delta = all_lines[last_idx:total_len]
                        self._client_offsets[(ws, "sidecar_logs", sidecar_id)] = total_len
                        try:
                            await ws.send_json({
                                "type": "sidecar_logs",
                                "id": sidecar_id,
                                "lines": delta,
                                "reset": False
                            })
                        except Exception:
                            dead_clients.append(ws)

                for dead in dead_clients:
                    self.unregister_client(dead)

        # 2. Resource locks (if subscribed)
        lock_subs = self._topics.get("resource_locks", {}).get(None, set())
        if lock_subs:
            try:
                from backend.core.resource_lock_manager import resource_lock_manager
                current_locks = resource_lock_manager.get_active_locks()
                if current_locks != self._last_resource_locks:
                    self._last_resource_locks = current_locks
                    dead_clients = []
                    for ws in list(lock_subs):
                        try:
                            await ws.send_json({
                                "type": "resource_locks",
                                "locks": current_locks
                            })
                        except Exception:
                            dead_clients.append(ws)
                    for dead in dead_clients:
                        self.unregister_client(dead)
            except Exception:
                pass

        # 3. Service RRD metrics deltas (if subscribed)
        active_rrd_subs = self._topics.get("service_metrics_rrd", {})
        if active_rrd_subs:
            try:
                from core.rrd_store import volatile_rrd_store
                for s_id, subscribers in list(active_rrd_subs.items()):
                    if not subscribers:
                        continue
                    target_id = int(s_id) if (isinstance(s_id, (int, str)) and str(s_id).isdigit()) else s_id
                    tracker = volatile_rrd_store.get(target_id)
                    if not tracker:
                        continue

                    dead_clients = []
                    for ws in list(subscribers):
                        raw_opts = self._client_options.get((ws, "service_metrics_rrd", s_id), {})
                        opts_dict = raw_opts if isinstance(raw_opts, dict) else {}
                        if isinstance(opts_dict.get("options"), dict):
                            opts_dict = {**opts_dict, **opts_dict["options"]}
                        range_val = str(opts_dict.get("range", "24h"))
                        metric_val = str(opts_dict.get("metric", "bitrate"))
                        series = tracker.get_series(metric=metric_val, range=range_val)
                        try:
                            await ws.send_json({
                                "type": "service_metrics_rrd",
                                "id": target_id,
                                "data": series,
                            })
                        except Exception:
                            dead_clients.append(ws)

                    for dead in dead_clients:
                        self.unregister_client(dead)
            except Exception as e:
                logger.debug(f"Error broadcasting RRD deltas: {e}")

        # 4. PipeWire Graph deltas (if subscribed and throttled at 2.5s)
        active_pw_subs = self._topics.get("pipewire_graph", {})
        if active_pw_subs and process_manager and hasattr(process_manager, "get_pipewire_telemetry"):
            import time
            now = time.time()
            for s_id, subscribers in list(active_pw_subs.items()):
                if not subscribers:
                    continue
                target_id = int(s_id) if (isinstance(s_id, (int, str)) and str(s_id).isdigit()) else s_id
                last_poll = self._last_pipewire_poll_ts.get(target_id, 0.0)
                if now - last_poll < 2.5:
                    continue

                self._last_pipewire_poll_ts[target_id] = now
                try:
                    graph = await process_manager.get_pipewire_telemetry(target_id)
                except Exception as e:
                    logger.debug(f"Error polling pipewire telemetry for #{target_id}: {e}")
                    continue

                if not graph:
                    continue

                new_sig = self._compute_pipewire_graph_signature(graph)
                old_sig = self._last_pipewire_graph_sig.get(target_id)

                if new_sig != old_sig:
                    self._last_pipewire_graph_sig[target_id] = new_sig
                    dead_clients = []
                    for ws in list(subscribers):
                        try:
                            await ws.send_json({
                                "type": "pipewire_graph",
                                "id": target_id,
                                "graph": graph
                            })
                        except Exception:
                            dead_clients.append(ws)

                    for dead in dead_clients:
                        self.unregister_client(dead)

        # 5. PipeWire Audio Node Meters deltas (if subscribed)
        active_meter_subs = self._topics.get("pipewire_meters", {})
        if active_meter_subs and process_manager and hasattr(process_manager, "get_or_create_pipewire_meter_collector"):
            for s_id, subscribers in list(active_meter_subs.items()):
                if not subscribers:
                    continue
                target_id = int(s_id) if (isinstance(s_id, (int, str)) and str(s_id).isdigit()) else s_id
                collector = process_manager.get_or_create_pipewire_meter_collector(target_id)
                if not collector:
                    continue
                try:
                    meters = await collector.get_meters()
                except Exception as e:
                    logger.debug(f"Error reading pipewire meters for #{target_id}: {e}")
                    continue

                dead_clients = []
                for ws in list(subscribers):
                    try:
                        await ws.send_json({
                            "type": "pipewire_meters",
                            "id": target_id,
                            "meters": meters
                        })
                    except Exception:
                        dead_clients.append(ws)

                for dead in dead_clients:
                    self.unregister_client(dead)


# Global singleton instance
subscription_hub = WebSocketSubscriptionHub()
