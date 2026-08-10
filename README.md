# FFmpeg-GUI Orchestrator

FFmpeg-GUI is a feature-rich orchestrator and management panel designed to compile, automate, monitor, and configure persistent stream pipelines and custom FFmpeg binaries. 

Inspired by high-reliability systems and developer utility, it provides an intuitive wrapper around the FFmpeg CLI, turning complex console commands into visual, resilient, and manageable services.

---

## Core Features

### 🛠️ 1. Custom FFmpeg Toolchain & Automated Builder
- **In-App Compilation**: Compile custom FFmpeg binaries from source directly from the panel. Select specific repository tags and configure compiler options without manual terminal intervention.
- **External SDK Management**: Automated downloading, extraction, and compilation binding for proprietary or complex SDKs:
  - **Blackmagic DeckLink SDK**: Capture and playback support from professional PCIe hardware.
  - **NewTek NDI SDK**: High-quality IP video routing support.
  - **NVIDIA CUDA & NVENC/NVDEC**: Hardware-accelerated decoding/encoding integration.
  - **SRT (Secure Reliable Transport)**: Compiles with `libsrt` support.

### 📺 2. Media Services & Daemon Streams
- **Persistent Pipelines**: Run RTMP, SRT (listener/caller), HLS, NDI, UDP, or ALSA audio streams as persistent background daemons.
- **Boot Sequence Hierarchies**: Configure specific startup ordering and delay gaps to synchronize cross-dependent streams (e.g., waiting for an input stream to initialize before starting a transcoder).
- **GPU/CPU Pipeline Diagramming**: An interactive resource pipeline diagram in the GUI that visually tracks GPU decoding, filtering, encoding, and CPU multiplexing flow.
- **Live Frame Previews**: Periodically captures frame snapshots from active streams to monitor quality directly from the dashboard.

### 🎨 3. Graphical Overlay Studio & Filters
- **Visual Video Overlays**: Fully graphical editor to place, scale, and preview graphic overlays on top of video streams. Includes alignment assistants and dynamic canvas coordinates mapping.
- **Integrated Audio Filters**: GUI controls to chain advanced audio filters:
  - Dynamic range compressors and expanders.
  - Multi-band equalizers (EQ).
  - ALSA capture loopbacks and channel matrix mapping.

### 🛡️ 4. Decoupled Watchdog Recovery
- **Automatic Auto-Start**: Recovers crashed or disconnected streams automatically.
- **Freeze Protection**: Actively monitors process FPS, bitrate, and outputs, force-restarting streams if frames freeze or connection drops.
- **Jittered Backoff**: Uses exponential backoff delays combined with randomized jitter to break lockstep recovery loops and reduce server resource peaks during network outages.

### ⏰ 5. Task Scheduler & Bilateral Cloning
- **Automation Jobs**: Schedule recurring (cron-like) or one-shot encoding tasks (e.g., recording daily broadcasts, scheduled stream dumps).
- **Safety Runtime Limits**: Define max duration timers to automatically clean up active tasks.
- **Bilateral Cloning**: Seamlessly convert any active or stopped media service into a scheduled task template, or duplicate a task config into a running daemon service with a single click.

### 💾 6. Granular Backup & Restore
- **Selective Section Toggles**: Export and import specific configuration parts (e.g., only backing up media services and scheduled tasks while leaving SMTP credentials or network port configs unchanged).
- **Format Verification**: Validates file integrity, application signature, and version compatibility before performing atomic SQLite database insertions and config file updates.

### 🔔 7. State-Based SMTP Notifications
- **Alert Fatigue Prevention**: Stateful notification queue that filters redundant alerts. Emails are dispatched exclusively on initial stream crashes, recovery success, and final retry exhaustion.
- **System Health Checks**: Active warnings for pending SSL/TLS certificate expirations and disk space utilization exceeding 90%.

### 📟 8. CFA635 LCD Display Driver
- **Serial LCD Integration**: Direct driver control for CrystalFontz CFA635 USB/Serial displays. Renders live CPU, RAM, active stream counts, locator beacons, and handles backlight dimming timeouts.
- **Bicolor Status LEDs**: Maps physical LEDs to profile monitors:
  - Heartbeat status indicator.
  - Active stream/service health.
  - Task execution monitor (reflects latest execution results).
  - High-resource alerts.

### 🌐 9. Styling & Localization
- **Multi-Theme Engine**: 5 visual styles (Studio Dark, Cyberpunk Neon, Nordic Frost, Broadcast Light, Warm Paper) loaded instantly without page flash.
- **Full Translations**: English, Spanish, and Catalan interfaces with 100% i18n parity.

---

## Architecture

- **Backend**: FastAPI (Python), SQLite (SQLAlchemy), and Uvicorn.
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, and `react-i18next`.
- **System Wrapper**: Integrates with systemd service units running in user-space or system-wide space.
