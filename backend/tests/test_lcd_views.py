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


def test_lcd_views_with_alias_and_node_name():
    from unittest.mock import MagicMock
    from database.models import MediaProcess, ScheduledTask, SystemSettings
    from core.lcd.views.dashboard import DashboardView
    from core.lcd.views.menu import ServicesMenuView, TasksMenuView
    from core.lcd.views.submenu import (
        ServiceDetailMenuView, ServiceStatusDetailView,
        TaskDetailMenuView, TaskStatusDetailView
    )

    manager = MagicMock()
    db_mock = MagicMock()
    manager.db_session_factory.return_value = db_mock

    # Mock system settings, media process, and scheduled task with aliases
    settings = SystemSettings(node_name="Custom Node 1")
    svc = MediaProcess(id=1, name="Long Service Name", alias="ShortSvc", type="service", status="running")
    task = ScheduledTask(id=1, name="Long Task Name", alias="ShortTask")

    def mock_query(model):
        q = MagicMock()
        if model == SystemSettings:
            q.first.return_value = settings
        elif model == MediaProcess:
            q.filter.return_value.all.return_value = [svc]
            q.get.return_value = svc
        elif model == ScheduledTask:
            q.all.return_value = [task]
            q.get.return_value = task
        return q
    db_mock.query.side_effect = mock_query

    # 1. Test DashboardView node name display
    dash = DashboardView(manager)
    dash_lines = dash.render()
    assert "Custom Node 1" in dash_lines[0]

    # 2. Test ServicesMenuView uses alias
    svc_menu = ServicesMenuView(manager)
    svc_menu_lines = svc_menu.render()
    assert "ShortSvc" in svc_menu_lines[1]

    # 3. Test TasksMenuView uses alias
    task_menu = TasksMenuView(manager)
    task_menu_lines = task_menu.render()
    assert "ShortTask" in task_menu_lines[1]

    # 4. Test Detail & Status submenus use alias
    svc_detail = ServiceDetailMenuView(manager, 1)
    assert "ShortSvc" in svc_detail.render()[0]

    svc_status = ServiceStatusDetailView(manager, 1)
    assert "ShortSvc" in svc_status.render()[0]

    task_detail = TaskDetailMenuView(manager, 1)
    assert "ShortTask" in task_detail.render()[0]

    task_status = TaskStatusDetailView(manager, 1)
    assert "ShortTask" in task_status.render()[0]


def test_2_row_scrolling():
    from unittest.mock import MagicMock
    from database.models import MediaProcess
    from core.lcd.views.menu import ServicesMenuView
    
    manager = MagicMock()
    manager.driver.rows = 2
    
    db_mock = MagicMock()
    manager.db_session_factory.return_value = db_mock
    
    svc1 = MediaProcess(id=1, name="Svc1", status="running")
    svc2 = MediaProcess(id=2, name="Svc2", status="stopped")
    
    db_mock.query.return_value.filter.return_value.all.return_value = [svc1, svc2]
    
    menu = ServicesMenuView(manager)
    # Selected index 0
    menu.selected_index = 0
    lines = menu.render()
    assert lines[0] == "-- SERVICES MENU -"
    assert "> * Svc1" in lines[1]
    
    # Selected index 1
    menu.selected_index = 1
    lines = menu.render()
    assert lines[0] == "-- SERVICES MENU -"
    assert ">   Svc2" in lines[1]


def test_system_info_view():
    from unittest.mock import MagicMock
    from core.lcd.views.info import SystemInfoView
    from database.models import SystemSettings

    manager = MagicMock()
    manager.driver.rows = 4

    db_mock = MagicMock()
    manager.db_session_factory.return_value = db_mock

    settings = SystemSettings(node_name="TestNode")
    db_mock.query.return_value.first.return_value = settings

    info_view = SystemInfoView(manager)
    lines = info_view.render()
    assert "IP:" in lines[0]
    assert "PORT:8000" in lines[1]
    assert "BE:v1.29 FE:v1.26" in lines[2]
    assert "NODE:TestNode" in lines[3]

    # Test 2-row screen page cycling
    manager.driver.rows = 2
    info_view.current_page = 0
    lines_p0 = info_view.render()
    assert "IP:" in lines_p0[0]
    assert "PORT:8000" in lines_p0[1]

    info_view.handle_key("DOWN")
    assert info_view.current_page == 1
    lines_p1 = info_view.render()
    assert "BE:v1.29 FE:v1.26" in lines_p1[0]
