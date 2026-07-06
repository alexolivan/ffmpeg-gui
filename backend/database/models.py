import datetime
from sqlalchemy import Column, Integer, String, DateTime, JSON, ForeignKey, Boolean
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

    # Reverse relationship to processes using this build
    processes = relationship("MediaProcess", back_populates="ffmpeg_build")


class MediaProcess(Base):
    __tablename__ = 'media_processes'

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)  # 'service' or 'batch'
    input_config = Column(JSON, nullable=False)
    output_config = Column(JSON, nullable=False)
    codec_config = Column(JSON, nullable=False)
    filter_config = Column(JSON)

    status = Column(String, default='stopped')  # 'running', 'stopped', 'error', 'finished'
    pid = Column(Integer)
    last_start = Column(DateTime)
    last_stop = Column(DateTime)

    # Watchdog info
    cpu_usage = Column(Integer, default=0)
    ram_usage = Column(Integer, default=0)

    # Configuration toggles & snapshot
    auto_start = Column(Boolean, default=False)
    watchdog_enabled = Column(Boolean, default=False)
    watchdog_retries = Column(Integer, default=5)
    restart_count = Column(Integer, default=0)
    last_started_config = Column(JSON, nullable=True)

    # Real-time Stats
    bitrate = Column(String)  # e.g. "4500 kb/s"
    fps = Column(String)      # e.g. "25.0"
    speed = Column(String)    # e.g. "1.02x"

    # FK to the FFmpeg build profile used by this process
    ffmpeg_build_id = Column(Integer, ForeignKey('ffmpeg_builds.id'), nullable=True)
    ffmpeg_build = relationship("FfmpegBuild", back_populates="processes")

    alias = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    @property
    def pending_changes(self) -> bool:
        if self.status != 'running' or not self.last_started_config:
            return False
        
        # Compare only parameters that modify the ffmpeg execution command/environment
        # (excluding administrative fields like name, auto_start, watchdog settings)
        functional_keys = [
            "ffmpeg_build_id",
            "input_config",
            "output_config",
            "codec_config",
            "filter_config"
        ]
        
        for key in functional_keys:
            current_val = getattr(self, key, None)
            started_val = self.last_started_config.get(key, None)
            if current_val != started_val:
                return True
        return False


class ProcessLog(Base):
    __tablename__ = 'process_logs'

    id = Column(Integer, primary_key=True)
    process_id = Column(Integer, ForeignKey('media_processes.id'))
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    level = Column(String)  # 'INFO', 'ERROR', 'DEBUG'
    message = Column(String)

    process = relationship("MediaProcess", back_populates="logs")


MediaProcess.logs = relationship("ProcessLog", order_by=ProcessLog.id, back_populates="process")


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

