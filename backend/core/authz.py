"""Stateless edge authorization evaluator, dependency cascade resolver, secret redactor, and HTTP route guard."""

import copy
import re
from typing import Dict, Any, Optional, List, Set, Tuple
from fastapi import HTTPException, Request, WebSocket
from sqlalchemy.orm import Session

try:
    from database.models import Service, ScheduledTask, ServiceDependency, TaskExecution
except ImportError:
    from backend.database.models import Service, ScheduledTask, ServiceDependency, TaskExecution

LEVEL_RANK: Dict[str, int] = {
    "none": 0,
    "monitor": 1,
    "operate": 2,
    "manage": 3,
    "admin": 4,
}

DOMAIN_KEYS = ("dashboard", "hardware", "media", "settings", "forge", "processes")

_SECRET_KEYS = frozenset({
    "admin_password",
    "source_password",
    "relay_password",
    "publish_pass",
    "read_pass",
    "stream_key",
    "passphrase",
    "password",
    "rtmp_key",
    "icecast_password",
    "vnc_password",
    "cloudhub_tunnel_secret",
    "smtp_password",
    "telegram_bot_token",
})

_URL_CREDS_RE = re.compile(r"([a-zA-Z0-9+.-]+://[^/:@\s]+):[^@\s]+@")
_URL_QUERY_SECRET_RE = re.compile(r"(passphrase|password|key|token)=([^&\s]+)", re.IGNORECASE)


def normalize_level(level: Optional[str], fallback: str = "none") -> str:
    if isinstance(level, str):
        lvl = level.strip().lower()
        if lvl in LEVEL_RANK:
            return lvl
    return fallback


def has_min_level(actual: Optional[str], required: str) -> bool:
    return LEVEL_RANK[normalize_level(actual)] >= LEVEL_RANK[normalize_level(required)]


def max_level(a: Optional[str], b: Optional[str]) -> str:
    la = normalize_level(a)
    lb = normalize_level(b)
    return la if LEVEL_RANK[la] >= LEVEL_RANK[lb] else lb


def is_video_stream_enabled(input_cfg: Optional[Dict[str, Any]], codec_cfg: Optional[Dict[str, Any]]) -> bool:
    """Return whether an FFmpeg service/task configuration includes a video stream."""
    ic = input_cfg if isinstance(input_cfg, dict) else {}
    cc = codec_cfg if isinstance(codec_cfg, dict) else {}
    if ic.get("has_video") is False:
        return False
    if str(cc.get("vcodec") or "").strip().lower() == "none":
        return False
    return True


def is_audio_stream_enabled(input_cfg: Optional[Dict[str, Any]], codec_cfg: Optional[Dict[str, Any]]) -> bool:
    """Return whether an FFmpeg service/task configuration includes an audio stream."""
    ic = input_cfg if isinstance(input_cfg, dict) else {}
    cc = codec_cfg if isinstance(codec_cfg, dict) else {}
    if ic.get("has_audio") is False:
        return False
    if str(cc.get("acodec") or "").strip().lower() == "none":
        return False
    return True


def _redact_url_or_string(val: str) -> str:
    val = _URL_CREDS_RE.sub(r"\1:********@", val)
    val = _URL_QUERY_SECRET_RE.sub(r"\1=********", val)
    return val


def _redact_recursive(obj: Any) -> Any:
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if str(k).lower() in _SECRET_KEYS and v not in (None, "", False):
                out[k] = "********"
            else:
                out[k] = _redact_recursive(v)
        return out
    if isinstance(obj, list):
        return [_redact_recursive(item) for item in obj]
    if isinstance(obj, str):
        return _redact_url_or_string(obj)
    return obj


def redact_service_dict(proc_dict: Dict[str, Any], level: str) -> Dict[str, Any]:
    """Strip passwords, publish credentials, and embedded URL secrets when level < manage."""
    if has_min_level(level, "manage"):
        res = copy.copy(proc_dict)
        res["effective_level"] = level
        return res

    redacted = _redact_recursive(copy.deepcopy(proc_dict))
    redacted["effective_level"] = level
    return redacted


