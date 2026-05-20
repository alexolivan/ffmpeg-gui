# FFMPEG Service UI Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the FFMPEG service control modal to prevent vertical overflow, hide the video preview when inactive or audio-only, enable live telemetry updates, and improve control flow with Escape and backdrop click dismissals.

**Architecture:** Enrich backend WebSocket telemetry to send process input configurations. In the frontend, derive video availability to conditionally show/hide the preview pane, use a two-column responsive grid layout, enforce viewport height limits with scrollable log viewports, and bind closing triggers.

**Tech Stack:** React 19, TypeScript, Python (FastAPI/SQLAlchemy), TailwindCSS v4.

---

### Task 1: Enrich WebSocket Telemetry in Backend

**Files:**
- Modify: `backend/main.py:193-212`

- [ ] **Step 1: Modify the telemetry broadcast serialisation**
  Add `"input_config"` and `"codec_config"` keys to the dict returned for each process in the `telemetry_broadcast_loop` so the frontend knows whether a service has video enabled.

  Target content:
  ```python
              data = [
                  {
                      "id": p.id,
                      "name": p.name,
                      "type": p.type,
                      "status": p.status,
                      "cpu": p.cpu_usage,
                      "ram": p.ram_usage,
                      "bitrate": p.bitrate,
                      "fps": p.fps,
                      "speed": p.speed,
                      "ffmpeg_build_id": p.ffmpeg_build_id,
                  } for p in processes
              ]
  ```

  Replacement content:
  ```python
              data = [
                  {
                      "id": p.id,
                      "name": p.name,
                      "type": p.type,
                      "status": p.status,
                      "cpu": p.cpu_usage,
                      "ram": p.ram_usage,
                      "bitrate": p.bitrate,
                      "fps": p.fps,
                      "speed": p.speed,
                      "ffmpeg_build_id": p.ffmpeg_build_id,
                      "input_config": p.input_config,
                      "codec_config": p.codec_config,
                  } for p in processes
              ]
  ```

- [ ] **Step 2: Run backend test verification**
  Run: `curl -s http://localhost:8000/processes` (or run a python command to fetch it) to verify processes endpoints are working properly and schema models serialize without errors.
  Expected: JSON array returned containing processes details.

- [ ] **Step 3: Commit**
  ```bash
  git add backend/main.py
  git commit -m "feat(backend): add input_config and codec_config to websocket telemetry"
  ```

---

### Task 2: Implement Dynamic Detail Tracking and Escape Close Listener in Frontend

**Files:**
- Modify: `frontend/src/App.tsx` (state logic)

- [ ] **Step 1: Bind Escape key close listener**
  Inside `App` component, add a `useEffect` hook to listen to the `keydown` event on `window` and close the selected process modal when `Escape` is pressed.

  Target content:
  ```typescript
    // Lock body scroll when modals are active
  ```

  Replacement content:
  ```typescript
    // Escape key listener to close selected process modal
    useEffect(() => {
      if (!selectedProcess) return;
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          setSelectedProcess(null);
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedProcess]);

    // Lock body scroll when modals are active
  ```

- [ ] **Step 2: Update Selected Process lock helper**
  Add `selectedProcess !== null` to the `isModalOpen` condition to lock body scrolling when the process control view is open.

  Target content:
  ```typescript
    useEffect(() => {
      const isModalOpen = showAddModal || showAddBatchModal || showBuildForm || terminalBuild !== null || validationResult !== null;
  ```

  Replacement content:
  ```typescript
    useEffect(() => {
      const isModalOpen = showAddModal || showAddBatchModal || showBuildForm || terminalBuild !== null || validationResult !== null || selectedProcess !== null;
  ```

- [ ] **Step 3: Verify TypeScript builds successfully**
  Run: `npm run build` inside `frontend/` directory.
  Expected: Builds without TypeScript errors.

- [ ] **Step 4: Commit**
  ```bash
  git add frontend/src/App.tsx
  git commit -m "feat(frontend): lock scroll and bind escape key listener to service control panel"
  ```

---

