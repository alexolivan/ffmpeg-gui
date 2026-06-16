import pytest
from unittest.mock import MagicMock
from core.lcd.manager import LCDManager

def test_manager_init():
    session_factory = MagicMock()
    proc_mgr = MagicMock()
    task_mgr = MagicMock()
    mgr = LCDManager(session_factory, proc_mgr, task_mgr, port="/dev/test_port")
    assert mgr.port == "/dev/test_port"
    assert mgr.current_view is not None
