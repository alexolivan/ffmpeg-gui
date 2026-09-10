import threading
import logging
import datetime
from typing import Dict, Any, Optional, Tuple, List
from urllib.parse import urlparse, parse_qs

logger = logging.getLogger("ffmpeg_gui.resource_lock_manager")


class ResourceLockManager:
    """
    Thread-safe Singleton Exclusive Resource Lock Manager.
    Enforces 'First-Wins' semantics for output stream publishers targeting
    Icecast mountpoints (e.g. /live.mp3) and MediaMTX stream paths (e.g. cam1).
    Prevents concurrent publisher collisions across local services, scheduled tasks,
    and federated peer nodes.
    """

    _instance = None
    _singleton_lock = threading.Lock()

    def __new__(cls, *args, **kwargs):
        with cls._singleton_lock:
            if cls._instance is None:
                cls._instance = super(ResourceLockManager, cls).__new__(cls)
                cls._instance._initialized = False
            return cls._instance

    def __init__(self):
        if getattr(self, '_initialized', False):
            return
        self._locks: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._initialized = True

    def clear_all(self):
        """Clears all active locks. Used primarily in test teardown."""
        with self._lock:
            self._locks.clear()

    @classmethod
    def extract_resource_info(cls, output_config: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """
        Parses an output configuration dictionary and extracts canonical resource details
        if the destination is an exclusive publisher stream (Icecast or MediaMTX).
        Returns None if the destination does not require exclusive publisher locks.
        """
        if not output_config or not isinstance(output_config, dict):
            return None

        out_type = (output_config.get("type") or "").lower()

        # ── 1. Icecast Destination ─────────────────────────────────────
        if out_type == "icecast":
            mount = output_config.get("icecast_mount") or "/live"
            if not mount.startswith("/"):
                mount = "/" + mount

            provider_id = output_config.get("provider_service_id")
            peer_node_id = output_config.get("peer_node_id")
            peer_svc_id = output_config.get("peer_service_id")

            if provider_id is not None:
                try:
                    p_id = int(provider_id)
                    key = f"service:{p_id}:icecast:{mount}"
                    target_type = "service"
                    target_id = p_id
                except (ValueError, TypeError):
                    key = f"service:{provider_id}:icecast:{mount}"
                    target_type = "service"
                    target_id = provider_id
            elif peer_node_id is not None and peer_svc_id is not None:
                key = f"peer:{peer_node_id}:{peer_svc_id}:icecast:{mount}"
                target_type = "peer"
                target_id = f"{peer_node_id}:{peer_svc_id}"
            else:
                host = str(output_config.get("host") or "127.0.0.1").lower().strip()
                port = str(output_config.get("port") or "8000").strip()
                key = f"endpoint:{host}:{port}:icecast:{mount}"
                target_type = "endpoint"
                target_id = f"{host}:{port}"

            return {
                "key": key,
                "service_type": "icecast",
                "resource_path": mount,
                "target_type": target_type,
                "target_id": target_id
            }

        # ── 2. MediaMTX Publisher Destinations (SRT / RTMP / WHIP) ────
        if out_type in ("srt", "rtmp", "whip"):
            is_mediamtx = (
                output_config.get("mediamtx_mode") is True or
                output_config.get("service_target") == "mediamtx" or
                bool(output_config.get("path_id")) or
                out_type == "whip"
            )

            # In SRT mode, verify this is a publisher (not a consumer request)
            if out_type == "srt":
                action = output_config.get("stream_action")
                if action and action != "publish":
                    return None

            path_id = output_config.get("path_id")
            if not path_id:
                # Try extracting from streamid (SRT) or URL
                streamid = output_config.get("streamid") or ""
                if "r=" in streamid:
                    for part in streamid.replace("#!::", "").split(","):
                        if part.startswith("r="):
                            path_id = part.split("=", 1)[1]
                            break

            if not path_id and out_type == "whip":
                whip_url = output_config.get("url") or ""
                if whip_url:
                    parsed = urlparse(whip_url)
                    path_id = parsed.path.strip("/").replace("/whip", "")

            if not path_id:
                return None

            clean_path = str(path_id).strip("/")
            provider_id = output_config.get("provider_service_id")
            peer_node_id = output_config.get("peer_node_id")
            peer_svc_id = output_config.get("peer_service_id")

            if provider_id is not None:
                try:
                    p_id = int(provider_id)
                    key = f"service:{p_id}:mediamtx:{clean_path}"
                    target_type = "service"
                    target_id = p_id
                except (ValueError, TypeError):
                    key = f"service:{provider_id}:mediamtx:{clean_path}"
                    target_type = "service"
                    target_id = provider_id
            elif peer_node_id is not None and peer_svc_id is not None:
                key = f"peer:{peer_node_id}:{peer_svc_id}:mediamtx:{clean_path}"
                target_type = "peer"
                target_id = f"{peer_node_id}:{peer_svc_id}"
            else:
                host = str(output_config.get("host") or "127.0.0.1").lower().strip()
                def_port = "8890" if out_type == "srt" else ("1935" if out_type == "rtmp" else "8889")
                port = str(output_config.get("port") or def_port).strip()
                key = f"endpoint:{host}:{port}:mediamtx:{clean_path}"
                target_type = "endpoint"
                target_id = f"{host}:{port}"

            return {
                "key": key,
                "service_type": "mediamtx",
                "resource_path": clean_path,
                "target_type": target_type,
                "target_id": target_id
            }

        return None

    def acquire_lock(
        self,
        owner_type: str,
        owner_id: Any,
        output_config: Optional[Dict[str, Any]],
        owner_name: str = ""
    ) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]]]:
        """
        Attempts to acquire an exclusive lock on the publish destination specified in output_config.
        Returns:
            (True, None, lock_entry) if acquired or re-acquired by the same owner, or if no lock is needed.
            (False, error_message, existing_lock_entry) if a collision exists.
        """
        info = self.extract_resource_info(output_config)
        if not info:
            return True, None, None

        key = info["key"]
        owner_id_str = str(owner_id)

        with self._lock:
            if key in self._locks:
                existing = self._locks[key]
                if existing["owner_type"] == owner_type and str(existing["owner_id"]) == owner_id_str:
                    # Same owner re-acquiring (e.g. process restart)
                    existing["acquired_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                    if owner_name:
                        existing["owner_name"] = owner_name
                    return True, None, existing

                # Conflict detected!
                err_msg = (
                    f"Conflicto de emisión: El recurso '{info['resource_path']}' "
                    f"({info['service_type'].upper()}) ya está siendo emitido por {existing['owner_type']} "
                    f"'{existing.get('owner_name', existing['owner_id'])}'."
                )
                logger.warning(
                    f"[ResourceLock] Collision on key '{key}': Requested by {owner_type}:{owner_id} "
                    f"('{owner_name}'), but currently held by {existing['owner_type']}:{existing['owner_id']} "
                    f"('{existing.get('owner_name')}')"
                )
                return False, err_msg, existing

            # Grant lock
            lock_entry = {
                "resource_key": key,
                "service_type": info["service_type"],
                "resource_path": info["resource_path"],
                "target_type": info["target_type"],
                "target_id": info["target_id"],
                "owner_type": owner_type,
                "owner_id": owner_id,
                "owner_name": owner_name or f"{owner_type}:{owner_id}",
                "acquired_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
            }
            self._locks[key] = lock_entry
            logger.info(
                f"[ResourceLock] Acquired exclusive lock on '{key}' by {owner_type}:{owner_id} ('{lock_entry['owner_name']}')"
            )
            return True, None, lock_entry

    def acquire_peer_lock(
        self,
        token_id: str,
        service_id: int,
        service_type: str,
        resource_path: str,
        peer_name: str = ""
    ) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]]]:
        """
        Acquires an exclusive lock on a local service's sub-resource on behalf of a remote federated peer token.
        """
        clean_path = resource_path.strip()
        if service_type.lower() == "icecast":
            if not clean_path.startswith("/"):
                clean_path = "/" + clean_path
        else:
            clean_path = clean_path.strip("/")

        key = f"service:{service_id}:{service_type.lower()}:{clean_path}"

        with self._lock:
            if key in self._locks:
                existing = self._locks[key]
                if existing["owner_type"] == "remote_peer" and str(existing["owner_id"]) == str(token_id):
                    existing["acquired_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                    return True, None, existing

                err_msg = (
                    f"Conflicto de emisión federada: El recurso '{clean_path}' "
                    f"en este nodo ya está siendo emitido por {existing['owner_type']} "
                    f"'{existing.get('owner_name', existing['owner_id'])}'."
                )
                logger.warning(
                    f"[ResourceLock] Peer lease collision on '{key}' for peer token {token_id}: "
                    f"Currently held by {existing['owner_type']}:{existing['owner_id']}"
                )
                return False, err_msg, existing

            lock_entry = {
                "resource_key": key,
                "service_type": service_type.lower(),
                "resource_path": clean_path,
                "target_type": "service",
                "target_id": service_id,
                "owner_type": "remote_peer",
                "owner_id": token_id,
                "owner_name": peer_name or f"Peer {token_id}",
                "acquired_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
            }
            self._locks[key] = lock_entry
            logger.info(
                f"[ResourceLock] Acquired peer lock on '{key}' for remote peer token {token_id} ('{peer_name}')"
            )
            return True, None, lock_entry

    def release_lock(self, owner_type: str, owner_id: Any):
        """Releases any active resource locks held by the specified owner."""
        owner_id_str = str(owner_id)
        with self._lock:
            to_remove = [
                k for k, v in self._locks.items()
                if v["owner_type"] == owner_type and str(v["owner_id"]) == owner_id_str
            ]
            for k in to_remove:
                del self._locks[k]
                logger.info(f"[ResourceLock] Released lock on '{k}' by {owner_type}:{owner_id}")

    def release_peer_locks(self, token_id: str, service_id: Optional[int] = None, resource_path: Optional[str] = None):
        """Releases locks held by a remote peer token."""
        token_id_str = str(token_id)
        with self._lock:
            to_remove = []
            for k, v in self._locks.items():
                if v["owner_type"] == "remote_peer" and str(v["owner_id"]) == token_id_str:
                    if service_id is not None and v.get("target_id") != service_id:
                        continue
                    if resource_path is not None and v.get("resource_path") != resource_path:
                        continue
                    to_remove.append(k)
            for k in to_remove:
                del self._locks[k]
                logger.info(f"[ResourceLock] Released peer lock on '{k}' for token {token_id}")

    def get_active_locks(self) -> List[Dict[str, Any]]:
        """Returns a list of all currently active resource locks."""
        with self._lock:
            return [dict(v) for v in self._locks.values()]

    def is_resource_locked(
        self,
        output_config: Optional[Dict[str, Any]],
        exclude_owner_type: Optional[str] = None,
        exclude_owner_id: Optional[Any] = None
    ) -> Tuple[bool, Optional[Dict[str, Any]]]:
        """
        Checks whether the publish resource specified by output_config is currently locked.
        Optionally ignores locks held by (exclude_owner_type, exclude_owner_id).
        """
        info = self.extract_resource_info(output_config)
        if not info:
            return False, None

        key = info["key"]
        with self._lock:
            if key in self._locks:
                existing = self._locks[key]
                if (
                    exclude_owner_type and
                    existing["owner_type"] == exclude_owner_type and
                    exclude_owner_id is not None and
                    str(existing["owner_id"]) == str(exclude_owner_id)
                ):
                    return False, None
                return True, dict(existing)
            return False, None


resource_lock_manager = ResourceLockManager()
