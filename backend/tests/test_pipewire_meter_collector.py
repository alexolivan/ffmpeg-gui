import array
import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from core.pipewire_meter_collector import PipeWireMeterCollector


class TestPipeWireMeterCollector(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.mock_pm = MagicMock()
        self.mock_pm._get_pipewire_tool_binary = MagicMock(return_value=("/usr/bin/pw-record", None))

    async def test_sync_active_nodes_filters_only_running_and_linked(self):
        collector = PipeWireMeterCollector(14, self.mock_pm)

        # Mock telemetry with 3 nodes:
        # Node 1: running, linked -> SHOULD monitor
        # Node 2: idle, linked -> SHOULD NOT monitor
        # Node 3: running, unlinked -> SHOULD NOT monitor
        mock_graph = {
            "active": True,
            "nodes": [
                {"id": 1, "name": "sink_active", "state": "running"},
                {"id": 2, "name": "sink_idle", "state": "idle"},
                {"id": 3, "name": "sink_unlinked", "state": "running"},
            ],
            "links": [
                {"output_node_id": 1, "input_node_id": 99},
                {"output_node_id": 2, "input_node_id": 98},
            ]
        }

        with patch.object(collector, "_monitor_node", new_callable=AsyncMock) as mock_monitor:
            await collector.sync_active_nodes(mock_graph)

            # Only node 1 should have a monitoring task created
            self.assertIn(1, collector.tasks)
            self.assertNotIn(2, collector.tasks)
            self.assertNotIn(3, collector.tasks)

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
