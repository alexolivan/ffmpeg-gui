import re
import os
import shutil
import glob
import logging
import asyncio
from typing import List, Dict

logger = logging.getLogger("alsa_v4l2_helper")

def parse_magewell_devices(stdout: str) -> Dict[str, dict]:
    """
    Parse mwcap-info -l or mweco-info -l output.
    Format is typically whitespace-separated:
    /dev/video0     1.34            B               1.3.4429        hw:1,0          00:00 Pro Capture SDI
    """
    magewell_map = {}
    for line in stdout.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        # Split by whitespace, max 5 splits to keep device name intact
        parts = line.split(None, 5)
        if len(parts) >= 6:
            dev_path = parts[0]
            alsa_dev = parts[4]
            name = parts[5]
            magewell_map[dev_path] = {
                "alsa_device": alsa_dev,
                "name": name,
                "is_magewell": True
            }
    return magewell_map

def parse_v4l2_formats(stderr: str) -> List[dict]:
    """
    Parse ffmpeg -f v4l2 -list_formats all -i <device> output.
    Example line:
    [video4linux2,v4l2 @ 0x...] Raw       :     yuyv422 :           YUYV 4:2:2 : 640x480 320x240
    """
    formats = []
    for line in stderr.splitlines():
        line = line.strip()
        if "Raw" not in line and "Compressed" not in line:
            continue
        
        idx = line.find("Raw")
        if idx == -1:
            idx = line.find("Compressed")
        if idx == -1:
            continue
            
        data_part = line[idx:]
        parts = data_part.split(":", 2)
        if len(parts) < 3:
            continue
            
        type_ = parts[0].strip()
        pixel_format = parts[1].strip()
        rest = parts[2].strip()
        
        if ":" in rest:
            desc, resolutions_str = rest.rsplit(":", 1)
            desc = desc.strip()
            resolutions = [r.strip() for r in re.split(r"[\s,]+", resolutions_str) if r.strip()]
        else:
            desc = rest
            resolutions = []
            
        formats.append({
            "type": type_,
            "pixel_format": pixel_format,
            "description": desc,
            "resolutions": resolutions
        })
    return formats

def parse_arecord_output(stdout: str) -> List[dict]:
    """
    Parse arecord -l output.
    Example:
    card 0: PCH [HDA Intel PCH], device 0: ALC892 Analog [ALC892 Analog]
      Subdevices: 1/1
      Subdevice #0: subdevice #0
    """
    devices = []
    current_device = None
    subdevices = []

    for line in stdout.splitlines():
        line_str = line.strip()
        m = re.match(r"card\s+(\d+):\s+(.*?),\s+device\s+(\d+):\s+(.*)", line_str)
        if m:
            if current_device:
                devices.extend(build_alsa_devices(current_device, subdevices))
            card_id = m.group(1)
            card_name = m.group(2)
            device_id = m.group(3)
            device_name = m.group(4)
            current_device = {
                "card_id": card_id,
                "card_name": card_name,
                "device_id": device_id,
                "device_name": device_name
            }
            subdevices = []
        elif line_str.startswith("Subdevice #"):
            sub_m = re.match(r"Subdevice #(\d+):", line_str)
            if sub_m:
                subdevices.append(sub_m.group(1))

    if current_device:
        devices.extend(build_alsa_devices(current_device, subdevices))

    return devices

def build_alsa_devices(dev_info: dict, subs: list) -> List[dict]:
    card = dev_info["card_id"]
    device = dev_info["device_id"]
    card_name = dev_info["card_name"]
    device_name = dev_info["device_name"]
    
    if " [" in device_name:
        device_name = device_name.split(" [")[0]
    if " [" in card_name:
        card_name = card_name.split(" [")[0]

    friendly_name = f"{card_name} - {device_name}"

    if len(subs) > 1:
        return [
            {
                "device": f"hw:{card},{device},{sub}",
                "name": f"{friendly_name} (Subdevice #{sub})"
            }
            for sub in subs
        ]
    else:
        return [
            {
                "device": f"hw:{card},{device}",
                "name": friendly_name
            }
        ]

def scan_sys_v4l2_devices() -> List[dict]:
    devices = []
    paths = glob.glob("/sys/class/video4linux/video*")
    # Sort them by numerical value of the device index (e.g. video0, video1...)
    paths.sort(key=lambda p: int(re.search(r"\d+", os.path.basename(p)).group() or 0))
    
    for p in paths:
        name_file = os.path.join(p, "name")
        dev_name = os.path.basename(p)
        dev_path = f"/dev/{dev_name}"
        name = "Unknown V4L2 Device"
        if os.path.exists(name_file):
            try:
                with open(name_file, "r") as f:
                    name = f.read().strip()
            except Exception:
                pass
        devices.append({
            "device": dev_path,
            "name": name,
            "alsa_device": None,
            "is_magewell": False
        })
    return devices

async def get_v4l2_devices() -> List[dict]:
    devices = await asyncio.to_thread(scan_sys_v4l2_devices)
    
    # Try finding Magewell tools
    mw_cmd = None
    if shutil.which("mwcap-info"):
        mw_cmd = "mwcap-info"
    elif shutil.which("mweco-info"):
        mw_cmd = "mweco-info"

    if mw_cmd:
        try:
            proc = await asyncio.create_subprocess_exec(
                mw_cmd, "-l",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=3.0)
            magewell_map = parse_magewell_devices(stdout.decode('utf-8', errors='replace'))
            
            for dev in devices:
                dev_path = dev["device"]
                if dev_path in magewell_map:
                    dev["alsa_device"] = magewell_map[dev_path]["alsa_device"]
                    dev["is_magewell"] = True
                    dev["name"] = magewell_map[dev_path]["name"]
        except Exception as e:
            logger.error(f"Error executing Magewell command: {e}")

    return devices

async def get_alsa_devices() -> List[dict]:
    if not shutil.which("arecord"):
        return []
    try:
        proc = await asyncio.create_subprocess_exec(
            "arecord", "-l",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=3.0)
        return parse_arecord_output(stdout.decode('utf-8', errors='replace'))
    except Exception as e:
        logger.error(f"Error querying ALSA devices: {e}")
        return []

async def get_alsa_playback_devices() -> List[dict]:
    if not shutil.which("aplay"):
        return []
    try:
        proc = await asyncio.create_subprocess_exec(
            "aplay", "-l",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=3.0)
        return parse_arecord_output(stdout.decode('utf-8', errors='replace'))
    except Exception as e:
        logger.error(f"Error querying ALSA playback devices: {e}")
        return []


async def get_v4l2_formats(device: str, ffmpeg_binary: str = "ffmpeg") -> List[dict]:
    if not re.match(r"^/dev/video\d+$", device):
        return []
    try:
        proc = await asyncio.create_subprocess_exec(
            ffmpeg_binary, "-hide_banner", "-f", "v4l2", "-list_formats", "all", "-i", device,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=5.0)
        return parse_v4l2_formats(stderr.decode('utf-8', errors='replace'))
    except Exception as e:
        logger.error(f"Error listing V4L2 formats: {e}")
        return []
