import subprocess
import shutil
import os
import time

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
            # Intel GPUs on Linux do not expose VRAM/Utilization under standard sysfs device path without debugfs
            # We report as detected but with zero stats to avoid mock assumptions.
            stats = {
                "vendor": "intel",
                "utilization": 0,
                "vram_used": 0,
                "vram_total": 0
            }

        self._cached_stats = stats
        self._last_query_time = now
        return stats
