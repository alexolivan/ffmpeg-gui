import os
import sys
import pytest
from unittest.mock import patch

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# Mock active port for test context
os.environ["ACTIVE_PORT"] = "8000"

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
