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

    def get_active_remote_leases(self, service_id: int, db_session = None) -> List[str]:
        """
        Returns a list of active remote peer lease identifiers for a service,
        e.g. ['peer:test1'] or ['peer:fgp_k_...']
        """
        self.purge_expired_leases()
        token_timestamps = self._active_remote_leases.get(service_id, {})
        if not token_timestamps:
            return []

        aliases = {}
        if db_session:
            from database.models import PeerInboundKey
            try:
                keys = db_session.query(PeerInboundKey).filter(PeerInboundKey.token_id.in_(list(token_timestamps.keys()))).all()
                aliases = {k.token_id: k.alias for k in keys if k.alias}
            except Exception as e:
                logger.debug(f"Could not resolve inbound key aliases: {e}")

        results = []
        for tok in token_timestamps.keys():
            label = aliases.get(tok) or tok[:10]
            results.append(f"peer:{label}")
        return results

    def send_all_active_remote_heartbeats(self, db_session) -> None:
        """
        Sends HEARTBEAT RPC for all locally running services and tasks
        that lease auxiliary services on remote peer nodes.
        """
        from database.models import Service, ScheduledTask
        active_pairs = set()

        try:
            running_services = db_session.query(Service).filter(Service.status == "running").all()
            for s in running_services:
                cfg = s.config or {}
                out_cfg = cfg.get("output_config", {}) or (s.output_config or {})
                inp_cfg = cfg.get("input_config", {}) or (s.input_config or {})
                p_node = out_cfg.get("peer_node_id") or inp_cfg.get("peer_node_id")
                p_svc = out_cfg.get("peer_service_id") or inp_cfg.get("peer_service_id")
                if p_node and p_svc:
                    try:
                        active_pairs.add((int(p_node), int(p_svc)))
                    except (ValueError, TypeError):
                        pass
        except Exception as e:
            logger.warning(f"Failed to query running services for peer heartbeat: {e}")

        try:
            running_tasks = db_session.query(ScheduledTask).filter(ScheduledTask.status == "running").all()
            for t in running_tasks:
                out_cfg = t.output_config or {}
                inp_cfg = t.input_config or {}
                p_node = out_cfg.get("peer_node_id") or inp_cfg.get("peer_node_id")
                p_svc = out_cfg.get("peer_service_id") or inp_cfg.get("peer_service_id")
                if p_node and p_svc:
                    try:
                        active_pairs.add((int(p_node), int(p_svc)))
                    except (ValueError, TypeError):
                        pass
        except Exception as e:
            logger.debug(f"Failed to query running tasks for peer heartbeat: {e}")

        for p_node, p_svc in active_pairs:
            try:
                self.send_remote_heartbeat(db_session, p_node, p_svc)
            except Exception as err:
                logger.warning(f"Failed to send remote heartbeat to peer {p_node} for service {p_svc}: {err}")

    def _extract_service_protocols(self, svc: Service, is_legacy: bool = False, software_version: Optional[str] = None) -> Dict[str, Any]:
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
            protocols["is_legacy"] = is_legacy
            if software_version:
                protocols["software_version"] = software_version
        return protocols

    def get_shared_catalog(self, db_session, allowed_service_ids: Optional[List[int]] = None) -> List[Dict[str, Any]]:
        from database.models import SoftwareBuild
        from core.builders.ffmpeg_builder import FFmpegCommandBuilder

        query = db_session.query(Service).filter(Service.is_shared_with_peers == True)
        services = query.all()
        catalog = []
        for svc in services:
            if allowed_service_ids and svc.id not in allowed_service_ids:
                continue

            cfg = svc.config or {}
            is_legacy = False
            software_version = None

            if svc.service_type == "icecast_server":
                build_id = cfg.get("software_build_id") or cfg.get("ffmpeg_build_id") or getattr(svc, 'ffmpeg_build_id', None)
                build = None
                if build_id:
                    build = db_session.query(SoftwareBuild).get(build_id)
                if not build:
                    build = db_session.query(SoftwareBuild).filter(
                        SoftwareBuild.software_type == 'icecast2',
                        SoftwareBuild.status == 'ready',
                        SoftwareBuild.is_default == True
                    ).first() or db_session.query(SoftwareBuild).filter(
                        SoftwareBuild.software_type == 'icecast2',
                        SoftwareBuild.status == 'ready'
                    ).first()
                if build:
                    software_version = build.version_tag or build.name
                    is_legacy = FFmpegCommandBuilder._is_legacy_icecast(software_version)
                if not is_legacy:
                    is_legacy = (
                        FFmpegCommandBuilder._is_legacy_icecast(svc.name or '')
                        or FFmpegCommandBuilder._is_legacy_icecast(svc.alias or '')
                        or bool(cfg.get("icecast_config", {}).get("is_legacy", False))
                        or bool(cfg.get("is_legacy", False))
                    )

            protocols = self._extract_service_protocols(svc, is_legacy=is_legacy, software_version=software_version)

            entry = {
                "id": svc.id,
                "name": svc.name,
                "alias": svc.alias,
                "service_type": svc.service_type,
                "status": svc.status,
                "allow_peer_lease": bool(svc.allow_peer_lease),
                "protocols": protocols,
            }
            if svc.service_type == "icecast_server":
                entry["is_legacy"] = is_legacy
                if software_version:
                    entry["software_version"] = software_version

            catalog.append(entry)
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
            raw_svc_id = req.get("service_id")
            try:
                svc_id = int(raw_svc_id)
            except (ValueError, TypeError):
                svc_id = raw_svc_id
            svc = db_session.query(Service).get(svc_id)
            if not svc:
                logger.warning(f"[Inbound RPC] ACQUIRE_LEASE: Service {svc_id} not found in DB")
                res_payload = {"status": "ERROR", "detail": f"Service {svc_id} not found"}
            elif not svc.is_shared_with_peers:
                logger.warning(f"[Inbound RPC] ACQUIRE_LEASE: Service {svc_id} ({svc.name}) is not shared with peers")
                res_payload = {"status": "ERROR", "detail": f"Service {svc_id} is not shared with peers"}
            elif not svc.allow_peer_lease:
                logger.warning(f"[Inbound RPC] ACQUIRE_LEASE: Service {svc_id} ({svc.name}) does not allow peer lease")
                res_payload = {"status": "ERROR", "detail": f"Service {svc_id} does not allow peer lease"}
            else:
                if svc_id not in self._active_remote_leases:
                    self._active_remote_leases[svc_id] = {}
                self._active_remote_leases[svc_id][token_id] = time.time()
                logger.info(f"[Inbound RPC] ACQUIRE_LEASE: Acquired lease on service {svc_id} ({svc.name}) for token {token_id}. Total leases: {len(self._active_remote_leases[svc_id])}")
                
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
            raw_svc_id = req.get("service_id")
            try:
                svc_id = int(raw_svc_id)
            except (ValueError, TypeError):
                svc_id = raw_svc_id
            if svc_id in self._active_remote_leases and token_id in self._active_remote_leases[svc_id]:
                self._active_remote_leases[svc_id][token_id] = time.time()
                res_payload = {"status": "HEARTBEAT_ACK"}
            else:
                svc = db_session.query(Service).get(svc_id)
                if svc and svc.is_shared_with_peers and svc.allow_peer_lease:
                    if svc_id not in self._active_remote_leases:
                        self._active_remote_leases[svc_id] = {}
                    self._active_remote_leases[svc_id][token_id] = time.time()
                    logger.info(f"[Inbound RPC] HEARTBEAT: Auto-reacquired lease for service {svc_id} ({svc.name}) from token {token_id}")
                    res_payload = {"status": "LEASE_REACQUIRED"}
                else:
                    res_payload = {"status": "LEASE_NOT_FOUND"}

        elif action == "RELEASE_LEASE":
            raw_svc_id = req.get("service_id")
            try:
                svc_id = int(raw_svc_id)
            except (ValueError, TypeError):
                svc_id = raw_svc_id
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
            try:
                resp = requests.post(endpoint, json=enc_pkg, headers=headers, timeout=5)
            except requests.exceptions.SSLError:
                resp = requests.post(endpoint, json=enc_pkg, headers=headers, timeout=5, verify=False)
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

    def _send_rpc_to_node(self, db_session, node_id: int, payload: Dict[str, Any]) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
        node = db_session.get(PeerRemoteNode, node_id) if hasattr(db_session, "get") else db_session.query(PeerRemoteNode).get(node_id)
        if not node:
            return False, None, "Peer node not found"
        try:
            enc_pkg = PeerCrypto.encrypt_payload(payload, node.secret_key)
            endpoint = f"{node.base_url.rstrip('/')}/api/peer-federation/v1/rpc"
            headers = {
                "X-Peer-Key-ID": node.token_id,
                "Content-Type": "application/json"
            }
            try:
                resp = requests.post(endpoint, json=enc_pkg, headers=headers, timeout=5)
            except requests.exceptions.SSLError:
                resp = requests.post(endpoint, json=enc_pkg, headers=headers, timeout=5, verify=False)
            if resp.status_code != 200:
                return False, None, f"HTTP {resp.status_code}: {resp.text[:100]}"
            dec_res = PeerCrypto.decrypt_payload(resp.json(), node.secret_key)
            return True, dec_res, None
        except Exception as e:
            return False, None, str(e)

    def acquire_remote_lease(self, db_session, node_id: int, service_id: int) -> Tuple[bool, Optional[str]]:
        success, res, err = self._send_rpc_to_node(db_session, node_id, {
            "action": "ACQUIRE_LEASE",
            "service_id": service_id
        })
        if not success:
            return False, err
        if not res or res.get("status") == "ERROR":
            return False, res.get("detail", "Failed to acquire remote lease") if res else "Unknown error"
        return True, None

    def send_remote_heartbeat(self, db_session, node_id: int, service_id: int) -> Tuple[bool, Optional[str]]:
        success, res, err = self._send_rpc_to_node(db_session, node_id, {
            "action": "HEARTBEAT",
            "service_id": service_id
        })
        if not success:
            return False, err
        return True, None

    def release_remote_lease(self, db_session, node_id: int, service_id: int) -> Tuple[bool, Optional[str]]:
        success, res, err = self._send_rpc_to_node(db_session, node_id, {
            "action": "RELEASE_LEASE",
            "service_id": service_id
        })
        if not success:
            return False, err
        return True, None

peer_manager = PeerManager()
