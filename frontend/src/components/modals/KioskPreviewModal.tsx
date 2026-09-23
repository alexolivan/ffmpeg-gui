import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EngineLogo } from '../common/EngineLogo';
import {
  PlayIcon,
  StopIcon,
  RefreshIcon,
  PencilIcon,
  ClipboardIcon,
  CheckIcon,
} from '../Icons';
import { copyToClipboard as universalCopy } from '../../utils/clipboard';

interface KioskPreviewModalProps {
  selectedProcess: any;
  telemetry: any[];
  actionPending: Record<number, 'starting' | 'stopping' | 'restarting'>;
  logs: any[];
  onClose: () => void;
  onEditProcess: (proc: any) => void;
  onCloneProcess?: (proc: any) => void;
  onStartService: (id: number) => void;
  onStopService: (id: number, name?: string) => void;
  onRestartService: (id: number, name: string) => void;
  API: string;
}

const formatUptime = (lastStartStr: string | null | undefined, isRunning: boolean = true): string => {
  if (!isRunning || !lastStartStr) return '-';
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

export const KioskPreviewModal: React.FC<KioskPreviewModalProps> = ({
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
  const logsContainerRef = useRef<HTMLDivElement | null>(null);

  const currentProcess = telemetry.find((p) => p.id === selectedProcess.id) || selectedProcess;
  const isRunning = currentProcess.status === 'running';

  const [daemonLogs, setDaemonLogs] = useState<any[]>([]);
  const [copiedLogs, setCopiedLogs] = useState(false);

  const kCfg = currentProcess.config?.kiosk_config || currentProcess.kiosk_config || {};
  const engineId = (kCfg.engine_id || 'chromium').toLowerCase();
  const targetUrl = kCfg.target_source || 'about:blank';
  const desktopId = kCfg.desktop_service_id ?? '?';
  const diskCacheDisabled = kCfg.disk_cache_disabled !== false;
  const gpuAccel = kCfg.gpu_acceleration || 'auto';

  const cpu = currentProcess.cpu_usage ?? currentProcess.cpu ?? 0;
  const ram = currentProcess.ram_usage ?? currentProcess.ram ?? 0;
  const pid = currentProcess.pid;

  // Poll daemon logs
  useEffect(() => {
    let interval: any = null;
    const fetchLogs = async () => {
      try {
        const res = await fetch(`${API}/processes/${currentProcess.id}/logs`);
        if (res.ok) {
          const data = await res.json();
          setDaemonLogs(Array.isArray(data) ? data : []);
        }
      } catch {
        // ignore log fetch failure
      }
    };
    fetchLogs();
    interval = setInterval(fetchLogs, 2000);
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [API, currentProcess.id]);

  // Auto-scroll logs
  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [daemonLogs, externalLogs]);

  const handleCopyLogs = () => {
    const lines = (daemonLogs.length > 0 ? daemonLogs : externalLogs).map((l: any) =>
      typeof l === 'string' ? l : l.message || JSON.stringify(l)
    );
    universalCopy(lines.join('\n'));
    setCopiedLogs(true);
    setTimeout(() => setCopiedLogs(false), 2000);
  };

  const activeLogs = daemonLogs.length > 0 ? daemonLogs : externalLogs;

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 z-50 animate-in fade-in duration-150">
      <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl w-full max-w-5xl h-[88vh] shadow-2xl flex flex-col overflow-hidden text-[var(--text-primary)]">
        {/* Header Bar */}
        <div className="p-4 border-b border-[var(--glass-border)] flex items-center justify-between gap-4 shrink-0 bg-black/20">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className={`w-3 h-3 rounded-full flex-shrink-0 ${
                isRunning
                  ? 'bg-brand-lime shadow-[0_0_8px_rgba(212,255,91,0.6)]'
                  : currentProcess.status === 'error'
                  ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]'
                  : 'bg-zinc-600'
              }`}
            />

            <EngineLogo softwareType={engineId} size={20} API={API} />

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-[var(--text-primary)] truncate">
                  {currentProcess.alias || currentProcess.name}
                </h2>
                {currentProcess.alias && (
                  <span className="text-xs font-mono text-[var(--text-secondary)] opacity-70 truncate">
                    [{currentProcess.name}]
                  </span>
                )}
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded border bg-amber-500/10 text-amber-400 border-amber-500/30 uppercase">
                  {engineId === 'firefox' ? 'Firefox Kiosk' : 'Chrome Kiosk'}
                </span>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded border bg-cyan-500/10 text-cyan-400 border-cyan-500/30">
                  Desktop #{desktopId}
                </span>
              </div>

              <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] font-mono mt-0.5 truncate">
                <span className="truncate">URL: <strong className="text-[var(--text-primary)]">{targetUrl}</strong></span>
              </div>
            </div>
          </div>

          {/* Action Button Controls */}
          <div className="flex items-center gap-2 shrink-0">
            {isRunning ? (
              <>
                <button
                  onClick={() => onRestartService(selectedProcess.id, selectedProcess.name)}
                  disabled={!!actionPending[selectedProcess.id]}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 border border-purple-500/30 flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                  title="Restart Service"
                >
                  <RefreshIcon size={12} className={actionPending[selectedProcess.id] === 'restarting' ? 'animate-spin' : ''} />
                  {t('common.restart', 'Restart')}
                </button>
                <button
                  onClick={() => onStopService(selectedProcess.id, selectedProcess.name)}
                  disabled={!!actionPending[selectedProcess.id]}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-orange/20 text-brand-orange hover:bg-brand-orange/30 border border-brand-orange/30 flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                  title="Stop Service"
                >
                  <StopIcon size={12} />
                  {t('common.stop', 'Stop')}
                </button>
              </>
            ) : (
              <button
                onClick={() => onStartService(selectedProcess.id)}
                disabled={!!actionPending[selectedProcess.id]}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-lime text-black hover:opacity-90 flex items-center gap-1.5 transition-all shadow-md cursor-pointer disabled:opacity-50"
                title="Start Service"
              >
                <PlayIcon size={12} />
                {t('common.start', 'Start')}
              </button>
            )}

            <button
              onClick={() => {
                onClose();
                onEditProcess(selectedProcess);
              }}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all cursor-pointer"
              title={t('common.edit', 'Edit Service')}
            >
              <PencilIcon size={14} />
            </button>

            {onCloneProcess && (
              <button
                onClick={() => {
                  onClose();
                  onCloneProcess(selectedProcess);
                }}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all cursor-pointer"
                title={t('common.clone', 'Clone Service')}
              >
                <ClipboardIcon size={14} />
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 bg-white/5 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-all text-xs cursor-pointer ml-2"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Telemetry Summary Strip */}
        <div className="p-3 border-b border-[var(--glass-border)] bg-black/10 flex items-center justify-between gap-4 flex-wrap text-xs font-mono">
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <span className="text-[10px] text-[var(--text-secondary)] uppercase block">PID</span>
              <strong className={isRunning && pid ? 'text-[var(--text-primary)]' : 'text-zinc-500'}>
                {isRunning && pid ? pid : t('common.offline', 'OFFLINE')}
              </strong>
            </div>

            <div className="h-6 w-px bg-[var(--glass-border)]" />

            <div>
              <span className="text-[10px] text-[var(--text-secondary)] uppercase block">Uptime</span>
              <strong className="text-[var(--text-primary)]">{formatUptime(currentProcess.last_start, isRunning)}</strong>
            </div>

            <div className="h-6 w-px bg-[var(--glass-border)]" />

            <div>
              <span className="text-[10px] text-[var(--text-secondary)] uppercase block">CPU</span>
              <strong className={isRunning && cpu > 80 ? 'text-red-400' : 'text-[var(--text-primary)]'}>
                {isRunning ? `${cpu}%` : '-'}
              </strong>
            </div>

            <div className="h-6 w-px bg-[var(--glass-border)]" />

            <div>
              <span className="text-[10px] text-[var(--text-secondary)] uppercase block">RAM</span>
              <strong className="text-[var(--text-primary)]">{isRunning ? `${ram} MB` : '-'}</strong>
            </div>

            <div className="h-6 w-px bg-[var(--glass-border)]" />

            <div>
              <span className="text-[10px] text-[var(--text-secondary)] uppercase block">GPU Accel</span>
              <span className="text-zinc-300 font-semibold capitalize">{gpuAccel}</span>
            </div>

            <div className="h-6 w-px bg-[var(--glass-border)]" />

            <div>
              <span className="text-[10px] text-[var(--text-secondary)] uppercase block">Flash Protection</span>
              <span className={diskCacheDisabled ? 'text-emerald-400 font-semibold' : 'text-zinc-400'}>
                {diskCacheDisabled ? 'Active (/dev/null)' : 'Disabled'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyLogs}
              className="text-xs bg-white/5 hover:bg-white/10 text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--glass-border)] px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer"
            >
              {copiedLogs ? <CheckIcon size={12} className="text-brand-lime" /> : <ClipboardIcon size={12} />}
              {copiedLogs ? t('common.copied', 'Copied!') : t('common.copy_logs', 'Copy Logs')}
            </button>
          </div>
        </div>

        {/* Live Diagnostics Console Log Viewport */}
        <div className="flex-1 min-h-0 bg-black/95 relative flex flex-col overflow-hidden">
          <div className="p-2 border-b border-zinc-800 bg-zinc-950/60 flex items-center justify-between text-[11px] font-mono text-zinc-400">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-brand-lime animate-pulse" />
              <span>Standard Output & Diagnostics (stdout/stderr)</span>
            </span>
            <span>{activeLogs.length} events logged</span>
          </div>

          <div
            ref={logsContainerRef}
            className="flex-1 p-4 font-mono text-xs text-zinc-300 overflow-y-auto space-y-1 select-text"
          >
            {activeLogs.length === 0 ? (
              <p className="text-zinc-600 italic">
                {isRunning
                  ? t('common.loading', 'Waiting for process output...')
                  : t('common.no_logs', 'Process is stopped. Start the service to stream live console logs.')}
              </p>
            ) : (
              activeLogs.map((line: any, idx: number) => {
                const msg = typeof line === 'string' ? line : line.message || JSON.stringify(line);
                const isErr = msg.toLowerCase().includes('error') || msg.toLowerCase().includes('failed') || msg.toLowerCase().includes('cannot open');
                const isWarn = msg.toLowerCase().includes('warn');
                return (
                  <div
                    key={idx}
                    className={`whitespace-pre-wrap leading-relaxed ${
                      isErr ? 'text-red-400 font-semibold' : isWarn ? 'text-amber-300' : 'text-zinc-300 hover:text-white'
                    }`}
                  >
                    {msg}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
