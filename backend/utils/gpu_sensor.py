import subprocess
import shutil
import os
import time
import json
import logging
from typing import Optional, Dict, Any
import psutil

logger = logging.getLogger("ffmpeg_gui.gpu_sensor")

class GPUSensor:
    def __init__(self):
        self.vendor = self._detect_vendor()
        self._cached_stats = None
        self._last_query_time = 0.0

    def _detect_vendor(self) -> str:
        # Check for nvidia-smi command first
        if shutil.which("nvidia-smi"):
            return "nvidia"

        # Check DRM class vendor file if it exists
        vendor_file = "/sys/class/drm/card0/device/vendor"
        if os.path.exists(vendor_file):
            try:
                with open(vendor_file, "r") as f:
                    val = f.read().strip().lower()
                if "0x10de" in val:
                    return "nvidia"
                elif "0x1002" in val:
                    return "amd"
                elif "0x8086" in val:
                    return "intel"
            except Exception:
                pass
        return "none"

    def get_stats(self) -> dict:
        """Return dict with keys: vendor, utilization, vram_used, vram_total"""
        now = time.time()
        if self._cached_stats is not None and (now - self._last_query_time) < 5.0:
            return self._cached_stats

        stats = {
            "vendor": self.vendor,
            "utilization": 0,
            "vram_used": 0,
            "vram_total": 0
        }

        if self.vendor == "nvidia":
            try:
                # Query nvidia-smi
                res = subprocess.run(
                    ["nvidia-smi", "--query-gpu=utilization.gpu,utilization.memory,memory.used,memory.total", "--format=csv,noheader,nounits"],
                    capture_output=True,
                    text=True,
                    timeout=2.0,
                    check=True
                )
                parts = [p.strip() for p in res.stdout.strip().split(",")]
                if len(parts) >= 4:
                    stats = {
                        "vendor": "nvidia",
                        "utilization": int(parts[0]),
                        "vram_used": int(parts[2]),
                        "vram_total": int(parts[3])
                    }
            except Exception:
                pass

        elif self.vendor == "amd":
            try:
                # Read AMD GPU sysfs statistics
                gpu_busy_path = "/sys/class/drm/card0/device/gpu_busy_percent"
                vram_used_path = "/sys/class/drm/card0/device/mem_info_vram_used"
                vram_total_path = "/sys/class/drm/card0/device/mem_info_vram_total"

                util = 0
                if os.path.exists(gpu_busy_path):
                    with open(gpu_busy_path, "r") as f:
                        util = int(f.read().strip())

                used = 0
                if os.path.exists(vram_used_path):
                    with open(vram_used_path, "r") as f:
                        used = int(int(f.read().strip()) / (1024 * 1024)) # B to MB

                total = 0
                if os.path.exists(vram_total_path):
                    with open(vram_total_path, "r") as f:
                        total = int(int(f.read().strip()) / (1024 * 1024)) # B to MB

                stats = {
                    "vendor": "amd",
                    "utilization": util,
                    "vram_used": used,
                    "vram_total": total
                }
            except Exception:
                pass

        elif self.vendor == "intel":
            stats = self._get_intel_stats()

        self._cached_stats = stats
        self._last_query_time = now
        return stats

    def _sample_intel_gpu_top(self) -> Optional[Dict[str, Any]]:
        """Run intel_gpu_top with -J and parse the first valid JSON sample block."""
        if not shutil.which("intel_gpu_top"):
            return None

        cmd = ["intel_gpu_top", "-J", "-s", "250", "-o", "-"]
        proc = None
        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
        except Exception as e:
            logger.debug(f"Failed to spawn intel_gpu_top: {e}")
            return None

        json_buf = []
        in_object = False
        brace_depth = 0
        parsed_sample = None
        start_time = time.time()

        try:
            # Enforce strict deadline (1.5s) to avoid hanging
            while time.time() - start_time < 1.5:
                line = proc.stdout.readline()
                if not line:
                    if proc.poll() is not None:
                        break
                    time.sleep(0.02)
                    continue

                stripped = line.strip()
                if not in_object:
                    if stripped.startswith("{"):
                        in_object = True
                        json_buf = [line]
                        brace_depth = line.count("{") - line.count("}")
                        if brace_depth == 0:
                            try:
                                parsed_sample = json.loads("".join(json_buf))
                                break
                            except Exception:
                                in_object = False
                                json_buf = []
                else:
                    json_buf.append(line)
                    brace_depth += line.count("{") - line.count("}")
                    if brace_depth <= 0:
                        try:
                            raw_json = "".join(json_buf).rstrip(", \r\n")
                            parsed_sample = json.loads(raw_json)
                            break
                        except Exception as e:
                            logger.debug(f"Failed parsing intel_gpu_top JSON block: {e}")
                            in_object = False
                            json_buf = []
        except Exception as e:
            logger.debug(f"Error reading intel_gpu_top output: {e}")
        finally:
            if proc is not None:
                try:
                    proc.terminate()
                    proc.wait(timeout=0.3)
                except Exception:
                    try:
                        proc.kill()
                        proc.wait(timeout=0.2)
                    except Exception:
                        pass

        return parsed_sample

    def _get_intel_stats(self) -> dict:
        """Parse Intel GPU statistics from intel_gpu_top or fallback safely."""
        stats = {
            "vendor": "intel",
            "utilization": 0,
            "vram_used": 0,
            "vram_total": 0
        }

        # Calculate default memory ceiling (shared system RAM limit, typically 50%)
        total_sys_ram_mb = 0
        try:
            total_sys_ram_mb = int(psutil.virtual_memory().total // (1024 * 1024))
        except Exception:
            pass
        default_vram_total = max(512, total_sys_ram_mb // 2) if total_sys_ram_mb > 0 else 2048

        sample = self._sample_intel_gpu_top()
        if not sample or not isinstance(sample, dict):
            stats["vram_total"] = default_vram_total
            return stats

        # 1. Utilization: Peak busy percentage across engines (e.g., Video, Render/3D, Blitter)
        peak_busy = 0.0
        engines = sample.get("engines", {})
        if isinstance(engines, dict):
            for eng_name, eng_info in engines.items():
                if isinstance(eng_info, dict):
                    try:
                        busy = float(eng_info.get("busy", 0.0))
                        if busy > peak_busy:
                            peak_busy = busy
                    except (ValueError, TypeError):
                        pass

        # Fallback to client engine-classes if engines block had no data
        clients = sample.get("clients", {})
        if peak_busy == 0.0 and isinstance(clients, dict):
            for client in clients.values():
                if isinstance(client, dict):
                    classes = client.get("engine-classes", {})
                    if isinstance(classes, dict):
                        for class_name, class_info in classes.items():
                            if isinstance(class_info, dict):
                                try:
                                    busy = float(class_info.get("busy", 0.0))
                                    if busy > peak_busy:
                                        peak_busy = busy
                                except (ValueError, TypeError):
                                    pass

        # 2. VRAM Used: Sum of resident or total memory of active clients
        total_used_bytes = 0
        if isinstance(clients, dict):
            for client in clients.values():
                if isinstance(client, dict):
                    mem = client.get("memory", {})
                    if isinstance(mem, dict):
                        for region in ("system", "local"):
                            region_data = mem.get(region, {})
                            if isinstance(region_data, dict):
                                resident = region_data.get("resident")
                                if resident is None:
                                    resident = region_data.get("total", 0)
                                try:
                                    total_used_bytes += int(resident)
                                except (ValueError, TypeError):
                                    pass

        vram_used_mb = int(round(total_used_bytes / (1024 * 1024)))

        # 3. VRAM Total: Check sysfs discrete mem_info first, otherwise use shared RAM aperture
        vram_total_mb = default_vram_total
        sysfs_vram_total_path = "/sys/class/drm/card0/device/mem_info_vram_total"
        if os.path.exists(sysfs_vram_total_path):
            try:
                with open(sysfs_vram_total_path, "r") as f:
                    sysfs_bytes = int(f.read().strip())
                    if sysfs_bytes > 0:
                        vram_total_mb = int(round(sysfs_bytes / (1024 * 1024)))
            except Exception:
                pass

        if vram_used_mb > vram_total_mb:
            vram_total_mb = vram_used_mb

        stats["utilization"] = min(100, max(0, int(round(peak_busy))))
        stats["vram_used"] = vram_used_mb
        stats["vram_total"] = vram_total_mb
        return stats
