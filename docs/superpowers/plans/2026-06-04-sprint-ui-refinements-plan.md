# Sprint UI/UX Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve dashboard inconsistencies, restore services export actions, rename scheduled tasks menu, and enforce strict audio/video separate source config guidelines.

**Architecture:** Extend backend telemetry loop to query and push task configuration state alongside execution status, update frontend Sidebar and App components for telemetry stats/counters and export buttons, and inject type filters into the ProcessConfigForm source panels.

**Tech Stack:** FastAPI, SQLite/SQLAlchemy, React, TypeScript, Tailwind CSS

---

### Task 1: Rename Sidebar Item and Update Routes
Rename `"Scheduled Tasks"` menu label to `"Tasks"` in the navigation sidebar.

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`

- [ ] **Step 1: Modify Sidebar labels**
  Replace `"Scheduled Tasks"` with `"Tasks"` in navigation links.
  
  Code change in `frontend/src/components/Sidebar.tsx`:
  ```diff
  - { id: 'batch', label: 'Scheduled Tasks', icon: '📅' },
  + { id: 'batch', label: 'Tasks', icon: '📅' },
  ```

- [ ] **Step 2: Verify compiling**
  Run: `npm run build` inside `frontend/` directory to ensure no compilation issues.
  Expected: Command finishes successfully.

- [ ] **Step 3: Commit**
  Run:
  ```bash
  git add frontend/src/components/Sidebar.tsx
  git commit -m "style(sidebar): rename scheduled tasks to tasks for clarity"
  ```

---

### Task 2: Restore Services Export Button in List View
Add individual export action buttons for both active and inactive service list rows.

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Add export button to running services list**
  In `frontend/src/App.tsx`, around line 910:
  ```diff
                              <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleCloneProcess(proc);
                                }}
                                className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-sm border border-white/10 transition-all hover:scale-105"
                                title="Clone Service"
                              >
                                📋
                              </button>
  +                           <button
  +                             onClick={(e) => {
  +                               e.stopPropagation();
  +                               fetch(`${API}/processes/${proc.id}/export`)
  +                                 .then(r => r.json())
  +                                 .then(data => {
  +                                   const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  +                                   const a = document.createElement('a')
  +                                   a.href = URL.createObjectURL(blob)
  +                                   a.download = `${proc.name}_profile.json`
  +                                   a.click()
  +                                 })
  +                             }}
  +                             className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-sm border border-white/10 transition-all hover:scale-105"
  +                             title="Export Service"
  +                           >
  +                             📤
  +                           </button>
  ```

- [ ] **Step 2: Add export button to inactive services list**
  In `frontend/src/App.tsx`, around line 1000:
  ```diff
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCloneProcess(proc);
                                }}
                                className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-sm border border-white/10 transition-all hover:scale-105"
                                title="Clone Service"
                              >
                                📋
                              </button>
  +                           <button
  +                             onClick={(e) => {
  +                               e.stopPropagation();
  +                               fetch(`${API}/processes/${proc.id}/export`)
  +                                 .then(r => r.json())
  +                                 .then(data => {
  +                                   const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  +                                   const a = document.createElement('a')
  +                                   a.href = URL.createObjectURL(blob)
  +                                   a.download = `${proc.name}_profile.json`
  +                                   a.click()
  +                                 })
  +                             }}
  +                             className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-sm border border-white/10 transition-all hover:scale-105"
  +                             title="Export Service"
  +                           >
  +                             📤
  +                           </button>
  ```

- [ ] **Step 3: Verify compiling**
  Run: `npm run build` inside `frontend/` directory.
  Expected: Build succeeds.

- [ ] **Step 4: Commit**
  Run:
  ```bash
  git add frontend/src/App.tsx
  git commit -m "feat(services): restore individual service export button in lists"
  ```

---

### Task 3: Backend Telemetry Extensions and Stats Refactoring
Extend the WebSocket loop in the backend to query task status metrics, and update frontend dashboard system counters. Remove unused list areas.

**Files:**
- Modify: `backend/main.py`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Implement `task_stats` in backend WebSocket loop**
  Update `telemetry_broadcast_loop` in `backend/main.py` to aggregate statistics for Active, Scheduled, and Inactive Tasks.
  
  Code change in `backend/main.py` around line 308:
  ```python
              # Gather global host system metrics
              sys_cpu = psutil.cpu_percent(interval=None)
              sys_ram = psutil.virtual_memory()
              gpu_stats = gpu_sensor.get_stats()
              
              # Task statistics
              scheduled_count = db.query(ScheduledTask).filter(
                  ScheduledTask.is_active == True,
                  ScheduledTask.schedule_type.in_(["recurring", "one_shot"])
              ).count()
              
              inactive_count = db.query(ScheduledTask).filter(
                  (ScheduledTask.is_active == False) | (ScheduledTask.schedule_type == "manual")
              ).count()
              
              active_exec_count = db.query(TaskExecution).filter(
                  TaskExecution.status == "running"
              ).count()
              
              system_data = {
                  "cpu": sys_cpu,
                  "ram_used": int(sys_ram.used / (1024 * 1024)), # MB
                  "ram_total": int(sys_ram.total / (1024 * 1024)), # MB
                  "gpu": gpu_stats
              }
              
              await manager.broadcast({
                  "type": "telemetry",
                  "data": data,
                  "task_executions": exec_data,
                  "system": system_data,
                  "task_stats": {
                      "active": active_exec_count,
                      "scheduled": scheduled_count,
                      "inactive": inactive_count
                  }
              })
  ```

- [ ] **Step 2: Add `taskStats` state in frontend**
  In `frontend/src/App.tsx`, define state hook and update WebSocket listener:
  ```typescript
    const [taskStats, setTaskStats] = useState<any>({ active: 0, scheduled: 0, inactive: 0 })
  ```
  And in `ws.onmessage` handler:
  ```typescript
        if (msg.type === 'telemetry') {
          setTelemetry(msg.data)
          if (msg.task_executions) {
            setTaskExecutions(msg.task_executions)
          }
          if (msg.system) {
            setSystemTelemetry(msg.system)
          }
          if (msg.task_stats) {
            setTaskStats(msg.task_stats)
          }
        }
  ```

- [ ] **Step 3: Update `SYSTEM STATS` layout and delete bottom executions list**
  Modify counters in `frontend/src/App.tsx` from lines 573-606:
  ```html
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                      <div className="bg-white/5 border border-white/5 rounded-2xl p-3 text-center">
                        <div className="text-[9px] uppercase font-bold text-text-secondary mb-1">Active Services</div>
                        <div className="font-black text-xl text-brand-lime">
                          {telemetry.filter(p => (p.type === 'service' || !p.type) && p.status === 'running').length}
                        </div>
                      </div>
                      <div className="bg-white/5 border border-white/5 rounded-2xl p-3 text-center">
                        <div className="text-[9px] uppercase font-bold text-text-secondary mb-1">Inactive Services</div>
                        <div className="font-black text-xl text-white/50">
                          {telemetry.filter(p => (p.type === 'service' || !p.type) && p.status !== 'running').length}
                        </div>
                      </div>
                      <div className="bg-white/5 border border-white/5 rounded-2xl p-3 text-center">
                        <div className="text-[9px] uppercase font-bold text-text-secondary mb-1">Active Tasks</div>
                        <div className="font-black text-xl text-brand-blue">
                          {taskStats.active}
                        </div>
                      </div>
                      <div className="bg-white/5 border border-white/5 rounded-2xl p-3 text-center">
                        <div className="text-[9px] uppercase font-bold text-text-secondary mb-1">Scheduled Tasks</div>
                        <div className="font-black text-xl text-brand-orange">
                          {taskStats.scheduled}
                        </div>
                      </div>
                      <div className="bg-white/5 border border-white/5 rounded-2xl p-3 text-center col-span-2 lg:col-span-1">
                        <div className="text-[9px] uppercase font-bold text-text-secondary mb-1">Inactive Tasks</div>
                        <div className="font-black text-xl text-white/40">
                          {taskStats.inactive}
                        </div>
                      </div>
                    </div>
  ```
  And delete lines 769 to 820 completely (the `ACTIVE TASK EXECUTIONS` block).

- [ ] **Step 4: Run tests**
  Run: `pytest backend/tests/ -v` to ensure backend is fully operational.
  Run: `npm run build` in `frontend/` to confirm compiling.

- [ ] **Step 5: Commit**
  Run:
  ```bash
  git add backend/main.py frontend/src/App.tsx
  git commit -m "feat(telemetry): implement real-time task statistics counters and clean dashboard layout"
  ```

---

### Task 4: Audio/Video Input Source Form Logic
Implement dropdown restrictions and dependencies for separate source inputs in ProcessConfigForm.

**Files:**
- Modify: `frontend/src/components/ProcessConfigForm.tsx`

- [ ] **Step 1: Add allowedTypes variables and update panel renderings**
  Define the allowed type subsets at the top of `ProcessConfigForm.tsx` file (after imports) and inject them dynamically to `InputSourcePanel` components.
  
  In `frontend/src/components/ProcessConfigForm.tsx`:
  ```typescript
  const VIDEO_ALLOWED_TYPES = ['file', 'srt', 'ndi', 'udp', 'rtp', 'decklink', 'v4l2', 'lavfi_video'];
  const AUDIO_ALLOWED_TYPES = ['file', 'srt', 'ndi', 'udp', 'rtp', 'decklink', 'alsa', 'lavfi_audio'];
  ```
  
  Around line 458, replace `InputSourcePanel` for `input1` with:
  ```typescript
              <InputSourcePanel
                label={config.use_secondary_input ? "Input 1 — Video Source" : "Primary Source (Audio & Video)"}
                accentColor="var(--accent-lime)"
                config={config.input1}
                allowedTypes={
                  !config.has_audio && config.has_video
                    ? VIDEO_ALLOWED_TYPES
                    : config.has_video && !config.has_audio
                    ? VIDEO_ALLOWED_TYPES
                    : config.use_secondary_input
                    ? VIDEO_ALLOWED_TYPES
                    : !config.has_video && config.has_audio
                    ? AUDIO_ALLOWED_TYPES
                    : undefined
                }
                onChange={input1 => setConfig({ ...config, input1 })}
              />
  ```
  
  Around line 487, replace `InputSourcePanel` for `input2` with:
  ```typescript
                <InputSourcePanel
                  label="Input 2 — Audio Source"
                  accentColor="#60a5fa"
                  config={config.input2}
                  allowedTypes={AUDIO_ALLOWED_TYPES}
                  onChange={input2 => setConfig({ ...config, input2 })}
                />
  ```

- [ ] **Step 2: Add dynamic checks and resets on checkbox handlers**
  Update stream toggle buttons and the split secondary source checkbox handler to reset invalid types and enforce visibility logic.
  
  Update Stream Toggles (around lines 405-428):
  ```typescript
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox" checked={config.has_video}
                onChange={e => {
                  const val = e.target.checked;
                  const nextSecondary = val && config.has_audio ? config.use_secondary_input : false;
                  let nextInput1 = config.input1;
                  if (!val && config.has_audio) {
                    if (!AUDIO_ALLOWED_TYPES.includes(nextInput1.type)) {
                      nextInput1 = { ...nextInput1, type: 'file' };
                    }
                  } else if (val && !config.has_audio) {
                    if (!VIDEO_ALLOWED_TYPES.includes(nextInput1.type)) {
                      nextInput1 = { ...nextInput1, type: 'file' };
                    }
                  }
                  setConfig({ 
                    ...config, 
                    has_video: val, 
                    use_secondary_input: nextSecondary,
                    input1: nextInput1
                  });
                }}
                className="w-3.5 h-3.5 accent-brand-orange"
              />
              <span className={`text-xs font-bold uppercase tracking-wider ${config.has_video ? 'text-brand-orange' : 'text-text-secondary'}`}>
                Video
              </span>
            </label>
            <span className="w-px h-4 bg-white/10" />
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox" checked={config.has_audio}
                onChange={e => {
                  const val = e.target.checked;
                  const nextSecondary = config.has_video && val ? config.use_secondary_input : false;
                  let nextInput1 = config.input1;
                  if (config.has_video && !val) {
                    if (!VIDEO_ALLOWED_TYPES.includes(nextInput1.type)) {
                      nextInput1 = { ...nextInput1, type: 'file' };
                    }
                  } else if (!config.has_video && val) {
                    if (!AUDIO_ALLOWED_TYPES.includes(nextInput1.type)) {
                      nextInput1 = { ...nextInput1, type: 'file' };
                    }
                  }
                  setConfig({ 
                    ...config, 
                    has_audio: val, 
                    use_secondary_input: nextSecondary,
                    input1: nextInput1
                  });
                }}
                className="w-3.5 h-3.5 accent-blue-400"
              />
              <span className={`text-xs font-bold uppercase tracking-wider ${config.has_audio ? 'text-blue-400' : 'text-text-secondary'}`}>
                Audio
              </span>
            </label>
  ```
  
  And update the `"use_secondary_input"` toggle checkbox wrapper (around lines 466-482):
  ```typescript
            {/* Toggle: Use secondary input */}
            {config.has_video && config.has_audio && (
              <div className="flex items-center gap-3 px-2">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={config.use_secondary_input}
                    onChange={e => {
                      const val = e.target.checked;
                      let nextInput1 = config.input1;
                      let nextInput2 = config.input2;
                      if (val) {
                        if (!VIDEO_ALLOWED_TYPES.includes(nextInput1.type)) {
                          nextInput1 = { ...nextInput1, type: 'file' };
                        }
                        if (!AUDIO_ALLOWED_TYPES.includes(nextInput2.type)) {
                          nextInput2 = { ...nextInput2, type: 'file' };
                        }
                      }
                      setConfig({ 
                        ...config, 
                        use_secondary_input: val,
                        input1: nextInput1,
                        input2: nextInput2
                      });
                    }}
                    className="w-4 h-4 accent-brand-lime"
                  />
                  <span className="text-xs font-bold uppercase tracking-wider text-text-secondary group-hover:text-white transition-colors">
                    Use separate source for Input 2
                  </span>
                </label>
                <span className="text-[10px] text-white/20 italic">
                  (e.g. video from SDI + audio from network)
                </span>
              </div>
            )}
  ```

- [ ] **Step 3: Verify compiling**
  Run: `npm run build` inside `frontend/` directory.
  Expected: Build finishes with exit code 0.

- [ ] **Step 4: Commit**
  Run:
  ```bash
  git add frontend/src/components/ProcessConfigForm.tsx
  git commit -m "feat(forms): restrict allowed source types depending on stream settings and split state"
  ```
