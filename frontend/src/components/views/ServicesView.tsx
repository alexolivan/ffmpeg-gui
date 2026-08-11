import React from 'react';
import { useTranslation } from 'react-i18next';
import { 
  ImportIcon, 
  PlusIcon
} from '../Icons';
import { UnifiedServiceCard, hasVideo, type ServiceItem } from '../cards/UnifiedServiceCard';

export { hasVideo };

interface ServicesViewProps {
  telemetry: any[];
  actionPending: Record<number, 'starting' | 'stopping' | 'restarting'>;
  onEditProcess: (proc: any) => void;
  onCloneProcess: (proc: any) => void;
  onStartService: (procId: number) => void;
  onStopService: (procId: number, procName?: string) => void;
  onRestartService: (procId: number, name: string) => void;
  onDeleteProcess: (proc: any) => void;
  onSelectedProcess: (proc: any) => void;
  importFileRef: React.RefObject<HTMLInputElement | null>;
  handleImportFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  setShowAddModal: (show: boolean) => void;
  API: string;
}

export const isActiveService = (p: any, actionPending: Record<number, string> = {}) => {
  if (p.type && p.type !== 'service') return false;
  if (p.status === 'running' || p.status === 'starting' || p.status === 'stopping' || p.status === 'restarting') return true;
  if (actionPending[p.id]) return true;
  if (p.watchdog_enabled && p.restart_count > 0 && p.status !== 'stopped') return true;
  return false;
};

export const ServicesView: React.FC<ServicesViewProps> = ({
  telemetry,
  actionPending,
  onEditProcess,
  onCloneProcess,
  onStartService,
  onStopService,
  onRestartService,
  onDeleteProcess,
  onSelectedProcess,
  importFileRef,
  handleImportFileChange,
  setShowAddModal,
  API
}) => {
  const { t } = useTranslation();

  const activeServices = telemetry.filter(p => isActiveService(p, actionPending));
  const inactiveServices = telemetry.filter(p => !isActiveService(p, actionPending));

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--glass-border)]">
        <div>
          <h1 className="text-2xl font-black text-[var(--text-primary)]">{t('services.title', 'Services')}</h1>
          <p className="text-xs text-[var(--text-secondary)]">{t('services.subtitle', 'Continuous media streaming and processing node instances')}</p>
        </div>

        <div className="flex items-center space-x-3">
          <button 
            onClick={() => importFileRef.current?.click()}
            className="pill-button bg-[var(--input-bg)] border border-[var(--glass-border)] text-[var(--text-primary)] font-bold hover:border-brand-lime/40 transition-all flex items-center gap-1.5"
          >
            <ImportIcon size={14} /> {t('services.importProfile', 'IMPORT PROFILE')}
          </button>
          <input 
            type="file" 
            ref={importFileRef} 
            className="hidden" 
            accept=".json" 
            onChange={handleImportFileChange} 
          />
          <button 
            onClick={() => setShowAddModal(true)}
            className="pill-button bg-brand-lime text-black font-black transition-all flex items-center gap-1.5"
          >
            <PlusIcon size={14} /> {t('services.newService', 'NEW SERVICE')}
          </button>
        </div>
      </header>

      <div className="space-y-6">
        {/* Active Running Services Section */}
        <div>
          <h3 className="text-lg font-black mb-3 text-[var(--text-primary)] tracking-wide">
            {t('services.activeServicesRunning', 'ACTIVE SERVICES (RUNNING)')} ({activeServices.length})
          </h3>
          {activeServices.length === 0 ? (
            <div className="text-[var(--text-secondary)] py-12 text-center border border-dashed border-[var(--glass-border)] rounded-2xl bg-[var(--bg-card)]">
              {t('services.noRunningServices', 'No running services')}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {activeServices.map(proc => (
                <UnifiedServiceCard
                  key={proc.id}
                  service={proc as ServiceItem}
                  telemetryItem={proc}
                  actionPending={actionPending[proc.id]}
                  onStartService={onStartService}
                  onStopService={onStopService}
                  onRestartService={onRestartService}
                  onEditProcess={onEditProcess}
                  onCloneProcess={onCloneProcess}
                  onDeleteProcess={onDeleteProcess}
                  onSelectedProcess={onSelectedProcess}
                  onViewLogs={onSelectedProcess}
                  API={API}
                />
              ))}
            </div>
          )}
        </div>

        {/* Inactive Configured Services Section */}
        <div>
          <h3 className="text-lg font-black mb-3 text-[var(--text-secondary)] tracking-wide">
            {t('services.configuredServicesInactive', 'Configured Services (Inactive)')} ({inactiveServices.length})
          </h3>
          {inactiveServices.length === 0 ? (
            <div className="text-[var(--text-secondary)] py-12 text-center border border-dashed border-[var(--glass-border)] rounded-2xl bg-[var(--bg-card)]">
              {t('services.noInactiveServices', 'No inactive services')}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {inactiveServices.map(proc => (
                <UnifiedServiceCard
                  key={proc.id}
                  service={proc as ServiceItem}
                  telemetryItem={proc}
                  actionPending={actionPending[proc.id]}
                  onStartService={onStartService}
                  onStopService={onStopService}
                  onRestartService={onRestartService}
                  onEditProcess={onEditProcess}
                  onCloneProcess={onCloneProcess}
                  onDeleteProcess={onDeleteProcess}
                  onSelectedProcess={onSelectedProcess}
                  onViewLogs={onSelectedProcess}
                  API={API}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
