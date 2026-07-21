import React from 'react';

interface LifecycleFormSectionProps {
  auto_start: boolean;
  watchdog_enabled: boolean;
  watchdog_retries: number;
  watchdog_min_speed: number | null;
  watchdog_min_speed_duration: number;
  debug_mode: boolean;
  log_storage_id: number | null;
  logsStorages: any[];
  onChange: (updates: {
    auto_start?: boolean;
    watchdog_enabled?: boolean;
    watchdog_retries?: number;
    watchdog_min_speed?: number | null;
    watchdog_min_speed_duration?: number;
    debug_mode?: boolean;
    log_storage_id?: number | null;
  }) => void;
}

export const LifecycleFormSection: React.FC<LifecycleFormSectionProps> = ({
  auto_start,
  watchdog_enabled,
  watchdog_retries,
  watchdog_min_speed,
  watchdog_min_speed_duration,
  debug_mode,
  log_storage_id,
  logsStorages,
  onChange,
}) => {
  return (
    <div className="glass-card p-2.5 !rounded-lg space-y-2">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-brand-lime" />
        <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider">Process Lifecycle Settings</h4>
      </div>

      {/* Auto Start Toggle */}
      <div className="flex items-center justify-between p-2 bg-white/5 rounded-lg border border-white/5">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold text-white">Auto-start on boot</span>
          <span className="text-[10px] text-text-secondary">Launch this service automatically when the application starts.</span>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={auto_start}
            onChange={e => onChange({ auto_start: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-lime"></div>
        </label>
      </div>

      {/* Watchdog Toggle */}
      <div className="flex items-center justify-between p-2 bg-white/5 rounded-lg border border-white/5">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold text-white">Enable Watchdog</span>
          <span className="text-[10px] text-text-secondary">Monitor process health and auto-restart on unexpected crashes.</span>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={watchdog_enabled}
            onChange={e => onChange({ watchdog_enabled: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-lime"></div>
        </label>
      </div>

      {/* Watchdog Retries */}
      {watchdog_enabled && (
        <div className="p-2 bg-white/5 rounded-lg border border-white/5 space-y-2 animate-in fade-in duration-200">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold text-white">Infinite Restart Attempts</span>
              <span className="text-[10px] text-text-secondary">Keep trying to restart the process indefinitely.</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={watchdog_retries === -1}
                onChange={e => onChange({
                  watchdog_retries: e.target.checked ? -1 : 5
                })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-lime"></div>
            </label>
          </div>

          {watchdog_retries !== -1 && (
            <div className="flex items-center gap-2 pt-1.5 border-t border-white/5 animate-in fade-in duration-200">
              <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary block">
                Maximum consecutive retries:
              </label>
              <input
                type="number"
                min="1"
                max="100"
                className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs outline-none w-20 focus:border-brand-lime"
                value={watchdog_retries}
                onChange={e => onChange({
                  watchdog_retries: Math.max(1, parseInt(e.target.value) || 1)
                })}
              />
            </div>
          )}

          {/* Minimum Speed Watchdog Settings */}
          <div className="flex items-center gap-4 pt-2.5 border-t border-white/5 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary block">
                Velocidad Mínima:
              </label>
              <input
                type="number"
                step="0.05"
                min="0.05"
                max="10.0"
                placeholder="Desactivado"
                className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs outline-none w-28 focus:border-brand-lime"
                value={watchdog_min_speed === null || watchdog_min_speed === undefined ? '' : watchdog_min_speed}
                onChange={e => {
                  const val = e.target.value ? parseFloat(e.target.value) : null;
                  onChange({ watchdog_min_speed: val });
                }}
              />
            </div>
            {(watchdog_min_speed !== null && watchdog_min_speed !== undefined) && (
              <div className="flex items-center gap-2 animate-in fade-in duration-200">
                <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary block">
                  Tolerancia (s):
                </label>
                <input
                  type="number"
                  min="5"
                  max="3600"
                  className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs outline-none w-20 focus:border-brand-lime"
                  value={watchdog_min_speed_duration}
                  onChange={e => onChange({
                    watchdog_min_speed_duration: Math.max(5, parseInt(e.target.value) || 30)
                  })}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Debug Mode Toggle */}
      <div className="flex items-center justify-between p-2 bg-white/5 rounded-lg border border-white/5">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold text-white">Modo Debug (Consola en Vivo)</span>
          <span className="text-[10px] text-text-secondary">Habilita lectura interactiva de logs. Sensible a reinicios del panel.</span>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={debug_mode}
            onChange={e => onChange({ debug_mode: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-lime"></div>
        </label>
      </div>

      {/* Logs Storage Dropdown */}
      <div className="p-2 bg-white/5 rounded-lg border border-white/5 space-y-1.5">
        <label htmlFor="log-storage-select" className="text-[10px] font-bold uppercase tracking-wider text-text-secondary block">
          Almacenamiento de Logs
        </label>
        <select
          id="log-storage-select"
          className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none focus:border-brand-lime text-white"
          value={log_storage_id || ''}
          onChange={e => onChange({ log_storage_id: e.target.value ? parseInt(e.target.value) : null })}
        >
          <option value="" className="bg-[#1e1e24] text-white">Default (Usa Default Logs Storage)</option>
          {logsStorages.map((s: any) => (
            <option key={s.id} value={s.id} className="bg-[#1e1e24] text-white">
              {s.name} ({s.path}) {s.is_default ? '[Predeterminado]' : ''}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
export default React.memo(LifecycleFormSection);
