import copy
import datetime
import logging
import os
import re
from typing import Any, Callable, Optional

from sqlalchemy.orm.attributes import flag_modified

from core.forge_revisions import build_recipe_snapshot, compute_recipe_diff
from database.models import SoftwareBuild

logger = logging.getLogger("ForgeExecutor")


def compute_is_outdated(build: SoftwareBuild, stype: str) -> tuple[bool, Optional[str]]:
    """Return (is_outdated, recipe_version) for a compiled SoftwareBuild."""
    from forge.recipes import get_recipe_version

    recipe_version = get_recipe_version(stype)
    is_outdated = False
    if recipe_version and build.status == "ready":
        current_ver = build.version_tag or build.ffmpeg_version or "1.0.0"
        if build.version_output:
            match = re.search(r"v(\d+\.\d+(?:\.\d+)?)", build.version_output)
            if match:
                current_ver = match.group(1)
        if "v" in str(current_ver).lower():
            current_ver = str(current_ver).lower().replace("v", "").strip()
        try:
            from packaging import version
            is_outdated = version.parse(str(current_ver)) < version.parse(str(recipe_version))
        except Exception:
            is_outdated = str(current_ver) != str(recipe_version)
    return is_outdated, recipe_version


def build_needs_recompile(
    build: SoftwareBuild, stype: Optional[str] = None
) -> tuple[bool, list[dict[str, Optional[str]]], Optional[dict[str, Any]]]:
    """Evaluate whether a compiled SoftwareBuild requires recompilation."""
    resolved_type = stype or build.software_type or "ffmpeg"
    source_type = getattr(build, "source_type", "compiled") or "compiled"

    current_snapshot = build_recipe_snapshot(
        build.version_tag,
        build.build_options,
        build.sdk_paths,
        resolved_type,
    )
    compiled_snapshot = getattr(build, "compiled_snapshot", None)
    if compiled_snapshot is None and build.status == "ready" and source_type == "compiled":
        compiled_snapshot = current_snapshot

    pending_changes = (
        compute_recipe_diff(compiled_snapshot, current_snapshot, resolved_type)
        if compiled_snapshot
        else []
    )
    is_outdated, _ = compute_is_outdated(build, resolved_type)

    needs = False
    if source_type == "compiled":
        if build.status in ("pending", "failed") or is_outdated or len(pending_changes) > 0:
            needs = True

    return needs, pending_changes, compiled_snapshot


