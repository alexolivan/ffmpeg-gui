import React, { useState, useEffect, useRef } from 'react'
import Sidebar from './components/Sidebar'
import ProcessConfigForm from './components/ProcessConfigForm'
import BatchJobForm from './components/BatchJobForm'

function App() {
  const [activeView, setActiveView] = useState('dashboard')
  const [telemetry, setTelemetry] = useState<any[]>([])
  const [selectedProcess, setSelectedProcess] = useState<any | null>(null)
  const [logs, setLogs] = useState<any[]>([])
  const [showAddModal, setShowAddModal] = useState(false)
  const [showAddBatchModal, setShowAddBatchModal] = useState(false)
  const [buildLogs, setBuildLogs] = useState<string[]>([])
  const [isBuilding, setIsBuilding] = useState(false)
  const [buildOptions, setBuildOptions] = useState({ libsrt: true, vaapi: true, ndi: false })
  const [sdkPaths, setSdkPaths] = useState({ decklink: '', nvenc: '' })
  const [buildDeps, setBuildDeps] = useState<any>({})
  const [checkStatus, setCheckStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [newProcess, setNewProcess] = useState({
    name: '',
    input: { type: 'file', path: '', host: '', port: '', mode: 'listener', device: '' },
    codec: { vcodec: 'libx264', acodec: 'aac', bitrate: '4000k', hwaccel: 'none' },
    output: { type: 'udp', host: '127.0.0.1', port: '1234', path: '', url: '', mode: 'caller', latency: 200 },
    filters: { scale: '', deinterlace: false }
  })

  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8000/ws/telemetry')
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === 'telemetry') {
        setTelemetry(msg.data)
      }
    }
    return () => ws.close()
  }, [])

  useEffect(() => {
    if (selectedProcess) {
      const fetchLogs = async () => {
        const res = await fetch(`http://localhost:8000/processes/${selectedProcess.id}/logs`)
        const data = await res.json()
        setLogs(data)
      }
      fetchLogs()
      const interval = setInterval(fetchLogs, 2000)
      return () => clearInterval(interval)
    }
  }, [selectedProcess])

  useEffect(() => {
    if (activeView === 'tools') {
      const fetchDeps = async () => {
        setCheckStatus('loading')
        try {
          const res = await fetch('http://localhost:8000/build/check')
          if (!res.ok) throw new Error('Backend error')
          const data = await res.json()
          setBuildDeps(data)
          setCheckStatus('ready')
        } catch (err) {
          console.error("Failed to check deps:", err)
          setCheckStatus('error')
        }
      }
      fetchDeps()

      const ws = new WebSocket('ws://localhost:8000/ws/build')
      ws.onmessage = (event) => {
        setBuildLogs(prev => [...prev, event.data].slice(-500))
      }
      return () => ws.close()
    }
  }, [activeView])

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [buildLogs])

  return (
    <div className="flex h-screen overflow-hidden bg-black text-white">
      <Sidebar activeView={activeView} onViewChange={setActiveView} />
      
      <main className="flex-1 overflow-y-auto p-8 lg:p-12">
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
          {/* Health Card */}
          <div className="glass-card p-8 col-span-1 lg:col-span-2">
            <h3 className="text-xl font-semibold mb-6">Active Services</h3>
            <div className="space-y-6">
              {telemetry.filter(p => p.type === 'service' || !p.type).length === 0 ? (
                <div className="text-text-secondary py-12 text-center border-2 border-dashed border-white/5 rounded-3xl">
                  No processes currently running
                </div>
              ) : (
                telemetry.filter(p => p.type === 'service' || !p.type).map(proc => (
                  <div 
                    key={proc.id} 
                    onClick={() => setSelectedProcess(proc)}
                    className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5 cursor-pointer hover:bg-white/10 transition-colors"
                  >
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

          {/* Quick Actions / Stats */}
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
            
            <button 
              onClick={() => setShowAddModal(true)}
              className="pill-button bg-brand-lime text-black w-full mt-12 py-4"
            >
              + NEW SERVICE
            </button>
          </div>
        </div>

        {/* Add Service Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-8 z-50">
            <div className="glass-card w-full max-w-2xl p-12 relative">
              <button 
                onClick={() => setShowAddModal(false)}
                className="absolute top-8 right-8 text-text-secondary hover:text-white"
              >✕</button>
              
              <h3 className="text-3xl font-bold mb-8">ADD NEW SERVICE</h3>
              
              <ProcessConfigForm 
                onCancel={() => setShowAddModal(false)}
                onSubmit={async (config) => {
                  await fetch('http://localhost:8000/processes', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                      name: config.name,
                      type: 'service',
                      input_config: config.input,
                      output_config: config.output,
                      codec_config: config.codec,
                      filter_config: config.filters
                    })
                  });
                  setShowAddModal(false);
                }}
              />
            </div>
          </div>
        )}

        {/* Preview Modal */}
        {selectedProcess && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-8 z-50">
            <div className="glass-card w-full max-w-4xl p-0 overflow-hidden relative">
              <button 
                onClick={() => setSelectedProcess(null)}
                className="absolute top-6 right-6 w-10 h-10 bg-white/10 rounded-full flex items-center justify-center hover:bg-white/20 transition-colors"
              >
                ✕
              </button>
              
              <div className="p-8 border-b border-white/5">
                <h3 className="text-2xl font-bold">{selectedProcess.name}</h3>
                <p className="text-text-secondary">Live Stream Preview (MJPEG)</p>
              </div>

              <div className="aspect-video bg-black flex items-center justify-center">
                <img 
                  src={`http://localhost:8000/processes/${selectedProcess.id}/preview`} 
                  alt="Live Preview" 
                  className="max-h-full object-contain"
                />
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
                  <button 
                    onClick={() => {
                      fetch(`http://localhost:8000/processes/${selectedProcess.id}/export`)
                        .then(res => res.json())
                        .then(data => {
                          const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'})
                          const url = URL.createObjectURL(blob)
                          const a = document.createElement('a')
                          a.href = url
                          a.download = `${selectedProcess.name}_profile.json`
                          a.click()
                        })
                    }}
                    className="pill-button bg-white/10"
                  >EXPORT PROFILE</button>
                  <button 
                    onClick={async () => {
                      await fetch(`http://localhost:8000/processes/${selectedProcess.id}/start`, {method: 'POST'})
                    }}
                    className="pill-button bg-brand-lime text-black"
                  >START</button>
                  <button 
                    onClick={async () => {
                      await fetch(`http://localhost:8000/processes/${selectedProcess.id}/stop`, {method: 'POST'})
                    }}
                    className="pill-button bg-red-500/20 text-red-400"
                  >STOP</button>
                </div>
              </div>

              {/* Log Viewer Section */}
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
                <button 
                  onClick={() => setShowAddBatchModal(true)}
                  className="pill-button bg-brand-lime text-black text-xs"
                >+ NEW JOB</button>
              </div>
              
              <div className="space-y-4">
                {telemetry.filter(p => p.type === 'batch').length === 0 ? (
                  <div className="text-white/20 italic py-12 text-center border border-dashed border-white/5 rounded-2xl">
                    No batch jobs found
                  </div>
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
                        <button 
                          onClick={() => setSelectedProcess(proc)}
                          className="pill-button bg-white/10 text-xs"
                        >VIEW LOGS</button>
                        {proc.status !== 'running' && (
                          <button 
                            onClick={async () => {
                              await fetch(`http://localhost:8000/processes/${proc.id}/start`, {method: 'POST'})
                            }}
                            className="pill-button bg-brand-lime text-black text-xs"
                          >RESTART</button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Add Batch Modal */}
            {showAddBatchModal && (
              <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-8 z-50">
                <div className="glass-card w-full max-w-2xl p-12 relative border-brand-orange/20">
                  <button 
                    onClick={() => setShowAddBatchModal(false)}
                    className="absolute top-8 right-8 text-text-secondary hover:text-white"
                  >✕</button>
                  
                  <h3 className="text-3xl font-bold mb-8 text-brand-orange">NEW BATCH JOB</h3>
                  
                  <BatchJobForm 
                    onCancel={() => setShowAddBatchModal(false)}
                    onSubmit={async (config) => {
                      await fetch('http://localhost:8000/processes', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                          name: config.name,
                          type: 'batch',
                          input_config: config.input,
                          output_config: config.output,
                          codec_config: config.codec
                        })
                      });
                      setShowAddBatchModal(false);
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        ) : activeView === 'settings' ? (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
             <header className="mb-12">
                <h1 className="text-4xl font-bold mb-2">SETTINGS</h1>
                <p className="text-text-secondary">System configuration and node parameters</p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="glass-card p-8">
                <h3 className="text-xl font-bold mb-6 text-brand-lime">NODE INFO</h3>
                <div className="space-y-4 text-sm">
                  <div className="flex justify-between border-b border-white/5 pb-2">
                    <span className="text-text-secondary">Node ID</span>
                    <span className="font-mono">STANDALONE-01</span>
                  </div>
                  <div className="flex justify-between border-b border-white/5 pb-2">
                    <span className="text-text-secondary">OS</span>
                    <span>Linux (Agnostic)</span>
                  </div>
                  <div className="flex justify-between border-b border-white/5 pb-2">
                    <span className="text-text-secondary">FFMPEG Path</span>
                    <span className="font-mono text-[10px]">/home/alex/LocalRepositories/FFMPEG-GUI/ffmpeg_bin/bin/ffmpeg</span>
                  </div>
                </div>
              </div>

              <div className="glass-card p-8 opacity-50">
                <h3 className="text-xl font-bold mb-6 text-text-secondary uppercase">Network P2P</h3>
                <p className="text-sm italic">Multi-node synchronization is currently disabled in standalone mode.</p>
              </div>
            </div>
          </div>
        ) : activeView === 'tools' ? (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <header className="mb-12">
              <h1 className="text-4xl font-bold mb-2 tracking-tighter">FFMPEG <span className="text-brand-orange">FORGE</span></h1>
              <p className="text-text-secondary italic">Custom Binary Build Assistant</p>
            </header>

            <div className="flex flex-col lg:flex-row gap-8 h-[calc(100vh-280px)] overflow-hidden">
              {/* Build Options - Left Column */}
              <div className="w-full lg:w-96 flex flex-col gap-6 overflow-y-auto pr-2">
                <div className="glass-card p-6 border-white/5 bg-white/5">
                  <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                    <span className="w-2 h-2 bg-brand-orange rounded-full"></span>
                    BUILD OPTIONS
                  </h3>
                  
                  <div className="space-y-4">
                    {[
                      { id: 'libsrt', label: 'Support SRT', icon: '🌐' },
                      { id: 'vaapi', label: 'VAAPI HW', icon: '⚡' },
                      { id: 'ndi', label: 'NDI (Exp)', icon: '📡' },
                    ].map(opt => (
                      <div key={opt.id} className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-medium">{opt.label}</span>
                        </div>
                        <input 
                          type="checkbox" 
                          className="w-5 h-5 accent-brand-orange" 
                          checked={(buildOptions as any)[opt.id]}
                          onChange={e => setBuildOptions({...buildOptions, [opt.id]: e.target.checked})}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Advanced SDK Paths */}
                <div className="glass-card p-6 border-white/5 bg-white/2">
                  <h3 className="text-[10px] font-bold mb-4 text-text-secondary uppercase tracking-widest">Advanced SDK Config</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="text-[9px] text-text-secondary uppercase mb-1 block">Decklink SDK Path</label>
                      <input 
                        type="text" 
                        placeholder="/path/to/BlackmagicSDK/Linux/include"
                        className="w-full bg-black/40 border border-white/5 rounded-lg p-2 text-xs font-mono focus:border-brand-orange/50 outline-none"
                        value={sdkPaths.decklink}
                        onChange={e => setSdkPaths({...sdkPaths, decklink: e.target.value})}
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-text-secondary uppercase mb-1 block">NVENC Header Path</label>
                      <input 
                        type="text" 
                        placeholder="/usr/local/include/nvencode"
                        className="w-full bg-black/40 border border-white/5 rounded-lg p-2 text-xs font-mono focus:border-brand-orange/50 outline-none"
                        value={sdkPaths.nvenc}
                        onChange={e => setSdkPaths({...sdkPaths, nvenc: e.target.value})}
                      />
                    </div>
                  </div>
                </div>

                {/* Library Hint */}
                <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-2xl">
                  <h5 className="text-[10px] font-bold text-blue-400 uppercase mb-2">Required Libraries</h5>
                  <p className="text-[10px] text-text-secondary leading-relaxed">
                    Ensure you have these system libraries:
                    <code className="block mt-1 p-2 bg-black/40 rounded text-blue-300 overflow-x-auto whitespace-pre-wrap">
                      sudo apt install libssl-dev libx264-dev libx265-dev {buildOptions.vaapi ? 'libva-dev ' : ''} {buildOptions.libsrt ? 'libsrt-openssl-dev ' : ''}
                    </code>
                  </p>
                </div>

                <div className="glass-card p-6 border-white/5">
                  <h4 className="text-[10px] font-bold text-text-secondary uppercase mb-4 tracking-widest">Environment Check</h4>
                  <div className="space-y-2">
                    {checkStatus === 'loading' ? (
                      <div className="text-xs text-brand-orange animate-pulse">Checking dependencies...</div>
                    ) : checkStatus === 'error' ? (
                      <div className="text-xs text-red-400 font-bold">Failed to reach check service</div>
                    ) : (
                      Object.entries(buildDeps).map(([dep, installed]) => (
                        <div key={dep} className="flex items-center justify-between text-xs">
                          <span className="text-text-secondary capitalize">{dep}</span>
                          <span className={installed === true ? "text-brand-lime" : "text-red-500 font-bold"}>
                            {installed === true ? '✓' : 'MISSING'}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                  
                <div className="flex gap-4 mt-6">
                  {!isBuilding ? (
                    <>
                      <button 
                        onClick={async () => {
                          const hasMissing = Object.values(buildDeps).some(v => v === false)
                          if (hasMissing) {
                            alert("Please install missing dependencies first.")
                            return
                          }
                          setIsBuilding(true)
                          setBuildLogs(["[Forge] Initiating build request...\n"])
                          await fetch('http://localhost:8000/build', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({ ...buildOptions, sdkPaths })
                          })
                        }}
                        disabled={checkStatus !== 'ready'}
                        className={`flex-1 py-4 font-black rounded-2xl transition-all ${checkStatus !== 'ready' ? 'bg-white/10 text-white/20' : 'bg-brand-orange text-black shadow-lg shadow-brand-orange/20 hover:scale-105'}`}
                      >
                        {checkStatus === 'loading' ? 'CHECKING...' : 'START FORGE'}
                      </button>
                      <button 
                        onClick={async () => {
                          if (confirm("This will delete the build folder and all source code. Continue?")) {
                            await fetch('http://localhost:8000/build/clean', {method: 'POST'})
                            setBuildLogs(["[Forge] Workspace cleaned.\n"])
                          }
                        }}
                        className="p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-red-500/10 hover:border-red-500/20 transition-all text-xl"
                        title="Clean Workspace"
                      >
                        🗑️
                      </button>
                    </>
                  ) : (
                    <button 
                      onClick={async () => {
                        await fetch('http://localhost:8000/build/stop', {method: 'POST'})
                        setIsBuilding(false)
                        setBuildLogs(prev => [...prev, "\n[Forge] Build aborted by user.\n"])
                      }}
                      className="w-full py-4 bg-red-500 text-white font-black rounded-2xl animate-pulse shadow-lg shadow-red-500/20"
                    >
                      ABORT BUILD
                    </button>
                  )}
                </div>
                </div>
              </div>

              {/* Terminal Output - Right Column */}
              <div className="flex-1 glass-card bg-black/40 p-0 flex flex-col overflow-hidden border-brand-orange/10 min-h-[400px]">
                <div className="bg-white/5 p-4 flex items-center justify-between border-b border-white/5">
                  <div className="flex gap-2">
                    <div className="w-2 h-2 rounded-full bg-red-500/50"></div>
                    <div className="w-2 h-2 rounded-full bg-yellow-500/50"></div>
                    <div className="w-2 h-2 rounded-full bg-green-500/50"></div>
                  </div>
                  <span className="text-[10px] font-mono text-text-secondary uppercase tracking-widest">Compiler Stdout</span>
                </div>
                <div className="flex-1 p-6 font-mono text-[11px] overflow-y-auto bg-black/60 custom-scrollbar">
                  {buildLogs.length === 0 ? (
                    <div className="text-white/10 italic text-center mt-20 text-lg">Waiting for build start...</div>
                  ) : (
                    buildLogs.map((line, i) => (
                      <div key={i} className="whitespace-pre-wrap mb-0.5 border-l border-brand-orange/10 pl-3">
                        {line}
                      </div>
                    ))
                  )}
                  <div ref={logEndRef} />
                </div>
              </div>
            </div>
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
