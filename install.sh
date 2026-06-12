#!/bin/bash
set -e

# Mostrar uso del script
show_help() {
    echo "Usage: $0 [--user | --system] [-y | --yes]"
    echo "  --user: Install in user space (no root required)"
    echo "  --system: Install system-wide (requires root/sudo)"
    echo "  -y, --yes: Run in non-interactive mode (assume yes to all prompts)"
}

MODE=""
ASSUME_YES=false

# Procesar argumentos
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --user) MODE="user"; shift ;;
        --system) MODE="system"; shift ;;
        -y|--yes) ASSUME_YES=true; shift ;;
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

# Mostrar resumen inicial e información para el sysadmin
echo "================================================================="
echo "                  FFMPEG-GUI INSTALLER                           "
echo "================================================================="
echo "Target Mode: $([ "$MODE" = "system" ] && echo "SYSTEM-WIDE (Systemd System Service)" || echo "USER-SPACE (Systemd User Service)")"
echo "Project Directory: $PROJ_DIR"
if [ "$MODE" = "system" ]; then
    echo "Dedicated User: ffmpeg-gui"
    echo "Systemd Service: /etc/systemd/system/ffmpeg-gui.service"
    echo "Config File: /etc/ffmpeg-gui/ffmpeg-gui.conf"
    echo "Database: /var/lib/ffmpeg-gui/ffmpeg_gui.db"
    echo "System Packages: Will install build tools, libraries, python venv & nodejs"
else
    echo "Systemd User Service: $HOME/.config/systemd/user/ffmpeg-gui.service"
    echo "Config File: $HOME/.config/ffmpeg-gui/ffmpeg-gui.conf"
    echo "Database: $HOME/.local/share/ffmpeg-gui/ffmpeg_gui.db"
    echo "System Packages: Requires python3, nodejs, npm to be preinstalled"
fi
echo "================================================================="

# Solicitar confirmación interactiva
if [ "$ASSUME_YES" = false ]; then
    read -p "Do you want to proceed with the installation? [y/N]: " confirm || confirm="n"
    if [[ ! "$confirm" =~ ^[yY]([eE][sS])?$ ]]; then
        echo "Installation cancelled by user."
        exit 0
    fi
fi

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
                       libx264-dev libx265-dev libssl-dev libva-dev libdrm-dev \
                       libavahi-client-dev libavahi-common-dev
}

# Paquetes a instalar en RedHat/Fedora/CentOS
install_rhel_deps() {
    echo "--> Installing system dependencies via dnf..."
    dnf groupinstall -y "Development Tools"
    dnf install -y python3-devel nodejs npm cmake git pkgconfig yasm nasm \
                   x264-devel x265-devel openssl-devel libva-devel libdrm-devel \
                   avahi-devel
}

# ---------------------------------------------------------
# [PHASE 1/5] Verifying and Installing System Dependencies
# ---------------------------------------------------------
echo ""
echo "[PHASE 1/5] Verifying and Installing System Dependencies..."
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
        echo "Warning: Unsupported package manager. Please ensure development tools and libraries (x264, x265, openssl, libva, libdrm, avahi) are installed manually."
    fi

    # Verificar herramientas indispensables después de la instalación
    verify_installer_tools
else
    # Modo de espacio de usuario: verificar primero ya que no podemos autoinstalar
    verify_installer_tools
    # Modo de espacio de usuario: solo alertar dependencias faltantes
    echo "--> Verifying compilation dependencies for user-space..."
    MISSING_LIBS=()
    for lib in x264 x265 openssl libva libdrm avahi-client avahi-common; do
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

# ---------------------------------------------------------
# [PHASE 2/5] Setting up Python Virtual Environment (venv)
# ---------------------------------------------------------
echo ""
echo "[PHASE 2/5] Setting up Python Virtual Environment..."
if [ ! -d "$PROJ_DIR/venv" ]; then
    python3 -m venv "$PROJ_DIR/venv"
fi
"$PROJ_DIR/venv/bin/pip" install --upgrade pip
"$PROJ_DIR/venv/bin/pip" install -r "$PROJ_DIR/backend/requirements.txt"

# ---------------------------------------------------------
# [PHASE 3/5] Building Frontend Assets
# ---------------------------------------------------------
echo ""
echo "[PHASE 3/5] Building Frontend Assets..."
cd "$PROJ_DIR/frontend"
npm install
npm run build
cd "$PROJ_DIR"

# ---------------------------------------------------------
# [PHASE 4/5] Configuring Directories and Permissions
# ---------------------------------------------------------
echo ""
echo "[PHASE 4/5] Configuring Directories and Permissions..."

if [ "$MODE" = "system" ]; then
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
else
    # Crear directorios de usuario
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
fi

# ---------------------------------------------------------
# [PHASE 5/5] Installing and Configuring Systemd Service
# ---------------------------------------------------------
echo ""
echo "[PHASE 5/5] Installing and Configuring Systemd Service..."

if [ "$MODE" = "system" ]; then
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
else
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
fi

echo "================================================================="
echo "                  INSTALLATION SUCCESSFUL                        "
echo "================================================================="
echo "Service unit written: $SERVICE_FILE"
echo "Configuration file: $CONF_FILE"
echo "================================================================="
echo ""

# Preguntar si se quiere arrancar el servicio de forma automática
START_SERVICE=false
if [ "$ASSUME_YES" = true ]; then
    START_SERVICE=true
else
    read -p "Do you want to enable and start the ffmpeg-gui service now? [y/N]: " start_now || start_now="n"
    if [[ "$start_now" =~ ^[yY]([eE][sS])?$ ]]; then
        START_SERVICE=true
    fi
fi

if [ "$START_SERVICE" = true ]; then
    echo "--> Enabling and starting systemd service..."
    if [ "$MODE" = "system" ]; then
        systemctl enable --now ffmpeg-gui.service
    else
        systemctl --user enable --now ffmpeg-gui.service
    fi
    echo "Service enabled and started successfully!"
else
    echo "Service is installed but not started."
    echo "To start it manually, run:"
    if [ "$MODE" = "system" ]; then
        echo "  sudo systemctl enable --now ffmpeg-gui.service"
    else
        echo "  systemctl --user enable --now ffmpeg-gui.service"
    fi
fi

if [ "$MODE" = "user" ]; then
    echo ""
    echo "IMPORTANT: To keep the user service running when you log out, run:"
    echo "  loginctl enable-linger \$USER"
fi
echo ""