def redact_task_dict(task_dict: Dict[str, Any], level: str) -> Dict[str, Any]:
    """Strip input/output URL credentials and secrets from tasks when level < manage."""
    if has_min_level(level, "manage"):
        res = copy.copy(task_dict)
        res["effective_level"] = level
        return res

    redacted = _redact_recursive(copy.deepcopy(task_dict))
    redacted["effective_level"] = level
    return redacted


def redact_settings_dict(settings_dict: Dict[str, Any], settings_level: str) -> Dict[str, Any]:
    """Mask sensitive node secrets in settings payload unless caller has settings: admin."""
    if has_min_level(settings_level, "admin"):
        return settings_dict
    redacted = copy.deepcopy(settings_dict)
    for k in (
        "cloudhub_tunnel_secret",
        "smtp_password",
        "telegram_bot_token",
        "webhook_url",
        "metrics_exporter_token",
        "gui_password",
    ):
        if k in redacted and redacted[k]:
            redacted[k] = "********"
    return redacted


def _extract_kiosk_desktop_id(svc: Service) -> Optional[int]:
    if getattr(svc, "service_type", None) != "kiosk_browser":
        return None
    cfg = svc.config if isinstance(svc.config, dict) else {}
    k_cfg = cfg.get("kiosk_config") or cfg
    raw_id = (
        k_cfg.get("desktop_service_id")
        or k_cfg.get("target_desktop_service_id")
        or cfg.get("desktop_service_id")
        or cfg.get("target_desktop_service_id")
    )
    if raw_id is not None and str(raw_id).isdigit():
        return int(raw_id)
    return None


def _extract_desktop_pipewire_id(svc: Service) -> Optional[int]:
    if getattr(svc, "service_type", None) != "desktop":
        return None
    cfg = svc.config if isinstance(svc.config, dict) else {}
    d_cfg = cfg.get("desktop_config") or cfg
    if d_cfg.get("audio_backend") == "pipewire_hub" and d_cfg.get("pipewire_service_id") is not None:
        raw_id = d_cfg.get("pipewire_service_id")
        if str(raw_id).isdigit():
            return int(raw_id)
    return None


