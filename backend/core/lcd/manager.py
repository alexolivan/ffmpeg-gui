import asyncio
import logging
import time
import struct
from typing import List, Optional
from .drivers.cfa635 import Cfa635Driver
from .views.dashboard import DashboardView

logger = logging.getLogger("LCD-Manager")

class LCDManager:
    key_map = {
        1: "UP",
        2: "DOWN",
        3: "LEFT",
        4: "RIGHT",
        5: "TICK",
        6: "X"
    }

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
        self._dim_task = None
        
        # Inactivity Dimming configuration
        self.active_brightness = 100
        self.dim_brightness = 20
        self.dim_timeout = 30
        self._last_activity = time.time()
        self._is_dimmed = False

        # Load values from DB settings if available
        if self.db_session_factory:
            db = self.db_session_factory()
            try:
                from database.models import SystemSettings
                settings = db.query(SystemSettings).first()
                if settings:
                    if settings.lcd_brightness is not None:
                        self.active_brightness = settings.lcd_brightness
                    if settings.lcd_dim_brightness is not None:
                        self.dim_brightness = settings.lcd_dim_brightness
                    if settings.lcd_dim_timeout is not None:
                        self.dim_timeout = settings.lcd_dim_timeout
            except Exception as e:
                logger.error(f"Failed to load LCD settings from DB: {e}")
            finally:
                db.close()

    def start(self):
        self._running = True
        try:
            self.driver.connect()
            self.driver.set_backlight(self.active_brightness)
            self.driver.clear()
            self._read_task = asyncio.create_task(self._read_loop())
            self._refresh_task = asyncio.create_task(self._refresh_loop())
            self._dim_task = asyncio.create_task(self._dim_loop())
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
        if self._dim_task:
            self._dim_task.cancel()
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

    def _register_activity(self):
        self._last_activity = time.time()
        if self._is_dimmed:
            self._is_dimmed = False
            if self.driver:
                try:
                    self.driver.set_backlight(self.active_brightness)
                except Exception:
                    pass

    async def _check_dim_timeout(self):
        if not self._is_dimmed and (time.time() - self._last_activity > self.dim_timeout):
            self._is_dimmed = True
            if self.driver:
                try:
                    self.driver.set_backlight(self.dim_brightness)
                except Exception:
                    pass

    async def _dim_loop(self):
        while self._running:
            try:
                await self._check_dim_timeout()
            except Exception:
                pass
            await asyncio.sleep(1.0)

    async def _read_loop(self):
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
                                    
                                    # Key codes 1-6 are pressed, 7-12 are released.
                                    # We only trigger action on key press (1-6).
                                    if key_code in self.key_map:
                                        self._register_activity()
                                        key_name = self.key_map[key_code]
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
