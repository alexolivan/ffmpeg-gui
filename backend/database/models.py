import datetime
from sqlalchemy import Column, Integer, BigInteger, String, DateTime, JSON, ForeignKey, Boolean, Float
from sqlalchemy.orm import DeclarativeBase, relationship

class Base(DeclarativeBase):
    pass


class SchemaInfo(Base):
    __tablename__ = 'schema_info'

    id = Column(Integer, primary_key=True)
    version = Column(String, nullable=False)
    applied_at = Column(DateTime, default=datetime.datetime.utcnow)


class FfmpegBuild(Base):
    """Represents a named, versioned FFmpeg compilation profile.

    Each build lives in an isolated directory and can coexist with others,
    allowing users to maintain multiple FFmpeg+SDK combinations for
    broadcast reliability (e.g. different DeckLink SDK versions).
    """
    __tablename__ = 'ffmpeg_builds'

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False, unique=True)

    # Git tag versions selected by the user
    ffmpeg_version = Column(String, nullable=False)
    srt_version = Column(String, nullable=True)

    # Build configuration (JSON for future extensibility)
    build_options = Column(JSON, nullable=False)
    sdk_paths = Column(JSON, nullable=True)

    # Filesystem paths (populated after compilation)
    install_path = Column(String, nullable=False)
    ffmpeg_binary = Column(String, nullable=True)
    ffprobe_binary = Column(String, nullable=True)

    # Build lifecycle state
    status = Column(String, default='pending')
    is_default = Column(Boolean, default=False)
    sources_cleaned = Column(Boolean, default=False)
    auto_clean = Column(Boolean, default=False)

    # Auto-generated metadata
    disk_usage_mb = Column(Integer, nullable=True)
    build_log_summary = Column(String, nullable=True)
    ffmpeg_version_output = Column(String, nullable=True)

    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    built_at = Column(DateTime, nullable=True)

    storage_id = Column(Integer, ForeignKey('storages.id'), nullable=True)
    storage = relationship("Storage", back_populates="builds")


