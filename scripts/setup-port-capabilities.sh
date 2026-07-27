#!/usr/bin/env bash
# ==============================================================================
# FFmpeg-GUI - Port Capability & Privilege Setup Script
# Grants CAP_NET_BIND_SERVICE to allow binding privileged TCP ports 80 & 443
# without running ffmpeg-gui as root.
# ==============================================================================

set -e

if [ "$EUID" -ne 0 ]; then
  echo "Error: This setup script must be run as root (or via sudo)."
  exit 1
fi

SYSTEM_SERVICE="/etc/systemd/system/ffmpeg-gui.service"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJ_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_PYTHON="$PROJ_DIR/venv/bin/python3"

echo "================================================================="
echo "  FFmpeg-GUI Port Privilege Setup (CAP_NET_BIND_SERVICE)"
echo "================================================================="

if [ -f "$SYSTEM_SERVICE" ]; then
    echo "--> Systemd service file found at $SYSTEM_SERVICE"
    if ! grep -q "AmbientCapabilities=CAP_NET_BIND_SERVICE" "$SYSTEM_SERVICE"; then
        echo "--> Injecting CAP_NET_BIND_SERVICE capabilities into $SYSTEM_SERVICE..."
        sed -i '/\[Service\]/a CapabilityBoundingSet=CAP_NET_BIND_SERVICE\nAmbientCapabilities=CAP_NET_BIND_SERVICE' "$SYSTEM_SERVICE"
        systemctl daemon-reload
        echo "--> Systemd daemon reloaded successfully."
    else
        echo "--> Systemd service already has CAP_NET_BIND_SERVICE enabled."
    fi
fi

if [ -f "$VENV_PYTHON" ] && command -v setcap >/dev/null 2>&1; then
    REAL_PYTHON="$(readlink -f "$VENV_PYTHON")"
    echo "--> Setting binary capability cap_net_bind_service=+ep on $REAL_PYTHON..."
    setcap cap_net_bind_service=+ep "$REAL_PYTHON" 2>/dev/null || echo "Info: Systemd service AmbientCapabilities will be used for port 80/443 binding."
fi

echo "--> Setup complete! ffmpeg-gui can now bind to ports 80 and 443."
