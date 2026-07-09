#!/usr/bin/env python3
import os
import sys
import argparse
import configparser
import logging
import uvicorn

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

    # 2. Sobrescribir con argumentos de la CLI
    if args.host: host = args.host
    if args.port: port = args.port
    if args.log_file: log_file = args.log_file
    if args.database: database = args.database

    # 3. Configurar base de datos
    if database:
        os.environ["DATABASE_PATH"] = os.path.abspath(database)

    if config_path and os.path.exists(config_path):
        os.environ["CONFIG_FILE_PATH"] = os.path.abspath(config_path)

    os.environ["ACTIVE_PORT"] = str(port)

    # 4. Configurar logging
    log_config = uvicorn.config.LOGGING_CONFIG
    # Desactivar logs de acceso por defecto de uvicorn (los gestiona el middleware custom)
    log_config["loggers"]["uvicorn.access"]["handlers"] = []
    log_config["loggers"]["uvicorn.access"]["propagate"] = False

    if log_file:
        log_dir = os.path.dirname(log_file)
        if log_dir:
            os.makedirs(log_dir, exist_ok=True)
        
        # Añadir file handler al root logger de la app
        file_handler = logging.FileHandler(log_file)
        file_handler.setFormatter(logging.Formatter('%(message)s'))
        
        # Habilitar logging a archivo para la app
        app_logger = logging.getLogger("FFMPEG-GUI")
        app_logger.addHandler(file_handler)
        app_logger.setLevel(logging.INFO)
        
        # Set environment variable for access logs path
        os.environ["ACCESS_LOG_PATH"] = os.path.abspath(log_file)
        print(f"Logging accesses and system info to {log_file}")
    else:
        print("Logging accesses and system info to stdout")

    print(f"Starting FFMPEG-GUI Server on {host}:{port}...")
    uvicorn.run("main:app", host=host, port=port, log_config=log_config)

if __name__ == "__main__":
    main()
