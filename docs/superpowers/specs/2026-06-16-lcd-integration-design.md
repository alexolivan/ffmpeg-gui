# LCD Control and Monitoring Integration Design Spec

This document details the architecture, design, and interface requirements for introducing local LCD monitoring and control in the `ffmpeg-gui` backend.

## 1. Goal
Provide a lightweight, robust, and extensible mechanism to connect physical 20x4 LCD character displays (specifically CrystalFontz CFA-635/735, using 635 compatibility mode) to display server telemetry and allow basic control (starting/stopping tasks and services) using the keypad.

## 2. Component Design & Abstraction
The system is built under the SOLID principles of Open/Closed and Single Responsibility, decoupling the display logic from the hardware communication protocol.

### 2.1. LCDDisplayInterface
Defines the contract for all LCD drivers.

```python
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
        """Handshakes with the device on the given port to check if this driver is compatible."""
        pass
```

### 2.2. Drivers: Cfa635Driver
Implements `LCDDisplayInterface` using a raw serial link (virtual COM port) with low-overhead packet framing and CRC16 CCITT validation. It does not contain menu or UI logic.

### 2.3. LCDView Lifecycle
Displays are represented as separate state objects inheriting from `LCDView`.
- `render()`: outputs 4 strings (20 chars max).
- `handle_key(key)`: responds to button events (`UP`, `DOWN`, `LEFT`, `RIGHT`, `TICK`, `X`).
- `requires_periodic_refresh`: determines if the dashboard view requires updates every 1-2 seconds.

## 3. Optimizations (No Sluggishness)
1. **Dirty Checking**: The `LCDManager` keeps a copy of the last rendered buffer and only calls `write_line` for lines that differ, drastically reducing USB bus utilization.
2. **Asynchronous Keypad Reading**: A dedicated async coroutine handles non-blocking serial reads to react instantly to user input.

## 4. Configuration and Auto-Discovery
1. **Settings**: Added DB settings fields: `lcd_enabled`, `lcd_port`, `lcd_model`.
2. **Probing Endpoint (`POST /api/settings/lcd/probe`)**:
   - Enumerates available serial ports on the host.
   - For each port, it iterates through all registered drivers (e.g., `Cfa635Driver`) and invokes `DriverClass.probe(port)`.
   - Returns a list of candidate ports and their detected driver mapping.
