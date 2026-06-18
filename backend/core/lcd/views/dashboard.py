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
        node_name = "FFMPEG-GUI"
        active_count = 0
        try:
            from database.models import MediaProcess, SystemSettings
            active_count = db.query(MediaProcess).filter(MediaProcess.status == 'running').count()
            settings = db.query(SystemSettings).first()
            if settings and isinstance(getattr(settings, "node_name", None), str):
                node_name = settings.node_name
        except Exception:
            pass
        finally:
            db.close()

        # Center/pad the node name to 16 characters
        header = node_name[:16].center(16)

        return [
            header,
            f"Streams: {active_count}",
            f"CPU: {cpu}%",
            f"RAM: {ram}%"
        ]

    def handle_key(self, key: str) -> None:
        if key == "TICK":
            from .menu import MainMenuView
            self.manager.switch_to_view(MainMenuView(self.manager))
