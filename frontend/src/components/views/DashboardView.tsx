import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { BuildProfile } from '../../components/BuildProfileCard';

interface DashboardViewProps {
  telemetry: any[];
  systemTelemetry: any;
  taskStats: any;
  upcomingTasks?: any[];
  builds: BuildProfile[];
  settings: any;
}

function formatRelativeNextRun(isoString: string | null, t: any): string {
  if (!isoString) return '';
  const target = new Date(isoString);
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();
  
  if (diffMs <= 0) {
    return t('dashboard.nextRunImminent', 'Imminent');
  }
  
  const diffMins = Math.floor(diffMs / (1000 * 60));
  if (diffMins < 60) {
    return t('dashboard.nextRunInMins', 'In {{mins}} min', { mins: diffMins || 1 });
  }
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) {
    const remainingMins = diffMins % 60;
    if (remainingMins === 0) {
      return t('dashboard.nextRunInHours', 'In {{hours}}h', { hours: diffHours });
    }
    return t('dashboard.nextRunInHoursMins', 'In {{hours}}h {{mins}}m', { hours: diffHours, mins: remainingMins });
  }
  
  const hours = target.getHours().toString().padStart(2, '0');
  const minutes = target.getMinutes().toString().padStart(2, '0');
  
  const isSameDay = target.getDate() === now.getDate() && target.getMonth() === now.getMonth() && target.getFullYear() === now.getFullYear();
  if (isSameDay) {
    return t('dashboard.nextRunTodayAt', 'Today at {{time}}', { time: `${hours}:${minutes}` });
  }
  
  const month = (target.getMonth() + 1).toString().padStart(2, '0');
  const day = target.getDate().toString().padStart(2, '0');
  return `${day}/${month} ${hours}:${minutes}`;
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

  return (
    <>
      <header className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white mb-0.5">{t('dashboard.title')}</h1>
          <p className="text-xs text-text-secondary">{t('dashboard.subtitle')}</p>
        </div>
        <div className="flex gap-4">
          {systemTelemetry.lcd && systemTelemetry.lcd.connected && (
            <button
              onClick={toggleLocator}
              className={`pill-button flex items-center gap-2 transition-all ${
                locatorActive 
                  ? 'bg-red-500 text-white animate-pulse shadow-lg shadow-red-500/25 border border-red-500' 
                  : 'bg-white/5 border border-white/10 text-white/60 hover:bg-white/10'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${locatorActive ? 'bg-white' : 'bg-red-500'}`}></span>
              {locatorActive ? t('dashboard.locatorActive') : t('dashboard.findMe')}
            </button>
          )}
          <div className="pill-button bg-white/5 border border-white/10 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-brand-lime"></span>
            {t('dashboard.node')}: {settings.lcd_alias || 'NODE-01'}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-12">
        {/* Column 1: Process Management & load */}
        <div className="space-y-4">
          <div className="glass-card p-4 md:p-5 border-brand-lime/10">
            <h3 className="text-xl font-black mb-3">{t('dashboard.systemStats')}</h3>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
              <div className="bg-white/5 border border-white/5 rounded-2xl p-3 text-center">
                <div className="text-[9px] uppercase font-bold text-text-secondary mb-1">{t('dashboard.activeServices')}</div>
                <div className="font-black text-xl text-brand-lime">
                  {telemetry.filter(p => (p.type === 'service' || !p.type) && p.status === 'running').length}
                </div>
              </div>
              <div className="bg-white/5 border border-white/5 rounded-2xl p-3 text-center">
                <div className="text-[9px] uppercase font-bold text-text-secondary mb-1">{t('dashboard.inactiveServices')}</div>
                <div className="font-black text-xl text-white/50">
                  {telemetry.filter(p => (p.type === 'service' || !p.type) && p.status !== 'running').length}
                </div>
              </div>
              <div className="bg-white/5 border border-white/5 rounded-2xl p-3 text-center">
                <div className="text-[9px] uppercase font-bold text-text-secondary mb-1">{t('dashboard.activeTasks')}</div>
                <div className="font-black text-xl text-brand-blue">
                  {taskStats.active}
                </div>
              </div>
              <div className="bg-white/5 border border-white/5 rounded-2xl p-3 text-center">
                <div className="text-[9px] uppercase font-bold text-text-secondary mb-1">{t('dashboard.scheduledTasks')}</div>
                <div className="font-black text-xl text-brand-orange">
                  {taskStats.scheduled}
                </div>
              </div>
              <div className="bg-white/5 border border-white/5 rounded-2xl p-3 text-center col-span-2 lg:col-span-1">
                <div className="text-[9px] uppercase font-bold text-text-secondary mb-1">{t('dashboard.inactiveTasks')}</div>
                <div className="font-black text-xl text-white/40">
                  {taskStats.inactive}
                </div>
              </div>
            </div>

            <h4 className="text-xs font-black uppercase text-text-secondary tracking-wider mb-2">{t('dashboard.nodeResourcesLoad')}</h4>
            <div className="space-y-2.5">
              <div>
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="text-text-secondary">{t('dashboard.cpuLoad')}</span>
                  <span className="text-brand-lime font-mono font-bold">
                    {systemTelemetry.cpu}%
                  </span>
                </div>
                <div className="h-2 bg-[var(--track-bg)] border border-[var(--glass-border)] rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-brand-lime transition-all duration-500" 
                    style={{ width: `${Math.min(100, systemTelemetry.cpu)}%` }}
                  ></div>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="text-text-secondary">{t('dashboard.memoryUsage')}</span>
                  <span className="text-brand-orange font-mono font-bold">
                    {systemTelemetry.ram_used} MB / {systemTelemetry.ram_total || 16384} MB
                  </span>
                </div>
                <div className="h-2 bg-[var(--track-bg)] border border-[var(--glass-border)] rounded-full overflow-hidden">
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
                  <div className="pt-2 border-t border-[var(--glass-border)]">
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="text-text-secondary flex items-center gap-1.5">
                        {t('dashboard.gpuLoad')} 
                        <span className="text-[9px] uppercase font-black tracking-wider px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-mono">
                          {systemTelemetry.gpu.vendor}
                        </span>
                      </span>
                      <span className="text-blue-400 font-mono font-bold">
                        {systemTelemetry.gpu.utilization}%
                      </span>
                    </div>
                    <div className="h-2 bg-[var(--track-bg)] border border-[var(--glass-border)] rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-blue-400 transition-all duration-500" 
                        style={{ width: `${Math.min(100, systemTelemetry.gpu.utilization)}%` }}
                      ></div>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="text-text-secondary">{t('dashboard.vramUsage')}</span>
                      <span className="text-blue-400 font-mono font-bold">
                        {systemTelemetry.gpu.vram_used} MB / {systemTelemetry.gpu.vram_total} MB
                      </span>
                    </div>
                    <div className="h-2 bg-[var(--track-bg)] border border-[var(--glass-border)] rounded-full overflow-hidden">
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
                <div className="pt-3 border-t border-white/5">
                  <div className="flex flex-col items-center justify-center p-4 bg-white/2 border border-white/5 rounded-xl text-center">
                    <span className="text-[10px] font-black uppercase tracking-wider text-white/30 font-mono mb-1">{t('dashboard.gpuTelemetry')}</span>
                    <span className="text-xs font-bold text-white/40">{t('dashboard.notDetected')}</span>
                  </div>
                </div>
              )}
            </div>

            {systemTelemetry.storages && systemTelemetry.storages.length > 0 && (
              <div className="mt-4 pt-4 border-t border-white/5">
                <h4 className="text-xs font-black uppercase text-text-secondary tracking-wider mb-2">
                  {t('dashboard.storageCapacities')}
                </h4>
                <div
                  className={`space-y-2.5 ${
                    systemTelemetry.storages.length > 4 ? 'max-h-48 overflow-y-auto pr-1' : ''
                  }`}
                >
                  {systemTelemetry.storages.map((storage: any) => {
                    const percent = storage.percent !== undefined ? storage.percent : 0;
                    const freeGb = storage.free_gb !== undefined ? storage.free_gb : 0;
                    return (
                      <div key={storage.id || storage.name} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-white font-bold truncate max-w-[120px]" title={storage.name}>
                              {storage.name}
                            </span>
                            <span className="text-[8px] font-black uppercase bg-brand-orange/20 text-brand-orange px-1.5 py-0.5 rounded tracking-wider shrink-0">
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

        {/* Column 2: Hardware Capabilities Detection */}
        <div className="glass-card p-4 md:p-5 border-brand-orange/10">
          <h3 className="text-xl font-black mb-3">{t('dashboard.hardwarePeripherals')}</h3>
          <p className="text-xs text-text-secondary mb-4 leading-relaxed">
            {t('dashboard.hardwareIntrospection')}
          </p>
          <div className="space-y-2">
            {/* LCD Status Item */}
            {systemTelemetry.lcd && (
              <div className="flex flex-col gap-1 p-2 bg-white/2 border border-white/5 rounded-xl">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs uppercase text-white font-mono">{t('dashboard.lcdPanel')}</span>
                  <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded ${
                    systemTelemetry.lcd.connected
                      ? 'bg-brand-lime/25 text-brand-lime'
                      : 'bg-white/5 text-white/40'
                  }`}>
                    {systemTelemetry.lcd.connected ? t('dashboard.available') : t('dashboard.unavailable')}
                  </span>
                </div>
                <p className="text-[10px] text-text-secondary mt-1">
                  {systemTelemetry.lcd.connected 
                    ? `Crystalfontz CFA-635 active on ${systemTelemetry.lcd.port || 'detected port'}`
                    : 'External hardware control panel is not detected'
                  }
                </p>
              </div>
            )}

            {Object.entries(systemTelemetry.capabilities || {})
              .filter(([key]) => key !== 'ffmpeg' && key !== 'avahi')
              .map(([key, value]: [string, any]) => (
              <div key={key} className="flex flex-col gap-1 p-2 bg-white/2 border border-white/5 rounded-xl">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs uppercase text-white font-mono">{key}</span>
                  <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded ${
                    value.available
                      ? 'bg-brand-lime/25 text-brand-lime'
                      : 'bg-white/5 text-white/40'
                  }`}>
                    {value.available ? t('dashboard.available') : t('dashboard.unavailable')}
                  </span>
                </div>
                <p className="text-[10px] text-text-secondary mt-1">{value.details}</p>
                {key === 'vaapi' && value.available && (
                  <div className="mt-2 pt-2 border-t border-white/5 space-y-1 text-[9px] text-text-secondary font-mono leading-normal">
                    {value.driver_version && (
                      <div><span className="text-white/60">Driver:</span> {value.driver_version}</div>
                    )}
                    {value.vaapi_version && (
                      <div><span className="text-white/60">VA-API:</span> v{value.vaapi_version} (libva {value.libva_version || 'N/A'})</div>
                    )}
                    {value.encoders && value.encoders.length > 0 && (
                      <div><span className="text-white/60">Coders HW:</span> {value.encoders.join(', ')}</div>
                    )}
                  </div>
                )}
                {key === 'nvenc' && value.available && (
                  <div className="mt-2 pt-2 border-t border-white/5 space-y-1 text-[9px] text-text-secondary font-mono leading-normal">
                    {value.gpu_name && (
                      <div><span className="text-white/60">GPU:</span> {value.gpu_name}{value.gpu_arch ? ` (${value.gpu_arch})` : ''}</div>
                    )}
                    {value.driver_version && (
                      <div><span className="text-white/60">Driver:</span> {value.driver_version}</div>
                    )}
                    {value.cuda_version && (
                      <div><span className="text-white/60">CUDA:</span> v{value.cuda_version}</div>
                    )}
                    {value.encoders && value.encoders.length > 0 && (
                      <div><span className="text-white/60">Coders HW:</span> {value.encoders.join(', ')}</div>
                    )}
                  </div>
                )}
                {key === 'alsa' && value.available && value.cards && value.cards.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-white/5 space-y-1 text-[9px] text-text-secondary font-mono leading-normal">
                    <div><span className="text-white/60">Cards:</span> {value.cards.join(', ')}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Column 3: System Info & Scheduler status */}
        <div className="space-y-4">
          {/* System Info */}
          <div className="glass-card p-4 md:p-5 border-white/5">
            <h3 className="text-xl font-black mb-3">{t('dashboard.systemInfo')}</h3>
            <div className="space-y-4">
              <div className="flex justify-between py-2 border-b border-white/5">
                <span className="text-xs text-text-secondary">{t('dashboard.hostOsArch')}</span>
                <span className="text-xs font-mono font-bold text-white">
                  {systemTelemetry.host_os_arch || 'Linux x86_64'}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-white/5">
                <span className="text-xs text-text-secondary">{t('dashboard.activeProfiles')}</span>
                <span className="text-xs font-mono font-bold text-brand-lime text-right">
                  {builds.filter(b => b.status === 'ready').length}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-white/5">
                <span className="text-xs text-text-secondary">{t('dashboard.frontendVersion')}</span>
                <span className="text-xs font-mono font-bold text-brand-lime text-right">
                  v{import.meta.env.VITE_APP_VERSION || '1.0.0'}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-white/5">
                <span className="text-xs text-text-secondary">{t('dashboard.backendApiVersion')}</span>
                <span className="text-xs font-mono font-bold text-brand-lime text-right">
                  v{systemTelemetry.backend_version || '1.0.0'}
                </span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-xs text-text-secondary">{t('dashboard.databaseSchema')}</span>
                <span className="text-xs font-mono font-bold text-brand-lime text-right">
                  v{systemTelemetry.schema_version || '1.0.0'}
                </span>
              </div>
            </div>
          </div>

          {/* Upcoming Scheduled Tasks */}
          <div className="glass-card p-4 md:p-5 border-purple-500/10 bg-purple-500/2 space-y-3">
            <div className="flex items-center justify-between border-b border-purple-500/10 pb-2 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">📅</span>
                <h3 className="text-sm font-black uppercase text-white tracking-wider">{t('dashboard.upcomingTasksTitle', 'Upcoming Tasks')}</h3>
              </div>
              {upcomingTasks && upcomingTasks.length > 0 && (
                <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-300">
                  {upcomingTasks.length} {t('dashboard.scheduledCount', 'scheduled')}
                </span>
              )}
            </div>

            {!upcomingTasks || upcomingTasks.length === 0 ? (
              <div className="p-4 bg-purple-500/5 border border-purple-500/15 rounded-2xl text-center space-y-1">
                <p className="text-xs text-white/60 font-medium">{t('dashboard.noUpcomingTasks', 'No upcoming tasks scheduled in the near future.')}</p>
                <p className="text-[9px] text-text-secondary">{t('dashboard.noUpcomingTasksSub', 'Active recurring or one-shot tasks will be listed here.')}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {upcomingTasks.map((task: any) => (
                  <div key={task.id} className="p-2.5 bg-purple-500/10 border border-purple-500/20 rounded-xl flex items-center justify-between gap-2 hover:border-purple-500/40 transition-all">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded tracking-wider ${
                          task.is_system ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'bg-brand-orange/20 text-brand-orange border border-brand-orange/30'
                        }`}>
                          {task.is_system ? t('dashboard.systemTask', 'SYSTEM') : t('dashboard.userTask', 'JOB')}
                        </span>
                        <span className="text-xs font-bold text-white truncate max-w-[140px]" title={task.alias || task.name}>
                          {task.alias || task.name}
                        </span>
                      </div>
                      {task.schedule_cron && (
                        <span className="text-[9px] font-mono text-purple-300/70 block">
                          cron: {task.schedule_cron}
                        </span>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-xs font-black font-mono text-brand-lime block">
                        {formatRelativeNextRun(task.next_run, t)}
                      </span>
                      {task.next_run && (
                        <span className="text-[8px] text-text-secondary font-mono block">
                          {new Date(task.next_run).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};
