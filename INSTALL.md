# Installation & Upgrade Guide

This guide details the installation, dependency setup, and upgrade workflow for **FFmpeg-GUI**.

---

## System Requirements

- **Operating System**: Linux (Ubuntu 20.04+ or Debian 11+ recommended).
- **Python**: Version 3.10 or higher (with `venv` support).
- **Node.js**: Version 18 or higher (with `npm`).
- **Compiler Tools**: `gcc`, `make`, `pkg-config`, and standard build utilities (required to compile custom FFmpeg binaries).
- **Optional Hardware Tools**:
  - NVIDIA proprietary drivers and CUDA toolkit (for NVENC/NVDEC hardware transcode).
  - CrystalFontz CFA635 USB LCD Display.
  - Blackmagic DeckLink PCIe cards.

---

## 1. Installation

FFmpeg-GUI provides an interactive `install.sh` script supporting two execution contexts.

To run the installation:
```bash
chmod +x install.sh
./install.sh
```

### Option A: System-wide Service (Production Deployment)
- **Target Location**: `/etc/systemd/system/ffmpeg-gui.service`
- **Port Privilege Helper**: Grants `CAP_NET_BIND_SERVICE` capability to the virtual environment's python binary. This allows binding to privileged HTTP/HTTPS ports (80/443) without executing the backend process as root.
- **Dedicated User**: Spawns a dedicated system user/group `ffmpeg-gui:ffmpeg-gui` to run the daemon in isolation.
- **NVIDIA GPU Support**: Installs `nvidia-uvm-init.service` to initialize Unified Memory device nodes at boot, resolving CUDA driver binding delays before the orchestrator launches.

### Option B: User-space Service (Local/Development Deployment)
- **Target Location**: `$HOME/.config/systemd/user/ffmpeg-gui.service`
- **Permissions**: Runs under the current user's session without requiring root privileges.
- **Port Limitation**: Must bind to ports above 1024 (defaults to port `8000`).

---

## 2. Capability Configuration (Privileged Ports)

To allow the Python application to bind to port 80/443 without root:
1. The installer attempts to set capabilities on the Python binary in the virtual environment:
   ```bash
   sudo setcap cap_net_bind_service=+ep $(readlink -f venv/bin/python3)
   ```
2. The systemd service unit includes:
   ```ini
   CapabilityBoundingSet=CAP_NET_BIND_SERVICE
   AmbientCapabilities=CAP_NET_BIND_SERVICE
   ```
3. If capabilities are modified or python packages are updated, capabilities can be re-applied using:
   ```bash
   sudo bash scripts/setup-port-capabilities.sh
   ```

---

## 3. Custom FFmpeg SDK Setup (NDI & DeckLink)

The in-app compiler supports linking external SDKs for NDI and Blackmagic DeckLink:
- **Automatic Retrieval**: When triggering a compilation in the panel, `SdkManager` handles downloading, extracting, and configuring the required files.
- **Local Workspace**: SDK components are stored in the local workspace directory under:
  - `data/sdks/decklink/<version>`
  - `data/sdks/ndi/<version>`
- **Compiler Flags**: The build manager automatically resolves cflags, libraries, and rpath dependencies for these directories during the FFmpeg compilation phase.

---

## 4. Upgrading (Zero-Downtime Updater)

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

## 5. Uninstallation

To remove all configuration files, database data, systemd services, and dependencies:

```bash
chmod +x uninstall.sh
./uninstall.sh
```
*Note: This will stop any active systemd units and remove the local SQLite database. Ensure you have backed up any configurations via the Settings panel before running this.*
