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


if __name__ == "__main__":
    unittest.main()