class AuthzContext:
    """Evaluates effective domain, service, and task capabilities for an HTTP or WS request."""

    def __init__(
        self,
        is_owner: bool,
        channel: str = "local_gui",
        username: str = "admin",
        scopes: Optional[Dict[str, Any]] = None,
    ):
        self.is_owner = is_owner
        self.channel = channel
        self.username = username
        self.scopes = scopes or {}

    @classmethod
    def owner(cls, username: str = "admin", channel: str = "local_gui") -> "AuthzContext":
        return cls(
            is_owner=True,
            channel=channel,
            username=username,
            scopes={
                "dashboard": "admin",
                "hardware": "admin",
                "media": "admin",
                "settings": "admin",
                "forge": "admin",
                "processes": {"default": "admin", "by_type": {}, "services": {}, "tasks": {}},
            },
        )

    @classmethod
    def _from_scope(cls, scope: Dict[str, Any]) -> "AuthzContext":
        state = scope.get("state") if isinstance(scope, dict) else None
        if isinstance(state, dict) and state.get("authz_claims") is not None:
            claims = state["authz_claims"]
            return cls(
                is_owner=False,
                channel=str(claims.get("channel", "cloudhub")),
                username=str(claims.get("user") or state.get("authenticated_user") or "cloudhub_operator"),
                scopes=claims.get("scopes") or {},
            )
        ch = state.get("authenticated_channel", "local_gui") if isinstance(state, dict) else "local_gui"
        user = state.get("authenticated_user", "admin") if isinstance(state, dict) else "admin"
        return cls.owner(username=user, channel=ch)

    @classmethod
    def from_request(cls, request: Request) -> "AuthzContext":
        return cls._from_scope(getattr(request, "scope", {}))

    @classmethod
    def from_websocket(cls, websocket: WebSocket) -> "AuthzContext":
        return cls._from_scope(getattr(websocket, "scope", {}))

    def domain_level(self, domain: str) -> str:
        if self.is_owner:
            return "admin"
        if domain == "processes":
            procs = self.scopes.get("processes") or {}
            return normalize_level(procs.get("default"), "none")
        return normalize_level(self.scopes.get(domain), "none")

    def has_domain(self, domain: str, min_level: str = "monitor") -> bool:
        return has_min_level(self.domain_level(domain), min_level)

    def require_domain(self, domain: str, min_level: str = "monitor") -> None:
        if not self.has_domain(domain, min_level):
            raise HTTPException(
                status_code=403,
                detail=f"Insufficient permissions for '{domain}' (requires {min_level})",
            )

    def explicit_service_level(self, service_id: int, service_type: Optional[str]) -> str:
        if self.is_owner:
            return "admin"
        procs = self.scopes.get("processes") or {}
        services_map = procs.get("services") or {}
        sid_str = str(service_id)
        if sid_str in services_map:
            return normalize_level(services_map[sid_str], "none")
        by_type = procs.get("by_type") or {}
        if service_type and service_type in by_type:
            return normalize_level(by_type[service_type], "none")
        return normalize_level(procs.get("default"), "none")

    def task_level(self, task_obj_or_id: Any, db: Optional[Session] = None) -> str:
        if self.is_owner:
            return "admin"
        tid = task_obj_or_id.id if hasattr(task_obj_or_id, "id") else int(task_obj_or_id)
        procs = self.scopes.get("processes") or {}
        tasks_map = procs.get("tasks") or {}
        if str(tid) in tasks_map:
            return normalize_level(tasks_map[str(tid)], "none")
        by_type = procs.get("by_type") or {}
        if "task" in by_type:
            return normalize_level(by_type["task"], "none")
        return normalize_level(procs.get("default"), "none")

    def resolve_all_service_levels(self, db: Session) -> Dict[int, str]:
        services = db.query(Service).all()
        if self.is_owner:
            return {s.id: "admin" for s in services}

        resolved: Dict[int, str] = {}
        edges: List[Tuple[str, int]] = []  # (consumer_level_source, provider_id)

        for s in services:
            resolved[s.id] = self.explicit_service_level(s.id, getattr(s, "service_type", "ffmpeg_stream"))

        # Collect dependency edges: ServiceDependency + implicit desktop/kiosk bindings
        all_deps = db.query(ServiceDependency).all()
        tasks_cache: Optional[Dict[int, str]] = None

        for dep in all_deps:
            if dep.consumer_type == "service":
                edges.append(("service:" + str(dep.consumer_id), dep.provider_service_id))
            elif dep.consumer_type == "task":
                if tasks_cache is None:
                    tasks_cache = {t.id: self.task_level(t.id) for t in db.query(ScheduledTask).all()}
                if has_min_level(tasks_cache.get(dep.consumer_id, "none"), "monitor") and dep.provider_service_id in resolved:
                    resolved[dep.provider_service_id] = max_level(resolved[dep.provider_service_id], "monitor")

        for s in services:
            desk_id = _extract_kiosk_desktop_id(s)
            if desk_id is not None and desk_id in resolved:
                edges.append(("service:" + str(s.id), desk_id))
            pw_id = _extract_desktop_pipewire_id(s)
            if pw_id is not None and pw_id in resolved:
                edges.append(("service:" + str(s.id), pw_id))

        # Fixed-point propagation so kiosk (monitor+) -> desktop (monitor) -> pipewire_hub (monitor) cascades cleanly
        changed = True
        while changed:
            changed = False
            for src, provider_id in edges:
                if provider_id not in resolved:
                    continue
                cid = int(src.split(":", 1)[1])
                if has_min_level(resolved.get(cid, "none"), "monitor"):
                    new_lvl = max_level(resolved[provider_id], "monitor")
                    if new_lvl != resolved[provider_id]:
                        resolved[provider_id] = new_lvl
                        changed = True

        return resolved

    def resolve_all_task_levels(self, db: Session) -> Dict[int, str]:
        tasks = db.query(ScheduledTask).all()
        if self.is_owner:
            return {t.id: "admin" for t in tasks}
        return {t.id: self.task_level(t) for t in tasks}

    def service_level(self, db: Session, service_obj_or_id: Any) -> str:
        if self.is_owner:
            return "admin"
        sid = service_obj_or_id.id if hasattr(service_obj_or_id, "id") else int(service_obj_or_id)
        levels = self.resolve_all_service_levels(db)
        if sid in levels:
            return levels[sid]
        svc_type = getattr(service_obj_or_id, "service_type", None) if hasattr(service_obj_or_id, "service_type") else None
        return self.explicit_service_level(sid, svc_type)

    def can_create_service(self, service_type: Optional[str]) -> bool:
        if self.is_owner:
            return True
        procs = self.scopes.get("processes") or {}
        by_type = procs.get("by_type") or {}
        if service_type and service_type in by_type:
            return has_min_level(by_type[service_type], "admin")
        return has_min_level(procs.get("default"), "admin")

    def can_create_any_service(self) -> bool:
        if self.is_owner:
            return True
        procs = self.scopes.get("processes") or {}
        if has_min_level(procs.get("default"), "admin"):
            return True
        for stype, lvl in (procs.get("by_type") or {}).items():
            if stype != "task" and has_min_level(lvl, "admin"):
                return True
        return False

    def can_create_task(self) -> bool:
        if self.is_owner:
            return True
        procs = self.scopes.get("processes") or {}
        by_type = procs.get("by_type") or {}
        if "task" in by_type:
            return has_min_level(by_type["task"], "admin")
        return has_min_level(procs.get("default"), "admin")

    def can_manage_any_task(self) -> bool:
        if self.is_owner:
            return True
        procs = self.scopes.get("processes") or {}
        if has_min_level(procs.get("default"), "manage"):
            return True
        by_type = procs.get("by_type") or {}
        if has_min_level(by_type.get("task"), "manage"):
            return True
        for lvl in (procs.get("tasks") or {}).values():
            if has_min_level(lvl, "manage"):
                return True
        return False

    def can_manage_any_process(self) -> bool:
        if self.is_owner:
            return True
        procs = self.scopes.get("processes") or {}
        if has_min_level(procs.get("default"), "manage"):
            return True
        for map_name in ("by_type", "services", "tasks"):
            for lvl in (procs.get(map_name) or {}).values():
                if has_min_level(lvl, "manage"):
                    return True
        return False

    def has_any_process_level(self, db: Session, min_level: str = "monitor") -> bool:
        if self.is_owner:
            return True
        procs = self.scopes.get("processes") or {}
        if has_min_level(procs.get("default"), min_level):
            return True
        for map_name in ("by_type", "services", "tasks"):
            for lvl in (procs.get(map_name) or {}).values():
                if has_min_level(lvl, min_level):
                    return True
        for lvl in self.resolve_all_service_levels(db).values():
            if has_min_level(lvl, min_level):
                return True
        for lvl in self.resolve_all_task_levels(db).values():
            if has_min_level(lvl, min_level):
                return True
        return False

    def to_summary_dict(self, db: Session) -> Dict[str, Any]:
        return {
            "is_owner": self.is_owner,
            "channel": self.channel,
            "username": self.username,
            "scopes": self.scopes,
            "service_levels": {str(k): v for k, v in self.resolve_all_service_levels(db).items()},
            "task_levels": {str(k): v for k, v in self.resolve_all_task_levels(db).items()},
        }


