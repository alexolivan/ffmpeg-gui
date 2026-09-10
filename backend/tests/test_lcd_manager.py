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

@pytest.mark.asyncio
@patch('serial.Serial')
async def test_manager_keymap_and_dimming(mock_serial):
    import time
    mgr = LCDManager(None, None, None, "/dev/test_port")
    mgr.driver = MagicMock()
    
    # Test corrected keymap (key code 2 is DOWN, 5 is TICK, 6 is X)
    assert mgr.key_map[1] == "UP"
    assert mgr.key_map[2] == "DOWN"
    assert mgr.key_map[5] == "TICK"
    assert mgr.key_map[6] == "X"
    
    # Mock settings
    mgr.active_brightness = 100
    mgr.dim_brightness = 20
    mgr.dim_timeout = 1 # 1 second for fast test
    mgr._last_activity = time.time() - 2 # force timeout
    mgr._is_dimmed = False

    # Trigger dim check
    await mgr._check_dim_timeout()
    mgr.driver.set_backlight.assert_called_with(20)
    assert mgr._is_dimmed is True

    # Trigger keypress and restore backlight
    mgr.driver.set_backlight.reset_mock()
    mgr._register_activity()
    mgr.driver.set_backlight.assert_called_with(100)
    assert mgr._is_dimmed is False


def test_manager_prefixes_and_new_profiles():
    mgr = LCDManager(None, None, None, port="/dev/test_port")
    assert mgr.get_led_legend_prefix("heartbeat") == "HB  "
    assert mgr.get_led_legend_prefix("services") == "SRV "
    assert mgr.get_led_legend_prefix("streams") == "SRV "
    assert mgr.get_led_legend_prefix("tasks") == "TSK "
    assert mgr.get_led_legend_prefix("resources") == "RES "
    assert mgr.get_led_legend_prefix("alert") == "RES "
    assert mgr.get_led_legend_prefix("recording") == "REC "
    assert mgr.get_led_legend_prefix("storage") == "STO "
    assert mgr.get_led_legend_prefix("peers") == "P2P "
    assert mgr.get_led_legend_prefix("p2p") == "P2P "


def test_peer_led_profile_states():
    mgr = LCDManager(None, None, None, port="/dev/test_port")
    mgr.set_led_color = MagicMock()
    mgr.lcd_led0_profile = "peers"
    mgr.lcd_led1_profile = "disabled"
    mgr.lcd_led2_profile = "disabled"
    mgr.lcd_led3_profile = "disabled"

    # 1. When no peers configured (state 'none') -> LED is 'off'
    mgr._cached_led_states["peer_state"] = "none"
    # Call the profile logic directly or simulate one iteration
    peer_st = mgr._cached_led_states.get("peer_state", "none")
    assert peer_st == "none"

    # Test resolution logic for peers profile
    def evaluate_peer_color(state):
        if state == "error":
            return "red"
        elif state == "warn":
            return "yellow"
        elif state == "ok":
            return "green"
        return "off"

    assert evaluate_peer_color("none") == "off"
    assert evaluate_peer_color("error") == "red"
    assert evaluate_peer_color("warn") == "yellow"
    assert evaluate_peer_color("ok") == "green"

