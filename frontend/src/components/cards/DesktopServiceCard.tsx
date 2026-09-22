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

interface DesktopServiceCardProps {
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

export const DesktopServiceCard: React.FC<DesktopServiceCardProps> = ({
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
  const isRetrying = !!service.watchdog_enabled && (service.restart_count || 0) > 0 && service.status !== 'running' && service.status !== 'stopped';

  const cpu = telemetryItem?.cpu_usage ?? telemetryItem?.cpu ?? service.cpu ?? 0;
  const ram = telemetryItem?.ram_usage ?? telemetryItem?.ram ?? service.ram ?? 0;
  const pid = telemetryItem?.pid || service.pid;

  const deskCfg = service.config?.desktop_config || (service as any).desktop_config || {};
  const displayNum = deskCfg.display_num ?? 99;
  const vncPort = deskCfg.vnc_port ?? (5900 + displayNum);
  const resolution = deskCfg.resolution || '1920x1080';
  const framerate = deskCfg.framerate || 30;
  const colorDepth = deskCfg.color_depth || 24;

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
            className={`w-2 h-2 rounded-full shrink-0 ${
              isRunning
                ? 'bg-brand-lime shadow-[0_0_8px_var(--color-brand-lime,#D4FF5B)]'
                : isError
                ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]'
                : 'bg-white/20'
            }`}
          />

          <h4 className="font-bold text-sm text-[var(--text-primary)] truncate tracking-wide">
            {service.name}
          </h4>

          {service.alias && (
            <span className="text-[10px] bg-white/5 text-[var(--text-secondary)] border border-[var(--glass-border)] px-1.5 py-0.5 rounded font-mono">
              {service.alias}
            </span>
          )}

          {/* Service Engine Type Badge */}
          <span className="text-[9px] px-2 py-0.5 rounded font-black tracking-wider uppercase flex items-center gap-1 border bg-cyan-500/10 text-cyan-400 border-cyan-500/30">
            <EngineLogo softwareType="desktop" size={12} API={API} />
            Desktop Server
          </span>

          {/* Screen Resolution & Display Badge */}
          <span className="text-[9px] bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded font-mono font-bold flex items-center gap-1">
            🖥️ :{displayNum} ({resolution} @ {framerate}fps, {colorDepth}bpp)
          </span>

          {/* Local VNC Port Badge */}
          <span className="text-[9px] bg-sky-500/10 text-sky-400 border border-sky-500/30 px-2 py-0.5 rounded font-mono font-semibold flex items-center gap-1">
            🔑 VNC :{vncPort} (127.0.0.1)
          </span>

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

          {/* Active Consumers Leases Badge */}
          {service.active_leases && service.active_leases.length > 0 ? (
            <span
              className="text-[9px] bg-brand-lime/20 text-brand-lime border border-brand-lime/30 px-2 py-0.5 rounded font-black flex items-center gap-1 shadow-[0_0_8px_rgba(212,255,91,0.2)]"
              title={`Active connected consumers: ${service.active_leases.join(', ')}`}
            >
              🔗 {service.active_leases.length} {service.active_leases.length === 1 ? 'LEASE' : 'LEASES'}
            </span>
          ) : (
            <span
              className="text-[9px] bg-white/5 text-[var(--text-secondary)] border border-white/10 px-2 py-0.5 rounded font-medium flex items-center gap-1"
              title="No active tasks or services currently leasing this display."
            >
              🔗 0 LEASES
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

        {/* Desktop Specifications Strip */}
        <div className="text-xs text-[var(--text-secondary)] font-mono flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider">Engine:</span>
          <span className="px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 text-[10px]">
            Xvfb Display :{displayNum} ({resolution})
          </span>
          <span className="px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20 text-[10px]">
            x11vnc TCP :{vncPort} (WS RFB)
          </span>
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
      <div className="flex items-center gap-1.5 mt-3 lg:mt-0 shrink-0" onClick={(e) => e.stopPropagation()}>
        {isRunning ? (
          <>
            <button
              onClick={() => onRestartService(service.id, service.name)}
              disabled={isPending}
              className="p-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 transition-all disabled:opacity-50 cursor-pointer"
              title={t('common.restart', 'Restart')}
            >
              <RefreshIcon size={14} className={actionPending === 'restarting' ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={() => onStopService(service.id, service.name)}
              disabled={isPending}
              className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition-all disabled:opacity-50 cursor-pointer"
              title={t('common.stop', 'Stop')}
            >
              <StopIcon size={14} />
            </button>
          </>
        ) : (
          <button
            onClick={() => onStartService(service.id)}
            disabled={isPending}
            className="p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 transition-all disabled:opacity-50 cursor-pointer"
            title={t('common.start', 'Start')}
          >
            <PlayIcon size={14} />
          </button>
        )}

        <button
          onClick={() => onEditProcess(service)}
          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--glass-border)] transition-all cursor-pointer"
          title={t('common.edit', 'Edit')}
        >
          <PencilIcon size={14} />
        </button>

        {onCloneProcess && (
          <button
            onClick={() => onCloneProcess(service)}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--glass-border)] transition-all cursor-pointer"
            title={t('common.copy', 'Clone')}
          >
            <ClipboardIcon size={14} />
          </button>
        )}

        {onExportProcess && (
          <button
            onClick={() => onExportProcess(service)}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--glass-border)] transition-all cursor-pointer"
            title={t('common.export', 'Export JSON')}
          >
            <ExportIcon size={14} />
          </button>
        )}

        <button
          onClick={() => onDeleteProcess(service)}
          disabled={isRunning || isPending}
          className="p-1.5 rounded-lg bg-white/5 hover:bg-red-500/20 text-[var(--text-secondary)] hover:text-red-400 border border-[var(--glass-border)] hover:border-red-500/30 transition-all disabled:opacity-30 cursor-pointer"
          title={t('common.delete', 'Delete')}
        >
          <TrashIcon size={14} />
        </button>
      </div>
    </div>
  );
};
