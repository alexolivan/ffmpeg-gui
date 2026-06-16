import pytest
from database.models import SystemSettings
from main import SettingsUpdate

def test_system_settings_has_lcd_fields():
    settings = SystemSettings()
    assert hasattr(settings, "lcd_enabled")
    assert hasattr(settings, "lcd_port")
    assert hasattr(settings, "lcd_model")

def test_settings_update_schema():
    data = {"lcd_enabled": True, "lcd_port": "/dev/ttyUSB0", "lcd_model": "cfa635"}
    update_model = SettingsUpdate(**data)
    assert update_model.lcd_enabled is True
    assert update_model.lcd_port == "/dev/ttyUSB0"
    assert update_model.lcd_model == "cfa635"
