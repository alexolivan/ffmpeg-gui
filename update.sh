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
# [PHASE 1.5/3] Verifying System Capabilities
# ---------------------------------------------------------
if [ "$EUID" -eq 0 ]; then
    if [ -f "/etc/systemd/system/ffmpeg-gui.service" ]; then
        if ! grep -q "AmbientCapabilities=CAP_NET_BIND_SERVICE" "/etc/systemd/system/ffmpeg-gui.service"; then
            echo "--> Ensuring systemd service capabilities (CAP_NET_BIND_SERVICE)..."
            if [ -f "$PROJ_DIR/scripts/setup-port-capabilities.sh" ]; then
                bash "$PROJ_DIR/scripts/setup-port-capabilities.sh" || true
            fi
        fi
        
        # Ensure NVIDIA UVM systemd initialization unit exists if NVIDIA driver present
        if [ -d "/proc/driver/nvidia" ] || command -v nvidia-modprobe >/dev/null 2>&1; then
            echo "--> NVIDIA GPU driver detected. Ensuring /etc/systemd/system/nvidia-uvm-init.service is up to date..."
            cat <<EOF > /etc/systemd/system/nvidia-uvm-init.service
[Unit]
Description=Initialize NVIDIA UVM Device Nodes at Boot
Before=ffmpeg-gui.service
ConditionPathExists=/proc/driver/nvidia

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'modprobe nvidia_uvm 2>/dev/null || true; if command -v nvidia-modprobe >/dev/null 2>&1; then nvidia-modprobe -u -c 0; fi'

[Install]
WantedBy=multi-user.target
EOF
            systemctl daemon-reload
            systemctl enable --now nvidia-uvm-init.service || true
        fi
    fi
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
