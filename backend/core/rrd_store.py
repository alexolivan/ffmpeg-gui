"""
Volatile in-memory Multi-Tier Round-Robin Database (RRD) store.
Enforces zero disk I/O to protect solid-state / flash storage (SATADom).
Maintains sliding-window ring buffers with Min/Max/Avg consolidation to preserve
micro-outliers, drops, and spikes across 24-hour periods.
"""

from collections import deque
import logging
import threading
import time
from typing import Any, Dict, List, Optional

logger = logging.getLogger("ffmpeg_gui.rrd")

METRICS = ("cpu", "ram", "fps", "bitrate", "speed")


class ServiceRRDTracker:
    """
    In-memory RRD tracker for a single live process/service.

    Three concentric tiers:
      - Tier 1 (30m): 360 points @ 5s intervals. Raw instantaneous points.
      - Tier 2 (6h):  360 points @ 60s intervals. Consolidated Avg/Min/Max.
      - Tier 3 (24h): 288 points @ 300s (5m) intervals. Consolidated Avg/Min/Max.
    """

    def __init__(self, service_id: int):
        self.service_id = service_id
        self._lock = threading.Lock()

        # Tier 1: 30 minutes @ 5s = 360 points max
        # Element: (timestamp, {metric: float})
        self._tier_30m: deque = deque(maxlen=360)

        # Tier 2 accumulator & buffer (6 hours @ 60s = 360 points max)
        # Element: (timestamp, {metric: {"avg": float, "min": float, "max": float}})
        self._t2_accumulator: List[Dict[str, float]] = []
        self._t2_start_ts: Optional[float] = None
        self._tier_6h: deque = deque(maxlen=360)

        # Tier 3 accumulator & buffer (24 hours @ 300s = 288 points max)
        # Element: (timestamp, {metric: {"avg": float, "min": float, "max": float}})
        self._t3_accumulator: List[Dict[str, Dict[str, float]]] = []
        self._t3_start_ts: Optional[float] = None
        self._tier_24h: deque = deque(maxlen=288)

    def record_sample(
        self,
        cpu: float,
        ram: float,
        fps: float,
        bitrate: float,
        speed: float,
        timestamp: Optional[float] = None,
    ) -> None:
        """Record a live 5-second sample and downsample across tiers."""
        ts = float(timestamp if timestamp is not None else time.time())
        sample = {
            "cpu": float(cpu or 0.0),
            "ram": float(ram or 0.0),
            "fps": float(fps or 0.0),
            "bitrate": float(bitrate or 0.0),
            "speed": float(speed or 0.0),
        }

        with self._lock:
            # 1. Append to Tier 1 (30m)
            self._tier_30m.append((ts, sample))

            # 2. Accumulate for Tier 2 (60s consolidation)
            if self._t2_start_ts is None:
                self._t2_start_ts = ts
            self._t2_accumulator.append(sample)

            # Check if 60 seconds elapsed or 12 samples gathered
            if (ts - self._t2_start_ts >= 59.9) or (len(self._t2_accumulator) >= 12):
                t2_point = self._consolidate_raw(self._t2_accumulator)
                t2_ts = self._t2_start_ts + (ts - self._t2_start_ts) / 2.0
                self._tier_6h.append((t2_ts, t2_point))
                self._t2_accumulator = []
                self._t2_start_ts = None

                # 3. Accumulate for Tier 3 (300s consolidation)
                if self._t3_start_ts is None:
                    self._t3_start_ts = t2_ts
                self._t3_accumulator.append(t2_point)

                # Check if 300 seconds elapsed or 5 Tier-2 points gathered
                if (ts - self._t3_start_ts >= 299.9) or (len(self._t3_accumulator) >= 5):
                    t3_point = self._consolidate_points(self._t3_accumulator)
                    t3_ts = self._t3_start_ts + (ts - self._t3_start_ts) / 2.0
                    self._tier_24h.append((t3_ts, t3_point))
                    self._t3_accumulator = []
                    self._t3_start_ts = None

    @staticmethod
    def _consolidate_raw(samples: List[Dict[str, float]]) -> Dict[str, Dict[str, float]]:
        """Consolidate a list of raw sample dicts into Avg, Min, Max dicts."""
        count = len(samples)
        if count == 0:
            return {m: {"avg": 0.0, "min": 0.0, "max": 0.0} for m in METRICS}

        result = {}
        for m in METRICS:
            vals = [s[m] for s in samples]
            result[m] = {
                "avg": round(sum(vals) / count, 2),
                "min": min(vals),
                "max": max(vals),
            }
        return result

    @staticmethod
    def _consolidate_points(points: List[Dict[str, Dict[str, float]]]) -> Dict[str, Dict[str, float]]:
        """Consolidate a list of tier points (which already have avg, min, max)."""
        count = len(points)
        if count == 0:
            return {m: {"avg": 0.0, "min": 0.0, "max": 0.0} for m in METRICS}

        result = {}
        for m in METRICS:
            avgs = [p[m]["avg"] for p in points]
            mins = [p[m]["min"] for p in points]
            maxs = [p[m]["max"] for p in points]
            result[m] = {
                "avg": round(sum(avgs) / count, 2),
                "min": min(mins),
                "max": max(maxs),
            }
        return result

    def get_series(self, metric: str, range: str = "24h") -> Dict[str, Any]:
        """
        Extract time series and Min/Max envelopes for a specified metric and range.
        Ranges: '30m', '6h', '24h'.
        """
        valid_metric = metric if metric in METRICS else "bitrate"
        range_clean = range.lower().strip() if range else "24h"

        with self._lock:
            timestamps: List[float] = []
            avg_vals: List[float] = []
            min_vals: List[float] = []
            max_vals: List[float] = []

            if range_clean == "30m":
                for ts, s in self._tier_30m:
                    val = s.get(valid_metric, 0.0)
                    timestamps.append(ts)
                    avg_vals.append(val)
                    min_vals.append(val)
                    max_vals.append(val)

            elif range_clean == "6h":
                for ts, p in self._tier_6h:
                    m_data = p.get(valid_metric, {"avg": 0.0, "min": 0.0, "max": 0.0})
                    timestamps.append(ts)
                    avg_vals.append(m_data["avg"])
                    min_vals.append(m_data["min"])
                    max_vals.append(m_data["max"])

            else:  # default "24h"
                for ts, p in self._tier_24h:
                    m_data = p.get(valid_metric, {"avg": 0.0, "min": 0.0, "max": 0.0})
                    timestamps.append(ts)
                    avg_vals.append(m_data["avg"])
                    min_vals.append(m_data["min"])
                    max_vals.append(m_data["max"])

        # Compute anomaly / outlier summary
        has_outliers = False
        min_val = min(min_vals) if min_vals else 0.0
        max_val = max(max_vals) if max_vals else 0.0
        min_ts = timestamps[min_vals.index(min_val)] if min_vals else None
        max_ts = timestamps[max_vals.index(max_val)] if max_vals else None

        if avg_vals:
            if valid_metric in ("bitrate", "fps") and min_val == 0.0 and (max_val > 0.0 or len(avg_vals) > 1):
                has_outliers = True
            elif valid_metric == "speed" and min_val < 0.9:
                has_outliers = True
            elif valid_metric == "cpu" and max_val > 90.0:
                has_outliers = True

        return {
            "metric": valid_metric,
            "range": range_clean,
            "service_id": self.service_id,
            "timestamps": timestamps,
            "avg": avg_vals,
            "min": min_vals,
            "max": max_vals,
            "anomaly_summary": {
                "min_value": min_val,
                "min_timestamp": min_ts,
                "max_value": max_val,
                "max_timestamp": max_ts,
                "has_outliers": has_outliers,
            },
        }

    def get_sparkline(self, metric: str = "bitrate", count: int = 24) -> List[float]:
        """Return the most recent average points for compact UI sparkline rendering."""
        valid_metric = metric if metric in METRICS else "bitrate"
        with self._lock:
            # Prefer 30m tier if it has points; otherwise 6h or 24h
            if self._tier_30m:
                source = [s.get(valid_metric, 0.0) for _, s in self._tier_30m]
            elif self._tier_6h:
                source = [p.get(valid_metric, {}).get("avg", 0.0) for _, p in self._tier_6h]
            elif self._tier_24h:
                source = [p.get(valid_metric, {}).get("avg", 0.0) for _, p in self._tier_24h]
            else:
                return []

            return source[-count:] if len(source) > count else source


class VolatileRRDStore:
    """Singleton managing in-memory volatile RRD trackers across all services."""

    def __init__(self):
        self._lock = threading.Lock()
        self._trackers: Dict[int, ServiceRRDTracker] = {}

    def get_or_create(self, service_id: int) -> ServiceRRDTracker:
        with self._lock:
            if service_id not in self._trackers:
                self._trackers[service_id] = ServiceRRDTracker(service_id)
            return self._trackers[service_id]

    def get(self, service_id: int) -> Optional[ServiceRRDTracker]:
        with self._lock:
            return self._trackers.get(service_id)

    def record_service_sample(
        self,
        service_id: int,
        cpu: float,
        ram: float,
        fps: float,
        bitrate: float,
        speed: float,
        timestamp: Optional[float] = None,
    ) -> None:
        tracker = self.get_or_create(service_id)
        tracker.record_sample(cpu, ram, fps, bitrate, speed, timestamp)

    def remove(self, service_id: int) -> None:
        with self._lock:
            self._trackers.pop(service_id, None)

    def clear_all(self) -> None:
        with self._lock:
            self._trackers.clear()


# Global in-memory singleton
volatile_rrd_store = VolatileRRDStore()
