import sys
import os
import pytest

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from database.db import SessionLocal, init_db
from database.models import FfmpegBuild
from main import (
    BuildCreate,
    BuildUpdate,
    create_build,
    update_build,
    import_build_recipe,
    export_build_recipe,
    _serialize_build,
)

@pytest.fixture(autouse=True)
def setup_db():
    init_db()
    with SessionLocal() as db:
        db.query(FfmpegBuild).filter(FfmpegBuild.name.like("Test-Forge-SRT%")).delete()
        db.commit()
    yield
    with SessionLocal() as db:
        db.query(FfmpegBuild).filter(FfmpegBuild.name.like("Test-Forge-SRT%")).delete()
        db.commit()


def test_import_and_update_libsrt_version():
    with SessionLocal() as db:
        # 1. Import recipe that specifies libsrt 1.5.5
        recipe_payload = {
            "type": "software_build_recipe",
            "version": 2,
            "software_type": "ffmpeg",
            "recipe": {
                "name": "Test-Forge-SRT-Import",
                "software_type": "ffmpeg",
                "ffmpeg_version": "7.1",
                "srt_version": "1.5.5",
                "build_options": {
                    "libsrt": True,
                    "srt_version": "1.5.5",
                    "vaapi": False,
                },
                "sdk_paths": {},
            }
        }
        imported = import_build_recipe(recipe_payload, db=db)
        build_id = imported["id"]
        assert imported["srt_version"] == "1.5.5"
        assert imported["build_options"].get("srt_version") == "1.5.5"

        # 2. Update to 1.5.7 (simulating payload where srt_version is 1.5.7, even if build_options had stale srt_version)
        update_data = BuildUpdate(
            srt_version="1.5.7",
            build_options={
                "libsrt": True,
                "srt_version": "1.5.5",  # stale in options dict
                "vaapi": False,
            }
        )
        updated = update_build(build_id, update_data, db=db)
        assert updated["srt_version"] == "1.5.7"
        assert updated["build_options"].get("srt_version") == "1.5.7"

        # Query fresh from DB to verify persistence in SQLite
        db_build = db.query(FfmpegBuild).get(build_id)
        assert db_build.srt_version == "1.5.7"
        assert db_build.build_options.get("srt_version") == "1.5.7"

        # 3. Disable libsrt (simulating unchecking libsrt in form)
        disable_data = BuildUpdate(
            srt_version=None,
            build_options={
                "libsrt": False,
                "srt_version": "1.5.7",  # stale
                "vaapi": False,
            }
        )
        disabled = update_build(build_id, disable_data, db=db)
        assert disabled["srt_version"] is None
        assert disabled["build_options"].get("srt_version") is None

        # Verify DB reflection
        db_build = db.query(FfmpegBuild).get(build_id)
        assert db_build.srt_version is None
        assert db_build.build_options.get("srt_version") is None


def test_create_build_libsrt_sync():
    with SessionLocal() as db:
        create_data = BuildCreate(
            name="Test-Forge-SRT-Create",
            ffmpeg_version="7.1",
            srt_version="1.5.7",
            build_options={
                "libsrt": True,
            }
        )
        created = create_build(create_data, db=db)
        build_id = created["id"]
        assert created["srt_version"] == "1.5.7"
        assert created["build_options"].get("srt_version") == "1.5.7"

        db_build = db.query(FfmpegBuild).get(build_id)
        assert db_build.srt_version == "1.5.7"
        assert db_build.build_options.get("srt_version") == "1.5.7"
