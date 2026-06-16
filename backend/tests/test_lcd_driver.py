import pytest
from unittest.mock import MagicMock, patch
from core.lcd.drivers.cfa635 import Cfa635Driver

@patch('serial.Serial')
def test_driver_crc_and_ping(mock_serial):
    driver = Cfa635Driver(port="/dev/test_port")
    assert driver._calculate_crc(b'\x00\x00') == 0x0F47
