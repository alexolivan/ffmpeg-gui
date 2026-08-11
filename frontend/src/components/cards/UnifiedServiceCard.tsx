import React from 'react';
import { useTranslation } from 'react-i18next';
import { 
  PlayIcon, 
  StopIcon, 
  RefreshIcon, 
  PencilIcon, 
  ClipboardIcon, 
  TrashIcon, 
  LightningIcon, 
  ShieldIcon
} from '../Icons';

export interface ServiceItem {
  id: number;
  name: string;
  alias?: string | null;
  service_type?: string; // 'ffmpeg_stream', 'icecast_server', 'kiosk_browser', 'mediamtx_hub'
  type?: string;
  status: string;
  pid?: number | null;
  cpu?: number;
  ram?: number;
  bitrate?: string | null;
  fps?: string | null;
  speed?: string | null;
  ffmpeg_build_id?: number | null;
  input_config?: any;
  output_config?: any;
  codec_config?: any;
  filter_config?: any;
  config?: any;
  auto_start?: boolean;
  startup_order?: number;
  startup_delay?: number;
  watchdog_enabled?: boolean;
  watchdog_retries?: number;
  watchdog_min_speed?: number | null;
  watchdog_min_speed_duration?: number;
  pending_changes?: boolean;
  last_start?: string | null;
  last_stop?: string | null;
  restart_count?: number;
  network_timeout?: number;
  debug_mode?: boolean;
  log_storage_id?: number | null;
  dependencies?: Array<{
    id: number;
    provider_service_id: number;
    provider_name?: string;
    is_auto_managed?: boolean;
  }>;
}

