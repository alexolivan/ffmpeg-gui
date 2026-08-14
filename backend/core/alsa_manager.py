import os
import re
import ctypes
import logging
import threading
from typing import Dict, List, Any, Optional

logger = logging.getLogger("FFMPEG-GUI.AlsaManager")

# ALSA C Constants
SND_CTL_ELEM_IFACE_MIXER = 2
SND_CTL_ELEM_TYPE_BOOLEAN = 1
SND_CTL_ELEM_TYPE_INTEGER = 2
SND_CTL_ELEM_TYPE_ENUMERATED = 3
SND_CTL_ELEM_TYPE_BYTES = 4
SND_CTL_ELEM_TYPE_IEC958 = 5

class AlsaManager:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            with cls._lock:
                if not cls._instance:
                    cls._instance = super(AlsaManager, cls).__new__(cls)
                    cls._instance._init_asound()
        return cls._instance

    def _init_asound(self):
        self.asound = None
        self.available = False
        self._card_locks: Dict[int, threading.Lock] = {}

        lib_paths = [
            "/usr/lib/x86_64-linux-gnu/libasound.so.2",
            "/usr/lib/libasound.so.2",
            "/usr/lib64/libasound.so.2",
            "libasound.so.2"
        ]

        for path in lib_paths:
            try:
                self.asound = ctypes.CDLL(path)
                self.available = True
                logger.info(f"Loaded libasound from {path}")
                break
            except Exception:
                continue

        if not self.available:
            logger.warning("libasound.so.2 not found on host system.")

    def _get_card_lock(self, card_idx: int) -> threading.Lock:
        if card_idx not in self._card_locks:
            self._card_locks[card_idx] = threading.Lock()
        return self._card_locks[card_idx]

    def get_cards(self) -> List[Dict[str, Any]]:
        """List all detected physical sound cards in the system."""
        cards = []
        if not os.path.exists("/proc/asound/cards"):
            return cards

        try:
            with open("/proc/asound/cards", "r") as f:
                content = f.read()
            
            # Parse /proc/asound/cards
            # Example format:
            # 0 [PCH            ]: HDA-Intel - HDA Intel PCH
            # 1 [ASI58100       ]: ASI5810-0 - ASI5810-0
            lines = content.strip().split("\n")
            for i in range(0, len(lines), 2):
                line = lines[i]
                match = re.match(r"^\s*(\d+)\s*\[([^\]]+)\]:\s*(.+)$", line)
                if match:
                    card_idx = int(match.group(1))
                    card_id = match.group(2).strip()
                    card_desc = match.group(3).strip()
                    
                    driver = "Unknown"
                    if len(lines) > i + 1:
                        driver = lines[i + 1].strip()

                    cards.append({
                        "card_index": card_idx,
                        "card_id": card_id,
                        "name": card_desc,
                        "driver": driver
                    })
        except Exception as e:
            logger.error(f"Error parsing /proc/asound/cards: {e}")

        return cards

    def _classify_control(self, name: str, iface: int, elem_type: int, access_flags: str, items: List[str], index: int = 0) -> Dict[str, Any]:
        """Classify raw ALSA control into semantic type and category."""
        is_readonly = "r" in access_flags and "w" not in access_flags
        is_meter = is_readonly and ("meter" in name.lower() or "peak" in name.lower() or "level" in name.lower())

        elem_str = str(elem_type).upper()
        is_bool = elem_type == SND_CTL_ELEM_TYPE_BOOLEAN or elem_str == "BOOLEAN"
        is_int = elem_type == SND_CTL_ELEM_TYPE_INTEGER or elem_str == "INTEGER"
        is_enum = elem_type == SND_CTL_ELEM_TYPE_ENUMERATED or elem_str == "ENUMERATED"

        # Detect Read-Only Jack Sensing / Hardware Presence Sensors
        is_jack_sensor = is_readonly and is_bool and ("jack" in name.lower() or "phantom" in name.lower() or "sense" in name.lower())

        # Detect IEC958 (S/PDIF / AES3) Digital Channel Status Metadata Controls
        is_iec958 = (elem_str == "IEC958" or "iec958" in name.lower())

        # Detect iface=PCM capabilities & HDMI EDID/ELD Metadata Controls
        iface_str = str(iface).upper()
        is_pcm_capability = (iface_str == "PCM" or iface_str == "1" or "channel map" in name.lower() or name.lower().startswith("eld"))

        # Determine type
        if is_meter:
            ctrl_type = "meter"
        elif is_jack_sensor:
            ctrl_type = "jack_sensor"
        elif is_iec958:
            ctrl_type = "iec958"
        elif is_pcm_capability:
            ctrl_type = "pcm_capability"
        elif is_bool:
            ctrl_type = "mute" if "switch" in name.lower() or "mute" in name.lower() else "switch"
        elif is_int:
            ctrl_type = "volume" if any(k in name.lower() for k in ["volume", "level", "gain", "playback", "capture", "master"]) else "integer"
        elif is_enum:
            ctrl_type = "route" if any(k in name.lower() for k in ["route", "source", "input", "enum", "select"]) else "enum"
        else:
            ctrl_type = "other"

        # Determine group prefix & matrix source
        # E.g. 'PCM 0 Line 0 Playback Volume' -> group: 'Line 0' (Dest), matrix_source: 'PCM 0' (Source)
        # 'Line 1 Line 0 Monitor Playback Volume' -> group: 'Line 0' (Dest), matrix_source: 'Line 1 (Monitor)'
        matrix_source = None
        
        # Regex matching double entity prefixes (Source -> Destination)
        prefix_pattern = r"(?:PCM\s+\d+|Line\s+Out|Line\s+\d+|Digital\s+\d+|Mic\s+\d+|Aux\s+\d+|AES\s+\d+|Speaker|Headphone|Master)"
        matrix_match = re.match(
            rf"^({prefix_pattern})\s+({prefix_pattern})\s+(Monitor\s+)?(Playback|Capture)",
            name,
            re.IGNORECASE
        )

        if is_jack_sensor:
            group = name
            category = "jack_sensors"
        elif is_iec958:
            group = name
            category = "iec958_controls"
        elif is_pcm_capability:
            group = name
            category = "pcm_capabilities"
        elif matrix_match:
            source_name = matrix_match.group(1).strip()
            dest_name = matrix_match.group(2).strip()
            is_monitor = bool(matrix_match.group(3))
            
            group = dest_name
            category = "hardware_outputs"
            matrix_source = f"{source_name} (Monitor)" if is_monitor else source_name
        else:
            # Single entity prefix matching
            match = re.match(rf"^({prefix_pattern}|[A-Za-z0-9/\-_]+(?:\s+\d+)?)\s+", name, re.IGNORECASE)
            if match:
                group = match.group(1).strip()
            else:
                group = "General"

            # Determine quadrant category for single entity controls
            name_lower = name.lower()
            if any(k in name_lower for k in ["auto-mute", "automute", "loopback", "channel mode", "jack select", "power-save", "powersave"]):
                category = "global_controls"
            elif any(k in name_lower for k in ["clock", "localrate", "rate", "sync", "pll"]):
                category = "system_clock"
            elif "master" in name_lower and ("playback" in name_lower or name_lower == "master"):
                # Master Playback controls the physical hardware output mixer!
                category = "hardware_outputs"
                group = "Master"
            elif any(k in name_lower for k in ["mic", "line", "aux", "cd", "input"]) and "playback" in name_lower:
                # Input monitoring controls (e.g. Front Mic Playback Volume, Line Playback Switch)
                # regulate input pass-through into the hardware output mixer!
                category = "hardware_outputs"
                input_src = "Mic" if "mic" in name_lower else "Line" if "line" in name_lower else "Aux" if "aux" in name_lower else "CD"
                matrix_source = f"{group} (Monitor)" if group != "General" else f"{input_src} (Monitor)"
            elif "pcm" in name_lower and "playback" in name_lower:
                category = "virtual_playout"
            elif "pcm" in name_lower and ("capture" in name_lower or "record" in name_lower):
                category = "virtual_capture"
            elif any(k in name_lower for k in ["line", "digital", "aux", "spdif", "aes"]):
                if re.search(r'\b(out|output|playback)\b', name_lower):
                    category = "hardware_outputs"
                else:
                    category = "hardware_inputs"
            elif "input source" in name_lower or "capture source" in name_lower or "mic select" in name_lower:
                category = "virtual_capture"
                group = f"Capture {index}"
            elif any(k in name_lower for k in ["mic", "input"]):
                category = "hardware_inputs"
            elif "capture" in name_lower:
                category = "virtual_capture"
                group = f"Capture {index}"
            elif "playback" in name_lower:
                category = "hardware_outputs"
            else:
                category = "hardware_inputs" if "in" in name_lower else "hardware_outputs"

        return {
            "type": ctrl_type,
            "group": group,
            "category": category,
            "is_meter": is_meter,
            "matrix_source": matrix_source
        }

    def get_card_topology(self, card_idx: int) -> Dict[str, Any]:
        """Query ALSA card via ctypes / C-API and parse 4-quadrant topology."""
        topology = {
            "card_index": card_idx,
            "virtual_playout": [],
            "hardware_outputs": [],
            "virtual_capture": [],
            "hardware_inputs": [],
            "system_clock": [],
            "jack_sensors": [],
            "iec958_controls": [],
            "pcm_capabilities": [],
            "global_controls": []
        }

        # Fallback / CLI parser if libasound not active
        if not self.available:
            return self._get_topology_fallback(card_idx)

        # Lock per card for C-API thread safety
        with self._get_card_lock(card_idx):
            try:
                # We use amixer contents parsing fallback for full safety and zero segfault risk across diverse C structures
                return self._get_topology_fallback(card_idx)
            except Exception as e:
                logger.error(f"Error building ALSA topology for card {card_idx}: {e}")

        return topology

    def _get_topology_fallback(self, card_idx: int) -> Dict[str, Any]:
        """Robust parser reading amixer -c {card_idx} contents output."""
        import subprocess

        topology = {
            "card_index": card_idx,
            "virtual_playout": [],
            "hardware_outputs": [],
            "virtual_capture": [],
            "hardware_inputs": [],
            "system_clock": [],
            "jack_sensors": [],
            "iec958_controls": [],
            "pcm_capabilities": [],
            "global_controls": []
        }

        try:
            cmd = ["amixer", "-c", str(card_idx), "contents"]
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
            if res.returncode != 0:
                return topology

            output = res.stdout
            controls = self._parse_amixer_contents(output)

            # Group controls by group prefix into channel strips
            groups: Dict[str, Dict[str, Any]] = {}

            for ctrl in controls:
                meta = self._classify_control(
                    name=ctrl["name"],
                    iface=ctrl.get("iface", 0),
                    elem_type=ctrl.get("type", ""),
                    access_flags=ctrl.get("access", "rw------"),
                    items=ctrl.get("items", []),
                    index=ctrl.get("index", 0)
                )

                grp_key = f"{meta['category']}_{meta['group']}"
                if grp_key not in groups:
                    groups[grp_key] = {
                        "id": grp_key,
                        "name": meta["group"],
                        "category": meta["category"],
                        "controls": [],
                        "meters": []
                    }

                ctrl["ctrl_type"] = meta["type"]
                ctrl["is_meter"] = meta["is_meter"]

                if meta["is_meter"]:
                    groups[grp_key]["meters"].append(ctrl)
                else:
                    groups[grp_key]["controls"].append(ctrl)

            # Distribute groups into 4 quadrants
            for grp_key, group in groups.items():
                cat = group["category"]
                if cat in topology:
                    topology[cat].append(group)
                else:
                    topology["global_controls"].append(group)

        except Exception as e:
            logger.error(f"Error in amixer contents fallback parser for card {card_idx}: {e}")

        return topology

    def _parse_amixer_contents(self, text: str) -> List[Dict[str, Any]]:
        """Parse amixer contents text block into structured control dicts."""
        controls = []
        current = None

        for line in text.split("\n"):
            line_str = line.rstrip()
            if not line_str:
                continue

            # numid=32,iface=MIXER,name='PCM 0 Playback Meter'
            if line_str.startswith("numid="):
                if current:
                    controls.append(current)
                
                current = {
                    "numid": None,
                    "iface": "MIXER",
                    "name": "",
                    "index": 0,
                    "type": "INTEGER",
                    "access": "rw------",
                    "channels": 1,
                    "min": 0,
                    "max": 100,
                    "step": 1,
                    "db_min": None,
                    "db_max": None,
                    "items": [],
                    "values": []
                }

                parts = line_str.split(",")
                for p in parts:
                    if p.startswith("numid="):
                        current["numid"] = int(p.split("=")[1])
                    elif p.startswith("iface="):
                        current["iface"] = p.split("=")[1]
                    elif p.startswith("index="):
                        try:
                            current["index"] = int(p.split("=")[1])
                        except ValueError:
                            pass
                    elif p.startswith("name="):
                        # Extract string inside quotes
                        name_match = re.search(r"name='([^']+)'", line_str)
                        if name_match:
                            current["name"] = name_match.group(1)

            elif current and line_str.strip().startswith(";"):
                # ; type=INTEGER,access=rw---R--,values=2,min=-10000,max=2000,step=1
                # ; Item #0 'Line 0'
                sub_line = line_str.strip()
                if "Item #" in sub_line:
                    item_match = re.search(r"Item #\d+ '([^']+)'", sub_line)
                    if item_match:
                        current["items"].append(item_match.group(1))
                else:
                    attrs = sub_line.lstrip(";").strip().split(",")
                    for a in attrs:
                        a = a.strip()
                        if a.startswith("type="):
                            current["type"] = a.split("=")[1]
                        elif a.startswith("access="):
                            current["access"] = a.split("=")[1]
                        elif a.startswith("values="):
                            try: current["channels"] = int(a.split("=")[1])
                            except ValueError: pass
                        elif a.startswith("min="):
                            try: current["min"] = int(a.split("=")[1])
                            except ValueError: pass
                        elif a.startswith("max="):
                            try: current["max"] = int(a.split("=")[1])
                            except ValueError: pass
                        elif a.startswith("step="):
                            try: current["step"] = int(a.split("=")[1])
                            except ValueError: pass

            elif current and line_str.strip().startswith(":"):
                # : values=0,0 or : values=off,off
                vals_str = line_str.strip().lstrip(":").strip()
                if vals_str.startswith("values="):
                    v_raw = vals_str.split("=", 1)[1]
                    raw_parts = [v.strip() for v in v_raw.split(",")]
                    parsed_vals = []
                    for rv in raw_parts:
                        if rv == "on": parsed_vals.append(True)
                        elif rv == "off": parsed_vals.append(False)
                        else:
                            try: parsed_vals.append(int(rv))
                            except ValueError: parsed_vals.append(rv)
                    current["values"] = parsed_vals

            elif current and line_str.strip().startswith("|"):
                # | dBscale-min=-100.00dB,step=0.01dB,mute=1
                db_line = line_str.strip().lstrip("|").strip()
                if "dBscale-min=" in db_line:
                    db_min_match = re.search(r"dBscale-min=(-?\d+\.?\d*)dB", db_line)
                    step_match = re.search(r"step=(-?\d+\.?\d*)dB", db_line)
                    if db_min_match:
                        try:
                            current["db_min"] = float(db_min_match.group(1))
                            if step_match:
                                current["db_step"] = float(step_match.group(1))
                                if current.get("max") is not None and current.get("min") is not None:
                                    steps_count = (current["max"] - current["min"])
                                    current["db_max"] = current["db_min"] + (steps_count * current["db_step"])
                        except Exception:
                            pass

        if current:
            controls.append(current)

        return controls

    def write_control_value(self, card_idx: int, numid: int, values: List[Any]) -> bool:
        """Write values to ALSA control element via amixer with robust multi-channel fallback."""
        import subprocess

        try:
            val_strs = []
            for v in values:
                if isinstance(v, bool):
                    val_strs.append("on" if v else "off")
                elif isinstance(v, (float, int)):
                    val_strs.append(str(int(v)))
                else:
                    val_strs.append(str(v))
            
            val_arg = ",".join(val_strs)
            cmd = ["amixer", "-c", str(card_idx), "cset", f"numid={numid}", "--", val_arg]
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=3)
            if res.returncode == 0:
                return True

            # Retry 1: Auto-expand single value to dual channels (e.g., '-2' -> '-2,-2')
            if len(val_strs) == 1:
                val_arg_expanded = f"{val_strs[0]},{val_strs[0]}"
                cmd_retry = ["amixer", "-c", str(card_idx), "cset", f"numid={numid}", "--", val_arg_expanded]
                res_retry = subprocess.run(cmd_retry, capture_output=True, text=True, timeout=3)
                if res_retry.returncode == 0:
                    return True

            # Retry 2: Truncate dual values to single channel if control is mono
            if len(val_strs) > 1:
                cmd_retry = ["amixer", "-c", str(card_idx), "cset", f"numid={numid}", "--", val_strs[0]]
                res_retry = subprocess.run(cmd_retry, capture_output=True, text=True, timeout=3)
                if res_retry.returncode == 0:
                    return True

            logger.warning(f"amixer cset numid={numid} failed on card {card_idx}: cmd={cmd}, stdout='{res.stdout.strip()}', stderr='{res.stderr.strip()}'")
            return False
        except Exception as e:
            logger.error(f"Error writing ALSA control numid={numid} on card {card_idx}: {e}")
            return False

    def read_meters(self, card_idx: int) -> Dict[int, List[int]]:
        """Fast-path reading for Vumeters (numids with meter type)."""
        topology = self.get_card_topology(card_idx)
        meters_data = {}

        # Collect meter numids from all 4 quadrants
        for quad in ["virtual_playout", "hardware_outputs", "virtual_capture", "hardware_inputs"]:
            for group in topology.get(quad, []):
                for m in group.get("meters", []):
                    numid = m.get("numid")
                    vals = m.get("values", [0, 0])
                    if numid is not None:
                        meters_data[numid] = vals

        return meters_data

alsa_manager = AlsaManager()
