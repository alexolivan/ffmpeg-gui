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
            self.driver.set_backlight(100)
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
        try:
            # Clear display and write offline notice
            self.driver.clear()
            self.driver.write_line(1, "   SYSTEM OFFLINE   ")
            self.driver.write_line(2, "  SERVICE STOPPED   ")
            # Turn off backlight
            self.driver.set_backlight(0)
            self.driver.disconnect()
        except Exception as e:
            logger.error(f"Error during LCD shutdown: {e}")

    def switch_to_view(self, new_view):
        try:
            self.current_view.on_exit()
        except Exception:
            pass
        self.current_view = new_view
        try:
            self.current_view.on_enter()
        except Exception:
            pass
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
                                    # We only trigger action on key press
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
