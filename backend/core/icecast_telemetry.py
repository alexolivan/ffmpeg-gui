import urllib.request
import base64
import json as pyjson
import xml.etree.ElementTree as ET
import logging
from typing import Optional, Dict, Any, Set

logger = logging.getLogger("ffmpeg_gui.icecast_telemetry")

_MISSING_STATUS_JSON_PORTS: Set[int] = set()

FALLBACK_STATUS_JSON_XSL = """<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="1.0">
<xsl:output method="text" encoding="UTF-8" media-type="application/json" />
<xsl:template match="/icestats">{
  "icestats": {
    "admin": "<xsl:value-of select="admin" />",
    "location": "<xsl:value-of select="location" />",
    "server_id": "<xsl:value-of select="server_id" />",
    "listeners": <xsl:choose><xsl:when test="listeners"><xsl:value-of select="listeners" /></xsl:when><xsl:otherwise>0</xsl:otherwise></xsl:choose>,
    "source": [
<xsl:for-each select="source">
      {
        "listenurl": "<xsl:value-of select="listenurl" />",
        "listeners": <xsl:choose><xsl:when test="listeners"><xsl:value-of select="listeners" /></xsl:when><xsl:otherwise>0</xsl:otherwise></xsl:choose>,
        "listener_peak": <xsl:choose><xsl:when test="listener_peak"><xsl:value-of select="listener_peak" /></xsl:when><xsl:otherwise>0</xsl:otherwise></xsl:choose>,
        "bitrate": <xsl:choose><xsl:when test="bitrate"><xsl:value-of select="bitrate" /></xsl:when><xsl:otherwise>0</xsl:otherwise></xsl:choose>,
        "title": "<xsl:value-of select="title" />"
      }<xsl:if test="position() != last()">,</xsl:if>
</xsl:for-each>
    ]
  }
}
</xsl:template>
</xsl:stylesheet>
"""

def mark_status_json_missing(port: int):
    _MISSING_STATUS_JSON_PORTS.add(port)

def clear_status_json_cache():
    _MISSING_STATUS_JSON_PORTS.clear()

def fetch_icecast_telemetry(
    port: int,
    admin_user: str = "admin",
    admin_password: str = "hackme",
    has_status_json: bool = True,
    is_legacy: bool = False,
    use_ssl: bool = False
) -> Optional[Dict[str, Any]]:
    """
    Fetches real-time Icecast telemetry.
    If is_legacy is True or port is in _MISSING_STATUS_JSON_PORTS, never probes /status-json.xsl.
    Only probes /status-json.xsl if has_status_json is True and not legacy.
    If /status-json.xsl fails or returns 404, the port is cached in _MISSING_STATUS_JSON_PORTS
    so all subsequent calls proceed directly to native /admin/stats.xml without causing XSLT errors in logs.
    """
    import ssl
    ssl_ctx = ssl._create_unverified_context() if use_ssl else None
    proto = "https" if use_ssl else "http"

    # 1. Attempt /status-json.xsl only if explicitly enabled, not legacy, and not marked missing
    if has_status_json and not is_legacy and port not in _MISSING_STATUS_JSON_PORTS:
        try:
            url = f"{proto}://127.0.0.1:{port}/status-json.xsl"
            req = urllib.request.Request(url, headers={"User-Agent": "ffmpeg-gui"})
            with urllib.request.urlopen(req, timeout=1.5, context=ssl_ctx) as resp:
                if resp.status == 200:
                    return pyjson.loads(resp.read().decode("utf-8"))
        except Exception:
            _MISSING_STATUS_JSON_PORTS.add(port)

    # 2. Universal fallback: /admin/stats.xml (supported natively by Icecast 2.0 through 2.5+)
    try:
        url = f"{proto}://127.0.0.1:{port}/admin/stats.xml"
        req = urllib.request.Request(url, headers={"User-Agent": "ffmpeg-gui"})
        if admin_user and admin_password:
            auth_str = f"{admin_user}:{admin_password}"
            b64_auth = base64.b64encode(auth_str.encode("utf-8")).decode("ascii")
            req.add_header("Authorization", f"Basic {b64_auth}")
        with urllib.request.urlopen(req, timeout=1.5, context=ssl_ctx) as resp:
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
