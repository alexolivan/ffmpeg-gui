import asyncio
import json
import unittest
from unittest.mock import AsyncMock, MagicMock
from collections import deque
from backend.core.websocket_subscription_hub import WebSocketSubscriptionHub


class TestWebSocketSubscriptionHub(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.hub = WebSocketSubscriptionHub()
        self.mock_ws = AsyncMock()
        self.mock_ws.send_json = AsyncMock()

    async def test_subscribe_process_logs_sends_initial_snapshot(self):
        mock_proc_manager = MagicMock()
        mock_proc_manager.log_buffers = {
            1: deque([
                {"timestamp": "2026-11-02T12:00:00Z", "level": "INFO", "message": "Log line 1"},
                {"timestamp": "2026-11-02T12:00:01Z", "level": "INFO", "message": "Log line 2"},
            ])
        }

        # Handle subscription
        msg = json.dumps({"action": "subscribe", "topic": "process_logs", "id": 1})
        await self.hub.handle_client_message(self.mock_ws, msg, process_manager=mock_proc_manager)

        self.assertTrue(self.hub.has_subscribers("process_logs", 1))
        self.mock_ws.send_json.assert_called_once()
        sent = self.mock_ws.send_json.call_args[0][0]
        self.assertEqual(sent["type"], "process_logs")
        self.assertEqual(sent["id"], 1)
        self.assertEqual(len(sent["lines"]), 2)
        self.assertTrue(sent["reset"])

    async def test_unsubscribe_process_logs(self):
        mock_proc_manager = MagicMock()
        mock_proc_manager.log_buffers = {}

        msg_sub = json.dumps({"action": "subscribe", "topic": "process_logs", "id": 2})
        await self.hub.handle_client_message(self.mock_ws, msg_sub, process_manager=mock_proc_manager)
        self.assertTrue(self.hub.has_subscribers("process_logs", 2))

        msg_unsub = json.dumps({"action": "unsubscribe", "topic": "process_logs", "id": 2})
        await self.hub.handle_client_message(self.mock_ws, msg_unsub, process_manager=mock_proc_manager)
        self.assertFalse(self.hub.has_subscribers("process_logs", 2))

    async def test_unregister_client_cleans_all_subscriptions(self):
        mock_proc_manager = MagicMock()
        mock_proc_manager.log_buffers = {}

        await self.hub.handle_client_message(
            self.mock_ws,
            json.dumps({"action": "subscribe", "topic": "process_logs", "id": 3}),
            process_manager=mock_proc_manager
        )
        await self.hub.handle_client_message(
            self.mock_ws,
            json.dumps({"action": "subscribe", "topic": "resource_locks"}),
            process_manager=mock_proc_manager
        )

        self.assertTrue(self.hub.has_subscribers("process_logs", 3))
        self.assertTrue(self.hub.has_subscribers("resource_locks", None))

        self.hub.unregister_client(self.mock_ws)

        self.assertFalse(self.hub.has_subscribers("process_logs", 3))
        self.assertFalse(self.hub.has_subscribers("resource_locks", None))

    async def test_broadcast_process_logs_deltas(self):
        mock_proc_manager = MagicMock()
        buffer = deque([
            {"timestamp": "2026-11-02T12:00:00Z", "level": "INFO", "message": "Line 1"},
        ])
        mock_proc_manager.log_buffers = {10: buffer}

        # Subscribe
        await self.hub.handle_client_message(
            self.mock_ws,
            json.dumps({"action": "subscribe", "topic": "process_logs", "id": 10}),
            process_manager=mock_proc_manager
        )
        self.mock_ws.send_json.reset_mock()

        # Add new lines to buffer
        buffer.append({"timestamp": "2026-11-02T12:00:01Z", "level": "INFO", "message": "Line 2"})

        # Broadcast deltas
        await self.hub.broadcast_deltas(process_manager=mock_proc_manager)

        self.mock_ws.send_json.assert_called_once()
        sent = self.mock_ws.send_json.call_args[0][0]
        self.assertEqual(sent["type"], "process_logs")
        self.assertEqual(sent["id"], 10)
        self.assertEqual(len(sent["lines"]), 1)
        self.assertEqual(sent["lines"][0]["message"], "Line 2")
        self.assertFalse(sent["reset"])

    async def test_malformed_json_does_not_crash(self):
        await self.hub.handle_client_message(self.mock_ws, "not-a-json")
        self.mock_ws.send_json.assert_not_called()

    async def test_subscribe_sidecar_logs_falls_back_to_disk_when_buffer_empty(self):
        import tempfile
        import os

        mock_proc_manager = MagicMock()
        mock_proc_manager.sidecar_log_buffers = {}

        with tempfile.TemporaryDirectory() as tmpdir:
            log_file = os.path.join(tmpdir, "ptp4l_5.log")
            with open(log_file, "w") as f:
                f.write("ptp4l sidecar disk line 1\nptp4l sidecar disk line 2\n")

            mock_proc_manager.get_process_log_storage_path.return_value = tmpdir

            mock_session = MagicMock()
            mock_proc = MagicMock()
            mock_proc.config = {"log_storage_id": None}
            mock_session.get.return_value = mock_proc
            mock_session.query.return_value.get.return_value = mock_proc

            class DummySessionFactory:
                def __enter__(self):
                    return mock_session
                def __exit__(self, *args):
                    pass
                def __call__(self):
                    return self

            db_factory = DummySessionFactory()

            msg = json.dumps({"action": "subscribe", "topic": "sidecar_logs", "id": "5:ptp4l"})
            await self.hub.handle_client_message(
                self.mock_ws,
                msg,
                process_manager=mock_proc_manager,
                db_session_factory=db_factory
            )

            self.mock_ws.send_json.assert_called_once()
            sent = self.mock_ws.send_json.call_args[0][0]
            self.assertEqual(sent["type"], "sidecar_logs")
            self.assertEqual(sent["id"], "5:ptp4l")
            self.assertEqual(len(sent["lines"]), 2)
            self.assertEqual(sent["lines"][0]["message"], "ptp4l sidecar disk line 1")
            self.assertEqual(sent["lines"][1]["message"], "ptp4l sidecar disk line 2")
            self.assertTrue(sent["reset"])

    async def test_subscribe_pipewire_graph_sends_initial_snapshot(self):
        mock_proc_manager = MagicMock()
        mock_proc_manager.get_pipewire_telemetry = AsyncMock(return_value={
            "active": True,
            "nodes": [{"id": 1, "name": "dummy_node"}],
            "links": [],
            "aoip_discovery": {"discovered_streams": []}
        })

        msg = json.dumps({"action": "subscribe", "topic": "pipewire_graph", "id": 7})
        await self.hub.handle_client_message(self.mock_ws, msg, process_manager=mock_proc_manager)

        self.assertTrue(self.hub.has_subscribers("pipewire_graph", 7))
        self.mock_ws.send_json.assert_called_once()
        sent = self.mock_ws.send_json.call_args[0][0]
        self.assertEqual(sent["type"], "pipewire_graph")
        self.assertEqual(sent["id"], 7)
        self.assertEqual(sent["graph"]["nodes"][0]["name"], "dummy_node")

    async def test_broadcast_pipewire_graph_throttles_and_ignores_ephemeral_last_seen(self):
        mock_proc_manager = MagicMock()
        mock_proc_manager.get_pipewire_telemetry = AsyncMock(side_effect=[
            {
                "active": True,
                "nodes": [{"id": 1}],
                "aoip_discovery": {"discovered_streams": [{"multicast_ip": "239.1.1.1", "last_seen": 100.0}]}
            },
            {
                "active": True,
                "nodes": [{"id": 1}],
                "aoip_discovery": {"discovered_streams": [{"multicast_ip": "239.1.1.1", "last_seen": 102.5}]}
            },
            {
                "active": True,
                "nodes": [{"id": 1}, {"id": 2}],
                "aoip_discovery": {"discovered_streams": [{"multicast_ip": "239.1.1.1", "last_seen": 105.0}]}
            }
        ])

        # Subscribe
        await self.hub.handle_client_message(
            self.mock_ws,
            json.dumps({"action": "subscribe", "topic": "pipewire_graph", "id": 7}),
            process_manager=mock_proc_manager
        )
        self.mock_ws.send_json.reset_mock()

        # Immediate broadcast should be throttled (< 2.5s)
        await self.hub.broadcast_deltas(process_manager=mock_proc_manager)
        self.mock_ws.send_json.assert_not_called()

        # Simulate 2.5s elapsed, but graph only changed last_seen -> should NOT push
        self.hub._last_pipewire_poll_ts[7] -= 3.0
        await self.hub.broadcast_deltas(process_manager=mock_proc_manager)
        self.mock_ws.send_json.assert_not_called()

        # Simulate 2.5s elapsed, topology changed (new node id 2) -> SHOULD push
        self.hub._last_pipewire_poll_ts[7] -= 3.0
        await self.hub.broadcast_deltas(process_manager=mock_proc_manager)
        self.mock_ws.send_json.assert_called_once()
        sent = self.mock_ws.send_json.call_args[0][0]
        self.assertEqual(len(sent["graph"]["nodes"]), 2)

    async def test_invalidate_pipewire_graph_forces_broadcast_and_unsubscribe_cleans_state(self):
        mock_proc_manager = MagicMock()
        mock_proc_manager.get_pipewire_telemetry = AsyncMock(return_value={"nodes": []})

        await self.hub.handle_client_message(
            self.mock_ws,
            json.dumps({"action": "subscribe", "topic": "pipewire_graph", "id": 8}),
            process_manager=mock_proc_manager
        )
        self.mock_ws.send_json.reset_mock()

        # Invalidate forces poll timestamp reset
        self.hub.invalidate_pipewire_graph(8)
        self.assertEqual(self.hub._last_pipewire_poll_ts.get(8), 0.0)

        # Unsubscribe cleans state
        await self.hub.handle_client_message(
            self.mock_ws,
            json.dumps({"action": "unsubscribe", "topic": "pipewire_graph", "id": 8}),
            process_manager=mock_proc_manager
        )
        self.assertFalse(self.hub.has_subscribers("pipewire_graph", 8))
        self.assertNotIn(8, self.hub._last_pipewire_graph_sig)
        self.assertNotIn(8, self.hub._last_pipewire_poll_ts)


if __name__ == "__main__":
    unittest.main()
