# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.10.0] - 2026-09-04

### Added
- **Multi-Engine Software Build Recipe Export & Import Protocol (`software_build_recipe` v2)**:
  - Transitioned Forge build recipe export and import from FFmpeg-centric (`ffmpeg_build_recipe` v1) to a generic, engine-agnostic schema (`software_build_recipe` v2) supporting `ffmpeg`, `icecast2`, `mediamtx`, and future software engines.
  - Retained 100% backward compatibility for existing `ffmpeg_build_recipe` JSON files.
  - Isolated external SDK dependency checks (NDI, DeckLink) strictly to FFmpeg builds.
  - Added dynamic recipe export filenames scoped by software engine (`{software_type}_recipe_{name}.json`) and engine badge feedback during recipe import.
- **Dedicated Atomic Service Cloning Endpoint for Heterogeneous Services**:
  - Implemented `@app.post("/processes/{process_id}/clone")` with automatic conflict-free port re-allocation (`get_next_available_mediamtx_ports` for MediaMTX, `get_next_available_icecast_ports` for Icecast2, and port-offset listener collision resolution for FFmpeg).
  - Integrated Clone Service button directly into `IcecastPreviewModal`.
- **Icecast2 Preview, Profile Export & Legacy Protocol Support**:
  - Implemented live interactive iframe preview with periodic auto-refresh in `IcecastPreviewModal`.
  - Added 1-click Export Profile action button in `IcecastPreviewModal`.
  - Added automatic detection and configuration of legacy Icecast2 SOURCE protocol (`-legacy_icecast 1`) and TLS for managed Icecast endpoints.
  - Added active leases telemetry badge to Icecast2 cards and modals.

### Fixed
- **Icecast2 Multi-Version Compatibility & Log Warnings Resolution**:
  - Eliminated repetitive XSLT 404 error log spam in legacy Icecast 2.3.x instances by verifying `status-json.xsl` stylesheet presence before polling and introducing a universal XML stats fallback (`/admin/stats.xml` with HTTP Basic Auth) that works reliably across all Icecast releases (2.0 to 2.5+).
  - Resolved Icecast 2.5+ configuration obsolescence warnings by dynamically routing TLS certificates to `<tls-context><tls-certificate>` instead of the deprecated `<paths><ssl-certificate>` tag when running Icecast >= 2.5.0, while preserving legacy tag compatibility for 2.4.x and 2.3.x.
  - Added `<prng-seed>/dev/urandom</prng-seed>` injection for Icecast 2.5+ instances to eliminate libigloo PRNG fallback warnings.
  - Enforced strict `0600` (`-rw-------`) file permissions on generated ephemeral configuration files and concatenated SSL PEM bundles to satisfy Icecast 2.5 security permission checks.
- **System SSL Certificate Detection in Icecast Configuration**:
  - Corrected API status endpoint resolution to `/api/settings/ssl/status` and validated certificate payload using `valid` and `days_remaining`.
  - Added real-time active certificate confirmation badge displaying the detected domain in `IcecastConfigForm`.
- **Universal Settings Backup & Restore for Icecast2 Services**:
  - Fixed `/api/backup/export` and `/api/backup/import` to preserve full service `config`, `icecast_config`, `software_version`, and `software_build_id`.
  - Updated Backup & Restore UI copy and translation keys across English, Spanish, and Catalan to explicitly enumerate Icecast servers alongside MediaMTX hubs and FFmpeg broadcast pipelines.

## [2.9.0] - 2026-09-03

### Added
- **Native Icecast2 Server Service Integration**:
  - Full heterogeneous service lifecycle management for Icecast2 instances (`icecast_server`) alongside FFmpeg and MediaMTX.
  - Automated generation of isolated, well-formed `icecast.xml` configurations with runtime log isolation and webroot/adminroot discovery.
  - Dual listen socket architecture supporting plain HTTP and HTTPS/TLS with automatic concatenated PEM bundle creation (`<ssl-certificate>`).
  - Static and dynamic mountpoints management (CRUD) with `max-listeners`, `fallback-mount`, `fallback-override`, `burst-size`, and source password overrides.
  - Real-time `/status-json.xsl` telemetry poller monitoring connected listeners, peak audience, and active mountpoints.
- **Dedicated TCP 7XXX Port Allocator & Pre-Flight Collision Protection**:
  - Allocated Icecast2 in dedicated TCP 7XXX range (base HTTP 7000, base HTTPS 7443, step offset +10) avoiding collisions with MediaMTX (8XXX), web panel, or streaming outputs.
- **Forge Build Engine & Software Manager Enhancements**:
  - Added Xiph GitLab repository integration (`icecast-server.git`) with tag normalization and fallback source distribution mirrors.
  - Registered `libxml2`, `libxslt`, and `libssl-dev` in dependency auditor, with dual system binary detection (`/usr/bin/icecast2` and `icecast`).
- **FFmpeg Icecast Output Assistant & Automated Audio Codec/MIME Resolution**:
  - Interactive destination selector in `DestinationPanel.tsx` supporting 1-click Local Hub integration (auto-populating host, port, mount, and password from managed servers) vs Remote Server manual mode.
  - Automated CLI argument generation mapping audio codecs to proper containers and MIME types (`libmp3lame` → `-f mp3 -content_type audio/mpeg`, `aac` → `-f adts -content_type audio/aac`, `libopus` → `-f ogg -content_type audio/ogg`, `flac` → `-f flac -content_type audio/flac`).
  - Added broadcast stream metadata flags (`-ice_name`, `-ice_genre`, `-ice_description`, `-ice_public`).
- **Modern UI & Full 100% i18n Key Parity**:
  - Added `IcecastConfigForm.tsx` and compact `IcecastServiceCard.tsx` with 1-click access to web admin console (`/admin/`) and live audience telemetry.
  - Added 51 new translation keys with 100% key parity across English, Spanish, and Catalan.

## [2.8.0] - 2026-09-03

### Added
- **Heterogeneous Service Support & Warm Reload Restart Panel in LCD Driver**:
  - CrystalFontz CFA635 / CFA631 display menus now enumerate and manage all service types dynamically (`[FFM]` for FFmpeg, `[MTX]` for MediaMTX Hub, `[ICE]` for Icecast).
  - Dynamic metrics per service type in status detail view (`PATHS:{count} SRT:{port}` for MediaMTX).
  - Added interactive `Restart Panel` action in LCD Main Menu with two-step confirmation dialogue triggering zero-downtime warm reload (`SIGHUP` reload mode) while active streaming processes remain unaffected.
- **Modernized Settings Backup & Restore Facility (v2 Parity)**:
  - Updated `/api/backup/export` and `/api/backup/import` to support universal services, preserving `service_type`, `mediamtx_config`, dependencies leasing flags (`allow_auto_start_deps`, `allow_auto_stop_deps`), and compilation engine bindings.
  - Added dedicated Software Engines & Forge Builds backup section (`software_engines`) with granular export selector and import restoration.
  - Exported and restored modern system preferences: `auto_restart_panel` and `auto_reload_ssl_services`.
  - Modernized `BackupRestoreCard.tsx` UI with categorized selectors, refreshed descriptions, and import preview badge for Software Engines.

## [2.7.0] - 2026-09-01

### Added
- **Warm Reload & Clean Shutdown Lifecycle Architecture**:
  - Implemented standard Linux service lifecycle separation between warm daemon reloads (`systemctl reload` / `update.sh` / Web UI Restart) and full clean service shutdowns (`systemctl stop`).
  - Added `ExecReload=/bin/kill -HUP $MAINPID` and `KillMode=control-group` systemd unit directives with automatic migration in `update.sh` and `install.sh`.
  - Added `SIGHUP` and `SIGUSR1` signal handling in `run_server.py` and `main.py` allowing zero-downtime hot-reloads of orchestrator code without dropping active 24/7 video/audio streams.
  - Implemented `ProcessManager.stop_all_processes(graceful=True)` ensuring clean process termination and zero orphan processes on explicit systemd stops.

### Fixed
- **Settings Persistence & Password Preservation**:
  - Eliminated accidental database password wipes when saving settings without entering a new password.
  - Fixed `UnboundLocalError` on `auto_reload_ssl_services` in `make_settings_response` preventing HTTP 500 errors on `GET /settings`.
  - Added safe fallback branding values for `logo_text` and `node_name` on authentication lock screens and added a custom logo removal action.
  - Resolved `RuntimeError` on Scheduler task event loop discrepancy during Uvicorn shutdown.
- **AudioScience ALSA Matrix Monitoring & Channel Strips**:
  - Filtered out redundant internal monitoring crossover mode enums (`* Monitor Playback Mode`) from hardware output channel strips.
  - Propagated `matrix_source` from backend topology parser and normalized source naming fallback in UI (`Line 0 (Mon)`, `Line 1 (Mon)`).

## [2.6.0] - 2026-08-28

### Added
- **Universal MediaMTX Stream Paths Management & Granular Security**:
  - Implemented full CRUD interface supporting `inherit`, `custom`, and `open` LAN security modes.
  - Decoupled Publish (Push) and Read (Pull) credentials at both global service and individual stream path levels.
- **Bidirectional SRT Access Control Integration**:
  - Implemented SRT stream ID formatting and parsing (`#!::r=<path_id>,m=<publish|request>[,u=...,p=...]`).
  - Integrated interactive, streamlined MediaMTX Hub SRT connection assistant in FFmpeg input and destination forms with masked password previews.
- **In-RAM HLS Live Distribution & Optional Path Recording**:
  - Enabled native in-RAM HLS ring buffer distribution by default (zero disk wear) with configurable segment duration and count.
  - Added optional persistent fMP4/MP4 stream recording to dedicated HLS storage volumes on selected stream paths.
- **Local SSL/TLS Certificate Binding & Port Collision Protection**:
  - Added TLS certificate binding (`serverKey`, `serverCert`, `rtmpServerCert`, `rtspServerCert`) for MediaMTX with automatic RTMPS/RTSPS $+10$ port offset safety allocation.
- **Interactive Stream Connection Matrix & Live URI Generator**:
  - Added real-time connection string generator in `MediaMtxPreviewModal` across RTSP, RTSPS, RTMP, RTMPS, HLS, WebRTC (WHEP/WHIP), and SRT protocols with 1-click clipboard copying.

### Fixed
- **Universal Service Auto-Start & Stale Task Execution Prevention**:
  - Enabled universal service auto-start on boot across all service types (FFmpeg, MediaMTX, Icecast) and eliminated stale historical scheduled task executions on system boot.
- **SQLite Schema Migration Resilience**:
  - Corrected table recreation and column verification order in `software_builds` migrations.

## [2.5.0] - 2026-08-26

