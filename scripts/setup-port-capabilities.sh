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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[Notice] setup-port-capabilities.sh has been superseded by setup-system-capabilities.sh."
echo "[Notice] Delegating execution to setup-system-capabilities.sh..."

exec "$SCRIPT_DIR/setup-system-capabilities.sh" "$@"

