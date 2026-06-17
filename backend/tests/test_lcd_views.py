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

def test_clean_ascii():
    from core.lcd.views.base import clean_ascii
    assert clean_ascii("Café") == "Cafe"
    assert clean_ascii("Ståle") == "Stale"
    assert clean_ascii("NÍÑO") == "NINO"

def test_submenu_views():
    from unittest.mock import MagicMock
    from core.lcd.views.submenu import ServiceDetailMenuView, ServiceStatusDetailView, TaskDetailMenuView, TaskStatusDetailView
    
    manager = MagicMock()
    # Mock database session return value
    db_mock = MagicMock()
    manager.db_session_factory.return_value = db_mock
    
    # Mock MediaProcess
    from database.models import MediaProcess, ScheduledTask
    svc = MediaProcess(id=1, name="Test Service", status="running", cpu_usage=12, ram_usage=34, pid=1234, fps="30", speed="1.0x")
    task = ScheduledTask(id=1, name="Test Task")
    
    def mock_query(model):
        q = MagicMock()
        if model == MediaProcess:
            q.get.return_value = svc
        elif model == ScheduledTask:
            q.get.return_value = task
        return q
    db_mock.query.side_effect = mock_query

    # Test Service Detail Menu
    svc_detail = ServiceDetailMenuView(manager, 1)
    lines = svc_detail.render()
    assert "SVC:Test Service" in lines[0]
    assert "> Stop" in lines[1]
    
    # Test Service Status View
    svc_status = ServiceStatusDetailView(manager, 1)
    lines = svc_status.render()
    assert "Status:running" in lines[1]
    assert "PID:1234" in lines[2]
    
    # Test Task Detail Menu
    task_detail = TaskDetailMenuView(manager, 1)
    lines = task_detail.render()
    assert "TSK:Test Task" in lines[0]
    assert "> Run Now" in lines[1]

