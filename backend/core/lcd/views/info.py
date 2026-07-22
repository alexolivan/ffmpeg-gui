import socket
from typing import List
from .base import LCDView


def get_primary_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


class SystemInfoView(LCDView):
    def __init__(self, manager):
        super().__init__(manager)
        self.current_page = 0
        self.total_pages = 3

    def render(self) -> List[str]:
        ip_addr = get_primary_ip()
        gui_port = "8000"
        be_ver = "v1.29"
        fe_ver = "v1.26"

        node_name = "Node"
        if self.manager and getattr(self.manager, "db_session_factory", None):
            db = self.manager.db_session_factory()
            try:
                from database.models import SystemSettings
                settings = db.query(SystemSettings).first()
                if settings and isinstance(getattr(settings, "lcd_alias", None), str):
                    node_name = settings.lcd_alias
                elif settings and isinstance(getattr(settings, "node_name", None), str):
                    node_name = settings.node_name
            except Exception:
                pass
            finally:
                db.close()

        rows = self.manager.driver.rows if (self.manager and getattr(self.manager, "driver", None)) else 4

        if rows == 2:
            if self.current_page == 0:
                return [f"IP:{ip_addr[:13]}", f"PORT:{gui_port}"]
            elif self.current_page == 1:
                return [f"BE:{be_ver} FE:{fe_ver}", "Press X: Return"]
            else:
                return [f"NODE:{node_name[:11]}", "Press X: Return"]
        else:
            return [
                f"IP:{ip_addr[:13]}",
                f"PORT:{gui_port}",
                f"BE:{be_ver} FE:{fe_ver}",
                f"NODE:{node_name[:11]}"
            ]

    def handle_key(self, key: str) -> None:
        rows = self.manager.driver.rows if (self.manager and getattr(self.manager, "driver", None)) else 4
        if key == "X":
            from .menu import MainMenuView
            main_menu = MainMenuView(self.manager)
            main_menu.selected_index = 3
            self.manager.switch_to_view(main_menu)
        elif key == "DOWN":
            if rows == 2:
                self.current_page = (self.current_page + 1) % self.total_pages
        elif key == "UP":
            if rows == 2:
                self.current_page = (self.current_page - 1) % self.total_pages
