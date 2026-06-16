# LCD Control and Monitoring Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate local LCD monitoring and control support in the ffmpeg-gui backend using direct serial communication with CrystalFontz displays.

**Architecture:** Decoupled layout engine using an abstract `LCDDisplayInterface` and an active `LCDView` state pattern. Periodic rendering runs asynchronously combined with event-driven keypad reading, optimized using dirty-buffering to minimize serial traffic.

**Tech Stack:** Python 3, FastAPI, SQLAlchemy, PySerial, PyTest.

---

### Task 1: Database and Pydantic Schema Changes

**Files:**
- Create: `backend/tests/test_lcd_settings.py`
- Modify: `backend/database/models.py`
- Modify: `backend/database/db.py`
- Modify: `backend/main.py`

- [ ] **Step 1: Write the failing test**
Create `backend/tests/test_lcd_settings.py` with:
```python
import pytest
from database.models import SystemSettings
from main import SettingsUpdate

def test_system_settings_has_lcd_fields():
    settings = SystemSettings()
    assert hasattr(settings, "lcd_enabled")
    assert hasattr(settings, "lcd_port")
    assert hasattr(settings, "lcd_model")

def test_settings_update_schema():
    data = {"lcd_enabled": True, "lcd_port": "/dev/ttyUSB0", "lcd_model": "cfa635"}
    update_model = SettingsUpdate(**data)
    assert update_model.lcd_enabled is True
    assert update_model.lcd_port == "/dev/ttyUSB0"
    assert update_model.lcd_model == "cfa635"
```

- [ ] **Step 2: Run test to verify it fails**
Run: `PYTHONPATH=backend venv/bin/pytest backend/tests/test_lcd_settings.py -v`
Expected: FAIL with attribute/import error.

- [ ] **Step 3: Write minimal implementation**
Modify `backend/database/models.py` to add columns:
```python
    # Add to SystemSettings model:
    lcd_enabled = Column(Boolean, default=False)
    lcd_port = Column(String, default="/dev/ttyACM0")
    lcd_model = Column(String, default="cfa635")
```

Modify `backend/database/db.py` to add migrations:
```python
        # Add inside init_db():
        cursor.execute("PRAGMA table_info(system_settings)")
        settings_columns = [col[1] for col in cursor.fetchall()]
        if "lcd_enabled" not in settings_columns:
            cursor.execute("ALTER TABLE system_settings ADD COLUMN lcd_enabled BOOLEAN DEFAULT 0")
        if "lcd_port" not in settings_columns:
            cursor.execute("ALTER TABLE system_settings ADD COLUMN lcd_port TEXT DEFAULT '/dev/ttyACM0'")
        if "lcd_model" not in settings_columns:
            cursor.execute("ALTER TABLE system_settings ADD COLUMN lcd_model TEXT DEFAULT 'cfa635'")
```

Modify `SettingsUpdate` and `/settings` in `backend/main.py`:
```python
class SettingsUpdate(BaseModel):
    node_name: Optional[str] = None
    gui_password: Optional[str] = None
    logo_text: Optional[str] = None
    accent_color: Optional[str] = None
    lcd_enabled: Optional[bool] = None
    lcd_port: Optional[str] = None
    lcd_model: Optional[str] = None
```
And inside `update_settings`:
```python
    if settings_in.lcd_enabled is not None: settings.lcd_enabled = settings_in.lcd_enabled
    if settings_in.lcd_port is not None: settings.lcd_port = settings_in.lcd_port
    if settings_in.lcd_model is not None: settings.lcd_model = settings_in.lcd_model
```

- [ ] **Step 4: Run test to verify it passes**
Run: `PYTHONPATH=backend venv/bin/pytest backend/tests/test_lcd_settings.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**
Run:
```bash
git add backend/database/models.py backend/database/db.py backend/main.py backend/tests/test_lcd_settings.py
git commit -m "feat(database): add lcd settings fields to system settings model and api"
```

---

### Task 2: LCD Interface & Driver Architecture

**Files:**
- Create: `backend/tests/test_lcd_driver.py`
- Create: `backend/core/lcd/interface.py`
- Create: `backend/core/lcd/drivers/cfa635.py`

- [ ] **Step 1: Write the failing test**
Create `backend/tests/test_lcd_driver.py` with:
```python
import pytest
from unittest.mock import MagicMock, patch
from core.lcd.drivers.cfa635 import Cfa635Driver

@patch('serial.Serial')
def test_driver_crc_and_ping(mock_serial):
    driver = Cfa635Driver(port="/dev/test_port")
    assert driver._calculate_crc(b'\x00\x00') == 0x7E16
