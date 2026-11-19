import time
import pytest
from core.rrd_store import ServiceRRDTracker, VolatileRRDStore, volatile_rrd_store


def test_rrd_tracker_tiers_and_retention():
    tracker = ServiceRRDTracker(service_id=1)
    base_time = 1700000000.0

    # 1. Feed 12 samples (1 sample every 5s = 60s total)
    for i in range(12):
        ts = base_time + (i * 5)
        # Bitrate around 5000 kbps, but sample #5 drops to 0 kbps
        bitrate = 0.0 if i == 5 else 5000.0
        tracker.record_sample(
            cpu=20.0 + i,
            ram=150.0,
            fps=30.0 if i != 5 else 0.0,
            bitrate=bitrate,
            speed=1.0 if i != 5 else 0.2,
            timestamp=ts,
        )

    # Check Tier 1 (30m): has 12 points
    t1_data = tracker.get_series(metric="bitrate", range="30m")
    assert len(t1_data["timestamps"]) == 12
    assert t1_data["avg"][5] == 0.0
    assert t1_data["min"][5] == 0.0
    assert t1_data["max"][5] == 0.0
    assert t1_data["avg"][0] == 5000.0

    # Check Tier 2 (6h): should have consolidated exactly 1 bucket of 60s
    t2_data = tracker.get_series(metric="bitrate", range="6h")
    assert len(t2_data["timestamps"]) == 1
    # Average should be (11 * 5000 + 0) / 12 = 4583.33
    assert abs(t2_data["avg"][0] - 4583.33) < 1.0
    # Crucial: MIN MUST BE 0.0 despite the high average!
    assert t2_data["min"][0] == 0.0
    assert t2_data["max"][0] == 5000.0

    # Check anomaly summary detects the drop
    assert t2_data["anomaly_summary"]["min_value"] == 0.0
    assert t2_data["anomaly_summary"]["has_outliers"] is True


def test_rrd_tier3_consolidation_and_bounded_memory():
    tracker = ServiceRRDTracker(service_id=2)
    base_time = 1700000000.0

    # Feed 360 samples @ 5s = 1800s (30 minutes = 30 buckets of 60s in Tier 2 = 6 buckets of 300s in Tier 3)
    for i in range(360):
        ts = base_time + (i * 5)
        # Single dropout at sample 100
        fps = 0.0 if i == 100 else 60.0
        tracker.record_sample(
            cpu=15.0,
            ram=200.0,
            fps=fps,
            bitrate=4000.0,
            speed=1.0,
            timestamp=ts,
        )

    # Tier 1 should be capped at 360 points
    t1 = tracker.get_series(metric="fps", range="30m")
    assert len(t1["timestamps"]) == 360

    # Tier 2 should have 30 points (each 60s)
    t2 = tracker.get_series(metric="fps", range="6h")
    assert len(t2["timestamps"]) == 30

    # Tier 3 should have 6 points (each 300s / 5min)
    t3 = tracker.get_series(metric="fps", range="24h")
    assert len(t3["timestamps"]) == 6
    # Anomaly preservation in 24h tier: the 300s bucket containing sample 100 must have min=0.0!
    assert any(m == 0.0 for m in t3["min"])
    assert t3["anomaly_summary"]["has_outliers"] is True


def test_sparkline_retrieval():
    tracker = ServiceRRDTracker(service_id=3)
    base_time = 1700000000.0

    for i in range(50):
        tracker.record_sample(
            cpu=10.0 + i,
            ram=100.0,
            fps=30.0,
            bitrate=2500.0,
            speed=1.0,
            timestamp=base_time + i * 5,
        )

    spark = tracker.get_sparkline(metric="cpu", count=20)
    assert len(spark) == 20
    # Most recent should match the last recorded sample
    assert abs(spark[-1] - 59.0) < 0.1


def test_volatile_rrd_store_singleton():
    store = VolatileRRDStore()
    store.clear_all()

    store.record_service_sample(service_id=10, cpu=25.0, ram=120.0, fps=25.0, bitrate=3000.0, speed=1.0)
    tracker = store.get(10)
    assert tracker is not None
    assert tracker.service_id == 10

    series = tracker.get_series("cpu", "30m")
    assert len(series["avg"]) == 1
    assert series["avg"][0] == 25.0

    store.remove(10)
    assert store.get(10) is None


def test_rrd_tracker_handles_string_metrics():
    """Verify tracker resiliently parses string telemetry from FFmpeg, PipeWire, Icecast (e.g. 'N/A', '128.0kbits/s', '1.0x')."""
    from core.rrd_store import parse_bitrate_kbps, parse_speed_ratio, parse_metric_float

    # Test standalone helper functions
    assert parse_bitrate_kbps("N/A") == 0.0
    assert parse_bitrate_kbps("0 kb/s") == 0.0
    assert parse_bitrate_kbps("0.0kbits/s") == 0.0
    assert parse_bitrate_kbps("128.0kbits/s") == 128.0
    assert parse_bitrate_kbps("2.5Mbits/s") == 2500.0
    assert parse_bitrate_kbps(None) == 0.0
    assert parse_bitrate_kbps(3500.0) == 3500.0

    assert parse_speed_ratio("1.02x") == 1.02
    assert parse_speed_ratio("0x") == 0.0
    assert parse_speed_ratio("N/A") == 0.0
    assert parse_speed_ratio(None) == 0.0

    assert parse_metric_float("25.0") == 25.0
    assert parse_metric_float("15.5%") == 15.5
    assert parse_metric_float("N/A") == 0.0
    assert parse_metric_float(None) == 0.0

    # Test tracker end-to-end with string inputs
    tracker = ServiceRRDTracker(service_id=99)
    tracker.record_sample(
        cpu="15.5%",
        ram="250.0 MB",
        fps="N/A",
        bitrate="N/A",
        speed="1.0x",
    )
    t1 = tracker.get_series("bitrate", "30m")
    assert len(t1["timestamps"]) == 1
    assert t1["avg"][0] == 0.0

    tracker.record_sample(
        cpu=None,
        ram=None,
        fps="25.0",
        bitrate="128.0kbits/s",
        speed="0x",
    )
    t1_fps = tracker.get_series("fps", "30m")
    assert t1_fps["avg"][1] == 25.0

    t1_br = tracker.get_series("bitrate", "30m")
    assert t1_br["avg"][1] == 128.0

