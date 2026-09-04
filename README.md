# FFmpeg-GUI Orchestrator

FFmpeg-GUI is a feature-rich orchestrator and management panel designed to compile, automate, monitor, and configure persistent stream pipelines and custom FFmpeg binaries. 

Inspired by high-reliability systems and developer utility, it provides an intuitive wrapper around the FFmpeg CLI, turning complex console commands into visual, resilient, and manageable services.

![Dashboard Overview](docs/assets/screenshot1.png)

![Active Services](docs/assets/screenshot2.png)

---

## Core Features

### 🛠️ 1. Multi-Engine Forge & Toolchain Builder
- **In-App Compilation**: Compile custom binaries from source directly from the panel. Select specific repository tags and configure compiler options for multiple software engines:
  - **FFmpeg**: Video/audio transcoding and muxing with full hardware codec bindings.
  - **DeckLink Tools (`decklink-ctl`)**: Headless hardware control and telemetry helper for Blackmagic PCIe devices.
  - **Icecast2**: High-performance audio streaming broadcast server.
  - **MediaMTX**: Multi-protocol zero-dependency media hub (SRT, WebRTC, RTSP).
  - **Kiosk Cog**: Wayland/X11 web kiosk display browser.
- **External SDK Management**: Automated uploading, extraction, and compilation binding for proprietary SDKs:
  - **Blackmagic DeckLink SDK**: Capture and playback support from professional PCIe hardware.
  - **NewTek NDI SDK**: High-quality IP video routing support.
  - **NVIDIA CUDA & NVENC/NVDEC**: Optional hardware-accelerated decoding/encoding integration (compiles cleanly on CPU-only hosts without NVIDIA hardware).
  - **Intel QuickSync (QSV) & VAAPI**: Hardware-accelerated transcoding support for Intel graphics processors.
  - **SRT (Secure Reliable Transport)**: Compiles with `libsrt` support.

![FFmpeg Forge Builder](docs/assets/screenshot5.png)

![Icecast2 Forge Recipes & Build Profiles](docs/assets/screenshot17.png)

### 📺 2. Media Services & Daemon Streams
- **Persistent Pipelines**: Run RTMP, SRT (listener/caller), HLS, NDI, UDP, or ALSA audio streams as persistent background daemons.
- **Boot Sequence Hierarchies**: Configure specific startup ordering and delay gaps to synchronize cross-dependent streams (e.g., waiting for an input stream to initialize before starting a transcoder).
- **GPU/CPU Pipeline Diagramming**: An interactive resource pipeline diagram in the GUI that visually tracks GPU decoding, filtering, encoding, and CPU multiplexing flow.
- **Live Frame Previews**: Periodically captures frame snapshots from active streams to monitor quality directly from the dashboard.

![Hybrid GPU/CPU Transcode Pipeline](docs/assets/screenshot6.png)

![Live Stream Preview & Logs](docs/assets/screenshot3.png)

### ⚡ 3. MediaMTX Hub, Stream Paths & SSL/TLS Integration
- **Multi-Protocol Zero-Dependency Hub**: Deploy standalone MediaMTX daemon instances orchestrated through ephemeral YAML configs written to RAM (`/dev/shm`).
- **Universal Stream Paths & Granular Security**: Configure routing rules (`inherit`, `custom`, `open` LAN modes) with decoupled Publish (Push) and Read (Pull) credentials per path.
- **In-RAM HLS Live Distribution & Storage Persistence**: Serves live HLS ultra-fast from RAM ring buffers without disk wear, with optional continuous stream recording to dedicated HLS storage volumes.
- **Bidirectional SRT Access Control**: Formats and parses SRT stream IDs (`#!::r=<path_id>,m=<publish|request>[,u=...,p=...]`) with interactive Hub connection assistants across FFmpeg sources and destinations.
- **SSL/TLS Security & Collision Protection**: Local Let's Encrypt / custom certificate binding for RTMPS and RTSPS with automatic $+10$ port offset safety allocation.
- **Live Stream Connection Matrix**: 1-click clipboard copy matrix for RTMP/S, RTSP/S, SRT, WebRTC (WHEP/WHIP), and HLS playback/ingest strings.

![MediaMTX Hub Service Configuration](docs/assets/screenshot14.png)

![MediaMTX Stream Connection Matrix & Live URI Generator](docs/assets/screenshot13.png)

### 📻 4. Icecast2 Audio Broadcasting & Radio Hub
- **Native Service Orchestration**: Manage dedicated Icecast2 server daemons directly alongside FFmpeg and MediaMTX pipelines.
- **Dual HTTP & HTTPS/TLS Sockets**: Run unencrypted listener sockets (TCP 7000) and encrypted TLS streams (TCP 7443) simultaneously with automated concatenated PEM certificate bundles.
- **Interactive Server Preview & Live Player**: Monitor stream status with an embedded live web iframe preview, HTML5 in-browser audio player for active mountpoints, listener counters, and real-time logs.
- **Static & Dynamic Mountpoint Management**: Configure granular mountpoints with max audience limits, fallback drop protection (`fallback-mount` / `fallback-override`), and burst buffers.
- **Audience & Telemetry Monitoring**: Real-time `/status-json.xsl` and `/admin/stats.xml` telemetry polling directly into service cards and preview modal.
- **Automated Native Log Rotation & Lifecycle**: Configurable `<logsize>` and `<logarchive>` native rotation coupled with system scheduled tasks (`system://log_rotate`) for automated `.gz` compression, retention purging, and orphan cleanup.
- **FFmpeg Output Hub Integration**: 1-click Icecast destination assistant auto-negotiating container format and MIME types according to audio codecs (MP3, AAC, Opus, FLAC) with broadcast metadata tags (`-ice_name`, `-ice_genre`, `-ice_description`).
- **Recipe Management & Conflict-Free Cloning**: Universal recipe export/import (`software_build_recipe` v2) and dedicated 1-click service cloning with collision-free port allocation.

