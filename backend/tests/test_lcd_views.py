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
    manager.driver.cols = 20
    
    db_mock = MagicMock()
    manager.db_session_factory.return_value = db_mock
    
    svc1 = MediaProcess(id=1, name="Svc1", status="running", service_type="ffmpeg_stream")
    svc2 = MediaProcess(id=2, name="Svc2", status="stopped", service_type="mediamtx_hub")
    
    db_mock.query.return_value.filter.return_value.all.return_value = [svc1, svc2]
    db_mock.query.return_value.order_by.return_value.all.return_value = [svc1, svc2]
    db_mock.query.return_value.all.return_value = [svc1, svc2]
    
    menu = ServicesMenuView(manager)
    # Selected index 0
    menu.selected_index = 0
    lines = menu.render()
    assert lines[0] == "-- SERVICES MENU -"
    assert "> * (FFM) Svc1" in lines[1]
    
    # Selected index 1
    menu.selected_index = 1
    lines = menu.render()
    assert lines[0] == "-- SERVICES MENU -"
    assert ">   (MTX) Svc2" in lines[1]


def test_main_menu_restart_panel_and_confirm():
    from unittest.mock import MagicMock
    from core.lcd.views.menu import MainMenuView
    from core.lcd.views.submenu import RestartConfirmView
    
    manager = MagicMock()
    manager.driver.rows = 4
    manager.driver.cols = 20
    
    menu = MainMenuView(manager)
    assert "4. Restart Panel" in menu.options[3]
    
    # Navigate to Restart Panel (index 3) and press TICK
    menu.selected_index = 3
    menu.handle_key("TICK")
    
    # Check that manager switched to RestartConfirmView
    assert len(manager.switch_to_view.call_args_list) > 0
    new_view = manager.switch_to_view.call_args[0][0]
    assert isinstance(new_view, RestartConfirmView)
    
    # Render RestartConfirmView
    confirm_lines = new_view.render()
    assert "-- RESTART PANEL? --" in confirm_lines[0]
    assert "> Cancel" in confirm_lines[1]
    
    # Select Yes (Reload) and TICK
    new_view.handle_key("DOWN")
    assert new_view.selected_index == 1
    new_view.handle_key("TICK")
    
    # Verify manager.restart_panel was called
    manager.restart_panel.assert_called_once()
    restarting_lines = new_view.render()
    assert "RESTARTING PANEL..." in restarting_lines[0]


def test_mediamtx_service_status_detail_view():
    from unittest.mock import MagicMock
    from database.models import MediaProcess
    from core.lcd.views.submenu import ServiceStatusDetailView
    
    manager = MagicMock()
    db_mock = MagicMock()
    manager.db_session_factory.return_value = db_mock
    
    mtx_svc = MediaProcess(
        id=2,
        name="MediaMTX Main Hub",
        alias="HubMain",
        status="running",
        cpu_usage=5,
        pid=9876,
        service_type="mediamtx_hub",
        mediamtx_config={"paths": {"live": {}, "cam1": {}}, "srt_port": 8890}
    )
    db_mock.query.return_value.get.return_value = mtx_svc
    
    status_view = ServiceStatusDetailView(manager, 2)
    lines = status_view.render()
    assert "(MTX) HubMain" in lines[0]
    assert "Status:running" in lines[1]
    assert "PID:9876" in lines[2]
    assert "PATHS:2 SRT:8890" in lines[3]


