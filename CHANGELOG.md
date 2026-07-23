# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
