# Design Spec: Sprint UI/UX Refinements

This design document outlines the UI/UX changes, telemetry refinements, and configuration fixes required to align the main application with user requirements specified in `docs/issues.txt`.

## 1. Sidebar Navigation Renaming
- Change the display label of `"Scheduled Tasks"` to `"Tasks"` in the main sidebar.
- Maintain existing routing paths and underlying components as they are functional.

## 2. Services Export Button Restoration
- Restore the individual export action button (`📤`) on each service row item.
- Clicking the button calls `GET /processes/{id}/export` and downloads the service configuration payload.

## 3. Dashboard Counters & Telemetry Refinement
- **Remove Obsolete Counters**: Delete `REBOOTS PENDING` and `ACTIVE BATCH` counters from `SYSTEM STATS`.
- **Backend Telemetry Extension**:
  In `backend/main.py`, include `task_stats` in the telemetry WebSocket loop:
  ```python
  task_stats = {
      "active": db.query(TaskExecution).filter(TaskExecution.status == "running").count(),
      "scheduled": db.query(ScheduledTask).filter(ScheduledTask.is_active == True, ScheduledTask.schedule_type.in_(["recurring", "one_shot"])).count(),
      "inactive": db.query(ScheduledTask).filter((ScheduledTask.is_active == False) | (ScheduledTask.schedule_type == "manual")).count()
  }
  ```
- **Frontend UI counters**:
  Display the following counters in `SYSTEM STATS`:
  - Active Services
  - Inactive Services
  - Active Tasks
  - Scheduled Tasks
  - Inactive/Manual Tasks
- **Remove Lower Area**: Delete the `ACTIVE TASK EXECUTIONS` list section at the bottom of the main dashboard.

## 4. Audio/Video Input Source Logic
- **Labels**:
  - `use_secondary_input` is False: Label input panel `"Primary Source (Audio & Video)"`.
  - `use_secondary_input` is True: Label input panels `"Input 1 — Video Source"` and `"Input 2 — Audio Source"`.
- **Filtering**:
  - `Video Source` allowed types: `['file', 'srt', 'ndi', 'udp', 'rtp', 'decklink', 'v4l2', 'lavfi_video']` (excludes audio-only `alsa` and `lavfi_audio`).
  - `Audio Source` allowed types: `['file', 'srt', 'ndi', 'udp', 'rtp', 'decklink', 'alsa', 'lavfi_audio']` (excludes video-only `v4l2` and `lavfi_video`).
- **Auto-Reset & Dependencies**:
  - Hide and disable the `"Use separate source for Input 2"` checkbox if either **Video** or **Audio** main checkbox is unchecked.
  - Automatically reset the input type to `'file'` if toggling states makes the currently selected type invalid.
