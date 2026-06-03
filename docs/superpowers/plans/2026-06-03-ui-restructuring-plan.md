# UI Restructuring and Hardware Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the UI to separate Dashboard (telemetry/load/capabilities) from Services (continuous processes control), clean up Settings, and implement backend hardware capability detection.

**Architecture:** Add a new endpoint `GET /system/capabilities` in the FastAPI backend detecting Linux system nodes (V4L2, VAAPI, NVENC, ALSA, DeckLink). Reorganize navigation tabs in React/TypeScript, creating a separate "Services" view matching the "Batch Jobs" layout, cleaning Settings of system info, and restructuring the Dashboard as a 3-column grid of load metrics, process counters, and dynamic hardware capability detection.

**Tech Stack:** Python (FastAPI, shutil, glob), React (TypeScript, Tailwind CSS)

---

## File Structure Changes
- **Modify**: `backend/main.py` — Add `/system/capabilities` endpoint.
- **New**: `backend/tests/test_system_capabilities.py` — Test suite for capabilities detection.
- **Modify**: `frontend/src/components/Sidebar.tsx` — Add "Services" navigation item, remove bottom redundant gear.
- **Modify**: `frontend/src/App.tsx` — Reorganize Dashboard render, implement separate Services view, remove System Info from Settings.

---

### Task 1: Implement Backend Hardware Detection API

**Files:**
- Create: `backend/tests/test_system_capabilities.py`
- Modify: `backend/main.py`

- [ ] **Step 1: Write the failing test**
  Create `backend/tests/test_system_capabilities.py` with:
  ```python
  import os
  import sys
  import unittest
  from fastapi.testclient import TestClient

  sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
  from main import app

  class TestSystemCapabilities(unittest.TestCase):
      def setUp(self):
          self.client = TestClient(app)

      def test_get_capabilities_endpoint(self):
          response = self.client.get("/system/capabilities")
          self.assertEqual(response.status_code, 200)
          data = response.json()
          for key in ["vaapi", "nvenc", "v4l2", "alsa", "decklink"]:
              self.assertIn(key, data)
              self.assertIn("available", data[key])
              self.assertIn("details", data[key])

  if __name__ == "__main__":
      unittest.main()
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `venv/bin/python backend/tests/test_system_capabilities.py`
  Expected: FAIL (status_code 404)

- [ ] **Step 3: Implement endpoint in main.py**
  Add imports and route in `backend/main.py` at the bottom of the System settings section (around line 178):
  ```python
  import glob
  import shutil

  @app.get("/system/capabilities")
  def get_system_capabilities():
      """Detect host system hardware capabilities (VAAPI, NVENC, V4L2, ALSA, DeckLink)."""
      # VAAPI
      vaapi_available = os.path.exists("/dev/dri") and len(
          glob.glob("/dev/dri/renderD*") + glob.glob("/dev/dri/card*")
      ) > 0
      vaapi_details = "Render nodes detected in /dev/dri" if vaapi_available else "No render nodes found in /dev/dri"

      # NVENC
      nvenc_available = shutil.which("nvidia-smi") is not None or os.path.exists("/dev/nvidia0")
      nvenc_details = "NVIDIA driver/card detected" if nvenc_available else "NVIDIA command/device not found"

      # V4L2
      v4l2_devices = glob.glob("/dev/video*")
      v4l2_available = len(v4l2_devices) > 0
      v4l2_details = f"Detected video nodes: {', '.join(v4l2_devices)}" if v4l2_available else "No video nodes found in /dev/video*"

      # ALSA
      alsa_available = os.path.exists("/proc/asound/cards") or os.path.exists("/dev/snd")
      alsa_details = "ALSA sound card node(s) present" if alsa_available else "No ALSA interface found"

      # DeckLink
      decklink_available = os.path.exists("/dev/blackmagic") or os.path.exists("/dev/bm0")
      decklink_details = "DeckLink kernel driver active" if decklink_available else "No DeckLink interface found (simulated)"

      return {
          "vaapi": {"available": vaapi_available, "details": vaapi_details},
          "nvenc": {"available": nvenc_available, "details": nvenc_details},
          "v4l2": {"available": v4l2_available, "details": v4l2_details},
          "alsa": {"available": alsa_available, "details": alsa_details},
          "decklink": {"available": decklink_available, "details": decklink_details}
      }
  ```

- [ ] **Step 4: Run test to verify it passes**
  Run: `venv/bin/python backend/tests/test_system_capabilities.py`
  Expected: PASS (status_code 200, valid JSON response)

- [ ] **Step 5: Commit**
  Run:
  ```bash
  git add backend/main.py backend/tests/test_system_capabilities.py
  git commit -m "feat(api): implement system hardware capabilities detection endpoint"
  ```

---

### Task 2: Sidebar Restructuring

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`

