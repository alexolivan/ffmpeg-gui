import os
import re
import shutil
import time
import subprocess
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger("AudioScienceHealth")

_CACHED_HEALTH: Optional[List[Dict[str, Any]]] = None
_LAST_PROBE_TIME: float = 0.0
_ADAPTER_CAPABILITIES_CACHE: Dict[int, Dict[str, Any]] = {}
CACHE_TTL_SECONDS: float = 30.0


def _find_hpicontrol_bin() -> Optional[str]:
    """Finds hpicontrol.py executable in PATH or standard system paths."""
    bin_path = shutil.which("hpicontrol.py")
    if bin_path and os.path.isfile(bin_path) and os.access(bin_path, os.X_OK):
        return bin_path
    
    candidates = [
        "/usr/bin/hpicontrol.py",
        "/usr/local/bin/hpicontrol.py",
    ]
    for c in candidates:
        if os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    return None


def parse_hpicontrol_list(output: str) -> List[Dict[str, Any]]:
    """
    Parses output of 'hpicontrol.py list'.
    Example output line:
      0 ASI5720, serial 105283, SW version 4.20.54, HW version F7, 2 inputs, 4 outputs
    """
    adapters = []
    lines = output.splitlines()
    for line in lines:
        line_clean = line.strip()
        # Match pattern: <idx> <model>, serial <serial>, ...
        m = re.match(r"^(\d+)\s+([A-Za-z0-9]+),\s+serial\s+(\d+)", line_clean)
        if m:
            adapter_idx = int(m.group(1))
            model_name = m.group(2)
            serial_num = m.group(3)
            adapters.append({
                "adapter_index": adapter_idx,
                "name": model_name,
                "serial": serial_num,
                "raw_info": line_clean,
            })
    return adapters


def parse_status_control_references(output: str) -> List[int]:
    """
    Parses referenced control IDs from Control 9 ('Status') output.
    Example line:
      --reference value[2]= [10, 11]
      or:
      --reference value[1]= 10
    """
    control_ids = []
    lines = output.splitlines()
    for line in lines:
        if "reference value" in line and "=" in line:
            after_eq = line.split("=", 1)[1].strip()
            # Check for bracketed list: [10, 11]
            list_match = re.search(r"\[([0-9,\s]+)\]", after_eq)
            if list_match:
                parts = list_match.group(1).split(",")
                for p in parts:
                    p = p.strip()
                    if p.isdigit():
                        control_ids.append(int(p))
                if control_ids:
                    return control_ids
            # Check for single integer: 10
            single_match = re.search(r"^(\d+)", after_eq)
            if single_match:
                control_ids.append(int(single_match.group(1)))
                return control_ids
    return control_ids


def parse_universal_control_id(output: str) -> Optional[int]:
    """
    Parses output of 'hpicontrol.py -a <idx> controls' looking for CONTROL_UNIVERSAL.
    Example line on cards with status controls (e.g. ASI5720):
      Control 9 CONTROL_UNIVERSAL on SOURCENODE_ADAPTER 0 Universal_Info 
    Returns the integer control ID, or None if the card has no universal/status controls (e.g. ASI5640).
    """
    for line in output.splitlines():
        line_clean = line.strip()
        m = re.match(r"^Control\s+(\d+)\s+CONTROL_UNIVERSAL", line_clean, re.IGNORECASE)
        if m:
            return int(m.group(1))
    return None


def parse_child_control(output: str) -> Dict[str, Any]:
    """
    Parses a child control's classname and value.
    Example 1 (CPU Utilization):
      --cstring classname[15]= b'CPU Utilization'
      ...
      int value[1]= 8
    Example 2 (Temperature):
      --cstring classname[11]= b'Temperature'
      ...
      float value[1]= 53.0
    """
    res: Dict[str, Any] = {"classname": "", "value": None}
    lines = output.splitlines()
    for line in lines:
        if "classname" in line:
            # Extract text inside quotes
            m = re.search(r"b?['\"]([^'\"]+)['\"]", line)
            if m:
                res["classname"] = m.group(1).strip()
        elif "value[" in line or line.strip().startswith("int value") or line.strip().startswith("float value"):
            val_match = re.search(r"=\s*([0-9.]+)", line)
            if val_match:
                val_str = val_match.group(1)
                try:
                    if "." in val_str:
                        res["value"] = float(val_str)
                    else:
                        res["value"] = int(val_str)
                except ValueError:
                    pass
    return res


