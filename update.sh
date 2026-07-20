#!/bin/bash
set -e

show_help() {
    echo "Usage: $0 [-y | --yes]"
    echo "  -y, --yes: Run in non-interactive mode (assume yes to prompts)"
}

ASSUME_YES=false

# Procesar argumentos
while [[ "$#" -gt 0 ]]; do
    case $1 in
        -y|--yes) ASSUME_YES=true; shift ;;
        -h|--help) show_help; exit 0 ;;
        *) echo "Unknown parameter: $1"; show_help; exit 1 ;;
    esac
done

PROJ_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Mostrar advertencia inicial
echo "================================================================="
echo "                  FFMPEG-GUI UPDATER                             "
echo "================================================================="
echo "This script will update backend dependencies, compile the latest"
echo "frontend build, and restart the active systemd service."
echo "================================================================="

# Solicitar confirmación interactiva
if [ "$ASSUME_YES" = false ]; then
    read -p "Do you want to proceed with the update? [y/N]: " confirm || confirm="n"
    if [[ ! "$confirm" =~ ^[yY]([eE][sS])?$ ]]; then
        echo "Update cancelled by user."
        exit 0
    fi
fi

# ---------------------------------------------------------
# [PHASE 1/3] Updating Python Virtual Environment
# ---------------------------------------------------------
echo ""
echo "[PHASE 1/3] Updating Python Virtual Environment..."
if [ -d "$PROJ_DIR/venv" ]; then
    "$PROJ_DIR/venv/bin/pip" install --upgrade pip
    "$PROJ_DIR/venv/bin/pip" install -r "$PROJ_DIR/backend/requirements.txt"
else
    echo "Warning: Python virtual environment not found at $PROJ_DIR/venv. Run install.sh first."
fi

# ---------------------------------------------------------
# [PHASE 2/3] Building Frontend Assets
# ---------------------------------------------------------
echo ""
echo "[PHASE 2/3] Building Frontend Assets..."
if [ -d "$PROJ_DIR/frontend" ]; then
    cd "$PROJ_DIR/frontend"
    npm ci
    npm run build
    cd "$PROJ_DIR"
else
    echo "Error: Frontend directory not found at $PROJ_DIR/frontend."
    exit 1
fi

# ---------------------------------------------------------
# [PHASE 3/3] Restarting Systemd Service
# ---------------------------------------------------------
echo ""
echo "[PHASE 3/3] Restarting Systemd Service..."
if systemctl --user is-active ffmpeg-gui.service &>/dev/null; then
    echo "--> Restarting user-space service..."
    systemctl --user restart ffmpeg-gui.service
    echo "User-space service restarted successfully!"
elif systemctl is-active ffmpeg-gui.service &>/dev/null; then
    echo "--> Restarting system-wide service..."
    if [ "$EUID" -eq 0 ]; then
        systemctl restart ffmpeg-gui.service
    else
        sudo systemctl restart ffmpeg-gui.service
    fi
    echo "System-wide service restarted successfully!"
else
    echo "Service is not active. Run install.sh or start the service manually."
fi

echo "================================================================="
echo "                      UPDATE COMPLETE                            "
echo "================================================================="
echo ""