### Added
- **Software Engine Registry & Multi-Source Binary Lifecycle**:
  - Implemented centralized **SOFTWARE** management tab in Settings for `FFmpeg`, `MediaMTX`, `Icecast2`, and `Kiosk Cog`.
  - Added support for 3 binary source types: `COMPILED` (Forge), `INSTALLED` (automatic `$PATH` discovery via `which`), and `PRE-COMPILED` (standalone GitHub Release downloads).
  - Implemented strict safety invariant preventing active software engines from disabling all binary sources simultaneously.
  - Added custom engine logo/icon uploader with real-time thumbnail preview, propagating across Forge, Services, and Tasks.
- **Adaptive Process Watchdog by Engine Architecture**:
  - Decoupled transcode-specific checks (zero frames progress `/dev/shm/`, bitrate, speed) from daemon/hub monitoring in `ProcessManager`.
  - MediaMTX, Icecast2, and auxiliary servers are now monitored via a non-intrusive daemon liveness loop (`psutil` for PID liveness and CPU/RAM metrics) eliminating false-positive crash restarts.
- **Modular Frontend Architecture (Dedicated Cards & Modals)**:
  - Extracted `FfmpegServiceCard` preserving video/audio codec, FPS, bitrate, and ABR pipeline metrics.
  - Created `MediaMtxServiceCard` with active protocol matrix (*RTMP :1935, RTSP :8554, WebRTC :8889, SRT :8890, HLS :8888*) and streamlined actions.
  - Extracted `FfmpegPreviewModal` and `MediaMtxPreviewModal` with live terminal audit logs, active listener grid, and log download.
- **Reference-Counted Dependency Leasing Engine & Safety Interlocks**:
  - Implemented singleton `DependencyManager` managing provider leases (`active_leases`) and pinned manual/boot states (`pinned_services`).
  - Implemented *"No estás solo en el mundo"* (active consumers protect provider from premature shutdown) and *"El último que apague la luz"* (graceful shutdown when remaining leases reach 0 on on-demand providers).
  - Added operator capability toggles (`allow_auto_start_deps`, `allow_auto_stop_deps`) in `Service` and `ScheduledTask` configuration.
  - Added auxiliary Hub preset selector in `DestinationPanel` for quick 1-click routing (RTMP, SRT, WHIP).
- **MediaMTX Hub Service Orchestration & Ephemeral In-RAM Configuration**:
  - Implemented `mediamtx_hub` service daemon execution using ephemeral YAML configurations written dynamically to `/dev/shm/` (RAM) with `0600` permissions.
  - Added granular storage isolation for MediaMTX `hls` storage volume (with ring-buffer segment rotation) and dedicated `logs` volume.
  - Extended automated log rotation & retention routine to cover all multi-engine service logs across storage volumes.
  - Added pre-launch socket port validation preventing listening conflicts (RTSP `8554`, RTMP `1935`, HLS `8888`, WebRTC `8889`, SRT `8890`).

## [2.4.0] - 2026-08-24

### Added
- **Magewell Pro & Eco Capture Hardware Orchestration & Live Telemetry**:
  - Integrated native `mwcap-info` and `mwcap-control` driver utilities for deep FPGA telemetry and hardware control without requiring compilation recipes.
  - Implemented `MagewellManager` singleton with PCIe hardware audit (`lspci`/sysfs), driver status detection, live signal lock resolution, color space, and FPGA chipset temperature monitoring.
  - Added dedicated **MAGEWELL** hardware capability card to the Dashboard and management tab to Settings.
  - Added channel configuration modal with hardware video input switching, audio input routing, hardware deinterlacing, and low-latency mode controls.
  - Maintained zero-regression plug & play compatibility with ALSA and V4L2 subsystems (Approach C Hybrid).

## [2.3.0] - 2026-08-21

### Added
- **Desktop Video Carousel & Compact Sub-Device UI**:
  - Implemented carousel navigation for dense multi-channel cards (e.g. *DeckLink Duo 2*, *Quad 2*) with channel pills and lateral controls.
  - Automatically rendered single centered card cleanly without arrows when hardware has a single sub-device/connector (*Intensity Pro*, *DeckLink Mini Recorder*).
  - Maintained persistent physical card selector dropdown in all scenarios.
  - Streamlined spacing, paddings, and typography across the live telemetry and hardware matrix view.
- **Active FFmpeg Services Mapping for DeckLink Devices**:
  - Implemented bidirectional matching between DeckLink hardware channels and running FFmpeg services across `type`, `device`, `format`, and `url` parameters.
- **Strict Storage Type Filtering in Forge**:
  - Filtered storage selectors in `BuildFormModal` strictly by `build` and `builds` types to prevent accidental assignment of log/media storage paths.

### Fixed
- Fixed React hook execution order in `DecklinkSettingsCard` by ensuring `useMemo` hooks execute unconditionally before early loading returns.

## [2.2.0] - 2026-08-21

### Added
- **DeckLink Tools Helper SemVer & Active Default Build Auto-Resolution**:
  - Incremented `decklink-ctl` internal helper tool to `v1.0.1`.
  - Added robust database and filesystem resolution in `DecklinkManager.get_active_helper_path` dynamically locating the exact active default build from the Forge without manual intervention.
  - Added automatic persistence of `binary_path` and `version_output` to SQLite when non-FFmpeg recipes complete compilation in the Forge.
  - Refined DeckLink telemetry key: value rows in Settings UI with natural inline alignment.
  - Sanitized signal locked and video format detection to cleanly handle unconnected physical ports (`No Signal / Auto`).

## [2.1.0] - 2026-08-20

### Added
- **Blackmagic DeckLink Hardware Orchestration & Control (`decklink-ctl`)**:
  - Native C++11 headless helper binary (`backend/forge/sources/decklink-ctl/main.cpp`) utilizing the Blackmagic DeckLink SDK API (`IDeckLinkIterator`, `IDeckLinkProfileAttributes`, `IDeckLinkStatus`, `IDeckLinkConfiguration`).
  - Implemented subcommands for real-time JSON device listing (`list`), signal telemetry (`status`), and connector duplex mode mapping (`configure`).
  - Added compilation recipe `DecklinkToolsRecipe` (`backend/forge/recipes/decklink_tools.py`) in the unified compilation Forge.
- **DeckLink Management Backend & Safety REST API**:
  - Singleton `DecklinkManager` (`backend/core/decklink_manager.py`) orchestrating helper discovery, system package queries (`desktopvideo`), and firmware updater execution (`BlackmagicFirmwareUpdater`).
  - REST endpoints for system status (`GET /api/settings/decklink/status`), real-time signal telemetry (`GET /api/settings/decklink/{device_id}/telemetry`), hardware reconfiguration (`POST /api/settings/decklink/{device_id}/configure`), and card firmware flashing (`POST /api/settings/decklink/{device_index}/firmware-update`).
  - Safety mutual exclusion guard preventing hardware reconfiguration while a DeckLink input/output port is actively used by a running FFmpeg service (`409 Conflict`).
- **DeckLink Settings UI & Hardware Telemetry Rack**:
  - New dedicated `DECKLINK` tab in Settings (`DecklinkSettingsCard.tsx`) with 5-theme dynamic support and zero hardcoded colors.
  - Ecosystem diagnostic banner (OS kernel driver, helper tool availability, firmware integrity, and connected channel count).
  - Interactive connector matrix displaying per-port live signal status, detected video format (`1080p50`, `1080i50`, etc.), colorspace/pixel format, and duplex mode configuration modal.
- **Forge Multi-Engine Navigation & Filtered SDK Inventory**:
  - Expanded Forge navigation tabs supporting `FFmpeg`, `DeckLink Tools`, `Icecast2`, `MediaMTX`, and `Kiosk Cog`.
  - Filtered SDK upload modal (`BuildSdksModal.tsx`) dynamically displaying relevant SDKs when opened from specific compilation profiles.
- **Internationalization (i18n)**:
  - Full translation keys with 100% parity across English (`en.json`), Spanish (`es.json`), and Catalan (`ca.json`).

## [2.0.0] - 2026-08-18

### Added
- **Unified Multi-Type Compilation Forge**:
  - Replaced `FfmpegBuild` with a generic `SoftwareBuild` class and table `software_builds` storing clean, generic software compilation metadata.
  - Implemented modular recipe compilers: `FFmpeg`, `Icecast2`, `MediaMTX`, and `Kiosk Cog`.
  - Added software type dropdown selector in `BuildFormModal` with dynamic validation constraints and conditional tabs (GPU / SDK tabs only display for FFmpeg).
  - Added dynamic software version tag lookup endpoint `/builds/tags/{software_type}`.
  - Added `software_type` badge rendering on `BuildProfileCard` in the unified forge management panel.
- **Off-Repo Existing Database Migration Utility**:
  - Created a database schema migration script `scratch/migrate_builds.py` to upgrade test machines smoothly.

### Fixed & Enhanced
- **Dynamic Muxer & Audio Codec Support for Icecast**:
  - Implemented dynamic container format and content-type selection (`-f mp3`, `-f ogg`, `-f adts`) based on audio codec (`libmp3lame`, `libopus`, `libvorbis`, `aac`).
  - Added system dependency detection and configure flags for `libmp3lame-dev` and `libvorbis-dev` in Forge recipes and `install.sh`.
  - Added fallback header inspection (`lame/lame.h`, `vorbis/codec.h`) for Debian package managers without `.pc` pkg-config manifests.
- **Resilient Process Logging & Startup Error Tracking**:
  - Converted `_log_reader` to use non-blocking `proc.stderr.readline()` for line-by-line streaming without 4 KB chunking delays.
  - Implemented disk-backed log file reading (`process_{id}.log`) for stopped or single-run processes in `GET /processes/{id}/logs`.
  - Attached `_log_reader` immediately at subprocess spawn to capture early exit tracebacks and startup syntax errors.
  - Rendered `🐞 DEBUG` mode badge on service cards when debug logging is active.
- **ALSA Audio Mixer & Topology UI**:
  - Formatted volume readouts with high-precision 1-decimal dB levels and 0–100% normalized percentage indicators.
  - Fixed Mute toggle buttons with explicit `1`/`0` numeric state updates for instant visual UI feedback (Green `ON` / Red `MUTED`).
  - Bound sub-mixer matrix routing modal to a reactive `activeMatrixGroup` selector searching aggregated hardware nodes to preserve all Intel HDA controls in real-time.

## [2.0.0-beta] - 2026-08-11

