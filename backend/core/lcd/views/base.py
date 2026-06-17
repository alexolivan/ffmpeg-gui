from abc import ABC, abstractmethod
from typing import List
import unicodedata

def clean_ascii(text: str) -> str:
    if not text:
        return ""
    normalized = unicodedata.normalize('NFKD', text)
    return normalized.encode('ascii', 'ignore').decode('ascii')

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
