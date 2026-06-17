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

def test_lcd_new_settings_defaults():
    from database.db import SessionLocal, init_db
    init_db()
    db = SessionLocal()
    try:
        # Clear existing settings to test defaults
        db.query(SystemSettings).delete()
        db.commit()
        
        s = SystemSettings()
        db.add(s)
        db.commit()
        db.refresh(s)
        
        assert s.lcd_brightness == 100
        assert s.lcd_dim_brightness == 20
        assert s.lcd_dim_timeout == 30
        assert s.lcd_led0_profile == "heartbeat"
        assert s.lcd_led1_profile == "streams"
        assert s.lcd_led2_profile == "tasks"
        assert s.lcd_led3_profile == "alert"
    finally:
        db.close()

