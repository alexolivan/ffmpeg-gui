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
        self._led_task = None
        self._db_poll_task = None
        self._locator_active = False
        self._cached_led_states = {
            "error_stream": False,
            "running_stream": False,
            "failed_task": False,
            "running_task": False,
            "cpu_high": False,
            "ram_high": False
        }
        
        # Inactivity Dimming configuration
        self.active_brightness = 100
        self.dim_brightness = 20
        self.dim_timeout = 30
        self._last_activity = time.time()
        self._is_dimmed = False

        # LED profiles
        self.lcd_led0_profile = "heartbeat"
        self.lcd_led1_profile = "streams"
        self.lcd_led2_profile = "tasks"
        self.lcd_led3_profile = "alert"

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
                    if settings.lcd_led0_profile is not None:
                        self.lcd_led0_profile = settings.lcd_led0_profile
                    if settings.lcd_led1_profile is not None:
                        self.lcd_led1_profile = settings.lcd_led1_profile
                    if settings.lcd_led2_profile is not None:
                        self.lcd_led2_profile = settings.lcd_led2_profile
                    if settings.lcd_led3_profile is not None:
                        self.lcd_led3_profile = settings.lcd_led3_profile
            except Exception as e:
                logger.error(f"Failed to load LCD settings from DB: {e}")
            finally:
                db.close()
        self._last_led_colors = [None] * 4

    @property
    def locator_active(self) -> bool:
        return self._locator_active

    @locator_active.setter
    def locator_active(self, val: bool):
        was_active = self._locator_active
        self._locator_active = val
        self._last_led_colors = [None] * 4
        if was_active and not val:
            # Re-initialize clean render check when locator completes
            self._last_rendered_lines = [""] * 4
            self.refresh_display()

    def set_led_color(self, led_idx: int, color: str):
        if self._last_led_colors[led_idx] == color:
            return
        
        gpos = {
            0: {"red": 12, "green": 11},
            1: {"red": 10, "green": 9},
            2: {"red": 8, "green": 7},
            3: {"red": 6, "green": 5}
        }.get(led_idx)
        if not gpos:
            return
        
        # Cache color state
        self._last_led_colors[led_idx] = color
        
        try:
            if color == "red":
                self.driver.set_gpo(gpos["red"], 100)
                self.driver.set_gpo(gpos["green"], 0)
            elif color == "green":
                self.driver.set_gpo(gpos["red"], 0)
                self.driver.set_gpo(gpos["green"], 100)
            elif color == "yellow":
                self.driver.set_gpo(gpos["red"], 100)
                self.driver.set_gpo(gpos["green"], 100)
            else: # off
                self.driver.set_gpo(gpos["red"], 0)
                self.driver.set_gpo(gpos["green"], 0)
        except Exception as e:
            logger.debug(f"Failed to set GPO state: {e}")

    async def _db_poll_loop(self):
        while self._running:
            try:
                if self.db_session_factory:
                    db = self.db_session_factory()
                    try:
                        # 1. Check streams/services
                        from database.models import MediaProcess
                        services = db.query(MediaProcess).filter(MediaProcess.type == 'service').all()
                        has_running = any(s.status == 'running' for s in services)
                        has_error = any(s.status == 'error' for s in services)
                        
                        # 2. Check tasks in last 24 hours
                        from database.models import TaskExecution
                        from datetime import datetime, timedelta
                        limit = datetime.utcnow() - timedelta(hours=24)
                        has_running_task = db.query(TaskExecution).filter(TaskExecution.status == 'running').count() > 0
                        has_failed_task = db.query(TaskExecution).filter(
                            TaskExecution.status.in_(['error', 'failed']),
                            TaskExecution.started_at >= limit
                        ).count() > 0
                        
                        self._cached_led_states["running_stream"] = has_running
                        self._cached_led_states["error_stream"] = has_error
                        self._cached_led_states["running_task"] = has_running_task
                        self._cached_led_states["failed_task"] = has_failed_task
                    except Exception as e:
                        logger.error(f"Error polling LED DB states: {e}")
                    finally:
                        db.close()
                
                # 3. Check CPU/RAM alert state
                import psutil
                cpu = psutil.cpu_percent()
                ram = psutil.virtual_memory().percent
                self._cached_led_states["cpu_high"] = cpu > 90
                self._cached_led_states["ram_high"] = ram > 90
                
            except Exception as e:
                logger.error(f"Error in db poll loop: {e}")
            await asyncio.sleep(2.0)

    async def _led_control_loop(self):
        locator_tick = 0
        while self._running:
            try:
                tick_10 = locator_tick % 10
                locator_tick += 1
                
                # Check locator active
                if self.locator_active:
                    # Locator mode: flashes all bicolor LEDs in red/green/yellow alternations at 2Hz
                    phase = locator_tick % 3
                    if phase == 0:
                        color = "red"
                    elif phase == 1:
                        color = "green"
                    else:
                        color = "yellow"
                    
                    for idx in range(4):
                        self.set_led_color(idx, color)
                    
                    # Overriding LCD display with a blinking rack locator screen
                    flash_phase = locator_tick % 2
                    if flash_phase == 0:
                        lines = [""] * (self.driver.rows if self.driver else 4)
                    else:
                        cols = self.driver.cols if self.driver else 20
                        rows = self.driver.rows if self.driver else 4
                        if cols == 16:
                            if rows == 2:
                                lines = [
                                    "  *** FINDME ***",
                                    "  RACK LOCATOR  "
                                ]
                            else:
                                lines = [
                                    "================",
                                    "  *** FINDME ***",
                                    "  RACK LOCATOR  ",
                                    "================"
                                ]
                        else:
                            if rows == 2:
                                lines = [
                                    "   *** FIND ME! *** ",
                                    "      RACK LOCATOR  "
                                ]
                            else:
                                lines = [
                                    "====================",
                                    "   *** FIND ME! *** ",
                                    "      RACK LOCATOR  ",
                                    "===================="
                                ]
                    if self.driver:
                        for row in range(self.driver.rows):
                            target_text = lines[row] if row < len(lines) else ""
                            if target_text != self._last_rendered_lines[row]:
                                self.driver.write_line(row, target_text)
                                self._last_rendered_lines[row] = target_text
                    
                    await asyncio.sleep(0.25)
                    continue
                
                # Normal mode: LED Profiles
                led_profiles = [
                    self.lcd_led0_profile,
                    self.lcd_led1_profile,
                    self.lcd_led2_profile,
                    self.lcd_led3_profile
                ]
                
                for idx, profile in enumerate(led_profiles):
                    color = "off"
                    if profile == "heartbeat":
                        # flash green for 100ms every 1s
                        if tick_10 == 0:
                            color = "green"
                        else:
                            color = "off"
                    elif profile == "streams":
                        if self._cached_led_states.get("error_stream"):
                            color = "red"
                        elif self._cached_led_states.get("running_stream"):
                            color = "green"
                        else:
                            color = "off"
                    elif profile == "tasks":
                        if self._cached_led_states.get("failed_task"):
                            color = "red"
                        elif self._cached_led_states.get("running_task"):
                            color = "green"
                        else:
                            color = "off"
                    elif profile == "alert":
                        if self._cached_led_states.get("cpu_high") or self._cached_led_states.get("ram_high"):
                            color = "red"
                        else:
                            color = "green"
                    
                    self.set_led_color(idx, color)
            except Exception as e:
                logger.error(f"Error in led control loop: {e}")
            await asyncio.sleep(0.1)

    def start(self):
        self._running = True
        try:
            self.driver.connect()
            self.driver.set_backlight(self.active_brightness)
            self.driver.clear()
            self._read_task = asyncio.create_task(self._read_loop())
            self._refresh_task = asyncio.create_task(self._refresh_loop())
            self._dim_task = asyncio.create_task(self._dim_loop())
            self._led_task = asyncio.create_task(self._led_control_loop())
            self._db_poll_task = asyncio.create_task(self._db_poll_loop())
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
        if self._led_task:
            self._led_task.cancel()
        if self._db_poll_task:
            self._db_poll_task.cancel()
        try:
            # Clear display and write offline notice
            self.driver.clear()
            self.driver.write_line(1, "   SYSTEM OFFLINE   ")
            self.driver.write_line(2, "  SERVICE STOPPED   ")
            # Turn off backlight
            self.driver.set_backlight(0)
            # Turn off all bicolor LEDs
            for pin in range(5, 13):
                self.driver.set_gpo(pin, 0)
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

    def get_led_legend_prefix(self, profile: str) -> str:
        if profile == "heartbeat":
            return "HB  "
        elif profile == "streams":
            return "SRV "
        elif profile == "tasks":
            return "TSK "
        elif profile == "alert":
            return "ERR "
        return "    "

    def refresh_display(self):
        try:
            # Check locator override first (handled in Task 5)
            # If locator is active, it will override the display. We can check self.locator_active.
            if getattr(self, "locator_active", False):
                # If locator is active, we let the locator drawing handle it, so we skip normal menu render.
                return

            led_profiles = [
                getattr(self, "lcd_led0_profile", "heartbeat"),
                getattr(self, "lcd_led1_profile", "streams"),
                getattr(self, "lcd_led2_profile", "tasks"),
                getattr(self, "lcd_led3_profile", "alert")
            ]

            lines = self.current_view.render()
            rows_limit = self.driver.rows if self.driver else 4
            for row in range(rows_limit):
                line_text = lines[row] if row < len(lines) else ""
                
                # Apply text ASCII cleaning
                from .views.base import clean_ascii
                cleaned_text = clean_ascii(line_text)
                
                # Truncate/pad to 16 characters content core
                trimmed_text = cleaned_text[:16].ljust(16)
                
                # Determine prefix / centering based on columns count
                cols = self.driver.cols if self.driver else 20
                if cols == 20:
                    from .drivers.cfa635 import Cfa635Driver
                    if self.driver and isinstance(self.driver, Cfa635Driver):
                        profile = led_profiles[row] if row < len(led_profiles) else "disabled"
                        prefix = self.get_led_legend_prefix(profile)
                        final_text = prefix + trimmed_text
                    else:
                        final_text = "  " + trimmed_text + "  "
                else:
                    final_text = trimmed_text
                
                # Dirty check optimization
                if final_text != self._last_rendered_lines[row]:
                    if self.driver:
                        self.driver.write_line(row, final_text)
                    self._last_rendered_lines[row] = final_text
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
                if self.driver.ser and self.driver.ser.is_open:
                    if self.driver.ser.in_waiting >= 2:
                        type_byte_arr = self.driver.ser.read(1)
                        if not type_byte_arr:
                            continue
                        type_byte = type_byte_arr[0]
                        
                        length_byte_arr = self.driver.ser.read(1)
                        if not length_byte_arr:
                            continue
                        length_byte = length_byte_arr[0]
                        
                        payload_len = length_byte
                        data_bytes = b""
                        if payload_len > 0:
                            data_bytes = self.driver.ser.read(payload_len)
                        
                        # Consume CRC (2 bytes)
                        self.driver.ser.read(2)
                        
                        # Process keypad event (type 0x80, data length 1)
                        if type_byte == 0x80 and length_byte == 1 and len(data_bytes) == 1:
                            key_code = data_bytes[0]
                            # Key codes 1-6 are pressed, 7-12 are released.
                            # We only trigger action on key press (1-6).
                            if key_code in self.key_map:
                                self._register_activity()
                                if getattr(self, "locator_active", False):
                                    # Any key press acknowledges/dismisses locator mode
                                    self.locator_active = False
                                    logger.info("Locator mode dismissed via local keypad press.")
                                else:
                                    key_name = self.key_map[key_code]
                                    self.current_view.handle_key(key_name)
                                    self.refresh_display()
                await asyncio.sleep(0.02)
            except Exception as e:
                logger.error(f"Error in read loop: {e}")
                await asyncio.sleep(1)

    async def _refresh_loop(self):
        while self._running:
            try:
                if self.current_view.requires_periodic_refresh:
                    self.refresh_display()
            except Exception:
                pass
            await asyncio.sleep(2.0)
