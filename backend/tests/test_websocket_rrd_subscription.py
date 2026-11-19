import asyncio
import json
import pytest
from core.websocket_subscription_hub import WebSocketSubscriptionHub
from core.rrd_store import volatile_rrd_store


class DummyWebSocket:
    def __init__(self):
        self.sent_messages = []
        self.closed = False

    async def send_json(self, data):
        if self.closed:
            raise RuntimeError("WebSocket closed")
        self.sent_messages.append(data)


@pytest.mark.asyncio
async def test_websocket_rrd_subscription_flow():
    hub = WebSocketSubscriptionHub()
    ws = DummyWebSocket()

    # Pre-populate some RRD data for service #5
    volatile_rrd_store.clear_all()
    for i in range(10):
        volatile_rrd_store.record_service_sample(
            service_id=5,
            cpu=10.0 + i,
            ram=100.0,
            fps=30.0,
            bitrate=4000.0 + i * 10,
            speed=1.0,
            timestamp=1700000000.0 + i * 5,
        )

    # 1. Subscribe to service_metrics_rrd
    sub_msg = json.dumps({
        "action": "subscribe",
        "topic": "service_metrics_rrd",
        "id": 5,
        "range": "30m",
        "metric": "bitrate",
    })
    await hub.handle_client_message(ws, sub_msg)

    # Verify initial snapshot received
    assert len(ws.sent_messages) == 1
    snapshot = ws.sent_messages[0]
    assert snapshot["type"] == "service_metrics_rrd"
    assert snapshot["id"] == 5
    assert len(snapshot["data"]["timestamps"]) == 10
    assert snapshot["data"]["metric"] == "bitrate"

    # 2. Broadcast deltas
    await hub.broadcast_deltas()
    assert len(ws.sent_messages) == 2
    delta = ws.sent_messages[1]
    assert delta["type"] == "service_metrics_rrd"
    assert delta["id"] == 5

    # 3. Unsubscribe
    unsub_msg = json.dumps({
        "action": "unsubscribe",
        "topic": "service_metrics_rrd",
        "id": 5,
    })
    await hub.handle_client_message(ws, unsub_msg)

    # Broadcast again -> no new messages should be sent
    await hub.broadcast_deltas()
    assert len(ws.sent_messages) == 2
