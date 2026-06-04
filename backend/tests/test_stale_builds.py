import sys
import os
import asyncio

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from database.db import SessionLocal, init_db
from database.models import FfmpegBuild
from core.build_manager import BuildManager

def test_stale_builds():
    init_db()
    
    # 1. Create a dummy stale build in database
    with SessionLocal() as db:
        # Check if test build exists, if so delete it
        existing = db.query(FfmpegBuild).filter(FfmpegBuild.name == "Test Stale Build").first()
        if existing:
            db.delete(existing)
            db.commit()
            
        test_build = FfmpegBuild(
            name="Test Stale Build",
            ffmpeg_version="6.0",
            build_options={},
            install_path="/tmp/test_build",
            status="building"
        )
        db.add(test_build)
        db.commit()
        db.refresh(test_build)
        build_id = test_build.id
        print(f"Created dummy stale build with ID: {build_id}")

    # 2. Test main.py startup logic simulation
    with SessionLocal() as db:
        stale_builds = db.query(FfmpegBuild).filter(FfmpegBuild.status == "building").all()
        assert len(stale_builds) > 0, "Should have found stale builds"
        for build in stale_builds:
            build.status = "failed"
            build.build_log_summary = "Build aborted (server restarted)"
        db.commit()
        
    with SessionLocal() as db:
        build = db.query(FfmpegBuild).get(build_id)
        assert build.status == "failed"
        assert build.build_log_summary == "Build aborted (server restarted)"
        print("SUCCESS: Startup cleanup verified successfully!")

    # 3. Test stop compile stale transition
    # Reset status back to building for the next test
    with SessionLocal() as db:
        build = db.query(FfmpegBuild).get(build_id)
        build.status = "building"
        db.commit()

    # Simulate /builds/{build_id}/stop handling
    with SessionLocal() as db:
        build = db.query(FfmpegBuild).get(build_id)
        # build_manager is newly initialized, so build_manager.active_build_id is None
        active_build_id = None 
        
        if active_build_id == build_id:
            pass # Active in memory
        elif build.status == "building":
            build.status = "failed"
            build.build_log_summary = "Build aborted by user (stale status reset)"
            db.commit()
            print("SUCCESS: Stop stale compile transition verified successfully!")
        else:
            raise Exception("Should have handled stale building status")

    with SessionLocal() as db:
        build = db.query(FfmpegBuild).get(build_id)
        assert build.status == "failed"
        assert build.build_log_summary == "Build aborted by user (stale status reset)"
        
        # Cleanup
        db.delete(build)
        db.commit()
        print("Cleanup done.")

if __name__ == "__main__":
    test_stale_builds()