- [ ] **Step 1: Modify Sidebar.tsx**
  Replace lines 12-17 with new navigation items, and remove the bottom redundant settings button container (lines 46-54).
  Target lines 12-17 in `Sidebar.tsx`:
  ```typescript
  const items = [
    { id: 'dashboard', icon: '🏠', label: 'Dashboard' },
    { id: 'services', icon: '⚡', label: 'Services' },
    { id: 'batch', icon: '📅', label: 'Batch Jobs' },
    { id: 'settings', icon: '⚙️', label: 'Settings' },
    { id: 'tools', icon: '🛠️', label: 'Tools' },
  ];
  ```
  Target lines 46-54 in `Sidebar.tsx`:
  Remove this block:
  ```tsx
  <div className="mt-auto">
    <div 
      className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center text-2xl cursor-pointer hover:bg-white/10 transition-colors"
      onClick={() => onViewChange('settings')}
    >
      ⚙️
    </div>
  </div>
  ```

- [ ] **Step 2: Verify in frontend**
  Compile test: run `npm run build` in the `frontend` folder or verify files compile cleanly.

- [ ] **Step 3: Commit**
  Run:
  ```bash
  git add frontend/src/components/Sidebar.tsx
  git commit -m "refactor(ui): update sidebar navigation items and remove redundant settings gear"
  ```

---

