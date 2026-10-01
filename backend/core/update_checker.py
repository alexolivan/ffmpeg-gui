import json
import logging
import re
import subprocess
import time
import urllib.request
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger("ffmpeg_gui.update_checker")

_CACHE: Dict[str, Any] = {
    "timestamp": 0.0,
    "data": None
}
CACHE_TTL_SECONDS = 6 * 3600  # 6 hours TTL


def _parse_semver_tuple(version_str: str) -> Tuple[int, int, int]:
    """Parse a semantic version string (e.g. 'v2.31.0', '2.30.1-rc1') into (major, minor, patch)."""
    clean = version_str.strip().lstrip("v").strip()
    match = re.match(r"^(\d+)(?:\.(\d+))?(?:\.(\d+))?", clean)
    if not match:
        return (0, 0, 0)
    major = int(match.group(1) or 0)
    minor = int(match.group(2) or 0)
    patch = int(match.group(3) or 0)
    return (major, minor, patch)


def compare_semver(latest_str: str, current_str: str) -> bool:
    """Return True if latest_str is strictly greater than current_str in SemVer."""
    latest_tuple = _parse_semver_tuple(latest_str)
    current_tuple = _parse_semver_tuple(current_str)
    return latest_tuple > current_tuple


def check_latest_release(current_version: str, force: bool = False) -> Dict[str, Any]:
    """
    Check GitHub Releases for ffmpeg-gui updates with air-gapped silent fallback and 6-hour caching.
    """
    global _CACHE
    now = time.time()

    if not force and _CACHE["data"] is not None and (now - _CACHE["timestamp"] < CACHE_TTL_SECONDS):
        return _CACHE["data"]

    url = "https://api.github.com/repos/alexolivan/ffmpeg-gui/releases/latest"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "ffmpeg-gui-update-checker",
            "Accept": "application/vnd.github.v3+json"
        }
    )

    try:
        with urllib.request.urlopen(req, timeout=4.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            tag_name = data.get("tag_name", "").strip()
            html_url = data.get("html_url")
            latest_clean = tag_name.lstrip("v").strip()

            is_newer = compare_semver(latest_clean, current_version) if latest_clean else False

            result = {
                "update_available": is_newer,
                "latest_release": latest_clean if latest_clean else None,
                "release_url": html_url,
                "checked_at": now
            }
            _CACHE["timestamp"] = now
            _CACHE["data"] = result
            return result
    except Exception as e:
        logger.debug("Silently skipped update check: %s", e)
        fallback = {
            "update_available": False,
            "latest_release": None,
            "release_url": None,
            "checked_at": now
        }
        if _CACHE["data"] is None:
            _CACHE["timestamp"] = now
            _CACHE["data"] = fallback
        return fallback


def get_git_metadata() -> Dict[str, Any]:
    """
    Resolve local git metadata (branch, commit short hash, and release environment flag).
    Falls back gracefully if running in a non-git (packaged release) directory.
    """
    branch = "main"
    commit = "release"
    is_release = True

    try:
        branch_proc = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            timeout=1.5,
            check=False
        )
        if branch_proc.returncode == 0:
            raw_branch = branch_proc.stdout.strip()
            if raw_branch and raw_branch != "HEAD":
                branch = raw_branch
            elif raw_branch == "HEAD":
                # Detached HEAD, check if tagged
                tag_proc = subprocess.run(
                    ["git", "describe", "--tags", "--exact-match"],
                    capture_output=True,
                    text=True,
                    timeout=1.5,
                    check=False
                )
                if tag_proc.returncode == 0:
                    branch = tag_proc.stdout.strip()

        commit_proc = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            timeout=1.5,
            check=False
        )
        if commit_proc.returncode == 0 and commit_proc.stdout.strip():
            commit = commit_proc.stdout.strip()

        # Determine if release or development branch
        if branch in ("main", "master") or branch.startswith("v"):
            is_release = True
        else:
            is_release = False
    except Exception as e:
        logger.debug("Could not resolve git metadata: %s", e)
        branch = "main"
        commit = "release"
        is_release = True

    return {
        "branch": branch,
        "commit": commit,
        "is_release": is_release
    }
