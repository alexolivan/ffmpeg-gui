#!/usr/bin/env python3
import os
import sys
import argparse
import configparser
import logging
import logging.handlers
import gzip
import shutil
import uvicorn

class GzippedRotatingFileHandler(logging.handlers.RotatingFileHandler):
    """
    Custom RotatingFileHandler that compresses rotated files using gzip.
    For example, rotates ffmpeg-gui.log to ffmpeg-gui.log.1.gz.
    """
    def doRollover(self):
        if self.stream:
            self.stream.close()
            self.stream = None
        
        if self.backupCount > 0:
            # Shift existing gzipped backups: backup.N-1.gz -> backup.N.gz
            for i in range(self.backupCount - 1, 0, -1):
                sfn = f"{self.baseFilename}.{i}.gz"
                dfn = f"{self.baseFilename}.{i+1}.gz"
                if os.path.exists(sfn):
                    if os.path.exists(dfn):
                        os.remove(dfn)
                    os.rename(sfn, dfn)
            
            # The current log file becomes .1.gz
            dest_1 = f"{self.baseFilename}.1"
            dest_1_gz = f"{dest_1}.gz"
            if os.path.exists(dest_1_gz):
                os.remove(dest_1_gz)
            if os.path.exists(dest_1):
                os.remove(dest_1)
            
            if os.path.exists(self.baseFilename):
                os.rename(self.baseFilename, dest_1)
            
            if os.path.exists(dest_1):
                try:
                    with open(dest_1, 'rb') as f_in:
                        with gzip.open(dest_1_gz, 'wb') as f_out:
                            shutil.copyfileobj(f_in, f_out)
                finally:
                    if os.path.exists(dest_1):
                        os.remove(dest_1)
                        
        if not self.delay:
            self.stream = self._open()

def parse_args():
    parser = argparse.ArgumentParser(description="FFMPEG-GUI Server Runner")
    parser.add_argument("--host", help="Binding host address")
    parser.add_argument("--port", type=int, help="Binding port")
    parser.add_argument("--config", help="Path to config file (.conf)")
    parser.add_argument("--log-file", help="Path to log file")
    parser.add_argument("--database", help="Path to SQLite database file")
    return parser.parse_args()

def main():
    args = parse_args()
    
    # Valores por defecto
    host = "0.0.0.0"
    port = 8000
    log_file = None
    database = None

    # Valores por defecto para logging
    logging_mode = "journalctl"
    logging_file_path = None
    rotation_enabled = False
    rotation_max_bytes = 10 * 1024 * 1024
    rotation_backup_count = 5
    compression_enabled = False

    # 1. Cargar archivo de configuración si se proporciona o existe en ruta por defecto
    config_path = args.config
    if not config_path:
        default_paths = [
            "/etc/ffmpeg-gui/ffmpeg-gui.conf",
            os.path.expanduser("~/.config/ffmpeg-gui/ffmpeg-gui.conf"),
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "ffmpeg-gui.conf")
        ]
        for p in default_paths:
            if os.path.exists(p):
                config_path = p
                break

    if config_path and os.path.exists(config_path):
        print(f"Loading configuration from {config_path}")
        config = configparser.ConfigParser()
        config.read(config_path)
        if "server" in config:
            server_cfg = config["server"]
            host = server_cfg.get("host", host)
            port = server_cfg.getint("port", port)
            log_file = server_cfg.get("log_file", log_file)
            database = server_cfg.get("database", database)
            
        if "logging" in config:
            logging_cfg = config["logging"]
            logging_mode = logging_cfg.get("mode", logging_mode)
            logging_file_path = logging_cfg.get("file_path", logging_file_path)
            if logging_file_path:
                log_file = logging_file_path
            rotation_enabled = logging_cfg.getboolean("rotation_enabled", rotation_enabled)
            rotation_max_bytes = logging_cfg.getint("rotation_max_bytes", rotation_max_bytes)
            rotation_backup_count = logging_cfg.getint("rotation_backup_count", rotation_backup_count)
            compression_enabled = logging_cfg.getboolean("compression_enabled", compression_enabled)

    # 2. Sobrescribir con argumentos de la CLI
    if args.host: host = args.host
    if args.port: port = args.port
    if args.log_file:
        log_file = args.log_file
        logging_file_path = args.log_file
    if args.database: database = args.database

    # 3. Configurar base de datos
    if database:
        os.environ["DATABASE_PATH"] = os.path.abspath(database)

    if config_path and os.path.exists(config_path):
        os.environ["CONFIG_FILE_PATH"] = os.path.abspath(config_path)

    os.environ["ACTIVE_PORT"] = str(port)

    # 4. Configurar logging
    log_config = uvicorn.config.LOGGING_CONFIG.copy()
    # Desactivar logs de acceso por defecto de uvicorn (los gestiona el middleware custom)
    log_config["loggers"]["uvicorn.access"]["handlers"] = []
    log_config["loggers"]["uvicorn.access"]["propagate"] = False

    use_file = bool(log_file and logging_mode in ("file", "both"))
    use_console = bool(logging_mode in ("journalctl", "both") or not log_file)

    general_handlers = []
    if use_console:
        general_handlers.append("default")
    if use_file:
        general_handlers.append("file")

    if use_file:
        log_dir = os.path.dirname(log_file)
        if log_dir:
            os.makedirs(log_dir, exist_ok=True)
        
        log_config["formatters"]["file_formatter"] = {
            "format": "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
        }
        
        file_handler_cfg = {
            "formatter": "file_formatter",
            "filename": os.path.abspath(log_file),
        }
        
        if rotation_enabled:
            if compression_enabled:
                file_handler_cfg["()"] = GzippedRotatingFileHandler
            else:
                file_handler_cfg["()"] = logging.handlers.RotatingFileHandler
            
            file_handler_cfg["maxBytes"] = rotation_max_bytes
            file_handler_cfg["backupCount"] = rotation_backup_count
        else:
            file_handler_cfg["()"] = logging.FileHandler
            
        log_config["handlers"]["file"] = file_handler_cfg
        os.environ["ACCESS_LOG_PATH"] = os.path.abspath(log_file)
        print(f"Logging accesses and system info to {log_file} (mode: {logging_mode})")
    else:
        os.environ.pop("ACCESS_LOG_PATH", None)
        print(f"Logging accesses and system info to stdout (mode: {logging_mode})")

    log_config["root"] = {
        "handlers": general_handlers,
        "level": "INFO"
    }
    log_config["loggers"]["FFMPEG-GUI"] = {
        "handlers": general_handlers,
        "level": "INFO",
        "propagate": False
    }
    log_config["loggers"]["uvicorn"] = {
        "handlers": general_handlers,
        "level": "INFO",
        "propagate": False
    }
    log_config["loggers"]["uvicorn.error"] = {
        "handlers": general_handlers,
        "level": "INFO",
        "propagate": False
    }

    print(f"Starting FFMPEG-GUI Server on {host}:{port}...")
    uvicorn.run("main:app", host=host, port=port, log_config=log_config)

if __name__ == "__main__":
    main()
