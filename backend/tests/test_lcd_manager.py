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

from unittest.mock import patch

@pytest.mark.asyncio
@patch('serial.Serial')
async def test_manager_stop_shuts_down_lcd(mock_serial):
    manager = LCDManager(None, None, None, "/dev/test_port")
    manager.start()
    manager.driver = MagicMock()
    manager.stop()
    manager.driver.set_backlight.assert_called_with(0)
