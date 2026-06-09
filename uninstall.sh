#!/bin/bash

show_help() {
    echo "Usage: $0 [--purge]"
    echo "  --purge: Delete all data, databases, and logs."
}

PURGE=false
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --purge) PURGE=true; shift ;;
        -h|--help) show_help; exit 0 ;;
        *) echo "Unknown parameter: $1"; show_help; exit 1 ;;
    esac
done

# Detectar tipo de instalacion activo
if [ -f "/etc/systemd/system/ffmpeg-gui.service" ]; then
    if [ "$EUID" -ne 0 ]; then
        echo "Uninstalling system service requires root/sudo privileges."
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
    else
        echo "Configuration (/etc/ffmpeg-gui), database (/var/lib/ffmpeg-gui), and logs (/var/log/ffmpeg-gui) kept."
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
    else
        echo "Configuration (~/.config/ffmpeg-gui) and database (~/.local/share/ffmpeg-gui) kept."
    fi
else
    echo "No active systemd service found."
fi

echo "Uninstallation complete."
