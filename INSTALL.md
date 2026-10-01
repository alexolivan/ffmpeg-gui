# Installation & Upgrade Guide

This guide details the installation, dependency setup, and upgrade workflow for **FFmpeg-GUI**.

---

## System Requirements

- **Operating System**: Linux (Ubuntu 20.04+ or Debian 11+ recommended).
- **Python**: Version 3.10 or higher (with `venv` support).
- **Node.js**: Version 18 or higher (with `npm`).
- **Compiler Tools & Libraries**: `gcc`, `make`, `pkg-config`, `yasm`/`nasm`, and development headers (`libx264-dev`, `libx265-dev`, `libssl-dev`, `libfdk-aac-dev`, `libmp3lame-dev`, `libvorbis-dev`, `libopus-dev`, `libasound2-dev`, `libxml2-dev`, `libxslt1-dev`) required to compile custom FFmpeg and Icecast2 binaries.
- **Audio & System Utilities**: `alsa-utils` (provides `amixer`, required for soundcard mixer controls and AudioScience matrix routing), `libasound2-plugins` (installed automatically by `install.sh --system`), and `apulse` (PulseAudio emulation wrapper for ALSA, enabling audio playback in Firefox Kiosks without running PulseAudio/PipeWire daemons).
- **ALSA Loopback Kernel Driver (`snd-aloop`)**: Required for capturing Virtual Desktop and Web Kiosk audio into FFmpeg pipelines without PulseAudio/PipeWire. Automatically loaded and persisted by `install.sh --system`.
- **Optional System Packages**: Standard `icecast2` package (`sudo apt install icecast2`) can be installed directly from Debian/Ubuntu repositories if source compilation via Forge is not desired.
- **Optional Hardware Tools**:
  - NVIDIA GPU with proprietary drivers & CUDA toolkit (optional for hardware acceleration; system compiles and runs on CPU-only hosts without NVIDIA drivers).
  - Intel graphics processors with QSV / VAAPI media drivers (e.g., `intel-media-driver` for low-overhead hardware transcoding) and `intel-gpu-tools` for real-time engine and VRAM telemetry.
  - Blackmagic DeckLink PCIe cards (requires `desktopvideo` Linux drivers and DeckLink SDK uploaded in the Forge).
  - Magewell capture devices (HDMI/SDI capture routed via V4L2).
  - AudioScience & ALSA professional soundcards (ALSA audio matrix, mixer topology, and hardware faders; requires `alsa-utils`).
  - CrystalFontz CFA635 USB LCD Display.

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
- **Privilege & Telemetry Capabilities**: Grants `CAP_NET_BIND_SERVICE` to allow binding to privileged HTTP/HTTPS ports (80/443), and `CAP_PERFMON` / `CAP_SYS_ADMIN` to `intel_gpu_top` (from `intel-gpu-tools`) for non-root GPU hardware monitoring.
- **Dedicated User**: Spawns a dedicated system user/group `ffmpeg-gui:ffmpeg-gui` to run the daemon in isolation.
- **NVIDIA GPU Support**: The installer automatically detects if an NVIDIA GPU is present. If found, it installs `nvidia-uvm-init.service` to initialize Unified Memory device nodes at boot, resolving CUDA driver binding delays before the orchestrator launches. If no NVIDIA GPU is present, this unit is skipped, and the orchestrator runs on CPU.

### Option B: User-space Service (Local/Development Deployment)
- **Target Location**: `$HOME/.config/systemd/user/ffmpeg-gui.service`
- **Permissions**: Runs under the current user's session without requiring root privileges.
- **Port Limitation**: Must bind to ports above 1024 (defaults to port `8000`).

---

## 2. Capability Configuration (Privileged Ports & Hardware Telemetry)

To allow the Python application to bind to port 80/443 and monitor Intel GPU metrics without running as root:
1. The installer sets capabilities on the Python binary and `intel_gpu_top`:
   ```bash
   sudo setcap cap_net_bind_service=+ep $(readlink -f venv/bin/python3)
   sudo setcap cap_perfmon,cap_sys_admin=+ep $(which intel_gpu_top)
   ```
2. The systemd service unit includes:
   ```ini
   CapabilityBoundingSet=CAP_NET_BIND_SERVICE CAP_PERFMON CAP_SYS_ADMIN
   AmbientCapabilities=CAP_NET_BIND_SERVICE
   ```
