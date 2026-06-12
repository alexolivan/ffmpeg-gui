#!/bin/bash
set -e

show_help() {
    echo "Usage: $0 [--purge] [-y | --yes]"
    echo "  --purge: Delete all data, databases, logs, virtual environment and built assets."
    echo "  -y, --yes: Run in non-interactive mode (assume yes to prompts)"
}

PURGE=false
ASSUME_YES=false

# Procesar argumentos
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --purge) PURGE=true; shift ;;
        -y|--yes) ASSUME_YES=true; shift ;;
        -h|--help) show_help; exit 0 ;;
        *) echo "Unknown parameter: $1"; show_help; exit 1 ;;
    esac
done

PROJ_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Mostrar advertencia inicial
echo "================================================================="
echo "                  FFMPEG-GUI UNINSTALLER                         "
echo "================================================================="
echo "This script will stop and remove the ffmpeg-gui service."
if [ "$PURGE" = true ]; then
    echo "WARNING: --purge is active. This will delete:"
    echo "  - All configuration files and databases"
    echo "  - Service logs"
    echo "  - Python virtual environment ($PROJ_DIR/venv)"
    echo "  - Built frontend assets ($PROJ_DIR/frontend/dist & node_modules)"
fi
echo "================================================================="

# Solicitar confirmación interactiva
if [ "$ASSUME_YES" = false ]; then
    read -p "Are you sure you want to proceed with the uninstallation? [y/N]: " confirm || confirm="n"
    if [[ ! "$confirm" =~ ^[yY]([eE][sS])?$ ]]; then
        echo "Uninstallation cancelled by user."
        exit 0
    fi
fi

# Detectar tipo de instalacion activo y desinstalar
if [ -f "/etc/systemd/system/ffmpeg-gui.service" ]; then
    if [ "$EUID" -ne 0 ]; then
        echo "Error: Uninstalling system service requires root/sudo privileges."
        exit 1
    fi
    echo "--> Stopping and removing system-wide service..."
    systemctl stop ffmpeg-gui.service || true
    systemctl disable ffmpeg-gui.service || true
    rm -f /etc/systemd/system/ffmpeg-gui.service
    systemctl daemon-reload

    if [ "$PURGE" = true ]; then
        echo "Purging configuration, database, and logs..."
        rm -rf /etc/ffmpeg-gui
        rm -rf /var/lib/ffmpeg-gui
        rm -rf /var/log/ffmpeg-gui
        if id "ffmpeg-gui" &>/dev/null; then
            userdel ffmpeg-gui || true
        fi
    fi

elif [ -f "$HOME/.config/systemd/user/ffmpeg-gui.service" ]; then
    echo "--> Stopping and removing user-space service..."
    systemctl --user stop ffmpeg-gui.service || true
    systemctl --user disable ffmpeg-gui.service || true
    rm -f "$HOME/.config/systemd/user/ffmpeg-gui.service"
    systemctl --user daemon-reload

    if [ "$PURGE" = true ]; then
        echo "Purging user configurations and database..."
        rm -rf "$HOME/.config/ffmpeg-gui"
        rm -rf "$HOME/.local/share/ffmpeg-gui"
    fi
else
    echo "No active systemd service found."
fi

# Limpieza del Workspace si se solicita Purga
if [ "$PURGE" = true ]; then
    echo "--> Purging development workspace dependencies and builds..."
    rm -rf "$PROJ_DIR/venv"
    rm -rf "$PROJ_DIR/frontend/dist"
    rm -rf "$PROJ_DIR/frontend/node_modules"
    echo "Workspace cleaned."
fi

echo "Uninstallation complete."
