from typing import List
from .base import LCDView

class MainMenuView(LCDView):
    def __init__(self, manager):
        super().__init__(manager)
        self.options = ["1. Dashboard", "2. Services", "3. Tasks"]
        self.selected_index = 0

    def render(self) -> List[str]:
        lines = ["--- MAIN MENU ---"]
        rows = self.manager.driver.rows if self.manager and self.manager.driver else 4
        if rows == 2:
            lines.append(f"> {self.options[self.selected_index]}")
        else:
            for idx in range(3):
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

class ServicesMenuView(LCDView):
    def __init__(self, manager):
        super().__init__(manager)
        self.services = []
        self.selected_index = 0
        self.fetch_services()

    def fetch_services(self):
        db = self.manager.db_session_factory()
        try:
            from database.models import MediaProcess
            self.services = db.query(MediaProcess).filter(MediaProcess.type == 'service').all()
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

        rows = self.manager.driver.rows if self.manager and self.manager.driver else 4
        window_size = 1 if rows == 2 else 3
        if window_size == 1:
            start = self.selected_index
            end = start + 1
        else:
            start = max(0, self.selected_index - 1)
            end = min(len(self.services), start + 3)

        for i in range(start, end):
            svc = self.services[i]
            prefix = "> " if i == self.selected_index else "  "
            status_char = "*" if svc.status == "running" else " "
            display_name = svc.alias if svc.alias and svc.alias.strip() else svc.name
            lines.append(f"{prefix}{status_char} {display_name[:12]}")
        
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
