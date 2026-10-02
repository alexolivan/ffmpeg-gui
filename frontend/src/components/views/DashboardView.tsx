import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { BuildProfile } from '../../components/BuildProfileCard';
import { PeerStatusCard } from '../cards/PeerStatusCard';
import { ServicesDashboardCard } from '../cards/ServicesDashboardCard';
import { TasksDashboardCard } from '../cards/TasksDashboardCard';

interface DashboardViewProps {
  telemetry: any[];
  systemTelemetry: any;
  taskStats: any;
  upcomingTasks?: any[];
  builds: BuildProfile[];
  settings: any;
}


export const DashboardView: React.FC<DashboardViewProps> = ({
  telemetry,
  systemTelemetry,
  taskStats,
  upcomingTasks = [],
  builds,
  settings,
}) => {
  const { t } = useTranslation();
  const [locatorActive, setLocatorActive] = useState(false);
  const [sslStatus, setSslStatus] = useState<any>(null);
  const [initialPeers, setInitialPeers] = useState<any[]>([]);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [manualUpdateInfo, setManualUpdateInfo] = useState<any>(null);
  const [showCoresDrawer, setShowCoresDrawer] = useState(false);
  const [hardwareHealth, setHardwareHealth] = useState<any>(null);

  const handleCheckUpdates = async () => {
    if (checkingUpdates) return;
    setCheckingUpdates(true);
    try {
      const res = await fetch('/api/system/check-updates', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setManualUpdateInfo(data);
      }
    } catch (err) {
      console.error("Error checking updates:", err);
    } finally {
      setCheckingUpdates(false);
    }
  };

  const fetchPeers = () => {
    fetch('/api/peers/remote-nodes')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setInitialPeers(data.map((p: any) => ({
            id: p.id,
            name: p.name,
            base_url: p.base_url,
            status: p.status,
            latency_ms: p.latency_ms,
            cached_services_count: Array.isArray(p.cached_services) ? p.cached_services.length : 0,
            last_seen: p.last_seen,
            last_error: p.last_error
          })));
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetch('/api/settings/ssl/status')
      .then(res => res.json())
      .then(data => setSslStatus(data))
      .catch(err => console.error(err));
    fetchPeers();
    fetch('/api/hardware/health')
      .then(res => res.json())
      .then(data => setHardwareHealth(data))
      .catch(err => console.error("Error fetching hardware health:", err));
  }, []);

  const peers = (systemTelemetry?.peers && systemTelemetry.peers.length > 0)
    ? systemTelemetry.peers
    : initialPeers;

  const activeHardwareHealth = systemTelemetry?.hardware_health || hardwareHealth;

  useEffect(() => {
    let interval: any;
    if (systemTelemetry.lcd && systemTelemetry.lcd.connected) {
      const checkStatus = () => {
        fetch('/api/lcd/locator')
          .then(res => res.json())
          .then(data => setLocatorActive(!!data.active))
          .catch(err => console.error(err));
      };
      checkStatus();
      interval = setInterval(checkStatus, 2000);
    }
    return () => clearInterval(interval);
  }, [systemTelemetry.lcd?.connected]);

  const toggleLocator = async () => {
    try {
      const targetState = !locatorActive;
      const res = await fetch('/api/lcd/locator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: targetState }),
      });
      if (res.ok) {
        setLocatorActive(targetState);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const updateAvailable = manualUpdateInfo ? manualUpdateInfo.update_available : systemTelemetry?.update_available;
  const latestRelease = manualUpdateInfo ? manualUpdateInfo.latest_release : systemTelemetry?.latest_release;
  const releaseUrl = manualUpdateInfo ? manualUpdateInfo.release_url : (systemTelemetry?.release_url || 'https://github.com/alexolivan/ffmpeg-gui/releases');
  const isRelease = systemTelemetry?.is_release ?? true;
  const gitBranch = systemTelemetry?.git_branch || 'main';
  const gitCommit = systemTelemetry?.git_commit;

  // Partition hardware capabilities into active and unavailable
  const capabilitiesList = Object.entries(systemTelemetry.capabilities || {})
    .filter(([key]) => key !== 'ffmpeg' && key !== 'avahi' && key !== 'lcd');

  const activeCapabilities = capabilitiesList.filter(
    ([, value]: [string, any]) => value.available || value.status === 'SETUP_REQUIRED'
  );

  const unavailableHardware: { key: string; name: string; details?: string }[] = [];
  if (systemTelemetry.lcd && !systemTelemetry.lcd.connected) {
    unavailableHardware.push({
      key: 'lcd',
      name: 'LCD',
      details: t('dashboard.lcdUnavailableDetails', 'External hardware control panel is not detected'),
    });
  }
  capabilitiesList
    .filter(([, value]: [string, any]) => !value.available && value.status !== 'SETUP_REQUIRED')
    .forEach(([key, value]: [string, any]) => {
      unavailableHardware.push({
        key,
        name: key.toUpperCase(),
        details: value.details,
      });
    });

  return (
    <>
      <header className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-[var(--text-primary)] mb-0.5">{t('dashboard.title')}</h1>
          <p className="text-xs text-text-secondary">{t('dashboard.subtitle')}</p>
        </div>
        <div className="flex gap-4">
          {systemTelemetry.lcd && systemTelemetry.lcd.connected && (
            <button
              onClick={toggleLocator}
              className={`pill-button flex items-center gap-2 transition-all ${
                locatorActive 
                  ? 'bg-red-500 text-white animate-pulse shadow-lg shadow-red-500/25 border border-red-500' 
                  : 'bg-[var(--input-bg)] border border-[var(--glass-border)] text-[var(--text-primary)] hover:border-brand-lime/40'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${locatorActive ? 'bg-white' : 'bg-red-500'}`}></span>
              {locatorActive ? t('dashboard.locatorActive') : t('dashboard.findMe')}
            </button>
          )}
          <div className="pill-button bg-[var(--input-bg)] border border-[var(--glass-border)] text-[var(--text-primary)] flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-brand-lime"></span>
            {t('dashboard.node')}: {settings.lcd_alias || 'NODE-01'}
          </div>
        </div>
      </header>
 
      {/* Critical Thermal Alert Banner */}
      {activeHardwareHealth && (activeHardwareHealth.status === 'critical' || activeHardwareHealth.alerts?.some((a: any) => a.level === 'critical')) && (
        <div className="mb-5 p-4 rounded-xl bg-red-500/10 border-2 border-red-500/40 text-red-400 flex items-start gap-3 shadow-lg shadow-red-500/10 animate-pulse">
          <span className="text-2xl select-none">⚠️</span>
          <div className="flex-1">
            <h4 className="font-bold text-sm tracking-wide text-red-300 uppercase">
              {t('dashboard.criticalThermalAlert', { temp: activeHardwareHealth.max_temp_c ?? 'N/A' })}
            </h4>
            {settings?.thermal_active_protection && (
              <p className="text-xs text-red-300/80 mt-1 font-medium">
                {t('dashboard.activeProtectionEngaged')}
              </p>
            )}
            {activeHardwareHealth.alerts && activeHardwareHealth.alerts.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs font-mono text-red-200/90 list-disc list-inside">
                {activeHardwareHealth.alerts.map((alert: any, idx: number) => (
                  <li key={idx}>{alert.message}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 mb-8">
        {/* Column 1: System Status & Host Load */}
        <div className="space-y-4">
          <div className="glass-card p-4 border-brand-lime/10 space-y-3">
            <h3 className="text-sm font-black mb-2 text-[var(--text-primary)] uppercase tracking-wider flex items-center gap-2">
              <span>🖥️</span>
              <span>{t('dashboard.systemStatus', 'SYSTEM STATUS')}</span>
            </h3>

            <h4 className="text-[10px] font-black uppercase text-text-secondary tracking-wider mb-1.5">{t('dashboard.nodeResourcesLoad')}</h4>
            <div className="space-y-2">

              <div>
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="text-text-secondary">{t('dashboard.cpuLoad')}</span>
                  <span className="text-brand-lime font-mono font-bold text-xs">
                    {systemTelemetry.cpu}%
                  </span>
                </div>
                <div className="h-1.5 bg-[var(--track-bg)] border border-[var(--glass-border)] rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-brand-lime transition-all duration-500" 
                    style={{ width: `${Math.min(100, systemTelemetry.cpu)}%` }}
                  ></div>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="text-text-secondary">{t('dashboard.memoryUsage')}</span>
                  <span className="text-brand-orange font-mono font-bold text-xs">
                    {systemTelemetry.ram_used} MB / {systemTelemetry.ram_total || 16384} MB
                  </span>
                </div>
                <div className="h-1.5 bg-[var(--track-bg)] border border-[var(--glass-border)] rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-brand-orange transition-all duration-500" 
                    style={{ 
                      width: `${Math.min(100, systemTelemetry.ram_total > 0 
                        ? (systemTelemetry.ram_used / systemTelemetry.ram_total) * 100 
                        : 0)}%` 
                    }}
                  ></div>
                </div>
              </div>

              {systemTelemetry.gpu && systemTelemetry.gpu.vendor && systemTelemetry.gpu.vendor !== 'none' ? (
                <>
                  <div className="pt-1.5 border-t border-[var(--glass-border)]">
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="text-text-secondary flex items-center gap-1.5">
                        {t('dashboard.gpuLoad')} 
                        <span className="text-[9px] uppercase font-black tracking-wider px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-mono">
                          {systemTelemetry.gpu.vendor}
                        </span>
                      </span>
                      <span className="text-blue-400 font-mono font-bold text-xs">
                        {systemTelemetry.gpu.utilization}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-[var(--track-bg)] border border-[var(--glass-border)] rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-blue-400 transition-all duration-500" 
                        style={{ width: `${Math.min(100, systemTelemetry.gpu.utilization)}%` }}
                      ></div>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="text-text-secondary">{t('dashboard.vramUsage')}</span>
                      <span className="text-blue-400 font-mono font-bold text-xs">
                        {systemTelemetry.gpu.vram_used} MB / {systemTelemetry.gpu.vram_total} MB
                      </span>
                    </div>
                    <div className="h-1.5 bg-[var(--track-bg)] border border-[var(--glass-border)] rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-blue-400 transition-all duration-500" 
                        style={{ 
                          width: `${Math.min(100, systemTelemetry.gpu.vram_total > 0 
                            ? (systemTelemetry.gpu.vram_used / systemTelemetry.gpu.vram_total) * 100 
                            : 0)}%` 
                        }}
                      ></div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="pt-1.5 border-t border-[var(--glass-border)]">
                  <div className="flex items-center justify-between p-2 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg text-xs">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] font-mono">{t('dashboard.gpuTelemetry')}</span>
                    <span className="text-[10px] font-bold text-[var(--text-secondary)] opacity-60">{t('dashboard.notDetected')}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Thermal & Industrial Health */}
            <div className="pt-2.5 border-t border-[var(--glass-border)]">
              <h4 className="text-[10px] font-black uppercase text-text-secondary tracking-wider mb-2 flex items-center justify-between">
                <span>{t('dashboard.thermalAndHardwareHealth')}</span>
                {activeHardwareHealth?.status && (
                  <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded tracking-wider ${
                    activeHardwareHealth.status === 'critical'
                      ? 'bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse'
                      : activeHardwareHealth.status === 'warning'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'bg-brand-lime/20 text-brand-lime border border-brand-lime/30'
                  }`}>
                    {activeHardwareHealth.status}
                  </span>
                )}
              </h4>

              <div className="space-y-2">
                {/* CPU Package Temp & Throttling Badges */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {activeHardwareHealth?.cpu?.package_temp !== null && activeHardwareHealth?.cpu?.package_temp !== undefined ? (
                    <span className={`text-xs font-mono font-bold px-2 py-1 rounded-lg border flex items-center gap-1.5 ${
                      activeHardwareHealth.cpu.package_temp >= (settings?.thermal_critical_threshold ?? 85)
                        ? 'bg-red-500/20 text-red-400 border-red-500/40 animate-pulse'
                        : activeHardwareHealth.cpu.package_temp >= (settings?.thermal_warning_threshold ?? 75)
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                        : 'bg-brand-lime/10 text-brand-lime border-brand-lime/30'
                    }`}>
                      <span>🌡️</span>
                      <span>{t('dashboard.cpuPackageTemp')}:</span>
                      <span>{activeHardwareHealth.cpu.package_temp}°C</span>
                    </span>
                  ) : null}

                  {activeHardwareHealth?.cpu?.throttling && (
                    <span className={`text-[10px] font-mono px-2 py-1 rounded-lg border flex items-center gap-1 ${
                      activeHardwareHealth.cpu.throttling.active
                        ? 'bg-red-500/20 text-red-400 border-red-500/40 animate-pulse font-bold'
                        : activeHardwareHealth.cpu.throttling.throttling_detected
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30 font-medium'
                        : 'bg-[var(--input-bg)] text-text-secondary border-[var(--glass-border)]'
                    }`}>
                      {activeHardwareHealth.cpu.throttling.active
                        ? t('dashboard.throttlingActive', { count: activeHardwareHealth.cpu.throttling.recent_events })
                        : activeHardwareHealth.cpu.throttling.throttling_detected
                        ? t('dashboard.throttlingPast', { count: (activeHardwareHealth.cpu.throttling.total_package_events || 0) + (activeHardwareHealth.cpu.throttling.total_core_events || 0) })
                        : t('dashboard.throttlingNone')}
                    </span>
                  )}
                </div>

                {/* Individual Cores Drawer */}
                {activeHardwareHealth?.cpu?.cores && activeHardwareHealth.cpu.cores.length > 0 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowCoresDrawer(!showCoresDrawer)}
                      className="text-[10px] text-text-secondary hover:text-[var(--text-primary)] transition-colors flex items-center gap-1 font-mono py-0.5"
                    >
                      <span className="text-[8px]">{showCoresDrawer ? '▲' : '▼'}</span>
                      <span>{t('dashboard.cpuCores')} ({activeHardwareHealth.cpu.cores.length})</span>
                    </button>
                    {showCoresDrawer && (
                      <div className="grid grid-cols-2 gap-1 p-2 bg-[var(--input-bg)]/60 border border-[var(--glass-border)] rounded-lg text-[10px] font-mono mt-1 max-h-36 overflow-y-auto">
                        {activeHardwareHealth.cpu.cores.map((core: any, cIdx: number) => {
                          const cTemp = core.temp;
                          const isCrit = cTemp >= (settings?.thermal_critical_threshold ?? 85);
                          const isWarn = cTemp >= (settings?.thermal_warning_threshold ?? 75);
                          return (
                            <div key={cIdx} className="flex justify-between items-center text-text-secondary px-1">
                              <span className="truncate max-w-[70px]" title={core.label}>{core.label}:</span>
                              <span className={isCrit ? 'text-red-400 font-bold' : isWarn ? 'text-amber-400 font-bold' : 'text-brand-lime font-bold'}>
                                {cTemp}°C
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Chassis Fans */}
                {activeHardwareHealth?.fans && activeHardwareHealth.fans.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {activeHardwareHealth.fans.map((fan: any, fIdx: number) => (
                      <span
                        key={fIdx}
                        className={`text-[10px] font-mono px-2 py-0.5 rounded-md border flex items-center gap-1 ${
                          fan.rpm === 0
                            ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                            : 'bg-[var(--input-bg)] text-text-secondary border-[var(--glass-border)]'
                        }`}
                      >
                        <span className="text-xs">🌀</span>
                        <span className="font-semibold text-[var(--text-primary)]">{fan.name}:</span>
                        <span>{fan.rpm > 0 ? t('dashboard.fanRpm', { rpm: fan.rpm }) : t('dashboard.fanStopped')}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {systemTelemetry.storages && systemTelemetry.storages.length > 0 && (
              <div className="mt-3 pt-3 border-t border-[var(--glass-border)]">
                <h4 className="text-[10px] font-black uppercase text-text-secondary tracking-wider mb-2">
                  {t('dashboard.storageCapacities')}
                </h4>
                <div className="space-y-2">
                  {systemTelemetry.storages.map((storage: any) => {
                    const percent = storage.percent !== undefined ? storage.percent : 0;
                    const freeGb = storage.free_gb !== undefined ? storage.free_gb : 0;
                    return (
                      <div key={storage.id || storage.name} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[var(--text-primary)] font-bold truncate max-w-[140px]" title={storage.name}>
                              {storage.name}
                            </span>
                            <span className="text-[8px] font-black uppercase bg-brand-orange/20 text-brand-orange px-1.5 py-0.2 rounded tracking-wider shrink-0">
                              {storage.type}
                            </span>
                          </div>
                          <span className="text-text-secondary font-mono text-[10px] shrink-0">
                            {percent}% ({freeGb} {t('dashboard.freeGb')})
                          </span>
                        </div>
                        <div className="h-1.5 bg-[var(--track-bg)] border border-[var(--glass-border)] rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-500 ${
                              percent < 75
                                ? 'bg-brand-lime'
                                : percent <= 90
                                ? 'bg-brand-orange'
                                : 'bg-red-500 animate-pulse'
                            }`}
                            style={{ width: `${Math.min(100, percent)}%` }}
                          ></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Column 2: Workloads (Services & Tasks Stacked) */}
        <div className="space-y-4">
          <ServicesDashboardCard telemetry={telemetry} />
          <TasksDashboardCard taskStats={taskStats} upcomingTasks={upcomingTasks} />
        </div>

        {/* Column 3: Hardware Capabilities Detection */}
        <div className="glass-card p-4 border-brand-orange/10 space-y-2.5">
          <h3 className="text-sm font-black mb-1.5 text-[var(--text-primary)] uppercase tracking-wider">

            {t('dashboard.hardwarePeripherals')}
          </h3>
          <p className="text-xs text-text-secondary mb-3 leading-normal">
            {t('dashboard.hardwareIntrospection')}
          </p>
          <div className="space-y-2">
            {/* LCD Status Item - Only when connected */}
            {systemTelemetry.lcd && systemTelemetry.lcd.connected && (
              <div className="flex flex-col gap-1 p-2 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs uppercase text-[var(--text-primary)] font-mono">{t('dashboard.lcdPanel')}</span>
                  <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-brand-lime/25 text-brand-lime">
                    {t('dashboard.available')}
                  </span>
                </div>
                <p className="text-[10px] text-text-secondary mt-1">
                  Crystalfontz CFA-635 active on {systemTelemetry.lcd.port || 'detected port'}
                </p>
              </div>
            )}

            {/* AudioScience Card Telemetry */}
            {activeHardwareHealth?.av_hardware?.audioscience && activeHardwareHealth.av_hardware.audioscience.length > 0 && (
              <div className="flex flex-col gap-1.5 p-2.5 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs uppercase text-[var(--text-primary)] font-mono">AUDIOSCIENCE</span>
                  <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-brand-lime/25 text-brand-lime">
                    {t('dashboard.available')}
                  </span>
                </div>
                <div className="space-y-1.5 mt-0.5">
                  {activeHardwareHealth.av_hardware.audioscience.map((asi: any) => (
                    <div key={asi.adapter_index} className="space-y-1 p-1.5 bg-black/10 rounded-lg border border-[var(--glass-border)]">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-[var(--text-primary)] font-mono">
                          Adapter #{asi.adapter_index} — {asi.model || 'ASI Card'}
                        </span>
                        {asi.serial && (
                          <span className="text-[9px] font-mono text-text-secondary opacity-75">
                            s/n: {asi.serial}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        {asi.dsp_cpu_percent !== null && (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-brand-lime/10 text-brand-lime border border-brand-lime/20 font-bold">
                            {t('dashboard.dspLoad')}: {asi.dsp_cpu_percent}%
                          </span>
                        )}
                        {asi.dsp_temp_c !== null ? (
                          <span className={`text-[10px] font-mono px-2 py-0.5 rounded border font-bold ${
                            asi.dsp_temp_c >= (settings?.thermal_critical_threshold ?? 85)
                              ? 'bg-red-500/20 text-red-400 border-red-500/40 animate-pulse'
                              : asi.dsp_temp_c >= (settings?.thermal_warning_threshold ?? 75)
                              ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                              : 'bg-brand-lime/10 text-brand-lime border-brand-lime/20'
                          }`}>
                            🌡️ {t('dashboard.dspTemp')}: {asi.dsp_temp_c}°C
                          </span>
                        ) : (
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[var(--input-bg)] text-text-secondary opacity-70 border border-[var(--glass-border)]">
                            {t('dashboard.noTempSensor')}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Active Hardware Capabilities */}
            {activeCapabilities.map(([key, value]: [string, any]) => (
              <div key={key} className="flex flex-col gap-1 p-2 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs uppercase text-[var(--text-primary)] font-mono">{key}</span>
                  <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded ${
                    value.available
                      ? 'bg-brand-lime/25 text-brand-lime'
                      : 'bg-amber-500/25 text-amber-300'
                  }`}>
                    {value.available ? t('dashboard.available') : t('dashboard.setupRequired', 'SETUP REQUIRED')}
                  </span>
                </div>
                <p className="text-[10px] text-text-secondary mt-1">{value.details}</p>
                {key === 'vaapi' && value.available && (
                  <div className="mt-2 pt-2 border-t border-white/5 space-y-1 text-[9px] text-text-secondary font-mono leading-normal">
                    {value.driver_version && (
                      <div><span className="text-text-secondary">Driver:</span> {value.driver_version}</div>
                    )}
                    {value.vaapi_version && (
                      <div><span className="text-text-secondary">VA-API:</span> v{value.vaapi_version} (libva {value.libva_version || 'N/A'})</div>
                    )}
                    {value.encoders && value.encoders.length > 0 && (
                      <div><span className="text-text-secondary">Coders HW:</span> {value.encoders.join(', ')}</div>
                    )}
                  </div>
                )}
                {key === 'nvenc' && value.available && (
                  <div className="mt-2 pt-2 border-t border-white/5 space-y-1 text-[9px] text-text-secondary font-mono leading-normal">
                    {value.gpu_name && (
                      <div><span className="text-text-secondary">GPU:</span> {value.gpu_name}{value.gpu_arch ? ` (${value.gpu_arch})` : ''}</div>
                    )}
                    {value.driver_version && (
                      <div><span className="text-text-secondary">Driver:</span> {value.driver_version}</div>
                    )}
                    {value.cuda_version && (
                      <div><span className="text-text-secondary">CUDA:</span> v{value.cuda_version}</div>
                    )}
                    {value.encoders && value.encoders.length > 0 && (
                      <div><span className="text-text-secondary">Coders HW:</span> {value.encoders.join(', ')}</div>
                    )}
                  </div>
                )}
                {key === 'alsa' && value.available && value.cards && value.cards.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-white/5 space-y-1 text-[9px] text-text-secondary font-mono leading-normal">
                    <div><span className="text-text-secondary">Cards:</span> {value.cards.join(', ')}</div>
                  </div>
                )}
                {key === 'decklink' && value.available && (
                  <div className="mt-2 pt-2 border-t border-white/5 space-y-1.5 text-[9px] text-text-secondary font-mono leading-normal">
                    {value.cards && value.cards.length > 0 && (
                      <div><span className="text-text-secondary">Cards:</span> {value.cards.join(', ')}</div>
                    )}
                    {activeHardwareHealth?.av_hardware?.decklink && activeHardwareHealth.av_hardware.decklink.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {activeHardwareHealth.av_hardware.decklink.map((dl: any, idx: number) => (
                          <div key={idx} className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[var(--input-bg)] border border-[var(--glass-border)]">
                            <span className="text-[var(--text-primary)] font-bold">{dl.name}:</span>
                            <span className="text-brand-blue font-bold">
                              {t('dashboard.pcieBus')}: {dl.pcie_link || 'OK'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {key === 'magewell' && (
                  <div className="mt-2 pt-2 border-t border-white/5 space-y-1.5 text-[9px] text-text-secondary font-mono leading-normal">
                    {value.cards && value.cards.length > 0 && (
                      <div><span className="text-text-secondary">Cards:</span> {value.cards.join(', ')}</div>
                    )}
                    {activeHardwareHealth?.av_hardware?.magewell && activeHardwareHealth.av_hardware.magewell.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {activeHardwareHealth.av_hardware.magewell.map((mw: any, idx: number) => (
                          <div key={idx} className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[var(--input-bg)] border border-[var(--glass-border)]">
                            <span className="text-[var(--text-primary)] font-bold">{mw.name || `CH${mw.channel_index}`}:</span>
                            {mw.fpga_temp_c !== null ? (
                              <span className={`font-bold ${
                                mw.fpga_temp_c >= (settings?.thermal_critical_threshold ?? 85)
                                  ? 'text-red-400'
                                  : mw.fpga_temp_c >= (settings?.thermal_warning_threshold ?? 75)
                                  ? 'text-amber-400'
                                  : 'text-brand-lime'
                              }`}>
                                🌡️ {t('dashboard.fpgaTemp')}: {mw.fpga_temp_c}°C
                              </span>
                            ) : (
                              <span className="opacity-60">{t('dashboard.noTempSensor')}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Empty state if no active hardware acceleration is detected */}
            {activeCapabilities.length === 0 && (!systemTelemetry.lcd || !systemTelemetry.lcd.connected) && (!activeHardwareHealth?.av_hardware?.audioscience || activeHardwareHealth.av_hardware.audioscience.length === 0) && (
              <div className="p-3 bg-[var(--input-bg)]/40 border border-[var(--glass-border)] rounded-xl text-center">
                <p className="text-xs text-text-secondary">
                  {t('dashboard.noActiveHardware', 'No specialized hardware acceleration or capture devices detected.')}
                </p>
              </div>
            )}

            {/* Compact Unavailable Devices Summary Row */}
            {unavailableHardware.length > 0 && (
              <div className="pt-2 border-t border-[var(--glass-border)]">
                <div className="flex flex-wrap items-center gap-1.5 p-2 bg-[var(--input-bg)]/60 border border-[var(--glass-border)] rounded-xl text-xs">
                  <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/5 text-text-secondary shrink-0">
                    {t('dashboard.unavailable', 'UNAVAILABLE')}
                  </span>
                  <div className="flex flex-wrap items-center gap-1 min-w-0">
                    {unavailableHardware.map((item) => (
                      <span
                        key={item.key}
                        title={item.details}
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-text-secondary border border-white/5 hover:border-white/20 transition-colors cursor-help"
                      >
                        {item.name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Column 4: System Info & Federation */}
        <div className="space-y-4">
          {/* System Info */}
          <div className="glass-card p-4 border-[var(--glass-border)]">
            <h3 className="text-sm font-black uppercase text-[var(--text-primary)] tracking-wider mb-2">{t('dashboard.systemInfo')}</h3>
            <div className="space-y-0.5">
              {settings?.ssl_enabled && sslStatus && (
                <>
                  <div className="flex items-center justify-between py-1.5 border-b border-[var(--glass-border)]">
                    <span className="text-[11px] text-text-secondary">{t('dashboard.sniHostname', 'SNI Hostname')}</span>
                    <span className="text-[11px] font-mono font-bold text-brand-blue text-right truncate max-w-[170px]" title={`https://${settings?.ssl_domain || sslStatus.domain || 'localhost'}:${settings?.https_port || 8443}`}>
                      https://{settings?.ssl_domain || sslStatus.domain || 'localhost'}:{settings?.https_port || 8443}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-1.5 border-b border-[var(--glass-border)]">
                    <span className="text-[11px] text-text-secondary">{t('dashboard.sslCertificate', 'SSL Certificate')}</span>
                    <span className={`text-[11px] font-mono font-bold text-right ${
                      sslStatus.status === 'valid' ? 'text-brand-lime' :
                      sslStatus.status === 'warning' ? 'text-amber-400' :
                      'text-red-400 font-bold animate-pulse'
                    }`}>
                      {sslStatus.valid ? `Expires in ${sslStatus.days_remaining}d` : 'EXPIRED / INVALID'}
                    </span>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between py-1.5 border-b border-[var(--glass-border)]">
                <span className="text-[11px] text-text-secondary">{t('dashboard.environment', 'Environment')}</span>
                <div className="flex items-center gap-1.5">
                  {isRelease ? (
                    <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                      🟢 {t('dashboard.envProduction', 'Production')}
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400" title={gitCommit ? `Commit: ${gitCommit}` : undefined}>
                      🟣 {gitBranch} {gitCommit ? `(${gitCommit})` : ''}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-[var(--glass-border)]">
                <span className="text-[11px] text-text-secondary">{t('dashboard.activeProfiles')}</span>
                <span className="text-[11px] font-mono font-bold text-brand-lime text-right">
                  {builds.filter(b => b.status === 'ready').length}
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-[var(--glass-border)]">
                <span className="text-[11px] text-text-secondary">{t('dashboard.frontendVersion')}</span>
                <span className="text-[11px] font-mono font-bold text-brand-lime text-right">
                  v{import.meta.env.VITE_APP_VERSION || '1.0.0'}
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-[var(--glass-border)]">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-text-secondary">{t('dashboard.backendApiVersion')}</span>
                  <button
                    type="button"
                    onClick={handleCheckUpdates}
                    disabled={checkingUpdates}
                    title={checkingUpdates ? t('dashboard.checkingUpdates', 'Checking...') : t('dashboard.checkUpdates', 'Check for updates')}
                    className="text-[11px] text-text-secondary hover:text-brand-lime transition-colors disabled:opacity-50 p-0.5 cursor-pointer"
                  >
                    <span className={`inline-block ${checkingUpdates ? 'animate-spin' : ''}`}>↻</span>
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  {updateAvailable && latestRelease ? (
                    <a
                      href={releaseUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={`${t('dashboard.updateAvailable', 'Update available')}: v${latestRelease}`}
                      className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-all flex items-center gap-1"
                    >
                      <span>▲ v{latestRelease}</span>
                    </a>
                  ) : null}
                  <span className={`text-[11px] font-mono font-bold text-right ${updateAvailable ? 'text-amber-400' : 'text-brand-lime'}`}>
                    v{systemTelemetry.backend_version || '1.0.0'}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <span className="text-[11px] text-text-secondary">{t('dashboard.databaseSchema')}</span>
                <span className="text-[11px] font-mono font-bold text-brand-lime text-right">
                  v{systemTelemetry.schema_version || '1.0.0'}
                </span>
              </div>
            </div>
          </div>

          {/* Peer Federation Status */}
          {peers && peers.length > 0 && (
            <PeerStatusCard peers={peers} onRefreshAll={fetchPeers} />
          )}
        </div>
      </div>
    </>
  );
};

