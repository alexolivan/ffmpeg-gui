from sqlalchemy import Column, Integer, String, DateTime, JSON, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
import datetime

Base = declarative_base()

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
    
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    
class ProcessLog(Base):
    __tablename__ = 'process_logs'
    
    id = Column(Integer, primary_key=True)
    process_id = Column(Integer, ForeignKey('media_processes.id'))
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    level = Column(String)  # 'INFO', 'ERROR', 'DEBUG'
    message = Column(String)
    
    process = relationship("MediaProcess", back_populates="logs")

MediaProcess.logs = relationship("ProcessLog", order_by=ProcessLog.timestamp, back_populates="process")
