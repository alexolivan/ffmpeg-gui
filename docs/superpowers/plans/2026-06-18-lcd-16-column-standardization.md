# LCD 16-Column Standardization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize all LCD views to output 16 columns of content, add dynamic prefixes/centering in the manager, support dynamic locator layouts, and adapt menu list scrolling for 2-row screens.

**Architecture:** Modify the `LCDManager` to dynamically pad/prefix lines depending on physical display parameters (`cols` and `rows`). Update dashboard and menu view render methods to output 16-column strings and dynamically window the selection display based on physical row counts.

**Tech Stack:** Python, Pytest, SQLAlchemy, SQLite.

---

### Task 1: Update LCD Manager Layout Logic

**Files:**
- Modify: `backend/core/lcd/manager.py`

- [ ] **Step 1: Write the updated mapping and layout logic in `backend/core/lcd/manager.py`**

Replace:
```python
    def get_led_legend_char(self, profile: str) -> str:
        if profile == "heartbeat":
            return "H"
        elif profile == "streams":
            return "S"
        elif profile == "tasks":
            return "T"
        elif profile == "alert":
            return "A"
        return " "
```

With:
```python
    def get_led_legend_prefix(self, profile: str) -> str:
        if profile == "heartbeat":
            return "HB  "
        elif profile == "streams":
            return "SRV "
        elif profile == "tasks":
            return "TSK "
        elif profile == "alert":
            return "ERR "
        return "    "
```

And update `refresh_display`'s line composition:
```python
            # Clean and slice to 16 characters content core
            from .views.base import clean_ascii
            line_text = lines[row] if row < len(lines) else ""
            cleaned_text = clean_ascii(line_text)
            trimmed_text = cleaned_text[:16].ljust(16)

            # Determine layout depending on driver column size
            if self.driver.cols == 20:
                from .drivers.cfa635 import Cfa635Driver
                if isinstance(self.driver, Cfa635Driver):
                    profile = led_profiles[row] if row < len(led_profiles) else "disabled"
                    prefix = self.get_led_legend_prefix(profile)
                    final_text = prefix + trimmed_text
                else:
                    final_text = "  " + trimmed_text + "  "
            else:
                final_text = trimmed_text

            if final_text != self._last_rendered_lines[row]:
                self.driver.write_line(row, final_text)
                self._last_rendered_lines[row] = final_text
```

Also, update the locator blinking loop lines creation to match the display rows/cols size:
```python
                    # Overriding LCD display with a blinking rack locator screen
                    flash_phase = locator_tick % 2
                    if flash_phase == 0:
                        lines = [""] * self.driver.rows
                    else:
                        if self.driver.cols == 16:
                            if self.driver.rows == 2:
                                lines = [
                                    "  *** FINDME ***",
                                    "  RACK LOCATOR  "
                                ]
                            else:
                                lines = [
                                    "================",
                                    "  *** FINDME ***",
                                    "  RACK LOCATOR  ",
                                    "================"
                                ]
                        else:
                            if self.driver.rows == 2:
                                lines = [
                                    "   *** FIND ME! *** ",
                                    "      RACK LOCATOR  "
                                ]
                            else:
                                lines = [
                                    "====================",
                                    "   *** FIND ME! *** ",
                                    "      RACK LOCATOR  ",
                                    "===================="
                                ]
                    for row in range(self.driver.rows):
                        target_text = lines[row] if row < len(lines) else ""
                        if target_text != self._last_rendered_lines[row]:
                            self.driver.write_line(row, target_text)
                            self._last_rendered_lines[row] = target_text
```

- [ ] **Step 2: Commit Task 1 changes**
```bash
git add backend/core/lcd/manager.py
git commit -m "refactor(lcd): implement dynamic 16-column core layout in manager"
```

---

### Task 2: Standardize Dashboard & Menu Layouts to 16 Columns and Re-order Dashboard Rows

**Files:**
- Modify: `backend/core/lcd/views/dashboard.py`
- Modify: `backend/core/lcd/views/menu.py`
- Modify: `backend/core/lcd/views/submenu.py`

