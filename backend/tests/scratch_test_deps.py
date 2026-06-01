import sys
import os

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.build_manager import BuildManager

def test_check():
    bm = BuildManager(builds_root="./ffmpeg_builds")
    res = bm.check_dependencies()
    print("KEYS:", res.keys())
    assert "dependencies" in res
    assert "all_required_met" in res
    assert "libx264" in res["dependencies"]
    assert "libssl" in res["dependencies"]
    assert "type" in res["dependencies"]["libx264"]
    print("SUCCESS: check_dependencies matches the requested payload specs!")

if __name__ == "__main__":
    test_check()