![Icecast2 Server Configuration & Mountpoints](docs/assets/screenshot16.png)

![Icecast2 Server Preview, Mountpoint Telemetry & Live Player](docs/assets/screenshot15.png)

### 🎛️ 5. Professional AV Hardware & Control
- **Blackmagic DeckLink Hardware Control**: Headless SDI/HDMI connector mapping (half/full duplex), real-time signal lock and format telemetry, and card firmware verification/flashing (`BlackmagicFirmwareUpdater`).
- **Magewell Capture Cards**: Hardware telemetry and routing for Pro Capture / Eco Capture / USB Capture devices (`mwcap-info` / `mwcap-control`), live FPGA temperature monitoring, connector switching, and V4L2/ALSA stream integration.
- **AudioScience Soundcards**: Advanced ALSA hardware support, resolving topology mapping and crosspoint volume matrix routing.
- **Graphical Overlay Studio**: Fully graphical editor to place, scale, and preview graphic overlays on top of video streams.
- **Audio Dynamics & Filters**: Dynamic range compressors, multi-band graphic equalizers, and ALSA loopback routing.

![Blackmagic DeckLink Hardware Control](docs/assets/screenshot10.png)

![Magewell Pro Capture Control & Live Telemetry](docs/assets/screenshot11.png)

![ALSA Audio Routing Matrix](docs/assets/screenshot8.png)

![Graphic EQ & Dynamics Compressor](docs/assets/screenshot7.png)

### 🛡️ 6. Decoupled Watchdog Recovery
- **Automatic Auto-Start**: Recovers crashed or disconnected streams automatically.
- **Freeze Protection**: Actively monitors process FPS, bitrate, and outputs, force-restarting streams if frames freeze or connection drops.
- **Jittered Backoff**: Uses exponential backoff delays combined with randomized jitter to break lockstep recovery loops and reduce server resource peaks during network outages.

### ⏰ 7. Task Scheduler & Bilateral Cloning
- **Automation Jobs**: Schedule recurring (cron-like) or one-shot encoding tasks (e.g., recording daily broadcasts, scheduled stream dumps).
- **Safety Runtime Limits**: Define max duration timers to automatically clean up active tasks.
- **Bilateral Cloning**: Seamlessly convert any active or stopped media service into a scheduled task template, or duplicate a task config into a running daemon service with a single click.

![Scheduled Tasks & Cron Automation](docs/assets/screenshot4.png)

### 🔒 8. HTTPS & Let's Encrypt SSL Manager
- **Automated SSL/TLS Certificates**: Request and renew Let's Encrypt certificates directly from the GUI panel.
- **ACME Challenge Handler**: Integrated HTTP-01 challenge router (`/.well-known/acme-challenge/*`) for automated domain verification.
- **Status & Monitoring**: Real-time display of certificate validity, domain bindings, and automated expiration warnings.

### 💾 9. Granular Backup & Restore
- **Selective Section Toggles**: Export and import specific configuration parts (e.g., only backing up media services and scheduled tasks while leaving SMTP credentials or network port configs unchanged).
- **Format Verification**: Validates file integrity, application signature, and version compatibility before performing atomic SQLite database insertions and config file updates.

### 🗄️ 10. Storage, Log Retention & Branding
- **Storage Management**: Configure local or mounted storage volumes, monitor disk space usage in real time, and trigger notifications if volume capacity exceeds limits.
- **Automated Log Rotation**: Fine-grained settings to define retention limits for application logs, task logs, and stream outputs (`FFmpeg`, `MediaMTX`, `Icecast2`), safely rotating via copytruncate and automatically purging stale data to prevent disk saturation.
- **Branding Customization**: Customize the application name, panel headers, and console branding directly from the interface settings.

### 🔔 11. State-Based SMTP Notifications
- **Alert Fatigue Prevention**: Stateful notification queue that filters redundant alerts. Emails are dispatched exclusively on initial stream crashes, recovery success, and final retry exhaustion.
- **System Health Checks**: Active warnings for pending SSL/TLS certificate expirations and disk space utilization exceeding 90%.

### 📟 12. CFA635 LCD Display Driver
- **Serial LCD Integration**: Direct driver control for CrystalFontz CFA635 USB/Serial displays. Renders live CPU, RAM, active stream counts, locator beacons, and handles backlight dimming timeouts.
- **Bicolor Status LEDs**: Maps physical LEDs to profile monitors:
  - Heartbeat status indicator.
  - Active stream/service health.
  - Task execution monitor (reflects latest execution results).
  - High-resource alerts.

### 🌐 13. Styling & Localization
- **Multi-Theme Engine**: 5 visual styles (Studio Dark, Cyberpunk Neon, Nordic Frost, Broadcast Light, Warm Paper) loaded instantly without page flash.
- **Full Translations**: English, Spanish, and Catalan interfaces with 100% i18n parity.

![Theme Switcher & Localization Settings](docs/assets/screenshot9.png)

![Warm Paper Theme in Task Scheduling](docs/assets/screenshot12.png)

---

## Architecture

- **Backend**: FastAPI (Python), SQLite (SQLAlchemy), and Uvicorn.
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, and `react-i18next`.
- **System Wrapper**: Integrates with systemd service units running in user-space or system-wide space.

---

## Development Note

This project has been developed entirely in pair-programming using AI agent tools (collaborating with Google DeepMind's Antigravity coding assistant).
