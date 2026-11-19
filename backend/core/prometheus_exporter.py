"""
Prometheus / OpenMetrics Exporter v2 Architecture and Payload Builder.
Generates compliant OpenMetrics 0.0.4 text with semantic capability filtering:
- No false zero metrics (e.g. no fps/speed on auxiliary services or audio-only streams).
- Correct metric naming (e.g. ram_mb instead of ram_percent).
- Detailed subsystem metrics (Icecast2 mountpoints, MediaMTX paths, PipeWire sidecars/sinks).
- In-memory host health, storage, task, and peer federation metrics with zero disk I/O.
"""

import json
import logging
from typing import Any, Dict, List, Optional
import psutil

from core.rrd_store import parse_metric_float, parse_bitrate_kbps, parse_speed_ratio

logger = logging.getLogger("ffmpeg_gui.prometheus_exporter")


def escape_label_value(val: Any) -> str:
    """Escapes backslashes, double quotes, and newlines per OpenMetrics standard."""
    s = str(val) if val is not None else ""
    return s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def service_has_video(service: Any) -> bool:
    """
    Determines if a service contains a video stream.
    Returns False for non-FFmpeg services or audio-only configurations.
    """
    if not service:
        return False
    svc_type = getattr(service, "service_type", "ffmpeg_stream") or "ffmpeg_stream"
    if svc_type != "ffmpeg_stream":
        return False

    # Check codec configuration
    codec_cfg = getattr(service, "codec_config", None) or {}
    if isinstance(codec_cfg, str):
        try:
            codec_cfg = json.loads(codec_cfg)
        except Exception:
            codec_cfg = {}
    if not isinstance(codec_cfg, dict):
        codec_cfg = {}

    vcodec = codec_cfg.get("vcodec")
    if vcodec == "none":
        return False
    if vcodec and vcodec != "none":
        return True

    # Check input configuration
    input_cfg = getattr(service, "input_config", None) or {}
    if isinstance(input_cfg, str):
        try:
            input_cfg = json.loads(input_cfg)
        except Exception:
            input_cfg = {}
    if not isinstance(input_cfg, dict):
        input_cfg = {}

    if input_cfg.get("has_video") is False:
        return False
    if input_cfg.get("has_video") is True:
        return True

    in_type = (input_cfg.get("type") or getattr(service, "type", "") or "").lower()
    if in_type in ("alsa", "pulseaudio", "jack", "sndio", "audio"):
        return False

    # Check output configuration
    output_cfg = getattr(service, "output_config", None) or {}
    if isinstance(output_cfg, str):
        try:
            output_cfg = json.loads(output_cfg)
        except Exception:
            output_cfg = {}
    if not isinstance(output_cfg, dict):
        output_cfg = {}

    if output_cfg.get("has_video") is False:
        return False

    # If audio codec is set without any video codec
    if codec_cfg.get("acodec") and not codec_cfg.get("vcodec"):
        return False

    # If fps is reported and > 0, consider it video
    fps_val = getattr(service, "fps", None)
    if fps_val and parse_metric_float(fps_val) > 0.0:
        return True

    return True


def service_has_bitrate(service: Any) -> bool:
    """
    Determines if a service output produces an encoded bitrate metric.
    Returns False for non-FFmpeg services or baseband/uncompressed outputs.
    """
    if not service:
        return False
    svc_type = getattr(service, "service_type", "ffmpeg_stream") or "ffmpeg_stream"
    if svc_type != "ffmpeg_stream":
        return False

    # Check output format/type
    output_cfg = getattr(service, "output_config", None) or {}
    if isinstance(output_cfg, str):
        try:
            output_cfg = json.loads(output_cfg)
        except Exception:
            output_cfg = {}
    if not isinstance(output_cfg, dict):
        output_cfg = {}

    out_type = (output_cfg.get("type") or "").lower()
    if out_type in ("decklink", "pipewire", "alsa", "ndi", "null"):
        return False

    # If service is running, check if bitrate is explicitly N/A or None
    raw_bitrate = getattr(service, "bitrate", None)
    if raw_bitrate is not None:
        s_bitrate = str(raw_bitrate).strip().upper()
        if s_bitrate in ("N/A", "NONE", "NULL", "-", ""):
            return False

    return True


