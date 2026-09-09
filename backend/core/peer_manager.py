import json
import time
import logging
import hashlib
import datetime
from typing import Dict, Any, List, Optional, Tuple
import requests

from core.peer_crypto import PeerCrypto
from database.models import Service, PeerInboundKey, PeerRemoteNode

logger = logging.getLogger("PeerManager")

class PeerManager:
    _instance = None

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            cls._instance = super(PeerManager, cls).__new__(cls, *args, **kwargs)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        # Remote leases mapping: service_id -> { token_id: last_timestamp }
        self._active_remote_leases: Dict[int, Dict[str, float]] = {}
        self._cached_catalog_version: int = 1
        self._cached_catalog_hash: str = ""

    def get_active_remote_lease_count(self, service_id: int) -> int:
        self.purge_expired_leases()
        return len(self._active_remote_leases.get(service_id, {}))

    def purge_expired_leases(self, timeout_seconds: int = 90) -> None:
        now = time.time()
        for svc_id in list(self._active_remote_leases.keys()):
            leases = self._active_remote_leases[svc_id]
            for tok in list(leases.keys()):
                if now - leases[tok] > timeout_seconds:
                    logger.info(f"Peer lease expired for service {svc_id} from token {tok}")
                    del leases[tok]
            if not leases:
                del self._active_remote_leases[svc_id]

    def _extract_service_protocols(self, svc: Service) -> Dict[str, Any]:
        cfg = svc.config or {}
        protocols = {}
        if svc.service_type == "mediamtx_hub":
            mtx = cfg.get("mediamtx_config", {})
            protocols["srt_enabled"] = bool(mtx.get("srt_enabled", True))
            protocols["srt_port"] = mtx.get("srt_port", 8890)
            protocols["rtmp_enabled"] = bool(mtx.get("rtmp_enabled", True))
            protocols["rtmp_port"] = mtx.get("rtmp_port", 1935)
            protocols["rtmps_enabled"] = bool(mtx.get("rtmps_enabled", False))
            protocols["rtmps_port"] = mtx.get("rtmps_port", 1936)
            protocols["hls_enabled"] = bool(mtx.get("hls_enabled", True))
            protocols["hls_port"] = mtx.get("hls_port", 8888)
            protocols["webrtc_enabled"] = bool(mtx.get("webrtc_enabled", True))
            protocols["webrtc_port"] = mtx.get("webrtc_port", 8889)
            protocols["paths"] = mtx.get("paths", [])
            protocols["security"] = mtx.get("security", {})
        elif svc.service_type == "icecast_server":
            ice = cfg.get("icecast_config", {})
            protocols["port"] = ice.get("port", 8000)
            protocols["ssl_port"] = ice.get("ssl_port", 8443)
            protocols["ssl_enabled"] = bool(ice.get("ssl_enabled", False))
            protocols["mounts"] = ice.get("mounts", [])
            protocols["source_password"] = ice.get("source_password", "")
        return protocols

    def get_shared_catalog(self, db_session, allowed_service_ids: Optional[List[int]] = None) -> List[Dict[str, Any]]:
        query = db_session.query(Service).filter(Service.is_shared_with_peers == True)
        services = query.all()
        catalog = []
        for svc in services:
            if allowed_service_ids and svc.id not in allowed_service_ids:
                continue
            catalog.append({
                "id": svc.id,
                "name": svc.name,
                "alias": svc.alias,
                "service_type": svc.service_type,
                "status": svc.status,
                "allow_peer_lease": bool(svc.allow_peer_lease),
                "protocols": self._extract_service_protocols(svc)
            })
        return catalog

    def get_catalog_version_and_hash(self, db_session) -> Tuple[int, str]:
        catalog = self.get_shared_catalog(db_session)
        catalog_bytes = json.dumps(catalog, sort_keys=True, separators=(',', ':')).encode("utf-8")
        current_hash = hashlib.sha256(catalog_bytes).hexdigest()[:16]
        if current_hash != self._cached_catalog_hash:
            if self._cached_catalog_hash:
                self._cached_catalog_version += 1
            self._cached_catalog_hash = current_hash
        return self._cached_catalog_version, self._cached_catalog_hash

    def handle_inbound_rpc(
        self,
        token_id=None,
        encrypted_pkg=None,
        db_session=None,
        process_manager=None,
        **kwargs
    ) -> Tuple[int, Dict[str, Any]]:
        """
        Handles incoming RPC request from a peer client.
        Supports both (token_id, encrypted_pkg, db_session) and (db_session, token_id, encrypted_pkg),
        as well as keyword arguments.
        Returns: (http_status_code, response_dict)
        """
        if db_session is None and "db" in kwargs:
            db_session = kwargs.pop("db")
        if encrypted_pkg is None and "encrypted_body" in kwargs:
            encrypted_pkg = kwargs.pop("encrypted_body")

        if hasattr(token_id, "query"):
            actual_db = token_id
            actual_token = encrypted_pkg
            actual_pkg = db_session
            db_session = actual_db
            token_id = actual_token
            encrypted_pkg = actual_pkg
        inbound_key = db_session.query(PeerInboundKey).filter(PeerInboundKey.token_id == token_id).first()
        if not inbound_key:
            return 401, {"detail": "Invalid or unknown Peer Token ID"}
        if inbound_key.status != "active":
            return 401, {"detail": f"Peer Token is {inbound_key.status}"}

        inbound_key.last_used_at = datetime.datetime.utcnow()
        db_session.commit()

        try:
            req = PeerCrypto.decrypt_payload(encrypted_pkg, inbound_key.secret_key)
        except Exception as e:
            return 401, {"detail": f"Decryption / Authentication failed: {str(e)}"}

        action = req.get("action")
        cat_ver, cat_hash = self.get_catalog_version_and_hash(db_session)

        res_payload: Dict[str, Any] = {}

        if action == "DISCOVER_SERVICES":
            known_ver = req.get("known_version", 0)
            if known_ver == cat_ver:
                res_payload = {"status": "UNCHANGED", "version": cat_ver, "hash": cat_hash}
            else:
                catalog = self.get_shared_catalog(db_session, inbound_key.allowed_services)
                res_payload = {
                    "status": "CHANGED",
                    "version": cat_ver,
                    "hash": cat_hash,
                    "services": catalog
                }

        elif action == "ACQUIRE_LEASE":
            svc_id = req.get("service_id")
            svc = db_session.query(Service).get(svc_id)
            if not svc or not svc.is_shared_with_peers or not svc.allow_peer_lease:
                res_payload = {"status": "ERROR", "detail": "Service not found or leasing not permitted"}
            else:
                if svc_id not in self._active_remote_leases:
                    self._active_remote_leases[svc_id] = {}
                self._active_remote_leases[svc_id][token_id] = time.time()
                
                # Auto-start service if stopped and process_manager available
                if svc.status != "running" and process_manager:
                    try:
                        import asyncio
                        # Trigger background start if async event loop active
                        loop = asyncio.get_event_loop()
                        if loop.is_running():
                            asyncio.create_task(process_manager.start_process(svc_id))
                    except Exception as err:
                        logger.warning(f"Failed to auto-start leased service {svc_id}: {err}")

                res_payload = {
                    "status": "LEASE_ACQUIRED",
                    "service_status": svc.status,
                    "lease_count": len(self._active_remote_leases[svc_id])
                }

        elif action == "HEARTBEAT":
            svc_id = req.get("service_id")
            if svc_id in self._active_remote_leases and token_id in self._active_remote_leases[svc_id]:
                self._active_remote_leases[svc_id][token_id] = time.time()
                res_payload = {"status": "HEARTBEAT_ACK"}
            else:
                res_payload = {"status": "LEASE_NOT_FOUND"}

        elif action == "RELEASE_LEASE":
            svc_id = req.get("service_id")
            if svc_id in self._active_remote_leases:
                self._active_remote_leases[svc_id].pop(token_id, None)
                if not self._active_remote_leases[svc_id]:
                    del self._active_remote_leases[svc_id]
            res_payload = {"status": "LEASE_RELEASED"}

        else:
            res_payload = {"status": "ERROR", "detail": f"Unknown action: {action}"}

        encrypted_res = PeerCrypto.encrypt_payload(res_payload, inbound_key.secret_key)
        return 200, encrypted_res

    def sync_remote_node(self, arg1, arg2) -> Tuple[bool, Optional[str]]:
        """
        Synchronizes a registered remote peer node by issuing a DISCOVER_SERVICES RPC.
        Supports both (node_id_or_node, db_session) and (db_session, node_id_or_node).
        Returns: (success: bool, error_message: Optional[str])
        """
        if hasattr(arg1, "query"):
            db_session = arg1
            node_target = arg2
        else:
            node_target = arg1
            db_session = arg2

        if isinstance(node_target, int):
            node = db_session.query(PeerRemoteNode).get(node_target)
        elif hasattr(node_target, "id"):
            node = node_target
        else:
            node = db_session.query(PeerRemoteNode).get(int(node_target))
        if not node:
            return False, "Node not found"

        req_payload = {
            "action": "DISCOVER_SERVICES",
            "known_version": node.catalog_version or 0
        }
        try:
            enc_pkg = PeerCrypto.encrypt_payload(req_payload, node.secret_key)
            endpoint = f"{node.base_url.rstrip('/')}/api/peer-federation/v1/rpc"
            headers = {
                "X-Peer-Key-ID": node.token_id,
                "Content-Type": "application/json"
            }
            
            t0 = time.time()
            resp = requests.post(endpoint, json=enc_pkg, headers=headers, timeout=5)
            latency_ms = int((time.time() - t0) * 1000)
            
            if resp.status_code != 200:
                node.status = "offline"
                node.last_error = f"HTTP {resp.status_code}: {resp.text[:100]}"
                db_session.commit()
                return False, node.last_error

            dec_res = PeerCrypto.decrypt_payload(resp.json(), node.secret_key)
            node.status = "online"
            node.latency_ms = latency_ms
            node.last_seen = datetime.datetime.utcnow()
            node.last_error = None

            if dec_res.get("status") == "CHANGED":
                node.cached_services_json = dec_res.get("services", [])
                node.catalog_version = dec_res.get("version", 0)

            db_session.commit()
            return True, None

        except Exception as e:
            node.status = "offline"
            node.last_error = str(e)
            db_session.commit()
            return False, str(e)

    def sync_all_remote_nodes(self, db_session) -> None:
        nodes = db_session.query(PeerRemoteNode).all()
        for node in nodes:
            try:
                self.sync_remote_node(node.id, db_session)
            except Exception as e:
                logger.error(f"Error syncing peer node {node.name} (ID: {node.id}): {e}")

peer_manager = PeerManager()