interface UnifiedServiceCardProps {
  service: ServiceItem;
  telemetryItem?: any;
  actionPending?: 'starting' | 'stopping' | 'restarting';
  onStartService: (procId: number) => void;
  onStopService: (procId: number, name?: string) => void;
  onRestartService: (procId: number, name: string) => void;
  onEditProcess: (service: ServiceItem) => void;
  onCloneProcess: (service: ServiceItem) => void;
  onDeleteProcess: (service: ServiceItem) => void;
  onSelectedProcess: (service: ServiceItem) => void;
  onViewLogs?: (service: ServiceItem) => void;
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

export const hasVideo = (proc: ServiceItem): boolean => {
  if (!proc) return true;
  try {
    const codecCfg = typeof proc.codec_config === 'string' 
      ? JSON.parse(proc.codec_config) 
      : (proc.codec_config || proc.config?.codec_config || {});
    if (codecCfg.vcodec && codecCfg.vcodec !== 'none') return true;
    const inputCfg = typeof proc.input_config === 'string' 
      ? JSON.parse(proc.input_config) 
      : (proc.input_config || proc.config?.input_config || {});
    if (inputCfg.has_video === true) return true;
    if (inputCfg.has_video === false) return false;
  } catch (e) {
    // Ignore parse errors
  }
  return true;
};

export const UnifiedServiceCard: React.FC<UnifiedServiceCardProps> = ({
  service,
  telemetryItem,
  actionPending,
  onStartService,
  onStopService,
  onRestartService,
  onEditProcess,
  onCloneProcess,
  onDeleteProcess,
  onSelectedProcess,
  onViewLogs,
  API
}) => {
  const { t } = useTranslation();
  const isRunning = service.status === 'running';
  const isError = service.status === 'error';
  const isPending = !!actionPending;

  const cpu = telemetryItem?.cpu ?? service.cpu ?? 0;
  const ram = telemetryItem?.ram ?? service.ram ?? 0;
  const bitrate = telemetryItem?.bitrate || service.bitrate || '0 kb/s';
  const fps = telemetryItem?.fps || service.fps || '0';
  const speed = telemetryItem?.speed || service.speed || '0x';
  const pid = telemetryItem?.pid || service.pid;

  const serviceType = service.service_type || 'ffmpeg_stream';
  const isFfmpegStream = serviceType === 'ffmpeg_stream';

  const codecCfg = typeof service.codec_config === 'string' 
    ? JSON.parse(service.codec_config) 
    : (service.codec_config || service.config?.codec_config || {});
  const vcodec = codecCfg.vcodec || 'copy';
  const isHwEncoder = vcodec.includes('nvenc') || vcodec.includes('qsv') || vcodec.includes('vaapi');

  const videoStreamAvailable = isFfmpegStream && hasVideo(service);

  return (
    <div 
      className={`group relative flex flex-col rounded-xl border transition-all duration-300 shadow-lg overflow-hidden ${
        isRunning 
          ? 'bg-[var(--bg-card)] border-brand-lime/30 hover:border-brand-lime/60 shadow-brand-lime/5' 
          : isError
          ? 'bg-[var(--bg-card)] border-red-500/30 hover:border-red-500/60 shadow-red-500/5'
          : 'bg-[var(--bg-card)] border-[var(--glass-border)] hover:border-brand-lime/30'
      }`}
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--glass-border)] bg-black/20">
        <div className="flex items-center space-x-3 cursor-pointer min-w-0" onClick={() => onSelectedProcess(service)}>
          <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
            isRunning 
              ? 'bg-brand-lime animate-pulse shadow-[0_0_8px_rgba(212,255,91,0.6)]' 
              : isError
              ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]'
              : 'bg-zinc-600'
          }`} />
          <div className="truncate">
            <h3 className="text-base font-bold text-[var(--text-primary)] truncate group-hover:text-brand-lime transition-colors">
              {service.alias || service.name}
            </h3>
            {service.alias && (
              <span className="text-xs text-[var(--text-secondary)] block truncate">
                {service.name}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-2 flex-shrink-0">
          {/* Service Type Badge */}
          <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-zinc-800 border border-[var(--glass-border)] text-[var(--text-secondary)]">
            {serviceType === 'ffmpeg_stream' 
              ? 'FFmpeg' 
              : serviceType === 'icecast_server' 
              ? 'Icecast' 
              : serviceType === 'kiosk_browser' 
              ? 'Kiosk' 
              : 'Service'}
          </span>

          {/* Pending Changes Indicator */}
          {service.pending_changes && isRunning && (
            <span 
              className="px-2 py-0.5 text-[10px] font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded animate-pulse"
              title={t('services.pendingChangesTitle', 'Configuration updated. Restart required to apply changes.')}
            >
              ⚠️ {t('services.pendingChanges', 'MODIFIED')}
            </span>
          )}
        </div>
      </div>

      {/* Main Content Area / Slot */}
      <div 
        className="relative cursor-pointer select-none bg-black/40 min-h-[140px] flex flex-col justify-between p-4"
        onClick={() => onSelectedProcess(service)}
      >
        {/* SLOT 1: FFmpeg Video Stream Preview */}
        {isFfmpegStream && videoStreamAvailable && (
          <div className="relative w-full h-36 rounded-lg overflow-hidden border border-[var(--glass-border)] bg-black/60 mb-3 group/preview">
            {isRunning ? (
              <img 
                src={`${API}/processes/${service.id}/preview?t=${Date.now()}`}
                alt={service.name}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-zinc-500 space-y-1">
                <span className="text-2xl">📺</span>
                <span className="text-xs font-mono uppercase">{t('common.stopped', 'Stopped')}</span>
              </div>
            )}
            <div className="absolute inset-0 bg-black/0 group-hover/preview:bg-black/30 transition-all flex items-center justify-center">
              <span className="opacity-0 group-hover/preview:opacity-100 text-xs font-medium text-white bg-black/70 px-3 py-1 rounded-full backdrop-blur transition-opacity">
                🔍 {t('services.inspectStream', 'Inspect Live Stream')}
              </span>
            </div>
          </div>
        )}

        {/* SLOT 2: Non-Video / Audio-Only or Standalone Services Slot */}
        {(!isFfmpegStream || !videoStreamAvailable) && (
          <div className="flex-1 flex flex-col justify-center items-center p-4 my-2 border border-dashed border-[var(--glass-border)] rounded-lg bg-zinc-900/30">
            <span className="text-3xl mb-1">
              {serviceType === 'icecast_server' 
                ? '📻' 
                : serviceType === 'kiosk_browser' 
                ? '🌐' 
                : serviceType === 'mediamtx_hub' 
                ? '🛰️' 
                : '🎵'}
            </span>
            <span className="text-xs font-mono text-[var(--text-secondary)] text-center">
              {serviceType === 'icecast_server' 
                ? t('services.typeIcecastServer', 'Icecast Audio Server')
                : serviceType === 'kiosk_browser'
                ? t('services.typeKioskBrowser', 'Kiosk WebView Browser')
                : serviceType === 'mediamtx_hub'
                ? t('services.typeMediamtxHub', 'MediaMTX Protocol Hub')
                : t('services.typeFfmpegStream', 'FFmpeg Pipeline')}
            </span>
          </div>
        )}

        {/* Real-time Telemetry Grid */}
        <div 
          className="grid grid-cols-4 gap-2 text-xs font-mono bg-black/40 p-2.5 rounded-lg border border-[var(--glass-border)]"
          title={`Bitrate: ${bitrate} | Speed: ${speed}`}
        >
          <div className="flex flex-col">
            <span className="text-[10px] text-[var(--text-secondary)] uppercase">PID</span>
            <span className="font-bold text-[var(--text-primary)]">{pid || 'N/A'}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-[var(--text-secondary)] uppercase">CPU</span>
            <span className={`font-bold ${cpu > 80 ? 'text-red-400' : 'text-[var(--text-primary)]'}`}>{cpu}%</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-[var(--text-secondary)] uppercase">RAM</span>
            <span className="font-bold text-[var(--text-primary)]">{ram}%</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-[var(--text-secondary)] uppercase">{isFfmpegStream ? 'FPS' : 'UPTIME'}</span>
            <span className="font-bold text-brand-lime truncate">
              {isFfmpegStream ? fps : formatUptime(service.last_start)}
            </span>
          </div>
        </div>

        {/* Linked Implicit Dependencies Badge */}
        {service.dependencies && service.dependencies.length > 0 && (
          <div className="mt-2 flex items-center space-x-1 text-[11px] font-mono text-brand-lime bg-brand-lime/10 px-2 py-1 rounded border border-brand-lime/20">
            <span>🔗</span>
            <span className="truncate">
              {t('services.linkedImplicit', 'Linked')}: {service.dependencies.map(d => d.provider_name || `Service #${d.provider_service_id}`).join(', ')}
            </span>
          </div>
        )}
      </div>

      {/* Footer Controls & Actions */}
      <div className="p-3 border-t border-[var(--glass-border)] bg-black/30 flex items-center justify-between">
        {/* State Badges */}
        <div className="flex items-center space-x-2">
          {service.watchdog_enabled && (
            <span 
              className="flex items-center space-x-1 text-[10px] font-mono px-2 py-0.5 rounded bg-brand-lime/10 text-brand-lime border border-brand-lime/30"
              title="Watchdog Auto-Recovery Enabled"
            >
              <ShieldIcon className="w-3 h-3" />
              <span>WD</span>
            </span>
          )}

          {isHwEncoder && (
            <span 
              className="flex items-center space-x-1 text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/30"
              title="Hardware Accelerated GPU Transcoding"
            >
              <LightningIcon className="w-3 h-3" />
              <span>GPU</span>
            </span>
          )}
        </div>

        {/* Iconic Control Buttons (Matching 1.X Aesthetics) */}
        <div className="flex items-center space-x-1.5">
          {/* Start / Stop / Pending */}
          {isRunning ? (
            <button
              onClick={() => onStopService(service.id, service.name)}
              disabled={isPending}
              className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 transition-all disabled:opacity-50"
              title={t('common.stop', 'Stop Service')}
            >
              {actionPending === 'stopping' ? (
                <RefreshIcon className="w-4 h-4 animate-spin" />
              ) : (
                <StopIcon className="w-4 h-4" />
              )}
            </button>
          ) : (
            <button
              onClick={() => onStartService(service.id)}
              disabled={isPending}
              className="p-2 rounded-lg bg-brand-lime/10 text-brand-lime hover:bg-brand-lime/20 border border-brand-lime/30 transition-all disabled:opacity-50"
              title={t('common.start', 'Start Service')}
            >
              {actionPending === 'starting' ? (
                <RefreshIcon className="w-4 h-4 animate-spin" />
              ) : (
                <PlayIcon className="w-4 h-4" />
              )}
            </button>
          )}

          {/* Restart Button */}
          {isRunning && (
            <button
              onClick={() => onRestartService(service.id, service.name)}
              disabled={isPending}
              className="p-2 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/30 transition-all disabled:opacity-50"
              title={t('common.restart', 'Restart Service')}
            >
              <RefreshIcon className={`w-4 h-4 ${actionPending === 'restarting' ? 'animate-spin' : ''}`} />
            </button>
          )}

          {/* Logs & Event History Button */}
          {onViewLogs && (
            <button
              onClick={() => onViewLogs(service)}
              className="p-2 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white border border-[var(--glass-border)] transition-all"
              title={t('services.viewLogs', 'View Event Logs')}
            >
              📜
            </button>
          )}

          {/* Edit Button */}
          <button
            onClick={() => onEditProcess(service)}
            className="p-2 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white border border-[var(--glass-border)] transition-all"
            title={t('common.edit', 'Edit Service')}
          >
            <PencilIcon className="w-4 h-4" />
          </button>

          {/* Clone as Task Button (Conditional for FFmpeg Streams Only) */}
          {isFfmpegStream && (
            <button
              onClick={() => onCloneProcess(service)}
              className="p-2 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white border border-[var(--glass-border)] transition-all"
              title={t('services.cloneAsTask', 'Copy as Task')}
            >
              <ClipboardIcon className="w-4 h-4" />
            </button>
          )}

          {/* Delete Button */}
          <button
            onClick={() => onDeleteProcess(service)}
            disabled={isRunning}
            className="p-2 rounded-lg bg-red-500/5 text-red-400 hover:bg-red-500/20 hover:text-red-300 border border-red-500/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            title={t('common.delete', 'Delete Service')}
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
