import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ServerIcon, PencilIcon, TrashIcon } from '../../Icons';

export interface SoftwareEngineBuild {
  id: number;
  name: string;
  version_tag: string;
  source_type: 'compiled' | 'installed' | 'precompiled';
  binary_path?: string;
  system_path?: string;
  is_managed: boolean;
  status: string;
  is_default: boolean;
  disk_usage_mb?: number;
  created_at?: string;
  referencing_services_count: number;
}

export interface SoftwareEngineData {
  key: string;
  name: string;
  description: string;
  always_enabled: boolean;
  is_enabled: boolean;
  supports_forge: boolean;
  forge_enabled: boolean;
  supports_installed: boolean;
  installed_enabled: boolean;
  supports_precompiled: boolean;
  precompiled_enabled: boolean;
  system_binary: {
    found: boolean;
    path: string | null;
    version: string | null;
  };
  installed_build_registered: boolean;
  installed_build_id: number | null;
  builds: SoftwareEngineBuild[];
  total_builds: number;
}

interface SoftwareEngineCardProps {
  engine: SoftwareEngineData;
  API: string;
  onRefresh: () => Promise<void>;
  onDeleteBuild: (buildId: number) => Promise<void>;
}

export const SoftwareEngineCard: React.FC<SoftwareEngineCardProps> = ({
  engine,
  API,
  onRefresh,
  onDeleteBuild,
}) => {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isUpdatingConfig, setIsUpdatingConfig] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Installed binary editing
  const [isEditingAlias, setIsEditingAlias] = useState(false);
  const [installedAlias, setInstalledAlias] = useState('');

  // Precompiled releases
  const [releases, setReleases] = useState<Array<{ tag: string; name: string }>>([]);
  const [selectedRelease, setSelectedRelease] = useState('');
  const [isFetchingReleases, setIsFetchingReleases] = useState(false);
  const [isDownloadingRelease, setIsDownloadingRelease] = useState(false);

  // Icon preview
  const [iconTimestamp, setIconTimestamp] = useState(Date.now());
  const [hasCustomIcon, setHasCustomIcon] = useState(true);

  const showNotification = (msg: string, isError = false) => {
    if (isError) {
      setErrorMessage(msg);
      setSuccessMessage(null);
    } else {
      setSuccessMessage(msg);
      setErrorMessage(null);
    }
    setTimeout(() => {
      setErrorMessage(null);
      setSuccessMessage(null);
    }, 3500);
  };

  const handleUpdateEngineConfig = async (patch: Record<string, boolean>) => {
    setIsUpdatingConfig(true);
    setErrorMessage(null);
    try {
      const resStatus = await fetch(`${API}/api/settings/software`);
      const allEngines: Record<string, SoftwareEngineData> = await resStatus.json();
      
      const payload: Record<string, boolean> = {};
      Object.values(allEngines).forEach((eng) => {
        if (!eng.always_enabled) {
          payload[`${eng.key}_enabled`] = eng.is_enabled;
        }
        if (eng.supports_forge) {
          payload[`${eng.key}_forge_enabled`] = eng.forge_enabled;
        }
        if (eng.supports_installed) {
          payload[`${eng.key}_installed_enabled`] = eng.installed_enabled;
        }
        if (eng.supports_precompiled) {
          payload[`${eng.key}_precompiled_enabled`] = eng.precompiled_enabled;
        }
      });

      Object.assign(payload, patch);

      if (patch[`${engine.key}_enabled`] === true) {
        const hasSource = (engine.supports_forge && Boolean(payload[`${engine.key}_forge_enabled`])) ||
                          (engine.supports_installed && Boolean(payload[`${engine.key}_installed_enabled`])) ||
                          (engine.supports_precompiled && Boolean(payload[`${engine.key}_precompiled_enabled`]));
        if (!hasSource) {
          if (engine.supports_installed) payload[`${engine.key}_installed_enabled`] = true;
          if (engine.supports_forge) payload[`${engine.key}_forge_enabled`] = true;
          if (engine.supports_precompiled) payload[`${engine.key}_precompiled_enabled`] = true;
        }
      }

      const res = await fetch(`${API}/api/settings/software/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || t('settings.software.errorUpdatingConfig', 'Failed to update software configuration'));
      }

      await onRefresh();
      showNotification(t('settings.software.configUpdated', 'Engine configuration updated successfully.'));
    } catch (err: any) {
      showNotification(err.message, true);
    } finally {
      setIsUpdatingConfig(false);
    }
  };

  const handleToggleInstalledBinary = async (enable: boolean) => {
    setErrorMessage(null);
    try {
      const res = await fetch(`${API}/api/settings/software/${engine.key}/installed/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: enable,
          alias: installedAlias.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || t('settings.software.errorTogglingInstalled', 'Failed to toggle installed binary'));
      }

      setIsEditingAlias(false);
      await onRefresh();
      showNotification(enable ? t('settings.software.installedRegistered', 'System binary registered as build.') : t('settings.software.installedUnregistered', 'System binary unregistered.'));
    } catch (err: any) {
      showNotification(err.message, true);
    }
  };

  const handleFetchReleases = async () => {
    if (releases.length > 0) return;
    setIsFetchingReleases(true);
    try {
      const res = await fetch(`${API}/api/settings/software/${engine.key}/releases`);
      if (res.ok) {
        const data = await res.json();
        setReleases(data);
        if (data.length > 0) {
          setSelectedRelease(data[0].tag);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsFetchingReleases(false);
    }
  };

  const handleDownloadRelease = async () => {
    if (!selectedRelease) return;
    setIsDownloadingRelease(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`${API}/api/settings/software/${engine.key}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: selectedRelease }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || t('settings.software.downloadFailed', 'Download failed'));
      }

      await onRefresh();
      showNotification(t('settings.software.downloadSuccess', 'MediaMTX release provisioned successfully!'));
    } catch (err: any) {
      showNotification(err.message, true);
    } finally {
      setIsDownloadingRelease(false);
    }
  };

  const handleIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${API}/api/settings/software/${engine.key}/icon`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || t('settings.software.iconUploadFailed', 'Failed to upload icon'));
      }

      setHasCustomIcon(true);
      setIconTimestamp(Date.now());
      window.dispatchEvent(new Event('engine_icons_updated'));
      showNotification(t('settings.software.iconUploadSuccess', 'Custom icon uploaded successfully.'));
    } catch (err: any) {
      showNotification(err.message, true);
    }
  };

  const handleDeleteIcon = async () => {
    try {
      const res = await fetch(`${API}/api/settings/software/${engine.key}/icon`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setHasCustomIcon(false);
        setIconTimestamp(Date.now());
        window.dispatchEvent(new Event('engine_icons_updated'));
        showNotification(t('settings.software.iconResetSuccess', 'Reverted to default icon.'));
      }
    } catch (err: any) {
      showNotification(err.message, true);
    }
  };

  const iconUrl = `${API}/api/settings/software/${engine.key}/icon?t=${iconTimestamp}`;

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-3.5 shadow-sm flex flex-col gap-2.5 relative overflow-hidden">
      {/* Notifications banner */}
      {errorMessage && (
        <div className="bg-red-500/15 border border-red-500/40 text-red-300 text-[11px] px-2.5 py-1.5 rounded-lg flex items-center gap-2">
          <span>⚠️</span>
          <span>{errorMessage}</span>
        </div>
      )}
      {successMessage && (
        <div className="bg-brand-lime/15 border border-brand-lime/40 text-brand-lime text-[11px] px-2.5 py-1.5 rounded-lg flex items-center gap-2">
          <span>✓</span>
          <span>{successMessage}</span>
        </div>
      )}

      {/* Compact Header with Icon, Title, and Master Toggle */}
      <div className="flex items-center justify-between gap-3 pb-2 border-b border-[var(--glass-border)]">
        <div className="flex items-center gap-3 min-w-0">
          {/* Engine Logo / Icon & Upload Controls */}
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="w-9 h-9 rounded-lg bg-[var(--input-bg)] border border-[var(--glass-border)] flex items-center justify-center overflow-hidden p-1 shadow-inner">
              {hasCustomIcon ? (
                <img
                  src={iconUrl}
                  alt={engine.name}
                  className="w-full h-full object-contain"
                  onError={() => setHasCustomIcon(false)}
                />
              ) : (
                <ServerIcon size={18} className="text-brand-lime/70" />
              )}
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[var(--input-bg)] hover:bg-[var(--glass-border)] text-[var(--text-primary)] border border-[var(--glass-border)] hover:border-brand-lime/40 transition-all flex items-center gap-1 cursor-pointer"
                title={t('settings.software.changeIcon', 'Upload custom icon (PNG, SVG, WebP)')}
              >
                <PencilIcon size={9} />
                <span>{t('settings.software.icon', 'Icon')}</span>
              </button>
              {hasCustomIcon && (
                <button
                  type="button"
                  onClick={handleDeleteIcon}
                  className="text-[10px] font-bold px-1 py-0.5 rounded text-red-400 hover:bg-red-500/15 border border-red-500/20 transition-all cursor-pointer"
                  title={t('settings.software.resetIcon', 'Reset to Default')}
                >
                  <TrashIcon size={9} />
                </button>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".png,.svg,.jpg,.jpeg,.webp"
              className="hidden"
              onChange={handleIconUpload}
            />
          </div>

          {/* Title & Desc */}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-black tracking-wide text-[var(--text-primary)] uppercase truncate">
                {engine.name}
              </h3>
              {engine.always_enabled && (
                <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.2 rounded bg-brand-lime/10 text-brand-lime border border-brand-lime/20">
                  {t('settings.software.coreEngine', 'CORE')}
                </span>
              )}
            </div>
            <p className="text-[11px] text-[var(--text-secondary)] truncate">
              {engine.description}
            </p>
          </div>
        </div>

        {/* Master Engine Switch (locked for core FFmpeg / decklink helper) */}
        {!engine.always_enabled && (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
              {engine.is_enabled ? t('common.enabled', 'Enabled') : t('common.disabled', 'Disabled')}
            </span>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={engine.is_enabled}
                disabled={isUpdatingConfig}
                onChange={(e) =>
                  handleUpdateEngineConfig({ [`${engine.key}_enabled`]: e.target.checked })
                }
                className="sr-only peer"
              />
              <div className="w-8 h-4.5 bg-[var(--input-bg)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-brand-lime"></div>
            </label>
          </div>
        )}
      </div>

      {/* Engine Body when Enabled */}
      {engine.is_enabled && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {/* Subcard 1: System Binary (INSTALLED via which) */}
          {engine.supports_installed && (
            <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2.5 flex flex-col justify-between gap-2">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-primary)]">
                    {t('settings.software.systemBinary', 'System Binary ($PATH)')}
                  </span>
                  {engine.system_binary.found ? (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      ✓ {t('settings.software.detected', 'Detected')}
                    </span>
                  ) : (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
                      ✗ {t('settings.software.notFoundInPath', 'Not in $PATH')}
                    </span>
                  )}
                </div>

                {engine.system_binary.found ? (
                  <div className="mt-1 text-[11px] space-y-0.5">
                    <div className="text-[var(--text-secondary)] font-mono text-[10px] truncate">
                      {engine.system_binary.path}
                    </div>
                    <div className="text-[var(--text-primary)] font-semibold">
                      {t('settings.software.version', 'Version')}: <span className="text-brand-lime font-mono">{engine.system_binary.version}</span>
                    </div>
                  </div>
                ) : (
                  <p className="mt-1 text-[10px] text-[var(--text-secondary)]">
                    {t('settings.software.installViaPackage', 'The executable was not found in the system $PATH. Install it via your package manager or compile it to enable automatic detection.')}
                  </p>
                )}
              </div>

              {engine.system_binary.found && (
                <div className="pt-1.5 border-t border-[var(--glass-border)] flex items-center justify-between gap-2">
                  {engine.installed_build_registered ? (
                    <div className="flex items-center justify-between w-full">
                      <span className="text-[11px] text-brand-lime font-semibold flex items-center gap-1">
                        ● {t('settings.software.activeInBuilds', 'Active in dropdowns')}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleToggleInstalledBinary(false)}
                        className="text-[11px] text-red-400 hover:text-red-300 font-bold hover:underline cursor-pointer"
                      >
                        {t('settings.software.unregister', 'Unregister')}
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 w-full">
                      {isEditingAlias ? (
                        <>
                          <input
                            type="text"
                            placeholder="Alias (e.g. System FFmpeg)"
                            value={installedAlias}
                            onChange={(e) => setInstalledAlias(e.target.value)}
                            className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded px-2 py-0.5 text-xs text-[var(--text-primary)] flex-1"
                          />
                          <button
                            type="button"
                            onClick={() => handleToggleInstalledBinary(true)}
                            className="bg-brand-lime text-black font-bold text-[11px] px-2 py-0.5 rounded cursor-pointer"
                          >
                            {t('common.confirm', 'OK')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsEditingAlias(false)}
                            className="text-[11px] text-[var(--text-secondary)]"
                          >
                            {t('common.cancel', 'Cancel')}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setInstalledAlias(`System ${engine.name} ($PATH)`);
                            setIsEditingAlias(true);
                          }}
                          className="bg-brand-lime/15 hover:bg-brand-lime/25 text-brand-lime border border-brand-lime/30 text-[11px] font-bold px-2.5 py-1 rounded w-full transition-all cursor-pointer"
                        >
                          + {t('settings.software.registerInBuilds', 'Register in Builds')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Subcard 2: Forge Compiler (COMPILED) */}
          {engine.supports_forge && (
            <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2.5 flex flex-col justify-between gap-2">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-primary)]">
                    {t('settings.software.forgeCompilation', 'Forge Compiler (Source)')}
                  </span>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={engine.forge_enabled}
                      disabled={isUpdatingConfig || (engine.always_enabled && !engine.supports_installed && !engine.supports_precompiled)}
                      onChange={(e) =>
                        handleUpdateEngineConfig({
                          [`${engine.key}_forge_enabled`]: e.target.checked,
                        })
                      }
                      className="sr-only peer"
                    />
                    <div className="w-8 h-4.5 bg-[var(--bg-card)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-brand-lime"></div>
                  </label>
                </div>
                <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                  {t('settings.software.forgeDesc', 'Enable building custom versions and SDK variants for {{name}} in the Forge.', { name: engine.name })}
                </p>
              </div>

              <div className="pt-1.5 border-t border-[var(--glass-border)] text-[11px] text-[var(--text-secondary)] flex justify-between">
                <span>{t('settings.software.registeredCompiledBuilds', 'Compiled Builds')}:</span>
                <span className="font-bold text-[var(--text-primary)]">
                  {engine.builds.filter((b) => b.source_type === 'compiled').length}
                </span>
              </div>
            </div>
          )}

          {/* Subcard 3: Precompiled Releases Downloader (MediaMTX) */}
          {engine.supports_precompiled && (
            <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2.5 flex flex-col justify-between gap-2 col-span-1 md:col-span-2">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-primary)]">
                    {t('settings.software.precompiledReleases', 'Pre-compiled Official Releases (GitHub)')}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-secondary)] mb-2">
                  {t('settings.software.precompiledDesc', 'Download and provision standalone official releases directly without compiling.')}
                </p>

                {/* Release selector & download button */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleFetchReleases}
                    className="bg-[var(--bg-card)] border border-[var(--glass-border)] hover:border-brand-lime/40 text-[11px] px-2.5 py-1 rounded text-[var(--text-primary)] font-semibold cursor-pointer"
                  >
                    {isFetchingReleases ? t('common.loading', 'Loading...') : t('settings.software.fetchReleases', 'Check GitHub Releases')}
                  </button>

                  {releases.length > 0 && (
                    <>
                      <select
                        value={selectedRelease}
                        onChange={(e) => setSelectedRelease(e.target.value)}
                        className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded px-2 py-1 text-[11px] text-[var(--text-primary)] font-mono"
                      >
                        {releases.map((r) => (
                          <option key={r.tag} value={r.tag}>
                            v{r.tag}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        disabled={isDownloadingRelease}
                        onClick={handleDownloadRelease}
                        className="bg-brand-lime text-black font-bold text-[11px] px-3 py-1 rounded shadow-sm hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
                      >
                        {isDownloadingRelease ? t('settings.software.downloading', 'Downloading & Validating...') : t('settings.software.downloadAndInstall', '📥 Download & Install')}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Table of precompiled builds */}
              {engine.builds.filter((b) => b.source_type === 'precompiled').length > 0 && (
                <div className="pt-2 border-t border-[var(--glass-border)]">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] block mb-1.5">
                    {t('settings.software.provisionedReleases', 'Provisioned Releases')}:
                  </span>
                  <div className="space-y-1.5">
                    {engine.builds
                      .filter((b) => b.source_type === 'precompiled')
                      .map((b) => (
                        <div
                          key={b.id}
                          className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11px]"
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-[var(--text-primary)]">{b.name}</span>
                            <span className="font-mono text-[9px] text-brand-lime bg-brand-lime/10 px-1 py-0.2 rounded border border-brand-lime/20">
                              v{b.version_tag}
                            </span>
                            {b.disk_usage_mb && (
                              <span className="text-[9px] text-[var(--text-secondary)]">
                                ({b.disk_usage_mb} MB)
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-[var(--text-secondary)]">
                              {b.referencing_services_count}{' '}
                              {t('settings.software.dependentServices', 'services')}
                            </span>
                            <button
                              type="button"
                              onClick={() => onDeleteBuild(b.id)}
                              disabled={b.referencing_services_count > 0}
                              className={`p-1 rounded transition-colors ${
                                b.referencing_services_count > 0
                                  ? 'opacity-30 cursor-not-allowed text-[var(--text-secondary)]'
                                  : 'text-red-400 hover:bg-red-500/10 cursor-pointer'
                              }`}
                              title={b.referencing_services_count > 0 ? t('settings.software.cannotDeleteInUse', 'Cannot delete while used by services') : t('common.delete', 'Delete')}
                            >
                              <TrashIcon size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
