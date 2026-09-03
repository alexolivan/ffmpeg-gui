import os
import configparser
from typing import Dict, List, Optional, Set, Tuple
from fastapi import HTTPException
from sqlalchemy.orm import Session
from database.models import Service

def get_gui_reserved_ports() -> Set[int]:
    gui_ports = {int(os.environ.get("ACTIVE_PORT", 8000))}
    config_path = os.environ.get("CONFIG_FILE_PATH")
    if config_path and os.path.exists(config_path):
        try:
            config = configparser.ConfigParser()
            config.read(config_path)
            if "server" in config and "port" in config["server"]:
                gui_ports.add(int(config["server"]["port"]))
        except Exception:
            pass
    return gui_ports

def extract_ports_from_service(
    service_id: Optional[int],
    service_name: str,
    service_type: str,
    config: Optional[dict],
    input_config: Optional[dict],
    output_config: Optional[dict]
) -> List[Tuple[int, str, str, Optional[int], str]]:
    """
    Extracts all active listening ports from a service configuration.
    Returns tuples of (port_number, port_label, service_name, service_id, protocol).
    Protocol is 'tcp' or 'udp'.
    """
    ports = []
    cfg = config or {}
    s_type = service_type or "ffmpeg_stream"

    if s_type == "mediamtx_hub":
        mtx = cfg.get("mediamtx_config", cfg)
        if mtx.get("rtmp_enabled", True) and mtx.get("rtmp_port"):
            try: ports.append((int(mtx["rtmp_port"]), "RTMP", service_name, service_id, "tcp"))
            except (ValueError, TypeError): pass

        if mtx.get("rtmps_enabled", False):
            if mtx.get("rtmps_port"):
                try: ports.append((int(mtx["rtmps_port"]), "RTMPS", service_name, service_id, "tcp"))
                except (ValueError, TypeError): pass
            else:
                ports.append((1936, "RTMPS (Default)", service_name, service_id, "tcp"))
        elif mtx.get("rtmps_port") and mtx.get("rtmps_enabled") is not False:
            try: ports.append((int(mtx["rtmps_port"]), "RTMPS", service_name, service_id, "tcp"))
            except (ValueError, TypeError): pass

        if mtx.get("rtsp_enabled", True):
            if mtx.get("rtsp_port"):
                try: ports.append((int(mtx["rtsp_port"]), "RTSP", service_name, service_id, "tcp"))
                except (ValueError, TypeError): pass
            if mtx.get("rtp_port"):
                try: ports.append((int(mtx["rtp_port"]), "RTP (RTSP UDP)", service_name, service_id, "udp"))
                except (ValueError, TypeError): pass
            else:
                ports.append((8000, "RTP (RTSP UDP Default)", service_name, service_id, "udp"))
            if mtx.get("rtcp_port"):
                try: ports.append((int(mtx["rtcp_port"]), "RTCP (RTSP UDP)", service_name, service_id, "udp"))
                except (ValueError, TypeError): pass
            else:
                ports.append((8001, "RTCP (RTSP UDP Default)", service_name, service_id, "udp"))

        if mtx.get("rtsps_enabled", False):
            if mtx.get("rtsps_port"):
                try: ports.append((int(mtx["rtsps_port"]), "RTSPS", service_name, service_id, "tcp"))
                except (ValueError, TypeError): pass
            else:
                ports.append((8322, "RTSPS (Default)", service_name, service_id, "tcp"))
        elif mtx.get("rtsps_port") and mtx.get("rtsps_enabled") is not False:
            try: ports.append((int(mtx["rtsps_port"]), "RTSPS", service_name, service_id, "tcp"))
            except (ValueError, TypeError): pass

        if mtx.get("hls_enabled", True) and mtx.get("hls_port"):
            try: ports.append((int(mtx["hls_port"]), "HLS", service_name, service_id, "tcp"))
            except (ValueError, TypeError): pass

        if mtx.get("webrtc_enabled", False):
            if mtx.get("webrtc_port"):
                try: ports.append((int(mtx["webrtc_port"]), "WebRTC Signaling (HTTP/WHEP)", service_name, service_id, "tcp"))
                except (ValueError, TypeError): pass
            else:
                ports.append((8889, "WebRTC Signaling (HTTP Default)", service_name, service_id, "tcp"))

            if mtx.get("webrtc_udp_port"):
                try: ports.append((int(mtx["webrtc_udp_port"]), "WebRTC Media (UDP ICE)", service_name, service_id, "udp"))
                except (ValueError, TypeError): pass
            else:
                ports.append((8189, "WebRTC Media (UDP ICE Default)", service_name, service_id, "udp"))

        if mtx.get("srt_enabled", False) and mtx.get("srt_port"):
            try: ports.append((int(mtx["srt_port"]), "SRT", service_name, service_id, "udp"))
            except (ValueError, TypeError): pass

        if mtx.get("api_enabled", True):
            api_p = mtx.get("api_port", 9997)
            try: ports.append((int(api_p), "MediaMTX Control API", service_name, service_id, "tcp"))
            except (ValueError, TypeError): pass

    elif s_type == "icecast_server":
        ice = cfg.get("icecast_config", cfg)
        if ice.get("http_enabled", True) and ice.get("port"):
            try: ports.append((int(ice["port"]), "Icecast HTTP", service_name, service_id, "tcp"))
            except (ValueError, TypeError): pass
        elif ice.get("port") and ice.get("http_enabled") is not False:
            try: ports.append((int(ice["port"]), "Icecast HTTP", service_name, service_id, "tcp"))
            except (ValueError, TypeError): pass

        if ice.get("ssl_enabled", False):
            if ice.get("ssl_port"):
                try: ports.append((int(ice["ssl_port"]), "Icecast HTTPS/TLS", service_name, service_id, "tcp"))
                except (ValueError, TypeError): pass
            else:
                ports.append((7443, "Icecast HTTPS/TLS (Default)", service_name, service_id, "tcp"))
        elif ice.get("ssl_port") and ice.get("ssl_enabled") is not False:
            try: ports.append((int(ice["ssl_port"]), "Icecast HTTPS/TLS", service_name, service_id, "tcp"))
            except (ValueError, TypeError): pass

    elif s_type == "ffmpeg_stream":
        # Check inputs that are listeners (e.g. SRT listener, UDP listener, TCP listener)
        inputs = []
        if isinstance(input_config, dict):
            for k in ["input1", "input2"]:
                if k in input_config and isinstance(input_config[k], dict):
                    inputs.append(input_config[k])
            if not inputs and "type" in input_config:
                inputs.append(input_config)

        for inp in inputs:
            mode = inp.get("mode")
            inp_type = str(inp.get("type", "")).lower()
            port = inp.get("port")
            if port:
                try:
                    p_num = int(port)
                    proto = "udp" if inp_type in ["udp", "rtp", "srt"] else ("tcp" if inp_type in ["tcp", "http", "https"] else "any")
                    if mode == "listener" or inp_type in ["udp", "rtp", "tcp", "http"]:
                        ports.append((p_num, f"FFmpeg In ({inp_type.upper()})", service_name, service_id, proto))
                except (ValueError, TypeError):
                    pass

        # Check outputs that might be listeners (e.g. SRT listener output)
        outputs = []
        if isinstance(output_config, list):
            outputs.extend(output_config)
        elif isinstance(output_config, dict):
            outputs.append(output_config)

        for out in outputs:
            if isinstance(out, dict) and out.get("mode") == "listener" and out.get("port"):
                out_type = str(out.get("type", "")).lower()
                proto = "udp" if out_type in ["udp", "rtp", "srt"] else ("tcp" if out_type in ["tcp", "http", "https"] else "any")
                try:
                    ports.append((int(out["port"]), f"FFmpeg Out Listener ({out_type.upper()})", service_name, service_id, proto))
                except (ValueError, TypeError):
                    pass

    return ports

