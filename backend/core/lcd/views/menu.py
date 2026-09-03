from typing import List
from .base import LCDView

class MainMenuView(LCDView):
    def __init__(self, manager):
        super().__init__(manager)
        self.options = ["1. Dashboard", "2. Services", "3. Tasks", "4. Restart Panel", "5. System Info"]
        self.selected_index = 0

    def render(self) -> List[str]:
        lines = ["--- MAIN MENU ---"]
        rows = self.manager.driver.rows if self.manager and self.manager.driver else 4
        if rows == 2:
            lines.append(f"> {self.options[self.selected_index]}")
        else:
            start = max(0, min(self.selected_index, len(self.options) - 3))
            end = start + 3
            for idx in range(start, end):
                prefix = "> " if idx == self.selected_index else "  "
                lines.append(f"{prefix}{self.options[idx]}")
        return lines

    def handle_key(self, key: str) -> None:
        if key == "UP":
            self.selected_index = (self.selected_index - 1) % len(self.options)
        elif key == "DOWN":
            self.selected_index = (self.selected_index + 1) % len(self.options)
        elif key == "X":
            from .dashboard import DashboardView
            self.manager.switch_to_view(DashboardView(self.manager))
        elif key == "TICK":
            if self.selected_index == 0:
                from .dashboard import DashboardView
                self.manager.switch_to_view(DashboardView(self.manager))
            elif self.selected_index == 1:
                self.manager.switch_to_view(ServicesMenuView(self.manager))
            elif self.selected_index == 2:
                self.manager.switch_to_view(TasksMenuView(self.manager))
            elif self.selected_index == 3:
                from .submenu import RestartConfirmView
                self.manager.switch_to_view(RestartConfirmView(self.manager))
            elif self.selected_index == 4:
                from .info import SystemInfoView
                self.manager.switch_to_view(SystemInfoView(self.manager))

class ServicesMenuView(LCDView):
    def __init__(self, manager):
        super().__init__(manager)
        self.services = []
        self.selected_index = 0
        self.fetch_services()

    def fetch_services(self):
        db = self.manager.db_session_factory()
        try:
            from database.models import Service
            q = db.query(Service)
            res = None
            if hasattr(q, "order_by"):
                try:
                    res = q.order_by(Service.startup_order.asc(), Service.id.asc()).all()
                except Exception:
                    res = None
            if not isinstance(res, list) and hasattr(q, "all"):
                try:
                    res = q.all()
                except Exception:
                    res = None
            if not isinstance(res, list) and hasattr(q, "filter"):
                try:
                    res = q.filter().all()
                except Exception:
                    res = None
            self.services = res if isinstance(res, list) else []
        except Exception:
            self.services = []
        finally:
            db.close()

    def render(self) -> List[str]:
        lines = ["-- SERVICES MENU -"]
        if not self.services:
            lines.append("  No services")
            lines.append("")
            lines.append("Press X to return")
            return lines

        rows = 4
        cols = 20
        if self.manager and getattr(self.manager, "driver", None):
            r_val = getattr(self.manager.driver, "rows", 4)
            if isinstance(r_val, int):
                rows = r_val
            c_val = getattr(self.manager.driver, "cols", 20)
            if isinstance(c_val, int):
                cols = c_val
        window_size = 1 if rows == 2 else 3
        if window_size == 1:
            start = self.selected_index
            end = start + 1
        else:
            start = max(0, self.selected_index - 1)
            end = min(len(self.services), start + 3)

        tag_map = {
            "ffmpeg_stream": "[FFM]" if cols >= 20 else "[FF]",
            "mediamtx_hub": "[MTX]" if cols >= 20 else "[MX]",
            "icecast_server": "[ICE]" if cols >= 20 else "[IC]",
        }

        for i in range(start, end):
            svc = self.services[i]
            prefix = "> " if i == self.selected_index else "  "
            status_char = "*" if svc.status == "running" else " "
            tag = tag_map.get(svc.service_type, "[SVC]" if cols >= 20 else "[S]")
            display_name = svc.alias if svc.alias and svc.alias.strip() else svc.name
            # Available name space: cols - prefix(2) - status(1) - space(1) - tag(len) - space(1)
            avail = max(4, cols - (2 + 1 + 1 + len(tag) + 1))
            lines.append(f"{prefix}{status_char} {tag} {display_name[:avail]}")
        
        while len(lines) < 4:
            lines.append("")
        return lines

    def handle_key(self, key: str) -> None:
        if key == "X":
            self.manager.switch_to_view(MainMenuView(self.manager))
            return

        if not self.services:
            return

        if key == "UP":
            self.selected_index = (self.selected_index - 1) % len(self.services)
        elif key == "DOWN":
            self.selected_index = (self.selected_index + 1) % len(self.services)
        elif key == "TICK":
            svc = self.services[self.selected_index]
            from .submenu import ServiceDetailMenuView
            self.manager.switch_to_view(ServiceDetailMenuView(self.manager, svc.id))

class TasksMenuView(LCDView):
    def __init__(self, manager):
        super().__init__(manager)
        self.tasks = []
        self.selected_index = 0
        self.fetch_tasks()

    def fetch_tasks(self):
        db = self.manager.db_session_factory()
        try:
            from database.models import ScheduledTask
            self.tasks = db.query(ScheduledTask).all()
        except Exception:
            self.tasks = []
        finally:
            db.close()

    def render(self) -> List[str]:
        lines = ["--- TASKS MENU ---"]
        if not self.tasks:
            lines.append("  No tasks")
            lines.append("")
            lines.append("Press X to return")
            return lines

        rows = self.manager.driver.rows if self.manager and self.manager.driver else 4
        window_size = 1 if rows == 2 else 3
        if window_size == 1:
            start = self.selected_index
            end = start + 1
        else:
            start = max(0, self.selected_index - 1)
            end = min(len(self.tasks), start + 3)

        for i in range(start, end):
            task = self.tasks[i]
            prefix = "> " if i == self.selected_index else "  "
            display_name = task.alias if task.alias and task.alias.strip() else task.name
            lines.append(f"{prefix}{display_name[:14]}")

        while len(lines) < 4:
            lines.append("")
        return lines

    def handle_key(self, key: str) -> None:
        if key == "X":
            self.manager.switch_to_view(MainMenuView(self.manager))
            return

        if not self.tasks:
            return

        if key == "UP":
            self.selected_index = (self.selected_index - 1) % len(self.tasks)
        elif key == "DOWN":
            self.selected_index = (self.selected_index + 1) % len(self.tasks)
        elif key == "TICK":
            task = self.tasks[self.selected_index]
            from .submenu import TaskDetailMenuView
            self.manager.switch_to_view(TaskDetailMenuView(self.manager, task.id))