### Added
- **Unified Multi-Type Service UI Card (`UnifiedServiceCard.tsx`)**:
  - Modular React card component with dynamic slot rendering according to service types (`ffmpeg_stream`, `icecast_server`, `kiosk_browser`, `mediamtx_hub`).
  - Preserved 100% of 1.X Services premium visual design (glassmorphic styling, hover glows, and rounded iconic control buttons: Play `▶`, Stop `⏹`, Restart `🔄`, Logs `📜`, Edit `✏`, Clone `📋`, Delete `🗑`).
  - Added conditional action rendering: "Clone as Task" (`📋`) button is displayed exclusively for `ffmpeg_stream` services.
  - Interactive card click triggers live inspection modal with big video snapshot, GPU/CPU pipeline diagram, and real-time streaming event logs.
  - Integrated read-only implicit dependency badge (`🔗 Linked: Service Name (Auto-managed)`) showing live linked services and consumer reference counts.
  - Added i18n keys for service types and implicit dependency labels across English (`en.json`), Spanish (`es.json`), and Catalan (`ca.json`) with strict key parity.

## [2.0.0-alpha] - 2026-08-11

### Added
- **Unified Services & Dependencies Engine (v2.0 Redesign)**:
  - Replaced legacy `MediaProcess` model with a generic `Service` class storing configuration in a single, schema-agnostic `config` JSON column.
  - Implemented automatic SQLite database migration converting historical `media_processes` records to `services` format on startup, bump schema version to `2.0.0`.
  - Added reference-counting dependency tracking (`ServiceDependency` table) inside `ProcessManager`.
  - Implemented `start_dependencies()` and `stop_unused_dependencies()` to auto-boot dependencies and auto-stop them when reference count falls to 0.
  - Created native REST API endpoints under `/api/services` and `/api/services/{id}/dependencies`.
  - Implemented backwards-compatible shims (Getter/Setter properties and module-level class aliases `MediaProcess = Service`, `ProcessLog = ServiceLog`) ensuring 100% functionality of legacy `/processes` endpoints and unit tests.

## [1.45.0] - 2026-08-07

### Added
- **Backup & Restore System - pfSense Style (`main.py`, `SettingsView.tsx`, `BackupRestoreCard.tsx`)**:
  - Implemented `POST /api/backup/export` endpoint with toggle selection for system settings, media services, scheduled tasks, storage volumes, and notifications.
  - Implemented `POST /api/backup/import` endpoint for atomic JSON backup restoration in SQLite and `.conf` configuration file.
  - Added dedicated **"BACKUP & RESTORE"** sub-tab in `SettingsView.tsx` with interactive export toggles, `.json` file dropzone/uploader, metadata preview box, warning banner, and confirmation modal.
  - Created unit test suite `test_backup_restore_api.py` (`1/1 test PASSED`).
  - Added full i18n key parity across English (`en.json`), Spanish (`es.json`), and Catalan (`ca.json`).

## [1.44.0] - 2026-08-07

### Added
- **Bilateral Service & Task Cloning (`main.py`, `ServicesView.tsx`, `ScheduledTasks.tsx`)**:
  - Implemented `POST /processes/{id}/clone-as-task` endpoint to duplicate a live or stopped `MediaProcess` into a `ScheduledTask` with safe default manual scheduling and safety execution runtime.
  - Implemented `POST /tasks/{id}/clone-as-service` endpoint to duplicate a `ScheduledTask` into a `MediaProcess` service with automatic realtime input handling (`-re` for file inputs) and watchdog auto-recovery defaults.
  - Added interactive **"Copy as Task"** (`services.cloneAsTask`) button on service cards in `ServicesView.tsx`.
  - Added interactive **"Copy as Service"** (`tasks.cloneAsService`) button on task cards in `ScheduledTasks.tsx`.

## [1.43.3] - 2026-08-07

### Fixed
- **i18n Missing Translations Completion (`en.json`, `es.json`, `ca.json`)**:
  - Registered 142 missing translation keys across `sources.*`, `destinations.*`, `forge.*`, `settings.*`, and `common.*` namespaces in English (`en.json`), Spanish (`es.json`), and Catalan (`ca.json`).
  - Restored 100% key parity (744 keys) across all supported languages per Rule X.
  - Eliminated raw un-translated i18n keys in FFmpeg command forge UI (`InputSourcePanel.tsx`, `DestinationPanel.tsx`, `ProcessConfigForm.tsx`, `SettingsView.tsx`, `AlsaAudioSettingsCard.tsx`).

## [1.43.2] - 2026-08-07

### Added
- **On-Boot Retention Cleanup & Maintenance Routine (`task_manager.py`, `main.py`)**:
  - Implemented `TaskManager.execute_on_boot_cleanup()` triggered asynchronously during backend server startup (`startup_event`).
  - Guarantees log rotation and database retention cleanup runs on every boot even if machines were powered off during scheduled midnight cron (`system://log_rotate`).
  - Extended retention cleanup to purge expired `ProcessLog` database records and orphaned `/dev/shm` / `/tmp` progress logs older than 1 day.

## [1.43.1] - 2026-08-07

### Fixed
- **Watchdog Startup Hang Detection (`process_manager.py`)**:
  - Fixed a critical watchdog deadlock where services hanging during startup (e.g. SRT caller socket connection or network stall before producing frames) resulted in an empty progress log file (`0 bytes`), causing `has_had_activity` to remain `False` and bypassing the watchdog stall check indefinitely.
  - Added startup stall timeout evaluation: if a service produces no frames/progress after `network_wait_timeout` (60s default), the watchdog logs an error and force kills the process to trigger automatic recovery.
- **Task Execution Telemetry Payload (`main.py`, `ScheduledTasks.tsx`)**:
  - Restored missing `pid`, `cpu`, `ram`, `fps`, `bitrate`, `speed`, and `retry_count` fields in `GET /tasks` HTTP API response payload (`last_execution`).
  - Bound WebSocket live telemetry stream (`taskExecutions`) to active task cards in `ScheduledTasks.tsx` for real-time rendering.

### Refactored
- **Standalone `FFmpegCommandBuilder` (`core/builders/ffmpeg_builder.py`)**:
  - Extracted FFmpeg CLI command building logic from `ProcessManager` into a dedicated, stateless `FFmpegCommandBuilder` class.
  - Decoupled `TaskManager` from `ProcessManager` instance creation, ensuring both managers call `FFmpegCommandBuilder.build_cmd` cleanly.

## [1.43.0] - 2026-08-06

### Changed
- **ProcessManager as SSOT for FFmpeg Command Generation (`task_manager.py`, `process_manager.py`)**:
  - `TaskManager._build_ffmpeg_cmd` now fully delegates to `ProcessManager._build_ffmpeg_cmd`, eliminating ~620 lines of duplicated command-generation logic that had diverged from the richer service command builder.
  - Tasks now benefit from all ProcessManager features: multi-input format, filter graph, hwaccel, fps_mode, MPEGTS metadata, SRT/UDP/ALSA/HLS outputs, and secondary MJPEG preview output.
  - Fixed `_append_output` to accept `limit_sec` parameter and propagate it correctly through the call chain.
  - Fixed preview file naming: tasks produce `preview_task_{execution_id}.jpg` (unique per execution run), services produce `preview_{proc.id}.jpg`.
  - Added generic `lavfi` input type to `ProcessManager._append_input` to support ScheduledTask input configs using full lavfi expressions in the `path` field.

## [1.42.0] - 2026-08-06

### Added
- **ALSA Audio Hardware Output Support in Task Manager (`task_manager.py`)**:
  - Fixed `_build_ffmpeg_cmd` in `backend/core/task_manager.py` to support `output_type == 'alsa'` (`-f alsa <device>`), matching `process_manager.py` so scheduled tasks configured to output to ALSA soundcards render complete FFmpeg commands.
- **Task Retry Policy & Automatic Watchdog Rescue Loop (`task_manager.py`)**:
  - Implemented automatic retry handling in `task_manager.py` reading `task.retry_policy` (`max_retries`, `retry_delay`). When a task execution fails or hangs, it automatically increments `retry_count`, logs progress, waits `retry_delay` seconds, and restarts execution until retries are exhausted.
- **Unified Task Card UX & Realtime Telemetry (`ScheduledTasks.tsx`)**:
  - Redesigned task cards in `ScheduledTasks.tsx` to display live telemetry (`PID`, `CPU`, `RAM`, `FPS`, `Bitrate`, `Speed`) directly on the card during execution, matching the service cards design.
  - Added live `ABORT` button and `RESCUED X/Y` / `🛡️ WATCHDOG (N)` badges directly on task cards.
  - Removed the redundant top "Realtime Execution Monitor" block, unifying the entire tasks view.

## [1.41.1] - 2026-08-06

### Fixed
- **Task Form Modal Activation Persistence (`ProcessConfigForm.tsx`)**:
  - Fixed `createPayload()` in `ProcessConfigForm.tsx` to explicitly include `is_active: config.is_active` in the JSON payload sent to `onSubmit` when `isTask === true`, ensuring changes to `is_active` persist when saving task edits in the modal form.
- **Toggle Switch UX Redesign (`SchedulingFormSection.tsx`)**:
  - Replaced button badge with the standard, intuitive `peer-checked` toggle switch component matching `LifecycleFormSection.tsx` with `Task Schedule Status: Enabled / Disabled` label for visual parity.

## [1.41.0] - 2026-08-06

### Added
- **Task Form Modal Activation Toggle (`ProcessConfigForm.tsx`, `SchedulingFormSection.tsx`)**:
  - Added `Enable Task Schedule` (`is_active`) toggle switch inside the Task Creation/Editing Modal General tab, allowing operators to set schedule activation state when creating or modifying tasks.
- **Manual Task Execution History Purge (`DELETE /tasks/{task_id}/executions`)**:
  - **Clear History Endpoint**: Added backend endpoint `@app.delete("/tasks/{task_id}/executions")` to delete all historical execution logs for a specific task.
  - **UI Purge Button**: Added **"CLEAR HISTORY"** button (with confirmation warning dialog) in the Task Run History modal (`ScheduledTasks.tsx`).
- **Automated Database Task Log Retention Cleanup (`_execute_log_rotate`)**:
  - Extended system task `system://log_rotate` in `task_manager.py` to automatically purge SQLite `TaskExecution` records older than `retention_days` (default 30 days).

## [1.40.0] - 2026-08-06

### Added
- **Scheduled Tasks Enable/Disable Toggle & 2-Stack UI Parity**:
  - **Enable/Disable State Toggle**: Added `is_active` toggle switch on scheduled task cards to enable or disable recurring cron triggers without deleting the task.
  - **2-Stack Visual Layout**: Restructured `ScheduledTasks.tsx` into two distinct card stacks matching `ServicesView.tsx`: **Active & Scheduled Tasks (Enabled)** vs **Configured Tasks (Disabled / Standby)**.
  - **On-Demand Testing from Disabled Stack**: Enabled the **RUN NOW** button on disabled tasks so operators can test transcode pipelines on-demand without enabling production cron schedules.
  - **Safe Cloning & Import Staging**: Set `is_active = False` by default when cloning or importing tasks, staging new tasks safely in the Disabled stack for audit prior to activation.

