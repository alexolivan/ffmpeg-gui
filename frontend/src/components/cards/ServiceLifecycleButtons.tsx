import React from 'react';
import { useTranslation } from 'react-i18next';
import { CheckIcon, LightningIcon, PlayIcon, RefreshIcon, StopIcon } from '../Icons';
import { getReloadButtonState, getRestartButtonState } from '../../utils/serviceActionStyles';

interface ServiceLifecycleButtonsProps {
  serviceId: number;
  serviceName: string;
  canOperate: boolean;
  isRunning: boolean;
  isRetrying?: boolean;
  actionPending?: 'starting' | 'stopping' | 'restarting';
  isReloading?: boolean;
  isReloadAck?: boolean;
  pendingChanges?: boolean;
  pendingChangeMode?: 'none' | 'reload' | 'restart' | string;
  onStartService: (procId: number) => void;
  onStopService: (procId: number, name?: string) => void;
  onRestartService: (procId: number, name: string) => void;
  onReloadService?: (procId: number, name?: string) => void;
}

/**
 * Unified service lifecycle action buttons (Reload, Restart, Start/Stop) matching
 * FfmpegServiceCard's polished translucent style, click feedback, and state priority.
 */
export const ServiceLifecycleButtons: React.FC<ServiceLifecycleButtonsProps> = ({
  serviceId,
  serviceName,
  canOperate,
  isRunning,
  isRetrying = false,
  actionPending,
  isReloading = false,
  isReloadAck = false,
  pendingChanges = false,
  pendingChangeMode,
  onStartService,
  onStopService,
  onRestartService,
  onReloadService,
}) => {
  const { t } = useTranslation();

  if (!canOperate) return null;

  const isPending = !!actionPending || isReloading;
  const isPendingReload = pendingChangeMode === 'reload';
  const isPendingRestart = Boolean(pendingChanges && !isPendingReload);

  const reloadVisual = getReloadButtonState({
    isReloading,
    isReloadAck,
    isPendingReload,
  });

  const restartVisual = getRestartButtonState({
    isRestarting: actionPending === 'restarting',
    isPendingRestart,
  });

  return (
    <>
      {isRunning && onReloadService && (
        <button
          disabled={isPending}
          onClick={() => onReloadService(serviceId, serviceName)}
          className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-105 disabled:opacity-50 cursor-pointer ${reloadVisual.className}`}
          title={
            isReloadAck
              ? t('services.reloadAckTooltip', 'Live configuration reloaded')
              : isPendingReload
              ? t('services.reloadPendingTooltip', 'Live-reloadable changes pending — apply without dropping active listeners/streams')
              : t('services.reloadService', 'Reload Config (Live)')
          }
        >
          {reloadVisual.spinIcon ? (
            <RefreshIcon size={16} className="animate-spin" />
          ) : reloadVisual.showCheck ? (
            <CheckIcon size={16} />
          ) : (
            <LightningIcon size={16} />
          )}
        </button>
      )}

      {isRunning && (
        <button
          disabled={isPending}
          onClick={() => onRestartService(serviceId, serviceName)}
          className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-105 disabled:opacity-50 cursor-pointer ${restartVisual.className}`}
          title={
            isPendingRestart
              ? t('services.restartPendingTooltip', 'Structural changes pending (ports, bind, TLS or relays) — full restart required')
              : t('common.restart', 'Restart Service')
          }
        >
          <RefreshIcon size={16} className={restartVisual.spinIcon ? 'animate-spin' : ''} />
        </button>
      )}

      {isRunning || isRetrying ? (
        <button
          disabled={actionPending === 'stopping'}
          onClick={() => onStopService(serviceId, serviceName)}
          className="w-9 h-9 rounded-xl bg-red-500/10 hover:bg-red-500/20 flex items-center justify-center border border-red-500/20 text-red-400 transition-all hover:scale-105 disabled:opacity-50 cursor-pointer"
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
          onClick={() => onStartService(serviceId)}
          className="w-9 h-9 rounded-xl bg-brand-lime/10 hover:bg-brand-lime/20 flex items-center justify-center border border-brand-lime/20 text-brand-lime transition-all hover:scale-105 disabled:opacity-50 cursor-pointer"
          title={t('common.start', 'Start Service')}
        >
          {actionPending === 'starting' ? (
            <RefreshIcon size={16} className="animate-spin text-brand-lime" />
          ) : (
            <PlayIcon size={16} />
          )}
        </button>
      )}
    </>
  );
};
