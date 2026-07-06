import os
import sys
import unittest
import re
from unittest.mock import MagicMock

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from database.db import SessionLocal, init_db
from database.models import MediaProcess, TaskExecution
from core.process_manager import ProcessManager
from core.task_manager import TaskManager

class TestTelemetryParser(unittest.TestCase):
    def setUp(self):
        init_db()
        self.db = SessionLocal()
        
        # Create test MediaProcess
        self.proc = MediaProcess(
            name="Test DeckLink",
            type="service",
            status="running",
            cpu_usage=0,
            ram_usage=0,
            fps="0",
            bitrate="0 kb/s",
            speed="0x",
            input_config={},
            output_config={"type": "decklink", "device": "DeckLink Mini Monitor"},
            codec_config={},
            filter_config={}
        )
        self.db.add(self.proc)
        
        # Create test TaskExecution
        self.exec = TaskExecution(
            task_id=1,
            status="running",
            cpu_usage=0,
            ram_usage=0,
            fps="0",
            bitrate="0 kb/s",
            speed="0x"
        )
        self.db.add(self.exec)
        
        self.db.commit()
        
        # Initialize managers
        self.process_manager = ProcessManager(db_session_factory=lambda: SessionLocal())
        self.task_manager = TaskManager(db_session_factory=lambda: SessionLocal())

    def tearDown(self):
        self.db.delete(self.proc)
        self.db.delete(self.exec)
        self.db.commit()
        self.db.close()

    def test_process_manager_handles_decklink_telemetry(self):
        # Log line from a DeckLink output with bitrate=N/A
        log_line = "frame=  123 fps= 25.4 q=-0.0 size=N/A time=00:00:04.92 bitrate=N/A speed=1.00x"
        
        status_re = re.compile(r"fps=\s*([\d.]+).*bitrate=\s*([\d.]+kbits/s|N/A).*speed=\s*([\d.]+x)")
        self.process_manager._handle_log_msg(self.proc.id, log_line, status_re)
        
        # Refresh from database
        self.db.refresh(self.proc)
        self.assertEqual(self.proc.fps, "25.4")
        self.assertEqual(self.proc.bitrate, "N/A")
        self.assertEqual(self.proc.speed, "1.00x")

    def test_task_manager_handles_decklink_telemetry(self):
        # Log line from NDI or DeckLink task with bitrate=N/A
        log_line = "frame=  456 fps= 50 q=-0.0 size=N/A time=00:00:10.00 bitrate=N/A speed=2.1x"
        
        status_re = re.compile(r"fps=\s*([\d.]+).*bitrate=\s*([\d.]+kbits/s|N/A).*speed=\s*([\d.]+x)")
        self.task_manager._handle_log_line(self.exec.id, log_line, status_re)
        
        # Refresh from database
        self.db.refresh(self.exec)
        self.assertEqual(self.exec.fps, "50")
        self.assertEqual(self.exec.bitrate, "N/A")
        self.assertEqual(self.exec.speed, "2.1x")
