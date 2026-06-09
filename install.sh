#!/bin/bash
set -e

# Mostrar uso del script
show_help() {
    echo "Usage: $0 [--user | --system]"
    echo "  --user: Install in user space (no root required)"
    echo "  --system: Install system-wide (requires root/sudo)"
}

MODE=""
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --user) MODE="user"; shift ;;
        --system) MODE="system"; shift ;;
        -h|--help) show_help; exit 0 ;;
        *) echo "Unknown parameter: $1"; show_help; exit 1 ;;
    esac
done

# Auto-detectar modo si no se especifica
if [ -z "$MODE" ]; then
    if [ "$EUID" -eq 0 ]; then
        MODE="system"
    else
        MODE="user"
    fi
fi

PROJ_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Compilar Frontend
echo "--> Compiling frontend..."
cd "$PROJ_DIR/frontend"
npm install
npm run build
cd "$PROJ_DIR"

if [ "$MODE" = "system" ]; then
    if [ "$EUID" -ne 0 ]; then
        echo "Error: System-wide installation requires root/sudo privileges."
        exit 1
    fi

    echo "--> Starting System-wide installation..."
    
    # Crear usuario ffmpeg-gui
    if ! id "ffmpeg-gui" &>/dev/null; then
        echo "Creating dedicated system user: ffmpeg-gui"
        useradd -r -s /usr/sbin/nologin ffmpeg-gui
    fi

    # Asignar grupos de hardware
    for group in video audio render; do
        if getent group "$group" >/dev/null; then
            echo "Adding ffmpeg-gui to group $group"
            usermod -aG "$group" ffmpeg-gui
        fi
    done

    # Crear directorios
    mkdir -p /etc/ffmpeg-gui
    mkdir -p /var/lib/ffmpeg-gui
    mkdir -p /var/log/ffmpeg-gui

    # Configuración INI por defecto
    CONF_FILE="/etc/ffmpeg-gui/ffmpeg-gui.conf"
    if [ ! -f "$CONF_FILE" ]; then
        cat <<EOF > "$CONF_FILE"
[server]
host = 0.0.0.0
port = 8000
log_file = /var/log/ffmpeg-gui/access.log
database = /var/lib/ffmpeg-gui/ffmpeg_gui.db
EOF
    fi

    chown -R ffmpeg-gui:ffmpeg-gui /var/lib/ffmpeg-gui /var/log/ffmpeg-gui /etc/ffmpeg-gui

    # Escribir unidad de systemd
    SERVICE_FILE="/etc/systemd/system/ffmpeg-gui.service"
    cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=FFMPEG-GUI Orchestrator Service
After=network.target

[Service]
Type=simple
User=ffmpeg-gui
Group=ffmpeg-gui
WorkingDirectory=$PROJ_DIR/backend
ExecStart=$PROJ_DIR/venv/bin/python $PROJ_DIR/backend/run_server.py --config $CONF_FILE
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    echo "System-wide service installed. To start it, run:"
    echo "  sudo systemctl enable --now ffmpeg-gui.service"

else
    echo "--> Starting User-space installation..."

    # Crear directorios
    mkdir -p "$HOME/.config/ffmpeg-gui"
    mkdir -p "$HOME/.local/share/ffmpeg-gui"

    # Configuración INI por defecto
    CONF_FILE="$HOME/.config/ffmpeg-gui/ffmpeg-gui.conf"
    if [ ! -f "$CONF_FILE" ]; then
        cat <<EOF > "$CONF_FILE"
[server]
host = 0.0.0.0
port = 8000
database = $HOME/.local/share/ffmpeg-gui/ffmpeg_gui.db
EOF
    fi

    # Escribir unidad de systemd de usuario
    mkdir -p "$HOME/.config/systemd/user"
    SERVICE_FILE="$HOME/.config/systemd/user/ffmpeg-gui.service"
    cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=FFMPEG-GUI Orchestrator Service (User Space)
After=network.target

[Service]
Type=simple
WorkingDirectory=$PROJ_DIR/backend
ExecStart=$PROJ_DIR/venv/bin/python $PROJ_DIR/backend/run_server.py --config $CONF_FILE
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

    systemctl --user daemon-reload
    echo "User-space service installed. To start it, run:"
    echo "  systemctl --user enable --now ffmpeg-gui.service"
    echo ""
    echo "IMPORTANT: To keep the service running when you log out, run:"
    echo "  loginctl enable-linger \$USER"
fi
