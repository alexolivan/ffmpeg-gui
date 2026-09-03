import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { EngineLogo } from '../common/EngineLogo';
import {
  ClipboardIcon,
  CheckIcon,
  PlayIcon,
  StopIcon,
  RefreshIcon,
  PencilIcon,
} from '../Icons';

interface IcecastPreviewModalProps {
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

export const IcecastPreviewModal: React.FC<IcecastPreviewModalProps> = ({
  selectedProcess,
  telemetry,
  actionPending,
  logs: externalLogs,
  onClose,
  onEditProcess,
  onStartService,
  onStopService,
  onRestartService,
  API,
}) => {
  const { t } = useTranslation();
  const logsContainerRef = useRef<HTMLDivElement | null>(null);

  const currentProcess = telemetry.find((p) => p.id === selectedProcess.id) || selectedProcess;
  const isRunning = currentProcess.status === 'running';
  const isPending = !!actionPending[currentProcess.id];

  const [daemonLogs, setDaemonLogs] = useState<any[]>([]);
  const [copyLogsSuccess, setCopyLogsSuccess] = useState(false);
  const [copiedUrlKey, setCopiedUrlKey] = useState<string | null>(null);
  const [liveStats, setLiveStats] = useState<any>(null);

  const iceCfg = currentProcess.config?.icecast_config || currentProcess.icecast_config || {};
  const httpPort = iceCfg.port || 7000;
  const sslPort = iceCfg.ssl_port || 7443;
  const sslEnabled = iceCfg.ssl_enabled === true;
  const httpEnabled = iceCfg.http_enabled !== false;

  const configuredMounts: any[] = Array.isArray(iceCfg.mounts) ? iceCfg.mounts : [];

  // Host resolver
  const host = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : '127.0.0.1';
  const webConsoleUrl = sslEnabled ? `https://${host}:${sslPort}/admin/` : `http://${host}:${httpPort}/admin/`;
  const webStatusUrl = sslEnabled ? `https://${host}:${sslPort}/status.xsl` : `http://${host}:${httpPort}/status.xsl`;

  // Poll live Icecast JSON status
  useEffect(() => {
    if (!isRunning) return;

    const fetchStatus = async () => {
      try {
        const res = await fetch(`${API}/processes/${currentProcess.id}/icecast-status`);
        if (res.ok) {
          const data = await res.json();
          setLiveStats(data);
        }
      } catch {
        // Fallback gracefully to cached configuration
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [isRunning, currentProcess.id, API]);

  // Poll server daemon logs (stdout / stderr / error.log)
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
      } catch {
        // Silent catch
      }
    };

    fetchLogs();
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, [currentProcess.id, API]);

  const activeLogs = daemonLogs.length > 0 ? daemonLogs : externalLogs;

  // Auto-scroll logs
  useEffect(() => {
    if (logsContainerRef.current && isRunning) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [activeLogs, isRunning]);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Merge live sources with configured mounts
  const mergedMountpoints = useMemo(() => {
    const icestats = liveStats?.icestats || currentProcess.config?.icecast_stats || {};
    let rawSources = icestats.source || icestats.sources || [];
    if (!Array.isArray(rawSources)) {
      rawSources = rawSources ? [rawSources] : [];
    }

    const map = new Map<string, any>();

    // Add static configured mounts first
    configuredMounts.forEach((m: any) => {
      let mName = m.mount_name || m.mount || '';
      if (mName && !mName.startsWith('/')) mName = '/' + mName;
      if (mName) {
        map.set(mName, {
          mount_name: mName,
          max_listeners: m.max_listeners,
          fallback_mount: m.fallback_mount,
          burst_size: m.burst_size,
          listeners: 0,
          peak: 0,
          bitrate: undefined,
          server_type: undefined,
          title: undefined,
          isActive: false,
        });
      }
    });

    // Merge active sources from Icecast
    rawSources.forEach((s: any) => {
      let listenUrl = s.listenurl || s.mount || '';
      let mName = listenUrl.includes(`:${httpPort}`) ? listenUrl.split(`:${httpPort}`)[1] : listenUrl;
      if (mName && !mName.startsWith('/')) mName = '/' + mName;
      if (!mName) mName = '/stream';

      const existing = map.get(mName) || { mount_name: mName };
      map.set(mName, {
        ...existing,
        mount_name: mName,
        listeners: s.listeners ?? 0,
        peak: s.listener_peak ?? s.peak ?? 0,
        bitrate: s.bitrate,
        server_type: s.server_type,
        title: s.title || s.server_name || '',
        genre: s.genre,
        stream_start: s.stream_start,
        isActive: true,
      });
    });

    return Array.from(map.values());
  }, [liveStats, currentProcess.config?.icecast_stats, configuredMounts, httpPort]);

  const globalListeners = useMemo(() => {
    const icestats = liveStats?.icestats || currentProcess.config?.icecast_stats || {};
    if (icestats.listeners !== undefined) return Number(icestats.listeners);
    return mergedMountpoints.reduce((acc, m) => acc + (m.listeners || 0), 0);
  }, [liveStats, currentProcess.config?.icecast_stats, mergedMountpoints]);

  const globalPeak = useMemo(() => {
    const icestats = liveStats?.icestats || currentProcess.config?.icecast_stats || {};
    if (icestats.listener_peak !== undefined) return Number(icestats.listener_peak);
    return mergedMountpoints.reduce((acc, m) => Math.max(acc, m.peak || 0), 0);
  }, [liveStats, currentProcess.config?.icecast_stats, mergedMountpoints]);

  const activeSourcesCount = mergedMountpoints.filter((m) => m.isActive).length;

  const handleCopyLogs = () => {
    const text = activeLogs
      .map((l) => (typeof l === 'string' ? l : `[${l.timestamp || ''}] ${l.message || ''}`))
      .join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopyLogsSuccess(true);
      setTimeout(() => setCopyLogsSuccess(false), 2000);
    });
  };

