import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  PlayIcon,
  StopIcon,
  RefreshIcon,
  PencilIcon,
  TrashIcon,
  ShieldIcon,
  ClipboardIcon,
  ExportIcon,
  LightningIcon,
} from '../Icons';
import { EngineLogo } from '../common/EngineLogo';
import type { ServiceItem } from './UnifiedServiceCard';

interface KioskServiceCardProps {
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
  API?: string;
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

export const KioskServiceCard: React.FC<KioskServiceCardProps> = ({
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
  API = '',
}) => {
  const { t } = useTranslation();

  const isRunning = service.status === 'running';
  const isError = service.status === 'error';
  const isPending = !!actionPending;
  const isRetrying =
    !!service.watchdog_enabled &&
    (service.restart_count || 0) > 0 &&
    service.status !== 'running' &&
    service.status !== 'stopped';

  const cpu = telemetryItem?.cpu_usage ?? telemetryItem?.cpu ?? service.cpu ?? 0;
  const ram = telemetryItem?.ram_usage ?? telemetryItem?.ram ?? service.ram ?? 0;
  const pid = telemetryItem?.pid || service.pid;

  const kCfg = service.config?.kiosk_config || (service as any).kiosk_config || {};
  const engineId = (kCfg.engine_id || 'chromium').toLowerCase();
  const targetUrl = kCfg.target_source || 'about:blank';
  const desktopId = kCfg.desktop_service_id ?? '?';
  const diskCacheDisabled = kCfg.disk_cache_disabled !== false;

  return (
    <div
      onClick={() => onSelectedProcess(service)}
      className={`group relative flex flex-col lg:flex-row lg:items-center justify-between p-3.5 rounded-xl border transition-all duration-200 cursor-pointer ${
        isRunning
          ? 'bg-amber-500/5 border-amber-500/20 hover:bg-amber-500/10 hover:border-amber-500/40'
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
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              isRunning
                ? 'bg-brand-lime shadow-[0_0_8px_var(--color-brand-lime,#D4FF5B)]'
                : isError
                ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]'
                : 'bg-white/20'
            }`}
          />

          <h4 className="font-bold text-sm text-[var(--text-primary)] group-hover:text-amber-400 transition-colors truncate tracking-wide">
            {service.alias || service.name}
            {service.alias && (
              <span className="text-xs font-normal text-[var(--text-secondary)] ml-1.5 opacity-80" title={`Original Name: ${service.name}`}>
                [{service.name}]
              </span>
            )}
          </h4>

          {/* Service Engine Type Badge */}
          <span className="text-[9px] px-2 py-0.5 rounded font-black tracking-wider uppercase flex items-center gap-1 border bg-amber-500/10 text-amber-400 border-amber-500/30">
            <EngineLogo softwareType={engineId} size={12} API={API} />
            {engineId === 'firefox' ? 'Firefox Kiosk' : 'Chrome Kiosk'}
          </span>

          {/* Linked Virtual Desktop Badge */}
          <span
            className="text-[9px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 px-2 py-0.5 rounded font-mono font-bold flex items-center gap-1"
            title={`Assigned to Virtual Desktop #${desktopId}`}
          >
            🖥️ Desktop #{desktopId}
          </span>

          {/* Autostart on Boot */}
          {service.auto_start && (
            <span
              className="text-[9px] bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded font-bold flex items-center gap-1"
              title={`Auto-starts on boot (Order #${service.startup_order || 2}${service.startup_delay ? `, Delay ${service.startup_delay}s` : ''})`}
            >
              <LightningIcon size={10} /> BOOT (#{service.startup_order || 2}{service.startup_delay ? ` | ${service.startup_delay}s` : ''})
            </span>
          )}

          {/* Watchdog */}
          {service.watchdog_enabled && (
            <span
              className="text-[9px] bg-purple-500/20 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded font-bold flex items-center gap-1"
              title={`Monitored by daemon watchdog${service.restart_count ? ` (${t('services.restartCount', 'Restarts')}: ${service.restart_count})` : ''}`}
            >
              <ShieldIcon size={10} /> WATCHDOG{service.restart_count && service.restart_count > 0 ? ` (${service.restart_count})` : ''}
            </span>
          )}

          {isRetrying && (
            <span className="text-[9px] bg-brand-orange/20 text-brand-orange border border-brand-orange/30 px-2 py-0.5 rounded font-black animate-pulse flex items-center gap-1">
              ⚠️ {t('services.retrying', 'RETRYING')} ({service.restart_count})
            </span>
          )}

          {service.status === 'error' && !isRetrying && (
            <span
              className="text-[9px] bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded font-bold flex items-center gap-1"
              title="Service failed to start or exited abnormally"
            >
              ⚠ FAILED
            </span>
          )}
        </div>

        {/* Kiosk Specifications Strip */}
        <div className="text-xs text-[var(--text-secondary)] font-mono flex items-center gap-2 flex-wrap truncate">
          <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider">URL:</span>
          <span className="px-2 py-0.5 rounded bg-[var(--input-bg)] text-[var(--text-primary)] border border-[var(--glass-border)] text-[10px] font-mono font-bold truncate max-w-md">
            🔗 {targetUrl}
          </span>
          {diskCacheDisabled && (
            <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px] font-mono font-semibold" title="SATADOM flash protection active">
              🛡️ Flash-Safe
            </span>
          )}
        </div>

        {/* Compact Telemetry Strip */}
        <div className="flex gap-x-3 gap-y-1 mt-0.5 text-xs text-[var(--text-secondary)] flex-wrap items-center font-mono tabular-nums">
          <span>
            PID:{' '}
            <strong className={isRunning && pid ? 'text-[var(--text-primary)] font-bold' : 'text-zinc-500 font-normal'}>
              {isRunning && pid ? pid : t('common.offline', 'OFFLINE')}
            </strong>
          </span>
          <span className="opacity-20">|</span>
          <span>
            Uptime: <strong className="text-[var(--text-primary)]">{formatUptime(service.last_start, isRunning)}</strong>
          </span>
          <span className="opacity-20">|</span>
          <span>
            CPU:{' '}
            <strong className={isRunning && cpu > 80 ? 'text-red-400 font-bold' : 'text-[var(--text-primary)]'}>
              {isRunning ? `${cpu}%` : '-'}
            </strong>
          </span>
          <span className="opacity-20">|</span>
          <span>
            RAM: <strong className="text-[var(--text-primary)]">{isRunning ? `${ram} MB` : '-'}</strong>
          </span>
        </div>
      </div>

      {/* Right Iconic Action Button Bar */}
      <div className="flex items-center gap-1.5 mt-3 lg:mt-0 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
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
                ? 'bg-blue-500/20 border border-blue-500 text-blue-400'
                : 'bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400'
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