def validate_service_port_conflicts(
    db: Session,
    service_id: Optional[int],
    service_name: str,
    service_type: str,
    config: Optional[dict],
    input_config: Optional[dict],
    output_config: Optional[dict]
):
    """
    Validates that no port in the target service collides with:
    1. The GUI web panel port (TCP).
    2. Any port already allocated to another service with the same protocol in SQLite.
    Raises HTTPException(400) on conflict.
    """
    target_ports = extract_ports_from_service(
        service_id=service_id,
        service_name=service_name,
        service_type=service_type,
        config=config,
        input_config=input_config,
        output_config=output_config
    )

    if not target_ports:
        return

    gui_reserved_tcp = get_gui_reserved_ports()
    for port, label, _, _, proto in target_ports:
        if proto in ["tcp", "any"] and port in gui_reserved_tcp:
            raise HTTPException(
                status_code=400,
                detail=f"Port {port}/{proto.upper()} ({label}) is reserved for the ffmpeg-gui web panel."
            )

    # Check internal collisions within the same service payload
    seen_in_payload = {}
    for port, label, _, _, proto in target_ports:
        key = (port, proto)
        if key in seen_in_payload:
            raise HTTPException(
                status_code=400,
                detail=f"Internal port conflict: Port {port}/{proto.upper()} is defined multiple times ({seen_in_payload[key]} and {label})."
            )
        seen_in_payload[key] = label

    # Check against other services in database
    other_services = db.query(Service).filter(Service.id != service_id).all() if service_id else db.query(Service).all()
    
    for other in other_services:
        other_ports = extract_ports_from_service(
            service_id=other.id,
            service_name=other.name,
            service_type=getattr(other, "service_type", "ffmpeg_stream"),
            config=other.config,
            input_config=other.input_config,
            output_config=other.output_config
        )
        for other_p, other_label, other_name, other_id, other_proto in other_ports:
            for port, label, _, _, proto in target_ports:
                if port == other_p and (proto == other_proto or proto == "any" or other_proto == "any"):
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Port collision: Port {port}/{proto.upper()} ({label}) is already in use by "
                            f"service '{other_name}' (ID: {other_id}, {other_label} [{other_proto.upper()}])."
                        )
                    )