  const handleCopyStreamUrl = (key: string, url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedUrlKey(key);
      setTimeout(() => setCopiedUrlKey(null), 2000);
    });
  };

  const cpu = currentProcess.cpu_usage ?? currentProcess.cpu ?? 0;
  const ram = currentProcess.ram_usage ?? currentProcess.ram ?? 0;
  const pid = currentProcess.pid;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div
        className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-[var(--glass-border)] flex justify-between items-center flex-shrink-0 bg-white/2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] flex items-center justify-center p-1.5 shrink-0">
              <EngineLogo softwareType="icecast2" size={26} API={API} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg sm:text-xl font-black uppercase tracking-tight text-[var(--text-primary)]">
                  {currentProcess.alias || currentProcess.name}
                </h3>
                {currentProcess.alias && (
                  <span className="text-xs font-mono text-[var(--text-secondary)] opacity-80">
                    [{currentProcess.name}]
                  </span>
                )}
                <span className="text-[9px] uppercase font-mono px-2 py-0.5 rounded border font-bold bg-cyan-500/10 text-cyan-400 border-cyan-500/30">
                  Icecast2 Server
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${
                    isRunning
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : currentProcess.status === 'error'
                      ? 'bg-red-500/10 text-red-400 border-red-500/30'
                      : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-400'
                    }`}
                  />
                  {currentProcess.status}
                </span>
              </div>
              <p className="text-[var(--text-secondary)] text-xs flex items-center gap-2 mt-0.5">
                <span>{t('services.icecast.preview.title', 'Servidor de Audio Icecast2')}</span>
                <span className="text-[var(--glass-border)]">•</span>
                <span>PID: <strong className="font-mono text-[var(--text-primary)]">{pid || 'OFFLINE'}</strong></span>
                <span className="text-[var(--glass-border)]">•</span>
                <span>Uptime: <strong className="text-[var(--text-primary)]">{formatUptime(currentProcess.last_start, isRunning)}</strong></span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Action Buttons in Header */}
            {isRunning ? (
              <>
                <button
                  disabled={isPending}
                  onClick={() => onRestartService(currentProcess.id, currentProcess.name)}
                  className="px-2.5 py-1.5 rounded-lg border border-[var(--glass-border)] bg-[var(--input-bg)] text-cyan-400 hover:brightness-110 text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer"
                  title={t('services.restartService', 'Reiniciar')}
                >
                  <RefreshIcon size={13} className={actionPending[currentProcess.id] === 'restarting' ? 'animate-spin' : ''} />
                  <span className="hidden sm:inline">{t('common.restart', 'Reiniciar')}</span>
                </button>
                <button
                  disabled={isPending}
                  onClick={() => onStopService(currentProcess.id, currentProcess.name)}
                  className="px-2.5 py-1.5 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer"
                  title={t('services.stopService', 'Detener')}
                >
                  <StopIcon size={13} />
                  <span className="hidden sm:inline">{t('common.stop', 'Detener')}</span>
                </button>
              </>
            ) : (
              <button
                disabled={isPending}
                onClick={() => onStartService(currentProcess.id)}
                className="px-3 py-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer"
                title={t('services.startService', 'Iniciar')}
              >
                <PlayIcon size={13} />
                <span className="hidden sm:inline">{t('common.start', 'Iniciar')}</span>
              </button>
            )}

            <button
              onClick={() => {
                onClose();
                onEditProcess(currentProcess);
              }}
              className="p-1.5 rounded-lg border border-[var(--glass-border)] bg-[var(--input-bg)] text-[var(--text-secondary)] hover:text-brand-lime transition-all cursor-pointer"
              title={t('common.edit', 'Editar Configuración')}
            >
              <PencilIcon size={15} />
            </button>

            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-[var(--text-secondary)] hover:text-white transition-colors cursor-pointer text-xs ml-1"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 min-h-0 custom-scrollbar">
          {/* Top Section: 2 Columns (Left: Stats & Actions, Right: Aspect-Video GUI Preview) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
            {/* Col 1: Telemetry & Actions */}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 text-center">
                  <div className="text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-0.5">
                    {t('services.icecast.preview.listeners', 'Oyentes Conectados')}
                  </div>
                  <div className="text-base font-mono font-bold text-cyan-400">
                    🎧 {globalListeners}
                  </div>
                </div>

                <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 text-center">
                  <div className="text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-0.5">
                    {t('services.icecast.peak', 'Pico de Oyentes')}
                  </div>
                  <div className="text-base font-mono font-bold text-amber-400">
                    {globalPeak}
                  </div>
                </div>

                <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 text-center">
                  <div className="text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-0.5">
                    {t('services.icecast.sourcesLimit', 'Fuentes Activas')}
                  </div>
                  <div className="text-base font-mono font-bold text-purple-400">
                    📻 {activeSourcesCount} / {mergedMountpoints.length}
                  </div>
                </div>

                <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 text-center">
                  <div className="text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-0.5">
                    HTTP / HTTPS
                  </div>
                  <div className="text-xs font-mono font-bold text-[var(--text-primary)]">
                    {httpEnabled ? `:${httpPort}` : ''} {sslEnabled ? `(:${sslPort})` : ''}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 flex justify-between items-center">
                  <span className="text-[9px] uppercase font-black text-[var(--text-secondary)]">CPU Usage</span>
                  <span className={`font-mono font-bold text-xs ${cpu > 75 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {isRunning ? `${cpu}%` : '-'}
                  </span>
                </div>
                <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 flex justify-between items-center">
                  <span className="text-[9px] uppercase font-black text-[var(--text-secondary)]">RAM Usage</span>
                  <span className="font-mono font-bold text-blue-400 text-xs">
                    {isRunning ? `${ram} MB` : '-'}
                  </span>
                </div>
              </div>

              {/* Navigation buttons: Status Page & Admin Console */}
              {isRunning && (
                <div className="flex items-center gap-2.5 pt-1">
                  <a
                    href={webStatusUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 px-3 py-2 rounded-xl border border-[var(--glass-border)] bg-[var(--input-bg)] hover:bg-[var(--bg-card)] text-[var(--text-primary)] hover:border-cyan-400 text-xs font-semibold flex items-center justify-center gap-2 transition-all shadow-sm group cursor-pointer"
                    title={t('services.icecast.preview.statusPage', 'Página de Estado')}
                  >
                    <span className="text-cyan-400">📊</span>
                    <span>{t('services.icecast.preview.statusPage', 'Página de Estado')}</span>
                    <span className="text-[10px] text-[var(--text-secondary)] opacity-60 group-hover:opacity-100">↗</span>
                  </a>

                  <a
                    href={webConsoleUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 px-3 py-2 rounded-xl border border-[var(--glass-border)] bg-[var(--input-bg)] hover:bg-[var(--bg-card)] text-[var(--text-primary)] hover:border-brand-lime text-xs font-semibold flex items-center justify-center gap-2 transition-all shadow-sm group cursor-pointer"
                    title={t('services.icecast.preview.adminPage', 'Consola de Administración')}
                  >
                    <span className="text-brand-lime">⚙️</span>
                    <span>{t('services.icecast.preview.adminPage', 'Consola de Administración')}</span>
                    <span className="text-[10px] text-[var(--text-secondary)] opacity-60 group-hover:opacity-100">↗</span>
                  </a>
                </div>
              )}
            </div>

            {/* Col 2: Live Web Preview in aspect-video box (exact same dimension as FFmpeg video preview) */}
            <div className="flex flex-col justify-center">
              <div className="aspect-video bg-black rounded-xl overflow-hidden border border-[var(--glass-border)] flex items-center justify-center relative shadow-2xl">
                {isRunning ? (
                  <>
                    <iframe
                      src={webStatusUrl}
                      title="Icecast Web Status"
                      className="w-full h-full border-0 bg-white"
                      sandbox="allow-same-origin allow-scripts allow-forms"
                    />
                    <div className="absolute top-2.5 left-2.5 px-2 py-0.5 bg-brand-lime text-black text-[8px] font-black rounded tracking-wider uppercase animate-pulse shadow">
                      LIVE
                    </div>
                  </>
                ) : (
                  <div className="text-center p-4 text-xs text-[var(--text-secondary)]">
                    <span className="block text-2xl mb-1">📻</span>
                    <span>{t('common.offline', 'Servidor detenido')}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Section 2: Extended Per-Mountpoint Telemetry & Live Audio Player */}
          <div className="bg-[var(--input-bg)]/35 border border-[var(--glass-border)] rounded-xl p-3.5 space-y-3">
            <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-purple-400" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-purple-400">
                  {t('services.icecast.preview.perMountTitle', 'Telemetría Extendida por Punto de Montaje y Reproductor')}
                </h4>
              </div>
              <span className="text-[11px] font-mono text-[var(--text-secondary)]">
                {mergedMountpoints.length} {t('services.icecast.mountsBadge', 'Montajes')}
              </span>
            </div>

            {mergedMountpoints.length === 0 ? (
              <div className="text-center py-6 border border-dashed border-[var(--glass-border)] rounded-lg text-xs text-[var(--text-secondary)]">
                {t('services.icecast.preview.noMountsRunning', 'No hay canales emisores activos conectados todavía. Los emisores pueden transmitir usando la contraseña de source.')}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--glass-border)] text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-semibold">
                      <th className="py-2 px-2.5">{t('services.icecast.preview.mount', 'Punto de Montaje')}</th>
                      <th className="py-2 px-2.5">{t('services.icecast.preview.listeners', 'Oyentes')}</th>
                      <th className="py-2 px-2.5">{t('services.icecast.preview.format', 'Formato / Bitrate')}</th>
                      <th className="py-2 px-2.5">{t('services.icecast.preview.titleCol', 'Título / Metadatos')}</th>
                      <th className="py-2 px-2.5">{t('services.icecast.preview.listenLive', 'Reproductor en Vivo')}</th>
                      <th className="py-2 px-2.5 text-right">{t('common.actions', 'URL')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--glass-border)] text-xs">
                    {mergedMountpoints.map((m: any, idx: number) => {
                      const mountPath = m.mount_name || '';
                      const streamUrl = `${sslEnabled ? 'https' : 'http'}://${host}:${sslEnabled ? sslPort : httpPort}${mountPath}`;
                      const isSourceLive = m.isActive;

                      return (
                        <tr key={idx} className="hover:bg-[var(--bg-card)]/40 transition-colors">
                          <td className="py-2.5 px-2.5">
                            <div className="flex items-center gap-2">
                              <span
                                className={`w-2 h-2 rounded-full ${
                                  isSourceLive ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'
                                }`}
                                title={isSourceLive ? 'Live Source Broadcasting' : 'Configured / Idle'}
                              />
                              <div>
                                <span className="font-mono font-bold text-cyan-400 block">
                                  {mountPath}
                                </span>
                                {m.fallback_mount && (
                                  <span className="text-[10px] text-amber-300/80 block">
                                    ↳ Fallback: {m.fallback_mount}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>

                          <td className="py-2.5 px-2.5 font-mono">
                            <span className="text-cyan-300 font-bold">{m.listeners || 0}</span>
                            <span className="text-[10px] text-[var(--text-secondary)] ml-1">
                              (Pico: {m.peak || 0}{m.max_listeners ? `, Max: ${m.max_listeners}` : ''})
                            </span>
                          </td>

                          <td className="py-2.5 px-2.5 font-mono text-[11px] text-[var(--text-secondary)]">
                            {m.bitrate ? (
                              <span className="px-1.5 py-0.5 rounded bg-[var(--input-bg)] border border-[var(--glass-border)] text-[var(--text-primary)]">
                                {m.bitrate} kbps
                              </span>
                            ) : (
                              m.server_type || '-'
                            )}
                          </td>

                          <td className="py-2.5 px-2.5 max-w-xs truncate text-[var(--text-primary)]">
                            {m.title ? (
                              <span title={m.title} className="font-medium text-amber-300/90">
                                🎵 {m.title}
                              </span>
                            ) : (
                              <span className="text-[var(--text-secondary)]">-</span>
                            )}
                          </td>

                          <td className="py-2.5 px-2.5">
                            {isRunning && isSourceLive ? (
                              <audio
                                controls
                                preload="none"
                                src={streamUrl}
                                className="h-7 w-48 rounded"
                              />
                            ) : (
                              <span className="text-[10px] text-[var(--text-secondary)] italic">
                                {isRunning ? 'Esperando conexión de audio...' : 'Servidor detenido'}
                              </span>
                            )}
                          </td>

                          <td className="py-2.5 px-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => handleCopyStreamUrl(mountPath, streamUrl)}
                              className="px-2.5 py-1 rounded bg-[var(--input-bg)] hover:bg-[var(--bg-card)] border border-[var(--glass-border)] text-cyan-400 hover:text-white text-[10px] font-mono font-bold flex items-center gap-1.5 ml-auto transition-colors cursor-pointer"
                              title={streamUrl}
                            >
                              {copiedUrlKey === mountPath ? (
                                <>
                                  <CheckIcon size={12} className="text-emerald-400" />
                                  <span className="text-emerald-400">{t('services.icecast.preview.copied', '¡Copiado!')}</span>
                                </>
                              ) : (
                                <>
                                  <ClipboardIcon size={12} />
                                  <span>{t('services.icecast.preview.copyUrl', 'Copiar URL')}</span>
                                </>
                              )}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Section 3: Server Logs Viewer (Stdout / Stderr / Error Log) */}
          <div className="bg-[var(--input-bg)]/35 border border-[var(--glass-border)] rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-orange-400" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-orange-400">
                  {t('services.icecast.preview.logsTitle', 'Registros del Servidor (Stdout / Error Log)')}
                </h4>
              </div>

              <button
                type="button"
                onClick={handleCopyLogs}
                disabled={activeLogs.length === 0}
                className="px-2.5 py-1 bg-[var(--input-bg)] hover:bg-[var(--bg-card)] border border-[var(--glass-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-40 cursor-pointer"
              >
                {copyLogsSuccess ? (
                  <>
                    <CheckIcon size={13} className="text-emerald-400" />
                    <span className="text-emerald-400">{t('services.icecast.preview.copied', '¡Copiado!')}</span>
                  </>
                ) : (
                  <>
                    <ClipboardIcon size={13} />
                    <span>{t('common.copyLogs', 'Copiar Logs')}</span>
                  </>
                )}
              </button>
            </div>

            <div
              ref={logsContainerRef}
              className="bg-black/90 font-mono text-xs text-zinc-300 p-3 rounded-lg h-44 sm:h-56 overflow-y-auto space-y-1 custom-scrollbar border border-black/40 shadow-inner select-text"
            >
              {activeLogs.length === 0 ? (
                <div className="text-zinc-600 italic text-center py-8">
                  {isRunning ? 'Esperando líneas de log del servidor Icecast...' : 'No hay registros disponibles.'}
                </div>
              ) : (
                activeLogs.map((log: any, idx: number) => {
                  const msg = typeof log === 'string' ? log : log.message || '';
                  const ts = typeof log === 'object' && log.timestamp ? log.timestamp.split('T')[1]?.replace('Z', '') : null;
                  const isErr = typeof log === 'object' ? log.level === 'ERROR' : /error|failed|fatal|warn/i.test(msg);

                  return (
                    <div key={idx} className={`leading-relaxed break-all flex items-start gap-2 ${isErr ? 'text-red-400' : 'text-zinc-300'}`}>
                      {ts && <span className="text-zinc-500 shrink-0 text-[10px] select-none">[{ts}]</span>}
                      <span>{msg}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
