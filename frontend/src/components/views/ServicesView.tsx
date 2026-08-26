import React from 'react';
import { useTranslation } from 'react-i18next';
import { 
  ImportIcon, 
  PlusIcon
} from '../Icons';
import { FfmpegServiceCard } from '../cards/FfmpegServiceCard';
import { MediaMtxServiceCard } from '../cards/MediaMtxServiceCard';
import { hasVideo, type ServiceItem } from '../cards/UnifiedServiceCard';

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

  const services = telemetry.filter(p => !p.type || p.type === 'service');
  const activeServices = services.filter(p => isActiveService(p, actionPending));
  const inactiveServices = services.filter(p => !isActiveService(p, actionPending));

  const handleExport = (proc: any) => {
    fetch(`${API}/processes/${proc.id}/export`)
      .then(r => r.json())
      .then(data => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${proc.name}_profile.json`;
        a.click();
      });
  };

  const handleCloneAsTask = async (proc: any) => {
    try {
      const res = await fetch(`${API}/processes/${proc.id}/clone-as-task`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to clone service as task');
      alert(t('common.clonedSuccess', 'Cloned successfully!'));
    } catch (err: any) {
      alert(err.message || 'Error cloning service as task');
    }
  };

  const renderCard = (proc: any) => {
    if (proc.service_type === 'mediamtx_hub') {
      return (
        <MediaMtxServiceCard
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
          onExportProcess={handleExport}
          API={API}
        />
      );
    }
    return (
      <FfmpegServiceCard
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
        onExportProcess={handleExport}
        onCloneAsTask={handleCloneAsTask}
        API={API}
      />
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Actions */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-[var(--text-primary)]">
            {t('nav.services', 'Services')}
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            {t('services.manageServicesSubtitle', 'Manage 24/7 background broadcast streaming services and media routing hubs.')}
          </p>
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <input
            type="file"
            ref={importFileRef}
            onChange={handleImportFileChange}
            accept=".json"
            className="hidden"
          />
          <button
            onClick={() => importFileRef.current?.click()}
            className="pill-button bg-white/5 hover:bg-white/10 text-[var(--text-primary)] border border-white/10 text-xs py-2 px-3.5 flex items-center gap-1.5 flex-1 sm:flex-initial justify-center"
          >
            <ImportIcon size={14} />
            {t('common.import', 'Import')}
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="pill-button bg-brand-lime hover:bg-brand-lime/90 text-black font-bold text-xs py-2 px-4 flex items-center gap-1.5 flex-1 sm:flex-initial justify-center shadow-lg shadow-brand-lime/10"
          >
            <PlusIcon size={14} />
            {t('services.createService', 'Create Service')}
          </button>
        </div>
      </div>

      <div className="space-y-5">
        {/* Active Running Services Section */}
        <div className="glass-card p-4 md:p-5">
          <h3 className="text-xl font-black mb-3 text-[var(--text-primary)]">
            {t('services.activeServices', 'Active Services')} ({activeServices.length})
          </h3>
          {activeServices.length === 0 ? (
            <div className="text-[var(--text-secondary)] py-8 text-center border border-dashed border-white/5 rounded-2xl">
              {t('services.noActiveServices', 'No active services running')}
            </div>
          ) : (
            <div className="space-y-2.5">
              {activeServices.map(renderCard)}
            </div>
          )}
        </div>

        {/* Inactive Configured Services Section */}
        <div className="glass-card p-4 md:p-5">
          <h3 className="text-xl font-black mb-3 text-[var(--text-secondary)]">
            {t('services.configuredServicesInactive', 'Configured Services (Inactive)')} ({inactiveServices.length})
          </h3>
          {inactiveServices.length === 0 ? (
            <div className="text-[var(--text-secondary)] py-8 text-center border border-dashed border-white/5 rounded-2xl">
              {t('services.noInactiveServices', 'No inactive services')}
            </div>
          ) : (
            <div className="space-y-2.5">
              {inactiveServices.map(renderCard)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
