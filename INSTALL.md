# Installation & Upgrade Guide

This guide details the installation, capability configuration, upgrade, and uninstallation workflows for **FFmpeg-GUI**.

---

## System Requirements

- **Operating System**: Linux (Ubuntu 20.04+ or Debian 11+ recommended).
- **Python**: Version 3.10 or higher (with `venv` support).
- **Node.js**: Version 18 or higher (with `npm`).
- **Media Engine**: `ffmpeg` binary installed and accessible in the system path (compiled with required codecs like `libx264`, `libx265`, `nvenc`, etc.).
- **Optional Hardware**:
  - NVIDIA GPU with CUDA drivers configured.
  - CrystalFontz CFA635 USB LCD Display.

---

## 1. Installation

FFmpeg-GUI provides an interactive `install.sh` script supporting two deployment modes.

To run the installation:
```bash
chmod +x install.sh
./install.sh
```

### Option A: System-wide Service (Production Mode)
- **Target Location**: `/etc/systemd/system/ffmpeg-gui.service`
- **Port Capabilities**: Configured automatically via `setcap` and systemd `AmbientCapabilities`. Allows binding to HTTP port 80 and HTTPS port 443 without running the Python application as root.
- **Dedicated User**: Creates a system user/group `ffmpeg-gui:ffmpeg-gui` to run the daemon in isolation.
- **NVIDIA GPU Support**: Installs `nvidia-uvm-init.service` to initialize GPU Unified Memory device nodes at boot before the orchestrator launches.

### Option B: User-space Service (Development/Local Mode)
- **Target Location**: `$HOME/.config/systemd/user/ffmpeg-gui.service`
- **Permissions**: Runs entirely under the current user's session without requiring root privileges.
- **Port Limits**: Must bind to ports above 1024 (default port `8000`).

---

## 2. Capability Configuration (Privileged Ports)

To allow the Python application to bind to port 80/443 without root:
1. The installer attempts to set capabilities on the Python binary in the virtual environment:
   ```bash
   sudo setcap cap_net_bind_service=+ep $(readlink -f venv/bin/python3)
   ```
2. The systemd service includes:
   ```ini
   CapabilityBoundingSet=CAP_NET_BIND_SERVICE
   AmbientCapabilities=CAP_NET_BIND_SERVICE
   ```
3. If capabilities are modified or python packages are updated, capabilities can be re-applied using:
   ```bash
   sudo bash scripts/setup-port-capabilities.sh
   ```

---

## 3. Upgrading (Zero-Downtime Updater)

The `update.sh` script pulls the latest dependencies, builds the frontend, verifies systemd configurations, and restarts the service. 

Because `ffmpeg-gui` uses **`KillMode=process`** in its systemd units, **restarting the service does not terminate active FFmpeg streams**. The orchestrator will re-attach to the surviving processes on startup and restore telemetry without interruption.

To run the update:
```bash
# Interactive mode
./update.sh

# Non-interactive mode (assumes yes to prompts)
./update.sh -y
```

### What `update.sh` does:
1. Updates the Python virtual environment (`venv`) and installs requirements.
2. Re-generates systemd configuration capabilities if missing.
3. Builds production-grade minified assets using Vite.
4. Reloads the systemd daemon.
5. Gracefully restarts the `ffmpeg-gui` orchestrator process.

---

## 4. Uninstallation

To remove all configuration files, database data, systemd services, and dependencies:

```bash
chmod +x uninstall.sh
./uninstall.sh
```
*Note: This will stop any active systemd units and remove the local SQLite database. Ensure you have backed up any configurations via the Settings panel before running this.*