def probe_audioscience_health(timeout: float = 2.0) -> List[Dict[str, Any]]:
    """
    Probes AudioScience adapters using hpicontrol.py CLI with safe sub-process timeout.
    Performs one-time capability discovery to completely eliminate polling overhead
    on cards without CONTROL_UNIVERSAL (e.g. ASI5640, ASI5810).
    Returns list of adapter health dictionaries.
    """
    global _ADAPTER_CAPABILITIES_CACHE
    hpi_bin = _find_hpicontrol_bin()
    if not hpi_bin:
        return []

    # Check if ALSA mixer WebSocket is active; if so, skip hardware query to prevent mailbox contention
    try:
        from core.alsa_manager import alsa_manager
        if getattr(alsa_manager, "active_mixer_ws_count", 0) > 0:
            logger.debug("Skipping AudioScience health probe: ALSA mixer WebSocket is currently active.")
            return _CACHED_HEALTH or []
    except Exception:
        pass

    try:
        proc = subprocess.run(
            [hpi_bin, "list"],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if proc.returncode != 0 or not proc.stdout:
            return []
    except Exception as e:
        logger.debug(f"Failed to run {hpi_bin} list: {e}")
        return []

    adapters = parse_hpicontrol_list(proc.stdout)
    results = []

    for ad in adapters:
        idx = ad["adapter_index"]
        name = ad["name"]
        serial = ad["serial"]
        dsp_cpu = None
        dsp_temp = None
        has_temp_sensor = False

        # One-time capability discovery for this adapter
        if idx not in _ADAPTER_CAPABILITIES_CACHE:
            caps: Dict[str, Any] = {
                "has_telemetry": False,
                "status_ctrl_id": None,
                "cpu_ctrl_id": None,
                "temp_ctrl_id": None,
                "has_temp_sensor": False,
            }
            try:
                ctrls_proc = subprocess.run(
                    [hpi_bin, "-a", str(idx), "controls"],
                    capture_output=True,
                    text=True,
                    timeout=timeout,
                )
                if ctrls_proc.returncode == 0 and ctrls_proc.stdout:
                    status_id = parse_universal_control_id(ctrls_proc.stdout)
                    if status_id is not None:
                        caps["status_ctrl_id"] = status_id
                        # Discover child controls referenced by this universal status control
                        s_proc = subprocess.run(
                            [hpi_bin, "-a", str(idx), "cget", str(status_id)],
                            capture_output=True,
                            text=True,
                            timeout=timeout,
                        )
                        if s_proc.returncode == 0 and s_proc.stdout:
                            child_ids = parse_status_control_references(s_proc.stdout)
                            for cid in child_ids:
                                try:
                                    c_proc = subprocess.run(
                                        [hpi_bin, "-a", str(idx), "cget", str(cid)],
                                        capture_output=True,
                                        text=True,
                                        timeout=timeout,
                                    )
                                    if c_proc.returncode == 0 and c_proc.stdout:
                                        p_data = parse_child_control(c_proc.stdout)
                                        c_name = p_data.get("classname", "").lower()
                                        if "cpu utilization" in c_name:
                                            caps["cpu_ctrl_id"] = cid
                                            caps["has_telemetry"] = True
                                        elif "temperature" in c_name:
                                            caps["temp_ctrl_id"] = cid
                                            caps["has_temp_sensor"] = True
                                            caps["has_telemetry"] = True
                                except Exception:
                                    pass
                    else:
                        logger.info(
                            f"AudioScience adapter {idx} ({name}) has no CONTROL_UNIVERSAL status telemetry controls. "
                            "Zero polling registered."
                        )
            except Exception as e:
                logger.debug(f"Failed to discover capabilities for adapter {idx}: {e}")

            _ADAPTER_CAPABILITIES_CACHE[idx] = caps

        caps = _ADAPTER_CAPABILITIES_CACHE.get(idx, {})
        if caps.get("has_telemetry"):
            # Poll only the discovered CPU and temperature control IDs
            cpu_id = caps.get("cpu_ctrl_id")
            if cpu_id is not None:
                try:
                    cpu_proc = subprocess.run(
                        [hpi_bin, "-a", str(idx), "cget", str(cpu_id)],
                        capture_output=True,
                        text=True,
                        timeout=timeout,
                    )
                    if cpu_proc.returncode == 0 and cpu_proc.stdout:
                        p_val = parse_child_control(cpu_proc.stdout).get("value")
                        if p_val is not None:
                            dsp_cpu = int(p_val)
                except Exception:
                    pass

            temp_id = caps.get("temp_ctrl_id")
            if temp_id is not None:
                try:
                    temp_proc = subprocess.run(
                        [hpi_bin, "-a", str(idx), "cget", str(temp_id)],
                        capture_output=True,
                        text=True,
                        timeout=timeout,
                    )
                    if temp_proc.returncode == 0 and temp_proc.stdout:
                        p_val = parse_child_control(temp_proc.stdout).get("value")
                        if p_val is not None:
                            dsp_temp = float(p_val)
                            has_temp_sensor = True
                except Exception:
                    pass

        results.append({
            "adapter_index": idx,
            "name": name,
            "serial": serial,
            "dsp_cpu_percent": dsp_cpu,
            "dsp_temp_c": dsp_temp,
            "has_temp_sensor": has_temp_sensor,
            "status": "warning" if (dsp_temp and dsp_temp >= 75.0) else "normal",
        })

    return results


def get_audioscience_health(force: bool = False, timeout: float = 2.0) -> List[Dict[str, Any]]:
    """
    Returns AudioScience adapter health telemetry with caching TTL to eliminate load.
    """
    global _CACHED_HEALTH, _LAST_PROBE_TIME
    now = time.time()
    if not force and _CACHED_HEALTH is not None and (now - _LAST_PROBE_TIME < CACHE_TTL_SECONDS):
        return _CACHED_HEALTH

    probed = probe_audioscience_health(timeout=timeout)
    _CACHED_HEALTH = probed
    _LAST_PROBE_TIME = now
    return probed
