from typing import List
from .base import LCDView

class MainMenuView(LCDView):
    def __init__(self, manager):
        super().__init__(manager)
        self.options = ["1. Dashboard", "2. Services", "3. Tasks"]
        self.selected_index = 0

    def render(self) -> List[str]:
        lines = ["--- MAIN MENU ---"]
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

        # Render 3 services window
        start = max(0, self.selected_index - 1)
        end = min(len(self.services), start + 3)
        for i in range(start, end):
            svc = self.services[i]
            prefix = "> " if i == self.selected_index else "  "
            status_char = "*" if svc.status == "running" else " "
            lines.append(f"{prefix}({status_char}) {svc.name[:12]}")
        
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

        start = max(0, self.selected_index - 1)
        end = min(len(self.tasks), start + 3)
        for i in range(start, end):
            task = self.tasks[i]
            prefix = "> " if i == self.selected_index else "  "
            lines.append(f"{prefix}{task.name[:16]}")

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
