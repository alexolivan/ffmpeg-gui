from sqlalchemy import Column, Integer, String, DateTime, JSON, ForeignKey, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
import datetime

Base = declarative_base()


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

    # Real-time Stats
    bitrate = Column(String)  # e.g. "4500 kb/s"
    fps = Column(String)      # e.g. "25.0"
    speed = Column(String)    # e.g. "1.02x"

    # FK to the FFmpeg build profile used by this process
    ffmpeg_build_id = Column(Integer, ForeignKey('ffmpeg_builds.id'), nullable=True)
    ffmpeg_build = relationship("FfmpegBuild", back_populates="processes")

    created_at = Column(DateTime, default=datetime.datetime.utcnow)


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
    gui_password = Column(String, nullable=True)  # Null means open access
    logo_text = Column(String, default="FF")
    logo_path = Column(String, nullable=True)     # Path to custom uploaded logo
    accent_color = Column(String, default="#FF6B00")  # Default Brand Orange

    last_updated = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
