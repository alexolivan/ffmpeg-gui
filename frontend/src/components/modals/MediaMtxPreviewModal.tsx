import React, { useEffect, useRef, useState } from 'react';
import { EngineLogo } from '../common/EngineLogo';

interface MediaMtxPreviewModalProps {
  selectedProcess: any;
  telemetry: any[];
  actionPending: Record<number, 'starting' | 'stopping' | 'restarting'>;
  logs: any[];
  onClose: () => void;
  onEditProcess: (proc: any) => void;
  onCloneProcess: (proc: any) => void;
  onStartService: (id: number) => void;
  onStopService: (id: number, name?: string) => void;
  onRestartService: (id: number, name: string) => void;
  API: string;
}

const formatUptime = (lastStartStr: string | null | undefined): string => {
  if (!lastStartStr) return 'N/A';
  const start = new Date(lastStartStr);
  const diffMs = Date.now() - start.getTime();
  if (diffMs <= 0) return '0s';
  const diffSecs = Math.floor(diffMs / 1000);
  const days = Math.floor(diffSecs / 86400);
  const hours = Math.floor((diffSecs % 86400) / 3600);
  const mins = Math.floor((diffSecs % 3600) / 60);
  const secs = diffSecs % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
};

export const MediaMtxPreviewModal: React.FC<MediaMtxPreviewModalProps> = ({
  selectedProcess,
  telemetry,
  actionPending,
  logs: externalLogs,
  onClose,
  onEditProcess,
  onCloneProcess,
  onStartService,
  onStopService,
  onRestartService,
  API,
}) => {
  const processLogsContainerRef = useRef<HTMLDivElement | null>(null);

  const currentProcess = telemetry.find((p) => p.id === selectedProcess.id) || selectedProcess;
  const isRunning = currentProcess.status === 'running';

  const [daemonLogs, setDaemonLogs] = useState<any[]>([]);
  const [copySuccess, setCopySuccess] = useState(false);

  const mtxCfg = currentProcess.config?.mediamtx_config || currentProcess.config || {};

  // Poll logs for MediaMTX daemon
  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await fetch(`${API}/processes/${currentProcess.id}/logs`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            setDaemonLogs(data);
          }
        }
      } catch (err) {
        console.error('Failed to fetch daemon logs', err);
      }
    };

    fetchLogs();
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, [currentProcess.id, API]);

  const activeLogs = daemonLogs.length > 0 ? daemonLogs : externalLogs;

  // Auto-scroll logs when running
  useEffect(() => {
    if (processLogsContainerRef.current && isRunning) {
      processLogsContainerRef.current.scrollTop = processLogsContainerRef.current.scrollHeight;
    }
  }, [activeLogs, isRunning]);

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

  const handleCopyLogs = () => {
    const text = activeLogs.map((l) => (typeof l === 'string' ? l : `[${l.timestamp || ''}] ${l.message || ''}`)).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    });
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 md:p-8 z-50 cursor-pointer"
      onClick={onClose}
    >
      <div
        className="glass-card w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden relative border border-white/10 cursor-default text-[var(--text-primary)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-[var(--glass-border)] flex justify-between items-center flex-shrink-0 bg-white/2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] flex items-center justify-center p-1.5 shrink-0">
              <EngineLogo softwareType="mediamtx" size={26} API={API} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-black uppercase tracking-tight">{currentProcess.alias || currentProcess.name}</h3>
                <span className="text-[9px] uppercase font-mono px-2 py-0.5 rounded border font-bold bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                  MediaMTX Hub
                </span>
              </div>
              <p className="text-[var(--text-secondary)] text-xs uppercase tracking-wider mt-0.5">
                Daemon Process Monitor & Real-Time Audit Logs
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-white transition-colors cursor-pointer text-xs"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 min-h-0 custom-scrollbar">
          {currentProcess.pending_changes && (
            <div className="bg-brand-orange/10 border border-brand-orange/30 text-brand-orange p-3.5 rounded-xl flex items-center gap-3 animate-pulse">
              <span className="text-xl">⚠️</span>
              <div className="text-xs">
                <span className="font-bold block uppercase tracking-wider mb-0.5">Configuration Pending Reboot</span>
                This service has modified configurations that are not yet active in the running instance. Restart the service to apply these changes.
              </div>
            </div>
          )}

          {/* Telemetry Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 text-center">
              <div className="text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-0.5">Status</div>
              <div
                className={`font-black text-xs tracking-tight ${
                  isRunning ? 'text-brand-lime' : currentProcess.status === 'error' ? 'text-red-400' : 'text-zinc-500'
                }`}
              >
                {currentProcess.status ? currentProcess.status.toUpperCase() : 'OFFLINE'}
              </div>
            </div>

            <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 text-center">
              <div className="text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-0.5">PID</div>
              <div className="font-bold font-mono text-xs text-[var(--text-primary)]">
                {isRunning && currentProcess.pid ? currentProcess.pid : 'OFFLINE'}
              </div>
            </div>

            <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 text-center">
              <div className="text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-0.5">Uptime</div>
              <div className="font-bold font-mono text-xs text-[var(--text-primary)]">
                {formatUptime(currentProcess.last_start)}
              </div>
            </div>

            <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 text-center">
              <div className="text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-0.5">CPU Usage</div>
              <div className="font-bold font-mono text-xs text-brand-lime">{currentProcess.cpu || 0}%</div>
            </div>

            <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 text-center col-span-2 sm:col-span-1">
              <div className="text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-0.5">RAM Usage</div>
              <div className="font-bold font-mono text-xs text-brand-orange">{currentProcess.ram || 0} MB</div>
            </div>
          </div>

          {/* Protocol Listeners Status Grid */}
          <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-brand-lime flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-brand-lime animate-pulse" />
                Active Protocol Listeners & Hub Ports
              </span>
              <span className="text-[9px] text-[var(--text-secondary)]">Zero-Loss Multiplexing</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
              <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-center">
                <span className="text-[9px] font-bold text-[var(--text-secondary)] uppercase block">RTMP</span>
                <span className="text-xs font-mono font-bold text-amber-400">
                  {mtxCfg.rtmp_enabled !== false ? `:${mtxCfg.rtmp_port || 1935}` : 'OFF'}
                </span>
              </div>

              <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-center">
                <span className="text-[9px] font-bold text-[var(--text-secondary)] uppercase block">RTSP</span>
                <span className="text-xs font-mono font-bold text-cyan-400">
                  {mtxCfg.rtsp_enabled !== false ? `:${mtxCfg.rtsp_port || 8554}` : 'OFF'}
                </span>
              </div>

              <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-center">
                <span className="text-[9px] font-bold text-[var(--text-secondary)] uppercase block">WebRTC / WHEP</span>
                <span className="text-xs font-mono font-bold text-emerald-400">
                  {mtxCfg.webrtc_enabled !== false ? `:${mtxCfg.webrtc_port || 8889}` : 'OFF'}
                </span>
              </div>

              <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-center">
                <span className="text-[9px] font-bold text-[var(--text-secondary)] uppercase block">SRT</span>
                <span className="text-xs font-mono font-bold text-purple-400">
                  {mtxCfg.srt_enabled !== false ? `:${mtxCfg.srt_port || 8890}` : 'OFF'}
                </span>
              </div>

              <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-center">
                <span className="text-[9px] font-bold text-[var(--text-secondary)] uppercase block">HLS (HTTP)</span>
                <span className="text-xs font-mono font-bold text-blue-400">
                  {mtxCfg.hls_enabled ? `:${mtxCfg.hls_port || 8888}` : 'OFF'}
                </span>
              </div>

              <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-center">
                <span className="text-[9px] font-bold text-[var(--text-secondary)] uppercase block">API Control</span>
                <span className="text-xs font-mono font-bold text-[var(--text-primary)]">
                  {mtxCfg.api_enabled !== false ? `:${mtxCfg.api_port || 9997}` : 'OFF'}
                </span>
              </div>
            </div>
          </div>

          {/* Daemon Virtual Terminal Output */}
          <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3.5 font-mono text-xs space-y-2">
            <div className="flex justify-between items-center border-b border-[var(--glass-border)] pb-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-brand-lime animate-pulse" />
                <span className="text-brand-lime font-bold uppercase tracking-wider text-[10px]">
                  Daemon Real-Time Audit Console
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyLogs}
                  className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-[var(--text-primary)] border border-[var(--glass-border)] text-[9px] font-bold rounded uppercase tracking-wider transition-colors cursor-pointer"
                >
                  {copySuccess ? '✓ Copied' : 'Copy Logs'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const a = document.createElement('a');
                    a.href = `${API}/api/processes/${currentProcess.id}/download-log`;
                    a.download = `mediamtx_${currentProcess.id}_console.log`;
                    a.click();
                  }}
                  className="px-2.5 py-1 bg-brand-lime/10 hover:bg-brand-lime/25 text-brand-lime border border-brand-lime/20 text-[9px] font-bold rounded uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Download Log
                </button>
                <span className="text-[var(--text-secondary)] text-[10px] font-bold">{activeLogs.length} lines</span>
              </div>
            </div>

            <div
              ref={processLogsContainerRef}
              className="h-64 overflow-y-auto space-y-1 custom-scrollbar pr-2 select-text text-[11px] leading-relaxed"
            >
              {activeLogs.length === 0 ? (
                <div className="text-[var(--text-secondary)] opacity-40 italic text-center py-16 select-none">
                  {isRunning ? 'Daemon active. Waiting for stream connection activity...' : 'Daemon is stopped. Start service to monitor stream routing.'}
                </div>
              ) : (
                activeLogs.map((log, i) => {
                  const logMsg = typeof log === 'string' ? log : log.message || '';
                  const logTime = typeof log === 'object' && log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '';
                  const isErr = logMsg.toLowerCase().includes('err') || (typeof log === 'object' && log.level === 'ERROR');
                  const isWarn = logMsg.toLowerCase().includes('warn') || (typeof log === 'object' && log.level === 'WARN');

                  return (
                    <div key={i} className="whitespace-pre-wrap flex items-start gap-2">
                      {logTime && (
                        <span className="text-[var(--text-secondary)] select-none shrink-0 opacity-70">
                          [{logTime}]
                        </span>
                      )}
                      <span
                        className={`${
                          isErr ? 'text-red-400 font-bold' : isWarn ? 'text-amber-400' : 'text-[var(--text-primary)]'
                        }`}
                      >
                        {logMsg}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--glass-border)] flex-shrink-0 bg-white/2 flex justify-between items-center flex-wrap gap-3">
          <div>
            <button
              onClick={() => {
                fetch(`${API}/processes/${currentProcess.id}/export`)
                  .then((r) => r.json())
                  .then((data) => {
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = `${currentProcess.name}_profile.json`;
                    a.click();
                  });
              }}
              className="pill-button bg-white/10 hover:bg-white/15 text-xs py-1.5 px-4 cursor-pointer"
            >
              EXPORT PROFILE
            </button>
          </div>

          <div className="flex gap-2">
            <button
              disabled={!!actionPending[currentProcess.id]}
              onClick={() => {
                onEditProcess(currentProcess);
                onClose();
              }}
              className="pill-button bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 text-xs font-bold py-1.5 px-4 border border-blue-500/25 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
            >
              EDIT CONFIG
            </button>

            <button
              disabled={!!actionPending[currentProcess.id]}
              onClick={() => {
                onCloneProcess(currentProcess);
                onClose();
              }}
              className="pill-button bg-white/10 hover:bg-white/15 text-xs py-1.5 px-4 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
            >
              CLONE SERVICE
            </button>

            {currentProcess.status === 'running' ? (
              <>
                <button
                  disabled={!!actionPending[currentProcess.id]}
                  onClick={() => onRestartService(currentProcess.id, currentProcess.name)}
                  className={`pill-button hover:scale-[1.02] text-black text-xs font-black py-1.5 px-5 transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center gap-1.5 justify-center cursor-pointer ${
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
                  onClick={() => onStopService(currentProcess.id, currentProcess.name)}
                  className="pill-button bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs font-bold py-1.5 px-5 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-1.5 justify-center cursor-pointer"
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
                className="pill-button bg-brand-lime hover:scale-[1.02] text-black text-xs font-black py-1.5 px-5 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-1.5 justify-center cursor-pointer"
              >
                {actionPending[currentProcess.id] === 'starting' && (
                  <span className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin inline-block" />
                )}
                {actionPending[currentProcess.id] === 'starting' ? 'STARTING...' : 'START SERVICE'}
              </button>
            )}

            <button
              onClick={onClose}
              className="pill-button bg-white/5 hover:bg-white/10 text-xs border border-white/10 py-1.5 px-4 cursor-pointer"
            >
              CLOSE
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