def get_next_available_mediamtx_ports(db: Session, exclude_service_id: Optional[int] = None) -> Dict[str, int]:
    """
    Computes a clean, non-conflicting set of ports for a new or cloned MediaMTX hub.
    Scans existing services and increments offsets until all ports are conflict-free.
    """
    gui_reserved_tcp = get_gui_reserved_ports()
    other_services = db.query(Service).filter(Service.id != exclude_service_id).all() if exclude_service_id else db.query(Service).all()
    
    occupied_ports = set((p, "tcp") for p in gui_reserved_tcp)
    for other in other_services:
        for p, _, _, _, proto in extract_ports_from_service(
            service_id=other.id,
            service_name=other.name,
            service_type=getattr(other, "service_type", "ffmpeg_stream"),
            config=other.config,
            input_config=other.input_config,
            output_config=other.output_config
        ):
            occupied_ports.add((p, proto))

    # Base port definitions
    base_rtmp = 1935
    base_rtmps = 1936
    base_rtsp = 8554
    base_rtsps = 8322
    base_rtp = 8000
    base_rtcp = 8001
    base_hls = 8888
    base_webrtc = 8889
    base_webrtc_udp = 8189
    base_srt = 8890
    base_api = 9997

    # Try offset 0, 1, 2, 3...
    for offset in range(50):
        cand_rtmp = base_rtmp + (offset * 10)
        cand_rtmps = base_rtmps + (offset * 10)
        cand_rtsp = base_rtsp + (offset * 10)
        cand_rtsps = base_rtsps + (offset * 10)
        cand_rtp = base_rtp + (offset * 2)
        cand_rtcp = base_rtcp + (offset * 2)
        cand_hls = base_hls + (offset * 10)
        cand_webrtc = base_webrtc + (offset * 10)
        cand_webrtc_udp = base_webrtc_udp + (offset * 10)
        cand_srt = base_srt + (offset * 10)
        cand_api = base_api + offset

        cand_specs = [
            (cand_rtmp, "tcp"),
            (cand_rtmps, "tcp"),
            (cand_rtsp, "tcp"),
            (cand_rtsps, "tcp"),
            (cand_rtp, "udp"),
            (cand_rtcp, "udp"),
            (cand_hls, "tcp"),
            (cand_webrtc, "tcp"),
            (cand_webrtc_udp, "udp"),
            (cand_srt, "udp"),
            (cand_api, "tcp"),
        ]

        if not any(spec in occupied_ports for spec in cand_specs):
            return {
                "rtmp_port": cand_rtmp,
                "rtmps_port": cand_rtmps,
                "rtsp_port": cand_rtsp,
                "rtsps_port": cand_rtsps,
                "rtp_port": cand_rtp,
                "rtcp_port": cand_rtcp,
                "hls_port": cand_hls,
                "webrtc_port": cand_webrtc,
                "webrtc_udp_port": cand_webrtc_udp,
                "srt_port": cand_srt,
                "api_port": cand_api,
            }

    # Fallback to high random/offset if 50 slots exhausted
    return {
        "rtmp_port": 11935,
        "rtmps_port": 11936,
        "rtsp_port": 18554,
        "rtsps_port": 18322,
        "rtp_port": 18000,
        "rtcp_port": 18001,
        "hls_port": 18888,
        "webrtc_port": 18889,
        "webrtc_udp_port": 18189,
        "srt_port": 18890,
        "api_port": 19997,
    }


