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
# [PHASE 1.2/3] Checking & Running Database Migrations
# ---------------------------------------------------------
echo ""
echo "[PHASE 1.2/3] Checking & Running Database Migrations..."
if [ -d "$PROJ_DIR/venv" ]; then
    if [ -f "$PROJ_DIR/backend/database/migration_v2.py" ]; then
        "$PROJ_DIR/venv/bin/python3" "$PROJ_DIR/backend/database/migration_v2.py"
    fi
fi

# ---------------------------------------------------------
# [PHASE 1.5/3] Verifying Systemd Service Units & Capabilities
# ---------------------------------------------------------
echo ""
echo "[PHASE 1.5/3] Verifying Systemd Service Units..."

# 1. System-wide service check
SYSTEM_SERVICE="/etc/systemd/system/ffmpeg-gui.service"
if [ -f "$SYSTEM_SERVICE" ]; then
    # Ensure KillMode=process (so systemd does not kill surviving stream processes on reload)
    if grep -q "KillMode=control-group" "$SYSTEM_SERVICE"; then
        echo "--> Setting KillMode=process in system-wide service..."
        if [ "$EUID" -eq 0 ]; then
            sed -i 's/KillMode=control-group/KillMode=process/g' "$SYSTEM_SERVICE"
            systemctl daemon-reload
        else
            sudo sed -i 's/KillMode=control-group/KillMode=process/g' "$SYSTEM_SERVICE"
            sudo systemctl daemon-reload
        fi
    elif ! grep -q "KillMode=process" "$SYSTEM_SERVICE"; then
        echo "--> Ensuring KillMode=process is configured in system-wide service..."
        if [ "$EUID" -eq 0 ]; then
            sed -i '/\[Service\]/a KillMode=process' "$SYSTEM_SERVICE"
            systemctl daemon-reload
        else
            sudo sed -i '/\[Service\]/a KillMode=process' "$SYSTEM_SERVICE"
            sudo systemctl daemon-reload
        fi
    fi
    
    # Ensure ExecReload=/bin/kill -HUP $MAINPID
    if ! grep -q "ExecReload=" "$SYSTEM_SERVICE"; then
        echo "--> Adding ExecReload warm reload hook to system-wide service..."
        if [ "$EUID" -eq 0 ]; then
            sed -i '/\[Service\]/a ExecReload=\/bin\/kill -HUP $MAINPID' "$SYSTEM_SERVICE"
            systemctl daemon-reload
        else
            sudo sed -i '/\[Service\]/a ExecReload=\/bin\/kill -HUP $MAINPID' "$SYSTEM_SERVICE"
            sudo systemctl daemon-reload
        fi
    fi
    
    # Ensure CAP_NET_BIND_SERVICE capabilities
    if ! grep -q "AmbientCapabilities=CAP_NET_BIND_SERVICE" "$SYSTEM_SERVICE"; then
        echo "--> Ensuring systemd service capabilities (CAP_NET_BIND_SERVICE)..."
        if [ "$EUID" -eq 0 ]; then
            if [ -f "$PROJ_DIR/scripts/setup-port-capabilities.sh" ]; then
                bash "$PROJ_DIR/scripts/setup-port-capabilities.sh" || true
            fi
        else
            if [ -f "$PROJ_DIR/scripts/setup-port-capabilities.sh" ]; then
                sudo bash "$PROJ_DIR/scripts/setup-port-capabilities.sh" || true
            fi
        fi
    fi

    # Ensure NVIDIA UVM systemd initialization unit exists if NVIDIA driver present
    if [ -d "/proc/driver/nvidia" ] || command -v nvidia-modprobe >/dev/null 2>&1; then
        echo "--> NVIDIA GPU driver detected. Ensuring /etc/systemd/system/nvidia-uvm-init.service is up to date..."
        if [ "$EUID" -eq 0 ]; then
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
        else
            sudo bash -c 'cat <<EOF > /etc/systemd/system/nvidia-uvm-init.service
[Unit]
Description=Initialize NVIDIA UVM Device Nodes at Boot
Before=ffmpeg-gui.service
ConditionPathExists=/proc/driver/nvidia

[Service]
Type=oneshot
ExecStart=/bin/sh -c '\''modprobe nvidia_uvm 2>/dev/null || true; if command -v nvidia-modprobe >/dev/null 2>&1; then nvidia-modprobe -u -c 0; fi'\''

[Install]
WantedBy=multi-user.target
EOF'
            sudo systemctl daemon-reload
            sudo systemctl enable --now nvidia-uvm-init.service || true
        fi
    fi
fi

# 2. User-space service check
USER_SERVICE="$HOME/.config/systemd/user/ffmpeg-gui.service"
if [ -f "$USER_SERVICE" ]; then
    # Ensure KillMode=process
    if grep -q "KillMode=control-group" "$USER_SERVICE"; then
        echo "--> Setting KillMode=process in user-space service..."
        sed -i 's/KillMode=control-group/KillMode=process/g' "$USER_SERVICE"
        systemctl --user daemon-reload
    elif ! grep -q "KillMode=process" "$USER_SERVICE"; then
        echo "--> Ensuring KillMode=process is configured in user-space service..."
        sed -i '/\[Service\]/a KillMode=process' "$USER_SERVICE"
        systemctl --user daemon-reload
    fi
    # Ensure ExecReload=/bin/kill -HUP $MAINPID
    if ! grep -q "ExecReload=" "$USER_SERVICE"; then
        echo "--> Adding ExecReload warm reload hook to user-space service..."
        sed -i '/\[Service\]/a ExecReload=\/bin\/kill -HUP $MAINPID' "$USER_SERVICE"
        systemctl --user daemon-reload
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
# [PHASE 3/3] Reloading Systemd Service (Warm Reload)
# ---------------------------------------------------------
echo ""
echo "[PHASE 3/3] Reloading Systemd Service (Warm Reload)..."
if systemctl --user is-active ffmpeg-gui.service &>/dev/null; then
    echo "--> Performing warm reload on user-space service (preserving active streams)..."
    systemctl --user reload ffmpeg-gui.service || systemctl --user restart ffmpeg-gui.service
    echo "User-space service reloaded successfully!"
elif systemctl is-active ffmpeg-gui.service &>/dev/null; then
    echo "--> Performing warm reload on system-wide service (preserving active streams)..."
    if [ "$EUID" -eq 0 ]; then
        systemctl reload ffmpeg-gui.service || systemctl restart ffmpeg-gui.service
    else
        sudo systemctl reload ffmpeg-gui.service || sudo systemctl restart ffmpeg-gui.service
    fi
    echo "System-wide service reloaded successfully!"
else
    echo "Service is not active. Run install.sh or start the service manually."
fi

echo "================================================================="
echo "                      UPDATE COMPLETE                            "
echo "================================================================="
echo ""