class Service(Base):
    __tablename__ = 'services'

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    service_type = Column(String, nullable=False)  # 'ffmpeg_stream', 'kiosk_browser', 'icecast_server', 'mediamtx_hub'
    config = Column(JSON, nullable=False)
    is_active = Column(Boolean, default=True)

    status = Column(String, default='stopped')  # 'running', 'stopped', 'error', 'finished'
    pid = Column(Integer, nullable=True)
    last_start = Column(DateTime, nullable=True)
    last_stop = Column(DateTime, nullable=True)

    # Watchdog & stats info
    cpu_usage = Column(Integer, default=0)
    ram_usage = Column(Integer, default=0)
    restart_count = Column(Integer, default=0)
    last_started_config = Column(JSON, nullable=True)

    # Real-time Stats
    bitrate = Column(String, nullable=True)  # e.g. "4500 kb/s"
    fps = Column(String, nullable=True)      # e.g. "25.0"
    speed = Column(String, nullable=True)    # e.g. "1.02x"

    alias = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    def _set_config_key(self, key, val):
        if not self.config:
            self.config = {}
        new_cfg = dict(self.config)
        new_cfg[key] = val
        self.config = new_cfg
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(self, 'config')

    @property
    def type(self):
        return 'service'

    @type.setter
    def type(self, val):
        if val == 'service' and not self.service_type:
            self.service_type = 'ffmpeg_stream'
        elif val == 'batch' and not self.service_type:
            self.service_type = 'ffmpeg_stream'

    @property
    def input_config(self):
        return self.config.get('input_config', {}) if self.config else {}

    @input_config.setter
    def input_config(self, val):
        self._set_config_key('input_config', val)

    @property
    def output_config(self):
        return self.config.get('output_config', {}) if self.config else {}

    @output_config.setter
    def output_config(self, val):
        self._set_config_key('output_config', val)

    @property
    def codec_config(self):
        return self.config.get('codec_config', {}) if self.config else {}

    @codec_config.setter
    def codec_config(self, val):
        self._set_config_key('codec_config', val)

    @property
    def filter_config(self):
        return self.config.get('filter_config', {}) if self.config else {}

    @filter_config.setter
    def filter_config(self, val):
        self._set_config_key('filter_config', val)

    @property
    def auto_start(self):
        return self.config.get('auto_start', False) if self.config else False

    @auto_start.setter
    def auto_start(self, val):
        self._set_config_key('auto_start', val)

    @property
    def startup_order(self):
        return self.config.get('startup_order', 1) if self.config else 1

    @startup_order.setter
    def startup_order(self, val):
        self._set_config_key('startup_order', val)

    @property
    def startup_delay(self):
        return self.config.get('startup_delay', 0) if self.config else 0

    @startup_delay.setter
    def startup_delay(self, val):
        self._set_config_key('startup_delay', val)

    @property
    def watchdog_enabled(self):
        return self.config.get('watchdog_enabled', False) if self.config else False

    @watchdog_enabled.setter
    def watchdog_enabled(self, val):
        self._set_config_key('watchdog_enabled', val)

    @property
    def watchdog_retries(self):
        return self.config.get('watchdog_retries', 5) if self.config else 5

    @watchdog_retries.setter
    def watchdog_retries(self, val):
        self._set_config_key('watchdog_retries', val)

    @property
    def watchdog_min_speed(self):
        return self.config.get('watchdog_min_speed') if self.config else None

    @watchdog_min_speed.setter
    def watchdog_min_speed(self, val):
        self._set_config_key('watchdog_min_speed', val)

    @property
    def watchdog_min_speed_duration(self):
        return self.config.get('watchdog_min_speed_duration', 30) if self.config else 30

    @watchdog_min_speed_duration.setter
    def watchdog_min_speed_duration(self, val):
        self._set_config_key('watchdog_min_speed_duration', val)

    @property
    def log_storage_id(self):
        return self.config.get('log_storage_id') if self.config else None

    @log_storage_id.setter
    def log_storage_id(self, val):
        self._set_config_key('log_storage_id', val)

    @property
    def ffmpeg_build_id(self):
        return self.config.get('ffmpeg_build_id') if self.config else None

    @ffmpeg_build_id.setter
    def ffmpeg_build_id(self, val):
        self._set_config_key('ffmpeg_build_id', val)

    @property
    def debug_mode(self):
        return self.config.get('debug_mode', False) if self.config else False

    @debug_mode.setter
    def debug_mode(self, val):
        self._set_config_key('debug_mode', val)

    @property
    def network_timeout(self):
        return self.config.get('network_timeout', 15) if self.config else 15

    @network_timeout.setter
    def network_timeout(self, val):
        self._set_config_key('network_timeout', val)

    @property
    def pending_changes(self) -> bool:
        if self.status != 'running' or not self.last_started_config:
            return False
        
        # Compare active configuration dictionary against what was started
        current_cfg = self.config or {}
        started_cfg = self.last_started_config.get('config') or {}
        return current_cfg != started_cfg


class ServiceDependency(Base):
    __tablename__ = 'service_dependencies'

    id = Column(Integer, primary_key=True)
    consumer_type = Column(String, nullable=False)  # 'service' or 'task'
    consumer_id = Column(Integer, nullable=False)   # FK to services.id or scheduled_tasks.id
    provider_service_id = Column(Integer, ForeignKey('services.id'), nullable=False)
    is_auto_managed = Column(Boolean, default=True)

    provider_service = relationship("Service", foreign_keys=[provider_service_id])


class ServiceLog(Base):
    __tablename__ = 'service_logs'

    id = Column(Integer, primary_key=True)
    service_id = Column(Integer, ForeignKey('services.id'))
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    level = Column(String)  # 'INFO', 'ERROR', 'DEBUG'
    message = Column(String)

    service = relationship("Service", back_populates="logs")

    def __init__(self, **kwargs):
        if 'process_id' in kwargs:
            kwargs['service_id'] = kwargs.pop('process_id')
        super().__init__(**kwargs)

    @property
    def process_id(self):
        return self.service_id

    @process_id.setter
    def process_id(self, val):
        self.service_id = val


Service.logs = relationship("ServiceLog", order_by=ServiceLog.id, back_populates="service", cascade="all, delete-orphan")

MediaProcess = Service
ProcessLog = ServiceLog


