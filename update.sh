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

# Detección de rama, commit y entorno de ejecución
BRANCH="unknown"
COMMIT="unknown"
TAG="untagged"
if command -v git >/dev/null 2>&1 && [ -d "$PROJ_DIR/.git" ]; then
    BRANCH=$(git -C "$PROJ_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "release")
    COMMIT=$(git -C "$PROJ_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")
    TAG=$(git -C "$PROJ_DIR" describe --tags --always 2>/dev/null || echo "untagged")
fi

echo "================================================================="
echo "                  FFMPEG-GUI UPDATER                             "
echo "================================================================="
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
    echo "Environment: [PRODUCTION MODE] (Branch: $BRANCH @ $COMMIT, Tag: $TAG)"
else
    echo "Environment: [DEVELOPMENT / CANARY] (Branch: $BRANCH @ $COMMIT)"
fi
echo "Project Directory: $PROJ_DIR"
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
# [PHASE 0.5/3] Reconciling OS System Dependencies
# ---------------------------------------------------------
echo ""
echo "[PHASE 0.5/3] Auditing & Reconciling OS System Dependencies..."
if [ -f "$PROJ_DIR/install.sh" ]; then
    if [ "$EUID" -eq 0 ]; then
        "$PROJ_DIR/install.sh" --system --dependencies-only -y || true
    elif sudo -n true 2>/dev/null; then
        echo "--> Running install.sh --system --dependencies-only via sudo..."
        sudo "$PROJ_DIR/install.sh" --system --dependencies-only -y || true
    else
        echo "--> Running install.sh --user --dependencies-only..."
        "$PROJ_DIR/install.sh" --user --dependencies-only -y || true
    fi
fi

# ---------------------------------------------------------
# [PHASE 1/3] Updating Python Virtual Environment
# ---------------------------------------------------------
echo ""
echo "[PHASE 1/3] Updating Python Virtual Environment..."
if [ -d "$PROJ_DIR/venv" ]; then
    # Only upgrade pip if online to prevent blocking on air-gapped systems
    if python3 -c "import urllib.request; urllib.request.urlopen('https://pypi.org', timeout=1.5)" 2>/dev/null; then
        "$PROJ_DIR/venv/bin/pip" install --upgrade pip --quiet 2>/dev/null || true
    fi
    "$PROJ_DIR/venv/bin/pip" install --disable-pip-version-check -r "$PROJ_DIR/backend/requirements.txt"
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
# [PHASE 1.5/3] Verifying Systemd Service Units & Rescue CLI
# ---------------------------------------------------------
echo ""
echo "[PHASE 1.5/3] Verifying Systemd Service Units & Rescue CLI..."

# Provision symlink for ffmpeg-gui-admin rescue CLI
if [ -x "$PROJ_DIR/bin/ffmpeg-gui-admin" ]; then
    echo "--> Ensuring ffmpeg-gui-admin rescue CLI is linked in PATH..."
    if [ "$EUID" -eq 0 ]; then
        ln -sf "$PROJ_DIR/bin/ffmpeg-gui-admin" /usr/local/bin/ffmpeg-gui-admin
    elif sudo -n true 2>/dev/null; then
        sudo ln -sf "$PROJ_DIR/bin/ffmpeg-gui-admin" /usr/local/bin/ffmpeg-gui-admin
    elif [ -d "$HOME/.local/bin" ]; then
        ln -sf "$PROJ_DIR/bin/ffmpeg-gui-admin" "$HOME/.local/bin/ffmpeg-gui-admin"
    fi
fi

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
    
    # Ensure system capabilities (network ports & Intel GPU telemetry)
    echo "--> Verifying and applying system capabilities..."
    if [ "$EUID" -eq 0 ]; then
        if [ -f "$PROJ_DIR/scripts/setup-system-capabilities.sh" ]; then
            bash "$PROJ_DIR/scripts/setup-system-capabilities.sh" || true
        fi
    else
        if [ -f "$PROJ_DIR/scripts/setup-system-capabilities.sh" ]; then
            sudo bash "$PROJ_DIR/scripts/setup-system-capabilities.sh" || true
        fi
    fi

    # Ensure motherboard Super I/O hardware sensor drivers are loaded and persisted
    echo "--> Checking motherboard hardware sensor drivers (Super I/O)..."
    if command -v modprobe &>/dev/null; then
        for mod in nct6775 it87; do
            if modprobe "$mod" 2>/dev/null || (command -v sudo &>/dev/null && sudo modprobe "$mod" 2>/dev/null); then
                echo "    Loaded hardware sensor driver: $mod"
                if [ "$EUID" -eq 0 ] && [ -d /etc/modules-load.d ]; then
                    echo "$mod" >> /etc/modules-load.d/ffmpeg-gui-sensors.conf
                fi
            fi
        done
        if [ "$EUID" -eq 0 ] && [ -f /etc/modules-load.d/ffmpeg-gui-sensors.conf ]; then
            sort -u -o /etc/modules-load.d/ffmpeg-gui-sensors.conf /etc/modules-load.d/ffmpeg-gui-sensors.conf
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
# [PHASE 2/3] Building Frontend Assets (Intelligent & Zero-Node)
# ---------------------------------------------------------
echo ""
echo "[PHASE 2/3] Building Frontend Assets..."
HAS_NODE=false
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    HAS_NODE=true
fi

if [ "$HAS_NODE" = true ]; then
    if [ -d "$PROJ_DIR/frontend" ]; then
        cd "$PROJ_DIR/frontend"
        LOCK_HASH_FILE="$PROJ_DIR/frontend/.package_lock_hash"
        CURRENT_HASH=""
        if [ -f "$PROJ_DIR/frontend/package-lock.json" ]; then
            CURRENT_HASH=$(sha256sum "$PROJ_DIR/frontend/package-lock.json" 2>/dev/null | cut -d' ' -f1 || sha1sum "$PROJ_DIR/frontend/package-lock.json" | cut -d' ' -f1)
        fi
        PREV_HASH=""
        if [ -f "$LOCK_HASH_FILE" ]; then
            PREV_HASH=$(cat "$LOCK_HASH_FILE" 2>/dev/null || true)
        fi

        if [ ! -d "$PROJ_DIR/frontend/node_modules" ] || [ "$CURRENT_HASH" != "$PREV_HASH" ]; then
            echo "--> Dependencies updated or node_modules missing. Running clean npm ci (audit and fund suppressed)..."
            npm ci --no-audit --fund=false
            echo "$CURRENT_HASH" > "$LOCK_HASH_FILE"
        else
            echo "--> Frontend dependencies up to date (package-lock.json unchanged). Skipping npm ci."
        fi

        echo "--> Compiling frontend production bundle..."
        npm run build
        cd "$PROJ_DIR"
    else
        echo "Error: Frontend directory not found at $PROJ_DIR/frontend."
        exit 1
    fi
else
    echo "--> Node.js / npm not detected on this host."
    if [ -f "$PROJ_DIR/frontend/dist/index.html" ]; then
        echo "--> Using precompiled production assets in frontend/dist/ (Zero-Node Production mode)."
    else
        echo "Error: Node.js and npm are not installed and precompiled assets were not found in frontend/dist/." >&2
        echo "Please install nodejs and npm, or download an official release tarball containing precompiled assets." >&2
        exit 1
    fi
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