# =========================================================================
# Centralized HTTP Route Authorization Audit Table
# =========================================================================

_SERVICE_ACTION_OPERATE_RE = re.compile(
    r"^/(?:api/)?(?:processes|services)/(\d+)/(?:start|stop|restart|reload|kiosk/clear-cache|pipewire/matrix/reconcile)$"
)
_SERVICE_LIFECYCLE_ADMIN_RE = re.compile(
    r"^/(?:api/)?(?:processes|services)/(\d+)/(?:clone|export)$"
)
_SERVICE_MANAGE_RE = re.compile(
    r"^/(?:api/)?(?:processes|services)/(\d+)(?:/dependencies(?:/\d+)?)?$"
)
_SERVICE_ICECAST_PROXY_RE = re.compile(r"^/(?:api/)?processes/(\d+)/icecast-proxy/(.*)$")
_SERVICE_READ_RE = re.compile(
    r"^/(?:api/)?(?:processes|services)/(\d+)/(?:logs|log-exists|download-log|progress|preview|icecast-status|mediamtx/paths|hls/.*|sidecar-logs/.*|pipewire/(?:nodes|matrix)|dependencies)$"
)

_TASK_EXEC_READ_RE = re.compile(r"^/tasks/executions/(\d+)/(?:preview|logs)$")
_TASK_EXEC_OPERATE_RE = re.compile(r"^/tasks/executions/(\d+)/stop$")
_TASK_OPERATE_RE = re.compile(r"^/tasks/(\d+)/trigger$")
_TASK_LIFECYCLE_ADMIN_RE = re.compile(r"^/tasks/(\d+)/(?:export|clone-as-service)$")
_TASK_MANAGE_RE = re.compile(r"^/tasks/(\d+)(?:/executions)?$")
_TASK_READ_RE = re.compile(r"^/tasks/(\d+)$")

