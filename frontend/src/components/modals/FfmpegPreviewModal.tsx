import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hasVideo as hasVideoHelper } from '../cards/UnifiedServiceCard';
import { EngineLogo } from '../common/EngineLogo';

interface FfmpegPreviewModalProps {
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

export const FfmpegPreviewModal: React.FC<FfmpegPreviewModalProps> = ({
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
  const { t } = useTranslation();
  const processLogsContainerRef = useRef<HTMLDivElement | null>(null);

  const currentProcess = telemetry.find((p) => p.id === selectedProcess.id) || selectedProcess;
  const isVideoProcess = hasVideoHelper(currentProcess);
  const isRunning = currentProcess.status === 'running';
  const showPreview = isRunning && isVideoProcess;

  const [progressData, setProgressData] = useState<any>(null);

  const showFrames = progressData?.frame !== undefined && progressData?.frame !== null && progressData?.frame !== '0' && progressData?.frame !== 0;
  const showFps = progressData?.fps !== undefined && progressData?.fps !== null && progressData?.fps !== '0.0' && progressData?.fps !== '0';
  const showBitrate = progressData?.bitrate !== undefined && progressData?.bitrate !== null && progressData?.bitrate !== 'N/A' && progressData?.bitrate !== '0.0kbits/s' && progressData?.bitrate !== '0 kb/s';
  const showSpeed = progressData?.speed !== undefined && progressData?.speed !== null && progressData?.speed !== 'N/A' && progressData?.speed !== '0x' && progressData?.speed !== '0.00x';
  const showDups = progressData?.dup_frames !== undefined && progressData?.dup_frames !== null && progressData?.dup_frames !== '0' && progressData?.dup_frames !== 0;
  const showDrops = progressData?.drop_frames !== undefined && progressData?.drop_frames !== null && progressData?.drop_frames !== '0' && progressData?.drop_frames !== 0;

  // Poll progress data for FFmpeg services
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
  }, [externalLogs, isRunning]);

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
        className="glass-card w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden relative border border-white/10 cursor-default text-[var(--text-primary)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-[var(--glass-border)] flex justify-between items-center flex-shrink-0 bg-white/2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] flex items-center justify-center p-1.5 shrink-0">
              <EngineLogo softwareType="ffmpeg" size={26} API={API} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-black uppercase tracking-tight">{currentProcess.alias || currentProcess.name}</h3>
                <span className="text-[9px] uppercase font-mono px-2 py-0.5 rounded border font-bold bg-brand-orange/10 text-brand-orange border-brand-orange/30">
                  FFmpeg Stream
                </span>
              </div>
              <p className="text-[var(--text-secondary)] text-xs uppercase tracking-wider mt-0.5">
                {showPreview ? 'Live Stream Preview (MJPEG)' : 'Service Status & Configuration'}
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

