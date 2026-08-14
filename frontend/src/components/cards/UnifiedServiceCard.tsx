import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatInputDesc, formatOutputDesc } from '../../utils/formatters';
import { 
  PlayIcon, 
  StopIcon, 
  RefreshIcon, 
  PencilIcon, 
  ClipboardIcon, 
  TrashIcon, 
  LightningIcon, 
  ShieldIcon,
  CalendarIcon,
  ExportIcon
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
  onCloneProcess?: (service: ServiceItem) => void;
  onDeleteProcess: (service: ServiceItem) => void;
  onSelectedProcess: (service: ServiceItem) => void;
  onExportProcess?: (service: ServiceItem) => void;
  onCloneAsTask?: (service: ServiceItem) => void;
  API?: string;
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
  onExportProcess,
  onCloneAsTask
}) => {
  const { t } = useTranslation();
  const isRunning = service.status === 'running';
  const isError = service.status === 'error';
  const isPending = !!actionPending;
  const isRetrying = !!service.watchdog_enabled && (service.restart_count || 0) > 0 && service.status !== 'running' && service.status !== 'stopped';

  const cpu = telemetryItem?.cpu ?? service.cpu ?? 0;
  const ram = telemetryItem?.ram ?? service.ram ?? 0;
  const bitrate = telemetryItem?.bitrate || service.bitrate || '0 kb/s';
  const fps = telemetryItem?.fps || service.fps || '0';
  const speed = telemetryItem?.speed || service.speed || '0x';
  const pid = telemetryItem?.pid || service.pid;

  const serviceType = service.service_type || 'ffmpeg_stream';
  const isFfmpegStream = serviceType === 'ffmpeg_stream';

  const inputCfg = service.input_config || service.config?.input_config;
  const outputCfg = service.output_config || service.config?.output_config;

  return (
    <div 
      onClick={() => onSelectedProcess(service)}
      className={`group relative flex flex-col lg:flex-row lg:items-center justify-between p-3.5 rounded-xl border transition-all duration-200 cursor-pointer ${
        isRunning 
          ? 'bg-brand-lime/5 border-brand-lime/20 hover:bg-brand-lime/10 hover:border-brand-lime/40' 
          : isError
          ? 'bg-red-500/5 border-red-500/20 hover:bg-red-500/10 hover:border-red-500/40'
          : 'bg-white/2 hover:bg-white/5 border-[var(--glass-border)] opacity-85 hover:opacity-100'
      }`}
    >
      {/* Left Info Column */}
      <div className="flex flex-col gap-1.5 min-w-0 flex-1 pr-4">
        {/* Title & Badges Row */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Status Indicator Dot */}
          <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
            actionPending === 'starting' ? 'bg-blue-500 animate-pulse' :
            actionPending === 'stopping' ? 'bg-brand-orange animate-pulse' :
            actionPending === 'restarting' ? 'bg-purple-500 animate-pulse' :
            isRetrying ? 'bg-brand-orange animate-pulse' :
            isRunning ? 'bg-brand-lime shadow-[0_0_6px_rgba(212,255,91,0.5)]' :
            isError ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]' :
            'bg-zinc-600'
          }`} />

          {/* Service Title & Alias */}
          <span className="font-bold text-[var(--text-primary)] text-sm group-hover:text-brand-lime transition-colors truncate">
            {service.alias || service.name}
            {service.alias && (
              <span className="text-xs font-normal text-[var(--text-secondary)] ml-1.5 opacity-80" title={`Original Name: ${service.name}`}>
                [{service.name}]
              </span>
            )}
          </span>

          {/* Service Type Tag */}
          <span className={`text-[9px] uppercase font-mono px-2 py-0.5 rounded border font-bold ${
            serviceType === 'ffmpeg_stream' 
              ? 'bg-brand-orange/10 text-brand-orange border-brand-orange/30' 
              : serviceType === 'icecast_server' 
              ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' 
              : serviceType === 'kiosk_browser' 
              ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' 
              : 'bg-purple-500/10 text-purple-400 border-purple-500/30'
          }`}>
            {serviceType === 'ffmpeg_stream' 
              ? 'FFmpeg' 
              : serviceType === 'icecast_server' 
              ? 'Icecast' 
              : serviceType === 'kiosk_browser' 
              ? 'Kiosk' 
              : 'Service'}
          </span>

          {/* Badges */}
          {service.pending_changes && (
            <span className="text-[9px] bg-brand-orange/20 text-brand-orange border border-brand-orange/30 px-2 py-0.5 rounded font-black animate-pulse">
              PENDING REBOOT
            </span>
          )}

          {service.auto_start && (
            <span className="text-[9px] bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded font-bold flex items-center gap-1" title={`Auto-starts on boot (Order #${service.startup_order || 1}${service.startup_delay ? `, Delay ${service.startup_delay}s` : ''})`}>
              <LightningIcon size={10} /> BOOT (#{service.startup_order || 1}{service.startup_delay ? ` | ${service.startup_delay}s` : ''})
            </span>
          )}

          {service.watchdog_enabled && (
            <span 
              className="text-[9px] bg-purple-500/20 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded font-bold flex items-center gap-1" 
              title={`Monitored by system watchdog${service.restart_count ? ` (${t('services.restartCount', 'Restarts')}: ${service.restart_count})` : ''}`}
            >
              <ShieldIcon size={10} /> WATCHDOG{service.restart_count && service.restart_count > 0 ? ` (${service.restart_count})` : ''}
            </span>
          )}

          {service.dependencies && service.dependencies.length > 0 && (
            <span className="text-[9px] bg-brand-lime/20 text-brand-lime border border-brand-lime/30 px-2 py-0.5 rounded font-bold flex items-center gap-1">
              🔗 LINKED ({service.dependencies.length})
            </span>
          )}

          {isRetrying && (
            <span className="text-[9px] bg-brand-orange/20 text-brand-orange border border-brand-orange/30 px-2 py-0.5 rounded font-black animate-pulse flex items-center gap-1">
              ⚠️ {t('services.retrying', 'RETRYING')} ({service.restart_count}{service.watchdog_retries !== undefined && service.watchdog_retries !== null ? `/${service.watchdog_retries === -1 ? '∞' : service.watchdog_retries}` : ''})
            </span>
          )}

          {service.status === 'error' && !isRetrying && (
            <span className="text-[9px] bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded font-bold flex items-center gap-1" title="Process exited with error / stopped abnormally">
              ⚠ ABNORMAL END
            </span>
          )}
        </div>

        {/* I/O Description Details */}
        <div className="text-xs text-[var(--text-secondary)] space-y-0.5 font-mono truncate">
          {inputCfg && (
            <p className="truncate">
              In: <code className="text-[var(--text-primary)]">{formatInputDesc(inputCfg)}</code>
            </p>
          )}
          {outputCfg && (
            <p className="truncate">
              Out: <code className="text-[var(--text-primary)]">{formatOutputDesc(outputCfg)}</code>
            </p>
          )}
        </div>

        {/* Compact Telemetry Strip */}
        <div className="flex gap-x-3 gap-y-1 mt-0.5 text-xs text-[var(--text-secondary)] flex-wrap items-center font-mono tabular-nums">
          <span>PID: <strong className={isRunning && pid ? "text-[var(--text-primary)] font-bold" : "text-zinc-500 font-normal"}>{isRunning && pid ? pid : t('common.offline', 'OFFLINE')}</strong></span>
          <span className="opacity-20">|</span>
          <span>Uptime: <strong className="text-[var(--text-primary)]">{formatUptime(service.last_start)}</strong></span>
          <span className="opacity-20">|</span>
          <span>CPU: <strong className={cpu > 80 ? 'text-red-400 font-bold' : 'text-[var(--text-primary)]'}>{cpu}%</strong></span>
          <span className="opacity-20">|</span>
          <span>RAM: <strong className="text-[var(--text-primary)]">{ram} MB</strong></span>
          {isFfmpegStream && hasVideo(service) && fps && fps !== '0' && (
            <>
              <span className="opacity-20">|</span>
              <span>FPS: <strong className="text-[var(--text-primary)]">{fps}</strong></span>
            </>
          )}
          {bitrate && bitrate !== 'N/A' && bitrate !== '0 kb/s' && bitrate !== '0.0kbits/s' && (
            <>
              <span className="opacity-20">|</span>
              <span>Bitrate: <strong className="text-brand-lime font-bold">{bitrate}</strong></span>
            </>
          )}
          {speed && speed !== '0x' && (
            <>
              <span className="opacity-20">|</span>
              <span>Speed: <strong className="text-[var(--text-primary)]">{speed}</strong></span>
            </>
          )}
        </div>
      </div>

      {/* Right Iconic Action Button Bar */}
      <div className="flex items-center gap-1.5 mt-3 lg:mt-0 flex-shrink-0" onClick={e => e.stopPropagation()}>
        {/* Edit Button */}
        <button
          disabled={isPending}
          onClick={() => onEditProcess(service)}
          className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 transition-all hover:scale-105 disabled:opacity-50"
          title={t('common.edit', 'Edit Service Settings')}
        >
          <PencilIcon size={16} />
        </button>

        {/* Clone Service Button */}
        {onCloneProcess && (
          <button
            disabled={isPending}
            onClick={() => onCloneProcess(service)}
            className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 transition-all hover:scale-105 disabled:opacity-50"
            title={t('services.cloneService', 'Clone Service')}
          >
            <ClipboardIcon size={16} />
          </button>
        )}

        {/* Clone as Task Button (Conditional for FFmpeg Streams Only) */}
        {isFfmpegStream && onCloneAsTask && (
          <button
            disabled={isPending}
            onClick={() => onCloneAsTask(service)}
            className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 transition-all hover:scale-105 text-brand-lime disabled:opacity-50"
            title={t('services.cloneAsTask', 'Copy as Task')}
          >
            <CalendarIcon size={16} />
          </button>
        )}

        {/* Export Button */}
        {onExportProcess && (
          <button
            disabled={isPending}
            onClick={() => onExportProcess(service)}
            className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 transition-all hover:scale-105 disabled:opacity-50"
            title={t('services.exportService', 'Export Service')}
          >
            <ExportIcon size={16} />
          </button>
        )}

        {/* Restart Button */}
        {isRunning && (
          <button
            disabled={isPending}
            onClick={() => onRestartService(service.id, service.name)}
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-105 disabled:opacity-50 ${
              actionPending === 'restarting'
                ? "bg-blue-500/20 border border-blue-500 text-blue-400"
                : service.pending_changes
                ? "bg-brand-orange/20 hover:bg-brand-orange/30 border border-brand-orange text-brand-orange animate-pulse"
                : "bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400"
            }`}
            title={t('common.restart', 'Restart Service')}
          >
            <RefreshIcon size={16} className={actionPending === 'restarting' ? 'animate-spin' : ''} />
          </button>
        )}

        {/* Start / Stop Button */}
        {isRunning || isRetrying ? (
          <button
            disabled={actionPending === 'stopping'}
            onClick={() => onStopService(service.id, service.name)}
            className="w-9 h-9 rounded-xl bg-red-500/10 hover:bg-red-500/20 flex items-center justify-center border border-red-500/20 text-red-400 transition-all hover:scale-105 disabled:opacity-50"
            title={t('common.stop', 'Stop Service')}
          >
            {actionPending === 'stopping' ? (
              <RefreshIcon size={16} className="animate-spin text-brand-orange" />
            ) : (
              <StopIcon size={16} />
            )}
          </button>
        ) : (
          <button
            disabled={actionPending === 'starting' || actionPending === 'stopping'}
            onClick={() => onStartService(service.id)}
            className="w-9 h-9 rounded-xl bg-brand-lime/10 hover:bg-brand-lime/20 flex items-center justify-center border border-brand-lime/20 text-brand-lime transition-all hover:scale-105 disabled:opacity-50"
            title={t('common.start', 'Start Service')}
          >
            {actionPending === 'starting' ? (
              <RefreshIcon size={16} className="animate-spin text-brand-lime" />
            ) : (
              <PlayIcon size={16} />
            )}
          </button>
        )}

        {/* Delete Button */}
        <button
          disabled={isRunning || isRetrying || isPending}
          onClick={() => onDeleteProcess(service)}
          className="w-9 h-9 rounded-xl bg-red-500/5 hover:bg-red-500/20 flex items-center justify-center border border-red-500/20 text-red-400 transition-all hover:scale-105 disabled:opacity-30 disabled:pointer-events-none"
          title={t('common.delete', 'Delete Service')}
        >
          <TrashIcon size={16} />
        </button>
      </div>
    </div>
  );
};
