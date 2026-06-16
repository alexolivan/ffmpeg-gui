from abc import ABC, abstractmethod
from typing import List

class LCDView(ABC):
    def __init__(self, manager):
        self.manager = manager

    @abstractmethod
    def render(self) -> List[str]:
        pass

    @abstractmethod
    def handle_key(self, key: str) -> None:
        pass

    def on_enter(self) -> None:
        pass

    def on_exit(self) -> None:
        pass

    @property
    def requires_periodic_refresh(self) -> bool:
        return False
