import asyncio
import logging
import threading
from typing import Dict, Set, List, Optional
from urllib.parse import urlparse
from database.models import ServiceDependency, Service, ScheduledTask


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
        
        self._ensure_initialized()
        self._initialized = True

    def _ensure_initialized(self):
        if not self.db_session_factory:
            try:
                from database.db import SessionLocal
                self.db_session_factory = SessionLocal
            except Exception:
                pass
        if not self.process_manager:
            try:
                import main
                self.process_manager = getattr(main, 'process_manager', None)
            except Exception:
                pass

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
        self._ensure_initialized()
        if not self.db_session_factory:
            return []

        consumer_token = f"{consumer_type}:{consumer_id}"
        acquired_providers = []

        with self.db_session_factory() as session:
            deps = session.query(ServiceDependency).filter(
                ServiceDependency.consumer_type == consumer_type,
                ServiceDependency.consumer_id == consumer_id
            ).all()

            # Dynamic on-the-fly auto-sync if no dependencies are recorded in DB
            if not deps:
                if consumer_type == 'service':
                    consumer = session.get(Service, consumer_id)
                else:
                    consumer = session.get(ScheduledTask, consumer_id)

                if consumer:
                    self.sync_auto_dependencies(
                        consumer_type,
                        consumer_id,
                        consumer.input_config,
                        consumer.output_config,
                        session
                    )
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

                    is_on_demand = not self.is_pinned(provider_id)
                    if self.process_manager:
                        res = self.process_manager.start_process(provider_id, is_restart=False, is_on_demand=is_on_demand)
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
        self._ensure_initialized()
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
        Synchronizes ServiceDependency rows in SQLite for explicitly linked
        auxiliary providers (provider_service_id in input or output config).
        Strictly deterministic - zero heuristic port sniffing.
        """
        detected_provider_ids = set()

        def extract_provider_id(conf: dict) -> Optional[int]:
            if not conf or not isinstance(conf, dict):
                return None
            val = conf.get("provider_service_id")
            if val is not None:
                try:
                    return int(val)
                except (ValueError, TypeError):
                    pass
            return None

        # Check output config
        out_pid = extract_provider_id(output_config)
        if out_pid:
            detected_provider_ids.add(out_pid)

        # Check input configs
        inp_pid = extract_provider_id(input_config)
        if inp_pid:
            detected_provider_ids.add(inp_pid)
        if input_config and isinstance(input_config, dict):
            for k in ["input1", "input2"]:
                k_pid = extract_provider_id(input_config.get(k))
                if k_pid:
                    detected_provider_ids.add(k_pid)

        # Never allow self-dependency
        if consumer_type == 'service':
            detected_provider_ids.discard(consumer_id)

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
                self.logger.info(f"Explicitly linked dependency: {consumer_type}:{consumer_id} -> provider:{p_id}")

        # Remove auto-managed deps no longer present
        for p_id, dep in existing_provider_ids.items():
            if dep.is_auto_managed and p_id not in detected_provider_ids:
                db_session.delete(dep)
                self.logger.info(f"Unlinked dependency: {consumer_type}:{consumer_id} -> provider:{p_id}")

        db_session.commit()
        return list(detected_provider_ids)


dependency_manager = DependencyManager()