### Task 3: Extract Services View in App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Implement services activeView**
  In `frontend/src/App.tsx`, we need to handle the `services` view.
  Add `activeView === 'services'` view rendering right after the `activeView === 'dashboard'` conditional block ends (or before `activeView === 'batch'`).
  The view must look identical/homogeneous to `batch` view, with:
  ```tsx
        ) : activeView === 'services' ? (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <header className="flex justify-between items-center mb-12">
              <div>
                <h1 className="text-4xl font-bold mb-2">SERVICES</h1>
                <p className="text-text-secondary">Continuous media streaming and processing node instances</p>
              </div>
              <div className="flex gap-4">
                <button onClick={() => importFileRef.current?.click()}
                  className="pill-button bg-white/10 hover:bg-white/15 border border-white/10 text-white font-bold transition-all">
                  📥 IMPORT PROFILE
                </button>
                <button onClick={() => setShowAddModal(true)}
                  className="pill-button bg-brand-lime text-black font-black font-bold transition-all">
                  + NEW SERVICE
                </button>
              </div>
            </header>

            <div className="space-y-8">
              {/* Active Running Services */}
              <div className="glass-card p-8">
                <h3 className="text-xl font-black mb-6">ACTIVE SERVICES (RUNNING)</h3>
                <div className="space-y-6">
                  {telemetry.filter(p => (p.type === 'service' || !p.type) && p.status === 'running').length === 0 ? (
                    <div className="text-text-secondary py-8 text-center border border-dashed border-white/5 rounded-2xl">
                      No running services
                    </div>
                  ) : (
                    telemetry.filter(p => (p.type === 'service' || !p.type) && p.status === 'running').map(proc => (
                      <div key={proc.id} onClick={() => setSelectedProcess(proc)}
                        className="flex items-center justify-between p-4 bg-brand-lime/5 rounded-2xl border border-brand-lime/10 cursor-pointer hover:bg-brand-lime/10 transition-colors">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-brand-lime animate-pulse"></span>
                            <span className="font-bold text-white">{proc.name}</span>
                            {proc.pending_changes && (
                              <span className="text-[10px] bg-brand-orange/20 text-brand-orange px-2 py-0.5 rounded font-black animate-pulse" title="Requires reboot to apply new configuration">
                                PENDING REBOOT
                              </span>
                            )}
                            {proc.auto_start && (
                              <span className="text-[9px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded font-bold" title="Auto-starts on system boot">
                                ⚡ BOOT
                              </span>
                            )}
                            {proc.watchdog_enabled && (
                              <span className="text-[9px] bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded font-bold" title="Monitored by system watchdog">
                                🛡️ WATCHDOG
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-text-secondary">PID: {proc.pid || 'N/A'}</div>
                        </div>
                        <div className="flex gap-8">
                          <div className="text-center">
                            <div className="text-brand-lime font-mono font-bold">{proc.cpu}%</div>
                            <div className="text-[10px] uppercase text-text-secondary">CPU</div>
                          </div>
                          <div className="text-center">
                            <div className="text-brand-orange font-mono font-bold">{proc.ram}MB</div>
                            <div className="text-[10px] uppercase text-text-secondary">RAM</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="flex gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingProcess(proc);
                              }}
                              className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-sm border border-white/10 transition-all hover:scale-105"
                              title="Edit Service Settings"
                            >
                              ✏️
                            </button>
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
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStopService(proc.id);
                              }}
                              className="w-8 h-8 rounded-xl bg-red-500/10 hover:bg-red-500/20 flex items-center justify-center text-sm border border-red-500/20 text-red-400 transition-all hover:scale-105"
                              title="Stop Service"
                            >
                              ⏹️
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Inactive Configured Services */}
              <div className="glass-card p-8">
                <h3 className="text-xl font-black mb-6 text-white/50">CONFIGURED SERVICES (INACTIVE)</h3>
                <div className="space-y-6">
                  {telemetry.filter(p => (p.type === 'service' || !p.type) && p.status !== 'running').length === 0 ? (
                    <div className="text-text-secondary py-8 text-center border border-dashed border-white/5 rounded-2xl">
                      No inactive services
                    </div>
                  ) : (
                    telemetry.filter(p => (p.type === 'service' || !p.type) && p.status !== 'running').map(proc => {
                      const inputCfg = proc.input_config || {};
                      const isNewFormat = 'input1' in inputCfg;
                      const inputType = isNewFormat 
                        ? (inputCfg.input1?.type || 'N/A') 
                        : (inputCfg.type || 'N/A');
                      const outputCfg = proc.output_config || {};
                      const outputType = outputCfg.type || 'N/A';

                      return (
                        <div key={proc.id} onClick={() => setSelectedProcess(proc)}
                          className="flex items-center justify-between p-4 bg-white/2 opacity-75 hover:opacity-100 rounded-2xl border border-white/5 cursor-pointer hover:bg-white/5 transition-all">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full bg-white/20"></span>
                              <span className="font-bold text-white/80">{proc.name}</span>
                              {proc.auto_start && (
                                <span className="text-[9px] bg-blue-500/20 text-blue-400/80 px-2 py-0.5 rounded font-bold" title="Auto-starts on system boot">
                                  ⚡ BOOT
                                </span>
                              )}
                              {proc.watchdog_enabled && (
                                <span className="text-[9px] bg-purple-500/20 text-purple-400/80 px-2 py-0.5 rounded font-bold" title="Monitored by system watchdog">
                                  🛡️ WATCHDOG
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-text-secondary">
                              {inputType.toUpperCase()} ➔ {outputType.toUpperCase()}
                            </div>
                          </div>
                          <div className="flex gap-4 items-center">
                            <div className="flex gap-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleStartService(proc.id);
                                }}
                                className="w-8 h-8 rounded-xl bg-brand-lime/10 hover:bg-brand-lime/20 flex items-center justify-center text-sm border border-brand-lime/20 text-brand-lime transition-all hover:scale-105"
                                title="Start Service"
                              >
                                ▶️
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingProcess(proc);
                                }}
                                className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-sm border border-white/10 transition-all hover:scale-105"
                                title="Edit Service Settings"
                              >
                                ✏️
                              </button>
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
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteProcess(proc);
                                }}
                                className="w-8 h-8 rounded-xl bg-red-500/10 hover:bg-red-500/20 flex items-center justify-center text-sm border border-red-500/20 text-red-400 transition-all hover:scale-105"
                                title="Delete Service"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
  ```

