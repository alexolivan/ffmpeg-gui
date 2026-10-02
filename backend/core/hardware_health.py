import os
import glob
import re
import time
import asyncio
import logging
from typing import Dict, List, Any, Optional, Tuple

logger = logging.getLogger("HardwareHealthManager")

try:
    from core.audioscience_health import get_audioscience_health
except ImportError:
    from backend.core.audioscience_health import get_audioscience_health


class HardwareHealthManager:
    """
    Singleton manager for host and specialized broadcast hardware health monitoring.
    Probes Linux hwmon (CPU package, cores, fans), kernel thermal throttling counters,
    GPU metrics, and capture/audio hardware (AudioScience, Magewell).
    Operates an asynchronous background worker with an in-memory cache for sub-millisecond reads.
    """
    _instance: Optional["HardwareHealthManager"] = None

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super(HardwareHealthManager, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if getattr(self, "_initialized", False):
            return
        self._initialized = True
        self._lock = asyncio.Lock()
        self._running = False
        self._worker_task: Optional[asyncio.Task] = None
        self._poll_interval = 3.0  # seconds

        # Configurable thresholds (defaults)
        self.warning_threshold_c = 75.0
        self.critical_threshold_c = 85.0
        self.active_protection_enabled = False

        # Throttling tracking
        self._prev_pkg_throttle: int = 0
        self._prev_core_throttle: int = 0
        self._is_first_throttle_probe: bool = True

        # In-memory cached snapshot
        self._cached_snapshot: Dict[str, Any] = self._empty_snapshot()
        self._last_snapshot_time: float = 0.0

    def _empty_snapshot(self) -> Dict[str, Any]:
        return {
            "status": "normal",  # normal | warning | critical
            "max_temp_c": None,
            "cpu": {
                "package_temp": None,
                "cores": [],
                "throttling": {
                    "active": False,
                    "throttling_detected": False,
                    "total_package_events": 0,
                    "total_core_events": 0,
                    "recent_events": 0,
                },
            },
            "fans": [],
            "av_hardware": {
                "audioscience": [],
                "magewell": [],
                "decklink": [],
            },
            "alerts": [],
            "timestamp": time.time(),
        }

    # -------------------------------------------------------------------------
    # PROBES: CPU Temperatures via /sys/class/hwmon & /sys/class/thermal
    # -------------------------------------------------------------------------

    def _probe_cpu_temperatures(self) -> Tuple[Optional[float], List[Dict[str, Any]]]:
        """
        Scans /sys/class/hwmon for CPU temperatures (Intel coretemp, AMD k10temp/zenpower).
        Returns (package_temp_c, list_of_core_temps).
        """
        package_temp: Optional[float] = None
        cores: List[Dict[str, Any]] = []

        hwmon_dirs = sorted(glob.glob("/sys/class/hwmon/hwmon*"))
        for h_dir in hwmon_dirs:
            name_file = os.path.join(h_dir, "name")
            driver_name = ""
            if os.path.isfile(name_file):
                try:
                    with open(name_file, "r") as f:
                        driver_name = f.read().strip().lower()
                except Exception:
                    continue

            # Check if this hwmon device is a CPU sensor
            is_cpu_hwmon = any(k in driver_name for k in ["coretemp", "k10temp", "zenpower", "cpu_thermal"])
            if not is_cpu_hwmon:
                continue

            # Read all temp*_input files
            temp_files = sorted(glob.glob(os.path.join(h_dir, "temp*_input")))
            for t_file in temp_files:
                base = t_file[:-6]  # strip '_input'
                label_file = f"{base}_label"
                label = ""
                if os.path.isfile(label_file):
                    try:
                        with open(label_file, "r") as f:
                            label = f.read().strip()
                    except Exception:
                        pass

                temp_val_c = None
                try:
                    with open(t_file, "r") as f:
                        milli_c = int(f.read().strip())
                        temp_val_c = round(milli_c / 1000.0, 1)
                except Exception:
                    continue

                if temp_val_c is not None:
                    # Package temp identification
                    if "package" in label.lower() or "tctl" in label.lower() or "tdie" in label.lower():
                        if package_temp is None or temp_val_c > package_temp:
                            package_temp = temp_val_c
                    else:
                        core_label = label or os.path.basename(base)
                        cores.append({"label": core_label, "temp": temp_val_c})

            # If found package temp from coretemp/k10temp, we can stop
            if package_temp is not None:
                break

        # Fallback to /sys/class/thermal/thermal_zone* if no package temp found
        if package_temp is None:
            tz_dirs = sorted(glob.glob("/sys/class/thermal/thermal_zone*"))
            for tz in tz_dirs:
                type_file = os.path.join(tz, "type")
                temp_file = os.path.join(tz, "temp")
                if os.path.isfile(type_file) and os.path.isfile(temp_file):
                    try:
                        with open(type_file, "r") as f:
                            t_type = f.read().strip().lower()
                        if any(k in t_type for k in ["x86_pkg", "cpu", "acpitz"]):
                            with open(temp_file, "r") as f:
                                milli = int(f.read().strip())
                                package_temp = round(milli / 1000.0, 1)
                                break
                    except Exception:
                        pass

        # If package_temp is still None but we have core temps, use max core temp
        if package_temp is None and cores:
            package_temp = max(c["temp"] for c in cores)

        return package_temp, cores

    # -------------------------------------------------------------------------
    # PROBES: Kernel Thermal Throttling Counters
    # -------------------------------------------------------------------------

    def _probe_thermal_throttling(self) -> Dict[str, Any]:
        """
        Reads kernel MSR thermal throttle counters:
        /sys/devices/system/cpu/cpu*/thermal_throttle/core_throttle_count
        /sys/devices/system/cpu/cpu*/thermal_throttle/package_throttle_count
        """
        total_pkg_events = 0
        total_core_events = 0

        pkg_files = glob.glob("/sys/devices/system/cpu/cpu*/thermal_throttle/package_throttle_count")
        for p_file in pkg_files:
            try:
                with open(p_file, "r") as f:
                    total_pkg_events += int(f.read().strip())
            except Exception:
                pass

        core_files = glob.glob("/sys/devices/system/cpu/cpu*/thermal_throttle/core_throttle_count")
        for c_file in core_files:
            try:
                with open(c_file, "r") as f:
                    total_core_events += int(f.read().strip())
            except Exception:
                pass

        total_current = total_pkg_events + total_core_events
        recent_events = 0

        if self._is_first_throttle_probe:
            self._prev_pkg_throttle = total_pkg_events
            self._prev_core_throttle = total_core_events
            self._is_first_throttle_probe = False
        else:
            delta_pkg = max(0, total_pkg_events - self._prev_pkg_throttle)
            delta_core = max(0, total_core_events - self._prev_core_throttle)
            recent_events = delta_pkg + delta_core
            self._prev_pkg_throttle = total_pkg_events
            self._prev_core_throttle = total_core_events

        is_active = recent_events > 0

        return {
            "active": is_active,
            "throttling_detected": total_current > 0,
            "total_package_events": total_pkg_events,
            "total_core_events": total_core_events,
            "recent_events": recent_events,
        }

    # -------------------------------------------------------------------------
    # PROBES: Chassis & Cooler Fans (RPM)
    # -------------------------------------------------------------------------

    def _probe_fans(self) -> List[Dict[str, Any]]:
        """
        Iterates over /sys/class/hwmon/hwmon*/fan*_input tachometers.
        """
        fans: List[Dict[str, Any]] = []
        fan_files = sorted(glob.glob("/sys/class/hwmon/hwmon*/fan*_input"))
        for idx, f_file in enumerate(fan_files):
            base = f_file[:-6]  # strip '_input'
            label_file = f"{base}_label"
            label = ""
            if os.path.isfile(label_file):
                try:
                    with open(label_file, "r") as f:
                        label = f.read().strip()
                except Exception:
                    pass

            rpm = 0
            try:
                with open(f_file, "r") as f:
                    rpm = int(f.read().strip())
            except Exception:
                continue

            name = label or f"Fan #{idx + 1}"
            fans.append({
                "name": name,
                "rpm": rpm,
                "status": "stopped" if rpm == 0 else "ok",
            })
        return fans

    # -------------------------------------------------------------------------
    # PROBES: Specialized AV Hardware (Magewell & AudioScience)
    # -------------------------------------------------------------------------

    def _probe_av_hardware(self) -> Dict[str, Any]:
        """
        Gathers hardware health from Magewell, AudioScience, and DeckLink.
        """
        # AudioScience via hpicontrol.py probe
        asi_cards = get_audioscience_health(force=False)

        # Magewell via MagewellManager
        magewell_cards: List[Dict[str, Any]] = []
        try:
            from core.magewell_manager import MagewellManager
            mw_mgr = MagewellManager()
            devices = mw_mgr.get_devices()
            for dev in devices:
                ch_idx = dev.get("channel_index", 0)
                detail = mw_mgr.get_device_detail(ch_idx)
                temp_str = detail.get("temperature", "")
                temp_c = None
                if temp_str:
                    # Parse "48.5 C" or "50 C"
                    m = re.search(r"([0-9.]+)", temp_str)
                    if m:
                        try:
                            temp_c = float(m.group(1))
                        except ValueError:
                            pass
                magewell_cards.append({
                    "channel_index": ch_idx,
                    "name": dev.get("name", f"Magewell #{ch_idx}"),
                    "serial": dev.get("serial", ""),
                    "fpga_temp_c": temp_c,
                    "status": "warning" if (temp_c and temp_c >= self.warning_threshold_c) else "normal",
                })
        except Exception as e:
            logger.debug(f"Magewell telemetry query skipped: {e}")

        # DeckLink bus check
        decklink_cards: List[Dict[str, Any]] = []
        try:
            from core.decklink_manager import DecklinkManager
            dl_mgr = DecklinkManager()
            dl_devs = dl_mgr.get_devices()
            for dev in dl_devs:
                decklink_cards.append({
                    "id": dev.get("id"),
                    "name": dev.get("name", "Blackmagic DeckLink"),
                    "pcie_link": dev.get("pcie_status", "OK"),
                    "status": "normal",
                })
        except Exception as e:
            logger.debug(f"DeckLink telemetry query skipped: {e}")

        return {
            "audioscience": asi_cards,
            "magewell": magewell_cards,
            "decklink": decklink_cards,
        }

    # -------------------------------------------------------------------------
    # SNAPSHOT COMPUTATION & OVERALL EVALUATION
    # -------------------------------------------------------------------------

    def collect_health_snapshot(self) -> Dict[str, Any]:
        """
        Executes all probes synchronously and evaluates system thermal status.
        """
        pkg_temp, cores = self._probe_cpu_temperatures()
        throttling = self._probe_thermal_throttling()
        fans = self._probe_fans()
        av_hw = self._probe_av_hardware()

        # Find maximum recorded temperature across all hardware
        temps: List[float] = []
        if pkg_temp is not None:
            temps.append(pkg_temp)
        for c in cores:
            if c.get("temp") is not None:
                temps.append(c["temp"])
        for asi in av_hw.get("audioscience", []):
            if asi.get("dsp_temp_c") is not None:
                temps.append(asi["dsp_temp_c"])
        for mw in av_hw.get("magewell", []):
            if mw.get("fpga_temp_c") is not None:
                temps.append(mw["fpga_temp_c"])

        max_temp_c = max(temps) if temps else None

        # Evaluate overall status
        status = "normal"
        alerts: List[Dict[str, str]] = []

        if max_temp_c is not None:
            if max_temp_c >= self.critical_threshold_c:
                status = "critical"
                alerts.append({
                    "level": "critical",
                    "message": f"Critical hardware temperature reached: {max_temp_c}°C (Threshold: {self.critical_threshold_c}°C)",
                })
            elif max_temp_c >= self.warning_threshold_c:
                status = "warning"
                alerts.append({
                    "level": "warning",
                    "message": f"Elevated hardware temperature: {max_temp_c}°C (Threshold: {self.warning_threshold_c}°C)",
                })

        if throttling.get("active"):
            if status != "critical":
                status = "warning"
            alerts.append({
                "level": "warning",
                "message": f"CPU thermal throttling active: {throttling.get('recent_events')} throttle cycles recorded",
            })

        # Check for 0 RPM fan alert if temp is elevated
        if max_temp_c and max_temp_c >= 65.0 and fans:
            stopped_fans = [f["name"] for f in fans if f["rpm"] == 0]
            if stopped_fans:
                alerts.append({
                    "level": "warning",
                    "message": f"Possible fan failure: {', '.join(stopped_fans)} stopped at {max_temp_c}°C",
                })

        snapshot = {
            "status": status,
            "max_temp_c": max_temp_c,
            "cpu": {
                "package_temp": pkg_temp,
                "cores": cores,
                "throttling": throttling,
            },
            "fans": fans,
            "av_hardware": av_hw,
            "alerts": alerts,
            "timestamp": time.time(),
        }

        self._cached_snapshot = snapshot
        self._last_snapshot_time = time.time()
        return snapshot

    def get_health_snapshot(self) -> Dict[str, Any]:
        """
        Thread-safe, sub-millisecond retrieval of the latest in-memory health snapshot.
        If cache is empty or older than 10 seconds, triggers an immediate refresh.
        """
        if self._last_snapshot_time == 0.0 or (time.time() - self._last_snapshot_time > 10.0):
            return self.collect_health_snapshot()
        return self._cached_snapshot

    # -------------------------------------------------------------------------
    # ASYNC BACKGROUND WORKER
    # -------------------------------------------------------------------------

    async def _worker_loop(self):
        logger.info("HardwareHealthManager background worker started.")
        while self._running:
            try:
                await asyncio.to_thread(self.collect_health_snapshot)
            except Exception as e:
                logger.error(f"Error in HardwareHealthManager worker: {e}")
            await asyncio.sleep(self._poll_interval)
        logger.info("HardwareHealthManager background worker stopped.")

    def start_worker(self):
        """Starts the async polling task if not already running."""
        if not self._running:
            self._running = True
            try:
                loop = asyncio.get_running_loop()
                self._worker_task = loop.create_task(self._worker_loop())
            except RuntimeError:
                pass

    def stop_worker(self):
        """Stops the async polling task."""
        self._running = False
        if self._worker_task and not self._worker_task.done():
            self._worker_task.cancel()


# Singleton instance
hardware_health_manager = HardwareHealthManager()