class SystemSettings(Base):
    __tablename__ = 'system_settings'

    id = Column(Integer, primary_key=True)
    node_name = Column(String, default="FFMPEG-GUI Standalone")
    lcd_alias = Column(String, default="NODE-01")
    gui_password = Column(String, nullable=True)  # Null means open access
    logo_text = Column(String, default="FF")
    logo_path = Column(String, nullable=True)     # Path to custom uploaded logo
    accent_color = Column(String, default="#FF6B00")  # Default Brand Orange

    # LCD Settings
    lcd_enabled = Column(Boolean, default=False)
    lcd_port = Column(String, default="/dev/ttyACM0")
    lcd_model = Column(String, default="cfa635")
    lcd_brightness = Column(Integer, default=100)
    lcd_dim_brightness = Column(Integer, default=20)
    lcd_dim_timeout = Column(Integer, default=30)
    lcd_led0_profile = Column(String, default="heartbeat")
    lcd_led1_profile = Column(String, default="streams")
    lcd_led2_profile = Column(String, default="tasks")
    lcd_led3_profile = Column(String, default="alert")

    last_updated = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class ScheduledTask(Base):
    __tablename__ = 'scheduled_tasks'

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    is_system = Column(Boolean, default=False)
    command = Column(String, nullable=True)

    input_config = Column(JSON, nullable=False)
    output_config = Column(JSON, nullable=False)
    codec_config = Column(JSON, nullable=False)
    filter_config = Column(JSON, nullable=True)
    ffmpeg_build_id = Column(Integer, ForeignKey('ffmpeg_builds.id'), nullable=True)

    schedule_type = Column(String, nullable=False)  # 'manual', 'one_shot', 'recurring'
    schedule_cron = Column(String, nullable=True)
    schedule_datetime = Column(DateTime, nullable=True)
    next_run = Column(DateTime, nullable=True)

    duration_type = Column(String, default='input_dependent')  # 'timer', 'end_time', 'input_dependent'
    duration_seconds = Column(Integer, nullable=True)
    duration_end_time = Column(DateTime, nullable=True)

    retry_policy = Column(JSON, nullable=True)

    alias = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    executions = relationship("TaskExecution", back_populates="task", cascade="all, delete-orphan")


class TaskExecution(Base):
    __tablename__ = 'task_executions'

    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey('scheduled_tasks.id'), nullable=False)
    
    status = Column(String, default='pending')  # 'pending', 'running', 'finished', 'error', 'stopped', 'interrupted'
    pid = Column(Integer, nullable=True)
    started_at = Column(DateTime, nullable=True)
    stopped_at = Column(DateTime, nullable=True)
    
    duration_limit_seconds = Column(Integer, nullable=True)
    retry_count = Column(Integer, default=0)

    cpu_usage = Column(Integer, default=0)
    ram_usage = Column(Integer, default=0)
    bitrate = Column(String, default="0 kb/s")
    fps = Column(String, default="0")
    speed = Column(String, default="0x")

    exit_code = Column(Integer, nullable=True)
    error_message = Column(String, nullable=True)

    task = relationship("ScheduledTask", back_populates="executions")
    logs = relationship("TaskExecutionLog", back_populates="execution", cascade="all, delete-orphan")


class TaskExecutionLog(Base):
    __tablename__ = 'task_execution_logs'

    id = Column(Integer, primary_key=True)
    execution_id = Column(Integer, ForeignKey('task_executions.id'), nullable=False)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    level = Column(String)  # 'INFO', 'WARNING', 'ERROR'
    message = Column(String)

    execution = relationship("TaskExecution", back_populates="logs")


class Storage(Base):
    __tablename__ = 'storages'

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    path = Column(String, nullable=False)
    type = Column(String, nullable=False)  # 'build', 'media', 'hls', 'logs', 'sdk', 'preview'
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    builds = relationship("FfmpegBuild", back_populates="storage")


class InstalledSdk(Base):
    __tablename__ = 'installed_sdks'

    id = Column(Integer, primary_key=True)
    target_app = Column(String, default="ffmpeg")
    sdk_type = Column(String, nullable=False)
    name = Column(String, nullable=False)
    version = Column(String, nullable=False)
    storage_id = Column(Integer, ForeignKey('storages.id'), nullable=True)
    relative_path = Column(String, nullable=False)
    size_bytes = Column(BigInteger, default=0)
    status = Column(String, default="ready")
    metadata_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    storage = relationship("Storage")


