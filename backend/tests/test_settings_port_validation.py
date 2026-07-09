import os
import sys
import pytest
from unittest.mock import patch

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# Set default active port at import time
os.environ["ACTIVE_PORT"] = "8000"


@patch.dict(os.environ, {"ACTIVE_PORT": "8000"})
def test_port_validation_logic():
    from main import is_port_in_use_by_os, is_port_allocated_in_db
    
    # Test OS port binding (port 8000 is us, so it should return False)
    assert is_port_in_use_by_os(8000) is False
    
    # Test logic mapping for DB ports
    from database.models import MediaProcess
    
    mock_process_1 = MediaProcess(
        name="SRT Input Stream",
        input_config={"type": "srt", "port": "9999"},
        output_config=[]
    )
    
    # Mock db query
    class MockDb:
        def query(self, model):
            return self
        def all(self):
            return [mock_process_1]
            
    db = MockDb()
    assert is_port_allocated_in_db(9999, db) is True
    assert is_port_allocated_in_db(7777, db) is False


@patch.dict(os.environ, {"ACTIVE_PORT": "8000"})
def test_process_gui_port_conflict():
    from fastapi import HTTPException
    from main import check_media_process_port_conflicts
    
    # active_port is 8000
    conflict_input = {"type": "srt", "port": "8000"}
    safe_input = {"type": "srt", "port": "9000"}
    
    # Should raise HTTPException for conflict_input (conflict with ACTIVE_PORT)
    with pytest.raises(HTTPException) as exc_info:
        check_media_process_port_conflicts(conflict_input, [])
    assert exc_info.value.status_code == 400
    
    # Should pass for safe_input
    check_media_process_port_conflicts(safe_input, [])

    # Test conflict with port in CONFIG_FILE_PATH
    scratch_config_path = "backend/tests/scratch_config.conf"
    with patch.dict(os.environ, {"CONFIG_FILE_PATH": scratch_config_path}):
        with open(scratch_config_path, "w") as f:
            f.write("[server]\nport = 8500\n")
            
        try:
            conflict_config_port = {"type": "srt", "port": "8500"}
            with pytest.raises(HTTPException) as exc_info:
                check_media_process_port_conflicts(conflict_config_port, [])
            assert exc_info.value.status_code == 400
        finally:
            if os.path.exists(scratch_config_path):
                os.remove(scratch_config_path)


def test_settings_endpoints():
    scratch_config_path = "backend/tests/scratch_config.conf"
    with patch.dict(os.environ, {"CONFIG_FILE_PATH": scratch_config_path, "ACTIVE_PORT": "8000"}):
        with open(scratch_config_path, "w") as f:
            f.write("[server]\nport = 8000\n")
            
        try:
            from fastapi.testclient import TestClient
            from main import app
            client = TestClient(app)
            
            # Test GET /settings with active port matching config port
            response = client.get("/settings")
            assert response.status_code == 200
            data = response.json()
            assert data["gui_port"] == 8000
            assert data["restart_required"] is False
            
            # Test GET /settings with active port different from config port
            with open(scratch_config_path, "w") as f:
                f.write("[server]\nport = 8500\n")
                
            response = client.get("/settings")
            assert response.status_code == 200
            data = response.json()
            assert data["gui_port"] == 8500
            assert data["restart_required"] is True
            
            # Test POST /settings/restart
            with patch("main.execute_system_restart") as mock_restart:
                response = client.post("/settings/restart")
                assert response.status_code == 200
                data = response.json()
                assert data["status"] == "ok"
                assert "restarting" in data["message"].lower()
                
        finally:
            if os.path.exists(scratch_config_path):
                os.remove(scratch_config_path)
