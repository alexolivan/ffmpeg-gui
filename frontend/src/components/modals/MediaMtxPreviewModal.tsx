import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { EngineLogo } from '../common/EngineLogo';
import { ClipboardIcon, CheckIcon, ShieldIcon } from '../Icons';

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
  const { t } = useTranslation();
  const processLogsContainerRef = useRef<HTMLDivElement | null>(null);

  const currentProcess = telemetry.find((p) => p.id === selectedProcess.id) || selectedProcess;
  const isRunning = currentProcess.status === 'running';

  const [daemonLogs, setDaemonLogs] = useState<any[]>([]);
  const [copySuccess, setCopySuccess] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [liveApiPaths, setLiveApiPaths] = useState<string[]>([]);

  const mtxCfg = currentProcess.config?.mediamtx_config || currentProcess.config || {};

  // Extract configured paths
  const configuredPaths: { path_id: string; [key: string]: any }[] = useMemo(() => {
    const raw = mtxCfg.paths;
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw
        .filter((p: any) => {
          const id = p?.path_id || p?.name || p?.path;
          return id && id !== 'all_others';
        })
        .map((p: any) => ({
          path_id: p.path_id || p.name || p.path,
          ...p,
        }));
    }
    if (typeof raw === 'object') {
      return Object.entries(raw)
        .filter(([k]) => k !== 'all_others')
        .map(([path_id, val]: [string, any]) => ({
          path_id,
          ...(typeof val === 'object' ? val : {}),
        }));
    }
    return [];
  }, [mtxCfg.paths]);

  // Initial active path selection
  const initialDefaultPath = configuredPaths.length > 0 ? configuredPaths[0].path_id : 'live';
  const [selectedPathSlug, setSelectedPathSlug] = useState<string>(initialDefaultPath);
  const [isCustomPathSelected, setIsCustomPathSelected] = useState<boolean>(false);
  const [customPathInput, setCustomPathInput] = useState<string>('');

  const activePathSlug = useMemo(() => {
    if (isCustomPathSelected) {
      return customPathInput.trim() || 'live';
    }
    return selectedPathSlug || 'live';
  }, [isCustomPathSelected, customPathInput, selectedPathSlug]);

  // Determine active path credentials and mode
  const activePathDetails = useMemo(() => {
    const globalSec = mtxCfg.security || {};
    const globalPubUser = globalSec.publish_user ?? globalSec.publishUser ?? mtxCfg.publish_user ?? '';
    const globalPubPass = globalSec.publish_pass ?? globalSec.publishPass ?? mtxCfg.publish_pass ?? '';
    const globalReadUser = globalSec.read_user ?? globalSec.readUser ?? mtxCfg.read_user ?? '';
    const globalReadPass = globalSec.read_pass ?? globalSec.readPass ?? mtxCfg.read_pass ?? '';

    const matchedConfig = configuredPaths.find((p) => p.path_id === activePathSlug);

    if (matchedConfig) {
      const mode = matchedConfig.mode || 'inherit';
      if (mode === 'open') {
        return {
          mode: 'open',
          isConfigured: true,
          pubUser: '',
          pubPass: '',
          readUser: '',
          readPass: '',
        };
      }
      if (mode === 'custom') {
        return {
          mode: 'custom',
          isConfigured: true,
          pubUser: matchedConfig.publish_user || '',
          pubPass: matchedConfig.publish_pass || '',
          readUser: matchedConfig.read_user || '',
          readPass: matchedConfig.read_pass || '',
        };
      }
    }

    return {
      mode: 'inherit',
      isConfigured: Boolean(matchedConfig),
      pubUser: globalPubUser,
      pubPass: globalPubPass,
      readUser: globalReadUser,
      readPass: globalReadPass,
    };
  }, [configuredPaths, activePathSlug, mtxCfg]);

  // Host resolver
  const host = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : 'localhost';
  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const webScheme = mtxCfg.ssl_enabled || isHttps ? 'https' : 'http';

  // Discover live active paths via MediaMTX REST API if running
  useEffect(() => {
    if (!isRunning || mtxCfg.api_enabled === false) return;
    const apiPort = mtxCfg.api_port || 9997;

    const fetchLivePaths = async () => {
      try {
        const res = await fetch(`http://${host}:${apiPort}/v3/paths/list`, {
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.items)) {
            const names = data.items.map((i: any) => i.name).filter(Boolean);
            setLiveApiPaths(names);
          }
        }
      } catch {
        // Silent catch: browser network/CORS or stopped daemon
      }
    };

    fetchLivePaths();
    const interval = setInterval(fetchLivePaths, 5000);
    return () => clearInterval(interval);
  }, [isRunning, mtxCfg.api_enabled, mtxCfg.api_port, host]);

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
    const text = activeLogs
      .map((l) => (typeof l === 'string' ? l : `[${l.timestamp || ''}] ${l.message || ''}`))
      .join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    });
  };

  const copyToClipboard = (key: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((curr) => (curr === key ? null : curr));
      }, 2000);
    });
  };

  // Build generated URLs based on active path and credentials
  const { pubUser, pubPass, readUser, readPass } = activePathDetails;

  const pubAuthPrefix = pubUser ? `${encodeURIComponent(pubUser)}:${encodeURIComponent(pubPass)}@` : '';
  const readAuthPrefix = readUser ? `${encodeURIComponent(readUser)}:${encodeURIComponent(readPass)}@` : '';

  // RTMP / RTMPS
  const rtmpPort = mtxCfg.rtmp_port || 1935;
  const rtmpPushUrl = `rtmp://${pubAuthPrefix}${host}:${rtmpPort}/${activePathSlug}`;
  const rtmpPullUrl = `rtmp://${readAuthPrefix}${host}:${rtmpPort}/${activePathSlug}`;

  const rtmpsPort = mtxCfg.rtmps_port || 1936;
  const rtmpsPushUrl = `rtmps://${pubAuthPrefix}${host}:${rtmpsPort}/${activePathSlug}`;
  const rtmpsPullUrl = `rtmps://${readAuthPrefix}${host}:${rtmpsPort}/${activePathSlug}`;

  // RTSP / RTSPS
  const rtspPort = mtxCfg.rtsp_port || 8554;
  const rtspPushUrl = `rtsp://${pubAuthPrefix}${host}:${rtspPort}/${activePathSlug}`;
  const rtspPullUrl = `rtsp://${readAuthPrefix}${host}:${rtspPort}/${activePathSlug}`;

  const rtspsPort = mtxCfg.rtsps_port || 8322;
  const rtspsPushUrl = `rtsps://${pubAuthPrefix}${host}:${rtspsPort}/${activePathSlug}`;
  const rtspsPullUrl = `rtsps://${readAuthPrefix}${host}:${rtspsPort}/${activePathSlug}`;

  // SRT Caller Ingest & Playback
  const srtPort = mtxCfg.srt_port || 8890;
  const srtPubAuthSuffix = pubUser ? `,u=${pubUser},p=${pubPass}` : '';
  const srtReadAuthSuffix = readUser ? `,u=${readUser},p=${readPass}` : '';
  const srtIngestUrl = `srt://${host}:${srtPort}?streamid=#!::r=${activePathSlug},m=publish${srtPubAuthSuffix}`;
  const srtPlaybackUrl = `srt://${host}:${srtPort}?streamid=#!::r=${activePathSlug},m=request${srtReadAuthSuffix}`;

  // HLS Web URL
  const hlsPort = mtxCfg.hls_port || 8888;
  const hlsUrl = `${webScheme}://${readAuthPrefix}${host}:${hlsPort}/${activePathSlug}/index.m3u8`;

  // WebRTC WHEP & WHIP
  const webrtcPort = mtxCfg.webrtc_port || 8889;
  const webrtcWhepUrl = `${webScheme}://${readAuthPrefix}${host}:${webrtcPort}/${activePathSlug}/whep`;
  const webrtcWhipUrl = `${webScheme}://${pubAuthPrefix}${host}:${webrtcPort}/${activePathSlug}/whip`;

  const hasCredentialsOnActivePath = Boolean(pubUser || readUser);

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 md:p-8 z-50 cursor-pointer"
      onClick={onClose}
    >
      <div
        className="glass-card w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden relative border border-[var(--glass-border)] cursor-default text-[var(--text-primary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-[var(--glass-border)] flex justify-between items-center flex-shrink-0 bg-white/2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] flex items-center justify-center p-1.5 shrink-0 shadow-inner">
              <EngineLogo softwareType="mediamtx" size={26} API={API} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-black uppercase tracking-tight">{currentProcess.alias || currentProcess.name}</h3>
                <span className="text-[9px] uppercase font-mono px-2 py-0.5 rounded border font-bold bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                  MediaMTX Hub
                </span>
                {mtxCfg.ssl_enabled && (
                  <span className="text-[9px] uppercase font-mono px-2 py-0.5 rounded border font-bold bg-emerald-500/10 text-emerald-400 border-emerald-500/30 flex items-center gap-1">
                    <ShieldIcon size={10} /> TLS/SSL
                  </span>
                )}
              </div>
              <p className="text-[var(--text-secondary)] text-xs uppercase tracking-wider mt-0.5">
                {t('services.mediamtx.previewModal.subtitle', 'Daemon Process Monitor & Real-Time Audit Logs')}
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
                <span className="font-bold block uppercase tracking-wider mb-0.5">
                  {t('services.mediamtx.previewModal.pendingRebootTitle', 'Configuration Pending Reboot')}
                </span>
                {t(
                  'services.mediamtx.previewModal.pendingRebootDesc',
                  'This service has modified configurations that are not yet active in the running instance. Restart the service to apply these changes.'
                )}
              </div>
            </div>
          )}

          {/* Telemetry Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 text-center">
              <div className="text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-0.5">{t('common.status', 'Status')}</div>
              <div
                className={`font-black text-xs tracking-tight ${
                  isRunning ? 'text-brand-lime' : currentProcess.status === 'error' ? 'text-red-400' : 'text-zinc-500'
                }`}
              >
                {currentProcess.status ? currentProcess.status.toUpperCase() : t('common.offline', 'OFFLINE')}
              </div>
            </div>

            <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 text-center">
              <div className="text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-0.5">PID</div>
              <div className="font-bold font-mono text-xs text-[var(--text-primary)]">
                {isRunning && currentProcess.pid ? currentProcess.pid : t('common.offline', 'OFFLINE')}
              </div>
            </div>

            <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 text-center">
              <div className="text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-0.5">{t('common.uptime', 'Uptime')}</div>
              <div className="font-bold font-mono text-xs text-[var(--text-primary)]">
                {formatUptime(currentProcess.last_start, isRunning)}
              </div>
            </div>

            <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 text-center">
              <div className="text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-0.5">{t('dashboard.cpuUsage', 'CPU Usage')}</div>
              <div className="font-bold font-mono text-xs text-brand-lime">{isRunning ? `${currentProcess.cpu || 0}%` : '-'}</div>
            </div>

            <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 text-center col-span-2 sm:col-span-1">
              <div className="text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-0.5">{t('dashboard.ramUsage', 'RAM Usage')}</div>
              <div className="font-bold font-mono text-xs text-brand-orange">{isRunning ? `${currentProcess.ram || 0} MB` : '-'}</div>
            </div>
          </div>

          {/* Protocol Listeners Status Grid */}
          <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-brand-lime flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-brand-lime animate-pulse" />
                {t('services.mediamtx.previewModal.listenersTitle', 'Active Protocol Listeners & Hub Ports')}
              </span>
              <span className="text-[9px] text-[var(--text-secondary)]">
                {t('services.mediamtx.previewModal.zeroLoss', 'Zero-Loss Multiplexing')}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
              <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-center">
                <span className="text-[9px] font-bold text-[var(--text-secondary)] uppercase block">RTMP</span>
                <span className="text-xs font-mono font-bold text-amber-400">
                  {mtxCfg.rtmp_enabled !== false ? `:${mtxCfg.rtmp_port || 1935}` : 'OFF'}
                </span>
              </div>

              {mtxCfg.ssl_enabled && mtxCfg.rtmps_enabled && (
                <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-center">
                  <span className="text-[9px] font-bold text-emerald-400 uppercase block flex items-center justify-center gap-0.5">
                    <ShieldIcon size={10} /> RTMPS
                  </span>
                  <span className="text-xs font-mono font-bold text-emerald-400">
                    :{mtxCfg.rtmps_port || 1936}
                  </span>
                </div>
              )}

              <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-center">
                <span className="text-[9px] font-bold text-[var(--text-secondary)] uppercase block">RTSP</span>
                <span className="text-xs font-mono font-bold text-cyan-400">
                  {mtxCfg.rtsp_enabled !== false ? `:${mtxCfg.rtsp_port || 8554}` : 'OFF'}
                </span>
              </div>

              {mtxCfg.ssl_enabled && mtxCfg.rtsps_enabled && (
                <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-center">
                  <span className="text-[9px] font-bold text-emerald-400 uppercase block flex items-center justify-center gap-0.5">
                    <ShieldIcon size={10} /> RTSPS
                  </span>
                  <span className="text-xs font-mono font-bold text-emerald-400">
                    :{mtxCfg.rtsps_port || 8322}
                  </span>
                </div>
              )}

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

          {/* STREAM CONNECTION MATRIX & URL GENERATOR */}
          <div className="bg-[var(--bg-card)] border border-brand-lime/30 rounded-xl p-4 space-y-4 shadow-lg">
            {/* Matrix Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--glass-border)] pb-3">
              <div>
                <h4 className="text-sm font-black uppercase tracking-wider text-brand-lime flex items-center gap-2">
                  <span>⚡</span>
                  {t('services.mediamtx.connectionMatrix.title', 'STREAM CONNECTION MATRIX & URLS')}
                </h4>
                <p className="text-[var(--text-secondary)] text-xs mt-0.5">
                  {t(
                    'services.mediamtx.connectionMatrix.subtitle',
                    'Live Connection Endpoints, Ingest Strings & Playback URLs'
                  )}
                </p>
              </div>

              {/* Security & Access Mode Badge */}
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)]">
                  {t('services.mediamtx.connectionMatrix.accessMode', 'Access Mode')}:
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold border flex items-center gap-1 ${
                    activePathDetails.mode === 'open'
                      ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                      : activePathDetails.mode === 'custom'
                      ? 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                      : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                  }`}
                >
                  {hasCredentialsOnActivePath && <ShieldIcon size={10} />}
                  {activePathDetails.mode === 'open'
                    ? t('services.mediamtx.connectionMatrix.modeOpen', 'Open (No Auth)')
                    : activePathDetails.mode === 'custom'
                    ? t('services.mediamtx.connectionMatrix.modeCustom', 'Custom Credentials')
                    : t('services.mediamtx.connectionMatrix.modeInherit', 'Inherited Security')}
                </span>
              </div>
            </div>

            {/* Path Selector Bar */}
            <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 space-y-2.5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
                  <span>📌</span>
                  {t('services.mediamtx.connectionMatrix.selectPath', 'Target Stream Path')}:
                </span>
                <span className="text-[10px] text-[var(--text-secondary)] font-mono">
                  {hasCredentialsOnActivePath
                    ? t('services.mediamtx.connectionMatrix.credentialsActive', 'Credentials applied to generated connection strings')
                    : t('services.mediamtx.connectionMatrix.noCredentials', 'No credentials required (Open access)')}
                </span>
              </div>

              {/* Path Pills & Custom Input */}
              <div className="flex items-center gap-2 flex-wrap">
                {/* Configured Paths */}
                {configuredPaths.map((p) => {
                  const isSelected = !isCustomPathSelected && selectedPathSlug === p.path_id;
                  return (
                    <button
                      key={p.path_id}
                      type="button"
                      onClick={() => {
                        setIsCustomPathSelected(false);
                        setSelectedPathSlug(p.path_id);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all border flex items-center gap-1.5 cursor-pointer ${
                        isSelected
                          ? 'bg-brand-lime/20 text-brand-lime border-brand-lime/50 shadow-md shadow-brand-lime/10 scale-105'
                          : 'bg-white/5 hover:bg-white/10 text-[var(--text-primary)] border-[var(--glass-border)]'
                      }`}
                    >
                      <span>/{p.path_id}</span>
                      <span className="text-[9px] px-1 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-sans uppercase">
                        {t('services.mediamtx.connectionMatrix.configuredPathBadge', 'CONFIGURED')}
                      </span>
                    </button>
                  );
                })}

                {/* Discovered Live Paths from API (not in configured paths) */}
                {liveApiPaths
                  .filter((lp) => !configuredPaths.some((cp) => cp.path_id === lp))
                  .map((lp) => {
                    const isSelected = !isCustomPathSelected && selectedPathSlug === lp;
                    return (
                      <button
                        key={lp}
                        type="button"
                        onClick={() => {
                          setIsCustomPathSelected(false);
                          setSelectedPathSlug(lp);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all border flex items-center gap-1.5 cursor-pointer ${
                          isSelected
                            ? 'bg-emerald-500/25 text-emerald-300 border-emerald-400 shadow-md shadow-emerald-500/20 scale-105'
                            : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span>/{lp}</span>
                        <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-500/30 text-emerald-200 font-sans uppercase">
                          {t('services.mediamtx.connectionMatrix.livePathBadge', 'LIVE FEED')}
                        </span>
                      </button>
                    );
                  })}

                {/* Custom Path Selection Toggle */}
                <button
                  type="button"
                  onClick={() => setIsCustomPathSelected(true)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border flex items-center gap-1.5 cursor-pointer ${
                    isCustomPathSelected
                      ? 'bg-brand-lime/20 text-brand-lime border-brand-lime/50 shadow-md shadow-brand-lime/10'
                      : 'bg-white/5 hover:bg-white/10 text-[var(--text-secondary)] border-[var(--glass-border)]'
                  }`}
                >
                  <span>✏️</span>
                  <span>{t('services.mediamtx.connectionMatrix.customPath', 'Custom Path')}</span>
                </button>

                {/* Custom Path Input Field */}
                {isCustomPathSelected && (
                  <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                    <div className="relative flex-1">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-mono text-[var(--text-secondary)]">/</span>
                      <input
                        type="text"
                        autoFocus
                        value={customPathInput}
                        onChange={(e) => setCustomPathInput(e.target.value.replace(/[^a-zA-Z0-9_\-\/]/g, ''))}
                        placeholder={t('services.mediamtx.connectionMatrix.enterCustomPath', 'Enter path name (e.g. live, cam1)...')}
                        className="w-full bg-[var(--bg-card)] border border-brand-lime/50 rounded-lg pl-6 pr-3 py-1.5 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Matrix Protocol Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {/* 1. RTMP & RTMPS Card */}
              {mtxCfg.rtmp_enabled !== false && (
                <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3.5 space-y-3 flex flex-col justify-between">
                  <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                        RTMP{mtxCfg.ssl_enabled && mtxCfg.rtmps_enabled ? ' / RTMPS' : ''}
                      </span>
                      <span className="text-xs font-bold text-[var(--text-primary)]">
                        {t('services.mediamtx.connectionMatrix.rtmpTitle', 'RTMP & RTMPS (Flash / OBS / FFmpeg)')}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-[var(--text-secondary)]">:{rtmpPort}</span>
                  </div>

                  <div className="space-y-2 text-xs">
                    {/* Standard RTMP Push */}
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold uppercase text-[var(--text-secondary)] block">
                        {t('services.mediamtx.connectionMatrix.pushUrl', 'Push (Publish):')}
                      </span>
                      <div className="flex items-center gap-2 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg p-1.5">
                        <div className="font-mono text-[11px] text-[var(--text-primary)] truncate flex-1 px-1 select-all" title={rtmpPushUrl}>
                          {rtmpPushUrl}
                        </div>
                        <button
                          type="button"
                          onClick={() => copyToClipboard('rtmp-push', rtmpPushUrl)}
                          className={`px-2 py-1 text-[10px] font-bold rounded uppercase tracking-wider transition-all flex items-center gap-1 shrink-0 cursor-pointer ${
                            copiedKey === 'rtmp-push'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-white/5 hover:bg-white/10 text-[var(--text-primary)] border border-[var(--glass-border)] hover:border-brand-lime/40'
                          }`}
                        >
                          {copiedKey === 'rtmp-push' ? <CheckIcon size={12} /> : <ClipboardIcon size={12} />}
                          <span>{copiedKey === 'rtmp-push' ? t('services.mediamtx.connectionMatrix.copied', '✓ Copied') : t('services.mediamtx.connectionMatrix.copy', 'Copy')}</span>
                        </button>
                      </div>
                    </div>

                    {/* Standard RTMP Pull */}
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold uppercase text-[var(--text-secondary)] block">
                        {t('services.mediamtx.connectionMatrix.pullUrl', 'Pull (Playback):')}
                      </span>
                      <div className="flex items-center gap-2 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg p-1.5">
                        <div className="font-mono text-[11px] text-[var(--text-primary)] truncate flex-1 px-1 select-all" title={rtmpPullUrl}>
                          {rtmpPullUrl}
                        </div>
                        <button
                          type="button"
                          onClick={() => copyToClipboard('rtmp-pull', rtmpPullUrl)}
                          className={`px-2 py-1 text-[10px] font-bold rounded uppercase tracking-wider transition-all flex items-center gap-1 shrink-0 cursor-pointer ${
                            copiedKey === 'rtmp-pull'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-white/5 hover:bg-white/10 text-[var(--text-primary)] border border-[var(--glass-border)] hover:border-brand-lime/40'
                          }`}
                        >
                          {copiedKey === 'rtmp-pull' ? <CheckIcon size={12} /> : <ClipboardIcon size={12} />}
                          <span>{copiedKey === 'rtmp-pull' ? t('services.mediamtx.connectionMatrix.copied', '✓ Copied') : t('services.mediamtx.connectionMatrix.copy', 'Copy')}</span>
                        </button>
                      </div>
                    </div>

                    {/* RTMPS if TLS enabled */}
                    {mtxCfg.ssl_enabled && mtxCfg.rtmps_enabled && (
                      <div className="space-y-2 pt-2 border-t border-[var(--glass-border)]">
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold uppercase text-emerald-400 flex items-center gap-1">
                            <ShieldIcon size={10} /> RTMPS Push (TLS :{rtmpsPort}):
                          </span>
                          <div className="flex items-center gap-2 bg-[var(--bg-card)] border border-emerald-500/20 rounded-lg p-1.5">
                            <div className="font-mono text-[11px] text-emerald-300 truncate flex-1 px-1 select-all" title={rtmpsPushUrl}>
                              {rtmpsPushUrl}
                            </div>
                            <button
                              type="button"
                              onClick={() => copyToClipboard('rtmps-push', rtmpsPushUrl)}
                              className={`px-2 py-1 text-[10px] font-bold rounded uppercase tracking-wider transition-all flex items-center gap-1 shrink-0 cursor-pointer ${
                                copiedKey === 'rtmps-push'
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                  : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              }`}
                            >
                              {copiedKey === 'rtmps-push' ? <CheckIcon size={12} /> : <ClipboardIcon size={12} />}
                              <span>{copiedKey === 'rtmps-push' ? t('services.mediamtx.connectionMatrix.copied', '✓ Copied') : t('services.mediamtx.connectionMatrix.copy', 'Copy')}</span>
                            </button>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <span className="text-[10px] font-bold uppercase text-emerald-400 flex items-center gap-1">
                            <ShieldIcon size={10} /> RTMPS Pull (TLS :{rtmpsPort}):
                          </span>
                          <div className="flex items-center gap-2 bg-[var(--bg-card)] border border-emerald-500/20 rounded-lg p-1.5">
                            <div className="font-mono text-[11px] text-emerald-300 truncate flex-1 px-1 select-all" title={rtmpsPullUrl}>
                              {rtmpsPullUrl}
                            </div>
                            <button
                              type="button"
                              onClick={() => copyToClipboard('rtmps-pull', rtmpsPullUrl)}
                              className={`px-2 py-1 text-[10px] font-bold rounded uppercase tracking-wider transition-all flex items-center gap-1 shrink-0 cursor-pointer ${
                                copiedKey === 'rtmps-pull'
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                  : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              }`}
                            >
                              {copiedKey === 'rtmps-pull' ? <CheckIcon size={12} /> : <ClipboardIcon size={12} />}
                              <span>{copiedKey === 'rtmps-pull' ? t('services.mediamtx.connectionMatrix.copied', '✓ Copied') : t('services.mediamtx.connectionMatrix.copy', 'Copy')}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 2. RTSP & RTSPS Card */}
              {mtxCfg.rtsp_enabled !== false && (
                <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3.5 space-y-3 flex flex-col justify-between">
                  <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                        RTSP{mtxCfg.ssl_enabled && mtxCfg.rtsps_enabled ? ' / RTSPS' : ''}
                      </span>
                      <span className="text-xs font-bold text-[var(--text-primary)]">
                        {t('services.mediamtx.connectionMatrix.rtspTitle', 'RTSP & RTSPS (IP Cam / VLC / GStreamer)')}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-[var(--text-secondary)]">:{rtspPort}</span>
                  </div>

                  <div className="space-y-2 text-xs">
                    {/* RTSP Push */}
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold uppercase text-[var(--text-secondary)] block">
                        {t('services.mediamtx.connectionMatrix.pushUrl', 'Push (Publish):')}
                      </span>
                      <div className="flex items-center gap-2 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg p-1.5">
                        <div className="font-mono text-[11px] text-[var(--text-primary)] truncate flex-1 px-1 select-all" title={rtspPushUrl}>
                          {rtspPushUrl}
                        </div>
                        <button
                          type="button"
                          onClick={() => copyToClipboard('rtsp-push', rtspPushUrl)}
                          className={`px-2 py-1 text-[10px] font-bold rounded uppercase tracking-wider transition-all flex items-center gap-1 shrink-0 cursor-pointer ${
                            copiedKey === 'rtsp-push'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-white/5 hover:bg-white/10 text-[var(--text-primary)] border border-[var(--glass-border)] hover:border-brand-lime/40'
                          }`}
                        >
                          {copiedKey === 'rtsp-push' ? <CheckIcon size={12} /> : <ClipboardIcon size={12} />}
                          <span>{copiedKey === 'rtsp-push' ? t('services.mediamtx.connectionMatrix.copied', '✓ Copied') : t('services.mediamtx.connectionMatrix.copy', 'Copy')}</span>
                        </button>
                      </div>
                    </div>

                    {/* RTSP Pull */}
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold uppercase text-[var(--text-secondary)] block">
                        {t('services.mediamtx.connectionMatrix.pullUrl', 'Pull (Playback):')}
                      </span>
                      <div className="flex items-center gap-2 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg p-1.5">
                        <div className="font-mono text-[11px] text-[var(--text-primary)] truncate flex-1 px-1 select-all" title={rtspPullUrl}>
                          {rtspPullUrl}
                        </div>
                        <button
                          type="button"
                          onClick={() => copyToClipboard('rtsp-pull', rtspPullUrl)}
                          className={`px-2 py-1 text-[10px] font-bold rounded uppercase tracking-wider transition-all flex items-center gap-1 shrink-0 cursor-pointer ${
                            copiedKey === 'rtsp-pull'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-white/5 hover:bg-white/10 text-[var(--text-primary)] border border-[var(--glass-border)] hover:border-brand-lime/40'
                          }`}
                        >
                          {copiedKey === 'rtsp-pull' ? <CheckIcon size={12} /> : <ClipboardIcon size={12} />}
                          <span>{copiedKey === 'rtsp-pull' ? t('services.mediamtx.connectionMatrix.copied', '✓ Copied') : t('services.mediamtx.connectionMatrix.copy', 'Copy')}</span>
                        </button>
                      </div>
                    </div>

                    {/* RTSPS if TLS enabled */}
                    {mtxCfg.ssl_enabled && mtxCfg.rtsps_enabled && (
                      <div className="space-y-2 pt-2 border-t border-[var(--glass-border)]">
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold uppercase text-emerald-400 flex items-center gap-1">
                            <ShieldIcon size={10} /> RTSPS Push (TLS :{rtspsPort}):
                          </span>
                          <div className="flex items-center gap-2 bg-[var(--bg-card)] border border-emerald-500/20 rounded-lg p-1.5">
                            <div className="font-mono text-[11px] text-emerald-300 truncate flex-1 px-1 select-all" title={rtspsPushUrl}>
                              {rtspsPushUrl}
                            </div>
                            <button
                              type="button"
                              onClick={() => copyToClipboard('rtsps-push', rtspsPushUrl)}
                              className={`px-2 py-1 text-[10px] font-bold rounded uppercase tracking-wider transition-all flex items-center gap-1 shrink-0 cursor-pointer ${
                                copiedKey === 'rtsps-push'
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                  : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              }`}
                            >
                              {copiedKey === 'rtsps-push' ? <CheckIcon size={12} /> : <ClipboardIcon size={12} />}
                              <span>{copiedKey === 'rtsps-push' ? t('services.mediamtx.connectionMatrix.copied', '✓ Copied') : t('services.mediamtx.connectionMatrix.copy', 'Copy')}</span>
                            </button>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <span className="text-[10px] font-bold uppercase text-emerald-400 flex items-center gap-1">
                            <ShieldIcon size={10} /> RTSPS Pull (TLS :{rtspsPort}):
                          </span>
                          <div className="flex items-center gap-2 bg-[var(--bg-card)] border border-emerald-500/20 rounded-lg p-1.5">
                            <div className="font-mono text-[11px] text-emerald-300 truncate flex-1 px-1 select-all" title={rtspsPullUrl}>
                              {rtspsPullUrl}
                            </div>
                            <button
                              type="button"
                              onClick={() => copyToClipboard('rtsps-pull', rtspsPullUrl)}
                              className={`px-2 py-1 text-[10px] font-bold rounded uppercase tracking-wider transition-all flex items-center gap-1 shrink-0 cursor-pointer ${
                                copiedKey === 'rtsps-pull'
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                  : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              }`}
                            >
                              {copiedKey === 'rtsps-pull' ? <CheckIcon size={12} /> : <ClipboardIcon size={12} />}
                              <span>{copiedKey === 'rtsps-pull' ? t('services.mediamtx.connectionMatrix.copied', '✓ Copied') : t('services.mediamtx.connectionMatrix.copy', 'Copy')}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 3. SRT Caller Ingest (Push / Publish) */}
              {mtxCfg.srt_enabled !== false && (
                <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3.5 space-y-3 flex flex-col justify-between">
                  <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/15 text-purple-400 border border-purple-500/30">
                        SRT PUSH
                      </span>
                      <span className="text-xs font-bold text-[var(--text-primary)]">
                        {t('services.mediamtx.connectionMatrix.srtIngestTitle', 'SRT Caller Ingest (Push / Publish)')}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-[var(--text-secondary)]">:{srtPort} (UDP)</span>
                  </div>

                  <div className="space-y-1 text-xs">
                    <span className="text-[10px] font-bold uppercase text-[var(--text-secondary)] block">
                      {t('services.mediamtx.connectionMatrix.url', 'URL:')}
                    </span>
                    <div className="flex items-center gap-2 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg p-1.5">
                      <div className="font-mono text-[11px] text-[var(--text-primary)] truncate flex-1 px-1 select-all" title={srtIngestUrl}>
                        {srtIngestUrl}
                      </div>
                      <button
                        type="button"
                        onClick={() => copyToClipboard('srt-ingest', srtIngestUrl)}
                        className={`px-2.5 py-1 text-[10px] font-bold rounded uppercase tracking-wider transition-all flex items-center gap-1 shrink-0 cursor-pointer ${
                          copiedKey === 'srt-ingest'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-white/5 hover:bg-white/10 text-[var(--text-primary)] border border-[var(--glass-border)] hover:border-brand-lime/40'
                        }`}
                      >
                        {copiedKey === 'srt-ingest' ? <CheckIcon size={12} /> : <ClipboardIcon size={12} />}
                        <span>{copiedKey === 'srt-ingest' ? t('services.mediamtx.connectionMatrix.copied', '✓ Copied') : t('services.mediamtx.connectionMatrix.copy', 'Copy')}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* 4. SRT Caller Playback (Pull / Request) */}
              {mtxCfg.srt_enabled !== false && (
                <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3.5 space-y-3 flex flex-col justify-between">
                  <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/15 text-purple-400 border border-purple-500/30">
                        SRT PULL
                      </span>
                      <span className="text-xs font-bold text-[var(--text-primary)]">
                        {t('services.mediamtx.connectionMatrix.srtPlaybackTitle', 'SRT Caller Playback (Pull / Request)')}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-[var(--text-secondary)]">:{srtPort} (UDP)</span>
                  </div>

                  <div className="space-y-1 text-xs">
                    <span className="text-[10px] font-bold uppercase text-[var(--text-secondary)] block">
                      {t('services.mediamtx.connectionMatrix.url', 'URL:')}
                    </span>
                    <div className="flex items-center gap-2 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg p-1.5">
                      <div className="font-mono text-[11px] text-[var(--text-primary)] truncate flex-1 px-1 select-all" title={srtPlaybackUrl}>
                        {srtPlaybackUrl}
                      </div>
                      <button
                        type="button"
                        onClick={() => copyToClipboard('srt-playback', srtPlaybackUrl)}
                        className={`px-2.5 py-1 text-[10px] font-bold rounded uppercase tracking-wider transition-all flex items-center gap-1 shrink-0 cursor-pointer ${
                          copiedKey === 'srt-playback'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-white/5 hover:bg-white/10 text-[var(--text-primary)] border border-[var(--glass-border)] hover:border-brand-lime/40'
                        }`}
                      >
                        {copiedKey === 'srt-playback' ? <CheckIcon size={12} /> : <ClipboardIcon size={12} />}
                        <span>{copiedKey === 'srt-playback' ? t('services.mediamtx.connectionMatrix.copied', '✓ Copied') : t('services.mediamtx.connectionMatrix.copy', 'Copy')}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* 5. WebRTC WHEP (Playback) */}
              {mtxCfg.webrtc_enabled !== false && (
                <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3.5 space-y-3 flex flex-col justify-between">
                  <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        WHEP PULL
                      </span>
                      <span className="text-xs font-bold text-[var(--text-primary)]">
                        {t('services.mediamtx.connectionMatrix.webrtcWhepTitle', 'WebRTC WHEP (Ultra-Low Latency Playback)')}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-[var(--text-secondary)]">:{webrtcPort}</span>
                  </div>

                  <div className="space-y-1 text-xs">
                    <span className="text-[10px] font-bold uppercase text-[var(--text-secondary)] block">
                      {t('services.mediamtx.connectionMatrix.url', 'URL:')}
                    </span>
                    <div className="flex items-center gap-2 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg p-1.5">
                      <div className="font-mono text-[11px] text-[var(--text-primary)] truncate flex-1 px-1 select-all" title={webrtcWhepUrl}>
                        {webrtcWhepUrl}
                      </div>
                      <button
                        type="button"
                        onClick={() => copyToClipboard('webrtc-whep', webrtcWhepUrl)}
                        className={`px-2.5 py-1 text-[10px] font-bold rounded uppercase tracking-wider transition-all flex items-center gap-1 shrink-0 cursor-pointer ${
                          copiedKey === 'webrtc-whep'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-white/5 hover:bg-white/10 text-[var(--text-primary)] border border-[var(--glass-border)] hover:border-brand-lime/40'
                        }`}
                      >
                        {copiedKey === 'webrtc-whep' ? <CheckIcon size={12} /> : <ClipboardIcon size={12} />}
                        <span>{copiedKey === 'webrtc-whep' ? t('services.mediamtx.connectionMatrix.copied', '✓ Copied') : t('services.mediamtx.connectionMatrix.copy', 'Copy')}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* 6. WebRTC WHIP (Ingest) */}
              {mtxCfg.webrtc_enabled !== false && (
                <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3.5 space-y-3 flex flex-col justify-between">
                  <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        WHIP PUSH
                      </span>
                      <span className="text-xs font-bold text-[var(--text-primary)]">
                        {t('services.mediamtx.connectionMatrix.webrtcWhipTitle', 'WebRTC WHIP (Browser Ingest / Publish)')}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-[var(--text-secondary)]">:{webrtcPort}</span>
                  </div>

                  <div className="space-y-1 text-xs">
                    <span className="text-[10px] font-bold uppercase text-[var(--text-secondary)] block">
                      {t('services.mediamtx.connectionMatrix.url', 'URL:')}
                    </span>
                    <div className="flex items-center gap-2 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg p-1.5">
                      <div className="font-mono text-[11px] text-[var(--text-primary)] truncate flex-1 px-1 select-all" title={webrtcWhipUrl}>
                        {webrtcWhipUrl}
                      </div>
                      <button
                        type="button"
                        onClick={() => copyToClipboard('webrtc-whip', webrtcWhipUrl)}
                        className={`px-2.5 py-1 text-[10px] font-bold rounded uppercase tracking-wider transition-all flex items-center gap-1 shrink-0 cursor-pointer ${
                          copiedKey === 'webrtc-whip'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-white/5 hover:bg-white/10 text-[var(--text-primary)] border border-[var(--glass-border)] hover:border-brand-lime/40'
                        }`}
                      >
                        {copiedKey === 'webrtc-whip' ? <CheckIcon size={12} /> : <ClipboardIcon size={12} />}
                        <span>{copiedKey === 'webrtc-whip' ? t('services.mediamtx.connectionMatrix.copied', '✓ Copied') : t('services.mediamtx.connectionMatrix.copy', 'Copy')}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* 7. HLS Web URL */}
              {mtxCfg.hls_enabled && (
                <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3.5 space-y-3 flex flex-col justify-between md:col-span-2">
                  <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/15 text-blue-400 border border-blue-500/30">
                        HLS STREAM
                      </span>
                      <span className="text-xs font-bold text-[var(--text-primary)]">
                        {t('services.mediamtx.connectionMatrix.hlsTitle', 'HLS Web Stream (HTTP Live Streaming)')}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-[var(--text-secondary)]">:{hlsPort} (HTTP)</span>
                  </div>

                  <div className="space-y-1 text-xs">
                    <span className="text-[10px] font-bold uppercase text-[var(--text-secondary)] block">
                      {t('services.mediamtx.connectionMatrix.url', 'URL:')}
                    </span>
                    <div className="flex items-center gap-2 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg p-1.5">
                      <div className="font-mono text-[11px] text-[var(--text-primary)] truncate flex-1 px-1 select-all" title={hlsUrl}>
                        {hlsUrl}
                      </div>
                      <button
                        type="button"
                        onClick={() => copyToClipboard('hls', hlsUrl)}
                        className={`px-2.5 py-1 text-[10px] font-bold rounded uppercase tracking-wider transition-all flex items-center gap-1 shrink-0 cursor-pointer ${
                          copiedKey === 'hls'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-white/5 hover:bg-white/10 text-[var(--text-primary)] border border-[var(--glass-border)] hover:border-brand-lime/40'
                        }`}
                      >
                        {copiedKey === 'hls' ? <CheckIcon size={12} /> : <ClipboardIcon size={12} />}
                        <span>{copiedKey === 'hls' ? t('services.mediamtx.connectionMatrix.copied', '✓ Copied') : t('services.mediamtx.connectionMatrix.copy', 'Copy')}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Daemon Virtual Terminal Output */}
          <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3.5 font-mono text-xs space-y-2">
            <div className="flex justify-between items-center border-b border-[var(--glass-border)] pb-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-brand-lime animate-pulse" />
                <span className="text-brand-lime font-bold uppercase tracking-wider text-[10px]">
                  {t('services.mediamtx.previewModal.consoleTitle', 'Daemon Real-Time Audit Console')}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyLogs}
                  className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-[var(--text-primary)] border border-[var(--glass-border)] text-[9px] font-bold rounded uppercase tracking-wider transition-colors cursor-pointer"
                >
                  {copySuccess ? t('services.mediamtx.connectionMatrix.copied', '✓ Copied') : t('services.mediamtx.previewModal.copyLogs', 'Copy Logs')}
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
                  {t('services.mediamtx.previewModal.downloadLog', 'Download Log')}
                </button>
                <span className="text-[var(--text-secondary)] text-[10px] font-bold">
                  {t('services.mediamtx.previewModal.lines', '{{count}} lines', { count: activeLogs.length })}
                </span>
              </div>
            </div>

            <div
              ref={processLogsContainerRef}
              className="h-64 overflow-y-auto space-y-1 custom-scrollbar pr-2 select-text text-[11px] leading-relaxed"
            >
              {activeLogs.length === 0 ? (
                <div className="text-[var(--text-secondary)] opacity-40 italic text-center py-16 select-none">
                  {isRunning
                    ? t('services.mediamtx.previewModal.waitingLogs', 'Daemon active. Waiting for stream connection activity...')
                    : t('services.mediamtx.previewModal.stoppedLogs', 'Daemon is stopped. Start service to monitor stream routing.')}
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
              className="pill-button bg-white/10 hover:bg-white/15 text-xs py-1.5 px-4 cursor-pointer text-[var(--text-primary)]"
            >
              {t('services.exportProfile', 'EXPORT PROFILE')}
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
              {t('common.editConfig', 'EDIT CONFIG')}
            </button>

            <button
              disabled={!!actionPending[currentProcess.id]}
              onClick={() => {
                onCloneProcess(currentProcess);
                onClose();
              }}
              className="pill-button bg-white/10 hover:bg-white/15 text-xs py-1.5 px-4 disabled:opacity-50 disabled:pointer-events-none cursor-pointer text-[var(--text-primary)]"
            >
              {t('services.cloneService', 'CLONE SERVICE')}
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
                  {actionPending[currentProcess.id] === 'restarting'
                    ? t('services.restarting', 'RESTARTING...')
                    : t('services.restartService', 'RESTART SERVICE')}
                </button>
                <button
                  disabled={!!actionPending[currentProcess.id]}
                  onClick={() => onStopService(currentProcess.id, currentProcess.name)}
                  className="pill-button bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs font-bold py-1.5 px-5 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-1.5 justify-center cursor-pointer"
                >
                  {actionPending[currentProcess.id] === 'stopping' && (
                    <span className="w-3.5 h-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin inline-block" />
                  )}
                  {actionPending[currentProcess.id] === 'stopping'
                    ? t('services.stopping', 'STOPPING...')
                    : t('services.stopService', 'STOP SERVICE')}
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
                {actionPending[currentProcess.id] === 'starting'
                  ? t('services.starting', 'STARTING...')
                  : t('services.startService', 'START SERVICE')}
              </button>
            )}

            <button
              onClick={onClose}
              className="pill-button bg-white/5 hover:bg-white/10 text-xs border border-[var(--glass-border)] py-1.5 px-4 cursor-pointer text-[var(--text-primary)]"
            >
              {t('common.close', 'CLOSE')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
