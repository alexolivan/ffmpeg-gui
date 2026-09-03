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

    # Valores por defecto para network y SSL
    https_port = 8443
    ssl_enabled = False
    force_https_redirect = False

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
            
        if "network" in config:
            net_cfg = config["network"]
            host = net_cfg.get("bind_address", host)
            if net_cfg.get("gui_port"):
                port = net_cfg.getint("gui_port", port)
            elif net_cfg.get("http_port"):
                port = net_cfg.getint("http_port", port)
            https_port = net_cfg.getint("https_port", https_port)
            ssl_enabled = net_cfg.getboolean("ssl_enabled", ssl_enabled)
            force_https_redirect = net_cfg.getboolean("force_https_redirect", force_https_redirect)

        if "ssl" in config:
            ssl_cfg = config["ssl"]
            if ssl_cfg.get("mode") in ("acme", "custom"):
                if "enabled" in ssl_cfg:
                    ssl_enabled = ssl_cfg.getboolean("enabled", ssl_enabled)

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

    # 5. Check SSL Certificate Availability
    ssl_keyfile = None
    ssl_certfile = None
    if ssl_enabled:
        try:
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
            from services.cert_manager import CertificateManager
            cert_mgr = CertificateManager()
            cert_status = cert_mgr.get_cert_status()
            if cert_status.get("valid"):
                ssl_keyfile = cert_mgr.privkey_path
                ssl_certfile = cert_mgr.fullchain_path
                print(f"SSL/TLS Certificate verified! Key: {ssl_keyfile}, Cert: {ssl_certfile}")
            else:
                print("WARNING: ssl_enabled=True in config, but no valid SSL certificate was found in storage. Falling back to HTTP.")
                ssl_enabled = False
        except Exception as e:
            print(f"Error checking SSL certificates: {e}")
            ssl_enabled = False

    # 6. Run Uvicorn server(s) with Warm Reload signal support
    import signal
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from main import set_reload_mode

    active_servers = []

    def handle_reload_signal(signum, frame):
        sig_name = "SIGHUP" if signum == signal.SIGHUP else ("SIGUSR1" if hasattr(signal, 'SIGUSR1') and signum == signal.SIGUSR1 else str(signum))
        print(f"\n[FFMPEG-GUI] Received {sig_name} signal -> Initiating Warm Reload (preserving stream processes)...")
        set_reload_mode(True)
        for s in active_servers:
            s.should_exit = True

    signal.signal(signal.SIGHUP, handle_reload_signal)
    if hasattr(signal, "SIGUSR1"):
        signal.signal(signal.SIGUSR1, handle_reload_signal)

    if ssl_enabled and ssl_keyfile and ssl_certfile:
        import threading
        print(f"Starting FFMPEG-GUI HTTPS Server on https://{host}:{https_port}...")
        if port != https_port:
            https_config = uvicorn.Config(
                "main:app",
                host=host,
                port=https_port,
                ssl_keyfile=ssl_keyfile,
                ssl_certfile=ssl_certfile,
                log_config=log_config,
                access_log=False
            )
            https_server = uvicorn.Server(https_config)
            active_servers.append(https_server)
            threading.Thread(target=https_server.run, daemon=True).start()

            print(f"Starting FFMPEG-GUI HTTP Server on http://{host}:{port}...")
            http_config = uvicorn.Config("main:app", host=host, port=port, log_config=log_config, access_log=False)
            http_server = uvicorn.Server(http_config)
            active_servers.append(http_server)
            http_server.run()
        else:
            https_config = uvicorn.Config(
                "main:app",
                host=host,
                port=https_port,
                ssl_keyfile=ssl_keyfile,
                ssl_certfile=ssl_certfile,
                log_config=log_config,
                access_log=False
            )
            https_server = uvicorn.Server(https_config)
            active_servers.append(https_server)
            https_server.run()
    else:
        print(f"Starting FFMPEG-GUI HTTP Server on http://{host}:{port}...")
        http_config = uvicorn.Config("main:app", host=host, port=port, log_config=log_config, access_log=False)
        http_server = uvicorn.Server(http_config)
        active_servers.append(http_server)
        http_server.run()

if __name__ == "__main__":
    main()