```

- [ ] **Step 2: Run test to verify it fails**
Run: `PYTHONPATH=backend venv/bin/pytest backend/tests/test_lcd_driver.py -v`
Expected: FAIL with Import/Module error.

- [ ] **Step 3: Write minimal implementation**
Create `backend/core/lcd/interface.py`:
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
        pass
```

Create `backend/core/lcd/drivers/cfa635.py`:
```python
import struct
import serial
from ..interface import LCDDisplayInterface

class Cfa635Driver(LCDDisplayInterface):
    def __init__(self, port: str, baud_rate: int = 115200, cols: int = 20, rows: int = 4):
        self.port = port
        self.baud_rate = baud_rate
        self.cols = cols
        self.rows = rows
        self.ser = None

    def connect(self) -> None:
        self.ser = serial.Serial(self.port, self.baud_rate, timeout=0.1)

    def disconnect(self) -> None:
        if self.ser and self.ser.is_open:
            self.ser.close()

    def _calculate_crc(self, data: bytes) -> int:
        crc = 0xFFFF
        for byte in data:
            crc ^= byte
            for _ in range(8):
                crc = (crc >> 1) ^ 0x8408 if crc & 0x0001 else crc >> 1
        return ~crc & 0xFFFF

    def _send_packet(self, command: int, data: bytes) -> bytes:
        packet = struct.pack(f"BB{len(data)}s", command, len(data), data)
        full_packet = packet + struct.pack("<H", self._calculate_crc(packet))
        self.ser.write(full_packet)
        return self.ser.read(100)

    def write_line(self, row: int, text: str) -> None:
        formatted_text = text[:self.cols].ljust(self.cols)
        payload = struct.pack(f"BB{self.cols}s", 0, row, formatted_text.encode('ascii', errors='ignore'))
        self._send_packet(31, payload)

    def clear(self) -> None:
        self._send_packet(6, b"")

    @classmethod
    def probe(cls, port: str) -> bool:
        try:
            ser = serial.Serial(port, 115200, timeout=0.2)
            # Send ping command (0)
            packet = struct.pack("BB", 0, 0)
            # CRC for b'\x00\x00' is 0x7E16 (LSB: 0x16, MSB: 0x7E)
            full_packet = packet + b'\x16\x7E'
            ser.write(full_packet)
            resp = ser.read(16)
            ser.close()
            return len(resp) >= 4 and resp[0] == 0x40  # Response packet to command 0 has command 0x40 (ping response)
        except Exception:
            return False
```

- [ ] **Step 4: Run test to verify it passes**
Run: `PYTHONPATH=backend venv/bin/pytest backend/tests/test_lcd_driver.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**
Run:
```bash
git add backend/core/lcd/interface.py backend/core/lcd/drivers/cfa635.py backend/tests/test_lcd_driver.py
git commit -m "feat(lcd): implement abstract interface and direct cfa635 serial driver"
```

---

### Task 3: Views & Navigation Lifecycle

**Files:**
- Create: `backend/tests/test_lcd_views.py`
- Create: `backend/core/lcd/views/base.py`
- Create: `backend/core/lcd/views/dashboard.py`
- Create: `backend/core/lcd/views/menu.py`

- [ ] **Step 1: Write the failing test**
Create `backend/tests/test_lcd_views.py` with:
```python
import pytest
from core.lcd.views.base import LCDView

def test_lcd_view_base_attributes():
    class DummyView(LCDView):
        def render(self):
            return ["Line 1", "Line 2", "Line 3", "Line 4"]
        def handle_key(self, key):
            pass
    view = DummyView(manager=None)
    assert view.requires_periodic_refresh is False
    assert view.render()[0] == "Line 1"
```

- [ ] **Step 2: Run test to verify it fails**
Run: `PYTHONPATH=backend venv/bin/pytest backend/tests/test_lcd_views.py -v`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**
Create `backend/core/lcd/views/base.py`:
```python
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
```

Create `backend/core/lcd/views/dashboard.py`:
```python
import psutil
from typing import List
from .base import LCDView

