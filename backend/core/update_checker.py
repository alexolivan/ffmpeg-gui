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
    "data": {
        "update_available": False,
        "latest_release": None,
        "release_url": None,
        "checked_at": 0.0
    }
}
_IS_CHECKING: bool = False
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


def _fetch_release_worker(current_version: str):
    global _CACHE, _IS_CHECKING
    now = time.time()
    url = "https://api.github.com/repos/alexolivan/ffmpeg-gui/releases/latest"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "ffmpeg-gui-update-checker",
            "Accept": "application/vnd.github.v3+json"
        }
    )

    try:
        with urllib.request.urlopen(req, timeout=3.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            tag_name = data.get("tag_name", "").strip()
            html_url = data.get("html_url")
            latest_clean = tag_name.lstrip("v").strip()

            is_newer = compare_semver(latest_clean, current_version) if latest_clean else False

            _CACHE["timestamp"] = now
            _CACHE["data"] = {
                "update_available": is_newer,
                "latest_release": latest_clean if latest_clean else None,
                "release_url": html_url,
                "checked_at": now
            }
    except Exception as e:
        logger.debug("Silently skipped update check: %s", e)
        _CACHE["timestamp"] = now
        _CACHE["data"] = {
            "update_available": False,
            "latest_release": None,
            "release_url": None,
            "checked_at": now
        }
    finally:
        _IS_CHECKING = False


def check_latest_release(current_version: str, force: bool = False) -> Dict[str, Any]:
    """
    Check GitHub Releases for ffmpeg-gui updates with air-gapped silent fallback and 6-hour caching.
    Non-blocking during regular polling (force=False); synchronous on explicit force refresh.
    """
    global _CACHE, _IS_CHECKING
    now = time.time()

    if not force and _CACHE["data"] is not None and (now - _CACHE["timestamp"] < CACHE_TTL_SECONDS):
        return _CACHE["data"]

    if force:
        _fetch_release_worker(current_version)
        return _CACHE["data"]

    if not _IS_CHECKING:
        import threading
        _IS_CHECKING = True
        t = threading.Thread(target=_fetch_release_worker, args=(current_version,), daemon=True)
        t.start()

    return _CACHE["data"]


_GIT_CACHE: Dict[str, Any] = {
    "timestamp": 0.0,
    "data": None
}


def get_git_metadata(force: bool = False) -> Dict[str, Any]:
    """
    Resolve local git metadata (branch, commit short hash, and release environment flag).
    Cached in memory for 300 seconds to prevent event-loop subprocess overhead.
    Falls back gracefully if running in a non-git (packaged release) directory.
    """
    global _GIT_CACHE
    now = time.time()
    if not force and _GIT_CACHE["data"] is not None and (now - _GIT_CACHE["timestamp"] < 300.0):
        return _GIT_CACHE["data"]

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

    result = {
        "branch": branch,
        "commit": commit,
        "is_release": is_release
    }
    _GIT_CACHE["timestamp"] = now
    _GIT_CACHE["data"] = result
    return result
