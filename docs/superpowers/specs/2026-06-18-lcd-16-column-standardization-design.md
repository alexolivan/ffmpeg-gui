# Design Spec: LCD 16-Column Standardization & 2-Row Adaptability

This design document establishes the architectural changes to transition the Crystalfontz LCD view rendering system from an 18-character content window to a standardized, highly portable **16-character content core**.

This change:
1. Enables native compatibility with standard 2x16 character displays.
2. Enhances 20-character screens with LEDs by replacing single-character row indicators (H, S, T, A) with descriptive 3-character prefixes (`HB  `, `SRV `, `TSK `, `ERR `).
3. Automatically adapts the Dashboard View to 2-row screens by ordering rows by priority (Node Name, Active Streams) so that row truncation on smaller screens preserves critical status info.

---

## 1. Grid & Prefix Design

We divide the physical grid as follows:

| Hardware Type | Columns | Rows | Prefix Columns | Content Columns | Padding | Format |
|---|---|---|---|---|---|---|
| **20x4 with LEDs (CFA635)** | 20 | 4 | 4 (`LBL `) | 16 | None | `[LBL] [16-char content]` |
| **20x4 / 20x2 (No LEDs)** | 20 | 2 or 4 | 0 | 16 | 2 spaces prefix/suffix | `  [16-char content]  ` |
| **16x4 / 16x2 (No LEDs)** | 16 | 2 or 4 | 0 | 16 | None | `[16-char content]` |

### LED Label Mappings:
* `disabled` -> `"    "` (4 spaces)
* `heartbeat` -> `"HB  "`
* `streams` -> `"SRV "`
* `tasks` -> `"TSK "`
* `alert` -> `"ERR "`

---

## 2. Component Modifications

### A. LCD Manager (`backend/core/lcd/manager.py`)
* Update `refresh_display` to truncate/pad core view output to exactly 16 characters (`text[:16].ljust(16)`).
* Query the driver columns count:
  * If `cols == 20` and the driver is `Cfa635Driver`, prepend the 4-character status label mapping.
  * If `cols == 20` and it is a generic driver, prepend `"  "` to center.
  * If `cols == 16`, render the 16 characters directly.

### B. Dashboard View (`backend/core/lcd/views/dashboard.py`)
* Center the Node Name to 16 characters.
* Re-order rows to put the active streams count on row 2, and system resources on rows 3/4:
  1. `Header (Node Name)`
  2. `Streams: {active_count}`
  3. `CPU: {cpu}%`
  4. `RAM: {ram}%`

### C. Menus (`backend/core/lcd/views/menu.py`)
* **ServicesMenuView**:
  * Change selection and status indicator prefix from `"> (*) "` (6 chars) to `"> * "` (4 chars) to fit within the 16-character limit.
  * Truncate the service alias/name to exactly 12 characters (`name[:12]`), ensuring the full 12-char alias is displayed without clipping: `f"{prefix}{status_char} {display_name[:12]}"`.
* **TasksMenuView**:
  * Truncate the task alias/name to 14 characters (`name[:14]`) after the 2-character select prefix `"> "`: `f"{prefix}{display_name[:14]}"`.

### D. Submenus & Details (`backend/core/lcd/views/submenu.py`)
* Change process and task headers from `SVC:name[:14]` to `SVC:name[:12]` (16 chars total).
* Shorten resource label in service status detail from `CPU:` to `C:`:
  `f"PID:{pid} C:{cpu_percent}%"` (fits within 16 characters).

---

## 3. Verification & Testing

* Update existing unit tests in `backend/tests/test_lcd_views.py` and `backend/tests/test_lcd_manager.py` to match the new 16-character content assertions and reordered dashboard rows.
* Ensure all tests pass.
