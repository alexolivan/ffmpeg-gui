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

    def test_websocket_telemetry_broadcasts_storages(self):
        from unittest.mock import patch, AsyncMock, MagicMock
        import asyncio
        from main import telemetry_broadcast_loop
        from database.models import Storage

        mock_storage = Storage(
            id=1,
            name="Test Storage",
            type="media",
            path="/tmp/test_storage_path",
            is_default=True
        )

        mock_ram = AsyncMock()
        mock_ram.used = 1024 * 1024 * 1000
        mock_ram.total = 1024 * 1024 * 8000

        mock_usage = MagicMock()
        mock_usage.total = 10 * (1024 ** 3)
        mock_usage.used = 4 * (1024 ** 3)
        mock_usage.free = 6 * (1024 ** 3)

        mock_session = MagicMock()
        mock_session.__enter__.return_value = mock_session
        mock_query = MagicMock()
        mock_session.query.return_value = mock_query

        def side_effect_all():
            called_model = mock_session.query.call_args[0][0]
            if called_model == Storage:
                return [mock_storage]
            return []

        mock_query.all.side_effect = side_effect_all
        mock_query.filter.return_value.all.return_value = []
        mock_query.filter.return_value.count.return_value = 0

        with patch("main.manager.broadcast", new_callable=AsyncMock) as mock_broadcast, \
             patch("main.psutil.cpu_percent", return_value=5.0), \
             patch("main.psutil.virtual_memory", return_value=mock_ram), \
             patch("main.GPUSensor.get_stats", return_value={}), \
             patch("main.shutil.disk_usage", return_value=mock_usage) as mock_disk_usage, \
             patch("main.SessionLocal", return_value=mock_session), \
             patch("main.asyncio.sleep", side_effect=ValueError("stop")):
            
            try:
                asyncio.run(telemetry_broadcast_loop())
            except ValueError as e:
                if str(e) != "stop":
                    raise

            mock_disk_usage.assert_called_once_with("/tmp/test_storage_path")
            self.assertTrue(mock_broadcast.called)
            call_args = mock_broadcast.call_args[0][0]
            self.assertIn("storages", call_args)
            storages = call_args["storages"]
            self.assertEqual(len(storages), 1)
            s_data = storages[0]
            self.assertEqual(s_data["id"], 1)
            self.assertEqual(s_data["name"], "Test Storage")
            self.assertEqual(s_data["type"], "media")
            self.assertEqual(s_data["path"], "/tmp/test_storage_path")
            self.assertTrue(s_data["is_default"])
            self.assertEqual(s_data["total_gb"], 10.0)
            self.assertEqual(s_data["used_gb"], 4.0)
            self.assertEqual(s_data["free_gb"], 6.0)
            self.assertEqual(s_data["percent"], 40.0)

    def test_websocket_telemetry_broadcasts_storages_error(self):
        from unittest.mock import patch, AsyncMock, MagicMock
        import asyncio
        from main import telemetry_broadcast_loop
        from database.models import Storage

        mock_storage = Storage(
            id=1,
            name="Test Storage Error",
            type="media",
            path="/tmp/test_storage_error",
            is_default=True
        )

        mock_ram = AsyncMock()
        mock_ram.used = 1024 * 1024 * 1000
        mock_ram.total = 1024 * 1024 * 8000

        mock_session = MagicMock()
        mock_session.__enter__.return_value = mock_session
        mock_query = MagicMock()
        mock_session.query.return_value = mock_query

        def side_effect_all():
            called_model = mock_session.query.call_args[0][0]
            if called_model == Storage:
                return [mock_storage]
            return []

        mock_query.all.side_effect = side_effect_all
        mock_query.filter.return_value.all.return_value = []
        mock_query.filter.return_value.count.return_value = 0

        with patch("main.manager.broadcast", new_callable=AsyncMock) as mock_broadcast, \
             patch("main.psutil.cpu_percent", return_value=5.0), \
             patch("main.psutil.virtual_memory", return_value=mock_ram), \
             patch("main.GPUSensor.get_stats", return_value={}), \
             patch("main.shutil.disk_usage", side_effect=PermissionError("Permission Denied")) as mock_disk_usage, \
             patch("main.SessionLocal", return_value=mock_session), \
             patch("main.asyncio.sleep", side_effect=ValueError("stop")):
            
            try:
                asyncio.run(telemetry_broadcast_loop())
            except ValueError as e:
                if str(e) != "stop":
                    raise

            mock_disk_usage.assert_called_once_with("/tmp/test_storage_error")
            self.assertTrue(mock_broadcast.called)
            call_args = mock_broadcast.call_args[0][0]
            self.assertIn("storages", call_args)
            storages = call_args["storages"]
            self.assertEqual(len(storages), 1)
            s_data = storages[0]
            self.assertEqual(s_data["id"], 1)
            self.assertEqual(s_data["name"], "Test Storage Error")
            self.assertEqual(s_data["total_gb"], 0.0)
            self.assertEqual(s_data["used_gb"], 0.0)
            self.assertEqual(s_data["free_gb"], 0.0)
            self.assertEqual(s_data["percent"], 0.0)


