import asyncio
import logging
import threading
from typing import Dict, Set, List, Optional
from database.models import ServiceDependency, Service


class DependencyManager:
    """
    Singleton Dependency & Resource Leasing Engine.
    Orchestrates auxiliary services (MediaMTX Hubs, Icecast servers, etc.)
    with reference counting ('No estás solo en el mundo' + 'El último que apague la luz')
    and operator safety interlocks (allow_auto_start_deps, allow_auto_stop_deps).
    """

    _instance = None
    _lock = threading.Lock()

    def __new__(cls, *args, **kwargs):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super(DependencyManager, cls).__new__(cls)
                cls._instance._initialized = False
            return cls._instance

    def __init__(self, db_session_factory=None, process_manager=None):
        if self._initialized:
            if db_session_factory:
                self.db_session_factory = db_session_factory
            if process_manager:
                self.process_manager = process_manager
            return

        self.logger = logging.getLogger("DependencyManager")
        self.db_session_factory = db_session_factory
        self.process_manager = process_manager
        
        # provider_service_id -> Set of consumer tokens ("service:1", "task:42")
        self.active_leases: Dict[int, Set[str]] = {}
        # Set of service_ids explicitly launched by user action or system boot
        self.pinned_services: Set[int] = set()
        self.state_lock = threading.Lock()
        
        self._initialized = True

    def mark_pinned(self, service_id: int):
        """Mark a service as explicitly started by the operator or boot sequence."""
        with self.state_lock:
            self.pinned_services.add(service_id)
            self.logger.info(f"Service {service_id} marked as PINNED (manual/boot origin).")

    def unmark_pinned(self, service_id: int):
        """Unmark pinned state (e.g. when stopped by operator)."""
        with self.state_lock:
            self.pinned_services.discard(service_id)
            self.logger.info(f"Service {service_id} unmarked from PINNED state.")

    def is_pinned(self, service_id: int) -> bool:
        with self.state_lock:
            return service_id in self.pinned_services

    def get_active_leases(self, service_id: int) -> List[str]:
        with self.state_lock:
            return list(self.active_leases.get(service_id, set()))

    async def acquire_dependencies(
        self,
        consumer_type: str,
        consumer_id: int,
        allow_auto_start: bool = True
    ) -> List[int]:
        """
        Acquire leases on all required provider services.
        If a provider is stopped and allow_auto_start is True, launches it On-Demand.
        Waits for provider to be running and adds stabilization grace delay before returning.
        """
        if not self.db_session_factory:
            return []

        consumer_token = f"{consumer_type}:{consumer_id}"
        acquired_providers = []

        with self.db_session_factory() as session:
            deps = session.query(ServiceDependency).filter(
                ServiceDependency.consumer_type == consumer_type,
                ServiceDependency.consumer_id == consumer_id
            ).all()

            for dep in deps:
                provider_id = dep.provider_service_id
                provider = session.get(Service, provider_id)
                if not provider:
                    continue

                is_running = (provider.status == 'running')
                if not is_running:
                    if not allow_auto_start:
                        err_msg = (
                            f"Required dependency '{provider.name}' (ID {provider_id}) is stopped, "
                            f"and consumer {consumer_token} has allow_auto_start_deps=False."
                        )
                        self.logger.error(err_msg)
                        raise RuntimeError(err_msg)

                    self.logger.info(
                        f"Consumer {consumer_token} auto-starting stopped dependency '{provider.name}' (ID {provider_id}) on-demand."
                    )
                    if self.process_manager:
                        res = self.process_manager.start_process(provider_id, is_restart=False)
                        if asyncio.iscoroutine(res):
                            await res

                        # Wait up to 5s for provider to transition to running status
                        started_ok = False
                        for _ in range(25):
                            await asyncio.sleep(0.2)
                            session.expire(provider)
                            if provider.status == 'running':
                                started_ok = True
                                break

                        if not started_ok and provider.status != 'running':
                            err_msg = (
                                f"Required dependency '{provider.name}' (ID {provider_id}) "
                                f"failed to transition to 'running' status (current: '{provider.status}')."
                            )
                            self.logger.error(err_msg)
                            raise RuntimeError(err_msg)

                        # Stabilization grace time for socket binding (RTMP / SRT / RTSP ports)
                        self.logger.info(f"Provider {provider_id} running. Waiting 1.0s stabilization grace time...")
                        await asyncio.sleep(1.0)

                # Register lease
                with self.state_lock:
                    if provider_id not in self.active_leases:
                        self.active_leases[provider_id] = set()
                    self.active_leases[provider_id].add(consumer_token)
                    acquired_providers.append(provider_id)

                self.logger.info(
                    f"Consumer {consumer_token} acquired lease on provider {provider_id}. "
                    f"Active leases: {len(self.active_leases[provider_id])}"
                )

        return acquired_providers

    async def release_dependencies(
        self,
        consumer_type: str,
        consumer_id: int,
        allow_auto_stop: bool = True
    ):
        """
        Release leases held by a consumer.
        Implements 'No estás solo en el mundo' and 'El último que apague la luz'.
        """
        consumer_token = f"{consumer_type}:{consumer_id}"
        providers_to_evaluate = []

        with self.state_lock:
            for provider_id, leases in list(self.active_leases.items()):
                if consumer_token in leases:
                    leases.discard(consumer_token)
                    providers_to_evaluate.append((provider_id, len(leases)))

        for provider_id, remaining_leases in providers_to_evaluate:
            self.logger.info(
                f"Consumer {consumer_token} released lease on provider {provider_id}. "
                f"Remaining leases: {remaining_leases}"
            )

            # Check if this provider has 0 remaining leases
            if remaining_leases == 0:
                is_pinned = self.is_pinned(provider_id)
                if is_pinned:
                    self.logger.info(
                        f"Provider service {provider_id} has 0 leases but is PINNED (manual/boot). Keeping active."
                    )
                else:
                    if allow_auto_stop:
                        self.logger.info(
                            f"Provider service {provider_id} has 0 leases and was On-Demand. "
                            f"Shutting down ('El último que apague la luz')."
                        )
                        if self.process_manager:
                            try:
                                res = self.process_manager.stop_process(provider_id)
                                if asyncio.iscoroutine(res):
                                    await res
                            except Exception as stop_err:
                                self.logger.error(f"Error auto-stopping provider {provider_id}: {stop_err}")
                    else:
                        self.logger.info(
                            f"Provider service {provider_id} has 0 leases but consumer {consumer_token} "
                            f"has allow_auto_stop_deps=False. Leaving active."
                        )

    def sync_auto_dependencies(
        self,
        consumer_type: str,
        consumer_id: int,
        input_config: Optional[dict],
        output_config: Optional[dict],
        db_session
    ) -> List[int]:
        """
        Analyzes input and output configs of a service or task and automatically
        synchronizes ServiceDependency rows in SQLite for any local auxiliary providers
        (MediaMTX Hub, Icecast2, etc.).
        """
        detected_provider_ids = set()
        
        # Check all auxiliary services in DB
        aux_providers = db_session.query(Service).filter(
            Service.service_type.in_(["mediamtx_hub", "icecast_server"])
        ).all()

        for provider in aux_providers:
            p_id = provider.id
            # Do not allow self-dependency
            if consumer_type == 'service' and consumer_id == p_id:
                continue

            cfg = provider.config or {}
            mtx_cfg = cfg.get("mediamtx_config", cfg)

            # Known ports for this provider
            ports = set()
            for k, default_port in [
                ("rtmp_port", 1935),
                ("rtsp_port", 8554),
                ("webrtc_port", 8889),
                ("srt_port", 8890),
                ("hls_port", 8888),
                ("api_port", 9997),
                ("port", 8000),  # Icecast
            ]:
                p_val = mtx_cfg.get(k) or cfg.get(k) or default_port
                try:
                    ports.add(int(p_val))
                except (ValueError, TypeError):
                    pass

            def matches_target(conf: dict) -> bool:
                if not conf or not isinstance(conf, dict):
                    return False
                # Explicit provider_service_id reference
                if conf.get("provider_service_id") == p_id:
                    return True
                
                # Check url
                url = str(conf.get("url") or "")
                if url:
                    for port in ports:
                        if f":{port}" in url and any(h in url for h in ["127.0.0.1", "localhost", "0.0.0.0"]):
                            return True

                # Check host and port
                host = str(conf.get("host") or "").lower()
                port_str = str(conf.get("port") or "")
                if host in ["127.0.0.1", "localhost", "0.0.0.0", ""]:
                    try:
                        if port_str and int(port_str) in ports:
                            return True
                    except (ValueError, TypeError):
                        pass

                return False

            if output_config and matches_target(output_config):
                detected_provider_ids.add(p_id)
            if input_config:
                if matches_target(input_config):
                    detected_provider_ids.add(p_id)
                for inp_key in ["input1", "input2"]:
                    if inp_key in input_config and matches_target(input_config[inp_key]):
                        detected_provider_ids.add(p_id)

        # Sync with SQLite ServiceDependency
        existing_deps = db_session.query(ServiceDependency).filter(
            ServiceDependency.consumer_type == consumer_type,
            ServiceDependency.consumer_id == consumer_id
        ).all()
        existing_provider_ids = {d.provider_service_id: d for d in existing_deps}

        # Add missing
        for p_id in detected_provider_ids:
            if p_id not in existing_provider_ids:
                new_dep = ServiceDependency(
                    consumer_type=consumer_type,
                    consumer_id=consumer_id,
                    provider_service_id=p_id,
                    is_auto_managed=True
                )
                db_session.add(new_dep)
                self.logger.info(f"Auto-linked dependency: {consumer_type}:{consumer_id} -> provider:{p_id}")

        # Remove auto-managed deps no longer present
        for p_id, dep in existing_provider_ids.items():
            if dep.is_auto_managed and p_id not in detected_provider_ids:
                db_session.delete(dep)
                self.logger.info(f"Auto-unlinked stale dependency: {consumer_type}:{consumer_id} -> provider:{p_id}")

        db_session.commit()
        return list(detected_provider_ids)


dependency_manager = DependencyManager()
