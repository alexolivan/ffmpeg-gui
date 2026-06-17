import pytest
import asyncio
from unittest.mock import MagicMock, patch
from core.lcd.drivers.cfa635 import Cfa635Driver
from core.lcd.manager import LCDManager

@pytest.mark.asyncio
async def test_driver_set_gpo():
    driver = Cfa635Driver(port="/dev/ttyUSB0")
    driver._send_packet = MagicMock()
    driver.set_gpo(5, 100)
    
    # Verify command 34 payload format: struct.pack("BB", pin, duty_cycle)
    driver._send_packet.assert_called_once()
    args, kwargs = driver._send_packet.call_args
    assert args[0] == 34
    assert args[1] == b'\x05\x64'

@pytest.mark.asyncio
async def test_led_color_gpo_mapping():
    db_factory = MagicMock()
    proc_mgr = MagicMock()
    task_mgr = MagicMock()
    
    manager = LCDManager(db_factory, proc_mgr, task_mgr, port="/dev/ttyUSB0")
    manager.driver = MagicMock()
    
    # Test setting RED on LED 0 (pin 5 = GREEN, pin 6 = RED)
    manager.set_led_color(0, "red")
    manager.driver.set_gpo.assert_any_call(5, 0)
    manager.driver.set_gpo.assert_any_call(6, 100)
    manager.driver.reset_mock()
    
    # Test setting GREEN on LED 1 (pin 7 = GREEN, pin 8 = RED)
    manager.set_led_color(1, "green")
    manager.driver.set_gpo.assert_any_call(7, 100)
    manager.driver.set_gpo.assert_any_call(8, 0)
    manager.driver.reset_mock()
    
    # Test setting YELLOW on LED 2 (pin 9 = GREEN, pin 10 = RED)
    manager.set_led_color(2, "yellow")
    manager.driver.set_gpo.assert_any_call(9, 100)
    manager.driver.set_gpo.assert_any_call(10, 100)
    manager.driver.reset_mock()
    
    # Test setting OFF on LED 3 (pin 11 = GREEN, pin 12 = RED)
    manager.set_led_color(3, "off")
    manager.driver.set_gpo.assert_any_call(11, 0)
    manager.driver.set_gpo.assert_any_call(12, 0)

@pytest.mark.asyncio
async def test_locator_mode_activation():
    db_factory = MagicMock()
    proc_mgr = MagicMock()
    task_mgr = MagicMock()
    
    manager = LCDManager(db_factory, proc_mgr, task_mgr, port="/dev/ttyUSB0")
    manager.driver = MagicMock()
    manager._running = True
    
    manager.locator_active = True
    assert manager.locator_active is True
    
    # Trigger one step of led control loop manually to avoid long wait
    with patch('asyncio.sleep', return_value=None):
        # We run a single iteration or call helper logic directly
        # In locator mode: flash all 4 LEDs in red/green/yellow alternations at 2Hz
        manager.set_led_color = MagicMock()
        
        # Test setter transition reset
        manager.locator_active = False
        assert len(manager._last_rendered_lines) == 4
        assert "FFMPEG-GUI" in manager._last_rendered_lines[0]

@pytest.mark.asyncio
async def test_locator_keypad_dismiss():
    db_factory = MagicMock()
    proc_mgr = MagicMock()
    task_mgr = MagicMock()
    
    manager = LCDManager(db_factory, proc_mgr, task_mgr, port="/dev/ttyUSB0")
    manager.driver = MagicMock()
    manager.locator_active = True
    assert manager.locator_active is True
    
    mock_ser = MagicMock()
    mock_ser.is_open = True
    # Simulate packet: type 0x80, len 1, key 1, CRC 2 bytes
    mock_ser.in_waiting = 2
    mock_ser.read.side_effect = [b'\x80', b'\x01', b'\x01', b'\x00\x00']
    
    manager.driver.ser = mock_ser
    manager._running = True
    manager.refresh_display = MagicMock()
    
    with patch('asyncio.sleep', side_effect=Exception("Exit Loop")):
        try:
            await manager._read_loop()
        except Exception as e:
            assert str(e) == "Exit Loop"
            
    # Verify that locator was dismissed
    assert manager.locator_active is False