class DashboardView(LCDView):
    @property
    def requires_periodic_refresh(self) -> bool:
        return True

    def render(self) -> List[str]:
        cpu = int(psutil.cpu_percent())
        ram = int(psutil.virtual_memory().percent)
        db = self.manager.db_session_factory()
        try:
            from database.models import MediaProcess
            active_count = db.query(MediaProcess).filter(MediaProcess.status == 'running').count()
        except Exception:
            active_count = 0
        finally:
            db.close()

        return [
            "=== STATUS GUI ===",
            f"CPU: {cpu}%",
            f"RAM: {ram}%",
            f"Active: {active_count} streams"
        ]

    def handle_key(self, key: str) -> None:
        if key == "TICK":
            from .menu import MainMenuView
            self.manager.switch_to_view(MainMenuView(self.manager))
```

Create `backend/core/lcd/views/menu.py`:
```python
from typing import List
from .base import LCDView

class MainMenuView(LCDView):
    def __init__(self, manager):
        super().__init__(manager)
        self.options = ["1. Dashboard", "2. Services", "3. Tasks"]
        self.selected_index = 0

    def render(self) -> List[str]:
        lines = ["--- MAIN MENU ---"]
        for idx in range(3):
            prefix = "> " if idx == self.selected_index else "  "
            lines.append(f"{prefix}{self.options[idx]}")
        return lines

    def handle_key(self, key: str) -> None:
        if key == "UP":
            self.selected_index = (self.selected_index - 1) % len(self.options)
        elif key == "DOWN":
            self.selected_index = (self.selected_index + 1) % len(self.options)
        elif key == "X":
            from .dashboard import DashboardView
            self.manager.switch_to_view(DashboardView(self.manager))
        elif key == "TICK":
            if self.selected_index == 0:
                from .dashboard import DashboardView
                self.manager.switch_to_view(DashboardView(self.manager))
            elif self.selected_index == 1:
                self.manager.switch_to_view(ServicesMenuView(self.manager))
            elif self.selected_index == 2:
                self.manager.switch_to_view(TasksMenuView(self.manager))

class ServicesMenuView(LCDView):
    def __init__(self, manager):
        super().__init__(manager)
        self.services = []
        self.selected_index = 0
        self.fetch_services()

    def fetch_services(self):
        db = self.manager.db_session_factory()
        try:
            from database.models import MediaProcess
            self.services = db.query(MediaProcess).filter(MediaProcess.type == 'service').all()
        except Exception:
            self.services = []
        finally:
            db.close()

    def render(self) -> List[str]:
        lines = ["-- SERVICES MENU -"]
        if not self.services:
            lines.append("  No services")
            lines.append("")
            lines.append("Press X to return")
            return lines

        # Render 3 services window
        start = max(0, self.selected_index - 1)
        end = min(len(self.services), start + 3)
        for i in range(start, end):
            svc = self.services[i]
            prefix = "> " if i == self.selected_index else "  "
            status_char = "*" if svc.status == "running" else " "
            lines.append(f"{prefix}[{status_char}] {svc.name[:13]}")
        
        while len(lines) < 4:
            lines.append("")
        return lines

    def handle_key(self, key: str) -> None:
        if key == "X":
            self.manager.switch_to_view(MainMenuView(self.manager))
            return

        if not self.services:
            return

        if key == "UP":
            self.selected_index = (self.selected_index - 1) % len(self.services)
        elif key == "DOWN":
            self.selected_index = (self.selected_index + 1) % len(self.services)
        elif key == "TICK":
            # Toggle Service Status
            svc = self.services[self.selected_index]
            import asyncio
            if svc.status == "running":
                asyncio.create_task(self.manager.process_manager.stop_process(svc.id))
            else:
                asyncio.create_task(self.manager.process_manager.start_process(svc.id))
            # Wait briefly and refresh list
            async def refresh():
                await asyncio.sleep(0.5)
                self.fetch_services()
                self.manager.refresh_display()
            asyncio.create_task(refresh())

class TasksMenuView(LCDView):
    def __init__(self, manager):
        super().__init__(manager)
        self.tasks = []
        self.selected_index = 0
        self.fetch_tasks()

    def fetch_tasks(self):
        db = self.manager.db_session_factory()
        try:
            from database.models import ScheduledTask
            self.tasks = db.query(ScheduledTask).all()
        except Exception:
            self.tasks = []
        finally:
            db.close()

    def render(self) -> List[str]:
        lines = ["--- TASKS MENU ---"]
        if not self.tasks:
            lines.append("  No tasks")
            lines.append("")
            lines.append("Press X to return")
            return lines

        start = max(0, self.selected_index - 1)
        end = min(len(self.tasks), start + 3)
        for i in range(start, end):
            task = self.tasks[i]
            prefix = "> " if i == self.selected_index else "  "
            lines.append(f"{prefix}{task.name[:16]}")

        while len(lines) < 4:
            lines.append("")
        return lines

    def handle_key(self, key: str) -> None:
        if key == "X":
            self.manager.switch_to_view(MainMenuView(self.manager))
            return

        if not self.tasks:
            return

        if key == "UP":
            self.selected_index = (self.selected_index - 1) % len(self.tasks)
        elif key == "DOWN":
            self.selected_index = (self.selected_index + 1) % len(self.tasks)
        elif key == "TICK":
            # Run task execution now
            task = self.tasks[self.selected_index]
            import asyncio
            db = self.manager.db_session_factory()
            try:
                from database.models import TaskExecution
                exec_obj = TaskExecution(task_id=task.id, status="pending")
                db.add(exec_obj)
                db.commit()
                # Launch execution via TaskManager
                asyncio.create_task(self.manager.task_manager.start_execution(exec_obj.id))
            except Exception:
                pass
            finally:
                db.close()