### Task 3: Redesign Preview Modal UI Layout and Add Backdrop Click Closing

**Files:**
- Modify: `frontend/src/App.tsx` (JSX rendering)

- [ ] **Step 1: Replace Preview Modal markup**
  Replace the entire `{selectedProcess && (...)}` block with a restructured version.
  - Set container max height to `max-h-[90vh]` using flexbox.
  - Bind backdrop `onClick={() => setSelectedProcess(null)}` on the overlay, and `onClick={(e) => e.stopPropagation()}` on the card.
  - Dynamically lookup the latest process data in `telemetry`: `const currentProcess = telemetry.find(p => p.id === selectedProcess.id) || selectedProcess;`
  - Show the video preview only if `currentProcess.status === 'running' && currentProcess.input_config?.has_video !== false`.
  - When visible, render a 2-column responsive layout (`grid grid-cols-1 lg:grid-cols-2 gap-6`). Otherwise, render a single column.
  - Integrate a dedicated scrollable log terminal with proper styling and fixed height constraints.

  Target content:
  ```tsx
            {/* Preview Modal */}
            {selectedProcess && (
              <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-8 z-50">
                <div className="glass-card w-full max-w-4xl p-0 overflow-hidden relative">
                  <button onClick={() => setSelectedProcess(null)}
                    className="absolute top-6 right-6 w-10 h-10 bg-white/10 rounded-full flex items-center justify-center hover:bg-white/20 transition-colors">✕</button>
                  <div className="p-8 border-b border-white/5">
                    <h3 className="text-2xl font-bold">{selectedProcess.name}</h3>
                    <p className="text-text-secondary">Live Stream Preview (MJPEG)</p>
                  </div>
                  <div className="aspect-video bg-black flex items-center justify-center">
                    <img src={`${API}/processes/${selectedProcess.id}/preview`} alt="Live Preview" className="max-h-full object-contain" />
                  </div>
                  <div className="p-8 flex justify-between items-center bg-white/5">
                    <div className="flex gap-12">
                      <div>
                        <div className="text-text-secondary text-sm mb-1 uppercase font-semibold">Status</div>
                        <div className="text-brand-lime font-bold">{selectedProcess.status.toUpperCase()}</div>
                      </div>
                      <div>
                        <div className="text-text-secondary text-sm mb-1 uppercase font-semibold">Bitrate</div>
                        <div className="text-white font-bold font-mono">{selectedProcess.bitrate || '0 kb/s'}</div>
                      </div>
                      <div>
                        <div className="text-text-secondary text-sm mb-1 uppercase font-semibold">FPS / Speed</div>
                        <div className="text-white font-bold font-mono">{selectedProcess.fps || '0'} / {selectedProcess.speed || '0x'}</div>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <button onClick={() => {
                        fetch(`${API}/processes/${selectedProcess.id}/export`).then(r => r.json()).then(data => {
                          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                          const a = document.createElement('a')
                          a.href = URL.createObjectURL(blob)
                          a.download = `${selectedProcess.name}_profile.json`
                          a.click()
                        })
                      }} className="pill-button bg-white/10">EXPORT PROFILE</button>
                      <button onClick={() => fetch(`${API}/processes/${selectedProcess.id}/start`, { method: 'POST' })}
                        className="pill-button bg-brand-lime text-black">START</button>
                      <button onClick={() => fetch(`${API}/processes/${selectedProcess.id}/stop`, { method: 'POST' })}
                        className="pill-button bg-red-500/20 text-red-400">STOP</button>
                    </div>
                  </div>
                  <div className="bg-black p-8 border-t border-white/5 h-64 overflow-y-auto font-mono text-xs">
                    <div className="text-brand-lime mb-4 font-bold uppercase tracking-widest">Process Logs</div>
                    {logs.length === 0 ? (
                      <div className="text-white/20 italic">No logs available for this process</div>
                    ) : (
                      logs.map((log, i) => (
                        <div key={i} className="mb-1">
                          <span className="text-text-secondary">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                          <span className={`ml-2 ${log.level === 'ERROR' ? 'text-red-400' : 'text-white/80'}`}>{log.message}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
  ```

  Replacement content:
  ```tsx
            {/* Preview Modal */}
            {selectedProcess && (() => {
              const currentProcess = telemetry.find(p => p.id === selectedProcess.id) || selectedProcess;
              const hasVideo = currentProcess.input_config?.has_video !== false;
              const isRunning = currentProcess.status === 'running';
              const showPreview = isRunning && hasVideo;

              return (
                <div 
                  className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 md:p-8 z-50 cursor-pointer"
                  onClick={() => setSelectedProcess(null)}
                >
                  <div 
                    className="glass-card w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden relative border border-white/10 cursor-default"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Header */}
                    <div className="p-6 border-b border-white/5 flex justify-between items-center flex-shrink-0 bg-white/2">
                      <div>
                        <h3 className="text-2xl font-black uppercase tracking-tight">{currentProcess.name}</h3>
                        <p className="text-text-secondary text-xs uppercase tracking-wider mt-0.5">
                          {showPreview ? 'Live Stream Preview (MJPEG)' : 'Service Status & Configuration'}
                        </p>
                      </div>
                      <button 
                        onClick={() => setSelectedProcess(null)}
                        className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center text-text-secondary hover:text-white transition-colors"
                      >
                        ✕
                      </button>
                    </div>

                    {/* Scrollable Body */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-6 min-h-0 custom-scrollbar">
                      {showPreview ? (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                          {/* Col 1: System Telemetry Stats */}
                          <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                              <div className="bg-white/5 border border-white/5 rounded-2xl p-4 text-center">
                                <div className="text-[10px] uppercase font-bold text-text-secondary mb-1">Status</div>
                                <div className={`font-black text-sm tracking-tight ${currentProcess.status === 'running' ? 'text-brand-lime' : currentProcess.status === 'error' ? 'text-red-400' : 'text-white/60'}`}>
                                  {currentProcess.status.toUpperCase()}
                                </div>
                              </div>
                              <div className="bg-white/5 border border-white/5 rounded-2xl p-4 text-center">
                                <div className="text-[10px] uppercase font-bold text-text-secondary mb-1">Bitrate</div>
                                <div className="font-bold font-mono text-sm">{currentProcess.bitrate || '0 kb/s'}</div>
                              </div>
                              <div className="bg-white/5 border border-white/5 rounded-2xl p-4 text-center">
                                <div className="text-[10px] uppercase font-bold text-text-secondary mb-1">FPS</div>
                                <div className="font-bold font-mono text-sm">{currentProcess.fps || '0'}</div>
                              </div>
                              <div className="bg-white/5 border border-white/5 rounded-2xl p-4 text-center">
                                <div className="text-[10px] uppercase font-bold text-text-secondary mb-1">Speed</div>
                                <div className="font-bold font-mono text-sm">{currentProcess.speed || '0x'}</div>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex justify-between items-center">
                                <span className="text-[10px] uppercase font-black text-text-secondary">CPU Usage</span>
                                <span className="font-mono font-bold text-brand-lime">{currentProcess.cpu || 0}%</span>
                              </div>
                              <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex justify-between items-center">
                                <span className="text-[10px] uppercase font-black text-text-secondary">RAM Usage</span>
                                <span className="font-mono font-bold text-brand-orange">{currentProcess.ram || 0} MB</span>
                              </div>
                            </div>
                          </div>

                          {/* Col 2: Live Video Preview */}
                          <div className="flex flex-col justify-center">
                            <div className="aspect-video bg-black rounded-2xl overflow-hidden border border-white/5 flex items-center justify-center relative shadow-2xl">
                              <img 
                                src={`${API}/processes/${currentProcess.id}/preview`} 
                                alt="Live Preview" 
                                className="max-h-full max-w-full object-contain" 
                              />
                              <div className="absolute top-3 left-3 px-2.5 py-1 bg-brand-lime text-black text-[9px] font-black rounded-md tracking-wider uppercase animate-pulse">
                                LIVE
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="max-w-3xl mx-auto space-y-4">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                            <div className="bg-white/5 border border-white/5 rounded-2xl p-4 text-center">
                              <div className="text-[10px] uppercase font-bold text-text-secondary mb-1">Status</div>
                              <div className={`font-black text-sm tracking-tight ${currentProcess.status === 'running' ? 'text-brand-lime' : currentProcess.status === 'error' ? 'text-red-400' : 'text-white/60'}`}>
                                {currentProcess.status.toUpperCase()}
                              </div>
                            </div>
                            <div className="bg-white/5 border border-white/5 rounded-2xl p-4 text-center">
                              <div className="text-[10px] uppercase font-bold text-text-secondary mb-1">Bitrate</div>
                              <div className="font-bold font-mono text-sm">{currentProcess.bitrate || '0 kb/s'}</div>
                            </div>
                            <div className="bg-white/5 border border-white/5 rounded-2xl p-4 text-center">
                              <div className="text-[10px] uppercase font-bold text-text-secondary mb-1">FPS</div>
                              <div className="font-bold font-mono text-sm">{currentProcess.fps || '0'}</div>
                            </div>
                            <div className="bg-white/5 border border-white/5 rounded-2xl p-4 text-center">
                              <div className="text-[10px] uppercase font-bold text-text-secondary mb-1">Speed</div>
                              <div className="font-bold font-mono text-sm">{currentProcess.speed || '0x'}</div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex justify-between items-center">
                              <span className="text-[10px] uppercase font-black text-text-secondary">CPU Usage</span>
                              <span className="font-mono font-bold text-brand-lime">{currentProcess.cpu || 0}%</span>
                            </div>
                            <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex justify-between items-center">
                              <span className="text-[10px] uppercase font-black text-text-secondary">RAM Usage</span>
                              <span className="font-mono font-bold text-brand-orange">{currentProcess.ram || 0} MB</span>
                            </div>
                          </div>

                          {!hasVideo && isRunning && (
                            <div className="p-5 bg-brand-blue/10 border border-brand-blue/20 rounded-2xl flex items-center gap-4 animate-in fade-in duration-300">
                              <span className="text-2xl">📻</span>
                              <div>
                                <div className="font-bold text-brand-blue uppercase text-xs tracking-wider">Audio-Only Broadcast Active</div>
                                <div className="text-xs text-text-secondary mt-0.5">This service does not produce video outputs. Audio signals are processing normally.</div>
                              </div>
                            </div>
                          )}

                          {!isRunning && (
                            <div className="p-5 bg-white/2 border border-white/5 rounded-2xl flex items-center gap-4 text-text-secondary">
                              <span className="text-2xl">💤</span>
                              <div>
                                <div className="font-bold uppercase text-xs tracking-wider">Service Inactive</div>
                                <div className="text-xs mt-0.5">Start the service below to begin broadcasting and telemetry streams.</div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Process Terminal logs */}
                      <div className="bg-black/60 border border-white/5 rounded-2xl p-4 font-mono text-xs max-w-5xl mx-auto w-full">
                        <div className="flex justify-between items-center mb-3">
                          <span className="text-brand-lime font-bold uppercase tracking-wider text-[10px]">Process Logs</span>
                          <span className="text-text-secondary text-[10px] font-bold">{logs.length} lines buffered</span>
                        </div>
                        <div className="h-44 overflow-y-auto space-y-1 custom-scrollbar pr-2 select-text">
                          {logs.length === 0 ? (
                            <div className="text-white/20 italic text-center py-10 select-none">No logs available for this process</div>
                          ) : (
                            logs.map((log, i) => (
                              <div key={i} className="leading-relaxed whitespace-pre-wrap">
                                <span className="text-text-secondary select-none">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                                <span className={`ml-2 ${log.level === 'ERROR' ? 'text-red-400 font-bold' : 'text-white/80'}`}>{log.message}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="p-6 border-t border-white/5 flex-shrink-0 bg-white/2 flex justify-between items-center flex-wrap gap-4">
                      <div>
                        <button 
                          onClick={() => {
                            fetch(`${API}/processes/${currentProcess.id}/export`)
                              .then(r => r.json())
                              .then(data => {
                                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                                const a = document.createElement('a')
                                a.href = URL.createObjectURL(blob)
                                a.download = `${currentProcess.name}_profile.json`
                                a.click()
                              })
                          }} 
                          className="pill-button bg-white/10 hover:bg-white/15 text-xs py-2 px-6"
                        >
                          EXPORT PROFILE
                        </button>
                      </div>
                      <div className="flex gap-3">
                        {currentProcess.status !== 'running' ? (
                          <button 
                            onClick={() => fetch(`${API}/processes/${currentProcess.id}/start`, { method: 'POST' })}
                            className="pill-button bg-brand-lime hover:scale-[1.02] text-black text-xs font-black py-2 px-6"
                          >
                            START SERVICE
                          </button>
                        ) : (
                          <button 
                            onClick={() => fetch(`${API}/processes/${currentProcess.id}/stop`, { method: 'POST' })}
                            className="pill-button bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs font-bold py-2 px-6"
                          >
                            STOP SERVICE
                          </button>
                        )}
                        <button 
                          onClick={() => setSelectedProcess(null)}
                          className="pill-button bg-white/5 hover:bg-white/10 text-xs border border-white/10 py-2 px-6"
                        >
                          CLOSE
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
  ```

