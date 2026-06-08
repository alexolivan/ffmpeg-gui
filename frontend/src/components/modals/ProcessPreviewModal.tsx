import React, { useEffect, useRef } from 'react';

interface ProcessPreviewModalProps {
  selectedProcess: any;
  telemetry: any[];
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
                onEditProcess(currentProcess);
                onClose();
              }}
              className="pill-button bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 text-xs font-bold py-2 px-6 border border-blue-500/25"
            >
              EDIT CONFIG
            </button>
            <button 
              onClick={() => {
                onCloneProcess(currentProcess);
                onClose();
              }}
              className="pill-button bg-white/10 hover:bg-white/15 text-xs py-2 px-6"
            >
              CLONE SERVICE
            </button>
            {currentProcess.status === 'running' ? (
              <>
                <button 
                  onClick={() => onRestartService(currentProcess.id, currentProcess.name)}
                  className={`pill-button hover:scale-[1.02] text-black text-xs font-black py-2 px-6 transition-all ${
                    currentProcess.pending_changes
                      ? 'bg-brand-orange shadow-xl shadow-brand-orange/20'
                      : 'bg-brand-lime shadow-xl shadow-brand-lime/20'
                  }`}
                >
                  RESTART SERVICE
                </button>
                <button 
                  onClick={() => onStopService(currentProcess.id)}
                  className="pill-button bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs font-bold py-2 px-6"
                >
                  STOP SERVICE
                </button>
              </>
            ) : (
              <button 
                onClick={() => onStartService(currentProcess.id)}
                className="pill-button bg-brand-lime hover:scale-[1.02] text-black text-xs font-black py-2 px-6"
              >
                START SERVICE
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