3. If capabilities are modified or python packages are updated, capabilities can be verified and re-applied using:
   ```bash
   sudo bash scripts/setup-system-capabilities.sh
   ```

---

## 3. Virtual Desktop Audio Loopback (`snd-aloop`)

To route audio played inside Virtual Desktops (e.g., Kiosk browsers like Chromium or Firefox) into FFmpeg pipelines without third-party audio daemons (PulseAudio/PipeWire), the Linux kernel's `snd-aloop` virtual soundcard driver is utilized.

### Verification
Check if the module and virtual card are registered:
```bash
lsmod | grep snd_aloop
cat /proc/asound/cards
arecord -l
```
When active, `/proc/asound/cards` will display:
```
Card [Loopback]: Loopback - Loopback
```

### Manual Configuration & Persistence
If running in user-space or configuring manually:
1. Load the module in kernel:
   ```bash
   sudo modprobe snd-aloop
   ```
2. Enable persistence across reboots:
   ```bash
   echo "snd-aloop" | sudo tee /etc/modules-load.d/snd-aloop.conf
   ```
3. Set non-conflicting card index and substream allocation (default 8 substreams):
   ```bash
   echo "options snd-aloop index=-2 enable=1 pcm_substreams=8" | sudo tee /etc/modprobe.d/snd-aloop.conf
   ```

> [!TIP]
> If your system requires running more than 8 concurrent Virtual Desktops with isolated audio, increase `pcm_substreams=16` or `32` in `/etc/modprobe.d/snd-aloop.conf`.

---

## 4. Custom FFmpeg SDK Setup (NDI & DeckLink)

The in-app compiler supports linking external SDKs for NDI and Blackmagic DeckLink:
- **Automatic Retrieval**: When triggering a compilation in the panel, `SdkManager` handles downloading, extracting, and configuring the required files.
- **Local Workspace**: SDK components are stored in the local workspace directory under:
  - `data/sdks/decklink/<version>`
  - `data/sdks/ndi/<version>`
- **Compiler Flags**: The build manager automatically resolves cflags, libraries, and rpath dependencies for these directories during the FFmpeg compilation phase.

---

## 5. Upgrading (Zero-Downtime Updater)

The `update.sh` script pulls the latest dependencies, builds the frontend, verifies systemd configurations, and restarts the service. 

Because `ffmpeg-gui` uses **`KillMode=process`** in its systemd units, **restarting the service does not terminate active FFmpeg streams**. The orchestrator will re-attach to the surviving processes on startup and restore telemetry without interruption.

To run the update:
```bash
# Interactive mode
./update.sh

# Non-interactive mode (assumes yes to prompts)
./update.sh -y

# Update dependencies only (without rebuilding frontend or restarting service)
./update.sh --dependencies-only
```

### What `update.sh` does:
1. Verifies network connectivity with air-gap ping fallbacks to prevent update freezes.
2. Updates the Python virtual environment (`venv`) and installs requirements.
3. Checks package-lock hash caches to avoid unnecessary `npm install` runs.
4. Builds production-grade minified assets using Vite.
5. Re-generates systemd configuration capabilities if missing.
6. Gracefully restarts the `ffmpeg-gui` orchestrator process.

---

## 6. Emergency Rescue & Administration CLI (`ffmpeg-gui-admin`)

If you are locked out of the web interface (due to forgotten passwords, brute-force IP lockout, or misconfigured listen ports), the administration CLI allows out-of-band recovery:

```bash
# View active service state, ports, and listening interfaces
./bin/ffmpeg-gui-admin status

# Clear in-memory IP bans (brute-force lockouts)
./bin/ffmpeg-gui-admin reset-lockout

# Reset administrator password
./bin/ffmpeg-gui-admin reset-admin

# Reset all security guards and password in one step
./bin/ffmpeg-gui-admin reset-all
```

---

## 7. Uninstallation

To remove all configuration files, database data, systemd services, and dependencies:

```bash
chmod +x uninstall.sh
./uninstall.sh
```
*Note: This will stop any active systemd units and remove the local SQLite database. Ensure you have backed up any configurations via the Settings panel before running this.*
