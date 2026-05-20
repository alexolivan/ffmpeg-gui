# Design Spec: Service CRUD, Config Toggles, and Watchdog Orchestration

## Context & Requirements
This specification defines the implementation of a full CRUD flow for media services, auto-start options, and a configurable watchdog mechanism with network stream checking.

## Proposed Changes

### 1. Database Model Updates (`backend/database/models.py`)
Add columns to `MediaProcess`:
*   `auto_start`: Column(Boolean, default=False)
*   `watchdog_enabled`: Column(Boolean, default=False)
*   `watchdog_retries`: Column(Integer, default=5)
*   `last_started_config`: Column(JSON, nullable=True)

### 2. SQLite Database Migration (`backend/database/db.py`)
Update `init_db()` to dynamically run column additions on SQLite startup if they are missing:
*   `auto_start`
*   `watchdog_enabled`
*   `watchdog_retries`
*   `last_started_config`

### 3. API Routes (`backend/main.py`)
*   **PUT `/processes/{process_id}`**: Updates service configuration.
*   **DELETE `/processes/{process_id}`**: Stops service if active, then deletes it from the database.
*   **Telemetry Update**: The list endpoint and WebSocket telemetry will calculate `pending_changes` by comparing the serialized active config with `last_started_config`.
*   **Startup Task**: Query services where `auto_start` is enabled and start them on backend boot.

### 4. Watchdog & Recovery (`backend/core/process_manager.py`)
*   **Watchdog Task**:
    *   If a process exits unexpectedly (not triggered by user stop) and `watchdog_enabled` is True:
        *   Retrieve `watchdog_retries` limit. If the current restart counter is below the limit (or limit is `-1`), trigger a restart with a 5-second backoff.
        *   If the limit is exceeded, set status to `error` and log a failure.
    *   **Network Active Probe**:
        *   Every 30 seconds, if watchdog is enabled and input is UDP or RTP, run a lightweight `ffprobe` check.
        *   If input is SRT and has not received telemetry updates in 20 seconds, run check.
        *   If any network check fails, restart the process to force reconnection.

### 5. Frontend UI Modifications (`frontend/src/...`)
*   **`ProcessConfigForm.tsx`**:
    *   Accept `initialProcess` to support editing.
    *   Add "Auto-Start on Boot" and "Enable Watchdog" checkboxes.
    *   Add "Max Restart Attempts" number input and an "Infinite Attempts" checkbox (setting value to `-1`).
*   **`App.tsx`**:
    *   Render Edit (✏️) and Delete (🗑️) buttons on dashboard cards.
    *   If a service is running and configuration has changed, display a `"⚠️ PENDING RESTART"` badge.
    *   In the preview modal:
        *   Change the `"START SERVICE"` button to `"RESTART SERVICE"` for running services.
        *   Prompt for confirmation before Deletion and Restarting (to prevent dropping streaming audience unexpectedly).
        *   Add a warning banner indicating that configuration changes are pending a restart.
