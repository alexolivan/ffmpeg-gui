import React, { useEffect, useRef } from 'react';

interface ProcessPreviewModalProps {
  selectedProcess: any;
  telemetry: any[];
  actionPending: Record<number, 'starting' | 'stopping' | 'restarting'>;
  logs: any[];
  onClose: () => void;
  onEditProcess: (proc: any) => void;
  onCloneProcess: (proc: any) => void;
  onStartService: (id: number) => void;
  onStopService: (id: number) => void;
  onRestartService: (id: number, name: string) => void;
  API: string;
}

export const ProcessPreviewModal: React.FC<ProcessPreviewModalProps> = ({
  selectedProcess,
  telemetry,
  actionPending,
  logs,
  onClose,
  onEditProcess,
  onCloneProcess,
  onStartService,
  onStopService,
  onRestartService,
  API,
}) => {
  const processLogsContainerRef = useRef<HTMLDivElement | null>(null);

  const currentProcess = telemetry.find(p => p.id === selectedProcess.id) || selectedProcess;
  const hasVideo = currentProcess.input_config?.has_video !== false;
  const isRunning = currentProcess.status === 'running';
  const showPreview = isRunning && hasVideo;

  const [progressData, setProgressData] = React.useState<any>(null);

  const showFrames = progressData?.frame !== undefined && progressData?.frame !== null && progressData?.frame !== '0' && progressData?.frame !== 0;
  const showFps = progressData?.fps !== undefined && progressData?.fps !== null && progressData?.fps !== '0.0' && progressData?.fps !== '0';
  const showBitrate = progressData?.bitrate !== undefined && progressData?.bitrate !== null && progressData?.bitrate !== 'N/A' && progressData?.bitrate !== '0.0kbits/s' && progressData?.bitrate !== '0 kb/s';
  const showSpeed = progressData?.speed !== undefined && progressData?.speed !== null && progressData?.speed !== 'N/A' && progressData?.speed !== '0x' && progressData?.speed !== '0.00x';
  const showDups = progressData?.dup_frames !== undefined && progressData?.dup_frames !== null && progressData?.dup_frames !== '0' && progressData?.dup_frames !== 0 && progressData?.dup_frames !== '0.0' && progressData?.dup_frames !== 0.0;
  const showDrops = progressData?.drop_frames !== undefined && progressData?.drop_frames !== null && progressData?.drop_frames !== '0' && progressData?.drop_frames !== 0 && progressData?.drop_frames !== '0.0' && progressData?.drop_frames !== 0.0;

  // Poll progress data when running in normal mode
  useEffect(() => {
    if (!isRunning || currentProcess.debug_mode) {
      setProgressData(null);
      return;
    }

    const fetchProgress = async () => {
      try {
        const res = await fetch(`${API}/api/processes/${currentProcess.id}/progress`);
        if (res.ok) {
          const data = await res.json();
          setProgressData(data);
        }
      } catch (err) {
        console.error('Failed to fetch process progress telemetry', err);
      }
    };

    fetchProgress();
    const interval = setInterval(fetchProgress, 2000);
    return () => clearInterval(interval);
  }, [currentProcess.id, isRunning, currentProcess.debug_mode, API]);

  // Auto-scroll logs when running
  useEffect(() => {
    if (processLogsContainerRef.current && isRunning) {
      processLogsContainerRef.current.scrollTop = processLogsContainerRef.current.scrollHeight;
    }
  }, [logs, isRunning]);

  // Escape key listener to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div 
      className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 md:p-8 z-50 cursor-pointer"
      onClick={onClose}
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
            onClick={onClose}
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

          {/* Telemetry Snapshot Panel (Normal Mode) */}
          {!currentProcess.debug_mode && (
            <div className="bg-[#13131a] border border-white/10 rounded-2xl p-6 max-w-5xl mx-auto w-full space-y-4">
              <div className="flex justify-between items-center pb-3 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-brand-lime animate-pulse" />
                  <span className="text-white font-bold uppercase tracking-wider text-[10px]">Telemetría de Progreso (Snapshot)</span>
                </div>
                <span className="text-[9px] text-text-secondary bg-white/5 px-2.5 py-1 rounded-md">
                  Origen: /dev/shm/ffmpeg_progress_{currentProcess.id}.log
                </span>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {showFrames && (
                  <div className="bg-white/2 border border-white/5 rounded-xl p-3.5 flex flex-col justify-between h-20">
                    <span className="text-[9px] uppercase font-bold text-text-secondary">Frames Procesados</span>
                    <span className="text-white font-mono font-black text-lg">{progressData?.frame}</span>
                  </div>
                )}
                {showFps && (
                  <div className="bg-white/2 border border-white/5 rounded-xl p-3.5 flex flex-col justify-between h-20">
                    <span className="text-[9px] uppercase font-bold text-text-secondary">Frecuencia (FPS)</span>
                    <span className="text-white font-mono font-black text-lg">{progressData?.fps}</span>
                  </div>
                )}
                {showBitrate && (
                  <div className="bg-white/2 border border-white/5 rounded-xl p-3.5 flex flex-col justify-between h-20">
                    <span className="text-[9px] uppercase font-bold text-text-secondary">Tasa de Bits</span>
                    <span className="text-white font-mono font-black text-lg">{progressData?.bitrate}</span>
                  </div>
                )}
                {showSpeed && (
                  <div className="bg-white/2 border border-white/5 rounded-xl p-3.5 flex flex-col justify-between h-20">
                    <span className="text-[9px] uppercase font-bold text-text-secondary">Velocidad</span>
                    <span className="text-white font-mono font-black text-lg">{progressData?.speed}</span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                <div className="bg-white/2 border border-white/5 rounded-xl p-3.5 flex items-center justify-between">
                  <span className="text-[9px] uppercase font-bold text-text-secondary">Tiempo Transmitido</span>
                  <span className="text-white font-mono font-semibold text-xs">{progressData?.out_time?.split('.')[0] ?? 'N/A'}</span>
                </div>
                {showDups && (
                  <div className="bg-white/2 border border-white/5 rounded-xl p-3.5 flex items-center justify-between">
                    <span className="text-[9px] uppercase font-bold text-text-secondary">Frames Duplicados</span>
                    <span className="text-white font-mono font-semibold text-xs">{progressData?.dup_frames}</span>
                  </div>
                )}
                {showDrops && (
                  <div className="bg-white/2 border border-white/5 rounded-xl p-3.5 flex items-center justify-between">
                    <span className="text-[9px] uppercase font-bold text-text-secondary">Frames Perdidos (Drop)</span>
                    <span className="text-white font-mono font-semibold text-xs">{progressData?.drop_frames}</span>
                  </div>
                )}
              </div>

              <div className="bg-white/2 border border-white/5 rounded-xl p-3 flex justify-between items-center text-[10px]">
                <span className="text-text-secondary">Estado de Procesamiento</span>
                <span className={`font-bold uppercase ${progressData?.progress === 'continue' ? 'text-brand-lime' : 'text-text-secondary'}`}>
                  {progressData?.progress ?? 'N/A'}
                </span>
              </div>
            </div>
          )}

          {/* Process Terminal logs (Debug Mode) */}
          {currentProcess.debug_mode && (
            <div className="bg-black/60 border border-white/5 rounded-2xl p-4 font-mono text-xs max-w-5xl mx-auto w-full">
              <div className="flex justify-between items-center mb-3">
                <span className="text-brand-lime font-bold uppercase tracking-wider text-[10px]">Process Logs (Modo Debug)</span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      const a = document.createElement('a');
                      a.href = `${API}/api/processes/${currentProcess.id}/download-log`;
                      a.download = `process_${currentProcess.id}_console.log`;
                      a.click();
                    }}
                    className="px-2 py-0.5 bg-brand-lime/10 hover:bg-brand-lime/25 text-brand-lime border border-brand-lime/20 text-[9px] font-bold rounded uppercase tracking-wider transition-colors"
                  >
                    Descargar Log
                  </button>
                  <span className="text-text-secondary text-[10px] font-bold">{logs.length} lines buffered</span>
                </div>
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
          )}
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
              disabled={!!actionPending[currentProcess.id]}
              onClick={() => {
                onEditProcess(currentProcess);
                onClose();
              }}
              className="pill-button bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 text-xs font-bold py-2 px-6 border border-blue-500/25 disabled:opacity-50 disabled:pointer-events-none"
            >
              EDIT CONFIG
            </button>
            <button 
              disabled={!!actionPending[currentProcess.id]}
              onClick={() => {
                onCloneProcess(currentProcess);
                onClose();
              }}
              className="pill-button bg-white/10 hover:bg-white/15 text-xs py-2 px-6 disabled:opacity-50 disabled:pointer-events-none"
            >
              CLONE SERVICE
            </button>
            {currentProcess.status === 'running' ? (
              <>
                <button 
                  disabled={!!actionPending[currentProcess.id]}
                  onClick={() => onRestartService(currentProcess.id, currentProcess.name)}
                  className={`pill-button hover:scale-[1.02] text-black text-xs font-black py-2 px-6 transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center gap-1.5 justify-center ${
                    currentProcess.pending_changes
                      ? 'bg-brand-orange shadow-xl shadow-brand-orange/20'
                      : 'bg-brand-lime shadow-xl shadow-brand-lime/20'
                  }`}
                >
                  {actionPending[currentProcess.id] === 'restarting' && (
                    <span className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin inline-block" />
                  )}
                  {actionPending[currentProcess.id] === 'restarting' ? 'RESTARTING...' : 'RESTART SERVICE'}
                </button>
                <button 
                  disabled={!!actionPending[currentProcess.id]}
                  onClick={() => onStopService(currentProcess.id)}
                  className="pill-button bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs font-bold py-2 px-6 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-1.5 justify-center"
                >
                  {actionPending[currentProcess.id] === 'stopping' && (
                    <span className="w-3.5 h-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin inline-block" />
                  )}
                  {actionPending[currentProcess.id] === 'stopping' ? 'STOPPING...' : 'STOP SERVICE'}
                </button>
              </>
            ) : (
              <button 
                disabled={!!actionPending[currentProcess.id]}
                onClick={() => onStartService(currentProcess.id)}
                className="pill-button bg-brand-lime hover:scale-[1.02] text-black text-xs font-black py-2 px-6 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-1.5 justify-center"
              >
                {actionPending[currentProcess.id] === 'starting' && (
                  <span className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin inline-block" />
                )}
                {actionPending[currentProcess.id] === 'starting' ? 'STARTING...' : 'START SERVICE'}
              </button>
            )}
            <button 
              onClick={onClose}
              className="pill-button bg-white/5 hover:bg-white/10 text-xs border border-white/10 py-2 px-6"
            >
              CLOSE
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
