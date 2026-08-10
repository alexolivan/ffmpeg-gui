# FFmpeg-GUI Orchestrator

FFmpeg-GUI is a professional, production-grade orchestrator and management panel designed to control, automate, and monitor persistent FFmpeg streaming pipelines and scheduled encoding tasks. 

Built with **FastAPI (Python)** and **React (TypeScript)**, it provides a high-reliability wrapper around the FFmpeg CLI, turning complex console commands into visual, resilient, and manageable services.

---

## Key Features

### 📺 1. Media Services & Daemon Streams
- **Persistent Pipelines**: Run RTMP, SRT, HLS, NDI, UDP, RTP, or ALSA audio streams as persistent background daemons.
- **Boot Management**: Custom boot order hierarchies, startup delay gaps, and auto-start on system boot.
- **Live Previews**: Periodic high-performance frame capture to visualize live feeds directly from the dashboard.

### 🛡️ 2. Intelligent Watchdog Recovery
- **Automatic Recovery**: Active daemon monitoring with configurable retry policies.
- **Pipeline Freeze Detection**: Automatically detects and restarts frozen pipelines (e.g., frame/time updates stalled for 15s).
- **Startup Grace & Backoff**: Smart exponential backoff with random jitter to prevent lockstep recovery loops on network disconnects.
- **Network Wait Timeout**: Gracefully handles transient network outages before restarting.

### ⏰ 3. Automation & Scheduled Tasks
- **Task Scheduler**: Cron-like recurring or one-shot scheduled encoding runs (e.g., regular archive recordings, scheduled relays).
- **Execution Limits**: Safety duration limits and run-time termination policies.
- **Bilateral Cloning**: Seamlessly duplicate a live media service into a scheduled task template, or clone a task into a service with a single click.

### 📟 4. Hardware Integrations
- **NVIDIA GPU Acceleration**: Automated capabilities scanning (NVENC/NVDEC) and systemd-level NVIDIA Unified Memory (UVM) initialization on boot.
- **CrystalFontz CFA635 LCD Display**: Full driver implementation for CFA635 displays over USB/Serial. Includes live statistics rendering, locator beacons, screen dimming timeout, and bicolor status LEDs representing system status, heartbeat, tasks, and alerts.
- **ALSA Audio Routing**: Automated ALSA soundcard detection, capabilities reporting, and topology visualization.

### 💾 5. pfSense-Style Backup & Restore
- **Granular Backups**: Selectively export subcomponents (General Preferences, Network/SSL certificates, LCD profiles, Log retention, SMTP alerts, Media Services, Scheduled Tasks, Storage volumes).
- **Atomic Import**: Instantly restore configurations with atomic DB insertions and hot-reload of `.conf` file values.

### 🔔 6. SMTP Alerting & Notifications
- **Smart Coalescing**: Reduces alert fatigue by muting repeat warnings. Emails are sent strictly on initial process crashes, finite retry exhaustion, and successful recoveries.
- **SSL & Storage Monitoring**: Alerts for pending Let's Encrypt SSL/TLS expirations and disk space saturation (>90%).

### 🎨 7. Design System & Localization
- **Multi-Theme Engine**: Real-time live theme switching with 5 premium colorways (Studio Dark, Cyberpunk Neon, Nordic Frost, Broadcast Light, Warm Paper).
- **Full Localization (i18n)**: Fully translated into English, Spanish, and Catalan with 100% key parity.

---

## Architecture & Technology Stack

FFmpeg-GUI is designed with a strict Separation of Concerns (SoC) model:

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, and `react-i18next` for localization.
- **Backend**: Python 3.10+, FastAPI (Asynchronous endpoints), SQLAlchemy (ORM with SQLite), and Uvicorn.
- **Process Supervision**: Native Python `asyncio` subprocesses monitored by a decoupled state machine.
- **System Integration**: Managed via `systemd` user-space or system-wide units.

---

## Project Structure

```
├── backend/                  # FastAPI Application
│   ├── core/                 # Core Managers (Process, Task, LCD, ALSA, Notifications)
│   ├── database/             # SQLite Schemas & Migrations
│   ├── tests/                # Comprehensive unit/integration test suite
│   ├── utils/                # CLI helpers and OS utilities
│   ├── main.py               # Main API Router & Bootstrapping
│   └── run_server.py         # Entrypoint script
│
├── frontend/                 # React Application
│   ├── src/
│   │   ├── components/       # Reusable components & modals
│   │   ├── locales/          # Translation dictionaries (en/es/ca)
│   │   └── index.css         # CSS Design Tokens & Themes
│   ├── package.json
│   └── vite.config.ts
│
├── docs/                     # Product Guides & Configuration specifications
├── install.sh                # Interactive install script
├── update.sh                 # Zero-downtime updater
└── uninstall.sh              # Cleanup utility
```

---

## License

This project is proprietary. All rights reserved. Refer to official project documentation for license parameters.
