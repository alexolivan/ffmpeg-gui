#!/usr/bin/env bash
# ==============================================================================
# FFmpeg-GUI - System Privilege & Capability Setup Script
# Configures required Linux kernel capabilities for unprivileged execution:
#   1. CAP_NET_BIND_SERVICE: Allows binding HTTP/HTTPS ports 80 & 443
#   2. CAP_PERFMON, CAP_SYS_ADMIN: Allows non-root Intel GPU hardware metrics
#      via intel_gpu_top (PMU / perf_event_open)
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
echo "  FFmpeg-GUI System Capabilities & Privilege Setup"
echo "================================================================="

# ------------------------------------------------------------------------------
# 1. Systemd Service Unit Configuration (Capability Bounding Set)
# ------------------------------------------------------------------------------
if [ -f "$SYSTEM_SERVICE" ]; then
    echo "--> Systemd service file found at $SYSTEM_SERVICE"
    CHANGED=0

    # Ensure CapabilityBoundingSet contains all required capabilities
    if grep -q "^CapabilityBoundingSet=" "$SYSTEM_SERVICE"; then
        CURRENT_BOUNDING=$(grep "^CapabilityBoundingSet=" "$SYSTEM_SERVICE" | cut -d= -f2)
        if ! grep -q "CAP_PERFMON" "$SYSTEM_SERVICE" || ! grep -q "CAP_SYS_ADMIN" "$SYSTEM_SERVICE"; then
            echo "--> Updating CapabilityBoundingSet to include CAP_PERFMON and CAP_SYS_ADMIN..."
            sed -i 's/^CapabilityBoundingSet=.*/CapabilityBoundingSet=CAP_NET_BIND_SERVICE CAP_PERFMON CAP_SYS_ADMIN/' "$SYSTEM_SERVICE"
            CHANGED=1
        fi
    else
        echo "--> Injecting CapabilityBoundingSet into $SYSTEM_SERVICE..."
        sed -i '/\[Service\]/a CapabilityBoundingSet=CAP_NET_BIND_SERVICE CAP_PERFMON CAP_SYS_ADMIN' "$SYSTEM_SERVICE"
        CHANGED=1
    fi

    # Ensure AmbientCapabilities contains CAP_NET_BIND_SERVICE
    if ! grep -q "^AmbientCapabilities=CAP_NET_BIND_SERVICE" "$SYSTEM_SERVICE"; then
        echo "--> Injecting AmbientCapabilities into $SYSTEM_SERVICE..."
        sed -i '/\[Service\]/a AmbientCapabilities=CAP_NET_BIND_SERVICE' "$SYSTEM_SERVICE"
        CHANGED=1
    fi

    if [ "$CHANGED" -eq 1 ]; then
        systemctl daemon-reload
        echo "--> Systemd daemon reloaded successfully."
    else
        echo "--> Systemd service already has complete capabilities configured."
    fi
fi

# ------------------------------------------------------------------------------
# 2. Port Binding Capabilities (CAP_NET_BIND_SERVICE)
# ------------------------------------------------------------------------------
if [ -f "$VENV_PYTHON" ] && command -v setcap >/dev/null 2>&1; then
    REAL_PYTHON="$(readlink -f "$VENV_PYTHON")"
    echo "--> Setting binary capability cap_net_bind_service=+ep on $REAL_PYTHON..."
    setcap cap_net_bind_service=+ep "$REAL_PYTHON" 2>/dev/null || echo "Info: Systemd service AmbientCapabilities will be used for port 80/443 binding."
fi

# ------------------------------------------------------------------------------
# 3. Intel GPU Telemetry Capabilities (CAP_PERFMON, CAP_SYS_ADMIN)
# ------------------------------------------------------------------------------
INTEL_GPU_TOP="$(command -v intel_gpu_top 2>/dev/null || true)"
if [ -n "$INTEL_GPU_TOP" ] && [ -x "$INTEL_GPU_TOP" ] && command -v setcap >/dev/null 2>&1; then
    REAL_INTEL_TOP="$(readlink -f "$INTEL_GPU_TOP")"
    echo "--> Detected intel_gpu_top at $REAL_INTEL_TOP"
    echo "--> Setting capabilities cap_perfmon,cap_sys_admin=+ep for non-root PMU monitoring..."
    if setcap cap_perfmon,cap_sys_admin=+ep "$REAL_INTEL_TOP" 2>/dev/null; then
        echo "--> Applied capabilities successfully to $REAL_INTEL_TOP: $(getcap "$REAL_INTEL_TOP")"
    else
        echo "Warning: Failed to set capabilities on $REAL_INTEL_TOP. Root or elevated permissions may be needed."
    fi
else
    echo "--> Note: intel_gpu_top not found. If running on an Intel GPU host, install intel-gpu-tools for hardware telemetry."
fi

echo "================================================================="
echo "--> Setup complete! System capabilities configured."
echo "================================================================="
