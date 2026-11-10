import array
import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from core.pipewire_meter_collector import PipeWireMeterCollector


class TestPipeWireMeterCollector(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.mock_pm = MagicMock()
        self.mock_pm._get_pipewire_tool_binary = MagicMock(return_value=("/usr/bin/pw-record", None))

    async def test_sync_active_nodes_monitors_eligible_audio_nodes_and_excludes_pw_record(self):
        collector = PipeWireMeterCollector(14, self.mock_pm)

        # Mock telemetry with 6 nodes:
        # Node 1: Audio/Sink -> SHOULD monitor
        # Node 2: Stream/Output/Audio -> SHOULD monitor
        # Node 3: Dummy-Driver -> SHOULD NOT monitor
        # Node 4: Audio/Sink with error state -> SHOULD NOT monitor
        # Node 5: pw-record capture client -> MUST NOT monitor (recursion block!)
        # Node 6: Generic Stream/Input/Audio -> MUST NOT monitor (audio consumer!)
        mock_graph = {
            "active": True,
            "nodes": [
                {"id": 1, "name": "aes_bus_1", "media_class": "Audio/Sink", "state": "idle"},
                {"id": 2, "name": "rtp_rx_remote_test1", "media_class": "Stream/Output/Audio", "state": "running"},
                {"id": 3, "name": "Dummy-Driver", "media_class": "", "state": "running"},
                {"id": 4, "name": "broken_sink", "media_class": "Audio/Sink", "state": "error"},
                {"id": 5, "name": "pw-record", "media_class": "Stream/Input/Audio", "state": "running"},
                {"id": 6, "name": "ffmpeg_capture", "media_class": "Stream/Input/Audio", "state": "running"},
            ],
            "links": []
        }

        with patch.object(collector, "_monitor_node", new_callable=AsyncMock) as mock_monitor:
            await collector.sync_active_nodes(mock_graph)

            # Only nodes 1 and 2 should have monitoring tasks created
            self.assertIn(1, collector.tasks)
            self.assertIn(2, collector.tasks)
            self.assertNotIn(3, collector.tasks)
            self.assertNotIn(4, collector.tasks)
            self.assertNotIn(5, collector.tasks)
            self.assertNotIn(6, collector.tasks)

        await collector.stop()

    async def test_sync_active_nodes_respects_max_limit(self):
        collector = PipeWireMeterCollector(14, self.mock_pm)
        collector.MAX_CONCURRENT_METERS = 3

        mock_graph = {
            "active": True,
            "nodes": [
                {"id": i, "name": f"sink_{i}", "media_class": "Audio/Sink", "state": "running"}
                for i in range(1, 10)
            ],
            "links": []
        }

        with patch.object(collector, "_monitor_node", new_callable=AsyncMock):
            await collector.sync_active_nodes(mock_graph)
            self.assertEqual(len(collector.tasks), 3)

        await collector.stop()

    async def test_get_meters_returns_formatted_dict(self):
        collector = PipeWireMeterCollector(14, self.mock_pm)
        collector.latest_levels = {
            1: [0.75, 0.70],
            42: [0.12, 0.15],
        }

        meters = await collector.get_meters()
        self.assertEqual(meters, {
            "1": [0.75, 0.70],
            "42": [0.12, 0.15],
        })

        await collector.stop()

    async def test_stop_terminates_all_tasks_and_procs(self):
        collector = PipeWireMeterCollector(14, self.mock_pm)
        mock_proc = MagicMock()
        collector.procs[10] = mock_proc
        collector.latest_levels[10] = [0.5, 0.5]

        # Create dummy task
        async def dummy():
            await asyncio.sleep(10)
        t = asyncio.create_task(dummy())
        collector.tasks[10] = t

        await collector.stop()
        await asyncio.sleep(0)
        mock_proc.terminate.assert_called_once()
        self.assertTrue(t.cancelled())
        self.assertEqual(len(collector.procs), 0)
        self.assertEqual(len(collector.latest_levels), 0)
