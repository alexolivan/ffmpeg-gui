import pytest
from starlette.testclient import TestClient
from main import app
from database.db import SessionLocal
from database.models import SystemSettings, Service
from core.prometheus_exporter import (
    escape_label_value,
    service_has_video,
    service_has_bitrate,
    build_openmetrics_payload,
)


@pytest.fixture
def client():
    return TestClient(app)


def test_escape_label_value():
    assert escape_label_value('hello "world"') == 'hello \\"world\\"'
    assert escape_label_value('back\\slash') == 'back\\\\slash'
    assert escape_label_value('line\nbreak') == 'line\\nbreak'
    assert escape_label_value(None) == ''
    assert escape_label_value(123) == '123'


def test_service_capability_classifiers():
    # 1. Normal video + audio stream
    s_video = Service(
        service_type="ffmpeg_stream",
        codec_config={"vcodec": "libx264", "acodec": "aac"},
        output_config={"type": "srt"}
    )
    assert service_has_video(s_video) is True
    assert service_has_bitrate(s_video) is True

    # 2. Audio-only stream with vcodec="none"
    s_audio_none = Service(
        service_type="ffmpeg_stream",
        codec_config={"vcodec": "none", "acodec": "aac"},
        output_config={"type": "icecast"}
    )
    assert service_has_video(s_audio_none) is False
    assert service_has_bitrate(s_audio_none) is True

    # 3. Audio-only stream with alsa input
    s_alsa_in = Service(
        service_type="ffmpeg_stream",
        input_config={"type": "alsa", "has_video": False},
        output_config={"type": "rtmp"}
    )
    assert service_has_video(s_alsa_in) is False

    # 4. Baseband output (DeckLink or PipeWire) with bitrate="N/A"
    s_decklink = Service(
        service_type="ffmpeg_stream",
        codec_config={"vcodec": "rawvideo"},
        output_config={"type": "decklink"},
        bitrate="N/A"
    )
    assert service_has_video(s_decklink) is True
    assert service_has_bitrate(s_decklink) is False

    # 5. Auxiliary services (Icecast, MediaMTX, PipeWire, Desktop, Kiosk)
    for aux_type in ("icecast_server", "mediamtx_hub", "pipewire_hub", "desktop", "kiosk_browser"):
        s_aux = Service(service_type=aux_type, config={})
        assert service_has_video(s_aux) is False
        assert service_has_bitrate(s_aux) is False


