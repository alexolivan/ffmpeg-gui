import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExportIcon, ImportIcon, ShieldIcon, GearIcon, ServerIcon } from '../../Icons';

interface BackupRestoreCardProps {
  API: string;
}

export const BackupRestoreCard: React.FC<BackupRestoreCardProps> = ({ API }) => {
  const { t } = useTranslation();

  // Granular Export Toggles
  const [exportGuiGeneral, setExportGuiGeneral] = useState(true);
  const [exportGuiNetworkSsl, setExportGuiNetworkSsl] = useState(true);
  const [exportLcdDisplay, setExportLcdDisplay] = useState(true);
  const [exportLoggingRetention, setExportLoggingRetention] = useState(true);
  const [exportWatchdogGrace, setExportWatchdogGrace] = useState(true);
  const [exportServices, setExportServices] = useState(true);
  const [exportTasks, setExportTasks] = useState(true);
  const [exportStorageVolumes, setExportStorageVolumes] = useState(true);
  const [exportSoftwareEngines, setExportSoftwareEngines] = useState(true);
  const [exportNotifications, setExportNotifications] = useState(true);

  const [isExporting, setIsExporting] = useState(false);

  // Import States
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importData, setImportData] = useState<any>(null);
  const [importError, setImportError] = useState('');
  const [importSuccess, setImportSuccess] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const handleSelectAll = (val: boolean) => {
    setExportGuiGeneral(val);
    setExportGuiNetworkSsl(val);
    setExportLcdDisplay(val);
    setExportLoggingRetention(val);
    setExportWatchdogGrace(val);
    setExportServices(val);
    setExportTasks(val);
    setExportStorageVolumes(val);
    setExportSoftwareEngines(val);
    setExportNotifications(val);
  };

  const handleExportBackup = async () => {
    setIsExporting(true);
    try {
      const payload = {
        gui_general: exportGuiGeneral,
        gui_network_ssl: exportGuiNetworkSsl,
        lcd_display: exportLcdDisplay,
        logging_retention: exportLoggingRetention,
        watchdog_grace: exportWatchdogGrace,
        services: exportServices,
        tasks: exportTasks,
        storage_volumes: exportStorageVolumes,
        software_engines: exportSoftwareEngines,
        notifications: exportNotifications,
      };

      const res = await fetch(`${API}/api/backup/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('Failed to generate export backup');
      const data = await res.json();

      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `ffmpeg_gui_backup_${timestamp}.json`;

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.message || 'Error exporting backup');
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportError('');
    setImportSuccess('');
    setImportData(null);

    const file = e.target.files?.[0];
    if (!file) return;

    setImportFile(file);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target?.result as string);
        if (!parsed || parsed.app !== 'ffmpeg-gui' || !parsed.sections) {
          throw new Error(t('settings.backup.invalidBackupFormat', 'Invalid backup file format. Missing ffmpeg-gui signature.'));
        }
        setImportData(parsed);
      } catch (err: any) {
        setImportError(err.message || 'Invalid JSON file structure');
      }
    };
    reader.readAsText(file);
  };

  const handleConfirmImport = async () => {
    if (!importData) return;
    setIsImporting(true);
    setImportError('');
    setImportSuccess('');
    setShowConfirmModal(false);

    try {
      const res = await fetch(`${API}/api/backup/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(importData),
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.detail || 'Import failed');
      }

      const counts = result.imported || {};
      const summaryMsg = `${t('settings.backup.importSuccess', 'Backup restored successfully!')} (${t('nav.services', 'Services')}: ${counts.services || 0}, ${t('nav.tasks', 'Tasks')}: ${counts.tasks || 0}, ${t('settings.tabs.storage', 'Storage')}: ${counts.storage_volumes || 0}${counts.software_engines !== undefined ? `, ${t('settings.tabs.engines', 'Engines')}: ${counts.software_engines}` : ''})`;
      setImportSuccess(summaryMsg);
      setImportFile(null);
      setImportData(null);
    } catch (err: any) {
      setImportError(err.message || 'Error executing import');
    } finally {
      setIsImporting(false);
    }
  };

  const anyExportSelected = exportGuiGeneral || exportGuiNetworkSsl || exportLcdDisplay || exportLoggingRetention || exportWatchdogGrace || exportServices || exportTasks || exportStorageVolumes || exportSoftwareEngines || exportNotifications;

  return (
    <div className="space-y-6">
      {/* CARD 1: GRANULAR EXPORT CONFIGURATION */}
      <div className="glass-card p-6 border-[var(--glass-border)] shadow-xl relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-[var(--glass-border)]">
          <div className="flex items-center gap-2.5">
            <ExportIcon size={20} className="text-brand-lime" />
            <div>
              <h2 className="text-sm font-black text-[var(--text-primary)] uppercase tracking-wider">
                {t('settings.backup.exportTitle', 'Export System Backup (.json)')}
              </h2>
              <p className="text-xs text-text-secondary mt-0.5">
                {t('settings.backup.exportDesc', 'Select specific configuration subsections to include in your downloadable JSON backup file.')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleSelectAll(true)}
              className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-brand-lime border border-white/10"
            >
              Select All
            </button>

            <button
              type="button"
              onClick={() => handleSelectAll(false)}
              className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-text-secondary border border-white/10"
            >
              Deselect All
            </button>
          </div>
        </div>

        {/* Category 1: Panel & Interface */}
        <div className="space-y-4 mb-5">
          <div>
            <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <GearIcon size={12} /> Panel Preferences & Branding
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
              <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] cursor-pointer hover:border-brand-lime/30 transition-all">
                <input
                  type="checkbox"
                  checked={exportGuiGeneral}
                  onChange={(e) => setExportGuiGeneral(e.target.checked)}
                  className="accent-brand-lime w-4 h-4 rounded"
                />
                <div className="text-xs min-w-0">
                  <span className="font-bold text-[var(--text-primary)] block truncate">General Panel & Theme</span>
                  <span className="text-[10px] text-text-secondary truncate block">Language, theme, node name, logo text</span>
                </div>
              </label>

              <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] cursor-pointer hover:border-brand-lime/30 transition-all">
                <input
                  type="checkbox"
                  checked={exportGuiNetworkSsl}
                  onChange={(e) => setExportGuiNetworkSsl(e.target.checked)}
                  className="accent-brand-lime w-4 h-4 rounded"
                />
                <div className="text-xs min-w-0">
                  <span className="font-bold text-[var(--text-primary)] block truncate">Network Ports & SSL/TLS</span>
                  <span className="text-[10px] text-text-secondary truncate block">HTTP/HTTPS ports, listen address & SSL</span>
                </div>
              </label>

              <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] cursor-pointer hover:border-brand-lime/30 transition-all">
                <input
                  type="checkbox"
                  checked={exportLcdDisplay}
                  onChange={(e) => setExportLcdDisplay(e.target.checked)}
                  className="accent-brand-lime w-4 h-4 rounded"
                />
                <div className="text-xs min-w-0">
                  <span className="font-bold text-[var(--text-primary)] block truncate">LCD Hardware & LEDs</span>
                  <span className="text-[10px] text-text-secondary truncate block">CrystalFontz LCD port, brightness & LED profiles</span>
                </div>
              </label>
            </div>
          </div>

          {/* Category 2: Logging & Watchdog */}
          <div>
            <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <ShieldIcon size={12} /> System Maintenance & Watchdog
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
              <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] cursor-pointer hover:border-brand-lime/30 transition-all">
                <input
                  type="checkbox"
                  checked={exportLoggingRetention}
                  onChange={(e) => setExportLoggingRetention(e.target.checked)}
                  className="accent-brand-lime w-4 h-4 rounded"
                />
                <div className="text-xs min-w-0">
                  <span className="font-bold text-[var(--text-primary)] block truncate">Log Retention & Storage</span>
                  <span className="text-[10px] text-text-secondary truncate block">Retention days, rotation limits & compression</span>
                </div>
              </label>

              <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] cursor-pointer hover:border-brand-lime/30 transition-all">
                <input
                  type="checkbox"
                  checked={exportWatchdogGrace}
                  onChange={(e) => setExportWatchdogGrace(e.target.checked)}
                  className="accent-brand-lime w-4 h-4 rounded"
                />
                <div className="text-xs min-w-0">
                  <span className="font-bold text-[var(--text-primary)] block truncate">Watchdog Startup Delays</span>
                  <span className="text-[10px] text-text-secondary truncate block">Grace delays, backoff & network wait timeouts</span>
                </div>
              </label>

              <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] cursor-pointer hover:border-brand-lime/30 transition-all">
                <input
                  type="checkbox"
                  checked={exportNotifications}
                  onChange={(e) => setExportNotifications(e.target.checked)}
                  className="accent-brand-lime w-4 h-4 rounded"
                />
                <div className="text-xs min-w-0">
                  <span className="font-bold text-[var(--text-primary)] block truncate">Email Notifications</span>
                  <span className="text-[10px] text-text-secondary truncate block">SMTP server, credentials & alert triggers</span>
                </div>
              </label>
            </div>
          </div>

          {/* Category 3: Streaming, Tasks & Storage */}
          <div>
            <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <ServerIcon size={12} /> Media Pipeline & Automation
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
              <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] cursor-pointer hover:border-brand-lime/30 transition-all">
                <input
                  type="checkbox"
                  checked={exportServices}
                  onChange={(e) => setExportServices(e.target.checked)}
                  className="accent-brand-lime w-4 h-4 rounded"
                />
                <div className="text-xs min-w-0">
                  <span className="font-bold text-[var(--text-primary)] block truncate">{t('nav.services', 'Media Services')}</span>
                  <span className="text-[10px] text-text-secondary truncate block">{t('settings.backup.sectionServicesDesc', 'Broadcast pipelines, MediaMTX Hubs & codecs')}</span>
                </div>
              </label>

              <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] cursor-pointer hover:border-brand-lime/30 transition-all">
                <input
                  type="checkbox"
                  checked={exportTasks}
                  onChange={(e) => setExportTasks(e.target.checked)}
                  className="accent-brand-lime w-4 h-4 rounded"
                />
                <div className="text-xs min-w-0">
                  <span className="font-bold text-[var(--text-primary)] block truncate">{t('nav.tasks', 'Scheduled Tasks')}</span>
                  <span className="text-[10px] text-text-secondary truncate block">{t('settings.backup.sectionTasksDesc', 'Cron & one-shot automation routines')}</span>
                </div>
              </label>

              <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] cursor-pointer hover:border-brand-lime/30 transition-all">
                <input
                  type="checkbox"
                  checked={exportStorageVolumes}
                  onChange={(e) => setExportStorageVolumes(e.target.checked)}
                  className="accent-brand-lime w-4 h-4 rounded"
                />
                <div className="text-xs min-w-0">
                  <span className="font-bold text-[var(--text-primary)] block truncate">{t('settings.tabs.storage', 'Storage Volumes')}</span>
                  <span className="text-[10px] text-text-secondary truncate block">{t('settings.backup.sectionStorageDesc', 'Media directories & mount paths')}</span>
                </div>
              </label>

              <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] cursor-pointer hover:border-brand-lime/30 transition-all">
                <input
                  type="checkbox"
                  checked={exportSoftwareEngines}
                  onChange={(e) => setExportSoftwareEngines(e.target.checked)}
                  className="accent-brand-lime w-4 h-4 rounded"
                />
                <div className="text-xs min-w-0">
                  <span className="font-bold text-[var(--text-primary)] block truncate">{t('settings.backup.sectionEnginesTitle', 'Software Engines')}</span>
                  <span className="text-[10px] text-text-secondary truncate block">{t('settings.backup.sectionEnginesDesc', 'Forge recipes, system binaries & engine builds')}</span>
                </div>
              </label>
            </div>
          </div>
        </div>

        <button
          disabled={isExporting || !anyExportSelected}
          onClick={handleExportBackup}
          className="pill-button bg-brand-lime text-black font-bold py-2.5 px-6 hover:bg-brand-lime/90 disabled:opacity-50 flex items-center gap-2 cursor-pointer"
        >
          <ExportIcon size={16} />
          {isExporting ? t('settings.backup.exporting', 'GENERATING BACKUP...') : t('settings.backup.exportBtn', 'EXPORT BACKUP (.JSON)')}
        </button>
      </div>

      {/* CARD 2: RESTORE / IMPORT CONFIGURATION */}
      <div className="glass-card p-6 border-[var(--glass-border)] shadow-xl relative overflow-hidden">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--glass-border)]">
          <div className="flex items-center gap-2.5">
            <ImportIcon size={20} className="text-brand-orange" />
            <div>
              <h2 className="text-sm font-black text-[var(--text-primary)] uppercase tracking-wider">
                {t('settings.backup.importTitle', 'Restore System Backup')}
              </h2>
              <p className="text-xs text-text-secondary mt-0.5">
                {t('settings.backup.importDesc', 'Upload a previously exported JSON backup file to restore system configuration, services, and tasks.')}
              </p>
            </div>
          </div>
        </div>

        {importSuccess && (
          <div className="mb-4 p-3.5 rounded-xl bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-semibold flex items-center gap-2">
            <span>✓</span> {importSuccess}
          </div>
        )}

        {importError && (
          <div className="mb-4 p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-semibold flex items-center gap-2">
            <span>⚠️</span> {importError}
          </div>
        )}

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="cursor-pointer pill-button bg-white/10 hover:bg-white/15 border border-[var(--glass-border)] text-[var(--text-primary)] text-xs font-bold py-2.5 px-5 flex items-center gap-2">
              <ImportIcon size={16} />
              {t('settings.backup.selectBackupFile', 'SELECT BACKUP FILE (.JSON)')}
              <input type="file" accept=".json" onChange={handleFileChange} className="hidden" />
            </label>
            {importFile && (
              <span className="text-xs font-mono text-brand-lime">
                {importFile.name} ({(importFile.size / 1024).toFixed(1)} KB)
              </span>
            )}
          </div>

          {importData && (
            <div className="p-4 rounded-xl bg-[var(--input-bg)] border border-brand-orange/30 space-y-3 animate-in fade-in duration-200">
              <div className="flex items-center justify-between text-xs border-b border-white/5 pb-2">
                <span className="font-bold text-[var(--text-primary)]">
                  📄 Backup Metadata: <span className="text-brand-orange">{importData.app} v{importData.version}</span>
                </span>
                <span className="text-text-secondary">
                  Exported: {importData.exported_at ? new Date(importData.exported_at).toLocaleString() : 'N/A'}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs font-mono">
                <div className="p-2 rounded bg-white/5 border border-white/5">
                  <span className="text-[10px] text-text-secondary block">GUI General & Theme</span>
                  <strong className="text-[var(--text-primary)]">{importData.sections?.gui_general || importData.sections?.system_settings ? '✓ Present' : 'None'}</strong>
                </div>
                <div className="p-2 rounded bg-white/5 border border-white/5">
                  <span className="text-[10px] text-text-secondary block">LCD Hardware</span>
                  <strong className="text-[var(--text-primary)]">{importData.sections?.lcd_display ? '✓ Present' : 'None'}</strong>
                </div>
                <div className="p-2 rounded bg-white/5 border border-white/5">
                  <span className="text-[10px] text-text-secondary block">Services</span>
                  <strong className="text-[var(--text-primary)]">{importData.sections?.services?.length || 0} entries</strong>
                </div>
                <div className="p-2 rounded bg-white/5 border border-white/5">
                  <span className="text-[10px] text-text-secondary block">Tasks</span>
                  <strong className="text-[var(--text-primary)]">{importData.sections?.tasks?.length || 0} entries</strong>
                </div>
                <div className="p-2 rounded bg-white/5 border border-white/5">
                  <span className="text-[10px] text-text-secondary block">Engines</span>
                  <strong className="text-[var(--text-primary)]">{importData.sections?.software_engines?.length || 0} entries</strong>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs flex items-center gap-2">
                <ShieldIcon size={16} className="shrink-0" />
                <span>
                  {t('settings.backup.warningWarning', 'Warning: Restoring this backup will merge or create non-existing entries in SQLite database and system configuration.')}
                </span>
              </div>

              <button
                onClick={() => setShowConfirmModal(true)}
                disabled={isImporting}
                className="pill-button bg-brand-orange text-black font-bold py-2.5 px-6 hover:bg-brand-orange/90 disabled:opacity-50 flex items-center gap-2 cursor-pointer"
              >
                <ImportIcon size={16} />
                {t('settings.backup.restoreBtn', 'RESTORE BACKUP CONFIGURATION')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* CONFIRMATION MODAL */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="glass-card w-full max-w-md p-6 border-brand-orange/30 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-brand-orange uppercase tracking-wider flex items-center gap-2">
              ⚠️ {t('settings.backup.confirmTitle', 'Confirm Restore Backup')}
            </h3>
            <p className="text-xs text-text-secondary leading-relaxed">
              {t('settings.backup.confirmDesc', 'Are you sure you want to restore this configuration? Non-existing services and tasks will be inserted and system preferences updated.')}
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-[var(--text-primary)] border border-white/10 rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer"
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                onClick={handleConfirmImport}
                className="px-4 py-2 bg-brand-orange text-black font-bold rounded-lg text-xs uppercase tracking-wider hover:bg-brand-orange/90 shadow-lg shadow-brand-orange/20 cursor-pointer"
              >
                {t('settings.backup.confirmBtn', 'Confirm Restore')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