def get_next_available_icecast_ports(db: Session) -> Dict[str, int]:
    """
    Calculates conflict-free candidate ports for a new Icecast2 service.
    Allocates in the dedicated TCP 7XXX range:
      - HTTP Port: 7000 (step +10 -> 7010, 7020...)
      - HTTPS/TLS Port: 7443 (step +10 -> 7453, 7463...)
    """
    occupied_ports: Set[Tuple[int, str]] = set()
    services = db.query(Service).all()
    for svc in services:
        for p, _, _, _, proto in extract_ports_from_service(
            svc.id, svc.name, svc.service_type, svc.config, svc.input_config, svc.output_config
        ):
            occupied_ports.add((p, proto))

    base_http = 7000
    base_https = 7443

    for offset in range(50):
        cand_http = base_http + (offset * 10)
        cand_https = base_https + (offset * 10)

        cand_specs = [
            (cand_http, "tcp"),
            (cand_https, "tcp"),
        ]

        if not any(spec in occupied_ports for spec in cand_specs):
            return {
                "port": cand_http,
                "ssl_port": cand_https,
            }

    return {
        "port": 17000,
        "ssl_port": 17443,
    }


def validate_icecast_ports(
    service_id: Optional[int],
    service_name: str,
    icecast_config: dict,
    db: Session
) -> None:
    """
    Validates that proposed Icecast ports do not collide with active services.
    Raises HTTPException(status_code=400) on collision.
    """
    proposed_specs = []
    http_enabled = icecast_config.get("http_enabled", True)
    http_port = icecast_config.get("port")
    if http_enabled and http_port:
        try:
            p = int(http_port)
            proposed_specs.append((p, "Icecast HTTP", "tcp"))
        except (ValueError, TypeError):
            pass

    ssl_enabled = icecast_config.get("ssl_enabled", False)
    ssl_port = icecast_config.get("ssl_port")
    if ssl_enabled:
        p = int(ssl_port) if ssl_port else 7443
        proposed_specs.append((p, "Icecast HTTPS/TLS", "tcp"))

    # Check internal duplicate between HTTP and HTTPS
    seen = {}
    for p, label, proto in proposed_specs:
        if (p, proto) in seen:
            raise HTTPException(
                status_code=400,
                detail=f"Port conflict within Icecast configuration: Port {p}/{proto.upper()} is defined for both '{seen[(p, proto)]}' and '{label}'."
            )
        seen[(p, proto)] = label

    # Check against database
    services = db.query(Service).all()
    for svc in services:
        if service_id and svc.id == service_id:
            continue
        existing_ports = extract_ports_from_service(
            svc.id, svc.name, svc.service_type, svc.config, svc.input_config, svc.output_config
        )
        for ep, elabel, esvc_name, _, eproto in existing_ports:
            for pp, plabel, pproto in proposed_specs:
                if pp == ep and pproto == eproto:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Port collision on {pp}/{pproto.upper()} ({plabel}): already in use by service '{esvc_name}' ({elabel})."
                    )

