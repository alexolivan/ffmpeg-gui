from abc import ABC, abstractmethod

class LCDDisplayInterface(ABC):
    @abstractmethod
    def connect(self) -> None:
        pass

    @abstractmethod
    def disconnect(self) -> None:
        pass

    @abstractmethod
    def write_line(self, row: int, text: str) -> None:
        pass

    @abstractmethod
    def clear(self) -> None:
        pass

    @classmethod
    @abstractmethod
    def probe(cls, port: str) -> bool:
        pass