```

- [ ] **Step 4: Run test to verify it passes**
Run: `PYTHONPATH=backend venv/bin/pytest backend/tests/test_lcd_views.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**
Run:
```bash
git add backend/core/lcd/views/base.py backend/core/lcd/views/dashboard.py backend/core/lcd/views/menu.py backend/tests/test_lcd_views.py
git commit -m "feat(lcd): create base view interface and standard views for dashboard, services, tasks"
```

---

### Task 4: LCD Manager (Orchestrator)

**Files:**
- Create: `backend/tests/test_lcd_manager.py`
- Create: `backend/core/lcd/manager.py`
- Modify: `backend/main.py`

- [ ] **Step 1: Write the failing test**
Create `backend/tests/test_lcd_manager.py` with:
```python
import pytest
from unittest.mock import MagicMock
from core.lcd.manager import LCDManager

def test_manager_init():
    session_factory = MagicMock()
    proc_mgr = MagicMock()
    task_mgr = MagicMock()
    mgr = LCDManager(session_factory, proc_mgr, task_mgr, port="/dev/test_port")
    assert mgr.port == "/dev/test_port"
    assert mgr.current_view is not None
```

- [ ] **Step 2: Run test to verify it fails**
Run: `PYTHONPATH=backend venv/bin/pytest backend/tests/test_lcd_manager.py -v`
Expected: FAIL with Import error.

- [ ] **Step 3: Write minimal implementation**
Create `backend/core/lcd/manager.py`:
```python
import asyncio
import logging
from typing import List, Optional
from .drivers.cfa635 import Cfa635Driver
from .views.dashboard import DashboardView

logger = logging.getLogger("LCD-Manager")

class LCDManager:
    def __init__(self, db_session_factory, process_manager, task_manager, port: str):
        self.db_session_factory = db_session_factory
        self.process_manager = process_manager
        self.task_manager = task_manager
        self.port = port
        self.driver = Cfa635Driver(port=self.port)
        self.current_view = DashboardView(self)
        self._last_rendered_lines: List[str] = [""] * 4
        self._running = False
        self._read_task = None
        self._refresh_task = None

    def start(self):
        self._running = True
        try:
            self.driver.connect()
            self.driver.clear()
            self._read_task = asyncio.create_task(self._read_loop())
            self._refresh_task = asyncio.create_task(self._refresh_loop())
            self.refresh_display()
            logger.info(f"LCD Manager started successfully on port {self.port}")
        except Exception as e:
            logger.error(f"Failed to start LCD driver on port {self.port}: {e}")

    def stop(self):
        self._running = False
        if self._read_task:
            self._read_task.cancel()
        if self._refresh_task:
            self._refresh_task.cancel()
        self.driver.disconnect()

    def switch_to_view(self, new_view):
        self.current_view.on_exit()
        self.current_view = new_view
        self.current_view.on_enter()
        self.refresh_display()

    def refresh_display(self):
        try:
            lines = self.current_view.render()
            for row in range(4):
                line_text = lines[row] if row < len(lines) else ""
                # Dirty check optimization
                if line_text != self._last_rendered_lines[row]:
                    self.driver.write_line(row, line_text)
                    self._last_rendered_lines[row] = line_text
        except Exception as e:
            logger.error(f"Error rendering LCD view: {e}")

    async def _read_loop(self):
        key_map = {
            1: "UP",
            2: "TICK",
            4: "X",
            8: "LEFT",
            16: "RIGHT",
            32: "DOWN"
        }
        while self._running:
            try:
                # Direct serial byte read
                if self.driver.ser and self.driver.ser.is_open:
                    if self.driver.ser.in_waiting > 0:
                        # CrystalFontz packet: [type][length][data...][crc_lsb][crc_msb]
                        # For Key activity (0x80), length is 1, data is key code
                        cmd_byte = self.driver.ser.read(1)
                        if len(cmd_byte) > 0 and cmd_byte[0] == 0x80:
                            len_byte = self.driver.ser.read(1)
                            if len(len_byte) > 0 and len_byte[0] == 1:
                                key_code_byte = self.driver.ser.read(1)
                                if len(key_code_byte) > 0:
                                    key_code = key_code_byte[0]
                                    # Consume CRC (2 bytes)
                                    self.driver.ser.read(2)
                                    # We only trigger action on key press (press has highest bit set/unset depending on event)
                                    # Standard key presses: key_code will match the map
                                    if key_code in key_map:
                                        key_name = key_map[key_code]
                                        self.current_view.handle_key(key_name)
                                        self.refresh_display()
                await asyncio.sleep(0.05)
            except Exception as e:
                await asyncio.sleep(1)

    async def _refresh_loop(self):
        while self._running:
            try:
                if self.current_view.requires_periodic_refresh:
                    self.refresh_display()
            except Exception:
                pass
            await asyncio.sleep(2.0)
```

