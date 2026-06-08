import React from 'react';

interface LifecycleFormSectionProps {
  auto_start: boolean;
  watchdog_enabled: boolean;
  watchdog_retries: number;
  onChange: (updates: {
    auto_start?: boolean;
    watchdog_enabled?: boolean;
    watchdog_retries?: number;
  }) => void;
}

export const LifecycleFormSection: React.FC<LifecycleFormSectionProps> = ({
  auto_start,
  watchdog_enabled,
  watchdog_retries,
  onChange,
}) => {
  return (
    <div className="glass-card p-4 !rounded-2xl space-y-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-brand-lime" />
        <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider">Process Lifecycle Settings</h4>
      </div>

      {/* Auto Start Toggle */}
      <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-white">Auto-start on boot</span>
          <span className="text-xs text-text-secondary">Launch this service automatically when the application starts.</span>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={auto_start}
            onChange={e => onChange({ auto_start: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-lime"></div>
        </label>
      </div>

      {/* Watchdog Toggle */}
      <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-white">Enable Watchdog</span>
          <span className="text-xs text-text-secondary">Monitor process health and auto-restart on unexpected crashes.</span>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={watchdog_enabled}
            onChange={e => onChange({ watchdog_enabled: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-lime"></div>
        </label>
      </div>

      {/* Watchdog Retries */}
      {watchdog_enabled && (
        <div className="p-3 bg-white/5 rounded-xl border border-white/5 space-y-3 animate-in fade-in duration-200">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-white">Infinite Restart Attempts</span>
              <span className="text-xs text-text-secondary">Keep trying to restart the process indefinitely.</span>
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
              <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-lime"></div>
            </label>
          </div>

          {watchdog_retries !== -1 && (
            <div className="flex items-center gap-3 pt-2 border-t border-white/5 animate-in fade-in duration-200">
              <label className="text-xs font-bold uppercase tracking-wider text-text-secondary block">
                Maximum consecutive retries:
              </label>
              <input
                type="number"
                min="1"
                max="100"
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none w-24 focus:border-brand-lime"
                value={watchdog_retries}
                onChange={e => onChange({
                  watchdog_retries: Math.max(1, parseInt(e.target.value) || 1)
                })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
export default LifecycleFormSection;
