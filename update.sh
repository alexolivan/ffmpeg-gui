#!/bin/bash
set -e

PROJ_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "--> Checking environment..."
if [ -d "$PROJ_DIR/venv" ]; then
    echo "Updating python packages..."
    "$PROJ_DIR/venv/bin/pip" install -r "$PROJ_DIR/backend/requirements.txt"
fi

echo "--> Compiling frontend..."
cd "$PROJ_DIR/frontend"
npm install
npm run build
cd "$PROJ_DIR"

# Detectar si reiniciamos servicio de usuario o de sistema
if systemctl --user is-active ffmpeg-gui.service &>/dev/null; then
    echo "--> Restarting user-space service..."
    systemctl --user restart ffmpeg-gui.service
elif systemctl is-active ffmpeg-gui.service &>/dev/null; then
    echo "--> Restarting system-wide service..."
    if [ "$EUID" -eq 0 ]; then
        systemctl restart ffmpeg-gui.service
    else
        sudo systemctl restart ffmpeg-gui.service
    fi
else
    echo "Service is not active. Run install.sh or start the service manually."
fi

echo "Update complete."