- [ ] **Step 2: Verify in frontend**
  Compile test: run `npm run build` in the `frontend` folder or verify files compile cleanly.

- [ ] **Step 3: Commit**
  Run:
  ```bash
  git add frontend/src/App.tsx
  git commit -m "feat(ui): implement independent services view twin layout to batch jobs"
  ```

---

### Task 4: Clean Up Settings View in App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Remove System Info panel from Settings**
  Target lines 1247-1264 in `frontend/src/App.tsx` and delete the following block:
  ```tsx
              {/* Node Stats (Read Only) */}
              <div className="glass-card p-8 border-white/5">
                <h3 className="text-xl font-bold mb-6 text-text-secondary uppercase text-sm tracking-widest">System Info</h3>
                <div className="grid grid-cols-3 gap-8">
                  <div>
                    <div className="text-[10px] uppercase text-text-secondary mb-1">Architecture</div>
                    <div className="font-mono text-sm">x86_64 Linux</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-text-secondary mb-1">Active Profiles</div>
                    <div className="font-mono text-sm">{builds.filter(b => b.status === 'ready').length}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-text-secondary mb-1">Backend V.</div>
                    <div className="font-mono text-sm text-brand-lime">v1.2.0-stable</div>
                  </div>
                </div>
              </div>
  ```

- [ ] **Step 2: Verify in frontend**
  Compile test: run `npm run build` in the `frontend` folder.

- [ ] **Step 3: Commit**
  Run:
  ```bash
  git add frontend/src/App.tsx
  git commit -m "refactor(ui): remove system info read-only panel from settings view"
  ```

---

### Task 5: Restructure Dashboard View in App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Fetch hardware capabilities on mount**
  In `frontend/src/App.tsx`, define a state and fetch capabilities on mount.
  Add state hook near other states in `App.tsx` (around line 15):
  ```typescript
  const [capabilities, setCapabilities] = useState<any>(null);
  ```
  Add a `fetchCapabilities` function and call it in `useEffect` (around line 150):
  ```typescript
  const fetchCapabilities = async () => {
    try {
      const res = await fetch(`${API}/system/capabilities`);
      if (res.ok) {
        const data = await res.json();
        setCapabilities(data);
      }
    } catch (err) {
      console.error("Failed to fetch hardware capabilities:", err);
    }
  };

  useEffect(() => {
    fetchCapabilities();
  }, []);
  ```

