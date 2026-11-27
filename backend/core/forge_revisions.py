import os
from typing import Any, Optional

_CANONICAL_BOOL_OPTIONS = (
    "libsrt",
    "vaapi",
    "nvenc",
    "cuda_filters",
    "decklink",
    "ndi",
    "whip",
)

_CANONICAL_SDK_KEYS = (
    "decklink",
    "ndi",
    "ndi_patch_file",
    "nvenc_headers",
)


def build_recipe_snapshot(
    version_tag: Optional[str],
    build_options: Optional[dict],
    sdk_paths: Optional[dict],
    software_type: str = "ffmpeg",
) -> dict[str, Any]:
    """Build a canonical snapshot of only user-configurable compile fields.

    Cosmetic metadata (`name`, `auto_clean`, `storage_id`) and runtime-enriched
    compile keys (`libfdk_aac`, `libpulse`, `sdk_paths['vaapi']`) are omitted
    to prevent false-positive `needs_recompile` warnings.
    """
    opts_in = build_options if isinstance(build_options, dict) else {}
    sdks_in = sdk_paths if isinstance(sdk_paths, dict) else {}

    canon_opts: dict[str, Any] = {}
    for key in _CANONICAL_BOOL_OPTIONS:
        if opts_in.get(key):
            canon_opts[key] = True

    if canon_opts.get("libsrt"):
        srt_ver = opts_in.get("srt_version")
        if isinstance(srt_ver, str):
            srt_ver = srt_ver.strip()
        if srt_ver:
            canon_opts["srt_version"] = str(srt_ver)

    decklink_ver = opts_in.get("decklink_version")
    if isinstance(decklink_ver, str):
        decklink_ver = decklink_ver.strip()
    if decklink_ver:
        canon_opts["decklink_version"] = str(decklink_ver)

    canon_sdks: dict[str, str] = {}
    for key in _CANONICAL_SDK_KEYS:
        val = sdks_in.get(key)
        if val is not None:
            s_val = str(val).strip()
            if s_val:
                canon_sdks[key] = s_val

    return {
        "software_type": str(software_type or "ffmpeg").strip() or "ffmpeg",
        "version_tag": str(version_tag or "").strip(),
        "build_options": canon_opts,
        "sdk_paths": canon_sdks,
    }


def _feature_value(snapshot: dict[str, Any], field: str) -> Optional[str]:
    """Return comparable string representation of a snapshot feature, or None when disabled."""
    opts = snapshot.get("build_options") or {}
    sdks = snapshot.get("sdk_paths") or {}

    if field == "version":
        ver = str(snapshot.get("version_tag") or "").strip()
        return ver or None
    if field == "srt":
        if not opts.get("libsrt"):
            return None
        return str(opts.get("srt_version") or "").strip() or "enabled"
    if field == "nvenc":
        if not opts.get("nvenc"):
            return None
        return str(sdks.get("nvenc_headers") or "").strip() or "enabled"
    if field == "vaapi":
        return "enabled" if opts.get("vaapi") else None
    if field == "ndi":
        if not opts.get("ndi"):
            return None
        return str(sdks.get("ndi") or "").strip() or "enabled"
    if field == "ndi_patch":
        if not opts.get("ndi"):
            return None
        val = str(sdks.get("ndi_patch_file") or "").strip()
        return val or None
    if field == "decklink":
        has_flag = bool(opts.get("decklink"))
        sdk_val = str(sdks.get("decklink") or opts.get("decklink_version") or "").strip()
        if not has_flag and not sdk_val:
            return None
        return sdk_val or "enabled"
    if field == "cuda_filters":
        return "enabled" if opts.get("cuda_filters") else None
    if field == "whip":
        return "enabled" if opts.get("whip") else None
    return None


def compute_recipe_diff(
    base_snapshot: Optional[dict],
    target_snapshot: Optional[dict],
    software_type: str = "ffmpeg",
) -> list[dict[str, Optional[str]]]:
    """Compute ordered feature-level differences between two canonical snapshots."""
    base_norm = build_recipe_snapshot(
        (base_snapshot or {}).get("version_tag"),
        (base_snapshot or {}).get("build_options"),
        (base_snapshot or {}).get("sdk_paths"),
        (base_snapshot or {}).get("software_type") or software_type,
    )
    target_norm = build_recipe_snapshot(
        (target_snapshot or {}).get("version_tag"),
        (target_snapshot or {}).get("build_options"),
        (target_snapshot or {}).get("sdk_paths"),
        (target_snapshot or {}).get("software_type") or software_type,
    )

    fields = (
        "version",
        "srt",
        "nvenc",
        "vaapi",
        "ndi",
        "ndi_patch",
        "decklink",
        "cuda_filters",
        "whip",
    )
    diffs: list[dict[str, Optional[str]]] = []
    for field in fields:
        old_val = _feature_value(base_norm, field)
        new_val = _feature_value(target_norm, field)
        if old_val != new_val:
            diffs.append({
                "field": field,
                "from": old_val,
                "to": new_val,
            })
    return diffs


def is_revision_path_valid(rev: Optional[dict]) -> bool:
    """Return True if a stored revision metadata dict points to an existing install dir and binary file."""
    if not isinstance(rev, dict):
        return False
    install_path = rev.get("install_path")
    binary_path = rev.get("binary_path")
    if not install_path or not binary_path:
        return False
    return os.path.isdir(install_path) and os.path.isfile(binary_path)