### Fixed
- **Audio-Only Telemetry Tag Scoping (`ServicesView.tsx`, `ProcessPreviewModal.tsx`)**:
  - Added `hasVideo` helper strictly hiding FPS tags for audio-only streams (e.g. Icecast playouts).
- **Telemetry Card Digit Length Flickering**:
  - Applied `font-mono tabular-nums` and fixed `min-w-[...]` width containers on telemetry numbers (`CPU`, `RAM`, `FPS`, `Bitrate`, `Speed`).
- **Process Restart Status Preservation (`process_manager.py`, `main.py`)**:
  - Preserved `status = 'restarting'` in DB during restart lifecycle to eliminate UI card flickering between Active and Inactive lists.

## [1.39.0] - 2026-08-05

### Added
- **Proxmox-Style Boot Startup Order & Startup Delay (`auto_start_services`)**:
  - **Startup Order Priority**: Added integer field `startup_order` (default `1`) to specify boot launch hierarchy (order 1 launches before order 2).
  - **Per-Service Startup Delay**: Added integer field `startup_delay` (seconds) to introduce a custom wait time prior to initiating process execution.
  - **Micro-Randomization Jitter**: Added jitter (50ms - 250ms) between process launches to prevent CUDA / DeckLink / NVENC hardware driver race conditions on concurrent starts.
  - **BOOT Card Badges**: Displayed `BOOT (#Order | Delay)` tags on service cards.
- **STOP Service Confirmation Warning Popup**:
  - **UX Parity & Live Stream Safeguard**: Added confirmation dialog on service STOP actions warning the user of immediate live stream signal interruption.
  - **Multi-Language i18n**: Added `stopConfirm` and `restartConfirm` translation keys across `en.json`, `es.json`, and `ca.json`.

### Fixed
- **Synchronous Watchdog Cancellation Protocol (`process_manager.py`)**:
  - **Synchronous Task Death**: Updated `stop_process()` to synchronously await `watchdog_task.cancel()`, ensuring the watchdog task is completely dead before sub-process termination.
  - **PID-Tracked Intentional Stop Set**: Added `stopped_pids` set tracking and explicit `asyncio.CancelledError` handling in `_watchdog()` to eliminate false crash recovery alerts (*"Watchdog: unexpectedly exited. Scheduling restart attempt 1/inf"*).
- **Single-Source HTTP Access Logging (`main.py`)**:
  - **Duplicate Log Suppression**: Attached `logging.NullHandler()` to `uvicorn.access` and bypassed `logger.info()` in `NginxAccessLogMiddleware` when `ACCESS_LOG_PATH` is configured, preventing duplicate log file writes.
- **Inactive Service UI Cleanup & Instant Telemetry Sync (`ServicesView.tsx`, `useProcesses.ts`)**:
  - **Inactive Card Control Cleanup**: Removed redundant STOP button from the `Configured Services (Inactive)` card list.
  - **Instant State Clearing**: Updated WebSocket telemetry listener in `useProcesses.ts` to clear `actionPending` instantly upon target status match (`stopped` or `running`), eliminating UI card freeze during state transitions.

## [1.38.1] - 2026-08-04

### Fixed
- **Strict ROUTE Badge Target Filtering (`AlsaAudioSettingsCard.tsx`)**:
  - **Capture PCM Quadrant Scoping**: Restricted `ROUTE:` badge rendering exclusively to PCM Capture ingestion channels (`isVirtualCapture` / bottom-left quadrant & hardware capture inputs).
  - **Non-Route Enum Exclusion**: Filtered out non-routing Enum controls (crossover modes, channel swap, SPDIF vs AES/EBU digital format selectors) from appearing in the subtext `ROUTE:` badge.

## [1.38.0] - 2026-08-04

### Added
- **ALSA Control Matrix Active Route Badge (`AlsaAudioSettingsCard.tsx`)**:
  - **Subtext Bar ROUTE Badge**: Added an amber/orange badge (`ROUTE: [Source Name]`) in the bottom subtext bar of ALSA channel strips displaying the currently selected capture/routing input at a glance.
  - **Preserved Abacus Grid Alignment**: Kept router control buttons strictly text-free and homogeneous (`w-9 h-8`) to maintain perfect horizontal icon alignment.
  - **Color Palette Consistency**: Matched the amber/orange route badge palette to hardware audio input channels for visual distinction against green FFmpeg process tags.

## [1.37.0] - 2026-08-04

### Added
- **Log Timestamp Timezone Setting (`logging_timestamp_tz`)**:
  - **Settings UI Control**: Added **Log Timestamp Format** dropdown selector in **Settings -> General -> LOGGING CONFIGURATION** with options for `UTC (Universal Coordinated Time - Standard)` and `Local Machine Timezone (Offset)`.
  - **Backend Persistence & Logging**: Persisted `timestamp_tz = utc | local` in `ffmpeg-gui.conf` and updated `ProcessManager` to format process launch and restart log headers according to user timezone preference.
  - **Multilingual Support**: Added translation keys across `en.json`, `es.json`, and `ca.json` with 100% key parity.

## [1.36.1] - 2026-08-04

### Fixed
- **Systemd Unit Update Automation (`update.sh`)**:
  - **Always Update Unit File**: Updated `update.sh` to overwrite `/etc/systemd/system/nvidia-uvm-init.service` with the latest resilient cross-distro unit definition even if the file already exists on the machine.

## [1.36.0] - 2026-08-04

### Added
- **Cross-Distro NVIDIA UVM Systemd Service (`nvidia-uvm-init.service`)**:
  - **Boot Initialization**: Created `/etc/systemd/system/nvidia-uvm-init.service` oneshot systemd unit running `modprobe nvidia_uvm || nvidia-modprobe -u -c 0` as `root` before `ffmpeg-gui.service` starts.
  - **Cross-Distro Resilience**: Added `ConditionPathExists=/proc/driver/nvidia` to ensure non-NVIDIA systems (VAAPI, Intel, AMD, CPU-only) skip the unit cleanly without error.
  - **Lifecycle Automation**: Integrated creation, management, and cleanup in `install.sh`, `update.sh`, and `uninstall.sh`.

### Fixed
- **CUDA Secondary JPEG Preview Restoration**:
  - **Restored Live Dashboard Thumbnails**: Re-enabled secondary 1 fps JPEG preview mapping for CUDA VRAM streams (`is_vram == True`) using `-vf hwdownload,format=nv12,fps=1,scale=480:-1`.

## [1.35.1] - 2026-08-04

### Fixed
- **CLI Flag Adjustments (`-nostdin` removal & `-loglevel info`)**:
  - **Removed `-nostdin`**: Removed `-nostdin` from `ProcessManager._build_ffmpeg_cmd()` to match standard terminal execution behavior.
  - **Adjusted Log level**: Changed debug mode loglevel from `debug` to `info` to prevent FFmpeg CUDA hardware context from querying headless EGL/OpenGL interop symbols during initialization.

## [1.35.0] - 2026-08-04

### Added
- **Diagnostic CLI Command Audit & Debug Logging (`-loglevel debug`)**:
  - **Exact CLI Command Audit Header**: Updated `ProcessManager.start_process()` to print the exact raw FFmpeg command line string (`EXACT CLI COMMAND:\n...`) at the very top of `process_{id}.log` for every process launch and restart.
  - **FFmpeg Verbose Debug Mode**: Enabled `-loglevel debug` flag in `ProcessManager._build_ffmpeg_cmd()` whenever a process has **Debug Mode** enabled (`media_proc.debug_mode == True`).

## [1.34.3] - 2026-08-03

### Fixed
- **Command CLI Preview Progress Path Matching (`process_id`)**:
  - **URL Parameter Propagation**: Updated `POST /processes/preview-cmd` API and `ProcessConfigForm.tsx` to pass and evaluate `process_id` when previewing an existing process command line.
  - **Accurate CLI Display**: Ensures `-progress /dev/shm/ffmpeg_progress_{id}.log` is accurately displayed in the CLI preview modal for saved processes instead of falling back to `_preview.log`.

## [1.34.2] - 2026-08-03

### Fixed
- **Process Log History Retention Across Restarts**:
  - **Preserved Stderr Trace Output**: Updated `ProcessManager.start_process()` to append restart headers (`--- PROCESS RESTART AT ... ---`) to `process_{id}.log` on automatic Watchdog restarts (`is_restart == True`), instead of wiping/truncating the log file to 0 bytes (`wb`).
  - **Crash Diagnostic Visibility**: Ensures previous execution stderr traces are preserved in `data/logs/process_{id}.log` for troubleshooting process crashes.

## [1.34.1] - 2026-08-03

### Fixed
- **CUDA VRAM Dual-Filtergraph Preview Crash (`-map 0:v ... preview_X.jpg`)**:
  - **Embedded Secondary Preview Guard**: Disabled embedding secondary preview JPEG outputs (`-map 0:v -c:v mjpeg -vf hwdownload...`) into main FFmpeg CLI arguments for CUDA/VRAM accelerated streams (`is_vram == True`). This prevents dual-filtering CUDA hardware surface context corruption that caused FFmpeg to crash after 4 seconds (~100 frames).
  - **Progress Log Path Fallback**: Fixed cosmetic progress log path evaluation (`/dev/shm/ffmpeg_progress_None.log`) when constructing preview commands for unsaved processes.

## [1.34.0] - 2026-08-03

### Fixed
- **Boot Concurrency & Hardware Driver Race Conditions (CUDA / NVENC / DeckLink)**:
  - **Global Async Subprocess Spawn Lock (`_spawn_lock`)**: Serialized process spawning in `ProcessManager` with a 1.0s hardware initialization grace gap so multiple FFmpeg instances never contend for CUDA driver contexts (`cuInit`) or DeckLink PCIe hardware locks at the exact same millisecond.
  - **Staggered Auto-Start Loop**: Added a 2.0s staggered delay between auto-started services in `auto_start_services()` on boot, preventing boot-time hardware lock contention.
  - **Anti-Lockstep Watchdog Jitter**: Added process-specific backoff jitter (`(process_id % 5) * 1.0s`) to `_watchdog`, breaking synchronized lockstep restart loops when multiple services crash simultaneously.

## [1.33.1] - 2026-08-03