def test_build_openmetrics_payload_semantic_separation():
    # Construct mock services
    s_video = Service(
        id=1,
        name='Main "HD" Channel',
        service_type="ffmpeg_stream",
        status="running",
        cpu_usage=12.5,
        ram_usage=450.0,
        fps=50.0,
        bitrate="4500kbits/s",
        speed="1.02x",
        restart_count=2,
        codec_config={"vcodec": "libx264", "acodec": "aac"},
        output_config={"type": "srt"}
    )

    s_audio = Service(
        id=2,
        name="Radio Live",
        service_type="ffmpeg_stream",
        status="running",
        cpu_usage=1.5,
        ram_usage=25.0,
        fps="N/A",
        bitrate="128 kb/s",
        speed="1.00x",
        restart_count=0,
        codec_config={"vcodec": "none", "acodec": "libmp3lame"},
        output_config={"type": "icecast"}
    )

    s_decklink = Service(
        id=3,
        name="DeckLink Playout",
        service_type="ffmpeg_stream",
        status="running",
        cpu_usage=18.0,
        ram_usage=800.0,
        fps=50.0,
        bitrate="N/A",
        speed="1.00x",
        restart_count=1,
        codec_config={"vcodec": "rawvideo"},
        output_config={"type": "decklink"}
    )

    s_icecast = Service(
        id=4,
        name="Icecast Master",
        service_type="icecast_server",
        status="running",
        cpu_usage=0.2,
        ram_usage=15.0,
        config={
            "icecast_stats": {
                "listeners": 150,
                "listener_peak": 320,
                "active_mounts": 2,
                "sources": [
                    {"mount": "/live.mp3", "listeners": 100, "peak": 200, "bitrate": 128},
                    {"mount": "/hq.flac", "listeners": 50, "peak": 120, "bitrate": 0}
                ]
            }
        }
    )

    s_mediamtx = Service(
        id=5,
        name="MediaMTX Edge",
        service_type="mediamtx_hub",
        status="running",
        cpu_usage=0.5,
        ram_usage=30.0,
        config={"mediamtx_config": {"api_port": 9997}}
    )

    s_pipewire = Service(
        id=6,
        name="PipeWire MST",
        service_type="pipewire_hub",
        status="running",
        cpu_usage=0.8,
        ram_usage=45.0,
        config={
            "pipewire_config": {
                "virtual_sinks": [{"id": "mix1"}],
                "remote_sinks": [{"id": "aes67_1"}, {"id": "aes67_2"}]
            }
        }
    )

    class MockPM:
        def get_mediamtx_telemetry_cached(self, pid):
            if pid == 5:
                return {
                    "items": [
                        {"name": "cam1", "ready": True, "readers": 12, "bytesReceived": 1048576, "bytesSent": 5242880},
                        {"name": "cam2", "ready": False, "readers": 0, "bytesReceived": 0, "bytesSent": 0}
                    ]
                }
            return {}

        def _get_pipewire_sidecar_status(self, pid):
            if pid == 6:
                return {"ptp4l_active": True, "phc2sys_active": True, "sap_active": False}
            return {}

    telemetry_snap = {
        "system": {
            "cpu": 8.5,
            "ram_used": 2048,
            "ram_total": 16384,
            "system_uptime_seconds": 120000,
            "service_uptime_seconds": 36000,
            "gpu": {
                "available": True,
                "vendor": "NVIDIA",
                "name": "RTX 4000",
                "utilization": 22.0,
                "memory_used": 1024,
                "memory_total": 8192,
                "temperature": 48.0
            }
        },
        "storages": [
            {"id": 1, "name": "Storage NVMe", "type": "local", "used_gb": 120.5, "free_gb": 380.0, "total_gb": 500.5, "percent": 24.1, "is_writable": True}
        ],
        "task_stats": {"active": 1, "scheduled": 4, "inactive": 2},
        "peers": [
            {"id": 1, "name": "Node-Backup", "status": "online", "latency_ms": 1.45}
        ]
    }

    hw_health = {
        "max_temp_c": 52.0,
        "cpu": {
            "package_temp": 49.5,
            "throttling": {"active": False, "total_package_events": 0}
        },
        "fans": [{"id": "1", "label": "CPU Fan", "rpm": 1450}]
    }

    payload = build_openmetrics_payload(
        services=[s_video, s_audio, s_decklink, s_icecast, s_mediamtx, s_pipewire],
        telemetry_snapshot=telemetry_snap,
        hardware_health=hw_health,
        process_manager=MockPM()
    )

    # Assertions on label escaping
    assert 'name="Main \\"HD\\" Channel"' in payload

    # Assertions on Core Services
    assert 'ffmpeg_gui_service_status{id="1",name="Main \\"HD\\" Channel",type="ffmpeg_stream"} 1' in payload
    assert 'ffmpeg_gui_service_ram_mb{id="1",name="Main \\"HD\\" Channel",type="ffmpeg_stream"} 450' in payload
    assert 'ffmpeg_gui_service_restarts_total{id="1",name="Main \\"HD\\" Channel",type="ffmpeg_stream"} 2' in payload

    # Assertions on FFmpeg video/bitrate/speed filtering:
    # 1. Video service has fps, bitrate, speed
    assert 'ffmpeg_gui_service_fps{id="1",name="Main \\"HD\\" Channel",type="ffmpeg_stream"} 50' in payload
    assert 'ffmpeg_gui_service_bitrate_kbps{id="1",name="Main \\"HD\\" Channel",type="ffmpeg_stream"} 4500' in payload
    assert 'ffmpeg_gui_service_speed_ratio{id="1",name="Main \\"HD\\" Channel",type="ffmpeg_stream"} 1.02' in payload

    # 2. Audio service has bitrate & speed, BUT NO FPS
    assert 'id="2",name="Radio Live",type="ffmpeg_stream"} 128' in payload
    assert 'ffmpeg_gui_service_fps{id="2",name="Radio Live"' not in payload

    # 3. DeckLink baseband service has fps & speed, BUT NO BITRATE
    assert 'ffmpeg_gui_service_fps{id="3",name="DeckLink Playout",type="ffmpeg_stream"} 50' in payload
    assert 'ffmpeg_gui_service_bitrate_kbps{id="3",name="DeckLink Playout"' not in payload

    # 4. Auxiliary services have NO fps, NO bitrate, NO speed
    for aux_id in ("4", "5", "6"):
        assert f'ffmpeg_gui_service_fps{{id="{aux_id}"' not in payload
        assert f'ffmpeg_gui_service_bitrate_kbps{{id="{aux_id}"' not in payload
        assert f'ffmpeg_gui_service_speed_ratio{{id="{aux_id}"' not in payload

    # Assertions on Icecast metrics
    assert 'ffmpeg_gui_icecast_listeners{id="4",name="Icecast Master"} 150' in payload
    assert 'ffmpeg_gui_icecast_listener_peak{id="4",name="Icecast Master"} 320' in payload
    assert 'ffmpeg_gui_icecast_active_mounts{id="4",name="Icecast Master"} 2' in payload
    assert 'ffmpeg_gui_icecast_mount_listeners{id="4",name="Icecast Master",mount="/live.mp3"} 100' in payload
    assert 'ffmpeg_gui_icecast_mount_bitrate_kbps{id="4",name="Icecast Master",mount="/live.mp3"} 128' in payload
    assert 'ffmpeg_gui_icecast_mount_listeners{id="4",name="Icecast Master",mount="/hq.flac"} 50' in payload

    # Assertions on MediaMTX metrics
    assert 'ffmpeg_gui_mediamtx_paths_total{id="5",name="MediaMTX Edge"} 2' in payload
    assert 'ffmpeg_gui_mediamtx_paths_ready{id="5",name="MediaMTX Edge"} 1' in payload
    assert 'ffmpeg_gui_mediamtx_path_ready{id="5",name="MediaMTX Edge",path="cam1"} 1' in payload
    assert 'ffmpeg_gui_mediamtx_path_readers{id="5",name="MediaMTX Edge",path="cam1"} 12' in payload
    assert 'ffmpeg_gui_mediamtx_path_bytes_received_total{id="5",name="MediaMTX Edge",path="cam1"} 1048576' in payload

    # Assertions on PipeWire metrics
    assert 'ffmpeg_gui_pipewire_virtual_sinks_count{id="6",name="PipeWire MST"} 1' in payload
    assert 'ffmpeg_gui_pipewire_remote_sinks_count{id="6",name="PipeWire MST"} 2' in payload
    assert 'ffmpeg_gui_pipewire_sidecar_active{id="6",name="PipeWire MST",sidecar="ptp4l"} 1' in payload
    assert 'ffmpeg_gui_pipewire_sidecar_active{id="6",name="PipeWire MST",sidecar="sap"} 0' in payload

    # Assertions on Host, GPU, Thermal, Storage, Tasks, Peers
    assert 'ffmpeg_gui_system_cpu_percent 8.5' in payload
    assert 'ffmpeg_gui_system_ram_used_mb 2048' in payload
    assert 'ffmpeg_gui_system_uptime_seconds 120000' in payload
    assert 'ffmpeg_gui_cpu_package_temp_celsius 49.5' in payload
    assert 'ffmpeg_gui_fan_speed_rpm{id="1",label="CPU Fan"} 1450' in payload
    assert 'ffmpeg_gui_gpu_utilization_percent{vendor="NVIDIA",name="RTX 4000"} 22' in payload
    assert 'ffmpeg_gui_storage_used_gb{id="1",name="Storage NVMe",type="local"} 120.5' in payload
    assert 'ffmpeg_gui_tasks_running_count 1' in payload
    assert 'ffmpeg_gui_peer_status{id="1",name="Node-Backup"} 1' in payload
    assert 'ffmpeg_gui_peer_latency_ms{id="1",name="Node-Backup"} 1.45' in payload


