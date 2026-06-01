import React, { useState, useEffect, useRef } from 'react'
import Sidebar from './components/Sidebar'
import ProcessConfigForm from './components/ProcessConfigForm'
import BatchJobForm from './components/BatchJobForm'
import BuildProfileCard from './components/BuildProfileCard'
import type { BuildProfile } from './components/BuildProfileCard'
import BuildFormModal from './components/BuildFormModal'
import type { BuildFormData } from './components/BuildFormModal'
import BuildTerminal from './components/BuildTerminal'

const API = 'http://localhost:8000'

function App() {
  const [activeView, setActiveView] = useState('dashboard')
  const [telemetry, setTelemetry] = useState<any[]>([])
  const [selectedProcess, setSelectedProcess] = useState<any | null>(null)
  const [logs, setLogs] = useState<any[]>([])
  const processLogsContainerRef = useRef<HTMLDivElement>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showAddBatchModal, setShowAddBatchModal] = useState(false)
  const [editingProcess, setEditingProcess] = useState<any | null>(null)

  // ── Build Profiles state ──────────────────────────────────────
  const [builds, setBuilds] = useState<BuildProfile[]>([])
  const [showBuildForm, setShowBuildForm] = useState(false)
  const [editingBuild, setEditingBuild] = useState<BuildProfile | null>(null)
  const [terminalBuild, setTerminalBuild] = useState<{ id: number, name: string } | null>(null)
  
  // Settings & Auth
  const [settings, setSettings] = useState({
    node_name: 'FFMPEG-GUI Node',
    logo_text: 'FF',
    logo_path: null as string | null,
    gui_password: '',
    accent_color: '#FF6B00'
  })
  const [isAuthenticated, setIsAuthenticated] = useState(true) // Initial check
  const [loginPass, setLoginPass] = useState('')
  const [isLoginError, setIsLoginError] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState('')
  const [buildDeps, setBuildDeps] = useState<any>({})
  const [checkStatus, setCheckStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [validationResult, setValidationResult] = useState<{ buildId: number; output: string } | null>(null)
  const [diskInfo, setDiskInfo] = useState<{ free_gb: number; free_mb: number } | null>(null)

  // ── Service CRUD & Actions Handlers ────────────────────────────
  const handleDeleteProcess = async (proc: any) => {
    const isConfirmed = window.confirm(
      `⚠️ WARNING: Are you sure you want to delete the service "${proc.name}"?\n\nIf it is currently running, it will be forcefully terminated, causing an immediate signal interruption for any connected clients.`
    );
    if (!isConfirmed) return;

    try {
      await fetch(`${API}/processes/${proc.id}`, {
        method: 'DELETE',
      });
      if (selectedProcess && selectedProcess.id === proc.id) {
        setSelectedProcess(null);
      }
    } catch (err) {
      console.error("Error deleting process:", err);
    }
  };

  const handleStartService = async (procId: number) => {
    setLogs([]);
    try {
      await fetch(`${API}/processes/${procId}/start`, { method: 'POST' });
    } catch (err) {
      console.error("Error starting process:", err);
    }
  };

  const handleStopService = async (procId: number) => {
    try {
      await fetch(`${API}/processes/${procId}/stop`, { method: 'POST' });
    } catch (err) {
      console.error("Error stopping process:", err);
    }
  };

  const handleCloneProcess = async (proc: any) => {
    try {
      const res = await fetch(`${API}/processes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${proc.name} (Copy)`,
          type: 'service',
          input_config: proc.input_config,
          output_config: proc.output_config,
          codec_config: proc.codec_config,
          filter_config: proc.filter_config,
          ffmpeg_build_id: proc.ffmpeg_build_id,
          auto_start: proc.auto_start,
          watchdog_enabled: proc.watchdog_enabled,
          watchdog_retries: proc.watchdog_retries,
        })
      });
      if (!res.ok) {
        const errData = await res.json();
        alert(`Error cloning service: ${errData.detail || 'Unknown error'}`);
      }
    } catch (err) {
      console.error("Error cloning process:", err);
    }
  };

  const handleRestartService = async (procId: number, procName: string) => {
    const isConfirmed = window.confirm(
      `⚠️ live broadcast WARNING:\n\nAre you sure you want to restart "${procName}"? Any active live stream connections (SRT/UDP/RTP) will drop and experience a temporary signal loss during restart.`
    );
    if (!isConfirmed) return;

    try {
      setLogs([]);
      // Graceful stop
      await fetch(`${API}/processes/${procId}/stop`, { method: 'POST' });
      // Start again
      await fetch(`${API}/processes/${procId}/start`, { method: 'POST' });
    } catch (err) {
      console.error("Error restarting process:", err);
    }
  };

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
  useEffect(() => {
    const isModalOpen = showAddModal || showAddBatchModal || showBuildForm || terminalBuild !== null || validationResult !== null || selectedProcess !== null || editingProcess !== null;
    if (isModalOpen) {
      document.body.classList.add('overflow-hidden');
    } else {
      document.body.classList.remove('overflow-hidden');
    }
    return () => {
      document.body.classList.remove('overflow-hidden');
    };
  }, [showAddModal, showAddBatchModal, showBuildForm, terminalBuild, validationResult, selectedProcess, editingProcess]);

  // ── Telemetry WebSocket ────────────────────────────────────────
  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8000/ws/telemetry')
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === 'telemetry') setTelemetry(msg.data)
    }
    return () => ws.close()
  }, [])

  // ── Process logs polling ───────────────────────────────────────
  useEffect(() => {
    if (!selectedProcess) return
    const fetchLogs = async () => {
      const res = await fetch(`${API}/processes/${selectedProcess.id}/logs`)
      setLogs(await res.json())
    }
    fetchLogs()
    const interval = setInterval(fetchLogs, 2000)
    return () => clearInterval(interval)
  }, [selectedProcess])

  // ── Auto-scroll logs when running ──────────────────────────────
  useEffect(() => {
    if (processLogsContainerRef.current && selectedProcess) {
      const currentProcess = telemetry.find(p => p.id === selectedProcess.id) || selectedProcess;
      const isRunning = currentProcess?.status === 'running';
      if (isRunning) {
        processLogsContainerRef.current.scrollTop = processLogsContainerRef.current.scrollHeight;
      }
    }
  }, [logs, selectedProcess, telemetry])

  // ── Load builds + deps when entering tools view ────────────────
  useEffect(() => {
    refreshBuilds()
    refreshDiskInfo()
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    const res = await fetch(`${API}/settings`)
    const data = await res.json()
    setSettings(data)
    if (data.gui_password) {
      setIsAuthenticated(false) // Trigger login if pass exists
    }
  }

  const handleUpdateSettings = async (newSettings: any) => {
    const res = await fetch(`${API}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSettings)
    })
    const data = await res.json()
    setSettings(data)
  }

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const res = await fetch(`${API}/settings/logo`, {
        method: 'POST',
        body: formData
      });
      if (res.ok) {
        const data = await res.json();
        setSettings({ ...settings, logo_path: data.logo_path });
      } else {
        alert("Failed to upload logo");
      }
    } catch (err) {
      console.error(err);
    }
  }

  const handleLogin = async () => {
    const res = await fetch(`${API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: loginPass })
    })
    if (res.ok) {
      setIsAuthenticated(true)
      setIsLoginError(false)
    } else {
      setIsLoginError(true)
    }
  }

  useEffect(() => {
    if (activeView !== 'tools') return
    fetchDeps()
  }, [activeView])

  // Poll builds while any is building
  useEffect(() => {
    if (activeView !== 'tools') return
    const hasBuilding = builds.some(b => b.status === 'building')
    if (!hasBuilding) return
    const interval = setInterval(refreshBuilds, 3000)
    return () => clearInterval(interval)
  }, [activeView, builds])

  // ── Data fetchers ──────────────────────────────────────────────
  const refreshBuilds = async () => {
    try {
      const res = await fetch(`${API}/builds`)
      if (res.ok) setBuilds(await res.json())
    } catch { /* backend may be down */ }
  }

  const refreshDiskInfo = async () => {
    try {
      const res = await fetch(`${API}/builds/disk-info`)
      if (res.ok) setDiskInfo(await res.json())
    } catch { /* ignore */ }
  }

  const fetchDeps = async () => {
    setCheckStatus('loading')
    try {
      const res = await fetch(`${API}/builds/check`)
      if (!res.ok) throw new Error()
      setBuildDeps(await res.json())
      setCheckStatus('ready')
    } catch {
      setCheckStatus('error')
    }
  }

  // ── Build Profile actions ──────────────────────────────────────
  const handleCreateBuild = async (data: BuildFormData) => {
    const res = await fetch(`${API}/builds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (res.ok) {
      setShowBuildForm(false)
      refreshBuilds()
    } else {
      const err = await res.json()
      alert(err.detail || 'Failed to create build')
    }
  }

  const handleUpdateBuild = async (data: BuildFormData) => {
    if (!editingBuild) return
    const res = await fetch(`${API}/builds/${editingBuild.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (res.ok) {
      setEditingBuild(null)
      setShowBuildForm(false)
      refreshBuilds()
    } else {
      const err = await res.json()
      alert(err.detail || 'Failed to update build')
    }
  }

  const handleCompile = async (id: number) => {
    console.log("handleCompile trigger for ID:", id)
    const build = builds.find(b => Number(b.id) === Number(id))
    
    // Open terminal immediately
    setTerminalBuild({ id, name: build?.name || `Build #${id}` })
    
    try {
      const res = await fetch(`${API}/builds/${id}/compile`, { method: 'POST' })
      if (!res.ok) console.error("Server returned error:", res.status)
      refreshBuilds()
    } catch (err) {
      console.error("Fetch failed:", err)
    }
  }

  const handleStopBuild = async (id: number) => {
    await fetch(`${API}/builds/${Number(id)}/stop`, { method: 'POST' })
    refreshBuilds()
  }

  const handleCleanSources = async (id: number) => {
    console.log("handleCleanSources trigger for ID:", id)
    try {
      const res = await fetch(`${API}/builds/${Number(id)}/clean-sources`, { method: 'POST' })
      if (res.ok) {
        refreshBuilds()
        refreshDiskInfo()
      }
    } catch (err) {
      console.error("Clean sources failed:", err)
    }
  }

  const handleValidate = async (id: number) => {
    console.log("handleValidate trigger for ID:", id)
    try {
      const res = await fetch(`${API}/builds/${Number(id)}/validate`)
      const data = await res.json()
      setValidationResult({ buildId: Number(id), output: data.output || data.error || 'Unknown' })
    } catch (err) {
      console.error("Validation failed:", err)
    }
  }

  const handleSetDefault = async (id: number) => {
    console.log("handleSetDefault trigger for ID:", id)
    try {
      const res = await fetch(`${API}/builds/${Number(id)}/set-default`, { method: 'POST' })
      if (res.ok) {
        refreshBuilds()
      }
    } catch (err) {
      console.error("Set default failed:", err)
    }
  }

  const handleDeleteBuild = async (id: number) => {
    const build = builds.find(b => Number(b.id) === Number(id))
    if (!window.confirm(`Delete "${build?.name}" permanently? This removes all files from disk.`)) return
    try {
      const res = await fetch(`${API}/builds/${id}`, { method: 'DELETE' })
      if (res.ok) {
        refreshBuilds()
        refreshDiskInfo()
      }
    } catch (err) {
      console.error("Delete failed:", err)
    }
  }

  // ── Render ─────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-white p-4">
        <div className="glass-card w-full max-w-md p-10 border-brand-orange/30 animate-in zoom-in duration-500">
          <div className="w-20 h-20 bg-brand-orange rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-brand-orange/20">
            <span className="text-black font-black text-3xl">{settings.logo_text}</span>
          </div>
          <h1 className="text-2xl font-bold text-center mb-2 uppercase tracking-tighter">{settings.node_name}</h1>
          <p className="text-text-secondary text-center text-sm mb-10">Access restricted. Enter node password.</p>
          
          <div className="space-y-6">
            <input 
              type="password" 
              className={`w-full bg-white/5 border ${isLoginError ? 'border-red-500' : 'border-white/10'} rounded-2xl p-4 text-center text-2xl tracking-[0.5em] outline-none focus:border-brand-orange transition-all`}
              value={loginPass}
              onChange={e => setLoginPass(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              autoFocus
            />
            {isLoginError && <p className="text-red-500 text-center text-xs font-bold animate-shake">INVALID PASSWORD</p>}
            <button 
              onClick={handleLogin}
              className="w-full py-4 bg-brand-orange text-black font-black rounded-2xl hover:scale-[1.02] transition-all uppercase tracking-widest"
            >
              Unlock Node
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-black text-white">
      <Sidebar 
        activeView={activeView} 
        onViewChange={setActiveView} 
        logoText={settings.logo_text}
        logoPath={settings.logo_path ? `${API}${settings.logo_path}` : undefined}
        accentColor={settings.accent_color}
      />

      <main className="flex-1 overflow-y-auto p-8 lg:p-12">
        {/* ════ DASHBOARD ════ */}
        {activeView === 'dashboard' ? (
          <>
            <header className="flex justify-between items-center mb-12">
              <div>
                <h1 className="text-4xl font-bold mb-2">DASHBOARD</h1>
                <p className="text-text-secondary">Monitoring and controlling FFMPEG nodes</p>
              </div>
              <div className="flex gap-4">
                <div className="pill-button bg-white/5 border border-white/10 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-brand-lime"></span>
                  Node: Standalone
                </div>
              </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              <div className="glass-card p-8 col-span-1 lg:col-span-2">
                <h3 className="text-xl font-black mb-6">ACTIVE SERVICES (RUNNING)</h3>
                <div className="space-y-6 mb-12">
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

              <div className="glass-card p-8">
                <h3 className="text-xl font-semibold mb-6">System Load</h3>
                <div className="space-y-8">
                  <div>
                    <div className="flex justify-between mb-2">
                      <span className="text-text-secondary">Total CPU</span>
                      <span className="text-brand-lime">12%</span>
                    </div>
                    <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-brand-lime w-[12%] transition-all"></div>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between mb-2">
                      <span className="text-text-secondary">Memory Usage</span>
                      <span className="text-brand-orange">2.4GB / 16GB</span>
                    </div>
                    <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-brand-orange w-[15%] transition-all"></div>
                    </div>
                  </div>
                </div>
                <button onClick={() => setShowAddModal(true)}
                  className="pill-button bg-brand-lime text-black w-full mt-12 py-4">+ NEW SERVICE</button>
              </div>
            </div>

            {/* Add Service Modal */}
            {showAddModal && (
              <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
                <div className="glass-card w-full max-w-3xl p-8 relative max-h-[90vh] flex flex-col overflow-hidden">
                  <button onClick={() => setShowAddModal(false)}
                    className="absolute top-6 right-6 w-8 h-8 bg-white/10 rounded-full flex items-center justify-center text-text-secondary hover:text-white hover:bg-white/20 transition-all z-10">✕</button>
                  <h3 className="text-2xl font-bold mb-4 flex-shrink-0">ADD NEW SERVICE</h3>
                  <ProcessConfigForm
                    onCancel={() => setShowAddModal(false)}
                    onSubmit={async (config) => {
                      await fetch(`${API}/processes`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          name: config.name, type: 'service',
                          input_config: config.input_config, output_config: config.output_config,
                          codec_config: config.codec_config, filter_config: config.filter_config,
                          ffmpeg_build_id: config.ffmpeg_build_id,
                          auto_start: config.auto_start,
                          watchdog_enabled: config.watchdog_enabled,
                          watchdog_retries: config.watchdog_retries,
                        })
                      })
                      setShowAddModal(false)
                    }}
                  />
                </div>
              </div>
            )}

            {/* Edit Service Modal */}
            {editingProcess && (
              <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
                <div className="glass-card w-full max-w-3xl p-8 relative max-h-[90vh] flex flex-col overflow-hidden">
                  <button onClick={() => setEditingProcess(null)}
                    className="absolute top-6 right-6 w-8 h-8 bg-white/10 rounded-full flex items-center justify-center text-text-secondary hover:text-white hover:bg-white/20 transition-all z-10">✕</button>
                  <h3 className="text-2xl font-bold mb-4 flex-shrink-0">EDIT SERVICE: {editingProcess.name.toUpperCase()}</h3>
                  <ProcessConfigForm
                    initialConfig={editingProcess}
                    onCancel={() => setEditingProcess(null)}
                    onSubmit={async (config) => {
                      await fetch(`${API}/processes/${editingProcess.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          name: config.name,
                          input_config: config.input_config, output_config: config.output_config,
                          codec_config: config.codec_config, filter_config: config.filter_config,
                          ffmpeg_build_id: config.ffmpeg_build_id,
                          auto_start: config.auto_start,
                          watchdog_enabled: config.watchdog_enabled,
                          watchdog_retries: config.watchdog_retries,
                        })
                      })
                      setEditingProcess(null)
                    }}
                    onSaveAs={async (config) => {
                      await fetch(`${API}/processes`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(config)
                      })
                      setEditingProcess(null)
                    }}
                  />
                </div>
              </div>
            )}

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
                      {currentProcess.pending_changes && (
                        <div className="bg-brand-orange/10 border border-brand-orange/30 text-brand-orange p-4 rounded-2xl flex items-center gap-3 animate-pulse">
                          <span className="text-xl">⚠️</span>
                          <div className="text-xs">
                            <span className="font-bold block uppercase tracking-wider mb-0.5">Configuration Pending Reboot</span>
                            This service has modified configurations that are not yet active in the running instance. Restart the service to apply these changes.
                          </div>
                        </div>
                      )}
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
                        <div 
                          ref={processLogsContainerRef}
                          className={`h-44 space-y-1 custom-scrollbar pr-2 select-text ${
                            currentProcess?.status === 'running' ? 'overflow-y-hidden' : 'overflow-y-auto'
                          }`}
                        >
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
                        <button 
                          onClick={() => {
                            setEditingProcess(currentProcess);
                            setSelectedProcess(null);
                          }}
                          className="pill-button bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 text-xs font-bold py-2 px-6 border border-blue-500/25"
                        >
                          EDIT CONFIG
                        </button>
                        <button 
                          onClick={() => {
                            handleCloneProcess(currentProcess);
                            setSelectedProcess(null);
                          }}
                          className="pill-button bg-white/10 hover:bg-white/15 text-xs py-2 px-6"
                        >
                          CLONE SERVICE
                        </button>
                        {currentProcess.status === 'running' ? (
                          <>
                            <button 
                              onClick={() => handleRestartService(currentProcess.id, currentProcess.name)}
                              className={`pill-button hover:scale-[1.02] text-black text-xs font-black py-2 px-6 transition-all ${
                                currentProcess.pending_changes
                                  ? 'bg-brand-orange shadow-xl shadow-brand-orange/20'
                                  : 'bg-brand-lime shadow-xl shadow-brand-lime/20'
                              }`}
                            >
                              RESTART SERVICE
                            </button>
                            <button 
                              onClick={() => fetch(`${API}/processes/${currentProcess.id}/stop`, { method: 'POST' })}
                              className="pill-button bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs font-bold py-2 px-6"
                            >
                              STOP SERVICE
                            </button>
                          </>
                        ) : (
                          <button 
                            onClick={() => handleStartService(currentProcess.id)}
                            className="pill-button bg-brand-lime hover:scale-[1.02] text-black text-xs font-black py-2 px-6"
                          >
                            START SERVICE
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
          </>

        /* ════ BATCH JOBS ════ */
        ) : activeView === 'batch' ? (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <header className="flex justify-between items-center mb-12">
              <div>
                <h1 className="text-4xl font-bold mb-2">BATCH JOBS</h1>
                <p className="text-text-secondary">One-time processing and transcoding tasks</p>
              </div>
            </header>
            <div className="glass-card p-8">
              <div className="flex justify-between items-center mb-8">
                <h3 className="text-xl font-semibold">Active & Recent Jobs</h3>
                <button onClick={() => setShowAddBatchModal(true)}
                  className="pill-button bg-brand-lime text-black text-xs">+ NEW JOB</button>
              </div>
              <div className="space-y-4">
                {telemetry.filter(p => p.type === 'batch').length === 0 ? (
                  <div className="text-white/20 italic py-12 text-center border border-dashed border-white/5 rounded-2xl">No batch jobs found</div>
                ) : (
                  telemetry.filter(p => p.type === 'batch').map(proc => (
                    <div key={proc.id} className="flex items-center justify-between p-6 bg-white/5 rounded-2xl border border-white/5 hover:bg-white/10 transition-colors">
                      <div>
                        <div className="font-bold text-lg">{proc.name}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`w-2 h-2 rounded-full ${proc.status === 'finished' ? 'bg-green-500' : proc.status === 'running' ? 'bg-brand-lime animate-pulse' : 'bg-red-500'}`}></span>
                          <span className="text-xs text-text-secondary uppercase tracking-widest">{proc.status}</span>
                        </div>
                      </div>
                      <div className="flex gap-4">
                        <button onClick={() => setSelectedProcess(proc)} className="pill-button bg-white/10 text-xs">VIEW LOGS</button>
                        {proc.status !== 'running' && (
                          <button onClick={() => handleStartService(proc.id)}
                            className="pill-button bg-brand-lime text-black text-xs">RESTART</button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            {showAddBatchModal && (
              <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-8 z-50">
                <div className="glass-card w-full max-w-2xl p-12 relative border-brand-orange/20 overflow-y-auto max-h-[90vh]">
                  <button onClick={() => setShowAddBatchModal(false)}
                    className="absolute top-8 right-8 text-text-secondary hover:text-white">✕</button>
                  <h3 className="text-3xl font-bold mb-8 text-brand-orange">NEW BATCH JOB</h3>
                  <BatchJobForm
                    onCancel={() => setShowAddBatchModal(false)}
                    onSubmit={async (config) => {
                      await fetch(`${API}/processes`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          name: config.name, type: 'batch',
                          input_config: config.input, output_config: config.output,
                          codec_config: config.codec,
                          ffmpeg_build_id: config.ffmpeg_build_id,
                          filter_config: config.threads ? { advanced: { threads: config.threads } } : undefined,
                        })
                      })
                      setShowAddBatchModal(false)
                    }}
                  />
                </div>
              </div>
            )}
          </div>

        /* ════ SETTINGS ════ */
        ) : activeView === 'settings' ? (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl">
            <header className="mb-12">
              <h1 className="text-4xl font-bold mb-2">SETTINGS</h1>
              <p className="text-text-secondary">Node identity, security and branding</p>
            </header>

            <div className="space-y-8">
              {/* Identity Section */}
              <div className="glass-card p-8 border-brand-lime/10">
                <h3 className="text-xl font-bold mb-8 flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg bg-brand-lime/10 flex items-center justify-center text-brand-lime text-sm">ID</span>
                  NODE IDENTITY
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase font-black text-text-secondary tracking-widest">Station Name</label>
                      <input 
                        type="text" 
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-lime outline-none transition-all"
                        value={settings.node_name}
                        onChange={e => handleUpdateSettings({...settings, node_name: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase font-black text-text-secondary tracking-widest">Logo Abbreviation</label>
                      <input 
                        type="text" 
                        maxLength={3}
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-lime outline-none transition-all uppercase"
                        value={settings.logo_text}
                        onChange={e => handleUpdateSettings({...settings, logo_text: e.target.value.toUpperCase()})}
                      />
                    </div>
                  </div>

                  <div className="space-y-2 flex flex-col items-center justify-center border-2 border-dashed border-white/10 rounded-2xl p-4 hover:border-brand-lime transition-all relative group cursor-pointer">
                    <label className="absolute inset-0 cursor-pointer flex flex-col items-center justify-center w-full h-full z-10">
                      <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                    </label>
                    {settings.logo_path ? (
                      <div className="relative w-24 h-24 flex items-center justify-center">
                        <img src={`${API}${settings.logo_path}`} alt="Custom Logo" className="max-w-full max-h-full object-contain" />
                      </div>
                    ) : (
                      <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mb-2 shadow-lg group-hover:scale-110 transition-transform">
                        <span className="text-white font-black text-2xl uppercase">{settings.logo_text}</span>
                      </div>
                    )}
                    <div className="text-[10px] uppercase font-bold text-text-secondary mt-2 text-center">
                      {settings.logo_path ? 'Click to change logo' : 'Upload custom logo'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Security Section */}
              <div className="glass-card p-8 border-red-500/10">
                <h3 className="text-xl font-bold mb-8 flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center text-red-500 text-sm">🔒</span>
                  SECURITY & ACCESS
                </h3>
                <div className="max-w-md space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase font-black text-text-secondary tracking-widest">New Password</label>
                    <input 
                      type="password" 
                      placeholder="Leave empty to remove password"
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-red-500 outline-none transition-all"
                      value={newPassword}
                      onChange={e => { setNewPassword(e.target.value); setPasswordError(''); setPasswordSuccess('') }}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase font-black text-text-secondary tracking-widest">Confirm Password</label>
                    <input 
                      type="password" 
                      placeholder="Confirm new password"
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-red-500 outline-none transition-all"
                      value={confirmPassword}
                      onChange={e => { setConfirmPassword(e.target.value); setPasswordError(''); setPasswordSuccess('') }}
                    />
                  </div>
                  
                  {passwordError && <p className="text-[10px] text-red-500 font-bold">{passwordError}</p>}
                  {passwordSuccess && <p className="text-[10px] text-brand-lime font-bold">{passwordSuccess}</p>}

                  <button 
                    onClick={() => {
                      if (newPassword !== confirmPassword) {
                        setPasswordError('Passwords do not match');
                        return;
                      }
                      handleUpdateSettings({...settings, gui_password: newPassword});
                      setPasswordSuccess('Password updated successfully');
                      setNewPassword('');
                      setConfirmPassword('');
                    }}
                    className="pill-button bg-red-500/20 text-red-400 text-xs py-2 w-full mt-2 hover:bg-red-500/30">
                    UPDATE PASSWORD
                  </button>

                  <p className="text-[10px] text-text-secondary italic mt-4">
                    Protect your FFmpeg node from unauthorized command execution.
                  </p>
                </div>
              </div>

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
            </div>
          </div>

        /* ════ FFMPEG FORGE (Tools) ════ */
        ) : activeView === 'tools' ? (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <header className="flex justify-between items-center mb-10">
              <div>
                <h1 className="text-4xl font-bold mb-2 tracking-tighter">
                  FFMPEG <span className="text-brand-orange">FORGE</span>
                </h1>
                <p className="text-text-secondary italic">Build Profiles Manager</p>
              </div>
              <div className="flex items-center gap-4">
                {diskInfo && (
                  <div className="pill-button bg-white/5 border border-white/10 flex items-center gap-2 text-xs">
                    <span className="text-text-secondary">Disk:</span>
                    <span className={`font-mono font-bold ${diskInfo.free_gb < 10 ? 'text-red-400' : diskInfo.free_gb < 50 ? 'text-brand-orange' : 'text-brand-lime'}`}>
                      {diskInfo.free_gb} GB free
                    </span>
                  </div>
                )}
                <button onClick={() => { setEditingBuild(null); setShowBuildForm(true) }}
                  className="pill-button bg-brand-orange text-black font-bold hover:scale-105 transition-transform">
                  + NEW BUILD PROFILE
                </button>
              </div>
            </header>

            {/* Environment Check (compact) */}
            <div className="glass-card p-4 mb-8 bg-white/2">
              <div className="flex items-center gap-6 flex-wrap">
                <span className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">ENV CHECK</span>
                {checkStatus === 'loading' ? (
                  <span className="text-xs text-brand-orange animate-pulse">Checking...</span>
                ) : checkStatus === 'error' ? (
                  <span className="text-xs text-red-400 font-bold">Failed to reach backend</span>
                ) : (
                  Object.entries(buildDeps).map(([dep, ok]) => (
                    <div key={dep} className="flex items-center gap-1.5 text-xs">
                      <span className={ok === true ? 'text-brand-lime' : 'text-red-500 font-bold'}>
                        {ok === true ? '✓' : '✗'}
                      </span>
                      <span className="text-text-secondary">{dep}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Build Profiles List */}
            <div className="space-y-4">
              {builds.length === 0 ? (
                <div className="text-center py-20 border-2 border-dashed border-white/5 rounded-3xl">
                  <div className="text-white/10 text-6xl mb-6">🔨</div>
                  <div className="text-text-secondary text-lg mb-2">No build profiles yet</div>
                  <div className="text-text-secondary text-sm">Create your first FFmpeg build profile to get started</div>
                </div>
              ) : (
                builds.map(build => (
                  <BuildProfileCard
                    key={build.id}
                    build={build}
                    onCompile={handleCompile}
                    onStop={handleStopBuild}
                    onValidate={handleValidate}
                    onCleanSources={handleCleanSources}
                    onDelete={handleDeleteBuild}
                    onSetDefault={handleSetDefault}
                    onEdit={(b) => { setEditingBuild(b); setShowBuildForm(true) }}
                    onViewLogs={(id) => {
                      const b = builds.find(x => x.id === id)
                      if (b) setTerminalBuild({ id, name: b.name })
                    }}
                  />
                ))
              )}
            </div>

            {/* Build Form Modal */}
            {showBuildForm && (
              <BuildFormModal
                editBuild={editingBuild}
                onClose={() => { setShowBuildForm(false); setEditingBuild(null) }}
                onSubmit={editingBuild ? handleUpdateBuild : handleCreateBuild}
                buildDeps={buildDeps}
              />
            )}

            {/* Build Terminal Overlay */}
            {terminalBuild && (
              <BuildTerminal
                buildId={terminalBuild.id}
                buildName={terminalBuild.name}
                onClose={() => { setTerminalBuild(null); refreshBuilds(); refreshDiskInfo() }}
              />
            )}

            {/* Validation Result Modal */}
            {validationResult && (
              <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-8 z-50">
                <div className="glass-card w-full max-w-2xl p-8 relative">
                  <button onClick={() => setValidationResult(null)}
                    className="absolute top-6 right-6 text-text-secondary hover:text-white">✕</button>
                  <h3 className="text-xl font-bold mb-4 text-brand-lime">BUILD VALIDATION</h3>
                  <pre className="bg-black/60 p-6 rounded-2xl font-mono text-xs text-white/80 overflow-auto max-h-96 whitespace-pre-wrap">
                    {validationResult.output}
                  </pre>
                </div>
              </div>
            )}
          </div>

        ) : (
          <div className="flex items-center justify-center h-full text-text-secondary text-2xl uppercase tracking-widest font-bold opacity-20">
            {activeView} View - Coming Soon
          </div>
        )}
      </main>
    </div>
  )
}

export default App
