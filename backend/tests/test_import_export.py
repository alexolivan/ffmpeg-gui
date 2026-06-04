import sys
import os
import asyncio

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from database.db import SessionLocal, init_db
from database.models import MediaProcess, FfmpegBuild
from main import migrate_and_validate_profile, export_process, import_process, export_build_recipe, import_build_recipe

def test_import_export():
    init_db()
    
    # 1. Setup mock build profiles and clean previous runs
    with SessionLocal() as db:
        build = db.query(FfmpegBuild).filter(FfmpegBuild.name == "Test Import Build").first()
        if not build:
            build = FfmpegBuild(
                name="Test Import Build",
                ffmpeg_version="6.0",
                build_options={},
                install_path="/tmp/test_import_build",
                status="ready",
                is_default=True
            )
            db.add(build)
            db.commit()
            db.refresh(build)
        build_id = build.id

        # Clean up any previous test processes or build recipes
        for name in ["Test Export Process", "Imported: Legacy v1", "Imported: Version 2"]:
            proc = db.query(MediaProcess).filter(MediaProcess.name.like(f"%{name}%")).first()
            if proc:
                db.delete(proc)
        for name in ["Imported-Recipe-Test"]:
            rec = db.query(FfmpegBuild).filter(FfmpegBuild.name.like(f"%{name}%")).first()
            if rec:
                db.delete(rec)
        db.commit()

        # Create a process to test process export
        proc = MediaProcess(
            name="Test Export Process",
            type="service",
            input_config={
                "has_video": True,
                "has_audio": True,
                "use_secondary_input": False,
                "input1": {"type": "srt", "host": "127.0.0.1", "port": "9000", "mode": "listener"}
            },
            output_config={"type": "udp", "host": "239.0.0.1", "port": "1234"},
            codec_config={"vcodec": "libx264", "acodec": "aac"},
            filter_config={"scale": "1280x720"},
            ffmpeg_build_id=build_id,
            auto_start=True,
            watchdog_enabled=True,
            watchdog_retries=3
        )
        db.add(proc)
        db.commit()
        db.refresh(proc)
        proc_id = proc.id

    # 2. Test Process Export endpoint directly
    with SessionLocal() as db:
        data = export_process(proc_id, db)
        assert data["version"] == 2
        assert data["profile"]["name"] == "Test Export Process"
        assert data["profile"]["auto_start"] is True
        assert data["profile"]["watchdog_enabled"] is True
        assert data["profile"]["watchdog_retries"] == 3

    # 3. Test Process Schema Migration logic (v1 flat -> v2 nested)
    legacy_v1_payload = {
        "name": "Legacy v1",
        "input_config": {
            "type": "srt",
            "host": "10.0.0.5",
            "port": "5000",
            "mode": "caller",
            "has_video": True,
            "has_audio": False
        },
        "output_config": {"type": "rtmp", "url": "rtmp://live/stream"},
        "ffmpeg_build_id": 99999 # Non-existent build ID
    }

    with SessionLocal() as db:
        migrated = migrate_and_validate_profile(legacy_v1_payload, db)
        assert "input1" in migrated["input_config"]
        assert migrated["input_config"]["input1"]["type"] == "srt"
        assert migrated["input_config"]["input1"]["host"] == "10.0.0.5"
        assert migrated["input_config"]["input1"]["port"] == "5000"
        assert migrated["input_config"]["input1"]["mode"] == "caller"
        assert migrated["ffmpeg_build_id"] is not None
        resolved_build = db.query(FfmpegBuild).get(migrated["ffmpeg_build_id"])
        assert resolved_build.status == "ready"

    # 4. Test Process Import endpoint directly (v2 format)
    v2_import_payload = {
        "version": 2,
        "profile": {
            "name": "Version 2",
            "type": "service",
            "input_config": {
                "has_video": True,
                "has_audio": True,
                "use_secondary_input": False,
                "input1": {"type": "udp", "host": "127.0.0.1", "port": "1234"}
            },
            "output_config": {"type": "udp", "host": "239.0.0.1", "port": "1234"},
            "codec_config": {"vcodec": "libx264", "acodec": "aac"},
            "filter_config": {},
            "auto_start": True,
            "watchdog_enabled": False,
            "watchdog_retries": 5
        }
    }

    with SessionLocal() as db:
        imported_proc = import_process(v2_import_payload, db)
        assert imported_proc.name == "Imported: Version 2"
        assert imported_proc.auto_start is True
        assert imported_proc.watchdog_enabled is False

    # 5. Test Build Recipe Export directly
    with SessionLocal() as db:
        recipe_data = export_build_recipe(build_id, db)
        assert recipe_data["type"] == "ffmpeg_build_recipe"
        assert recipe_data["recipe"]["name"] == "Test Import Build"

    # 6. Test Build Recipe Import with missing SDK dependency validation
    unsupported_recipe_payload = {
        "type": "ffmpeg_build_recipe",
        "version": 1,
        "recipe": {
            "name": "Imported-Recipe-Test",
            "ffmpeg_version": "6.0",
            "srt_version": "1.5.0",
            "build_options": {
                "enable_ndi": True
            },
            "sdk_paths": {
                "ndi": "99.9.9" # Missing SDK version
            }
        }
    }

    from fastapi import HTTPException
    with SessionLocal() as db:
        try:
            import_build_recipe(unsupported_recipe_payload, db)
            assert False, "Should have failed NDI dependency check"
        except HTTPException as e:
            assert e.status_code == 400
            assert "Missing required NDI SDK Version" in e.detail
            print("SDK Dependency validation correctly verified!")

    # Clean up test builds/processes
    with SessionLocal() as db:
        for name in ["Test Export Process", "Imported: Legacy v1", "Imported: Version 2"]:
            proc = db.query(MediaProcess).filter(MediaProcess.name.like(f"%{name}%")).first()
            if proc:
                db.delete(proc)
        db.delete(db.query(FfmpegBuild).get(build_id))
        db.commit()

    print("ALL BACKEND IMPORT/EXPORT/MIGRATION/SDK TESTS PASSED!")

if __name__ == "__main__":
    test_import_export()