def build_openmetrics_payload(
    services: List[Any],
    telemetry_snapshot: Optional[Dict[str, Any]] = None,
    hardware_health: Optional[Dict[str, Any]] = None,
    process_manager: Any = None,
    now_utc_epoch: Optional[float] = None,
) -> str:
    """
    Builds a complete, syntactically valid OpenMetrics 0.0.4 text payload.
    Emits only semantically valid metrics with zero disk I/O.
    """
    lines: List[str] = []
    telemetry = telemetry_snapshot or {}
    hw_health = hardware_health or {}
    system_data = telemetry.get("system", {})

    # 1. Global Host & Daemon Health
    lines.extend([
        "# HELP ffmpeg_gui_system_cpu_percent Overall system host CPU usage percentage",
        "# TYPE ffmpeg_gui_system_cpu_percent gauge",
        f"ffmpeg_gui_system_cpu_percent {system_data.get('cpu', psutil.cpu_percent(interval=None))}",
        "# HELP ffmpeg_gui_system_ram_percent Overall system host RAM usage percentage",
        "# TYPE ffmpeg_gui_system_ram_percent gauge",
        f"ffmpeg_gui_system_ram_percent {psutil.virtual_memory().percent}",
        "# HELP ffmpeg_gui_system_ram_used_mb Total system RAM used in Megabytes",
        "# TYPE ffmpeg_gui_system_ram_used_mb gauge",
        f"ffmpeg_gui_system_ram_used_mb {system_data.get('ram_used', int(psutil.virtual_memory().used / (1024 * 1024)))}",
        "# HELP ffmpeg_gui_system_ram_total_mb Total system RAM installed in Megabytes",
        "# TYPE ffmpeg_gui_system_ram_total_mb gauge",
        f"ffmpeg_gui_system_ram_total_mb {system_data.get('ram_total', int(psutil.virtual_memory().total / (1024 * 1024)))}",
    ])

    if "system_uptime_seconds" in system_data:
        lines.extend([
            "# HELP ffmpeg_gui_system_uptime_seconds Host system uptime in seconds",
            "# TYPE ffmpeg_gui_system_uptime_seconds gauge",
            f"ffmpeg_gui_system_uptime_seconds {system_data['system_uptime_seconds']}",
        ])
    if "service_uptime_seconds" in system_data:
        lines.extend([
            "# HELP ffmpeg_gui_daemon_uptime_seconds ffmpeg-gui daemon uptime in seconds",
            "# TYPE ffmpeg_gui_daemon_uptime_seconds gauge",
            f"ffmpeg_gui_daemon_uptime_seconds {system_data['service_uptime_seconds']}",
        ])

    # 2. Thermal, Throttling & Fan Health
    cpu_health = hw_health.get("cpu", {})
    if cpu_health.get("package_temp") is not None:
        lines.extend([
            "# HELP ffmpeg_gui_cpu_package_temp_celsius CPU package temperature in degrees Celsius",
            "# TYPE ffmpeg_gui_cpu_package_temp_celsius gauge",
            f"ffmpeg_gui_cpu_package_temp_celsius {cpu_health['package_temp']}",
        ])
    if hw_health.get("max_temp_c") is not None:
        lines.extend([
            "# HELP ffmpeg_gui_system_temp_max_celsius Highest recorded hardware temperature in degrees Celsius",
            "# TYPE ffmpeg_gui_system_temp_max_celsius gauge",
            f"ffmpeg_gui_system_temp_max_celsius {hw_health['max_temp_c']}",
        ])

    throttling = cpu_health.get("throttling", {})
    if throttling:
        is_active = 1 if throttling.get("active") else 0
        total_events = throttling.get("total_package_events", 0)
        lines.extend([
            "# HELP ffmpeg_gui_cpu_throttling_active Thermal throttling actively engaged (1=active, 0=normal)",
            "# TYPE ffmpeg_gui_cpu_throttling_active gauge",
            f"ffmpeg_gui_cpu_throttling_active {is_active}",
            "# HELP ffmpeg_gui_cpu_throttling_events_total Cumulative CPU thermal throttling events",
            "# TYPE ffmpeg_gui_cpu_throttling_events_total counter",
            f"ffmpeg_gui_cpu_throttling_events_total {total_events}",
        ])

    fans = hw_health.get("fans", [])
    if fans:
        lines.extend([
            "# HELP ffmpeg_gui_fan_speed_rpm Host cooling fan rotational speed in RPM",
            "# TYPE ffmpeg_gui_fan_speed_rpm gauge",
        ])
        for idx, fan in enumerate(fans):
            f_id = escape_label_value(fan.get("id", str(idx + 1)))
            f_lbl = escape_label_value(fan.get("name") or fan.get("label") or f"Fan #{idx + 1}")
            f_rpm = fan.get("rpm", 0)
            lines.append(f'ffmpeg_gui_fan_speed_rpm{{id="{f_id}",label="{f_lbl}"}} {f_rpm}')

    # 3. Dedicated Hardware GPU Telemetry
    gpu_data = system_data.get("gpu", {})
    if gpu_data and gpu_data.get("available"):
        vendor = escape_label_value(gpu_data.get("vendor", "GPU"))
        name = escape_label_value(gpu_data.get("name", "Generic GPU"))
        gpu_labels = f'vendor="{vendor}",name="{name}"'

        util = gpu_data.get("utilization")
        if util is not None:
            lines.extend([
                "# HELP ffmpeg_gui_gpu_utilization_percent GPU core utilization percentage",
                "# TYPE ffmpeg_gui_gpu_utilization_percent gauge",
                f'ffmpeg_gui_gpu_utilization_percent{{{gpu_labels}}} {parse_metric_float(util)}',
            ])
        mem_used = gpu_data.get("memory_used")
        if mem_used is not None:
            lines.extend([
                "# HELP ffmpeg_gui_gpu_memory_used_mb GPU VRAM memory used in Megabytes",
                "# TYPE ffmpeg_gui_gpu_memory_used_mb gauge",
                f'ffmpeg_gui_gpu_memory_used_mb{{{gpu_labels}}} {parse_metric_float(mem_used)}',
            ])
        mem_total = gpu_data.get("memory_total")
        if mem_total is not None:
            lines.extend([
                "# HELP ffmpeg_gui_gpu_memory_total_mb GPU VRAM memory total capacity in Megabytes",
                "# TYPE ffmpeg_gui_gpu_memory_total_mb gauge",
                f'ffmpeg_gui_gpu_memory_total_mb{{{gpu_labels}}} {parse_metric_float(mem_total)}',
            ])
        gpu_temp = gpu_data.get("temperature")
        if gpu_temp is not None:
            lines.extend([
                "# HELP ffmpeg_gui_gpu_temp_celsius GPU temperature in degrees Celsius",
                "# TYPE ffmpeg_gui_gpu_temp_celsius gauge",
                f'ffmpeg_gui_gpu_temp_celsius{{{gpu_labels}}} {parse_metric_float(gpu_temp)}',
            ])

    # 4. Storage Pools Telemetry
    storages = telemetry.get("storages", [])
    if storages:
        lines.extend([
            "# HELP ffmpeg_gui_storage_used_gb Storage pool used space in Gigabytes",
            "# TYPE ffmpeg_gui_storage_used_gb gauge",
            "# HELP ffmpeg_gui_storage_free_gb Storage pool available space in Gigabytes",
            "# TYPE ffmpeg_gui_storage_free_gb gauge",
            "# HELP ffmpeg_gui_storage_total_gb Storage pool total capacity in Gigabytes",
            "# TYPE ffmpeg_gui_storage_total_gb gauge",
            "# HELP ffmpeg_gui_storage_usage_percent Storage pool usage percentage",
            "# TYPE ffmpeg_gui_storage_usage_percent gauge",
            "# HELP ffmpeg_gui_storage_writable Storage pool filesystem writability (1=writable, 0=read-only or error)",
            "# TYPE ffmpeg_gui_storage_writable gauge",
        ])
        for st in storages:
            st_id = escape_label_value(st.get("id"))
            st_name = escape_label_value(st.get("name"))
            st_type = escape_label_value(st.get("type"))
            lbls = f'id="{st_id}",name="{st_name}",type="{st_type}"'
            lines.append(f'ffmpeg_gui_storage_used_gb{{{lbls}}} {st.get("used_gb", 0.0)}')
            lines.append(f'ffmpeg_gui_storage_free_gb{{{lbls}}} {st.get("free_gb", 0.0)}')
            lines.append(f'ffmpeg_gui_storage_total_gb{{{lbls}}} {st.get("total_gb", 0.0)}')
            lines.append(f'ffmpeg_gui_storage_usage_percent{{{lbls}}} {st.get("percent", 0.0)}')
            lines.append(f'ffmpeg_gui_storage_writable{{{lbls}}} {1 if st.get("is_writable") else 0}')

    # 5. Scheduled Tasks Statistics
    task_stats = telemetry.get("task_stats", {})
    if task_stats:
        lines.extend([
            "# HELP ffmpeg_gui_tasks_running_count Active currently running task executions",
            "# TYPE ffmpeg_gui_tasks_running_count gauge",
            f"ffmpeg_gui_tasks_running_count {task_stats.get('active', 0)}",
            "# HELP ffmpeg_gui_tasks_scheduled_count Active automated scheduled tasks",
            "# TYPE ffmpeg_gui_tasks_scheduled_count gauge",
            f"ffmpeg_gui_tasks_scheduled_count {task_stats.get('scheduled', 0)}",
            "# HELP ffmpeg_gui_tasks_inactive_count Inactive or manual tasks",
            "# TYPE ffmpeg_gui_tasks_inactive_count gauge",
            f"ffmpeg_gui_tasks_inactive_count {task_stats.get('inactive', 0)}",
        ])

    # 6. Peer Federation Nodes
    peers = telemetry.get("peers", [])
    if peers:
        lines.extend([
            "# HELP ffmpeg_gui_peer_status Remote federated peer connectivity status (1=online, 0=offline/error)",
            "# TYPE ffmpeg_gui_peer_status gauge",
            "# HELP ffmpeg_gui_peer_latency_ms Remote federated peer round-trip latency in milliseconds",
            "# TYPE ffmpeg_gui_peer_latency_ms gauge",
        ])
        for p in peers:
            p_id = escape_label_value(p.get("id"))
            p_name = escape_label_value(p.get("name"))
            p_lbls = f'id="{p_id}",name="{p_name}"'
            p_online = 1 if p.get("status") == "online" else 0
            lines.append(f'ffmpeg_gui_peer_status{{{p_lbls}}} {p_online}')
            lat = p.get("latency_ms")
            if lat is not None:
                lines.append(f'ffmpeg_gui_peer_latency_ms{{{p_lbls}}} {parse_metric_float(lat)}')

    # 7. Media Services - Universal Core Metrics
    lines.extend([
        "# HELP ffmpeg_gui_service_status Operational status of service (1=running, 0=stopped, -1=error)",
        "# TYPE ffmpeg_gui_service_status gauge",
        "# HELP ffmpeg_gui_service_cpu_percent Service CPU usage percentage",
        "# TYPE ffmpeg_gui_service_cpu_percent gauge",
        "# HELP ffmpeg_gui_service_ram_mb Service resident RAM usage in Megabytes",
        "# TYPE ffmpeg_gui_service_ram_mb gauge",
        "# HELP ffmpeg_gui_service_uptime_seconds Service continuous uptime in seconds",
        "# TYPE ffmpeg_gui_service_uptime_seconds gauge",
        "# HELP ffmpeg_gui_service_restarts_total Service cumulative watchdog automatic restarts count",
        "# TYPE ffmpeg_gui_service_restarts_total counter",
    ])

    # Conditional metric headers
    fps_lines: List[str] = []
    bitrate_lines: List[str] = []
    speed_lines: List[str] = []
    signal_alarm_lines: List[str] = []

    # Subsystem lines
    icecast_global_lines: List[str] = []
    icecast_mount_lines: List[str] = []
    mediamtx_global_lines: List[str] = []
    mediamtx_path_lines: List[str] = []
    pipewire_lines: List[str] = []

    import datetime
    now_utc = datetime.datetime.fromtimestamp(now_utc_epoch, tz=datetime.timezone.utc) if now_utc_epoch else datetime.datetime.now(datetime.timezone.utc)

    for s in services:
        s_id = escape_label_value(s.id)
        s_name = escape_label_value((getattr(s, "alias", None) or "").strip() or s.name)
        s_type = escape_label_value(getattr(s, "service_type", "ffmpeg_stream") or "ffmpeg_stream")
        base_labels = f'id="{s_id}",name="{s_name}",type="{s_type}"'

        is_running = s.status == "running"
        status_code = 1 if is_running else (-1 if s.status == "error" else 0)
        lines.append(f"ffmpeg_gui_service_status{{{base_labels}}} {status_code}")

        cpu_val = parse_metric_float(s.cpu_usage) if is_running else 0.0
        ram_val = parse_metric_float(s.ram_usage) if is_running else 0.0
        lines.append(f"ffmpeg_gui_service_cpu_percent{{{base_labels}}} {cpu_val}")
        lines.append(f"ffmpeg_gui_service_ram_mb{{{base_labels}}} {ram_val}")

        uptime_sec = 0
        if is_running and s.last_start:
            last_start = s.last_start
            if last_start.tzinfo is None:
                last_start = last_start.replace(tzinfo=datetime.timezone.utc)
            uptime_sec = max(0, int((now_utc - last_start).total_seconds()))
        lines.append(f"ffmpeg_gui_service_uptime_seconds{{{base_labels}}} {uptime_sec}")

        restarts_count = getattr(s, "restart_count", 0) or 0
        lines.append(f"ffmpeg_gui_service_restarts_total{{{base_labels}}} {restarts_count}")

        # FFmpeg Encoding Metrics
        if s_type == "ffmpeg_stream":
            speed_val = parse_speed_ratio(s.speed) if is_running else 0.0
            speed_lines.append(f"ffmpeg_gui_service_speed_ratio{{{base_labels}}} {speed_val}")

            if service_has_video(s):
                fps_val = parse_metric_float(s.fps) if is_running else 0.0
                fps_lines.append(f"ffmpeg_gui_service_fps{{{base_labels}}} {fps_val}")

            if service_has_bitrate(s):
                bitrate_val = parse_bitrate_kbps(s.bitrate) if is_running else 0.0
                bitrate_lines.append(f"ffmpeg_gui_service_bitrate_kbps{{{base_labels}}} {bitrate_val}")

            cfg = getattr(s, "config", None) or {}
            if isinstance(cfg, str):
                try:
                    cfg = json.loads(cfg)
                except Exception:
                    cfg = {}
            sw = cfg.get("signal_watchdog", {}) if isinstance(cfg, dict) else {}
            if isinstance(sw, dict) and (sw.get("silence_enabled") or sw.get("black_enabled") or sw.get("freeze_enabled")):
                alarm_val = 0.0
                if is_running and process_manager and hasattr(process_manager, "get_signal_watchdog_state"):
                    sw_state = process_manager.get_signal_watchdog_state(s.id) or {}
                    if sw_state.get("state") in ("alarm", "recovering"):
                        alarm_val = 1.0
                signal_alarm_lines.append(f"ffmpeg_gui_service_signal_alarm{{{base_labels}}} {alarm_val}")

        # Icecast2 Server Telemetry
        elif s_type == "icecast_server":
            cfg = getattr(s, "config", {}) or {}
            if isinstance(cfg, str):
                try:
                    cfg = json.loads(cfg)
                except Exception:
                    cfg = {}
            ice_stats = cfg.get("icecast_stats", {}) if isinstance(cfg, dict) else {}

            listeners = ice_stats.get("listeners", 0) if is_running else 0
            peak = ice_stats.get("listener_peak", 0) if is_running else 0
            mounts = ice_stats.get("active_mounts", 0) if is_running else 0

            icecast_global_lines.append(f'ffmpeg_gui_icecast_listeners{{id="{s_id}",name="{s_name}"}} {listeners}')
            icecast_global_lines.append(f'ffmpeg_gui_icecast_listener_peak{{id="{s_id}",name="{s_name}"}} {peak}')
            icecast_global_lines.append(f'ffmpeg_gui_icecast_active_mounts{{id="{s_id}",name="{s_name}"}} {mounts}')

            if is_running:
                for src in ice_stats.get("sources", []):
                    if not isinstance(src, dict):
                        continue
                    m_path = escape_label_value(src.get("mount", ""))
                    m_lbls = f'id="{s_id}",name="{s_name}",mount="{m_path}"'
                    m_listeners = src.get("listeners", 0) or 0
                    m_peak = src.get("peak", 0) or 0
                    icecast_mount_lines.append(f"ffmpeg_gui_icecast_mount_listeners{{{m_lbls}}} {m_listeners}")
                    icecast_mount_lines.append(f"ffmpeg_gui_icecast_mount_peak{{{m_lbls}}} {m_peak}")
                    m_br = parse_bitrate_kbps(src.get("bitrate", 0))
                    if m_br > 0:
                        icecast_mount_lines.append(f"ffmpeg_gui_icecast_mount_bitrate_kbps{{{m_lbls}}} {m_br}")

        # MediaMTX Hub Telemetry
        elif s_type == "mediamtx_hub":
            mtx_stats: Dict[str, Any] = {}
            if is_running and process_manager and hasattr(process_manager, "get_mediamtx_telemetry_cached"):
                mtx_stats = process_manager.get_mediamtx_telemetry_cached(s.id) or {}

            items = mtx_stats.get("items", []) if is_running else []
            paths_total = len(items)
            paths_ready = sum(1 for it in items if isinstance(it, dict) and it.get("ready"))

            mediamtx_global_lines.append(f'ffmpeg_gui_mediamtx_paths_total{{id="{s_id}",name="{s_name}"}} {paths_total}')
            mediamtx_global_lines.append(f'ffmpeg_gui_mediamtx_paths_ready{{id="{s_id}",name="{s_name}"}} {paths_ready}')

            if is_running:
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    p_name = escape_label_value(item.get("name", ""))
                    p_lbls = f'id="{s_id}",name="{s_name}",path="{p_name}"'
                    p_ready = 1 if item.get("ready") else 0
                    readers_val = item.get("readers")
                    readers = len(readers_val) if isinstance(readers_val, list) else (int(readers_val) if isinstance(readers_val, (int, float)) else 0)
                    bytes_rx = int(item.get("bytesReceived") or 0)
                    bytes_tx = int(item.get("bytesSent") or 0)

                    mediamtx_path_lines.append(f"ffmpeg_gui_mediamtx_path_ready{{{p_lbls}}} {p_ready}")
                    mediamtx_path_lines.append(f"ffmpeg_gui_mediamtx_path_readers{{{p_lbls}}} {readers}")
                    mediamtx_path_lines.append(f"ffmpeg_gui_mediamtx_path_bytes_received_total{{{p_lbls}}} {bytes_rx}")
                    mediamtx_path_lines.append(f"ffmpeg_gui_mediamtx_path_bytes_sent_total{{{p_lbls}}} {bytes_tx}")

        # PipeWire Hub Telemetry
        elif s_type == "pipewire_hub":
            cfg = getattr(s, "config", {}) or {}
            if isinstance(cfg, str):
                try:
                    cfg = json.loads(cfg)
                except Exception:
                    cfg = {}
            pw_cfg = cfg.get("pipewire_config") or cfg if isinstance(cfg, dict) else {}
            v_sinks = len(pw_cfg.get("virtual_sinks", []))
            r_sinks = len(pw_cfg.get("remote_sinks", []))

            pipewire_lines.append(f'ffmpeg_gui_pipewire_virtual_sinks_count{{id="{s_id}",name="{s_name}"}} {v_sinks}')
            pipewire_lines.append(f'ffmpeg_gui_pipewire_remote_sinks_count{{id="{s_id}",name="{s_name}"}} {r_sinks}')

            sidecars = {"ptp4l": False, "phc2sys": False, "sap": False}
            if is_running and process_manager and hasattr(process_manager, "_get_pipewire_sidecar_status"):
                try:
                    raw_sc = process_manager._get_pipewire_sidecar_status(s.id)
                    sidecars["ptp4l"] = bool(raw_sc.get("ptp4l_active"))
                    sidecars["phc2sys"] = bool(raw_sc.get("phc2sys_active"))
                    sidecars["sap"] = bool(raw_sc.get("sap_active"))
                except Exception:
                    pass

            for sc_name, sc_active in sidecars.items():
                sc_val = 1 if (is_running and sc_active) else 0
                sc_lbls = f'id="{s_id}",name="{s_name}",sidecar="{sc_name}"'
                pipewire_lines.append(f"ffmpeg_gui_pipewire_sidecar_active{{{sc_lbls}}} {sc_val}")

    # Append conditional FFmpeg metrics if any emitted
    if speed_lines:
        lines.extend([
            "# HELP ffmpeg_gui_service_speed_ratio Service encoding speed ratio relative to real-time",
            "# TYPE ffmpeg_gui_service_speed_ratio gauge",
        ] + speed_lines)
    if fps_lines:
        lines.extend([
            "# HELP ffmpeg_gui_service_fps Service encoding frames per second",
            "# TYPE ffmpeg_gui_service_fps gauge",
        ] + fps_lines)
    if bitrate_lines:
        lines.extend([
            "# HELP ffmpeg_gui_service_bitrate_kbps Service output stream bitrate in kbps",
            "# TYPE ffmpeg_gui_service_bitrate_kbps gauge",
        ] + bitrate_lines)
    if signal_alarm_lines:
        lines.extend([
            "# HELP ffmpeg_gui_service_signal_alarm In-band signal watchdog alarm active (1=alarm/recovering, 0=normal)",
            "# TYPE ffmpeg_gui_service_signal_alarm gauge",
        ] + signal_alarm_lines)

    # Append Icecast metrics if any emitted
    if icecast_global_lines:
        lines.extend([
            "# HELP ffmpeg_gui_icecast_listeners Total active connected listeners across all mounts",
            "# TYPE ffmpeg_gui_icecast_listeners gauge",
            "# HELP ffmpeg_gui_icecast_listener_peak Highest historical peak of listeners",
            "# TYPE ffmpeg_gui_icecast_listener_peak gauge",
            "# HELP ffmpeg_gui_icecast_active_mounts Number of active stream mountpoints",
            "# TYPE ffmpeg_gui_icecast_active_mounts gauge",
        ] + icecast_global_lines)
    if icecast_mount_lines:
        lines.extend([
            "# HELP ffmpeg_gui_icecast_mount_listeners Connected listeners on specific mountpoint",
            "# TYPE ffmpeg_gui_icecast_mount_listeners gauge",
            "# HELP ffmpeg_gui_icecast_mount_peak Peak listeners on specific mountpoint",
            "# TYPE ffmpeg_gui_icecast_mount_peak gauge",
            "# HELP ffmpeg_gui_icecast_mount_bitrate_kbps Stream bitrate reported by mountpoint source",
            "# TYPE ffmpeg_gui_icecast_mount_bitrate_kbps gauge",
        ] + icecast_mount_lines)

    # Append MediaMTX metrics if any emitted
    if mediamtx_global_lines:
        lines.extend([
            "# HELP ffmpeg_gui_mediamtx_paths_total Total registered streaming paths on MediaMTX hub",
            "# TYPE ffmpeg_gui_mediamtx_paths_total gauge",
            "# HELP ffmpeg_gui_mediamtx_paths_ready Streaming paths with active publishing publisher ready",
            "# TYPE ffmpeg_gui_mediamtx_paths_ready gauge",
        ] + mediamtx_global_lines)
    if mediamtx_path_lines:
        lines.extend([
            "# HELP ffmpeg_gui_mediamtx_path_ready MediaMTX path publisher readiness state (1=ready, 0=waiting)",
            "# TYPE ffmpeg_gui_mediamtx_path_ready gauge",
            "# HELP ffmpeg_gui_mediamtx_path_readers Number of client consumers reading from path",
            "# TYPE ffmpeg_gui_mediamtx_path_readers gauge",
            "# HELP ffmpeg_gui_mediamtx_path_bytes_received_total Cumulative bytes received by MediaMTX for path",
            "# TYPE ffmpeg_gui_mediamtx_path_bytes_received_total counter",
            "# HELP ffmpeg_gui_mediamtx_path_bytes_sent_total Cumulative bytes sent by MediaMTX to readers of path",
            "# TYPE ffmpeg_gui_mediamtx_path_bytes_sent_total counter",
        ] + mediamtx_path_lines)

    # Append PipeWire metrics if any emitted
    if pipewire_lines:
        lines.extend([
            "# HELP ffmpeg_gui_pipewire_virtual_sinks_count Configured PipeWire local virtual audio sinks",
            "# TYPE ffmpeg_gui_pipewire_virtual_sinks_count gauge",
            "# HELP ffmpeg_gui_pipewire_remote_sinks_count Configured PipeWire AoIP remote AES67/RTP sinks",
            "# TYPE ffmpeg_gui_pipewire_remote_sinks_count gauge",
            "# HELP ffmpeg_gui_pipewire_sidecar_active Clock and discovery sidecar status (1=active, 0=inactive)",
            "# TYPE ffmpeg_gui_pipewire_sidecar_active gauge",
        ] + pipewire_lines)

    return "\n".join(lines) + "\n"
