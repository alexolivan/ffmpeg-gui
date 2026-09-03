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
  ExportIcon
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
}) => {
  const { t } = useTranslation();

  const isRunning = service.status === 'running';
  const isError = service.status === 'error';
  const isActionPending = !!actionPending;

  const iceCfg = service.config?.icecast_config || (service as any).icecast_config || {};
  const httpPort = iceCfg.port || 7000;
  const sslEnabled = iceCfg.ssl_enabled === true;
  const sslPort = iceCfg.ssl_port || 7443;
  const httpEnabled = iceCfg.http_enabled !== false;

  const configuredMounts: any[] = Array.isArray(iceCfg.mounts) ? iceCfg.mounts : [];

  // Granular stats extracted from watchdog telemetry
  const stats = service.config?.icecast_stats || {};
  const listenersCount = stats.listeners ?? (telemetryItem?.fps && !isNaN(Number(telemetryItem.fps)) ? Number(telemetryItem.fps) : 0);
  const peakListeners = stats.listener_peak ?? 0;
  const liveSources: any[] = Array.isArray(stats.sources) ? stats.sources : [];

  // Build target web console URL
  const host = window.location.hostname || '127.0.0.1';
  const webConsoleUrl = sslEnabled
    ? `https://${host}:${sslPort}/admin/`
    : `http://${host}:${httpPort}/admin/`;

  return (
    <div
      onClick={() => onSelectedProcess(service)}
      className={`group relative bg-[var(--bg-card)] rounded-2xl border transition-all duration-300 overflow-hidden flex flex-col justify-between cursor-pointer ${
        isRunning
          ? 'border-[var(--glass-border)] hover:border-brand-lime/60 shadow-lg hover:shadow-brand-lime/5'
          : isError
          ? 'border-red-500/40 hover:border-red-500/60 shadow-lg hover:shadow-red-500/5'
          : 'border-[var(--glass-border)] hover:border-[var(--text-secondary)]/40 opacity-90'
      }`}
    >
      {/* Top Header */}
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] flex items-center justify-center p-2 group-hover:border-brand-lime/40 transition-colors">
              <EngineLogo softwareType="icecast2" size={24} />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-[var(--text-primary)] group-hover:text-brand-lime transition-colors">
                  {service.name}
                </h3>
                {service.alias && (
                  <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--glass-border)]">
                    {service.alias}
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--text-secondary)] flex items-center gap-1.5 mt-0.5">
                <span>Icecast2 Server</span>
                <span className="text-[var(--glass-border)]">•</span>
                <span>{formatUptime(service.last_start, isRunning)}</span>
              </p>
            </div>
          </div>

          {/* Status Badge */}
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                isRunning
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : isError
                  ? 'bg-red-500/10 text-red-400 border-red-500/30'
                  : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isRunning ? 'bg-emerald-400 animate-pulse' : isError ? 'bg-red-400' : 'bg-zinc-400'
                }`}
              />
              {service.status}
            </span>
          </div>
        </div>

        {/* Ports Badges & Web Admin link */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {httpEnabled && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--glass-border)]">
              HTTP :{httpPort}
            </span>
          )}

          {sslEnabled && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-brand-lime/10 text-brand-lime border border-brand-lime/30 flex items-center gap-1">
              <ShieldIcon size={12} />
              HTTPS :{sslPort}
            </span>
          )}

          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--glass-border)]">
            📌 {configuredMounts.length} {t('services.icecast.mountsBadge', 'Montajes')}
          </span>

          {isRunning && (
            <a
              href={webConsoleUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="ml-auto text-[11px] text-brand-lime hover:underline font-semibold flex items-center gap-1 py-0.5 px-2 rounded bg-brand-lime/10 border border-brand-lime/30"
              title="Abrir Consola Web de Administración Icecast"
            >
              <span>🌐</span>
              <span>{t('services.icecast.openAdmin', 'Web Admin')}</span>
            </a>
          )}
        </div>

        {/* Live Mountpoints Pills */}
        <div className="flex flex-wrap gap-1 pt-1">
          {(liveSources.length > 0 ? liveSources : configuredMounts.slice(0, 3)).map((m: any, idx: number) => {
            const mName = m.mount || m.mount_name;
            const mListeners = m.listeners ?? 0;
            return (
              <span
                key={idx}
                className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-[var(--input-bg)]/80 border border-[var(--glass-border)] text-[var(--text-secondary)] flex items-center gap-1"
              >
                <span className="text-brand-lime">/</span>
                <span>{mName.replace(/^\//, '')}</span>
                {isRunning && (
                  <span className="text-emerald-400 text-[9px] font-bold">({mListeners})</span>
                )}
              </span>
            );
          })}
          {configuredMounts.length > 3 && liveSources.length === 0 && (
            <span className="text-[10px] text-[var(--text-secondary)] px-1">
              +{configuredMounts.length - 3}
            </span>
          )}
        </div>
      </div>

      {/* Telemetry Bar */}
      <div className="px-4 py-2.5 bg-[var(--input-bg)]/50 border-t border-[var(--glass-border)] flex items-center justify-between text-xs text-[var(--text-secondary)]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1" title="Oyentes conectados en tiempo real">
            <span className="text-brand-lime font-bold">🎧 {listenersCount}</span>
            <span className="text-[10px]">({t('services.icecast.peak', 'Pico')}: {peakListeners})</span>
          </div>

          <span className="text-[var(--glass-border)]">|</span>

          <div className="flex items-center gap-1" title="Uso de recursos">
            <span>CPU: <strong className="text-[var(--text-primary)]">{telemetryItem?.cpu_usage || 0}%</strong></span>
            <span className="text-[var(--glass-border)]">•</span>
            <span>RAM: <strong className="text-[var(--text-primary)]">{telemetryItem?.ram_usage || 0} MB</strong></span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {isRunning ? (
            <>
              <button
                type="button"
                disabled={isActionPending}
                onClick={() => onRestartService(service.id, service.name)}
                className="p-1.5 rounded-lg hover:bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-amber-400 transition-colors disabled:opacity-50"
                title={t('common.restart', 'Reiniciar')}
              >
                <RefreshIcon size={14} className={actionPending === 'restarting' ? 'animate-spin' : ''} />
              </button>

              <button
                type="button"
                disabled={isActionPending}
                onClick={() => onStopService(service.id, service.name)}
                className="p-1.5 rounded-lg hover:bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-red-400 transition-colors disabled:opacity-50"
                title={t('common.stop', 'Detener')}
              >
                <StopIcon size={14} />
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={isActionPending}
              onClick={() => onStartService(service.id)}
              className="p-1.5 rounded-lg hover:bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-emerald-400 transition-colors disabled:opacity-50"
              title={t('common.start', 'Iniciar')}
            >
              <PlayIcon size={14} />
            </button>
          )}

          <span className="text-[var(--glass-border)]">|</span>

          <button
            type="button"
            onClick={() => onEditProcess(service)}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-brand-lime transition-colors"
            title={t('common.edit', 'Editar')}
          >
            <PencilIcon size={14} />
          </button>

          {onCloneProcess && (
            <button
              type="button"
              disabled={isActionPending}
              onClick={() => onCloneProcess(service)}
              className="p-1.5 rounded-lg hover:bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-brand-lime transition-colors disabled:opacity-50"
              title={t('services.cloneService', 'Clonar')}
            >
              <ClipboardIcon size={14} />
            </button>
          )}

          {onExportProcess && (
            <button
              type="button"
              onClick={() => onExportProcess(service)}
              className="p-1.5 rounded-lg hover:bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-blue-400 transition-colors"
              title={t('common.export', 'Exportar')}
            >
              <ExportIcon size={14} />
            </button>
          )}

          <button
            type="button"
            onClick={() => onDeleteProcess(service)}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-red-400 transition-colors"
            title={t('common.delete', 'Eliminar')}
          >
            <TrashIcon size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};