_HARDWARE_DROPDOWNS = frozenset({
    "/v4l2/devices",
    "/v4l2/formats",
    "/alsa/devices",
    "/alsa/devices-hierarchical",
    "/alsa/playback-devices",
    "/alsa/playback-devices-hierarchical",
    "/decklink/devices",
    "/decklink/formats",
    "/ndi/sources",
})


def authorize_http_request(request: Request, ctx: AuthzContext, db: Session) -> Optional[str]:
    """
    Evaluate global route authorization policy.
    Returns None if allowed, or an error string (triggering HTTP 403) if denied.
    """
    if ctx.is_owner:
        return None

    path = request.url.path
    method = request.method.upper()

    # 1. Bootstrap & SPA UI Shell reads
    if method == "GET" and (
        path in ("/", "/settings", "/api/settings", "/system/capabilities", "/api/cloudhub/catalog", "/builds", "/builds/disk-info")
        or path.startswith("/api/software/icon/")
        or (path.startswith("/api/settings/software/") and path.endswith("/icon"))
    ):
        return None

    # 2. Dashboard
    if path in ("/api/status",):
        return None if (ctx.has_domain("dashboard", "monitor") or ctx.has_any_process_level(db, "monitor")) else "Dashboard access denied"
    if path == "/api/lcd/locator":
        req_lvl = "operate" if method == "POST" else "monitor"
        if ctx.has_domain("dashboard", req_lvl) or ctx.has_domain("settings", req_lvl):
            return None
        return f"Dashboard permission '{req_lvl}' required"

    # 3. Settings & Peers & Security & Backup
    if path in ("/settings", "/api/settings") and method == "POST":
        return None if ctx.has_domain("settings", "admin") else "Settings 'admin' permission required"
    if path == "/settings/restart" or path.startswith("/api/backup/") or path.startswith("/api/settings/security/") or path.startswith("/api/settings/cloudhub/"):
        return None if ctx.has_domain("settings", "admin") else "Settings 'admin' permission required"
    if path.startswith("/api/peers/"):
        req_lvl = "monitor" if method == "GET" else "admin"
        return None if ctx.has_domain("settings", req_lvl) else f"Settings '{req_lvl}' permission required"
    if path in ("/notifications/test", "/api/notifications/test", "/settings/logo", "/api/settings/logo", "/settings/lcd/probe"):
        return None if ctx.has_domain("settings", "manage") else "Settings 'manage' permission required"
    if path in ("/api/audit-logs", "/api/audit-logs/download"):
        req_lvl = "manage" if path.endswith("/download") else "monitor"
        return None if ctx.has_domain("settings", req_lvl) else f"Settings '{req_lvl}' permission required"
    if path.startswith("/api/system/") or path.startswith("/settings/storages") or path.startswith("/api/settings/storages") or path.startswith("/api/settings/ssl/") or path.startswith("/api/settings/software"):
        req_lvl = "monitor" if method == "GET" else "manage"
        return None if ctx.has_domain("settings", req_lvl) else f"Settings '{req_lvl}' permission required"

    # 4. Hardware I/O
    if path in _HARDWARE_DROPDOWNS:
        if ctx.has_domain("hardware", "monitor") or ctx.can_manage_any_process():
            return None
        return "Hardware 'monitor' or process 'manage' permission required"
    if path == "/api/hardware/health":
        if ctx.has_domain("hardware", "monitor") or ctx.has_domain("dashboard", "monitor"):
            return None
        return "Hardware or Dashboard 'monitor' permission required"
    if path == "/api/settings/alsa/control":
        return None if ctx.has_domain("hardware", "operate") else "Hardware 'operate' permission required"
    if path.startswith("/api/settings/alsa/"):
        return None if ctx.has_domain("hardware", "monitor") else "Hardware 'monitor' permission required"
    if path.startswith("/api/settings/decklink/") or path.startswith("/api/settings/magewell/"):
        req_lvl = "monitor" if method == "GET" else "manage"
        return None if ctx.has_domain("hardware", req_lvl) else f"Hardware '{req_lvl}' permission required"

    # 5. Forge
    if path.startswith("/builds") or path.startswith("/sdks") or path.startswith("/system/patches"):
        if re.match(r"^/builds/\d+/(compile|stop)$", path) and method == "POST":
            return None if ctx.has_domain("forge", "operate") else "Forge 'operate' permission required"
        if re.match(r"^/builds/\d+/export$", path) and method == "GET":
            return None if ctx.has_domain("forge", "admin") else "Forge 'admin' permission required"
        if method == "GET":
            return None if ctx.has_domain("forge", "monitor") else "Forge 'monitor' permission required"
        if (re.match(r"^/builds/\d+$", path) and method == "PUT") or (
            re.match(r"^/builds/\d+/clean-sources$", path) and method == "POST"
        ):
            return None if ctx.has_domain("forge", "manage") else "Forge 'manage' permission required"
        return None if ctx.has_domain("forge", "admin") else "Forge 'admin' permission required"

    # 6. Services / Processes
    if path in ("/processes", "/api/services") and method == "GET":
        return None  # Filtered & redacted per service inside route handler
    if path in ("/processes", "/api/services", "/processes/import") and method == "POST":
        return None if ctx.can_create_any_service() else "Process 'admin' permission required"
    if path == "/processes/preview-cmd" and method == "POST":
        return None if ctx.can_manage_any_process() else "Process 'manage' permission required"
    if path in ("/api/services/mediamtx/next-available-ports", "/services/mediamtx/next-available-ports", "/api/services/icecast/next-available-ports", "/services/icecast/next-available-ports", "/api/services/desktop/next-available-ports", "/services/desktop/next-available-ports", "/api/services/next-desktop-ports"):
        return None if ctx.can_manage_any_process() else "Process 'manage' permission required"
    if path in ("/api/resources/locks", "/api/dependencies/providers") or path.startswith("/api/pipewire/"):
        return None if ctx.has_any_process_level(db, "monitor") else "Process 'monitor' permission required"

    m = _SERVICE_ICECAST_PROXY_RE.match(path)
    if m:
        sid = int(m.group(1))
        subpath = m.group(2).lstrip("/")
        req_lvl = "manage" if subpath.startswith("admin") else "monitor"
        svc_lvl = ctx.service_level(db, sid)
        return None if has_min_level(svc_lvl, req_lvl) else f"Service #{sid} requires '{req_lvl}'"

    m = _SERVICE_ACTION_OPERATE_RE.match(path)
    if m:
        sid = int(m.group(1))
        svc_lvl = ctx.service_level(db, sid)
        return None if has_min_level(svc_lvl, "operate") else f"Service #{sid} requires 'operate'"

    if re.match(r"^/processes/\d+/clone-as-task$", path) and method == "POST":
        sid = int(path.split("/")[2])
        if not has_min_level(ctx.service_level(db, sid), "admin"):
            return f"Service #{sid} requires 'admin'"
        if not ctx.can_create_task():
            return "Task 'admin' permission required"
        return None

    m = _SERVICE_LIFECYCLE_ADMIN_RE.match(path)
    if m:
        sid = int(m.group(1))
        return None if has_min_level(ctx.service_level(db, sid), "admin") else f"Service #{sid} requires 'admin'"

    m = _SERVICE_READ_RE.match(path)
    if m and method == "GET":
        sid = int(m.group(1))
        return None if has_min_level(ctx.service_level(db, sid), "monitor") else f"Service #{sid} requires 'monitor'"

    m = _SERVICE_MANAGE_RE.match(path)
    if m:
        sid = int(m.group(1))
        if method == "GET":
            return None if has_min_level(ctx.service_level(db, sid), "monitor") else f"Service #{sid} requires 'monitor'"
        if method == "DELETE" and "/dependencies" not in path:
            return None if has_min_level(ctx.service_level(db, sid), "admin") else f"Service #{sid} requires 'admin'"
        return None if has_min_level(ctx.service_level(db, sid), "manage") else f"Service #{sid} requires 'manage'"

    # 7. Scheduled Tasks
    if path == "/tasks" and method == "GET":
        return None  # Filtered & redacted inside route handler
    if path == "/tasks/preview-cmd" and method == "POST":
        return None if ctx.can_manage_any_task() else "Task 'manage' permission required"
    if path in ("/tasks", "/tasks/export", "/tasks/import"):
        return None if ctx.can_create_task() else "Task 'admin' permission required"

    m = _TASK_EXEC_READ_RE.match(path)
    if m:
        eid = int(m.group(1))
        ex = db.query(TaskExecution).get(eid)
        if ex and not has_min_level(ctx.task_level(ex.task_id), "monitor"):
            return f"Task #{ex.task_id} requires 'monitor'"
        return None

    m = _TASK_EXEC_OPERATE_RE.match(path)
    if m:
        eid = int(m.group(1))
        ex = db.query(TaskExecution).get(eid)
        if ex and not has_min_level(ctx.task_level(ex.task_id), "operate"):
            return f"Task #{ex.task_id} requires 'operate'"
        return None

    m = _TASK_OPERATE_RE.match(path)
    if m:
        tid = int(m.group(1))
        return None if has_min_level(ctx.task_level(tid), "operate") else f"Task #{tid} requires 'operate'"

    m = _TASK_LIFECYCLE_ADMIN_RE.match(path)
    if m:
        tid = int(m.group(1))
        if path.endswith("/clone-as-service") and not ctx.can_create_service("ffmpeg_stream"):
            return "Process 'admin' permission required to clone task as service"
        return None if has_min_level(ctx.task_level(tid), "admin") else f"Task #{tid} requires 'admin'"

    m = _TASK_MANAGE_RE.match(path)
    if m:
        tid = int(m.group(1))
        if method == "GET":
            return None if has_min_level(ctx.task_level(tid), "monitor") else f"Task #{tid} requires 'monitor'"
        if method == "DELETE":
            return None if has_min_level(ctx.task_level(tid), "admin") else f"Task #{tid} requires 'admin'"
        return None if has_min_level(ctx.task_level(tid), "manage") else f"Task #{tid} requires 'manage'"

    m = _TASK_READ_RE.match(path)
    if m and method == "GET":
        tid = int(m.group(1))
        return None if has_min_level(ctx.task_level(tid), "monitor") else f"Task #{tid} requires 'monitor'"

    return None
