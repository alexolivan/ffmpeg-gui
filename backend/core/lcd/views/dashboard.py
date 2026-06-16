import psutil
from typing import List
from .base import LCDView

class DashboardView(LCDView):
    @property
    def requires_periodic_refresh(self) -> bool:
        return True

    def render(self) -> List[str]:
        cpu = int(psutil.cpu_percent())
        ram = int(psutil.virtual_memory().percent)
        db = self.manager.db_session_factory()
        try:
            from database.models import MediaProcess
            active_count = db.query(MediaProcess).filter(MediaProcess.status == 'running').count()
        except Exception:
            active_count = 0
        finally:
            db.close()

        return [
            "=== STATUS GUI ===",
            f"CPU: {cpu}%",
            f"RAM: {ram}%",
            f"Active: {active_count} streams"
        ]

    def handle_key(self, key: str) -> None:
        if key == "TICK":
            from .menu import MainMenuView
            self.manager.switch_to_view(MainMenuView(self.manager))
