import pytest
from core.lcd.views.base import LCDView

def test_lcd_view_base_attributes():
    class DummyView(LCDView):
        def render(self):
            return ["Line 1", "Line 2", "Line 3", "Line 4"]
        def handle_key(self, key):
            pass
    view = DummyView(manager=None)
    assert view.requires_periodic_refresh is False
    assert view.render()[0] == "Line 1"