Modify `backend/main.py` to add startup/shutdown hooks:
```python
# Add globally in main.py:
lcd_manager = None

# Modify inside startup_event():
    global lcd_manager
    try:
        with SessionLocal() as db:
            from database.models import SystemSettings
            settings = db.query(SystemSettings).first()
            if settings and settings.lcd_enabled:
                from core.lcd.manager import LCDManager
                lcd_manager = LCDManager(
                    db_session_factory=SessionLocal,
                    process_manager=process_manager,
                    task_manager=task_manager,
                    port=settings.lcd_port
                )
                lcd_manager.start()
    except Exception as e:
        logger.error(f"Failed to start LCD manager on startup: {e}")

# Modify inside shutdown_event():
    global lcd_manager
    if lcd_manager:
        lcd_manager.stop()
```

- [ ] **Step 4: Run test to verify it passes**
Run: `PYTHONPATH=backend venv/bin/pytest backend/tests/test_lcd_manager.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**
Run:
```bash
git add backend/core/lcd/manager.py backend/main.py backend/tests/test_lcd_manager.py
git commit -m "feat(lcd): implement main lcd manager loop and startup integration hooks"
```

---

### Task 5: Probing & Auto-discovery API

**Files:**
- Create: `backend/tests/test_lcd_probe_api.py`
- Modify: `backend/main.py`

- [ ] **Step 1: Write the failing test**
Create `backend/tests/test_lcd_probe_api.py` with:
```python
import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_lcd_probe_endpoint():
    response = client.post("/settings/lcd/probe")
    assert response.status_code == 200
    assert "ports" in response.json()
```

- [ ] **Step 2: Run test to verify it fails**
Run: `PYTHONPATH=backend venv/bin/pytest backend/tests/test_lcd_probe_api.py -v`
Expected: FAIL with status code 404 (endpoint not defined).

- [ ] **Step 3: Write minimal implementation**
Modify `backend/main.py` to add endpoint:
```python
@app.post("/settings/lcd/probe")
def probe_lcd_ports():
    import serial.tools.list_ports
    from core.lcd.drivers.cfa635 import Cfa635Driver
    
    ports = serial.tools.list_ports.comports()
    detected_ports = []
    
    # List of registered drivers to try
    drivers = [Cfa635Driver]
    
    for port_info in ports:
        port_device = port_info.device
        for driver in drivers:
            if driver.probe(port_device):
                detected_ports.append({
                    "port": port_device,
                    "driver": driver.__name__,
                    "description": port_info.description
                })
                break
                
    return {"ports": detected_ports}
```

Also, modify `/api/status` endpoint to report LCD presence:
```python
# Modify inside read_root() in main.py:
@app.get("/api/status")
def read_root():
    global lcd_manager
    return {
        "status": "online", 
        "message": "FFMPEG Orchestrator API is running",
        "lcd": {
            "connected": lcd_manager is not None and lcd_manager._running,
            "port": lcd_manager.port if lcd_manager else None
        }
    }
```

- [ ] **Step 4: Run test to verify it passes**
Run: `PYTHONPATH=backend venv/bin/pytest backend/tests/test_lcd_probe_api.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**
Run:
```bash
git add backend/main.py backend/tests/test_lcd_probe_api.py
git commit -m "feat(lcd): add manual settings lcd probe endpoint and status reporting integration"
```
