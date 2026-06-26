# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
