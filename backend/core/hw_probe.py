"""
Host GPU & hardware acceleration runtime introspection helpers (NVENC + VAAPI).
Pure SoC module shared across API capabilities, Forge build planner, and smoke validation.
"""

import ctypes
import glob
import os
import re
from typing import Optional, Tuple

_NVENC_API_RE = re.compile(r"^n?(\d+)\.(\d+)")


def parse_nvenc_api_tuple(version_or_tag: Optional[str]) -> Optional[Tuple[int, int]]:
    """Parse an nv-codec-headers tag or API string (e.g. 'n13.1.15.0' or '12.2') -> (major, minor)."""
    if not version_or_tag:
        return None
    text = str(version_or_tag).strip()
    if not text or text.lower() in {"auto", "master", "latest", "git", "dev"}:
        return None
    match = _NVENC_API_RE.match(text)
    if not match:
        return None
    return (int(match.group(1)), int(match.group(2)))


def detect_host_nvenc_api_version() -> Optional[str]:
    """
    Query libnvidia-encode.so.1 for the maximum NVENC API version supported by
    the currently loaded NVIDIA driver (`major = ver >> 4`, `minor = ver & 0xF`).
    Returns None cleanly if libnvidia-encode or the symbol is unavailable.
    """
    try:
        lib = ctypes.CDLL("libnvidia-encode.so.1")
        fn = getattr(lib, "NvEncodeAPIGetMaxSupportedVersion", None)
        if fn is None:
            return None
        fn.argtypes = [ctypes.POINTER(ctypes.c_uint32)]
        fn.restype = ctypes.c_uint32
        ver = ctypes.c_uint32(0)
        rc = fn(ctypes.byref(ver))
        if rc != 0 or ver.value == 0:
            return None
        major = (ver.value >> 4) & 0xFF
        minor = ver.value & 0x0F
        return f"{major}.{minor}"
    except Exception:
        return None


def detect_host_vaapi_render_node() -> Optional[str]:
    """
    Scan /sys/class/drm/renderD* in deterministic order for Intel (0x8086)
    or AMD (0x1002) DRM render nodes and return the corresponding /dev/dri/renderD* path.
    """
    render_nodes = sorted(glob.glob("/sys/class/drm/renderD*"))
    for node in render_nodes:
        vendor_path = os.path.join(node, "device/vendor")
        if not os.path.exists(vendor_path):
            continue
        try:
            with open(vendor_path, "r", encoding="utf-8") as f:
                vendor_id = f.read().strip().lower()
            if "0x8086" in vendor_id or "0x1002" in vendor_id:
                dri_path = os.path.join("/dev/dri", os.path.basename(node))
                if os.path.exists(dri_path):
                    return dri_path
                return dri_path
        except Exception:
            continue
    return None