async def execute_forge_build_pipeline(
    build_id: int,
    db_session_factory,
    build_manager,
    *,
    clean: bool = False,
    max_jobs: Optional[int] = None,
    low_priority: bool = True,
    ws_connections: Optional[dict] = None,
    notify_callback: Optional[Callable[..., Any]] = None,
    extra_log_callback: Optional[Callable[[str], Any]] = None,
) -> dict[str, Any]:
    """Execute a Forge build end-to-end with atomic revision swap and rollback preservation."""
    if build_manager.is_building:
        return {
            "success": False,
            "build_id": build_id,
            "build_name": f"Build #{build_id}",
            "error": "Another build is already in progress",
            "hw_checks": [],
        }

    with db_session_factory() as session:
        build = session.query(SoftwareBuild).get(build_id)
        if not build:
            return {
                "success": False,
                "build_id": build_id,
                "build_name": f"Build #{build_id}",
                "error": "Build profile not found",
                "hw_checks": [],
            }

        try:
            from core.hardware_health import hardware_health_manager
            if hardware_health_manager.active_protection_enabled:
                snap = hardware_health_manager.get_health_snapshot()
                if snap.get("status") == "critical":
                    err_msg = (
                        f"Thermal protection active: build halted due to critical hardware "
                        f"temperature ({snap.get('max_temp_c')}°C >= {hardware_health_manager.critical_threshold_c}°C)"
                    )
                    return {
                        "success": False,
                        "build_id": build_id,
                        "build_name": build.name,
                        "error": err_msg,
                        "hw_checks": [],
                    }
        except Exception as exc:
            logger.debug(f"Thermal protection check error: {exc}")

        stype = build.software_type or "ffmpeg"
        build_name = build.name
        had_ready_binary = (
            build.status == "ready"
            and bool(build.binary_path)
            and os.path.isfile(build.binary_path)
        )
        prev_raw_opts = copy.deepcopy(build.build_options or {})
        prev_raw_sdks = copy.deepcopy(build.sdk_paths) if build.sdk_paths else None
        prev_snapshot = build.compiled_snapshot or (
            build_recipe_snapshot(build.version_tag, prev_raw_opts, prev_raw_sdks, stype)
            if had_ready_binary
            else None
        )
        prev_state = (
            {
                "install_path": build.install_path,
                "binary_path": build.binary_path,
                "ffprobe_binary": build.ffprobe_binary,
                "version_tag": build.version_tag,
                "version_output": build.version_output,
                "built_at": build.built_at.isoformat() if build.built_at else None,
                "snapshot": prev_snapshot,
                "raw_build_options": prev_raw_opts,
                "raw_sdk_paths": prev_raw_sdks,
            }
            if had_ready_binary
            else None
        )

        target_version_tag = build.version_tag
        target_srt_version = build.srt_version
        target_raw_opts = copy.deepcopy(build.build_options or {})
        target_raw_sdks = copy.deepcopy(build.sdk_paths) if build.sdk_paths else None
        target_sources_cleaned = bool(clean or build.sources_cleaned)
        target_auto_clean = bool(build.auto_clean or False)
        storage_path = build.storage.path if build.storage else None

        build.status = "building"
        build.build_log_summary = None
        build.last_compile_error = None
        if clean:
            build.sources_cleaned = False
        session.commit()

    build_path = build_manager.get_build_path(build_id, builds_root=storage_path)
    os.makedirs(build_path, exist_ok=True)
    log_file_path = os.path.join(build_path, "build.log")

    try:
        with open(log_file_path, "w") as f:
            f.write("")
    except Exception as exc:
        logger.error(f"Failed to clear build log file: {exc}")

    async def _log_callback(msg: str):
        try:
            with open(log_file_path, "a") as f:
                f.write(msg)
        except Exception as exc:
            logger.error(f"Failed to write to build log file: {exc}")

        if ws_connections is not None and build_id in ws_connections:
            dead = []
            for ws in ws_connections[build_id]:
                try:
                    await ws.send_text(msg)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                ws_connections[build_id].remove(ws)

        if extra_log_callback is not None:
            try:
                res_cb = extra_log_callback(msg)
                if hasattr(res_cb, "__await__"):
                    await res_cb
            except Exception as exc:
                logger.debug(f"extra_log_callback error: {exc}")

    try:
        result = await build_manager.run_build(
            build_id=build_id,
            ffmpeg_version=target_version_tag,
            srt_version=target_srt_version,
            options=copy.deepcopy(target_raw_opts),
            sdk_paths=copy.deepcopy(target_raw_sdks),
            sources_cleaned=target_sources_cleaned,
            log_callback=_log_callback,
            auto_clean=target_auto_clean,
            builds_root=storage_path,
            software_type=stype,
            max_jobs=max_jobs,
            low_priority=low_priority,
            clean_sources_first=clean,
        )

        with db_session_factory() as session:
            db_build = session.query(SoftwareBuild).get(build_id)
            if not db_build:
                return {
                    "success": False,
                    "build_id": build_id,
                    "build_name": build_name,
                    "error": "Build profile deleted during compilation",
                    "hw_checks": [],
                }

            if result.get("success"):
                if (
                    had_ready_binary
                    and prev_state
                    and prev_state.get("install_path") != result.get("install_path")
                ):
                    db_build.previous_revision = prev_state
                    flag_modified(db_build, "previous_revision")

                db_build.status = "ready"
                db_build.install_path = result.get("install_path") or db_build.install_path
                db_build.binary_path = result.get("binary_path")
                db_build.version_output = result.get("version_output")
                if result.get("version_tag"):
                    db_build.ffmpeg_version = result.get("version_tag")
                    db_build.version_tag = result.get("version_tag")
                db_build.built_at = datetime.datetime.utcnow()
                db_build.sources_cleaned = bool(db_build.auto_clean)
                db_build.last_compile_error = None
                db_build.build_log_summary = None
                if result.get("build_options"):
                    db_build.build_options = result.get("build_options")
                    flag_modified(db_build, "build_options")
                if result.get("sdk_paths"):
                    db_build.sdk_paths = result.get("sdk_paths")
                    flag_modified(db_build, "sdk_paths")

                db_build.compiled_snapshot = build_recipe_snapshot(
                    db_build.version_tag,
                    db_build.build_options,
                    db_build.sdk_paths,
                    db_build.software_type or "ffmpeg",
                )
                flag_modified(db_build, "compiled_snapshot")

                keep_paths = [
                    db_build.install_path,
                    db_build.previous_revision.get("install_path")
                    if isinstance(db_build.previous_revision, dict)
                    else None,
                ]
                build_manager.cleanup_old_revisions(
                    build_id, keep_paths=keep_paths, builds_root=storage_path
                )
                disk_mb = build_manager.get_disk_usage(build_id, storage_path)
                db_build.disk_usage_mb = disk_mb

                existing_default = (
                    session.query(SoftwareBuild)
                    .filter(
                        SoftwareBuild.software_type == db_build.software_type,
                        SoftwareBuild.is_default == True,
                        SoftwareBuild.status == "ready",
                        SoftwareBuild.id != db_build.id,
                    )
                    .first()
                )
                if not existing_default:
                    db_build.is_default = True

                session.commit()
                if notify_callback is not None:
                    notify_callback(
                        build_id=build_id,
                        build_name=db_build.name,
                        success=True,
                        version_output=result.get("version_output"),
                        disk_usage_mb=disk_mb,
                        auto_clean=bool(db_build.auto_clean),
                    )
                return {
                    "success": True,
                    "build_id": build_id,
                    "build_name": db_build.name,
                    "error": None,
                    "hw_checks": result.get("hw_checks", []),
                }

            error_msg = result.get("error", "Unknown error")
            if (
                had_ready_binary
                and prev_state
                and prev_state.get("binary_path")
                and os.path.isfile(prev_state["binary_path"])
            ):
                db_build.status = "ready"
            else:
                db_build.status = "failed"
            db_build.last_compile_error = error_msg
            db_build.build_log_summary = error_msg
            db_build.disk_usage_mb = build_manager.get_disk_usage(build_id, storage_path)
            session.commit()
            if notify_callback is not None:
                notify_callback(
                    build_id=build_id,
                    build_name=db_build.name,
                    success=False,
                    error_msg=error_msg,
                )
            return {
                "success": False,
                "build_id": build_id,
                "build_name": db_build.name,
                "error": error_msg,
                "hw_checks": result.get("hw_checks", []),
            }

    except Exception as exc:
        logger.error(f"Build {build_id} failed with exception: {exc}")
        await _log_callback(f"\nFATAL ERROR: {exc}\n")
        with db_session_factory() as session:
            db_build = session.query(SoftwareBuild).get(build_id)
            if db_build:
                if (
                    had_ready_binary
                    and prev_state
                    and prev_state.get("binary_path")
                    and os.path.isfile(prev_state["binary_path"])
                ):
                    db_build.status = "ready"
                else:
                    db_build.status = "failed"
                db_build.last_compile_error = str(exc)
                db_build.build_log_summary = str(exc)
                db_build.disk_usage_mb = build_manager.get_disk_usage(build_id, storage_path)
                session.commit()
                if notify_callback is not None:
                    notify_callback(
                        build_id=build_id,
                        build_name=db_build.name,
                        success=False,
                        error_msg=str(exc),
                    )
            elif notify_callback is not None:
                notify_callback(
                    build_id=build_id,
                    build_name=build_name,
                    success=False,
                    error_msg=str(exc),
                )
        return {
            "success": False,
            "build_id": build_id,
            "build_name": build_name,
            "error": str(exc),
            "hw_checks": [],
        }
