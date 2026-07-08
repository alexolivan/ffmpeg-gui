# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
