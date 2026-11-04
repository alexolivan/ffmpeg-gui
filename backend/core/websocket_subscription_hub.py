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
                range_val = str(options.get("range", "24h")) if options else "24h"
                metric_val = str(options.get("metric", "bitrate")) if options else "bitrate"

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
                        opts = self._client_options.get((ws, "service_metrics_rrd", s_id), {})
                        range_val = opts.get("range", "24h")
                        metric_val = opts.get("metric", "bitrate")
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


# Global singleton instance
subscription_hub = WebSocketSubscriptionHub()