def test_prometheus_metrics_disabled(client):
    with SessionLocal() as db:
        settings = db.query(SystemSettings).first()
        if not settings:
            settings = SystemSettings()
            db.add(settings)
        settings.metrics_exporter_enabled = False
        db.commit()

    resp = client.get("/api/metrics")
    assert resp.status_code == 404

    resp_root = client.get("/metrics")
    assert resp_root.status_code == 404


def test_prometheus_metrics_auth_and_ip_validation(client):
    with SessionLocal() as db:
        settings = db.query(SystemSettings).first()
        if not settings:
            settings = SystemSettings()
            db.add(settings)
        settings.metrics_exporter_enabled = True
        settings.metrics_exporter_token = "secret_metrics_token_999"
        settings.metrics_exporter_allowed_ips = "127.0.0.1, 10.0.0.0/8"
        db.commit()

    # 1. Missing token -> 401
    resp = client.get("/api/metrics")
    assert resp.status_code == 401

    # 2. Invalid token -> 401
    resp = client.get("/api/metrics?token=wrong_token")
    assert resp.status_code == 401

    # 3. Valid token query param, client IP 127.0.0.1 -> 200
    resp = client.get("/api/metrics?token=secret_metrics_token_999")
    assert resp.status_code == 200
    assert "version=0.0.4" in resp.headers["content-type"]
    assert "ffmpeg_gui_system_cpu_percent" in resp.text

    # 4. Valid Bearer header -> 200
    resp = client.get(
        "/api/metrics",
        headers={"Authorization": "Bearer secret_metrics_token_999"}
    )
    assert resp.status_code == 200

    # 5. IP restriction check with forbidden IP
    with SessionLocal() as db:
        settings = db.query(SystemSettings).first()
        settings.metrics_exporter_allowed_ips = "192.168.200.1"  # Not 127.0.0.1
        db.commit()

    resp = client.get(
        "/api/metrics",
        headers={"Authorization": "Bearer secret_metrics_token_999"}
    )
    assert resp.status_code == 403


