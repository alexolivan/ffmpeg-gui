# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