### Fixed
- **FFmpeg Progress Log & Preview File Permissions (`Permission denied`)**:
  - **`prepare_process_file_permissions` Helper**: Implemented automatic pre-flight file permission reset (`0o666` world read/write) for `/dev/shm/ffmpeg_progress_*.log`, `/tmp/ffmpeg_progress_*.log`, and `/tmp/ffmpeg-gui-previews/preview_*.jpg`.
  - **Permission Conflict Prevention**: Prevents FFmpeg CLI option parser crash (`Failed to open progress URL... Permission denied`) when switching between manual terminal commands executed as `root` and systemd service daemon executed as unprivileged `ffmpeg-gui` user.

## [1.33.0] - 2026-08-03

### Added
- **Boot Reliability & Network Pre-Flight Check**:
  - **Systemd Network Wait Dependency**: Updated `install.sh` systemd unit templates (system & user space) with `After=network.target network-online.target` and `Wants=network-online.target` while strictly preserving `KillMode=process` so live 24/7 streams survive Web GUI panel restarts.
  - **Asynchronous Network Pre-Flight Check (`_async_check_network_readiness`)**: Native 0-dependency network route and DNS resolution readiness check in `ProcessManager` before executing stream restarts.
  - **Configurable Watchdog & Startup Settings**: Added `startup_grace_delay` (default 10s), `network_wait_timeout` (default 60s), and `watchdog_max_backoff` (default 30s) settings in `ffmpeg-gui.conf` and rendered in **WATCHDOG & STARTUP TIMING** card under `SettingsView` General tab.
  - **i18n Multi-Language Translations**: Full translation support in English (`en.json`), Spanish (`es.json`), and Catalan (`ca.json`).

## [1.32.0] - 2026-08-03

### Added
- **ALSA Hardware Controls UX & Performance Refinements**:
  - **Discrete Step Gain Selector (`⚡`)**: Low-step controls (`total_steps <= 6`, e.g. `Front Mic Boost Volume` `0..3`) render a dedicated discrete step button modal with real-time dB calculation (`0 dB`, `+12 dB`, `+24 dB`, `+36 dB`).
  - **60 FPS Synchronous Linked Faders (`<AlsaStereoFaderPair>`)**: Synchronous 60 FPS drag rendering for stereo fader pairs with zero network latency or UI lag.
  - **Smart dB Scale Normalization**: Automatic 0.01 dB scaling (`scale = 100`) for AudioScience & ALSA integer volume controls (`-10000` to `2000` mapped to `-100 dB` to `+20 dB` in 1 dB steps).
  - **Physical Audio Signal Flow Alignment**: Re-ordered channel strip nodes so pre-amp `Boost` controls are positioned directly next to physical connector icons, following natural hardware signal flow (`Bus` -> `Volume` -> `Boost` -> `Connector`).
  - **Master Playout Bus Reclassification**: Routed `Master` / `Master Playback Volume` controls on Intel HDA codecs to **Virtual Playout** (Top-Left Quadrant) for topological clarity.

### Fixed
- **ALSA `amixer cset` Negative Values**: Added `--` CLI option parser terminator to prevent negative numbers (`-2,-2`, `-10000`) from being rejected by `amixer`.
- **`Line` vs `Line Out` Categorization**: Disambiguated `Line` (Hardware Inputs - Bottom Right) from `Line Out` (Hardware Outputs - Top Right).
- **React INP Presentation Delay**: Optimized React render cycles with `React.memo` and `useCallback`, dropping INP presentation delay from 936ms to <16ms.
- **Hardware Output Vumeter Regressions**: Restored peak meters in Top-Right Quadrant via strict word-boundary regex matching.

## [1.31.0] - 2026-07-29

### Added
- **ALSA Audio Hardware GUI Control & Abstraction System**:
  - Native C-API backend wrapper (`AlsaManager` in `backend/core/alsa_manager.py`) using `ctypes` bindings against `libasound.so.2` with C memory safety.
  - Automatic topological classification of raw ALSA control elements into 4 logical quadrants: **Virtual Playout**, **Hardware Outputs**, **Virtual Capture**, and **Hardware Inputs**.
  - Fast-Path WebSocket (`/ws/alsa/meters/{card_index}`) streaming native read-only hardware LED Vumeters (~30Hz) directly onto HTML5 `<canvas>` (0 React DOM re-renders).
  - Broadcast-Grade 4-Quadrant Visual Grid UI (`AlsaAudioSettingsCard.tsx`) in Settings panel under the **ALSA AUDIO** tab.
  - AudioScience-inspired UI/UX rules: fixed compact strip height, synchronized row heights, directional flow arrows (`➔`, `⬅`), and endpoint icons (▶ PLAY, 🔴 REC, 🎤 Mic, 🔊 Speaker, 🎧 Headphones).
  - **Live FFmpeg Process Alias Badges**: Dynamic cross-referencing between running `MediaProcess` instances and ALSA device cards rendering `🏷️ LIVE: Alias` badges on active channels.
  - Multi-channel **Link / Unlink 🔗** toggles for multi-channel audio devices (e.g., Magewell 8-channel SDI capture).

## [1.30.0] - 2026-07-28

### Added
- Asynchronous Email Notifications & Alerting System (`NotificationManager` singleton with `asyncio.Queue` worker).
- State-based failure coalescing for infinite retries (initial crash notice -> silent retry loop -> recovery email after >60s stability).
- SMTP configuration & event trigger controls in Settings UI (Card 5).
- `POST /api/notifications/test` endpoint and **TEST SMTP CONNECTION** button with real-time glassmorphic feedback alert banner.
- Event notification hooks across `ProcessManager`, `TaskManager`, `BuildManager`, `CertificateManager`, and disk storage threshold monitor (>90%).

## [1.29.0] - 2026-07-27