- [ ] **Step 2: Implement the structured 3-column Dashboard layout**
  Replace the old Dashboard view rendering code (lines 520 to 743 in `App.tsx`) with:
  ```tsx
        {activeView === 'dashboard' ? (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <header className="flex justify-between items-center mb-12">
              <div>
                <h1 className="text-4xl font-bold mb-2">DASHBOARD</h1>
                <p className="text-text-secondary">Monitoring and telemetry overview of host node</p>
              </div>
              <div className="flex gap-4">
                <div className="pill-button bg-white/5 border border-white/10 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-brand-lime"></span>
                  Node: Standalone
                </div>
              </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {/* Column 1: System Load & Info */}
              <div className="space-y-8">
                {/* Real-time Load */}
                <div className="glass-card p-8">
                  <h3 className="text-xl font-bold mb-6 uppercase tracking-wider text-sm text-text-secondary">System Load</h3>
                  <div className="space-y-6">
                    <div>
                      <div className="flex justify-between mb-2">
                        <span className="text-text-secondary text-xs">Total CPU</span>
                        <span className="text-brand-lime text-xs font-bold">12%</span>
                      </div>
                      <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-brand-lime w-[12%] transition-all"></div>
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between mb-2">
                        <span className="text-text-secondary text-xs">Memory Usage</span>
                        <span className="text-brand-orange text-xs font-bold">2.4GB / 16GB</span>
                      </div>
                      <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-brand-orange w-[15%] transition-all"></div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* System Info (Moved from Settings) */}
                <div className="glass-card p-8">
                  <h3 className="text-xl font-bold mb-6 uppercase tracking-wider text-sm text-text-secondary">System Info</h3>
                  <div className="grid grid-cols-1 gap-4">
                    <div className="flex justify-between items-center py-2 border-b border-white/5">
                      <span className="text-text-secondary text-xs">Architecture</span>
                      <span className="font-mono text-xs font-bold text-white">x86_64 Linux</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-white/5">
                      <span className="text-text-secondary text-xs">Active Profiles</span>
                      <span className="font-mono text-xs font-bold text-brand-lime">{builds.filter(b => b.status === 'ready').length}</span>
                    </div>
                    <div className="flex justify-between items-center py-2">
                      <span className="text-text-secondary text-xs">Backend V.</span>
                      <span className="font-mono text-xs font-bold text-brand-lime">v1.2.0-stable</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Column 2: Process Counters & Scheduler */}
              <div className="space-y-8">
                {/* Process Stats Cards */}
                <div className="glass-card p-8 space-y-6">
                  <h3 className="text-xl font-bold mb-2 uppercase tracking-wider text-sm text-text-secondary">Process Status</h3>
                  
                  {/* Services stats */}
                  <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
                    <div>
                      <div className="text-xs text-text-secondary font-bold uppercase tracking-wider">Services</div>
                      <div className="text-2xl font-black mt-1">
                        {telemetry.filter(p => (p.type === 'service' || !p.type) && p.status === 'running').length} 
                        <span className="text-sm font-normal text-text-secondary"> / {telemetry.filter(p => (p.type === 'service' || !p.type)).length} running</span>
                      </div>
                    </div>
                  </div>

                  {/* Jobs stats */}
                  <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
                    <div>
                      <div className="text-xs text-text-secondary font-bold uppercase tracking-wider">Batch Jobs</div>
                      <div className="text-2xl font-black mt-1">
                        {telemetry.filter(p => p.type === 'batch' && p.status === 'running').length}
                        <span className="text-sm font-normal text-text-secondary"> / {telemetry.filter(p => p.type === 'batch').length} running</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Scheduler Status Card */}
                <div className="glass-card p-8">
                  <h3 className="text-xl font-bold mb-4 uppercase tracking-wider text-sm text-text-secondary">Task Scheduler</h3>
                  <div className="p-4 bg-brand-orange/10 border border-brand-orange/20 rounded-2xl text-center">
                    <span className="px-2 py-0.5 bg-brand-orange text-black font-black text-[9px] rounded uppercase tracking-wider block mx-auto w-max mb-3">
                      Sin programador activo
                    </span>
                    <p className="text-xs text-text-secondary leading-relaxed">
                      El programador automatizado y ejecución por calendario de batch jobs se implementará en el siguiente sprint.
                    </p>
                  </div>
                </div>
              </div>

              {/* Column 3: Hardware Capabilities */}
              <div className="glass-card p-8">
                <h3 className="text-xl font-bold mb-6 uppercase tracking-wider text-sm text-text-secondary">Hardware Capabilities</h3>
                <div className="space-y-4">
                  {capabilities ? (
                    Object.entries(capabilities).map(([key, info]: any) => (
                      <div key={key} className="flex items-start gap-3 p-3 bg-white/2 border border-white/5 rounded-2xl">
                        <span className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${info.available ? 'bg-brand-lime shadow-lg shadow-brand-lime/20' : 'bg-white/20'}`}></span>
                        <div>
                          <div className="text-xs font-black uppercase tracking-wider text-white">{key}</div>
                          <div className="text-[10px] text-text-secondary mt-0.5 leading-normal">{info.details || info.devices?.join(', ') || 'No detectado'}</div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-text-secondary text-xs italic py-8 text-center animate-pulse">
                      Detectando recursos de hardware...
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
      ```

- [ ] **Step 3: Verify in frontend**
  Compile test: run `npm run build` in the `frontend` folder.

- [ ] **Step 4: Commit**
  Run:
  ```bash
  git add frontend/src/App.tsx
  git commit -m "feat(ui): implement 3-column dashboard grid with system load, stats, and hardware capabilities"
  ```