def test_prometheus_metrics_service_gauges(client):
    with SessionLocal() as db:
        settings = db.query(SystemSettings).first()
        settings.metrics_exporter_enabled = True
        settings.metrics_exporter_token = "my_token"
        settings.metrics_exporter_allowed_ips = None

        # Add test running video service
        svc = Service(
            name="Exporter Stream Test",
            service_type="ffmpeg_stream",
            status="running",
            config={},
            codec_config={"vcodec": "libx264", "acodec": "aac"},
            output_config={"type": "srt"},
            cpu_usage=18.5,
            ram_usage=95.0,
            bitrate=4500.0,
            fps=50.0,
            speed=1.002,
        )
        # Add test audio-only PCM service (no fps, no bitrate)
        svc_na = Service(
            name="Audio Only PCM Service",
            service_type="ffmpeg_stream",
            status="running",
            config={},
            codec_config={"vcodec": "none", "acodec": "pcm_s16le"},
            output_config={"type": "pipewire"},
            cpu_usage=5.0,
            ram_usage=40.0,
            bitrate="N/A",
            fps="N/A",
            speed="1.0x",
        )
        db.add(svc)
        db.add(svc_na)
        db.commit()
        db.refresh(svc)
        db.refresh(svc_na)
        svc_id = svc.id
        svc_na_id = svc_na.id

    try:
        resp = client.get("/api/metrics?token=my_token")
        assert resp.status_code == 200
        text = resp.text

        assert f'ffmpeg_gui_service_status{{id="{svc_id}",name="Exporter Stream Test",type="ffmpeg_stream"}} 1' in text
        assert f'ffmpeg_gui_service_bitrate_kbps{{id="{svc_id}",name="Exporter Stream Test",type="ffmpeg_stream"}} 4500' in text
        assert f'ffmpeg_gui_service_fps{{id="{svc_id}",name="Exporter Stream Test",type="ffmpeg_stream"}} 50' in text
        assert f'ffmpeg_gui_service_ram_mb{{id="{svc_id}",name="Exporter Stream Test",type="ffmpeg_stream"}} 95' in text

        # Verify audio-only service has NO fps and NO bitrate emitted
        assert f'ffmpeg_gui_service_fps{{id="{svc_na_id}"' not in text
        assert f'ffmpeg_gui_service_bitrate_kbps{{id="{svc_na_id}"' not in text
        # But DOES have speed_ratio and status
        assert f'ffmpeg_gui_service_speed_ratio{{id="{svc_na_id}",name="Audio Only PCM Service",type="ffmpeg_stream"}} 1' in text

    finally:
        with SessionLocal() as db:
            db.query(Service).filter(Service.id.in_([svc_id, svc_na_id])).delete()
            db.commit()


def test_prometheus_metrics_with_gui_password_configured(client):
    from main import _AUTH_PW_CACHE
    with SessionLocal() as db:
        settings = db.query(SystemSettings).first()
        if not settings:
            settings = SystemSettings()
            db.add(settings)
        settings.metrics_exporter_enabled = True
        settings.metrics_exporter_token = "metrics_secret_tok"
        settings.metrics_exporter_allowed_ips = None
        settings.gui_password = "admin_super_secret_gui_password"
        db.commit()

    _AUTH_PW_CACHE["password"] = "admin_super_secret_gui_password"
    _AUTH_PW_CACHE["timestamp"] = 99999999999.0

    try:
        # Scraper requesting with metrics bearer token must pass through AuthBarrierMiddleware
        resp = client.get(
            "/metrics",
            headers={"Authorization": "Bearer metrics_secret_tok"}
        )
        assert resp.status_code == 200
        assert "ffmpeg_gui_system_cpu_percent" in resp.text

        # Invalid metrics token must return 401 from get_prometheus_metrics with specific detail
        resp_invalid = client.get(
            "/metrics",
            headers={"Authorization": "Bearer bad_tok"}
        )
        assert resp_invalid.status_code == 401
        assert "Unauthorized metrics access" in resp_invalid.json().get("detail", "")
    finally:
        with SessionLocal() as db:
            settings = db.query(SystemSettings).first()
            if settings:
                settings.gui_password = None
                db.commit()
        _AUTH_PW_CACHE["password"] = None
        _AUTH_PW_CACHE["timestamp"] = 0.0
