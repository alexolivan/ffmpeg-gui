import os
import sys
import unittest
from fastapi.testclient import TestClient

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from main import app
from version import __version__
from database.version import __schema_version__

class TestVersionInfoAPI(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_status_endpoint_returns_versions(self):
        res = self.client.get("/api/status")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["version"], __version__)
        self.assertEqual(data["schema_version"], __schema_version__)

    def test_websocket_telemetry_broadcasts_versions(self):
        from unittest.mock import patch, AsyncMock
        import asyncio
        from main import telemetry_broadcast_loop

        mock_ram = AsyncMock()
        mock_ram.used = 1024 * 1024 * 1000
        mock_ram.total = 1024 * 1024 * 8000

        with patch("main.manager.broadcast", new_callable=AsyncMock) as mock_broadcast, \
             patch("main.psutil.cpu_percent", return_value=5.0), \
             patch("main.psutil.virtual_memory", return_value=mock_ram), \
             patch("main.GPUSensor.get_stats", return_value={}), \
             patch("main.asyncio.sleep", side_effect=ValueError("stop")):
            
            try:
                asyncio.run(telemetry_broadcast_loop())
            except ValueError as e:
                if str(e) != "stop":
                    raise

            self.assertTrue(mock_broadcast.called)
            call_args = mock_broadcast.call_args[0][0]
            self.assertEqual(call_args["type"], "telemetry")
            self.assertIn("system", call_args)
            sys_data = call_args["system"]
            self.assertIn("host_os_arch", sys_data)
            self.assertEqual(sys_data["backend_version"], __version__)
            self.assertEqual(sys_data["schema_version"], __schema_version__)