### Added
- Integrated **HTTPS & SSL/TLS Certificate Management** system with standalone ACME (Let's Encrypt) auto-renewal and Custom Certificate Upload.
- Reorganized `Network & Security` Settings view into 3 distinct cards: `ACCESS PASSWORD`, `LISTEN PORTS & NETWORK INTERFACES`, and `SSL / TLS CERTIFICATES`.
- Core `CertificateManager` service with SSOT storage (`data/certs/live/`), keypair cryptographic validation, and event hooks for downstream services.
- System Task #2: `System SSL/TLS Certificate Auto-Renewal Routine` (`system://ssl_renew`) integrated with `ScheduledTasks` execution history and CLI logs.
- Pure Python ACME protocol client (`acme`, `josepy`, `cryptography`) removing system `certbot` binary dependency.
- Automatic temporary TCP Port 80 listener for Let's Encrypt HTTP-01 challenges when running on custom GUI ports.
- Dual HTTP / HTTPS Uvicorn server listeners with automatic HTTP -> HTTPS redirection.
- Dashboard `SYSTEM INFO` telemetry card displaying active SNI Hostname and color-coded expiration counter.

### Fixed
- Resolved false-positive restart warnings in `SettingsView` when logging mode is `journalctl`.
- Fixed local state bindings in `SettingsView` for Network & SSL controls enabling immediate dirty checking and Save Config action.
- Redesigned `sslRenewMessage` into a dedicated glassmorphic alert box.
- Optimized Dashboard `SYSTEM INFO` vertical layout spacing and removed legacy static host OS row.

## [1.28.0] - 2026-07-23

### Added
- Interface Theme System with 5 curated themes (`Studio Dark`, `Cyberpunk Neon`, `Nordic Frost`, `Broadcast Light`, `Warm Paper`).
- Interactive theme selector swatch cards in `SettingsView` with real-time live preview.
- Inline flash-prevention script in `index.html` reading `localStorage` before DOM render.
- Theme configuration persistence in backend settings API and `.conf` file.

## [1.27.0] - 2026-07-23

### Added
- Dedicated SDK Management Modal (`BuildSdksModal`) accessible via `Manage SDKs` button in ForgeView.
- Database persistence for SDK packages via `installed_sdks` table (Schema v1.7.0).
- Strategy pattern processors for `DeckLink` and `NDI` SDK uploads.
- Storage migration for installed SDKs between `sdk` type storage drives.
- Missing SDK safety guard disabling compilation when required SDK versions are missing.

### Changed
- Decoupled and cleaned SDK upload dropzones from `BuildFormModal`.

## [1.26.0] (Frontend) / [1.30.0] (Backend) - 2026-07-22

### Added
- Created `SystemInfoView` (`INFO` option in `MainMenuView`) displaying LAN IP Address, Web GUI Port, Backend Version, Frontend Version, and Node Name with multi-page navigation on 2-row LCD screens.
- Added `recording` LED status profile (`REC `) that blinks in Red when any active service or task is writing output to local disk storage paths (excluding network protocols like HTTP PUT/POST HLS, RTMP, SRT, etc.).
- Added `storage` LED status profile (`STO `) that lights Red when any configured system storage drive or root partition `/` exceeds 90% space utilization.
- Added new LED options (`services`, `resources`, `recording`, `storage`) to `SettingsView.tsx` with full i18n support across English (`en.json`), Spanish (`es.json`), and Catalan (`ca.json`).

### Changed
- Standardized LCD nomenclature from "Streams" to "Services" (`Services: {count}` line in `DashboardView` and `"SRV "` legend prefix).
- Re-labeled "CPU Alert" LED profile to "Resources Alert" (`resources` / `"RES "` legend prefix) checking CPU > 90% or RAM > 90%.

## [1.26.0] (Frontend) - 2026-07-22

### Added
- Completed full multi-language (i18n) refactoring for all form controls, modals, tooltips, warnings, and overlays in Settings (`SettingsView.tsx`) and FFmpeg Forge (`BuildFormModal.tsx`, `BuildProfileCard.tsx`, `BuildTerminal.tsx`).
- Added full translation coverage for LCD integration settings, serial COM port probes, backlight/dimming sliders, status LED profiles, storage drive management, path validation, space utilization details, security password forms, and panel restart confirmation overlays.
- Added full translation coverage for FFmpeg Build Profile creation/editing forms (General tab, GPU Acceleration options & dependency warnings, Third Party SDKs & Protocols, DeckLink/NDI drag-and-drop file uploaders, NDI custom patch uploaders, and Build Terminal log overlay).
- Expanded translation dictionaries (`en.json`, `es.json`, `ca.json`) to 457 keys with 100% key parity across English, Spanish, and Catalan.

## [1.25.0] (Frontend) / [1.29.0] (Backend) - 2026-07-21

### Added
- Integrated full multi-language (i18n) support across `ffmpeg-gui` frontend with English (`en`), Spanish (`es`), and Catalan (`ca`) dictionaries.
- Created `frontend/src/i18n/i18n.ts` initializer module using `i18next` and `react-i18next` with automatic English fallback and `localStorage` language persistence.
- Added dedicated **INTERFACE LANGUAGE** configuration card in `SettingsView.tsx` under General Settings.
- Extended backend `SettingsResponse` and `SettingsUpdate` schemas in `backend/main.py` with `language` persistence to `ffmpeg-gui.conf`.
- Refactored UI views (`Sidebar`, `DashboardView`, `ForgeView`, `InputSourcePanel`, `DestinationPanel`, `FiltersFormSection`) to systematically use `useTranslation()`.
- Added internationalization protocol rule to `.agents/AGENTS.md` enforcing `useTranslation()` and `en.json` single source of truth for future developments.

### Changed
- Added `ForgeIcon` (Lucide Anvil SVG) in `Icons.tsx` replacing wrench icon for La Forja.
- Standardized page headers and subtitles across all views (`ServicesView`, `ScheduledTasks`, `SettingsView`, `ForgeView`, `DashboardView`) to dynamically render translated titles.
- Refactored Services and Scheduled Tasks cards (`SYSTEM` badge, system log cleanup task routines, schedule types, active/disabled status badges, action tooltips, field labels) with `i18n` translations.
- Achieved 100% key parity (309 keys) across English (`en.json`), Spanish (`es.json`), and Catalan (`ca.json`) translation dictionaries.

## [1.24.0] (Frontend) - 2026-07-20

### Added
- Added visual accent color indicator dot to accordion headers and Canvas Badge Accent Color picker with 8 presets for Image layers.
- Assigned automatic unique colors to new layers on creation to distinguish multiple layers of the same format (e.g. multiple PNGs).
- Refactored `OverlayCanvasPreview` elements to measure their actual layout size using `ResizeObserver` and map it dynamically to FFmpeg virtual dimensions.

### Changed
- Configured overlays list to start completely collapsed to reduce layout vertical footprint on tab load.
- Replaced ambiguous reorder arrow icons in accordion headers with vertical arrows (↑/↓) and expand/collapse icons with a pill button (▾ EDIT / ▴ CLOSE).

### Fixed
- Fixed position expression parsing in `overlayPositionHelper.ts` to support negative integer and float margin offsets.
- Isolated the 3-character file format badge (e.g. `PNG`, `JPG`) on the preview canvas to prevent aspect ratio distortion caused by inline layer text labels.

## [1.23.0] (Frontend) - 2026-07-20

### Added
- Integrated 3x3 Broadcast Anchor Grid matrix positioning (9 anchor presets with active state highlighting) and Margin X / Margin Y sliders in `FiltersFormSection.tsx`.
- Refactored `FiltersFormSection.tsx` Overlays sub-tab into a responsive 2-column layout with sticky desktop TV Monitor canvas preview (`OverlayCanvasPreview`) on the left and layer editor controls on the right.
- Added positioning mode toggle per layer (3x3 Broadcast Anchor Grid vs Custom Expression freeform FFmpeg math).
- Enhanced Text overlay parameters with color picker + color presets and optional background box settings (`box=1`, `boxcolor`, `boxborderw`).
- Enhanced Image overlay parameters with Media Storage selector and relative path inputs.

## [1.22.0] (Frontend) - 2026-07-20

### Added
- Created `frontend/src/components/form/OverlayCanvasPreview.tsx` for real-time TV monitor video overlay preview with broadcast safe area guides (Title Safe 80%, Action Safe 90%, Center +) and aspect ratio options (16:9, 4:3, 9:16, 1:1).
- Created `frontend/src/utils/overlayPositionHelper.ts` containing `generateAnchorExpressions`, `parseAnchorFromExpressions`, and `calculateCanvasCoords` for 3x3 grid positioning in Video Overlays Studio.
- Added comprehensive unit tests in `frontend/src/utils/__tests__/overlayPositionHelper.test.ts`.

## [1.21.0] (Frontend) - 2026-07-17

### Added
- Added Logging Configuration settings card in General Settings to manage mode, logs storage, rotation (max bytes and backup count), compression, and retention days.
- Added visual styling and "SYSTEM" badge for system tasks in Scheduled Tasks list.
- Hid Edit and Delete buttons for system tasks while keeping Run Now and Run History/View Logs enabled.

## [1.28.0] (Backend) - 2026-07-17

### Added
- (Backend) Updated `SettingsUpdate` schema to accept new logging configuration fields.
- (Backend) Enhanced `make_settings_response` to read logging configuration from the config file and compare them with active Python logging handlers to flag `restart_required`.
- (Backend) Integrated `POST /settings` endpoint updates to write logging settings into the `.conf` file and query the database to validate storage directories.
- (Backend) Implemented comprehensive unit tests in `backend/tests/test_logging_settings_api.py` covering GET/POST settings endpoints, validation, and active handler state comparison.

## [1.27.0] (Backend) - 2026-07-17

### Added
- (Backend) Added system task execution bypass to bypass standard shell command spawning and run Python internal tasks (prefixed with `system://`).
- (Backend) Seeding of "System Log Rotation and Retention Cleanup" task automatically inside `init_db()` with daily midnight schedule.
- (Backend) Internal log rotation task logic implementation to clean up expired rotated `.gz` logs according to the configured `retention_days`.
- (Backend) Integrated unit tests in `backend/tests/test_system_tasks.py` to cover system task seeding, internal execution, log retention parsing, and execution history database saving.

## [1.26.0] (Backend) - 2026-07-17

### Added
- (Backend) Added `GzippedRotatingFileHandler` which compresses rotated log files using native `gzip` module and purges original uncompressed files.
- (Backend) Added configuration capabilities parsing the `[logging]` section of `ffmpeg-gui.conf` and supporting `journalctl`, `file`, and `both` logging modes.
- (Backend) Integrated unit tests in `backend/tests/test_logging_handler.py` to test Gzipped log rotations and logging configuration logic.

## [1.25.0] (Backend) / [1.5.0] (Database Schema) - 2026-07-17

### Added
- (Backend/Database) Added `is_system` column to `ScheduledTask` model with SQLite migrations to dynamically alter table if it does not exist.
- (Backend) Added comprehensive unit tests in `backend/tests/test_system_task_schema.py` to cover system task schema migrations and database model validation.

## [1.20.0] (Frontend) / [1.24.0] (Backend) / [1.4.0] (Database Schema) - 2026-07-16

### Added
- (Frontend) Added "Modo Debug" toggle, Network Timeout input field, and Logs Storage dropdown selector in the process configuration form.
- (Frontend) Rendered a sleek real-time progress metrics snapshot panel in the process modal when running in normal mode.
- (Frontend) Added a "DEBUG" badge to services cards configured in debug mode.
- (Frontend) Integrated "Descargar Log" button in the debug console preview header.
- (Frontend) Implemented pre-start log deletion confirmation prompts for debug-mode processes when existing console logs reside on the server.
- (Backend/Database) Added `network_timeout`, `debug_mode`, and `log_storage_id` columns to `MediaProcess` model with automatic SQLite schema migrations.
- (Backend) Integrated input network timeouts in command generator for RTMP, RTSP, HTTP, HLS, UDP, and RTP protocols.
- (Backend) Supported background decoupled execution (detaching processes from standard buffers when debug mode is disabled).
- (Backend) Parsed real-time progress stats in the watchdog loop to update DB columns and trigger 15s freeze stall kills.
- (Backend) Added support for re-attaching the watchdog to running processes upon panel restart.

## [1.23.0] (Backend) - 2026-07-16

### Added
- (Backend) Implemented `GET /api/processes/{process_id}/log-exists` endpoint to check process log existence.
- (Backend) Implemented `GET /api/processes/{process_id}/download-log` endpoint to download process log files.
- (Backend) Implemented `GET /api/processes/{process_id}/progress` endpoint to parse real-time progress metrics from shared memory.
- (Backend) Updated `DELETE /processes/{process_id}` endpoint to automatically clean up the associated physical log file from disk.
- (Backend) Added comprehensive unit tests in `backend/tests/test_log_apis.py` to cover log and progress endpoints and automatic log file cleanup.

## [1.22.0] (Backend) - 2026-07-16

### Added
- (Backend) Rewrote `_watchdog` to monitor `/dev/shm` (or `/tmp` fallback) progress files.
- (Backend) Parsed `frame`, `fps`, `bitrate`, `speed`, and `out_time_us` from the progress log, updating real-time process statistics in the database.
- (Backend) Implemented freeze/stall detection in the watchdog loop to force-kill frozen service pipelines if metrics do not change for 15 seconds.
- (Backend) Added support for re-attaching the watchdog to already-running processes upon panel restart, avoiding killing functional streams.
- (Backend) Added unit tests for watchdog stall detection/killing and startup process re-attachment.

## [1.21.0] (Backend) - 2026-07-16

### Added
- (Backend) Resolved logs storage inside `start_process`, falling back to default `"logs"` storage type.
- (Backend) Implemented `network_timeout` limits for RTMP, RTSP, HTTP, HLS, UDP, and RTP inputs.
- (Backend) Appended `-progress` telemetry logging to the FFmpeg arguments.
- (Backend) Supported decoupled/background execution mode when `debug_mode` is `False`, and piped stdout/stderr log reading in debug mode.

## [1.20.0] (Backend) / [1.3.0] (Database Schema) - 2026-07-16


### Added
- (Backend) Added `network_timeout`, `debug_mode`, and `log_storage_id` columns to the `MediaProcess` database model.
- (Backend) Added self-migration rules for the new columns in the `media_processes` table.
- (Backend) Registered and seeded `"Default Logs Storage"` to the default storages.

## [1.19.0] (Frontend) / [1.19.0] (Backend) - 2026-07-10

### Added
- (Frontend) Replaced absolute path inputs in `InputSourcePanel`, `DestinationPanel` (for local recording and local HLS), and `FiltersFormSection` (for overlays) with Storage Selector Dropdowns and Relative Path text inputs.
- (Frontend) Added a warning banner in `DestinationPanel` next to HLS outputs when no HLS storages are configured, and disabled the Deploy/Save buttons in `ProcessConfigForm` to prevent invalid configurations.
- (Backend) Implemented dynamic storage path lookup and resolution in `ProcessManager`, `TaskManager`, and `PreviewManager` using the storage ID and relative path.
- (Backend) Integrated input file existence and output directory writability validations in `ProcessManager` and `TaskManager` to verify paths prior to process spawning.

## [1.18.0] (Frontend) / [1.18.0] (Backend) - 2026-07-10

### Added
- (Frontend) Added a dropdown selector "Build Storage" inside the build profile create/edit form in `BuildFormModal.tsx`.
- (Frontend) Fetches the list of build-type storages from `/api/settings/storages` to populate the dropdown.
- (Frontend) Sends the selected `storage_id` on create/edit requests.
- (Backend) Updated path helpers `get_build_path`, `get_src_path`, `get_install_path`, and `get_disk_usage` in `BuildManager` to accept an optional `builds_root: str = None` argument.
- (Backend) Updated `run_build`, `clean_sources`, and `delete_build` in `BuildManager` to accept `builds_root: str = None` and pass it to any internal path helper calls.
- (Backend) Updated `BuildCreate` and `BuildUpdate` Pydantic schemas to accept `storage_id: Optional[int]`.
- (Backend) Fetch and pass the storage path from the DB for the build profile: `storage_path = build.storage.path if build.storage else None` in compile, delete, and clean endpoints.
- (Backend) In `PUT /builds/{build_id}`, physically migrate the build directory using `shutil.move()` when the `storage_id` is updated, updating the DB record and absolute paths of compiled binaries accordingly.
- (Backend) Added integration test case `test_build_storage_creation_and_migration` in `backend/tests/test_storage_apis.py`.

## [1.17.0] (Frontend) / [1.17.0] (Backend) - 2026-07-10

### Added
- (Frontend) Integrated dynamic **Storage Capacities** subsection inside the System Stats card on the Dashboard, rendering utilization bars and metadata for each configured storage.
- (Frontend) Added a dedicated "Storage" tab in SettingsView with full CRUD capabilities.
- (Frontend) Grouped storage configurations by type (build, media, hls, logs, sdk, preview) with default indicators, directory path validation, and premium space utilization bars.
- (Frontend) Enabled inline editing for storage properties and path testing.
- (Backend) Integrated storage usage telemetry into the broadcast loop: queries configured database storages and calculates space metrics using `shutil.disk_usage` (with grace handling for file/permission errors).
- (Backend) Expanded telemetry test coverage in `backend/tests/test_version_info.py`.

## [1.16.0] (Frontend) / [1.16.0] (Backend) - 2026-07-10

### Added
- (Backend) Implemented Storage CRUD REST API endpoints (`GET`, `POST`, `PUT`, `DELETE /api/settings/storages`).
- (Backend) Implemented `/api/settings/storages/test` preview connection endpoint.
- (Backend) Added disk space usage calculations using `shutil.disk_usage`.
- (Backend) Created comprehensive test suite in `backend/tests/test_storage_apis.py`.
- (Backend) Defined `Storage` database model to represent storage configurations ('build', 'media', 'hls', 'logs', 'sdk', 'preview').
- (Backend) Added a `storage_id` foreign key relation in `FfmpegBuild` model.
- (Backend) Implemented database migration inside `init_db()` to automatically create `storages` table and add `storage_id` column to `ffmpeg_builds` if missing.
- (Backend) Bumped database schema version to `1.2.0`.


## [1.16.0] (Frontend) / [1.14.0] (Backend) - 2026-07-09

### Added
- Added checkbox to enable Adaptive Bitrate (ABR) for HLS streaming in DestinationPanel.
- Implemented HLS Stream Name input field with automatic trailing `.m3u8` extension stripping.
- Added input validation rules for custom HLS variants (resolution format, video/audio bitrate suffixes, with auto-appending "k" suffix for raw digits) and red border indicators on fields failing validation.
- (Frontend) Renamed the Branding tab to "General" and added a "Network Settings" card for configuring the GUI listen port.
- (Frontend) Added restart warning banner, confirmation overlay, and reconnection blocking overlay.
- (Frontend) Implemented panel restart action triggering backend reload, with client-side polling and automatic redirection to the new port.
- (Backend) Integrated `FilterGraphBuilder` for compiling video and audio filters dynamically in HLS ABR flow.
- (Backend) Added dynamic hardware acceleration detection (VRAM/CPU) and automatic encoder transcode stage handling (hwdownload/hwupload) for HLS ABR.
- (Backend) Implemented dynamic naming of master playlist, variant playlists, and TS segment pattern for HLS ABR based on configured `hls_stream_name` and destination path.
- (Backend) Added support for `audio_volume` parameter in `FilterGraphBuilder` to handle raw multiplier/factor volume adjustments.
- (Backend) Add `gui_port` settings update with validation for port range, OS usage, and DB conflicts.
- (Backend) Added bidirectional validation for FFmpeg process ports to block usage of ports reserved by the GUI web panel.

### Fixed
- (Backend) Updated HLS ABR preview command API tests to validate filter integrations, overlays, and audio/video scaling assertions.

## [1.14.0] (Frontend) / [1.11.0] (Backend) - 2026-07-08

### Added
- Filtered out `avahi` from hardware capability cards on the Dashboard.
- Displayed unique, sorted ALSA sound cards under the ALSA capability card when ALSA is active.
- Made the NDI input/output options visible regardless of Avahi daemon availability, adding a warning banner with systemd activation instructions if Avahi is offline.
- Parsed `/proc/asound/cards` inside the capability detection function to extract a list of unique, sorted sound card names and exposed them via the `/system/capabilities` endpoint.
- Added red color-coding to inactive service status bullets and a detailed "ABNORMAL END" warning badge showing watchdog retry counts when a transcoding service halts with errors.
- Updated FFmpeg log telemetry parser to support optional `fps` fields, resolving the issue where speed, bitrate, and telemetry would show up as 0 for audio-only streams (such as ALSA or Icecast outputs).

## [1.13.2] - 2026-07-08

### Added
- Re-enabled full user control on Video/Audio checkboxes (removed rigid lockouts/disables).
- Implemented an interactive warning handler in `handleHasVideoChange`: when enabling video on an audio-only stream, the user can accept to shift the ALSA/Icecast input to INPUT 2 (Secondary Audio Source) and reset INPUT 1 / output to video-compatible defaults.

## [1.13.1] - 2026-07-08

### Added
- Implemented ALSA playout device automatic listing (using `aplay -l` in the backend and exposing `/alsa/playback-devices` route).
- Added dynamic ALSA playout devices dropdown selector in Destination panel with custom manual input fallback.
- Added interactive warning confirmation prompts when switching to an audio-only input or output when video is active, auto-disabling the video stream.
- Locked and disabled stream type checkboxes (Video / Audio) when pure-audio inputs (ALSA capture, HTTP audio stream, or audio generator) are active.

## [1.13.0] - 2026-07-08

### Added
- Integrated ALSA physical soundcard playout (`-f alsa`) support.
- Implemented automatic Audio-Only coercion and interface locking when selecting ALSA or Icecast outputs (automatically disabling the video streams option).
- Created tab state auto-healing redirecting active sub-tabs from video/overlays to audio when video streams are turned off.
- Hid the Transcode GPU/CPU flow diagram inside the General/System section when the stream is in audio-only mode.

## [1.12.0] - 2026-07-07

### Added
- Integrated ISO 10-Band Graphic Equalizer with vertical sliders and real-time SVG logarithmic frequency response curve visualization.
- Implemented Compand dynamic compressor/noise gate with 2D SVG plot mapping transfer function coordinates (-100 to 0 dBFS) over colored VU-meter zones (Gate, Linear, Compression).
- Added final Peak Output Brickwall Limiter (`alimiter`) to prevent audio clipping.
- Structured audio signal path ordering: Highpass/Lowpass -> Gain -> EQ -> Compand -> Limiter -> Sync.
- Introduced frame rate synchronization parameter (`-fps_mode` / `-vsync`) supporting Auto, CFR, VFR, and Passthrough based on FFmpeg version.
- Relocated Audio / Video Sync (`aresample`) configuration to the Video Filters tab, conditioned on the presence of an audio stream.

## [1.11.0] - 2026-07-06

### Changed
- Relocated the transcode pipeline flow diagram (`ResourcePipelineDiagram`) to the General/System tab contents in `ProcessConfigForm.tsx` to keep it structured and clean.
- Wrapped scheduling, lifecycle, and advanced flags components in a responsive 2-column grid layout inside the General/System tab contents.

## [1.10.0] - 2026-07-06

### Added
- Refactored `ResourcePipelineDiagram` to render a high-fidelity SVG Metro Map diagram of the transcode pipeline, visualizing real-time hardware decode/encode GPU/CPU flows, hybrid GPU+CPU filter paths, and stream bypass states.
- Implemented automated Raw/Compressed detection for broadcast capture inputs and outputs.
- Displayed stream-specific filter and decode operation counts next to active CPU and GPU nodes in the SVG diagram.

## [1.9.0] - 2026-07-06

### Added
- Enforced copy-codec filter constraints in ProcessConfigForm and FiltersFormSection, resetting video/audio filters to default empty/disabled states and disabling corresponding input controls when 'copy' is selected.
- Integrated audio codec status and active audio stream/filters into the transcode flow pipeline diagram.

## [1.8.0] - 2026-07-06

### Added
- Rich NVIDIA GPU capabilities detection (GPU model name, architecture, driver version, and CUDA version) using structured XML querying of `nvidia-smi`.
- Symmetric frontend video codec compatibility warning alerts for NVENC codecs (HEVC, H.264), matching VA-API check flows.
- Real-time service uptime tracking, watchdog rescue attempt badges, and last active timestamp labels on dashboard service cards.

### Changed
- Dashboard capabilities card expanded for NVIDIA/NVENC to display GPU details, driver version, CUDA version, and active hardware codecs.

### Fixed
- Resolved SQLite database lock contention and event loop freeze deadlocks by decoupling SQLAlchemy database sessions from asynchronous process and task spawning (`create_subprocess_exec`).

## [1.7.2] - 2026-07-06

### Changed
- Improved start/stop/restart interactions on service and scheduled task cards by disabling all control buttons and displaying animated loading spinners while an action is in progress to provide immediate visual feedback.

## [1.7.1] - 2026-07-02

### Added
- Added client-side port collision checking helper functions and active configuration loading to ProcessConfigForm.
- Initialize dynamic default ports and properties when switching output types in ProcessConfigForm.
- Dynamic port allocation for SRT/UDP/RTP inputs/outputs in initial state using getNextAvailablePort.
- Implemented full client-side validations, error state alerts, and blocked invalid form submissions in ProcessConfigForm.

## [1.7.0] - 2026-07-02

### Added
- Implemented dynamic video and audio codec filtering in the process configuration panel based on the selected output destination to prevent invalid configurations.
- Added software CPU video codecs `libvpx` (VP8) and `libvpx-vp9` (VP9) to the codec registry.
- Registered built-in software audio codec `mp2` (MPEG-2 Audio) for traditional broadcast headers over UDP/TS and SRT.
- Added user confirmation warnings and auto-healing code on output type changes to cleanly reset incompatible codecs to safe defaults.
- Completed and polished broadcast recipe cards for HLS, Local Recording (File), Icecast2, and RTP session streaming outputs.

## [1.6.1] - 2026-07-02

### Fixed
- Resolved a race condition where the terminal overlay was opened before the compilation POST request finished clearing the log file on the backend, causing the console to temporarily display the tail of the previous compilation log.

## [1.6.0] - 2026-07-02

### Added
- Added support for native WebRTC WHIP muxing in FFmpeg via OpenSSL backend configuration flag (`--enable-openssl`).
- Added `libvpx` to the optional pre-flight dependency checker, with auto-detection that automatically appends `--enable-libvpx` to compile options to enable VP8/VP9.
- Added validation constraints to abort compiling WHIP options if an FFmpeg version older than 8.0 is selected.
- Expanded `vainfo` telemetry parser to extract the GPU driver version, libva library version, and VA-API version.
- Display detailed VA-API driver info and hardware codec capabilities in the Dashboard UI.
- Registered `vp8_vaapi` and `vp9_vaapi` hardware video codecs with dynamic GPU compatibility warnings.

## [1.5.2] - 2026-07-01

### Fixed
- Resolved a race condition where aborting a build allowed starting a rebuild immediately before the previous compilation background task and subprocesses finished cleaning up, causing log file contamination and git checkout errors.

### Removed
- Cleaned up residual `libcurl` references and package mappings from the frontend.

## [1.5.1] - 2026-07-01

### Fixed
- Removed `libcurl` dependency check and configure flag generation from the build manager to prevent compilation failures with `Unknown option "--enable-libcurl"`.

## [1.5.0] - 2026-07-01

### Added
- Implemented copyable command snippets next to missing or uninstalled dependencies in both Required and Optional lists.
- Added `nvidia-cuda-dev` and `clang` packages to mapping configurations for Debian/Ubuntu, Fedora/RedHat, and Arch Linux.
- Added automatic GPU vendor and telemetry capability checks to filter out NVIDIA-specific optional dependencies from the aggregated installation command when no NVIDIA GPU is detected.
- Added a refresh button to the environment dependency modal and automatically check/reload dependencies when the modal opens to avoid requiring views swapping to trigger a status update.

### Changed
- Relocated the Linux distribution selector buttons (Debian/Ubuntu, Fedora/RedHat, Arch Linux) to the top of the environment/dependency detail view to serve as a view-wide setting.
- Compacted layout spacing in Dashboard, Services, and Scheduled Tasks views for 1080p density optimization.

### Fixed
- Fixed an infinite network request loop on dependency modal open by wrapping `fetchDeps` in a stable `useCallback` hook.

## [1.4.2] - 2026-07-01

### Added
- Added stale git lock file cleanup (`index.lock`) before repository updates in `BuildManager`.

### Changed
- Configured non-interactive git environment variables for all subprocesses spawned by `BuildManager`.
- Configured build subprocesses to run in a separate process group (`preexec_fn=os.setsid`) and updated `stop_build` to terminate the entire process group.

### Fixed
- Fixed a critical indentation bug in `ProcessManager._watchdog` that prevented SRT listener data activity checks from running and caused watchdog tests to hang.

## [1.4.1] - 2026-07-01

### Fixed
- Filtered out "ffmpeg" from the Dashboard's capabilities list, which represents form select options rather than physical hardware or peripherals.

## [1.4.0] - 2026-07-01

### Added
- Implemented real-time hardware compatibility checking for VA-API codecs: The system dynamically parses `vainfo` profiles (finding specific hardware encoders/decoders) and renders a warning block in `VideoCodecPanel` if the selected hardware codec is not supported by the host's active GPU (e.g. attempting HEVC encoding on a GPU that only supports H.264).

## [1.3.1] - 2026-07-01

### Added
- Integrated `vainfo` as an optional dependency check in pre-flight environment checks. The system will now check for `vainfo` presence and suggest package installation commands if missing to aid in VA-API GPU diagnostics.

## [1.3.0] - 2026-06-30

### Added
- Implemented WebRTC / WHIP (WebRTC HTTP Ingestion Protocol) output destination support. Users can now stream feeds directly to WebRTC-compliant endpoints (like MediaMTX).
- Added automatic `libcurl` pre-flight dependency checks and configure flags to build custom FFmpeg binaries with WebRTC/WHIP networking support.
- Added a "Recommended Broadcast Recipe" advisory card system in `DestinationPanel` for all output types (UDP, SRT, RTMP, WHIP, NDI, DeckLink) showing standard-compliant, optimal video/audio codec combinations.

## [1.2.5] - 2026-06-30

### Fixed
- Fixed dictionary lookup bug in build manager: Corrected the evaluation of the `libopus` dependency check result to access the nested `"dependencies"` dictionary instead of querying the root, resolving the issue where `--enable-libopus` was never appended to configure flags during compilation.

## [1.2.4] - 2026-06-30

### Added
- Integrated `libopus` dependency validation in pre-flight environment checks. If `libopus` headers are missing, the GUI now suggests the correct package installation commands (`libopus-dev` for Debian/Ubuntu, `opus-devel` for Fedora/RHEL, and `opus` for Arch Linux) under the environment overview.

## [1.2.3] - 2026-06-30

### Fixed
- Fixed Opus audio encoding: Changed `-application` and `-vbr` codec options in single-track audio command generation to use stream-specific specifiers (`-application:a` and `-vbr:a`) to prevent FFmpeg option parsing errors when multiple outputs/previews are configured.
- Added automatic `libopus` compilation support: Updated `build_manager.py` to check for system `libopus` library availability via `pkg-config` and automatically append the `--enable-libopus` compilation flag at configure time.

## [1.2.2] - 2026-06-30

### Fixed
- Addressed Chrome DevTools warnings/suggestions regarding missing autofill properties and unlinked labels by adding unique `id` and `name` attributes to all form inputs/selects and properly linking `<label>` elements via `htmlFor`.
- Implemented an `idPrefix` parameter in `InputSourcePanel` to prevent ID collisions when multiple panels are rendered simultaneously.

## [1.2.1] - 2026-06-30

### Changed
- Reverted form sections (Inputs, Codecs, Filters, Output, System) in `ProcessConfigForm` back to conditional rendering to decrease DOM complexity and optimize Interaction to Next Paint (INP).
- Stabilized reference for the `overlays` prop passed to `FiltersFormSection` by using a module-level `EMPTY_ARRAY` constant to prevent breaking `React.memo`.

## [1.2.0] - 2026-06-30

### Added
- Implemented static module-level caches in InputSourcePanel and DestinationPanel to cache Blackmagic Decklink, Video4Linux2, and ALSA devices and formats, preventing redundant backend API requests when rendering or switching inputs/outputs.

## [1.1.0] - 2026-06-30

### Changed
- Optimized tab switching performance in ProcessConfigForm (Service/Task Forms) by keeping all configuration panels mounted in the DOM and toggling visibility with the Tailwind CSS `hidden` class instead of conditional mounting.
- Redesigned the FFmpeg Build Forge modal (`BuildFormModal`) layout to organize options into three distinct tabs (General, Aceleración GPU, SDKs & Protocolos) and constrained scrollable content height to prevent page-level scrolling.

## [1.0.9] - 2026-06-30

### Fixed
- Prevented the watchdog from killing active SRT services by completely disabling active `ffprobe` socket checks for SRT connection types, which previously triggered connection conflicts on point-to-point flows.
- Optimized watchdog probing for UDP/RTP streams to only run when the parsed stream status indicates no active traffic, avoiding socket conflicts.
- Implemented automatic database cleaning on backend startup to permanently sanitize any existing dirty/stale GPU configurations for non-decodable inputs.
- Integrated request-level validation in `/processes` API endpoints to sanitize process creation, updates, and previews before committing to the database.
- Added input type context to the frontend transcode diagram to correctly force CPU-decode representation when decoders like `lavfi` or `alsa` are used, regardless of the selected encoder.

## [1.0.8] - 2026-06-26

### Fixed
- Sanitized input-level hardware decoding configuration. When changing input types in the frontend, stale `hwaccel` and `frames_destination` values are now cleared. In the backend, any stale hardware decoding options for non-decodable inputs (e.g. `lavfi_video`, `lavfi_audio`, `alsa`) are defensively stripped and set to CPU decoding during command generation, preventing FFmpeg conversion crashes and incorrect UI pipeline diagram descriptions.

## [1.0.7] - 2026-06-26

### Changed
- Aligned frontend and backend realtime (-re) flag behavior. The backend now respects explicit "Always ON" or "Always OFF" choices set in the UI instead of overriding them for network inputs, while keeping safe defaults for the "Auto" setting.

## [1.0.6] - 2026-06-26

### Fixed
- Optimized preview filter chain performance by placing `fps=1` before `hwdownload` in CUDA/VAAPI/QSV VRAM filter graphs. This reduces the number of frames downloaded from GPU to CPU from 25 fps to 1 fps, decreasing PCIe and CPU usage by 96% and preventing transcode bottlenecks.

## [1.0.5] - 2026-06-26

### Fixed
- Automatically force-disabled the realtime (-re) flag for network inputs (like RTMP or SRT) to prevent sluggish processing lag, stuttering, and eventual connection timeouts.

## [1.0.4] - 2026-06-26

### Fixed
- Fixed a race condition / self-cancellation bug where the delayed restart task would cancel itself inside `start_process` when attempting to clear pending restarts.

## [1.0.3] - 2026-06-26

### Fixed
- Fixed watchdog logic to prevent setting service status to 'stopped' in the database upon clean exit (exit code 0) if the exit was unexpected and the watchdog will restart the process. This prevents the delayed restart task from aborting.

## [1.0.2] - 2026-06-26

### Fixed
- Fixed SRT listener watchdog logic to prevent killing processes waiting for connections (having 0 kb/s bitrate/fps initially).
- Added logic to automatically restart SRT listeners when a client disconnects and traffic is lost.
- Reset the watchdog restart retry counter (`restart_counts`) to 0 when positive traffic is detected or when a process runs successfully for more than 60 seconds.

## [1.0.1] - 2026-06-26

### Fixed
- Sequential start sequence for 'start on boot' services on startup to avoid database lock contention / deadlock on SQLite.

## [1.0.0] - 2026-06-25

### Added
- Standardized version control system with Single Source of Truth (SSOT) files for Frontend (`package.json`), Backend (`backend/version.py`), and Database Schema (`backend/database/version.py`).
- Dynamic system information and version details rendered in the Dashboard's "System Info" section.
- Automatic Host OS and Architecture detection in backend telemetry broadcast.
- Versions exposed under the `/api/status` FastAPI endpoint.
- Database schema version tracking via the new `schema_info` table.
