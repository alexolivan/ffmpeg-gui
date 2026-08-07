import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExportIcon, ImportIcon, ShieldIcon } from '../../Icons';

interface BackupRestoreCardProps {
  API: string;
}

export const BackupRestoreCard: React.FC<BackupRestoreCardProps> = ({ API }) => {
  const { t } = useTranslation();

  // Export States
  const [exportSystemSettings, setExportSystemSettings] = useState(true);
  const [exportServices, setExportServices] = useState(true);
  const [exportTasks, setExportTasks] = useState(true);
  const [exportStorageVolumes, setExportStorageVolumes] = useState(true);
  const [exportNotifications, setExportNotifications] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  // Import States
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importData, setImportData] = useState<any>(null);
  const [importError, setImportError] = useState('');
  const [importSuccess, setImportSuccess] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const handleExportBackup = async () => {
    setIsExporting(true);
    try {
      const payload = {
        system_settings: exportSystemSettings,
        services: exportServices,
        tasks: exportTasks,
        storage_volumes: exportStorageVolumes,
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
      const summaryMsg = `${t('settings.backup.importSuccess', 'Backup restored successfully!')} (${t('settings.tabs.general', 'Settings')}: ${counts.system_settings ? '✓' : '-'}, ${t('nav.services', 'Services')}: ${counts.services || 0}, ${t('nav.tasks', 'Tasks')}: ${counts.tasks || 0}, ${t('settings.tabs.storage', 'Storage')}: ${counts.storage_volumes || 0})`;
      setImportSuccess(summaryMsg);
      setImportFile(null);
      setImportData(null);
    } catch (err: any) {
      setImportError(err.message || 'Error executing import');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* CARD 1: EXPORT CONFIGURATION */}
      <div className="glass-card p-6 border-[var(--glass-border)] shadow-xl relative overflow-hidden">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--glass-border)]">
          <div className="flex items-center gap-2.5">
            <ExportIcon size={20} className="text-brand-lime" />
            <div>
              <h2 className="text-sm font-black text-[var(--text-primary)] uppercase tracking-wider">
                {t('settings.backup.exportTitle', 'Export System Backup (.json)')}
              </h2>
              <p className="text-xs text-text-secondary mt-0.5">
                {t('settings.backup.exportDesc', 'Select configuration sections to include in your downloadable JSON backup file.')}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-5">
          <label className="flex items-center gap-2.5 p-3 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] cursor-pointer hover:border-brand-lime/30 transition-all">
            <input
              type="checkbox"
              checked={exportSystemSettings}
              onChange={(e) => setExportSystemSettings(e.target.checked)}
              className="accent-brand-lime w-4 h-4 rounded"
            />
            <div className="text-xs">
              <span className="font-bold text-[var(--text-primary)] block">{t('settings.tabs.general', 'System Settings')}</span>
              <span className="text-[10px] text-text-secondary">{t('settings.backup.sectionSystemDesc', 'Core panel, language, theme, logging')}</span>
            </div>
          </label>

          <label className="flex items-center gap-2.5 p-3 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] cursor-pointer hover:border-brand-lime/30 transition-all">
            <input
              type="checkbox"
              checked={exportServices}
              onChange={(e) => setExportServices(e.target.checked)}
              className="accent-brand-lime w-4 h-4 rounded"
            />
            <div className="text-xs">
              <span className="font-bold text-[var(--text-primary)] block">{t('nav.services', 'Media Services')}</span>
              <span className="text-[10px] text-text-secondary">{t('settings.backup.sectionServicesDesc', 'FFmpeg streaming services & watchdog')}</span>
            </div>
          </label>

          <label className="flex items-center gap-2.5 p-3 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] cursor-pointer hover:border-brand-lime/30 transition-all">
            <input
              type="checkbox"
              checked={exportTasks}
              onChange={(e) => setExportTasks(e.target.checked)}
              className="accent-brand-lime w-4 h-4 rounded"
            />
            <div className="text-xs">
              <span className="font-bold text-[var(--text-primary)] block">{t('nav.tasks', 'Scheduled Tasks')}</span>
              <span className="text-[10px] text-text-secondary">{t('settings.backup.sectionTasksDesc', 'Cron & one-shot automation routines')}</span>
            </div>
          </label>

          <label className="flex items-center gap-2.5 p-3 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] cursor-pointer hover:border-brand-lime/30 transition-all">
            <input
              type="checkbox"
              checked={exportStorageVolumes}
              onChange={(e) => setExportStorageVolumes(e.target.checked)}
              className="accent-brand-lime w-4 h-4 rounded"
            />
            <div className="text-xs">
              <span className="font-bold text-[var(--text-primary)] block">{t('settings.tabs.storage', 'Storage Volumes')}</span>
              <span className="text-[10px] text-text-secondary">{t('settings.backup.sectionStorageDesc', 'Storage directories & mount paths')}</span>
            </div>
          </label>

          <label className="flex items-center gap-2.5 p-3 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] cursor-pointer hover:border-brand-lime/30 transition-all">
            <input
              type="checkbox"
              checked={exportNotifications}
              onChange={(e) => setExportNotifications(e.target.checked)}
              className="accent-brand-lime w-4 h-4 rounded"
            />
            <div className="text-xs">
              <span className="font-bold text-[var(--text-primary)] block">{t('settings.backup.sectionNotificationsTitle', 'Notifications')}</span>
              <span className="text-[10px] text-text-secondary">{t('settings.backup.sectionNotificationsDesc', 'SMTP email server & alert triggers')}</span>
            </div>
          </label>
        </div>

        <button
          disabled={isExporting || (!exportSystemSettings && !exportServices && !exportTasks && !exportStorageVolumes && !exportNotifications)}
          onClick={handleExportBackup}
          className="pill-button bg-brand-lime text-black font-bold py-2.5 px-6 hover:bg-brand-lime/90 disabled:opacity-50 flex items-center gap-2"
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

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                <div className="p-2 rounded bg-white/5 border border-white/5">
                  <span className="text-[10px] text-text-secondary block">System Settings</span>
                  <strong className="text-[var(--text-primary)]">{importData.sections?.system_settings ? '✓ Present' : 'None'}</strong>
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
                  <span className="text-[10px] text-text-secondary block">Storage Volumes</span>
                  <strong className="text-[var(--text-primary)]">{importData.sections?.storage_volumes?.length || 0} entries</strong>
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
                className="pill-button bg-brand-orange text-black font-bold py-2.5 px-6 hover:bg-brand-orange/90 disabled:opacity-50 flex items-center gap-2"
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
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-[var(--text-primary)] border border-white/10 rounded-lg text-xs font-bold uppercase tracking-wider"
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                onClick={handleConfirmImport}
                className="px-4 py-2 bg-brand-orange text-black font-bold rounded-lg text-xs uppercase tracking-wider hover:bg-brand-orange/90 shadow-lg shadow-brand-orange/20"
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
