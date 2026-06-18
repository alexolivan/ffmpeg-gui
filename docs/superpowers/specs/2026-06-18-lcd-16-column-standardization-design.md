# Design Spec: LCD 16-Column Standardization & 2-Row Adaptability

This design document establishes the architectural changes to transition the Crystalfontz LCD view rendering system from an 18-character content window to a standardized, highly portable **16-character content core**.

This change:
1. Enables native compatibility with standard 2x16 character displays.
2. Enhances 20-character screens with LEDs by replacing single-character row indicators (H, S, T, A) with descriptive 3-character prefixes (`HB  `, `SRV `, `TSK `, `ERR `).
3. Automatically adapts the Dashboard View to 2-row screens by ordering rows by priority (Node Name, Active Streams) so that row truncation on smaller screens preserves critical status info.
4. Correctly centers and formats the FINDME locator screen based on rows/columns without overflowing.
5. Adapts all menu layouts to support scroll-windowing on 2-row screens where only 1 item is visible at a time.

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
* Update `_led_control_loop` to dynamically structure the blinking finder screens:
  * For `cols == 16` & `rows == 2`:
    ```
      *** FINDME ***
      RACK LOCATOR  
    ```
  * For `cols == 16` & `rows == 4`:
    ```
    ================
      *** FINDME ***
      RACK LOCATOR  
    ================
    ```
  * For `cols == 20` & `rows == 2`:
    ```
       *** FIND ME! *** 
          RACK LOCATOR  
    ```
  * For `cols == 20` & `rows == 4`:
    ```
    ====================
       *** FIND ME! *** 
          RACK LOCATOR  
    ====================
    ```
* Constrain the finder render loop to write only to rows within `range(self.driver.rows)`.

### B. Dashboard View (`backend/core/lcd/views/dashboard.py`)
* Center the Node Name to 16 characters.
* Re-order rows to put the active streams count on row 2, and system resources on rows 3/4:
  1. `Header (Node Name)`
  2. `Streams: {active_count}`
  3. `CPU: {cpu}%`
  4. `RAM: {ram}%`

### C. Menus (`backend/core/lcd/views/menu.py`)
* **MainMenuView**:
  * If `rows == 2`, render only the active option under the header:
    ```
    --- MAIN MENU ---
    > [Active Option]
    ```
  * If `rows == 4`, render all three options.
* **ServicesMenuView**:
  * Change selection and status indicator prefix from `"> (*) "` (6 chars) to `"> * "` (4 chars) to fit within the 16-character limit.
  * Truncate the service alias/name to exactly 12 characters (`name[:12]`), ensuring the full 12-char alias is displayed without clipping: `f"{prefix}{status_char} {display_name[:12]}"`.
  * If `rows == 2`, set the sliding window size to 1 item (showing only the selected item).
  * If `rows == 4`, set the sliding window size to 3 items.
* **TasksMenuView**:
  * Truncate the task alias/name to 14 characters (`name[:14]`) after the 2-character select prefix `"> "`: `f"{prefix}{display_name[:14]}"`.
  * If `rows == 2`, set sliding window size to 1.
  * If `rows == 4`, set sliding window size to 3.

### D. Submenus & Details (`backend/core/lcd/views/submenu.py`)
* Change process and task headers from `SVC:name[:14]` to `SVC:name[:12]` (16 chars total).
* For `ServiceDetailMenuView` and `TaskDetailMenuView`:
  * If `rows == 2`, display only the header and the active option:
    ```
    SVC:[Alias]
    > [Active Option]
    ```
  * If `rows == 4`, list all options normally.
* Shorten resource label in service status detail from `CPU:` to `C:`:
  `f"PID:{pid} C:{cpu_percent}%"` (fits within 16 characters).

---

## 3. Verification & Testing

* Update existing unit tests in `backend/tests/test_lcd_views.py` and `backend/tests/test_lcd_manager.py` to match the new 16-character content assertions and reordered dashboard rows.
* Ensure all tests pass.