          {showPreview ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
              {/* Col 1: Stats */}
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 text-center">
                    <div className="text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-0.5">Status</div>
                    <div
                      className={`font-black text-xs tracking-tight ${
                        currentProcess.status === 'running'
                          ? 'text-brand-lime'
                          : currentProcess.status === 'error'
                          ? 'text-red-400'
                          : 'text-white/60'
                      }`}
                    >
                      {currentProcess.status.toUpperCase()}
                    </div>
                  </div>
                  <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 text-center">
                    <div className="text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-0.5">Bitrate</div>
                    <div className="font-bold font-mono text-xs text-[var(--text-primary)]">
                      {currentProcess.bitrate || '0 kb/s'}
                    </div>
                  </div>
                  <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 text-center">
                    <div className="text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-0.5">FPS</div>
                    <div className="font-bold font-mono text-xs text-[var(--text-primary)]">
                      {currentProcess.fps || '0'}
                    </div>
                  </div>
                  <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 text-center">
                    <div className="text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-0.5">Speed</div>
                    <div className="font-bold font-mono text-xs text-[var(--text-primary)]">
                      {currentProcess.speed || '0x'}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 flex justify-between items-center">
                    <span className="text-[9px] uppercase font-black text-[var(--text-secondary)]">CPU Usage</span>
                    <span className="font-mono font-bold text-brand-lime text-xs">{currentProcess.cpu || 0}%</span>
                  </div>
                  <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 flex justify-between items-center">
                    <span className="text-[9px] uppercase font-black text-[var(--text-secondary)]">RAM Usage</span>
                    <span className="font-mono font-bold text-brand-orange text-xs">{currentProcess.ram || 0} MB</span>
                  </div>
                </div>
              </div>

              {/* Col 2: Live Preview */}
              <div className="flex flex-col justify-center">
                <div className="aspect-video bg-black rounded-xl overflow-hidden border border-white/5 flex items-center justify-center relative shadow-2xl">
                  <img
                    src={`${API}/processes/${currentProcess.id}/preview`}
                    alt="Live Preview"
                    className="max-h-full max-w-full object-contain"
                  />
                  <div className="absolute top-2.5 left-2.5 px-2 py-0.5 bg-brand-lime text-black text-[8px] font-black rounded tracking-wider uppercase animate-pulse">
                    LIVE
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 text-center">
                  <div className="text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-0.5">Status</div>
                  <div
                    className={`font-black text-xs tracking-tight ${
                      currentProcess.status === 'running'
                        ? 'text-brand-lime'
                        : currentProcess.status === 'error'
                        ? 'text-red-400'
                        : 'text-white/60'
                    }`}
                  >
                    {currentProcess.status.toUpperCase()}
                  </div>
                </div>
                <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 text-center">
                  <div className="text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-0.5">Bitrate</div>
                  <div className="font-bold font-mono text-xs text-[var(--text-primary)]">
                    {currentProcess.bitrate || '0 kb/s'}
                  </div>
                </div>
                <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 text-center">
                  <div className="text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-0.5">Stream</div>
                  <div className="font-bold font-mono text-xs text-[var(--text-primary)]">AUDIO ONLY</div>
                </div>
                <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 text-center">
                  <div className="text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-0.5">Speed</div>
                  <div className="font-bold font-mono text-xs text-[var(--text-primary)]">
                    {currentProcess.speed || '0x'}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 flex justify-between items-center">
                  <span className="text-[9px] uppercase font-black text-[var(--text-secondary)]">CPU Usage</span>
                  <span className="font-mono font-bold text-brand-lime text-xs">{currentProcess.cpu || 0}%</span>
                </div>
                <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 flex justify-between items-center">
                  <span className="text-[9px] uppercase font-black text-[var(--text-secondary)]">RAM Usage</span>
                  <span className="font-mono font-bold text-brand-orange text-xs">{currentProcess.ram || 0} MB</span>
                </div>
              </div>

              {!isVideoProcess && isRunning && (
                <div className="p-3.5 bg-brand-blue/10 border border-brand-blue/20 rounded-xl flex items-center gap-3 animate-in fade-in duration-300">
                  <span className="text-xl">📻</span>
                  <div>
                    <div className="font-bold text-brand-blue uppercase text-xs tracking-wider">Audio-Only Broadcast Active</div>
                    <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">This service does not produce video outputs. Audio signals are processing normally.</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Telemetry Snapshot Panel (Normal Mode) */}
          {!currentProcess.debug_mode && (
            <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] text-[var(--text-primary)] rounded-xl p-4 max-w-5xl mx-auto w-full space-y-3">
              <div className="flex justify-between items-center pb-2 border-b border-[var(--glass-border)]">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-brand-lime animate-pulse" />
                  <span className="text-[var(--text-primary)] font-bold uppercase tracking-wider text-[10px]">
                    Telemetría de Progreso (Snapshot)
                  </span>
                </div>
                <span className="text-[9px] text-[var(--text-secondary)] bg-white/5 px-2 py-0.5 rounded">
                  /dev/shm/ffmpeg_progress_{currentProcess.id}s.log
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {showFrames && (
                  <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2.5 flex flex-col justify-between">
                    <span className="text-[9px] uppercase font-bold text-[var(--text-secondary)]">Frames</span>
                    <span className="text-[var(--text-primary)] font-mono font-black text-sm">{progressData?.frame}</span>
                  </div>
                )}
                {showFps && (
                  <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2.5 flex flex-col justify-between">
                    <span className="text-[9px] uppercase font-bold text-[var(--text-secondary)]">FPS</span>
                    <span className="text-[var(--text-primary)] font-mono font-black text-sm">{progressData?.fps}</span>
                  </div>
                )}
                {showBitrate && (
                  <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2.5 flex flex-col justify-between">
                    <span className="text-[9px] uppercase font-bold text-[var(--text-secondary)]">Bitrate</span>
                    <span className="text-[var(--text-primary)] font-mono font-black text-sm">{progressData?.bitrate}</span>
                  </div>
                )}
                {showSpeed && (
                  <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2.5 flex flex-col justify-between">
                    <span className="text-[9px] uppercase font-bold text-[var(--text-secondary)]">Speed</span>
                    <span className="text-[var(--text-primary)] font-mono font-black text-sm">{progressData?.speed}</span>
                  </div>
                )}
                {showDups && (
                  <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2.5 flex flex-col justify-between">
                    <span className="text-[9px] uppercase font-bold text-[var(--text-secondary)]">Dups</span>
                    <span className="text-[var(--text-primary)] font-mono font-black text-sm">{progressData?.dup_frames}</span>
                  </div>
                )}
                {showDrops && (
                  <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2.5 flex flex-col justify-between">
                    <span className="text-[9px] uppercase font-bold text-[var(--text-secondary)]">Drops</span>
                    <span className="text-[var(--text-primary)] font-mono font-black text-sm">{progressData?.drop_frames}</span>
                  </div>
                )}
              </div>
            </div>
          )}
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

            <button
              disabled={!!actionPending[currentProcess.id]}
              onClick={async () => {
                try {
                  const res = await fetch(`${API}/processes/${currentProcess.id}/clone-as-task`, { method: 'POST' });
                  if (!res.ok) throw new Error('Failed to clone service as task');
                  alert(t('common.clonedSuccess', 'Cloned successfully!'));
                  onClose();
                } catch (err: any) {
                  alert(err.message || 'Error cloning service as task');
                }
              }}
              className="pill-button bg-brand-lime/10 hover:bg-brand-lime/20 text-brand-lime border border-brand-lime/20 text-xs font-bold py-1.5 px-3 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
            >
              COPY AS TASK
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
