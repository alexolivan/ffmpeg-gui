import logging
import threading
import time
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

    def acquire_dependencies(
        self,
        consumer_type: str,
        consumer_id: int,
        allow_auto_start: bool = True
    ) -> List[int]:
        """
        Acquire leases on all required provider services.
        If a provider is stopped and allow_auto_start is True, launches it On-Demand.
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
                        # Start provider
                        self.process_manager.start_process(provider_id)
                        # Wait up to 5s for provider to report running
                        for _ in range(25):
                            time.sleep(0.2)
                            session.refresh(provider)
                            if provider.status == 'running':
                                break

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

    def release_dependencies(
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
                                self.process_manager.stop_process(provider_id)
                            except Exception as stop_err:
                                self.logger.error(f"Error auto-stopping provider {provider_id}: {stop_err}")
                    else:
                        self.logger.info(
                            f"Provider service {provider_id} has 0 leases but consumer {consumer_token} "
                            f"has allow_auto_stop_deps=False. Leaving active."
                        )


dependency_manager = DependencyManager()
