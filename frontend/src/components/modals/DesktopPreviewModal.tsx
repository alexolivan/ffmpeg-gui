import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import RFB from '@novnc/novnc';
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

interface DesktopPreviewModalProps {
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

export const DesktopPreviewModal: React.FC<DesktopPreviewModalProps> = ({
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

  const currentProcess = telemetry.find((p) => p.id === selectedProcess.id) || selectedProcess;
  const isRunning = currentProcess.status === 'running';

  const [activeTab, setActiveTab] = useState<'screen' | 'logs'>('screen');
  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'disconnected' | 'failed'
  >('disconnected');
  const [scaleViewport, setScaleViewport] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [daemonLogs, setDaemonLogs] = useState<any[]>([]);

  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const rfbRef = useRef<any>(null);
  const logsContainerRef = useRef<HTMLDivElement | null>(null);

  const deskCfg = currentProcess.config?.desktop_config || currentProcess.config || {};
  const displayNum = deskCfg.display_num ?? 99;
  const vncPort = deskCfg.vnc_port ?? 5900 + displayNum;
  const resolution = deskCfg.resolution || '1920x1080';

  // Fetch daemon logs
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

  // Auto-scroll logs when updated
  useEffect(() => {
    if (logsContainerRef.current && activeTab === 'logs') {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [daemonLogs, externalLogs, activeTab]);

  // Connect RFB client when running and screen tab is active
  useEffect(() => {
    if (!isRunning || activeTab !== 'screen' || !canvasContainerRef.current) {
      if (rfbRef.current) {
        try {
          rfbRef.current.disconnect();
        } catch {}
        rfbRef.current = null;
      }
      setConnectionStatus('disconnected');
      return;
    }

    const container = canvasContainerRef.current;
    // Clear any previous canvas child elements
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/desktop/${selectedProcess.id}/vnc`;

    setConnectionStatus('connecting');

    try {
      const rfb = new RFB(container, wsUrl, {
        shared: true,
      });

      rfb.scaleViewport = scaleViewport;
      rfb.resizeSession = false;

      rfb.addEventListener('connect', () => {
        setConnectionStatus('connected');
      });

      rfb.addEventListener('disconnect', (e: any) => {
        setConnectionStatus(e?.detail?.clean ? 'disconnected' : 'failed');
      });

      rfbRef.current = rfb;
    } catch (err) {
      console.error('[noVNC] Connection error:', err);
      setConnectionStatus('failed');
    }

    return () => {
      if (rfbRef.current) {
        try {
          rfbRef.current.disconnect();
        } catch {}
        rfbRef.current = null;
      }
    };
  }, [isRunning, activeTab, selectedProcess.id, scaleViewport]);

  const handleReconnect = () => {
    if (rfbRef.current) {
      try {
        rfbRef.current.disconnect();
      } catch {}
      rfbRef.current = null;
    }
    setConnectionStatus('connecting');
    // Force effect re-run by toggling briefly
    setTimeout(() => {
      if (canvasContainerRef.current && isRunning) {
        const container = canvasContainerRef.current;
        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = `${protocol}//${host}/ws/desktop/${selectedProcess.id}/vnc`;
        try {
          const rfb = new RFB(container, wsUrl, { shared: true });
          rfb.scaleViewport = scaleViewport;
          rfb.addEventListener('connect', () => setConnectionStatus('connected'));
          rfb.addEventListener('disconnect', (e: any) => setConnectionStatus(e?.detail?.clean ? 'disconnected' : 'failed'));
          rfbRef.current = rfb;
        } catch {
          setConnectionStatus('failed');
        }
      }
    }, 100);
  };

  const toggleFullscreen = () => {
    if (!canvasContainerRef.current) return;
    if (!document.fullscreenElement) {
      canvasContainerRef.current.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const handleCopyLogs = () => {
    const lines = (daemonLogs.length > 0 ? daemonLogs : externalLogs).map((l: any) =>
      typeof l === 'string' ? l : l.message || JSON.stringify(l)
    );
    universalCopy(lines.join('\n'));
    setCopiedLogs(true);
    setTimeout(() => setCopiedLogs(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 z-50 animate-in fade-in duration-150">
      <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl w-full max-w-6xl h-[92vh] shadow-2xl flex flex-col overflow-hidden text-[var(--text-primary)]">
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

            <EngineLogo softwareType="desktop" size={18} API={API} />

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
                <span className="text-[10px] font-mono font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 px-2 py-0.5 rounded">
                  Display :{displayNum} • {resolution}
                </span>
              </div>

              <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)] font-mono mt-0.5">
                <span>PID: <strong className="text-[var(--text-primary)]">{currentProcess.pid || 'OFFLINE'}</strong></span>
                <span>•</span>
                <span>Uptime: <strong className="text-[var(--text-primary)]">{formatUptime(currentProcess.last_start, isRunning)}</strong></span>
                <span>•</span>
                <span>VNC: <strong className="text-cyan-400">127.0.0.1:{vncPort}</strong></span>
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
              title={t('common.close', 'Close')}
            >
              ✕
            </button>
          </div>
        </div>

        {/* View Selection Tabs */}
        <div className="px-4 py-2 border-b border-[var(--glass-border)] flex items-center justify-between shrink-0 bg-black/10">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('screen')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'screen'
                  ? 'bg-brand-lime text-black shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-white/5'
              }`}
            >
              <span>🖥️</span>
              {t('desktop.tab_screen', 'Remote Display (noVNC)')}
            </button>

            <button
              onClick={() => setActiveTab('logs')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'logs'
                  ? 'bg-brand-lime text-black shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-white/5'
              }`}
            >
              <span>📄</span>
              {t('desktop.tab_logs', 'Service Logs')}
            </button>
          </div>

          {/* Tab specific action controls */}
          {activeTab === 'screen' && isRunning && (
            <div className="flex items-center gap-2">
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded border font-bold ${
                  connectionStatus === 'connected'
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                    : connectionStatus === 'connecting'
                    ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30 animate-pulse'
                    : 'bg-red-500/20 text-red-400 border-red-500/30'
                }`}
              >
                {connectionStatus === 'connected'
                  ? '🟢 CONNECTED'
                  : connectionStatus === 'connecting'
                  ? '🟡 CONNECTING...'
                  : '🔴 DISCONNECTED'}
              </span>

              <button
                onClick={() => setScaleViewport(!scaleViewport)}
                className={`px-2 py-1 rounded text-xs border font-mono transition-all cursor-pointer ${
                  scaleViewport
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
                    : 'bg-white/5 text-[var(--text-secondary)] border-[var(--glass-border)]'
                }`}
                title={scaleViewport ? 'Fit to window active' : '1:1 Original scale'}
              >
                {scaleViewport ? 'Fit Screen' : '1:1 Scale'}
              </button>

              <button
                onClick={handleReconnect}
                className="px-2 py-1 rounded text-xs bg-white/5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--glass-border)] flex items-center gap-1 transition-all cursor-pointer"
                title="Reconnect WebSocket"
              >
                <RefreshIcon size={12} />
                Reconnect
              </button>

              <button
                onClick={toggleFullscreen}
                className="px-2 py-1 rounded text-xs bg-white/5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--glass-border)] transition-all cursor-pointer"
                title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? '⛶ Exit' : '⛶ Fullscreen'}
              </button>
            </div>
          )}

          {activeTab === 'logs' && (
            <button
              onClick={handleCopyLogs}
              className="text-xs bg-white/5 hover:bg-white/10 text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--glass-border)] px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer"
            >
              {copiedLogs ? <CheckIcon size={12} className="text-brand-lime" /> : <ClipboardIcon size={12} />}
              {copiedLogs ? t('common.copied', 'Copied!') : t('common.copy_logs', 'Copy Logs')}
            </button>
          )}
        </div>

        {/* Content Viewport */}
        <div className="flex-1 min-h-0 bg-black relative flex items-center justify-center overflow-hidden">
          {activeTab === 'screen' ? (
            isRunning ? (
              <div
                ref={canvasContainerRef}
                className="w-full h-full flex items-center justify-center overflow-hidden relative cursor-default [&_canvas]:!cursor-default"
                tabIndex={0}
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
                <span className="text-4xl">🖥️</span>
                <h3 className="text-base font-bold text-[var(--text-primary)]">
                  {t('desktop.service_stopped_title', 'Virtual Desktop is Stopped')}
                </h3>
                <p className="text-xs text-[var(--text-secondary)] max-w-md">
                  {t('desktop.service_stopped_desc', 'Start the virtual desktop service to initialize the Xvfb X11 screen and connect via interactive HTML5 VNC.')}
                </p>
                <button
                  onClick={() => onStartService(selectedProcess.id)}
                  disabled={!!actionPending[selectedProcess.id]}
                  className="mt-2 px-5 py-2 rounded-xl text-xs font-bold bg-brand-lime text-black hover:opacity-90 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <PlayIcon size={14} />
                  {t('common.start_service', 'Start Virtual Desktop')}
                </button>
              </div>
            )
          ) : (
            <div
              ref={logsContainerRef}
              className="w-full h-full p-4 font-mono text-xs text-[var(--text-secondary)] overflow-y-auto bg-black/90 space-y-1 select-text"
            >
              {(daemonLogs.length > 0 ? daemonLogs : externalLogs).length === 0 ? (
                <p className="text-zinc-600 italic">{t('common.no_logs', 'No logs recorded yet.')}</p>
              ) : (
                (daemonLogs.length > 0 ? daemonLogs : externalLogs).map((line: any, idx: number) => {
                  const msg = typeof line === 'string' ? line : line.message || JSON.stringify(line);
                  return (
                    <div key={idx} className="whitespace-pre-wrap leading-relaxed hover:text-[var(--text-primary)]">
                      {msg}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