def test_net_info_view():
    from unittest.mock import MagicMock, patch
    from core.lcd.views.info import NetInfoView, SystemInfoView
    from core.lcd.views.menu import MainMenuView
    from database.models import SystemSettings

    manager = MagicMock()
    manager.driver.rows = 4
    manager.driver.cols = 20

    db_mock = MagicMock()
    manager.db_session_factory.return_value = db_mock

    settings = SystemSettings(node_name="BroadcastRack01", lcd_alias="STUDIO-A")
    db_mock.query.return_value.first.return_value = settings

    with patch("core.lcd.views.info.get_primary_ip", return_value="192.168.100.150"), \
         patch("core.lcd.views.info.get_network_settings", return_value={"http_port": 8000, "https_port": 8443, "ssl_enabled": True}):

        # 4-row layout test with SSL enabled
        view = NetInfoView(manager)
        lines = view.render()
        assert lines[0] == "ADDRESS:"
        assert lines[1] == "192.168.100.150"
        assert lines[2] == "HTTP:    HTTPS:"
        assert lines[3] == "8000     8443"

        # 4-row layout test with SSL disabled
        with patch("core.lcd.views.info.get_network_settings", return_value={"http_port": 8080, "https_port": 8443, "ssl_enabled": False}):
            lines_nossl = view.render()
            assert lines_nossl[0] == "ADDRESS:"
            assert lines_nossl[1] == "192.168.100.150"
            assert lines_nossl[2] == "HTTP:    HTTPS:"
            assert lines_nossl[3] == "8080     -----"

        # 2-row layout test and page cycling
        manager.driver.rows = 2
        manager.driver.cols = 16
        view.current_page = 0
        lines_p0 = view.render()
        assert lines_p0[0] == "192.168.100.150"
        assert "H:8000" in lines_p0[1]
        assert "S:8443" in lines_p0[1]

        # Cycle to Page 1
        view.handle_key("DOWN")
        assert view.current_page == 1
        lines_p1 = view.render()
        assert "STUDIO-A" in lines_p1[0]
        assert "Press X: Return" in lines_p1[1]

        # Key X returns to MainMenuView with index 4 ("5. Net Info")
        view.handle_key("X")
        assert manager.switch_to_view.called
        returned_menu = manager.switch_to_view.call_args[0][0]
        assert isinstance(returned_menu, MainMenuView)
        assert returned_menu.selected_index == 4

        # Verify backward compatibility alias SystemInfoView == NetInfoView
        compat_view = SystemInfoView(manager)
        assert isinstance(compat_view, NetInfoView)


def test_version_info_view():
    from unittest.mock import MagicMock, patch
    from core.lcd.views.info import VersionInfoView
    from core.lcd.views.menu import MainMenuView

    manager = MagicMock()
    manager.driver.rows = 4
    manager.driver.cols = 20

    with patch("core.lcd.views.info.get_versions", return_value={"backend": "2.50.0", "frontend": "2.50.0", "schema": "2.5.0"}):
        v_view = VersionInfoView(manager)
        lines = v_view.render()
        assert lines[0] == "SYSTEM VERSIONS"
        assert lines[1] == "BE: v2.50.0"
        assert lines[2] == "FE: v2.50.0"
        assert lines[3] == "SC: v2.5.0"

        # 2-row layout test (20 cols)
        manager.driver.rows = 2
        manager.driver.cols = 20
        v_view.current_page = 0
        lines_2row = v_view.render()
        assert lines_2row[0] == "FE: v2.50.0"
        assert lines_2row[1] == "BE/SC: 2.50.0/2.5.0"

        # Key X returns to MainMenuView with index 5 ("6. Versions")
        v_view.handle_key("X")
        assert manager.switch_to_view.called
        returned_menu = manager.switch_to_view.call_args[0][0]
        assert isinstance(returned_menu, MainMenuView)
        assert returned_menu.selected_index == 5


def test_main_menu_net_and_version_navigation():
    from unittest.mock import MagicMock
    from core.lcd.views.menu import MainMenuView
    from core.lcd.views.info import NetInfoView, VersionInfoView

    manager = MagicMock()
    manager.driver.rows = 4
    manager.driver.cols = 20

    menu = MainMenuView(manager)
    assert menu.options[4] == "5. Net Info"
    assert menu.options[5] == "6. Versions"

    # Select Net Info (index 4) and TICK
    menu.selected_index = 4
    menu.handle_key("TICK")
    assert isinstance(manager.switch_to_view.call_args[0][0], NetInfoView)

    # Select Versions (index 5) and TICK
    menu.selected_index = 5
    menu.handle_key("TICK")
    assert isinstance(manager.switch_to_view.call_args[0][0], VersionInfoView)


def test_cfa635_bracket_sanitization():
    from unittest.mock import MagicMock
    from core.lcd.drivers.cfa635 import Cfa635Driver

    driver = Cfa635Driver(port="/dev/ttyUSB0", cols=20, rows=4)
    driver.ser = MagicMock()
    driver.ser.is_open = True

    # Send text containing square brackets
    driver.write_line(0, "> [FFM] Stream [1]")

    # Inspect bytes written to serial port
    # write_line sends command 31 (0x1f), length 22 (row=1, col=1, 20 chars text), plus 2 bytes CRC = 26 bytes
    assert driver.ser.write.called
    written_packet = driver.ser.write.call_args[0][0]
    command = written_packet[0]
    assert command == 31  # command 31 is send data to LCD
    text_bytes = written_packet[4:24]  # payload bytes after command, len, col, row
    text_str = text_bytes.decode('ascii')
    assert "> (FFM) Stream (1)" in text_str
    assert "[" not in text_str
    assert "]" not in text_str