- [ ] **Step 2: Run code compilation check**
  Run: `npm run build` inside `frontend/` directory.
  Expected: Build succeeds with 0 errors.

- [ ] **Step 3: Run lint check**
  Run: `npm run lint` inside `frontend/` directory.
  Expected: Code linting passes cleanly.

- [ ] **Step 4: Commit**
  ```bash
  git add frontend/src/App.tsx
  git commit -m "feat(frontend): redesign layout and add backdrop click close to service control modal"
  ```

---

### Task 4: Add Broadcast VU-Meter level meter future plan to Roadmap

**Files:**
- Modify: `docs/FFMPEG_FORGE_ROADMAP.md`

- [ ] **Step 1: Append VU-meter level indication entry**
  Add a roadmap check item detailing the integration of a red-green dual stereo bar audio VU-meter level monitor for live audio signals.

  Target content:
  ```markdown
  ## 🚀 Mejoras de UX Sugeridas
  - [ ] **Asistente de Carga de SDK (Upload Assist):** Implementar un botón en el GUI para subir archivos `.zip` o `.tar.gz` de los SDKs, que el servidor descomprima automáticamente en una ruta predefinida.
  - [ ] **Pre-compilación de Headers:** Automatizar la descarga de `nv-codec-headers` para evitar que el usuario tenga que buscarlos manualmente.
  - [ ] **Streaming de Logs mejorado:** Añadir botones de "Download Logs" y "Search" en el terminal de compilación.
  ```

  Replacement content:
  ```markdown
  ## 🚀 Mejoras de UX Sugeridas
  - [ ] **Asistente de Carga de SDK (Upload Assist):** Implementar un botón en el GUI para subir archivos `.zip` o `.tar.gz` de los SDKs, que el servidor descomprima automáticamente en una ruta predefinida.
  - [ ] **Pre-compilación de Headers:** Automatizar la descarga de `nv-codec-headers` para evitar que el usuario tenga que buscarlos manualmente.
  - [ ] **Streaming de Logs mejorado:** Añadir botones de "Download Logs" y "Search" en el terminal de compilación.
  - [ ] **Vúmetro de Audio Broadcast (Audio Level VU-Meter):** Evaluar la viabilidad de integrar un vúmetro estéreo de doble barra (escala verde-rojo) en la pantalla de control para streams de audio o streams con audio activo, permitiendo monitorizar niveles en tiempo real sin requerir decodificación de video.
  ```

- [ ] **Step 2: Verify git status**
  Run: `git status`
  Expected: working tree is clean except for modified files, ready for commit.

- [ ] **Step 3: Commit**
  ```bash
  git add docs/FFMPEG_FORGE_ROADMAP.md
  git commit -m "docs: add broadcast audio vu-meter to UX improvements roadmap"
  ```
