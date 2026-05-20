import React, { useState, useEffect } from 'react'
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
  const [showAddModal, setShowAddModal] = useState(false)
  const [showAddBatchModal, setShowAddBatchModal] = useState(false)

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

  // Lock body scroll when modals are active
  useEffect(() => {
    const isModalOpen = showAddModal || showAddBatchModal || showBuildForm || terminalBuild !== null || validationResult !== null;
    if (isModalOpen) {
      document.body.classList.add('overflow-hidden');
    } else {
      document.body.classList.remove('overflow-hidden');
    }
    return () => {
      document.body.classList.remove('overflow-hidden');
    };
  }, [showAddModal, showAddBatchModal, showBuildForm, terminalBuild, validationResult]);

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
                <h3 className="text-xl font-semibold mb-6">Active Services</h3>
                <div className="space-y-6">
                  {telemetry.filter(p => p.type === 'service' || !p.type).length === 0 ? (
                    <div className="text-text-secondary py-12 text-center border-2 border-dashed border-white/5 rounded-3xl">
                      No processes currently running
                    </div>
                  ) : (
                    telemetry.filter(p => p.type === 'service' || !p.type).map(proc => (
                      <div key={proc.id} onClick={() => setSelectedProcess(proc)}
                        className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5 cursor-pointer hover:bg-white/10 transition-colors">
                        <div>
                          <div className="font-bold">{proc.name}</div>
                          <div className="text-xs text-text-secondary">PID: {proc.pid || 'N/A'}</div>
                        </div>
                        <div className="flex gap-8">
                          <div className="text-center">
                            <div className="text-brand-lime font-mono">{proc.cpu}%</div>
                            <div className="text-[10px] uppercase text-text-secondary">CPU</div>
                          </div>
                          <div className="text-center">
                            <div className="text-brand-orange font-mono">{proc.ram}MB</div>
                            <div className="text-[10px] uppercase text-text-secondary">RAM</div>
                          </div>
                        </div>
                        <div className={`pill-button text-xs ${proc.status === 'running' ? 'bg-brand-lime/20 text-brand-lime' : 'bg-red-500/20 text-red-400'}`}>
                          {proc.status.toUpperCase()}
                        </div>
                      </div>
                    ))
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
                          input_config: config.input, output_config: config.output,
                          codec_config: config.codec, filter_config: config.filters,
                          ffmpeg_build_id: config.ffmpeg_build_id,
                        })
                      })
                      setShowAddModal(false)
                    }}
                  />
                </div>
              </div>
            )}

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
                          <button onClick={() => fetch(`${API}/processes/${proc.id}/start`, { method: 'POST' })}
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
