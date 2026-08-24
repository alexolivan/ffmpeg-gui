import os
import re
import glob
import time
import shutil
import logging
import asyncio
import subprocess
from typing import Dict, List, Optional, Any

logger = logging.getLogger("MagewellManager")


class MagewellManager:
    """
    Singleton class to manage Magewell Pro Capture & Eco Capture hardware on Linux.
    Parses native mwcap-info & mwcap-control CLI output, queries PCIe hardware buses,
    tracks real-time signal and FPGA temperature telemetry, and ensures safe hardware configuration.
    """

    _instance = None

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            cls._instance = super(MagewellManager, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if getattr(self, "_initialized", False):
            return
        self._initialized = True
        self._lock = asyncio.Lock()
        self._cached_driver_version: Optional[str] = None
        self._cached_driver_time: float = 0.0
        self._cached_pcie_devices: Optional[List[Dict[str, Any]]] = None
        self._cached_pcie_time: float = 0.0

    def clear_cache(self):
        """Invalidates in-memory caches."""
        self._cached_driver_version = None
        self._cached_driver_time = 0.0
        self._cached_pcie_devices = None
        self._cached_pcie_time = 0.0

    def get_pcie_devices(self) -> List[Dict[str, Any]]:
        """
        Scans host PCIe bus for Magewell capture cards (Vendor ID 1d44 or Nanjing Magewell).
        Cached with a 60-second TTL.
        """
        now = time.time()
        if self._cached_pcie_devices is not None and (now - self._cached_pcie_time < 60.0):
            return self._cached_pcie_devices

        devices = []
        lspci_bin = shutil.which("lspci")
        if lspci_bin:
            try:
                res = subprocess.run(
                    [lspci_bin, "-nn"],
                    capture_output=True,
                    text=True,
                    timeout=3
                )
                if res.returncode == 0:
                    for line in res.stdout.splitlines():
                        line_lower = line.lower()
                        if "magewell" in line_lower or "1d44:" in line_lower or ("multimedia" in line_lower and "0005" in line_lower) or ("multimedia" in line_lower and "0006" in line_lower):
                            parts = line.split(None, 1)
                            slot = parts[0] if parts else "unknown"
                            desc = parts[1] if len(parts) > 1 else line
                            devices.append({
                                "slot": slot,
                                "description": desc,
                                "is_magewell": True
                            })
            except Exception as e:
                logger.warning(f"Error scanning lspci for Magewell devices: {e}")

        # Fallback: scan sysfs if lspci is missing or empty
        if not devices:
            pci_nodes = glob.glob("/sys/bus/pci/devices/*")
            for node in pci_nodes:
                vendor_path = os.path.join(node, "vendor")
                device_path = os.path.join(node, "device")
                if os.path.exists(vendor_path):
                    try:
                        with open(vendor_path, "r") as f:
                            vendor_id = f.read().strip().lower()
                        if "0x1d44" in vendor_id:
                            dev_id = ""
                            if os.path.exists(device_path):
                                with open(device_path, "r") as f:
                                    dev_id = f.read().strip().lower()
                            devices.append({
                                "slot": os.path.basename(node),
                                "description": f"Magewell PCIe Device ({dev_id})",
                                "is_magewell": True
                            })
                    except Exception:
                        pass

        self._cached_pcie_devices = devices
        self._cached_pcie_time = now
        return devices

    def get_driver_version(self) -> Optional[str]:
        """
        Retrieves the version of the mwcap/ProCapture kernel driver. Cached with 60s TTL.
        """
        now = time.time()
        if self._cached_driver_version is not None and (now - self._cached_driver_time < 60.0):
            return self._cached_driver_version

        version = None
        # Check sysfs module version paths
        sys_paths = [
            "/sys/module/mwcap/version",
            "/sys/module/ProCapture/version",
            "/sys/module/procapture/version",
            "/sys/module/mwcap_procapture/version"
        ]
        for p in sys_paths:
            if os.path.exists(p):
                try:
                    with open(p, "r") as f:
                        v = f.read().strip()
                        if v:
                            version = v
                            break
                except Exception:
                    pass

        if not version:
            modinfo_bin = shutil.which("modinfo")
            if modinfo_bin:
                for mod_name in ["mwcap", "ProCapture", "procapture", "mwcap_procapture"]:
                    try:
                        res = subprocess.run(
                            [modinfo_bin, "-F", "version", mod_name],
                            capture_output=True,
                            text=True,
                            timeout=2
                        )
                        if res.returncode == 0 and res.stdout.strip():
                            version = res.stdout.strip()
                            break
                    except Exception:
                        pass

        self._cached_driver_version = version
        self._cached_driver_time = now
        return version

    def parse_mwcap_info_list(self, stdout: str) -> List[Dict[str, Any]]:
        """
        Parses `mwcap-info -l` tabular output:
        device path     firmware ver    hardware ver    driver ver      alsa name       device name                   
        /dev/video0     1.34            B               1.3.4429        hw:0,0          00:00 Pro Capture SDI
        """
        channels = []
        for line in stdout.splitlines():
            line = line.strip()
            if not line or line.startswith("total:") or line.startswith("device path") or line.startswith("#"):
                continue
            parts = line.split(None, 5)
            if len(parts) >= 6:
                dev_path = parts[0]
                fw_ver = parts[1]
                hw_ver = parts[2]
                drv_ver = parts[3]
                alsa_name = parts[4]
                dev_name = parts[5]

                board_id = 0
                channel_id = 0
                match = re.match(r"^(\d+):(\d+)\s*(.*)$", dev_name)
                product_name = dev_name
                if match:
                    board_id = int(match.group(1))
                    channel_id = int(match.group(2))
                    product_name = match.group(3).strip()

                channels.append({
                    "device_path": dev_path,
                    "firmware_version": fw_ver,
                    "hardware_version": hw_ver,
                    "driver_version": drv_ver,
                    "alsa_device": alsa_name,
                    "device_name": dev_name,
                    "product_name": product_name or dev_name,
                    "board_id": board_id,
                    "channel_id": channel_id,
                })
        return channels

    def parse_mwcap_info_detailed(self, stdout: str) -> Dict[str, Any]:
        """
        Parses `mwcap-info -i <device_path>` key-value sections.
        """
        info: Dict[str, Any] = {
            "family_name": "Pro Capture",
            "product_name": "Pro Capture Device",
            "serial_number": "",
            "hardware_version": "",
            "firmware_version": "",
            "driver_version": "",
            "board_id": 0,
            "channel_id": 0,
            "bus_address": "",
            "pcie_speed": "",
            "pcie_width": "",
            "temperature": "",
            "video_input": "Auto",
            "audio_input": "Auto",
            "signal_locked": False,
            "detected_mode": "No Signal",
            "aspect": "",
            "color_space": "",
            "quantization": "",
            "audio_format": "",
            "audio_channels": []
        }

        current_section = ""
        for line in stdout.splitlines():
            line_str = line.strip()
            if not line_str:
                continue

            if not line.startswith(" ") and not line.startswith("\t") and "." not in line:
                current_section = line_str.lower()
                continue

            if "." in line_str:
                parts = [p.strip() for p in line_str.split("...", 1)]
                if len(parts) == 2:
                    k = parts[0].strip().lower()
                    v = parts[1].lstrip(". ").strip()

                    if k == "family name":
                        info["family_name"] = v
                    elif k == "product name":
                        info["product_name"] = v
                    elif k == "serial number":
                        info["serial_number"] = v
                    elif k == "hardware version":
                        info["hardware_version"] = v
                    elif k == "firmware version":
                        info["firmware_version"] = v
                    elif k == "driver version":
                        info["driver_version"] = v
                    elif k == "board id":
                        try: info["board_id"] = int(v)
                        except: pass
                    elif k == "channel id":
                        try: info["channel_id"] = int(v)
                        except: pass
                    elif k == "bus address":
                        info["bus_address"] = v
                    elif k == "pcie speed":
                        info["pcie_speed"] = v
                    elif k == "pcie width":
                        info["pcie_width"] = v
                    elif k == "chipset temperature":
                        info["temperature"] = v
                    elif k == "video input":
                        info["video_input"] = v
                    elif k == "audio input":
                        info["audio_input"] = v
                    elif k == "signal state":
                        info["signal_locked"] = (v.lower() == "locked")
                    elif k == "resolution":
                        info["detected_mode"] = v
                    elif k == "aspect":
                        info["aspect"] = v
                    elif k == "color space":
                        info["color_space"] = v
                    elif k == "quantization":
                        info["quantization"] = v
                    elif k == "audio format":
                        info["audio_format"] = v
                    elif "channel " in k:
                        info["audio_channels"].append({"pair": k, "status": v})

        return info

    def _find_active_services(self, device_path: str, alsa_dev: str, db_session) -> List[str]:
        """Cross-references active FFmpeg services capturing from this Magewell channel."""
        active_names = []
        if not db_session:
            return active_names

        try:
            import json
            try:
                from database.models import Service
            except ImportError:
                from backend.database.models import Service
            running_services = db_session.query(Service).filter(Service.status == "running").all()
            for s in running_services:
                if not s.config:
                    continue
                cfg = s.config if isinstance(s.config, dict) else json.loads(s.config)
                
                inputs_to_check = []
                in_cfg = cfg.get("input_config", {})
                if in_cfg:
                    inputs_to_check.append(in_cfg)
                    if in_cfg.get("input1"):
                        inputs_to_check.append(in_cfg.get("input1"))
                    if in_cfg.get("input2"):
                        inputs_to_check.append(in_cfg.get("input2"))
                
                matched = False
                for inp in inputs_to_check:
                    i_type = inp.get("type", "")
                    i_dev = inp.get("device", "") or inp.get("path", "")
                    i_audio = inp.get("audio_device", "") or inp.get("alsa_device", "")
                    
                    if i_type == "v4l2" and (device_path in i_dev or i_dev in device_path):
                        matched = True
                        break
                    if i_type == "alsa" and alsa_dev and (alsa_dev in i_audio or alsa_dev in i_dev):
                        matched = True
                        break

                if matched:
                    active_names.append(f"{s.name} (ID: {s.id}) [INPUT]")
        except Exception as e:
            logger.debug(f"Error querying active services for Magewell device: {e}")

        return active_names

    def get_system_status(self, db_session=None) -> Dict[str, Any]:
        """
        Aggregates host Magewell hardware ecosystem state:
        - PCIe hardware presence
        - Driver status (mwcap)
        - Tool utilities (mwcap-info, mwcap-control)
        - Grouped cards and channels with live telemetry
        """
        pcie_devs = self.get_pcie_devices()
        has_pcie = len(pcie_devs) > 0

        mwcap_info_bin = shutil.which("mwcap-info")
        mwcap_control_bin = shutil.which("mwcap-control")
        utils_available = (mwcap_info_bin is not None)

        driver_ver = self.get_driver_version()
        driver_loaded = (driver_ver is not None) or os.path.exists("/sys/module/mwcap")

        channels_list = []
        if mwcap_info_bin:
            try:
                res = subprocess.run(
                    [mwcap_info_bin, "-l"],
                    capture_output=True,
                    text=True,
                    timeout=3
                )
                if res.returncode == 0 and res.stdout.strip():
                    parsed_channels = self.parse_mwcap_info_list(res.stdout)
                    for ch in parsed_channels:
                        dev_path = ch["device_path"]
                        # Fetch detailed live telemetry for this channel
                        try:
                            d_res = subprocess.run(
                                [mwcap_info_bin, "-i", dev_path],
                                capture_output=True,
                                text=True,
                                timeout=2
                            )
                            if d_res.returncode == 0:
                                detailed = self.parse_mwcap_info_detailed(d_res.stdout)
                                ch.update(detailed)
                        except Exception as e:
                            logger.debug(f"Error fetching detailed info for {dev_path}: {e}")

                        # Check active processes
                        ch["active_services"] = self._find_active_services(dev_path, ch.get("alsa_device", ""), db_session)
                        channels_list.append(ch)
            except Exception as e:
                logger.warning(f"Error running mwcap-info -l: {e}")

        # Group channels by board_id / serial_number into cards
        cards_dict: Dict[str, Dict[str, Any]] = {}
        for ch in channels_list:
            b_id = ch.get("board_id", 0)
            s_num = ch.get("serial_number", "")
            card_key = f"{b_id}_{s_num}" if s_num else str(b_id)

            if card_key not in cards_dict:
                cards_dict[card_key] = {
                    "board_id": b_id,
                    "product_name": ch.get("product_name", "Pro Capture Device"),
                    "serial_number": s_num,
                    "firmware_version": ch.get("firmware_version", ""),
                    "hardware_version": ch.get("hardware_version", ""),
                    "driver_version": ch.get("driver_version", driver_ver or ""),
                    "num_channels": 0,
                    "channels": []
                }
            cards_dict[card_key]["channels"].append(ch)
            cards_dict[card_key]["num_channels"] = len(cards_dict[card_key]["channels"])

        cards = list(cards_dict.values())

        # Determine overall system status
        if channels_list:
            status_code = "READY"
            driver_loaded = True
            if not driver_ver and channels_list[0].get("driver_version"):
                driver_ver = channels_list[0]["driver_version"]
        elif has_pcie and not driver_loaded:
            status_code = "SETUP_REQUIRED"
        elif has_pcie and not utils_available:
            status_code = "UTILITIES_MISSING"
        else:
            status_code = "NO_DEVICES"

        return {
            "driver_installed": driver_loaded,
            "driver_version": driver_ver,
            "utilities_available": utils_available,
            "pcie_hardware_detected": has_pcie,
            "pcie_devices": pcie_devs,
            "status": status_code,
            "total_channels": len(channels_list),
            "cards": cards
        }

    async def configure_channel(self, device_id: str, config_payload: Dict[str, Any], db_session=None) -> Dict[str, Any]:
        """
        Executes mwcap-control commands safely to reconfigure hardware properties.
        device_id can be device path (/dev/video0) or Board:Channel (0:0).
        """
        mwcap_control_bin = shutil.which("mwcap-control")
        if not mwcap_control_bin:
            return {
                "success": False,
                "error": "mwcap-control utility not found in system path"
            }

        # Format target device specifier
        target_dev = device_id.strip()

        # Check for active service conflicts
        if db_session:
            active = self._find_active_services(target_dev, "", db_session)
            if active:
                return {
                    "success": False,
                    "error": f"Cannot reconfigure channel while active service(s) are using it: {', '.join(active)}"
                }

        errors = []

        # 1. Video Input Source
        video_input = config_payload.get("video_input")
        if video_input:
            v_val = str(video_input).lower()
            valid_v = ["auto", "sdi", "hdmi", "vga", "component", "cvbs", "yc", "dvi"]
            if v_val in valid_v:
                cmd = [mwcap_control_bin, "--video-input", v_val, target_dev]
                res = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
                if res.returncode != 0:
                    errors.append(f"Failed to set video input: {res.stderr.strip() or res.stdout.strip()}")

        # 2. Audio Input Source
        audio_input = config_payload.get("audio_input")
        if audio_input:
            a_val = str(audio_input).lower()
            valid_a = ["auto", "sdi", "hdmi", "line_in", "mic_in"]
            if a_val in valid_a:
                cmd = [mwcap_control_bin, "--audio-input", a_val, target_dev]
                res = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
                if res.returncode != 0:
                    errors.append(f"Failed to set audio input: {res.stderr.strip() or res.stdout.strip()}")

        # 3. Video Output Low Latency
        low_latency = config_payload.get("low_latency")
        if low_latency is not None:
            l_val = "on" if low_latency in [True, "on", "1", 1] else "off"
            cmd = [mwcap_control_bin, "--video-output-lowlatency", l_val, target_dev]
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
            if res.returncode != 0:
                errors.append(f"Failed to set low latency: {res.stderr.strip() or res.stdout.strip()}")

        # 4. Hardware Deinterlace
        deinterlace = config_payload.get("deinterlace")
        if deinterlace:
            d_val = str(deinterlace).lower()
            valid_d = ["weave", "blend", "top_field", "bottom_field"]
            if d_val in valid_d:
                cmd = [mwcap_control_bin, "--video-output-deinterlace", d_val, target_dev]
                res = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
                if res.returncode != 0:
                    errors.append(f"Failed to set deinterlace mode: {res.stderr.strip() or res.stdout.strip()}")

        # 5. LED Mode
        led_mode = config_payload.get("led_mode")
        if led_mode:
            led_val = str(led_mode).lower()
            valid_led = ["auto", "off", "on", "blink", "dbl_blink", "breath"]
            if led_val in valid_led:
                cmd = [mwcap_control_bin, "--led", led_val, target_dev]
                res = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
                if res.returncode != 0:
                    errors.append(f"Failed to set LED mode: {res.stderr.strip() or res.stdout.strip()}")

        if errors:
            return {
                "success": False,
                "error": "; ".join(errors)
            }

        return {
            "success": True,
            "message": "Magewell channel configuration applied successfully."
        }


magewell_manager = MagewellManager()
