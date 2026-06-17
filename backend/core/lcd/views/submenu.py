import asyncio
from typing import List
from .base import LCDView

class ServiceDetailMenuView(LCDView):
    def __init__(self, manager, svc_id: int):
        super().__init__(manager)
        self.svc_id = svc_id
        self.selected_index = 0
        self.svc_name = "Service"
        self.svc_status = "unknown"
        self.fetch_service()

    def fetch_service(self):
        db = self.manager.db_session_factory()
        try:
            from database.models import MediaProcess
            svc = db.query(MediaProcess).get(self.svc_id)
            if svc:
                self.svc_name = svc.alias if svc.alias and svc.alias.strip() else svc.name
                self.svc_status = svc.status
        except Exception:
            pass
        finally:
            db.close()

    def render(self) -> List[str]:
        self.fetch_service()
        # Header + 3 options
        action_text = "Stop" if self.svc_status == "running" else "Start"
        options = [f"{action_text}", "Restart", "Status Info"]
        
        lines = [f"SVC:{self.svc_name[:14]}"]
        for idx, opt in enumerate(options):
            prefix = "> " if idx == self.selected_index else "  "
            lines.append(f"{prefix}{opt}")
        return lines

    def handle_key(self, key: str) -> None:
        if key == "X":
            from .menu import ServicesMenuView
            self.manager.switch_to_view(ServicesMenuView(self.manager))
            return

        if key == "UP":
            self.selected_index = (self.selected_index - 1) % 3
        elif key == "DOWN":
            self.selected_index = (self.selected_index + 1) % 3
        elif key == "TICK":
            if self.selected_index == 0:
                # Toggle
                if self.svc_status == "running":
                    asyncio.create_task(self.manager.process_manager.stop_process(self.svc_id))
                else:
                    asyncio.create_task(self.manager.process_manager.start_process(self.svc_id))
                
                async def refresh():
                    await asyncio.sleep(0.5)
                    self.fetch_service()
                    self.manager.refresh_display()
                asyncio.create_task(refresh())
            elif self.selected_index == 1:
                # Restart
                async def do_restart():
                    await self.manager.process_manager.stop_process(self.svc_id)
                    await self.manager.process_manager.start_process(self.svc_id)
                    self.fetch_service()
                    self.manager.refresh_display()
                asyncio.create_task(do_restart())
            elif self.selected_index == 2:
                self.manager.switch_to_view(ServiceStatusDetailView(self.manager, self.svc_id))


class ServiceStatusDetailView(LCDView):
    def __init__(self, manager, svc_id: int):
        super().__init__(manager)
        self.svc_id = svc_id

    @property
    def requires_periodic_refresh(self) -> bool:
        return True

    def render(self) -> List[str]:
        db = self.manager.db_session_factory()
        lines = ["SVC Status"]
        try:
            from database.models import MediaProcess
            svc = db.query(MediaProcess).get(self.svc_id)
            if svc:
                display_name = svc.alias if svc.alias and svc.alias.strip() else svc.name
                lines = [
                    f"SVC:{display_name[:14]}",
                    f"Status:{svc.status}",
                    f"PID:{svc.pid or 'N/A'} CPU:{int(svc.cpu_usage or 0)}%",
                    f"FPS:{svc.fps or '0'} SPD:{svc.speed or '0x'}"
                ]
        except Exception:
            lines = ["Error reading svc", "", "", ""]
        finally:
            db.close()
        return lines

    def handle_key(self, key: str) -> None:
        if key in ("X", "TICK"):
            self.manager.switch_to_view(ServiceDetailMenuView(self.manager, self.svc_id))


class TaskDetailMenuView(LCDView):
    def __init__(self, manager, task_id: int):
        super().__init__(manager)
        self.task_id = task_id
        self.selected_index = 0
        self.task_name = "Task"
        self.fetch_task()

    def fetch_task(self):
        db = self.manager.db_session_factory()
        try:
            from database.models import ScheduledTask
            task = db.query(ScheduledTask).get(self.task_id)
            if task:
                self.task_name = task.alias if task.alias and task.alias.strip() else task.name
        except Exception:
            pass
        finally:
            db.close()

    def render(self) -> List[str]:
        self.fetch_task()
        options = ["Run Now", "Status Info"]
        lines = [f"TSK:{self.task_name[:14]}"]
        for idx, opt in enumerate(options):
            prefix = "> " if idx == self.selected_index else "  "
            lines.append(f"{prefix}{opt}")
        lines.append("") # 4th line empty
        return lines

    def handle_key(self, key: str) -> None:
        if key == "X":
            from .menu import TasksMenuView
            self.manager.switch_to_view(TasksMenuView(self.manager))
            return

        if key == "UP":
            self.selected_index = (self.selected_index - 1) % 2
        elif key == "DOWN":
            self.selected_index = (self.selected_index + 1) % 2
        elif key == "TICK":
            if self.selected_index == 0:
                # Run Now
                db = self.manager.db_session_factory()
                try:
                    from database.models import TaskExecution
                    exec_obj = TaskExecution(task_id=self.task_id, status="pending")
                    db.add(exec_obj)
                    db.commit()
                    asyncio.create_task(self.manager.task_manager.start_execution(exec_obj.id))
                except Exception:
                    pass
                finally:
                    db.close()
                self.manager.switch_to_view(TaskStatusDetailView(self.manager, self.task_id))
            elif self.selected_index == 1:
                self.manager.switch_to_view(TaskStatusDetailView(self.manager, self.task_id))


class TaskStatusDetailView(LCDView):
    def __init__(self, manager, task_id: int):
        super().__init__(manager)
        self.task_id = task_id

    @property
    def requires_periodic_refresh(self) -> bool:
        return True

    def render(self) -> List[str]:
        db = self.manager.db_session_factory()
        lines = ["Task Status"]
        try:
            from database.models import ScheduledTask, TaskExecution
            task = db.query(ScheduledTask).get(self.task_id)
            if task:
                display_name = task.alias if task.alias and task.alias.strip() else task.name
                # Get latest execution
                latest_exec = db.query(TaskExecution).filter(TaskExecution.task_id == self.task_id).order_by(TaskExecution.id.desc()).first()
                status_str = latest_exec.status if latest_exec else "Idle"
                pid_str = str(latest_exec.pid) if (latest_exec and latest_exec.pid) else "N/A"
                lines = [
                    f"TSK:{display_name[:14]}",
                    f"Status:{status_str}",
                    f"PID:{pid_str}",
                    "Press X to return"
                ]
        except Exception:
            lines = ["Error reading task", "", "", ""]
        finally:
            db.close()
        return lines

    def handle_key(self, key: str) -> None:
        if key in ("X", "TICK"):
            self.manager.switch_to_view(TaskDetailMenuView(self.manager, self.task_id))