- [ ] **Step 1: Modify `backend/core/lcd/views/dashboard.py`**
Reorder active count to second row and restrict centering to 16 characters:
```python
        # Center/pad the node name to 16 characters
        header = node_name[:16].center(16)

        return [
            header,
            f"Streams: {active_count}",
            f"CPU: {cpu}%",
            f"RAM: {ram}%"
        ]
```

- [ ] **Step 2: Modify `backend/core/lcd/views/menu.py`**
Change selection/status prefixes to fit 16-char content, and dynamically limit visible window size on 2-row screens.
Update `MainMenuView.render`:
```python
    def render(self) -> List[str]:
        lines = ["--- MAIN MENU ---"]
        if self.manager.driver.rows == 2:
            lines.append(f"> {self.options[self.selected_index]}")
        else:
            for idx in range(3):
                prefix = "> " if idx == self.selected_index else "  "
                lines.append(f"{prefix}{self.options[idx]}")
        return lines
```

Update `ServicesMenuView.render`:
```python
    def render(self) -> List[str]:
        lines = ["-- SERVICES MENU -"]
        if not self.services:
            lines.append("  No services")
            lines.append("")
            lines.append("Press X to return")
            return lines

        # Render visible window based on row count
        window_size = 1 if self.manager.driver.rows == 2 else 3
        if window_size == 1:
            start = self.selected_index
            end = start + 1
        else:
            start = max(0, self.selected_index - 1)
            end = min(len(self.services), start + 3)

        for i in range(start, end):
            svc = self.services[i]
            prefix = "> " if i == self.selected_index else "  "
            status_char = "*" if svc.status == "running" else " "
            display_name = svc.alias if svc.alias and svc.alias.strip() else svc.name
            lines.append(f"{prefix}{status_char} {display_name[:12]}")
        
        while len(lines) < 4:
            lines.append("")
        return lines
```

Update `TasksMenuView.render`:
```python
    def render(self) -> List[str]:
        lines = ["--- TASKS MENU ---"]
        if not self.tasks:
            lines.append("  No tasks")
            lines.append("")
            lines.append("Press X to return")
            return lines

        # Render visible window based on row count
        window_size = 1 if self.manager.driver.rows == 2 else 3
        if window_size == 1:
            start = self.selected_index
            end = start + 1
        else:
            start = max(0, self.selected_index - 1)
            end = min(len(self.tasks), start + 3)

        for i in range(start, end):
            task = self.tasks[i]
            prefix = "> " if i == self.selected_index else "  "
            display_name = task.alias if task.alias and task.alias.strip() else task.name
            lines.append(f"{prefix}{display_name[:14]}")

        while len(lines) < 4:
            lines.append("")
        return lines
```

- [ ] **Step 3: Modify `backend/core/lcd/views/submenu.py`**
Adapt submenus to use dynamic selection/option list scrolling on 2-row screens.
Update `ServiceDetailMenuView.render`:
```python
    def render(self) -> List[str]:
        self.fetch_service()
        action_text = "Stop" if self.svc_status == "running" else "Start"
        options = [f"{action_text}", "Restart", "Status Info"]
        
        lines = [f"SVC:{self.svc_name[:12]}"]
        if self.manager.driver.rows == 2:
            lines.append(f"> {options[self.selected_index]}")
        else:
            for idx, opt in enumerate(options):
                prefix = "> " if idx == self.selected_index else "  "
                lines.append(f"{prefix}{opt}")
        return lines
```

Update `ServiceStatusDetailView.render`:
```python
    def render(self) -> List[str]:
        db = self.manager.db_session_factory()
        lines = ["SVC Status"]
        try:
            from database.models import MediaProcess
            svc = db.query(MediaProcess).get(self.svc_id)
            if svc:
                display_name = svc.alias if svc.alias and svc.alias.strip() else svc.name
                lines = [
                    f"SVC:{display_name[:12]}",
                    f"Status:{svc.status}",
                    f"PID:{svc.pid or 'N/A'} C:{int(svc.cpu_usage or 0)}%",
                    f"FPS:{svc.fps or '0'} SPD:{svc.speed or '0x'}"
                ]
        except Exception:
            lines = ["Error reading svc", "", "", ""]
        finally:
            db.close()
        return lines
```

