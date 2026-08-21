import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

export interface DecklinkActiveProcess {
  process_id: number;
  name: string;
  status: string;
  direction: 'input' | 'output';
}

export interface DecklinkSubDevice {
  index: number;
  display_name: string;
  model_name: string;
  persistent_id: number;
  topological_id: number;
  sub_device_index: number;
  num_sub_devices: number;
  profile_id: number;
  duplex_mode: string;
  supports_full_duplex: boolean;
  supports_internal_keying: boolean;
  video_input_connections: number;
  video_output_connections: number;
  signal_locked: boolean;
  detected_mode: string;
  detected_pixel_format: string;
  active_processes?: DecklinkActiveProcess[];
}

export interface DecklinkSystemStatus {
  driver_version: string | null;
  driver_installed: boolean;
  helper_path: string | null;
  helper_version: string | null;
  helper_available: boolean;
  firmware: {
    available: boolean;
    needs_update: boolean;
    raw_output?: string;
    devices?: string[];
  };
  devices: DecklinkSubDevice[];
  device_count: number;
  system_status: 'READY' | 'WARNING' | 'SETUP_REQUIRED';
}

export const DecklinkSettingsCard: React.FC<{ API?: string; onNavigateToForge?: () => void }> = ({
  API = '',
  onNavigateToForge,
}) => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<DecklinkSystemStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedDeviceIdx, setSelectedDeviceIdx] = useState<number>(0);
  
  // Configuration Modal state
  const [configuringDevice, setConfiguringDevice] = useState<DecklinkSubDevice | null>(null);
  const [configDuplex, setConfigDuplex] = useState<string>('half');
  const [configDefaultMode, setConfigDefaultMode] = useState<number>(0);
  const [isSavingConfig, setIsSavingConfig] = useState<boolean>(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configSuccess, setConfigSuccess] = useState<string | null>(null);

  // Firmware update state
  const [isUpdatingFirmware, setIsUpdatingFirmware] = useState<boolean>(false);
  const [firmwareResult, setFirmwareResult] = useState<{ success: boolean; output: string } | null>(null);
  
  // Refresh button ACK state
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [refreshSuccess, setRefreshSuccess] = useState<boolean>(false);

  const isMountedRef = useRef<boolean>(true);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/settings/decklink/status`);
      if (res.ok) {
        const data = await res.json();
        if (isMountedRef.current) {
          setStatus(data);
          setErrorMsg(null);
        }
      } else {
        const err = await res.json().catch(() => ({}));
        if (isMountedRef.current) {
          setErrorMsg(err.detail || 'Error loading DeckLink status');
        }
      }
    } catch (e: any) {
      if (isMountedRef.current) {
        setErrorMsg(e.message || 'Network error connecting to backend');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [API]);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    setRefreshSuccess(false);
    await fetchStatus();
    if (isMountedRef.current) {
      setIsRefreshing(false);
      setRefreshSuccess(true);
      setTimeout(() => {
        if (isMountedRef.current) setRefreshSuccess(false);
      }, 1000);
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    fetchStatus();

    // Live telemetry polling interval (every 3 seconds)
    const interval = setInterval(() => {
      fetchStatus();
    }, 3000);

    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchStatus]);

  const handleOpenConfig = (device: DecklinkSubDevice) => {
    setConfiguringDevice(device);
    setConfigDuplex(device.duplex_mode || 'half');
    setConfigDefaultMode(0);
    setConfigError(null);
    setConfigSuccess(null);
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configuringDevice) return;

    setIsSavingConfig(true);
    setConfigError(null);
    setConfigSuccess(null);

    try {
      const payload = {
        duplex: configDuplex,
        default_mode: configDefaultMode || undefined,
      };

      const res = await fetch(`${API}/api/settings/decklink/${configuringDevice.persistent_id || configuringDevice.index}/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok) {
        setConfigSuccess(t('settings.decklink.configAppliedSuccess', 'Configuration applied successfully'));
        await fetchStatus();
        setTimeout(() => {
          if (isMountedRef.current) setConfiguringDevice(null);
        }, 1200);
      } else {
        setConfigError(data.detail || data.error || 'Failed to apply configuration');
      }
    } catch (err: any) {
      setConfigError(err.message || 'Network error applying configuration');
    } finally {
      if (isMountedRef.current) setIsSavingConfig(false);
    }
  };

  const handleFirmwareUpdate = async (deviceIdx: number) => {
    if (!window.confirm(t('settings.decklink.confirmFirmwareUpdate', 'Are you sure you want to update the firmware on this DeckLink card? Do not power off the machine during the update.'))) {
      return;
    }

    setIsUpdatingFirmware(true);
    setFirmwareResult(null);

    try {
      const res = await fetch(`${API}/api/settings/decklink/${deviceIdx}/firmware-update`, {
        method: 'POST',
      });
      const data = await res.json();
      setFirmwareResult({
        success: res.ok && data.success,
        output: data.output || data.detail || (res.ok ? 'Update completed' : 'Update failed'),
      });
      await fetchStatus();
    } catch (e: any) {
      setFirmwareResult({
        success: false,
        output: e.message || 'Network error during firmware update',
      });
    } finally {
      if (isMountedRef.current) setIsUpdatingFirmware(false);
    }
  };

  if (loading && !status) {
    return (
      <div className="glass-card p-8 text-center bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl">
        <span className="w-8 h-8 border-2 border-brand-orange border-t-transparent rounded-full animate-spin inline-block mb-3" />
        <p className="text-xs text-text-secondary font-mono uppercase tracking-widest">{t('common.processing', 'Loading...')}</p>
      </div>
    );
  }

  const devices = status?.devices || [];
  const selectedDevice = devices[selectedDeviceIdx] || devices[0];

  // Helper version text sanitation
  const cleanHelperVer = status?.helper_version
    ? status.helper_version.split('\n')[0].trim()
    : null;

  return (
    <div className="space-y-6">
      {/* ── HEADER & COMPATIBILITY BANNER ────────────────────────────────────────── */}
      <div className="glass-card p-4 md:p-5 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl shadow-lg relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-black tracking-wider uppercase text-[var(--text-primary)] flex items-center gap-2">
              <span className="text-lg">🎛️</span>
              <span>{t('settings.decklink.title', 'BLACKMAGIC DECKLINK HARDWARE CONTROL')}</span>
            </h2>
            <p className="text-[11px] text-text-secondary mt-0.5">
              {t('settings.decklink.subtitle', 'Headless SDI/HDMI connector mapping, live signal telemetry, and firmware management')}
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm disabled:opacity-50 ${
                refreshSuccess
                  ? 'bg-brand-lime/20 border-brand-lime text-brand-lime scale-105'
                  : 'bg-[var(--input-bg)] border-[var(--glass-border)] text-text-secondary hover:text-[var(--text-primary)] hover:border-brand-lime'
              }`}
              title={t('common.refresh', 'Refresh')}
            >
              <span className={isRefreshing ? 'inline-block animate-spin' : ''}>
                {refreshSuccess ? '✓' : '🔄'}
              </span>
              <span>{refreshSuccess ? t('common.updated', 'Updated!') : t('common.refresh', 'Refresh')}</span>
            </button>
          </div>
        </div>

        {/* Global Error Banner */}
        {errorMsg && (
          <div className="mt-3 p-2.5 bg-red-500/15 border border-red-500/30 rounded-xl text-red-400 text-xs font-bold flex items-center justify-between">
            <span>⚠️ {errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} className="text-red-400 font-bold ml-2">✕</button>
          </div>
        )}

        {/* Dedicated Multiline Key: Value Telemetry Flow */}
        <div className="mt-3.5 pt-2.5 border-t border-[var(--glass-border)] space-y-1.5 text-xs font-mono">
          {/* Row 1: Kernel Driver */}
          <div className="flex items-center gap-2 py-0.5">
            <span className="text-text-secondary font-bold">
              {t('settings.decklink.kernelDriver', 'Kernel Driver (OS)')}:
            </span>
            <span className={`font-bold text-xs flex items-center gap-1.5 ${status?.driver_installed ? 'text-emerald-400' : 'text-red-400'}`}>
              <span className="shrink-0">{status?.driver_installed ? '🟢' : '🔴'}</span>
              <span>{status?.driver_installed ? `desktopvideo v${status.driver_version}` : t('settings.decklink.driverNotInstalled', 'desktopvideo not installed')}</span>
            </span>
          </div>

          {/* Row 2: Active Helper Tool */}
          <div className="flex items-center gap-2 py-0.5">
            <span className="text-text-secondary font-bold">
              {t('settings.decklink.activeHelper', 'Active Helper Tool')}:
            </span>
            <div className="flex items-center gap-2">
              <span className={`font-bold text-xs flex items-center gap-1.5 ${status?.helper_available ? 'text-emerald-400' : 'text-amber-400'}`}>
                <span className="shrink-0">{status?.helper_available ? '🟢' : '⚠️'}</span>
                <span>{cleanHelperVer || 'decklink-ctl (Pending Build)'}</span>
              </span>
              {onNavigateToForge && !status?.helper_available && (
                <button
                  onClick={onNavigateToForge}
                  className="px-2 py-0.5 bg-brand-orange text-black font-black rounded text-[9px] hover:scale-105 transition-transform cursor-pointer shrink-0"
                >
                  {t('forge.mainTitle', 'FORGE')}
                </button>
              )}
            </div>
          </div>

          {/* Row 3: Firmware Integrity */}
          <div className="flex items-center gap-2 py-0.5">
            <span className="text-text-secondary font-bold">
              {t('settings.decklink.firmwareStatus', 'Firmware Integrity')}:
            </span>
            <span className={`font-bold text-xs flex items-center gap-1.5 ${status?.firmware?.needs_update ? 'text-amber-400' : 'text-emerald-400'}`}>
              <span className="shrink-0">{status?.firmware?.needs_update ? '⚠️' : '✅'}</span>
              <span>
                {status?.firmware?.needs_update
                  ? t('settings.decklink.firmwareUpdateRequired', 'Update Required')
                  : t('settings.decklink.firmwareUpToDate', 'Up to Date')}
              </span>
            </span>
          </div>

          {/* Row 4: Active Sub-Devices Channels */}
          <div className="flex items-center gap-2 py-0.5">
            <span className="text-text-secondary font-bold">
              {t('settings.decklink.detectedSubDevices', 'Active Channels')}:
            </span>
            <span className="font-bold text-brand-lime text-xs flex items-center gap-1.5">
              <span className="shrink-0">🎛️</span>
              <span>{devices.length} {devices.length === 1 ? 'Channel' : 'Channels'}</span>
            </span>
          </div>
        </div>

        {/* Firmware Warning Notice */}
        {status?.firmware?.needs_update && (
          <div className="mt-3 p-3 bg-amber-500/15 border border-amber-500/40 rounded-xl text-amber-300 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-pulse">
            <div>
              <p className="font-bold flex items-center gap-1.5">
                <span>⚠️</span> {t('settings.decklink.firmwareAlertTitle', 'Firmware Update Required on Hardware')}
              </p>
              <p className="text-[11px] text-amber-200/80 mt-0.5">
                {t('settings.decklink.firmwareAlertSubtitle', 'One or more DeckLink cards require a firmware update to maintain compatibility with the host driver.')}
              </p>
            </div>
            <button
              onClick={() => handleFirmwareUpdate(selectedDevice?.index || 0)}
              disabled={isUpdatingFirmware}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-black text-xs rounded-xl transition-all cursor-pointer disabled:opacity-50 shrink-0"
            >
              {isUpdatingFirmware ? t('common.processing', 'Updating...') : t('settings.decklink.updateFirmwareBtn', 'Update Firmware Now')}
            </button>
          </div>
        )}

        {/* Firmware Result Box */}
        {firmwareResult && (
          <div className={`mt-3 p-3 rounded-xl border text-xs font-mono whitespace-pre-wrap ${
            firmwareResult.success ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}>
            <div className="flex justify-between items-center mb-1 font-bold">
              <span>{firmwareResult.success ? '✅ Firmware Update Result' : '❌ Firmware Update Error'}</span>
              <button onClick={() => setFirmwareResult(null)} className="cursor-pointer font-bold">✕</button>
            </div>
            {firmwareResult.output}
          </div>
        )}
      </div>

      {/* ── CARD 2: HARDWARE CARDS & CONNECTOR MATRIX ────────────────────────────── */}
      {devices.length === 0 ? (
        <div className="glass-card p-12 text-center bg-[var(--bg-card)] border border-dashed border-[var(--glass-border)] rounded-2xl">
          <span className="text-3xl mb-2 block">🎛️</span>
          <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--text-primary)]">
            {t('settings.decklink.noDevicesFound', 'No Blackmagic DeckLink Cards Detected')}
          </h3>
          <p className="text-xs text-text-secondary mt-1 max-w-md mx-auto">
            {t('settings.decklink.noDevicesFoundDesc', 'Make sure your PCIe DeckLink card is seated properly and that the Linux kernel driver (bmd-io / desktopvideo) is installed and loaded.')}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Card Device Selector Bar */}
          <div className="flex items-center justify-between gap-4 bg-[var(--input-bg)]/70 p-3 rounded-2xl border border-[var(--glass-border)]">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-text-secondary">
                {t('settings.decklink.selectChannel', 'Channel / Sub-Device:')}
              </span>
              <select
                value={selectedDeviceIdx}
                onChange={(e) => setSelectedDeviceIdx(Number(e.target.value))}
                className="bg-[var(--bg-card)] border border-[var(--glass-border)] text-[var(--text-primary)] text-xs font-bold rounded-xl px-3 py-1.5 focus:outline-none focus:border-brand-lime cursor-pointer font-mono"
              >
                {devices.map((d, idx) => (
                  <option key={d.persistent_id || idx} value={idx}>
                    [{d.index}] {d.display_name} — {d.duplex_mode.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

            {selectedDevice && (
              <div className="hidden sm:flex items-center gap-2 font-mono text-[11px] text-text-secondary">
                <span>Persistent ID:</span>
                <span className="font-bold text-brand-lime">{selectedDevice.persistent_id || selectedDevice.index}</span>
              </div>
            )}
          </div>

          {/* Connectors Grid / Abacus View */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {devices.map((dev, idx) => {
              const isSelected = idx === selectedDeviceIdx;
              const isLocked = dev.signal_locked;
              const isOutput = dev.video_output_connections > 0 && dev.video_input_connections === 0;
              const hasActiveProcesses = dev.active_processes && dev.active_processes.length > 0;

              const cleanMode = (dev.detected_mode || '').trim();
              const hasValidMode = cleanMode && !cleanMode.toLowerCase().includes('unknown') && !cleanMode.toLowerCase().includes('auto');
              const displayFormat = isLocked && hasValidMode
                ? cleanMode
                : isLocked
                ? t('settings.decklink.autoDetecting', 'Auto / Detecting')
                : t('settings.decklink.noSignalAuto', 'No Signal / Auto');

              const cleanPixel = (dev.detected_pixel_format || '').trim();
              const hasValidPixel = cleanPixel && !cleanPixel.toLowerCase().includes('unknown') && !cleanPixel.toLowerCase().includes('auto');
              const displayColorspace = isLocked && hasValidPixel
                ? cleanPixel
                : isLocked
                ? 'Auto'
                : '—';

              return (
                <div
                  key={dev.persistent_id || idx}
                  onClick={() => setSelectedDeviceIdx(idx)}
                  className={`glass-card p-4 rounded-2xl border transition-all cursor-pointer relative flex flex-col justify-between gap-3 shadow-md ${
                    isSelected
                      ? 'border-brand-lime/50 bg-[var(--bg-card)] ring-1 ring-brand-lime/30'
                      : 'border-[var(--glass-border)] bg-[var(--bg-card)]/60 hover:border-brand-lime/30 hover:bg-[var(--bg-card)]'
                  }`}
                >
                  {/* Top: Connector Type Badge & Duplex */}
                  <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2 gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-base shrink-0">{isOutput ? '🔵' : isLocked ? '🟢' : '⚫'}</span>
                      <span className="text-xs font-mono font-bold text-[var(--text-primary)] truncate" title={dev.display_name}>
                        {dev.display_name}
                      </span>
                    </div>

                    <span className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold uppercase tracking-wider border shrink-0 ${
                      dev.duplex_mode === 'full'
                        ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                        : 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                    }`}>
                      {dev.duplex_mode}
                    </span>
                  </div>

                  {/* Signal Telemetry Box */}
                  <div className="bg-[var(--input-bg)] p-3 rounded-xl border border-[var(--glass-border)]/60 space-y-1.5 font-mono text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-text-secondary text-[10px] uppercase shrink-0">{t('settings.decklink.signalStatus', 'Signal')}:</span>
                      <span className={`font-bold text-[11px] flex items-center gap-1 shrink-0 ${
                        isLocked ? 'text-emerald-400 animate-pulse' : 'text-text-secondary/60'
                      }`}>
                        <span>{isLocked ? '●' : '○'}</span>
                        <span>{isLocked ? t('settings.decklink.signalLocked', 'LOCKED') : t('settings.decklink.noSignal', 'NO SIGNAL')}</span>
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-text-secondary text-[10px] uppercase shrink-0">{t('settings.decklink.format', 'Format')}:</span>
                      <span className="font-bold text-[var(--text-primary)] truncate text-right" title={displayFormat}>
                        {displayFormat}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-text-secondary text-[10px] uppercase shrink-0">{t('settings.decklink.pixelFormat', 'Colorspace')}:</span>
                      <span className="font-bold text-text-secondary truncate text-right" title={displayColorspace}>
                        {displayColorspace}
                      </span>
                    </div>
                  </div>

                  {/* Active Assigned FFmpeg Services (Analogue to ALSA GUI) */}
                  <div className="space-y-1">
                    <div className="text-[9px] font-bold text-text-secondary uppercase tracking-wider">
                      {t('settings.decklink.assignedProcesses', 'Assigned Services')}
                    </div>
                    {hasActiveProcesses ? (
                      <div className="flex flex-wrap gap-1">
                        {dev.active_processes!.map((proc) => (
                          <span
                            key={proc.process_id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-brand-lime/15 border border-brand-lime/30 text-[10px] font-mono font-bold text-[var(--text-primary)] shadow-sm"
                            title={`Process #${proc.process_id} (${proc.status})`}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-brand-lime animate-pulse shrink-0" />
                            <span className="truncate max-w-[90px]">#{proc.process_id} {proc.name}</span>
                            <span className="text-[8px] uppercase text-brand-lime font-mono shrink-0">[{proc.direction}]</span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[10px] font-mono text-text-secondary/60 italic">
                        {t('settings.decklink.noProcessesAssigned', 'No active services assigned')}
                      </div>
                    )}
                  </div>

                  {/* Bottom: Configure Button */}
                  <div className="flex items-center justify-between pt-1 border-t border-[var(--glass-border)]/40">
                    <span className="text-[10px] font-mono text-text-secondary">
                      Sub-Dev #{dev.sub_device_index} of {dev.num_sub_devices}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenConfig(dev);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-[var(--input-bg)] hover:bg-brand-lime/20 border border-[var(--glass-border)] hover:border-brand-lime/40 text-text-secondary hover:text-[var(--text-primary)] text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                      title={t('settings.decklink.configurePort', 'Configure Port')}
                    >
                      <span>⚙️</span> {t('common.edit', 'Configure')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── PORT CONFIGURATION MODAL ────────────────────────────────────────────── */}
      {configuringDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="glass-card w-full max-w-lg p-6 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-3xl shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-3">
              <h3 className="text-sm font-black uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-2">
                <span>⚙️</span>
                <span>{t('settings.decklink.configTitle', 'Configure Port')} — {configuringDevice.display_name}</span>
              </h3>
              <button
                onClick={() => setConfiguringDevice(null)}
                className="w-7 h-7 rounded-full bg-[var(--input-bg)] hover:bg-brand-lime/10 text-text-secondary hover:text-[var(--text-primary)] flex items-center justify-center font-bold text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            {configError && (
              <div className="p-3 bg-red-500/15 border border-red-500/30 rounded-xl text-red-400 text-xs font-bold">
                ⚠️ {configError}
              </div>
            )}

            {configSuccess && (
              <div className="p-3 bg-emerald-500/15 border border-emerald-500/30 rounded-xl text-emerald-400 text-xs font-bold">
                ✅ {configSuccess}
              </div>
            )}

            <form onSubmit={handleSaveConfig} className="space-y-4 text-xs">
              {/* Duplex Mode Selector */}
              <div>
                <label className="block text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1">
                  {t('settings.decklink.duplexModeLabel', 'Duplex Mode (Connector Mapping)')}
                </label>
                <select
                  value={configDuplex}
                  onChange={(e) => setConfigDuplex(e.target.value)}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] text-[var(--text-primary)] rounded-xl p-2.5 font-bold focus:border-brand-lime outline-none cursor-pointer"
                >
                  <option value="half">{t('settings.decklink.duplexHalf', 'Half Duplex (Independent Individual SDI Channels)')}</option>
                  {configuringDevice.supports_full_duplex && (
                    <option value="full">{t('settings.decklink.duplexFull', 'Full Duplex (Paired Bidirectional In/Out Link)')}</option>
                  )}
                  <option value="inactive">{t('settings.decklink.duplexInactive', 'Inactive (Disabled / Low Power)')}</option>
                </select>
                <p className="text-[10px] text-text-secondary mt-1">
                  {t('settings.decklink.duplexHint', 'On dense cards like DeckLink Duo 2 / Quad 2, Half Duplex allows treating each BNC as an independent capture/playback stream.')}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-2 border-t border-[var(--glass-border)]">
                <button
                  type="button"
                  onClick={() => setConfiguringDevice(null)}
                  className="px-4 py-2 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] text-text-secondary hover:text-[var(--text-primary)] font-bold transition-all cursor-pointer"
                >
                  {t('common.cancel', 'Cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isSavingConfig}
                  className="px-5 py-2 rounded-xl bg-brand-lime hover:bg-brand-lime/90 text-black font-black shadow-lg transition-all cursor-pointer disabled:opacity-50"
                >
                  {isSavingConfig ? t('common.processing', 'Saving...') : t('common.saveChanges', 'Apply Configuration')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
