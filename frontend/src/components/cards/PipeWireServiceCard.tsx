import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  PlayIcon,
  StopIcon,
  RefreshIcon,
  PencilIcon,
  TrashIcon,
  ClipboardIcon,
  ExportIcon,
  LightningIcon,
} from '../Icons';
import { EngineLogo } from '../common/EngineLogo';
import type { ServiceItem } from './UnifiedServiceCard';

interface PipeWireServiceCardProps {
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

export const PipeWireServiceCard: React.FC<PipeWireServiceCardProps> = ({
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
}) => {
  const { t } = useTranslation();
  const isRunning = service.status === 'running';
  const isPending = !!actionPending;
  const restartCount = service.restart_count || 0;
  const isRetrying =
    !!service.watchdog_enabled && restartCount > 0 && service.status !== 'running' && service.status !== 'stopped';

  const cpu = telemetryItem?.cpu ?? service.cpu ?? 0;
  const ram = telemetryItem?.ram ?? service.ram ?? 0;
  const pid = telemetryItem?.pid || service.pid;

  const pwConfig = service.config?.pipewire_config || service.config || {};
  const sampleRate = pwConfig.sample_rate || 48000;
  const quantum = pwConfig.quantum || 1024;
  const virtualSinks = Array.isArray(pwConfig.virtual_sinks) ? pwConfig.virtual_sinks : [];
  const aes67Net = pwConfig.aes67_network || {};
  const isAes67Enabled = !!aes67Net.enabled;
  const aes67Interface = aes67Net.interface || null;

  return (
    <div
      onClick={() => onSelectedProcess(service)}
      className={`group relative flex flex-col lg:flex-row lg:items-center justify-between p-4 rounded-xl border transition-all duration-200 cursor-pointer ${
        isRunning
          ? 'bg-purple-500/5 border-purple-500/30 hover:bg-purple-500/10 hover:border-purple-500/50'
          : service.status === 'error'
          ? 'bg-red-500/5 border-red-500/20 hover:bg-red-500/10 hover:border-red-500/40'
          : 'bg-white/2 hover:bg-white/5 border-[var(--glass-border)] opacity-85 hover:opacity-100'
      }`}
    >
      {/* Left Info Column */}
      <div className="flex flex-col gap-2 min-w-0 flex-1 pr-4">
        {/* Title & Engine Type Badges Row */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-2">
            <EngineLogo softwareType="pipewire" size={20} />
            <h4 className="font-bold text-base text-[var(--text-primary)] group-hover:text-purple-400 transition-colors truncate">
              {service.name}
            </h4>
          </div>

          <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-400 border border-purple-500/30">
            {t('services.pipewire.service_name', 'PipeWire Audio Hub')}
          </span>

          {service.auto_start && (
            <span
              className="text-[9px] bg-brand-lime/10 text-brand-lime border border-brand-lime/20 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider flex items-center gap-1"
              title={t('services.autoStartEnabled', 'Auto-starts on system boot')}
            >
              <LightningIcon size={10} />
              {t('services.auto', 'AUTO')}
            </span>
          )}

          {/* Running State Indicators */}
          {isRunning && (
            <span className="text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded font-bold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {t('common.running', 'RUNNING')}
            </span>
          )}

          {isRetrying && (
            <span className="text-[9px] bg-brand-orange/20 text-brand-orange border border-brand-orange/30 px-2 py-0.5 rounded font-black animate-pulse flex items-center gap-1">
              ⚠️ {t('services.retrying', 'RETRYING')} ({restartCount})
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

        {/* Engine Specs & Virtual Sinks Strip */}
        <div className="text-xs text-[var(--text-secondary)] font-mono flex items-center gap-2 flex-wrap">
          <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] text-[var(--text-primary)]">
            {sampleRate} Hz
          </span>
          <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] text-[var(--text-primary)]">
            Q: {quantum}
          </span>
          <span className="opacity-20">|</span>

          {/* Aggregate Virtual Sinks Count Badge */}
          <span className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20 text-[10px] font-bold flex items-center gap-1">
            <span>
              {virtualSinks.length} {virtualSinks.length === 1 ? 'Sink' : 'Sinks'}
            </span>
            {virtualSinks.some((s: any) => s.aes67_enabled) && (
              <span className="text-[8px] bg-brand-lime/20 text-brand-lime px-1 rounded font-black">
                RTP
              </span>
            )}
          </span>

          <span className="opacity-20">|</span>

          {/* AES67 Status Pill */}
          {isAes67Enabled ? (
            <span className="px-1.5 py-0.5 rounded bg-brand-lime/10 text-brand-lime border border-brand-lime/20 text-[10px] font-bold flex items-center gap-1">
              <span>AES67 Tx</span>
              {aes67Interface && <span className="opacity-70 font-normal">@{aes67Interface}</span>}
            </span>
          ) : (
            <span className="px-1.5 py-0.5 rounded bg-white/5 text-zinc-400 border border-white/10 text-[10px]">
              {t('services.pipewire.localOnly', 'Local RAM Only')}
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
          className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 transition-all hover:scale-105 disabled:opacity-50 text-[var(--text-primary)]"
          title={t('common.edit', 'Edit Service Settings')}
        >
          <PencilIcon size={16} />
        </button>

        {/* Clone Service Button */}
        {onCloneProcess && (
          <button
            disabled={isPending}
            onClick={() => onCloneProcess(service)}
            className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 transition-all hover:scale-105 disabled:opacity-50 text-[var(--text-primary)]"
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
            className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 transition-all hover:scale-105 disabled:opacity-50 text-[var(--text-primary)]"
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
            className={`w-9 h-9 rounded-xl flex items-center justify-center border transition-all hover:scale-105 disabled:opacity-50 ${
              service.pending_changes
                ? 'bg-brand-orange text-black border-brand-orange/40 animate-pulse shadow-lg shadow-brand-orange/20'
                : 'bg-white/5 hover:bg-white/10 border-white/10 text-emerald-400'
            }`}
            title={t('services.restartService', 'Restart Service')}
          >
            {actionPending === 'restarting' ? (
              <span className="w-3.5 h-3.5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin inline-block" />
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
            className="w-9 h-9 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 flex items-center justify-center transition-all hover:scale-105 disabled:opacity-50"
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
            className="w-9 h-9 rounded-xl bg-brand-lime/10 hover:bg-brand-lime/20 text-brand-lime border border-brand-lime/20 flex items-center justify-center transition-all hover:scale-105 disabled:opacity-50"
            title={t('services.startService', 'Start Service')}
          >
            {actionPending === 'starting' ? (
              <span className="w-3.5 h-3.5 border-2 border-brand-lime border-t-transparent rounded-full animate-spin inline-block" />
            ) : (
              <PlayIcon size={16} />
            )}
          </button>
        )}

        {/* Delete Process Button */}
        <button
          disabled={isRunning || isPending}
          onClick={() => onDeleteProcess(service)}
          className="w-9 h-9 rounded-xl bg-red-500/5 hover:bg-red-500/15 text-red-400/70 hover:text-red-400 border border-red-500/10 hover:border-red-500/30 flex items-center justify-center transition-all hover:scale-105 disabled:opacity-30 disabled:cursor-not-allowed"
          title={
            isRunning
              ? t('services.cannotDeleteRunning', 'Stop service before deleting')
              : t('common.delete', 'Delete Service')
          }
        >
          <TrashIcon size={16} />
        </button>
      </div>
    </div>
  );
};
