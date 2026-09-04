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
  LightningIcon
} from '../Icons';
import { EngineLogo } from '../common/EngineLogo';
import type { ServiceItem } from './UnifiedServiceCard';

interface IcecastServiceCardProps {
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

export const IcecastServiceCard: React.FC<IcecastServiceCardProps> = ({
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
  API,
}) => {
  const { t } = useTranslation();

  const isRunning = service.status === 'running';
  const isError = service.status === 'error';
  const isPending = !!actionPending;
  const isRetrying = !!service.watchdog_enabled && (service.restart_count || 0) > 0 && service.status !== 'running' && service.status !== 'stopped';

  const cpu = telemetryItem?.cpu_usage ?? telemetryItem?.cpu ?? service.cpu ?? 0;
  const ram = telemetryItem?.ram_usage ?? telemetryItem?.ram ?? service.ram ?? 0;
  const pid = telemetryItem?.pid || service.pid;

  const iceCfg = service.config?.icecast_config || (service as any).icecast_config || {};
  const httpPort = iceCfg.port || 7000;
  const sslEnabled = iceCfg.ssl_enabled === true;
  const sslPort = iceCfg.ssl_port || 7443;
  const httpEnabled = iceCfg.http_enabled !== false;

  const configuredMounts: any[] = Array.isArray(iceCfg.mounts) ? iceCfg.mounts : [];

  // Simplified global instance telemetry (total listeners and peak)
  const stats = service.config?.icecast_stats || {};
  const listenersCount = stats.listeners ?? 0;
  const peakListeners = stats.listener_peak ?? 0;

  return (
    <div
      onClick={() => onSelectedProcess(service)}
      className={`group relative flex flex-col lg:flex-row lg:items-center justify-between p-3.5 rounded-xl border transition-all duration-200 cursor-pointer ${
        isRunning
          ? 'bg-cyan-500/5 border-cyan-500/20 hover:bg-cyan-500/10 hover:border-cyan-500/40'
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
            className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
              actionPending === 'starting'
                ? 'bg-blue-500 animate-pulse'
                : actionPending === 'stopping'
                ? 'bg-brand-orange animate-pulse'
                : actionPending === 'restarting'
                ? 'bg-purple-500 animate-pulse'
                : isRetrying
                ? 'bg-brand-orange animate-pulse'
                : isRunning
                ? 'bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.5)]'
                : isError
                ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]'
                : 'bg-zinc-600'
            }`}
          />

          {/* Service Title & Alias */}
          <span className="font-bold text-[var(--text-primary)] text-sm group-hover:text-cyan-400 transition-colors truncate">
            {service.alias || service.name}
            {service.alias && (
              <span className="text-xs font-normal text-[var(--text-secondary)] ml-1.5 opacity-80" title={`Original Name: ${service.name}`}>
                [{service.name}]
              </span>
            )}
          </span>

          {/* Service Type Tag */}
          <span className="text-[9px] uppercase font-mono px-2 py-0.5 rounded border font-bold flex items-center gap-1.5 bg-cyan-500/10 text-cyan-400 border-cyan-500/30">
            <EngineLogo softwareType="icecast2" size={12} API={API} />
            Icecast2 Server
          </span>

          {/* SSL / TLS Badge */}
          {sslEnabled && (
            <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded font-bold flex items-center gap-1">
              <ShieldIcon size={10} /> TLS/SSL
            </span>
          )}

          {/* Configured Mountpoints Telemetry Badge */}
          {configuredMounts.length > 0 && (
            <span
              className="text-[9px] bg-purple-500/10 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded font-bold flex items-center gap-1"
              title={`${configuredMounts.length} ${t('services.icecast.mountsBadge', 'Montajes')}`}
            >
              📌 {configuredMounts.length} {t('services.icecast.mountsBadge', 'Montajes')}
            </span>
          )}

          {/* Pending Changes Reboot */}
          {service.pending_changes && (
            <span className="text-[9px] bg-brand-orange/20 text-brand-orange border border-brand-orange/30 px-2 py-0.5 rounded font-black animate-pulse">
              PENDING REBOOT
            </span>
          )}

          {/* Autostart on Boot */}
          {service.auto_start && (
            <span
              className="text-[9px] bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded font-bold flex items-center gap-1"
              title={`Auto-starts on boot (Order #${service.startup_order || 1}${service.startup_delay ? `, Delay ${service.startup_delay}s` : ''})`}
            >
              <LightningIcon size={10} /> BOOT (#{service.startup_order || 1}{service.startup_delay ? ` | ${service.startup_delay}s` : ''})
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

          {/* Active Broadcasters / Consumers Leases Badge */}
          {service.active_leases && service.active_leases.length > 0 ? (
            <span 
              className="text-[9px] bg-brand-lime/20 text-brand-lime border border-brand-lime/30 px-2 py-0.5 rounded font-black flex items-center gap-1 shadow-[0_0_8px_rgba(212,255,91,0.2)]"
              title={`Active connected broadcasters / consumers: ${service.active_leases.join(', ')}`}
            >
              🔗 {service.active_leases.length} {service.active_leases.length === 1 ? 'CONSUMER' : 'CONSUMERS'} ({service.active_leases.join(', ')})
            </span>
          ) : (
            <span 
              className="text-[9px] bg-white/5 text-[var(--text-secondary)] border border-white/10 px-2 py-0.5 rounded font-medium flex items-center gap-1"
              title="No active tasks or services currently leasing this Icecast server."
            >
              🔗 0 LEASES (IDLE)
            </span>
          )}

          {isRetrying && (
            <span className="text-[9px] bg-brand-orange/20 text-brand-orange border border-brand-orange/30 px-2 py-0.5 rounded font-black animate-pulse flex items-center gap-1">
              ⚠️ {t('services.retrying', 'RETRYING')} ({service.restart_count || 0})
            </span>
          )}

          {service.status === 'error' && !isRetrying && (
            <span className="text-[9px] bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded font-bold flex items-center gap-1" title="Service failed to start or exited abnormally">
              ⚠ FAILED
            </span>
          )}
        </div>

        {/* Icecast Ports & Simplified Global Telemetry */}
        <div className="text-xs text-[var(--text-secondary)] font-mono flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider">Listeners:</span>
          {httpEnabled && (
            <span className="px-1.5 py-0.2 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-[10px]">
              HTTP :{httpPort}
            </span>
          )}
          {sslEnabled && (
            <span className="px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px]">
              HTTPS :{sslPort}
            </span>
          )}
          {isRunning && (
            <span className="px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] font-bold">
              🎧 {listenersCount} {t('services.icecast.listeners', 'Oyentes')} ({t('services.icecast.peak', 'Pico')}: {peakListeners})
            </span>
          )}
        </div>

        {/* Compact Telemetry Strip */}
        <div className="flex gap-x-3 gap-y-1 mt-0.5 text-xs text-[var(--text-secondary)] flex-wrap items-center font-mono tabular-nums">
          <span>PID: <strong className={isRunning && pid ? 'text-[var(--text-primary)] font-bold' : 'text-zinc-500 font-normal'}>{isRunning && pid ? pid : t('common.offline', 'OFFLINE')}</strong></span>
          <span className="opacity-20">|</span>
          <span>Uptime: <strong className="text-[var(--text-primary)]">{formatUptime(service.last_start, isRunning)}</strong></span>
          <span className="opacity-20">|</span>
          <span>CPU: <strong className={isRunning && cpu > 80 ? 'text-red-400 font-bold' : 'text-[var(--text-primary)]'}>{isRunning ? `${cpu}%` : '-'}</strong></span>
          <span className="opacity-20">|</span>
          <span>RAM: <strong className="text-[var(--text-primary)]">{isRunning ? `${ram} MB` : '-'}</strong></span>
        </div>
      </div>

      {/* Right Iconic Action Button Bar */}
      <div className="flex items-center gap-1.5 mt-3 lg:mt-0 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
        {/* Edit Button */}
        <button
          disabled={isPending}
          onClick={() => onEditProcess(service)}
          className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 transition-all hover:scale-105 disabled:opacity-50 cursor-pointer"
          title={t('common.edit', 'Edit Service Settings')}
        >
          <PencilIcon size={16} />
        </button>

        {/* Clone Service Button */}
        {onCloneProcess && (
          <button
            disabled={isPending}
            onClick={() => onCloneProcess(service)}
            className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 transition-all hover:scale-105 disabled:opacity-50 cursor-pointer"
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
            className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 transition-all hover:scale-105 disabled:opacity-50 cursor-pointer"
            title={t('services.exportProfile', 'Export Profile')}
          >
            <ExportIcon size={16} />
          </button>
        )}

        {/* Restart Button */}
        {isRunning && (
          <button
            disabled={isPending}
            onClick={() => onRestartService(service.id, service.name)}
            className={`w-9 h-9 rounded-xl flex items-center justify-center border transition-all hover:scale-105 disabled:opacity-50 cursor-pointer ${
              service.pending_changes
                ? 'bg-brand-orange text-black border-brand-orange/40 animate-pulse shadow-lg shadow-brand-orange/20'
                : 'bg-white/5 hover:bg-white/10 border-white/10 text-cyan-400'
            }`}
            title={t('services.restartService', 'Restart Service')}
          >
            {actionPending === 'restarting' ? (
              <span className="w-3.5 h-3.5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin inline-block" />
            ) : (
              <RefreshIcon size={16} />
            )}
          </button>
        )}

        {/* Start / Stop Action Controls */}
        {isRunning || isRetrying ? (
          <button
            disabled={actionPending === 'stopping'}
            onClick={() => onStopService(service.id, service.name)}
            className="w-9 h-9 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 flex items-center justify-center transition-all hover:scale-105 disabled:opacity-50 cursor-pointer"
            title={t('services.stopService', 'Stop Service')}
          >
            {actionPending === 'stopping' ? (
              <span className="w-3.5 h-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin inline-block" />
            ) : (
              <StopIcon size={16} />
            )}
          </button>
        ) : (
          <button
            disabled={actionPending === 'starting'}
            onClick={() => onStartService(service.id)}
            className="w-9 h-9 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 flex items-center justify-center transition-all hover:scale-105 disabled:opacity-50 cursor-pointer"
            title={t('services.startService', 'Start Service')}
          >
            {actionPending === 'starting' ? (
              <span className="w-3.5 h-3.5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin inline-block" />
            ) : (
              <PlayIcon size={16} />
            )}
          </button>
        )}

        {/* Delete Service */}
        <button
          disabled={isPending || isRunning}
          onClick={() => onDeleteProcess(service)}
          className="w-9 h-9 rounded-xl bg-white/5 hover:bg-red-500/20 hover:text-red-400 flex items-center justify-center border border-white/10 transition-all hover:scale-105 disabled:opacity-30 cursor-pointer"
          title={t('common.delete', 'Delete Service')}
        >
          <TrashIcon size={16} />
        </button>
      </div>
    </div>
  );
};
