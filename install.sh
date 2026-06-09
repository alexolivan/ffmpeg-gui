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

# Verificar herramientas básicas de instalación
verify_installer_tools() {
    local missing=0
    for cmd in python3 node npm; do
        if ! command -v "$cmd" &>/dev/null; then
            echo "Error: '$cmd' is not installed."
            missing=1
        fi
    done
    if [ "$missing" -eq 1 ]; then
        echo "Please install python3, nodejs, and npm before proceeding."
        exit 1
    fi
}

# Paquetes a instalar en Debian/Ubuntu
install_debian_deps() {
    echo "--> Installing system dependencies via apt-get..."
    apt-get update
    apt-get install -y python3-venv python3-pip python3-dev nodejs npm \
                       build-essential cmake git pkg-config yasm nasm \
                       libx264-dev libx265-dev libssl-dev libva-dev libdrm-dev
}

# Paquetes a instalar en RedHat/Fedora/CentOS
install_rhel_deps() {
    echo "--> Installing system dependencies via dnf..."
    dnf groupinstall -y "Development Tools"
    dnf install -y python3-devel nodejs npm cmake git pkgconfig yasm nasm \
                   x264-devel x265-devel openssl-devel libva-devel libdrm-devel
}

# 1. Gestionar dependencias del sistema según el modo
if [ "$MODE" = "system" ]; then
    if [ "$EUID" -ne 0 ]; then
        echo "Error: System-wide installation requires root/sudo privileges."
        exit 1
    fi

    # Auto-detectar e instalar paquetes
    if command -v apt-get &>/dev/null; then
        install_debian_deps
    elif command -v dnf &>/dev/null; then
        install_rhel_deps
    else
        echo "Warning: Unsupported package manager. Please ensure development tools and libraries (x264, x265, openssl, libva, libdrm) are installed manually."
    fi

    # Verificar herramientas indispensables después de la instalación
    verify_installer_tools
else
    # Modo de espacio de usuario: verificar primero ya que no podemos autoinstalar
    verify_installer_tools
    # Modo de espacio de usuario: solo alertar dependencias faltantes
    echo "--> Verifying compilation dependencies for user-space..."
    MISSING_LIBS=()
    for lib in x264 x265 openssl libva libdrm; do
        if ! pkg-config --exists "$lib" 2>/dev/null; then
            MISSING_LIBS+=("$lib")
        fi
    done
    
    MISSING_TOOLS=()
    for tool in gcc make cmake git yasm nasm; do
        if ! command -v "$tool" &>/dev/null; then
            if [ "$tool" = "yasm" ] || [ "$tool" = "nasm" ]; then
                if ! command -v yasm &>/dev/null && ! command -v nasm &>/dev/null; then
                    MISSING_TOOLS+=("yasm/nasm")
                fi
            else
                MISSING_TOOLS+=("$tool")
            fi
        fi
    done

    if [ ${#MISSING_LIBS[@]} -ne 0 ] || [ ${#MISSING_TOOLS[@]} -ne 0 ]; then
        echo "================================================================="
        echo "WARNING: Missing dependencies detected for compiling FFmpeg profiles."
        echo "To build custom FFmpeg profiles from the UI, you should install:"
        [ ${#MISSING_TOOLS[@]} -ne 0 ] && echo "  - Tools: ${MISSING_TOOLS[*]}"
        [ ${#MISSING_LIBS[@]} -ne 0 ] && echo "  - Libraries (pkg-config): ${MISSING_LIBS[*]}"
        echo "Please request your system administrator to install these packages."
        echo "================================================================="
        sleep 2
    fi
fi

# 3. Preparar el entorno virtual de Python (venv) y dependencias
echo "--> Setting up Python virtual environment..."
if [ ! -d "$PROJ_DIR/venv" ]; then
    python3 -m venv "$PROJ_DIR/venv"
fi
"$PROJ_DIR/venv/bin/pip" install --upgrade pip
"$PROJ_DIR/venv/bin/pip" install -r "$PROJ_DIR/backend/requirements.txt"

# 4. Compilar Frontend
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

    chown -R ffmpeg-gui:ffmpeg-gui /var/lib/ffmpeg-gui /var/log/ffmpeg-gui /etc/ffmpeg-gui "$PROJ_DIR"

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
