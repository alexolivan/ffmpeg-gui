import urllib.request
import base64
import json as pyjson
import xml.etree.ElementTree as ET
import logging
from typing import Optional, Dict, Any

logger = logging.getLogger("ffmpeg_gui.icecast_telemetry")

def fetch_icecast_telemetry(
    port: int,
    admin_user: str = "admin",
    admin_password: str = "hackme",
    has_status_json: bool = True
) -> Optional[Dict[str, Any]]:
    """
    Fetches real-time Icecast telemetry.
    If has_status_json is True, tries /status-json.xsl first (Icecast 2.4+).
    If that fails, or if has_status_json is False (Icecast 2.3.x or 2.5.x without status-json.xsl),
    falls back cleanly to /admin/stats.xml with HTTP Basic Auth, avoiding any XSLT stylesheet errors in Icecast logs.
    """
    # 1. Attempt /status-json.xsl if known to exist or assumed
    if has_status_json:
        try:
            url = f"http://127.0.0.1:{port}/status-json.xsl"
            req = urllib.request.Request(url, headers={"User-Agent": "ffmpeg-gui"})
            with urllib.request.urlopen(req, timeout=1.5) as resp:
                if resp.status == 200:
                    return pyjson.loads(resp.read().decode("utf-8"))
        except Exception:
            pass

    # 2. Universal fallback: /admin/stats.xml (supported natively by Icecast 2.0 through 2.5+)
    try:
        url = f"http://127.0.0.1:{port}/admin/stats.xml"
        req = urllib.request.Request(url, headers={"User-Agent": "ffmpeg-gui"})
        if admin_user and admin_password:
            auth_str = f"{admin_user}:{admin_password}"
            b64_auth = base64.b64encode(auth_str.encode("utf-8")).decode("ascii")
            req.add_header("Authorization", f"Basic {b64_auth}")
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            if resp.status == 200:
                raw_xml = resp.read().decode("utf-8", errors="replace")
                root = ET.fromstring(raw_xml)

                listeners_str = root.findtext("listeners") or "0"
                try:
                    g_listeners = int(listeners_str)
                except ValueError:
                    g_listeners = 0

                sources = []
                for s_elem in root.findall("source"):
                    mount = s_elem.get("mount") or ""

                    def _get_int(tag, default=0):
                        val = s_elem.findtext(tag)
                        try:
                            return int(val) if val is not None else default
                        except ValueError:
                            return default

                    s_data = {
                        "mount": mount,
                        "listenurl": s_elem.findtext("listenurl") or f"http://127.0.0.1:{port}{mount}",
                        "listeners": _get_int("listeners", 0),
                        "listener_peak": _get_int("listener_peak", 0),
                        "bitrate": _get_int("bitrate", 0),
                        "title": s_elem.findtext("title") or s_elem.findtext("stream_name") or "",
                        "genre": s_elem.findtext("genre") or "",
                        "server_type": s_elem.findtext("server_type") or s_elem.findtext("type") or ""
                    }
                    sources.append(s_data)

                return {
                    "icestats": {
                        "listeners": g_listeners,
                        "source": sources
                    }
                }
    except Exception as e:
        logger.debug(f"[Icecast] Failed to fetch telemetry via /admin/stats.xml: {e}")

    return None
