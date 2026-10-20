"""
Unit tests for Real-time Log-Flooding Circuit Breaker in ProcessManager._file_log_tailer.
"""

import asyncio
import os
import tempfile
import unittest
from unittest.mock import MagicMock

from backend.core.process_manager import ProcessManager


class TestLogFloodShield(unittest.IsolatedAsyncioTestCase):
    """Verifies that _file_log_tailer truncates flooded log files in-place to protect storage."""

    async def test_file_log_tailer_truncates_on_flood(self):
        """When log file exceeds max_log_bytes, tailer truncates it to 0 and logs system alert."""
        pm = ProcessManager(db_session_factory=MagicMock())
        process_id = 888

        with tempfile.NamedTemporaryFile("w+", delete=False, encoding="utf-8") as tmp:
            log_path = tmp.name

        try:
            # Seed initial lines
            with open(log_path, "a", encoding="utf-8") as f:
                f.write("Line 1: Server starting\n")
                f.flush()

            mock_proc = MagicMock()
            mock_proc.returncode = None
            mock_proc.pid = 99999
            pm.processes[process_id] = mock_proc
            pm.log_buffers[process_id] = []

            # Launch tailer task with 2048 byte limit
            tailer_task = asyncio.create_task(
                pm._file_log_tailer(
                    process_id,
                    log_path,
                    proc=mock_proc,
                    max_log_bytes=2048
                )
            )

            # Wait for tailer to open and seek
            await asyncio.sleep(0.3)

            # Flood file with 30 lines of 100 chars (> 3000 bytes > 2048 bytes limit)
            with open(log_path, "a", encoding="utf-8") as f:
                for i in range(30):
                    f.write(f"FLOOD WARNING {i:03d} " + "X" * 80 + "\n")
                f.flush()

            # Give tailer time to process lines and hit the 20-line check
            await asyncio.sleep(0.8)

            # Stop the tailer
            mock_proc.returncode = 0
            await asyncio.wait_for(tailer_task, timeout=2.0)

            # Verification:
            # 1. System warning recorded
            system_warnings = [
                entry["message"] for entry in pm.log_buffers[process_id]
                if "[SYSTEM]" in entry["message"] and "truncated in-place" in entry["message"]
            ]
            self.assertTrue(len(system_warnings) > 0, "Expected [SYSTEM] log truncation warning in pm.log_buffers")

            # 2. Log file on disk was truncated and is now smaller than the flood size
            final_size = os.path.getsize(log_path)
            self.assertLess(final_size, 3000, "Log file size should be less than the total flooded bytes")

        finally:
            if os.path.exists(log_path):
                os.remove(log_path)

    def test_get_max_log_file_bytes_fallback(self):
        """Verifies _get_max_log_file_bytes default and safety floor."""
        pm = ProcessManager(db_session_factory=MagicMock())
        # Default when no custom config exists
        val = pm._get_max_log_file_bytes()
        self.assertGreaterEqual(val, 1048576)


if __name__ == "__main__":
    unittest.main()