Update `TaskDetailMenuView.render`:
```python
    def render(self) -> List[str]:
        self.fetch_task()
        options = ["Run Now", "Status Info"]
        lines = [f"TSK:{self.task_name[:12]}"]
        if self.manager.driver.rows == 2:
            lines.append(f"> {options[self.selected_index]}")
        else:
            for idx, opt in enumerate(options):
                prefix = "> " if idx == self.selected_index else "  "
                lines.append(f"{prefix}{opt}")
            lines.append("") # 4th line empty
        return lines
```

Update `TaskStatusDetailView.render`:
```python
    def render(self) -> List[str]:
        db = self.manager.db_session_factory()
        lines = ["Task Status"]
        try:
            from database.models import ScheduledTask, TaskExecution
            task = db.query(ScheduledTask).get(self.task_id)
            if task:
                display_name = task.alias if task.alias and task.alias.strip() else task.name
                latest_exec = db.query(TaskExecution).filter(TaskExecution.task_id == self.task_id).order_by(TaskExecution.id.desc()).first()
                status_str = latest_exec.status if latest_exec else "Idle"
                pid_str = str(latest_exec.pid) if (latest_exec and latest_exec.pid) else "N/A"
                lines = [
                    f"TSK:{display_name[:12]}",
                    f"Status:{status_str}",
                    f"PID:{pid_str}",
                    "Press X to return"
                ]
        except Exception:
            lines = ["Error reading task", "", "", ""]
        finally:
            db.close()
        return lines
```

- [ ] **Step 4: Commit Task 2 changes**
```bash
git add backend/core/lcd/views/dashboard.py backend/core/lcd/views/menu.py backend/core/lcd/views/submenu.py
git commit -m "feat(lcd): adapt dashboard, menu and submenu views to 16 cols and 2-row layouts"
```

---

### Task 3: Update and Add View & Manager Tests

**Files:**
- Modify: `backend/tests/test_lcd_views.py`
- Modify: `backend/tests/test_lcd_manager.py`

- [ ] **Step 1: Modify `backend/tests/test_lcd_views.py`**
Update assertions to match new 16-character limits and prefix formatting:
* In `test_submenu_views`, service details will now use `"SVC:Test Service"` -> truncated to 12 chars is `"SVC:Test Service"` (which fits 16 chars).
* In `test_lcd_views_with_alias_and_node_name`:
  * Update DashboardView assertions to verify reordered fields: `dash_lines[1] == "Streams: 0"`.
  * Update `ServicesMenuView` assertions: `svc_menu_lines[1]` will match `"> * ShortSvc"` or similar.

- [ ] **Step 2: Add dynamic size/scroll tests to `backend/tests/test_lcd_views.py`**
Add test cases simulating `self.manager.driver.rows = 2` to verify correct items scroll-windowing:
```python
def test_2_row_scrolling():
    from unittest.mock import MagicMock
    from database.models import MediaProcess
    from core.lcd.views.menu import ServicesMenuView
    
    manager = MagicMock()
    manager.driver.rows = 2
    
    db_mock = MagicMock()
    manager.db_session_factory.return_value = db_mock
    
    svc1 = MediaProcess(id=1, name="Svc1", status="running")
    svc2 = MediaProcess(id=2, name="Svc2", status="stopped")
    
    db_mock.query.return_value.filter.return_value.all.return_value = [svc1, svc2]
    
    menu = ServicesMenuView(manager)
    # Selected index 0
    menu.selected_index = 0
    lines = menu.render()
    assert lines[0] == "-- SERVICES MENU -"
    assert ">* Svc1" in lines[1]
    
    # Selected index 1
    menu.selected_index = 1
    lines = menu.render()
    assert lines[0] == "-- SERVICES MENU -"
    assert ">  Svc2" in lines[1]
```

- [ ] **Step 3: Run pytest and confirm pass**
Run: `PYTHONPATH=backend ./venv/bin/pytest`
Expected: PASS

- [ ] **Step 4: Commit tests**
```bash
git add backend/tests/test_lcd_views.py
git commit -m "test(lcd): update tests and add coverage for 2-row scrolling"
```
