import React from 'react';

interface SchedulingFormSectionProps {
  schedule_type: string;
  schedule_cron: string;
  schedule_datetime: string;
  duration_type: string;
  duration_seconds: number;
  duration_end_time: string;
  retry_max: number;
  retry_delay: number;
  onChange: (updates: {
    schedule_type?: string;
    schedule_cron?: string;
    schedule_datetime?: string;
    duration_type?: string;
    duration_seconds?: number;
    duration_end_time?: string;
    retry_max?: number;
    retry_delay?: number;
  }) => void;
}

export const SchedulingFormSection: React.FC<SchedulingFormSectionProps> = ({
  schedule_type,
  schedule_cron,
  schedule_datetime,
  duration_type,
  duration_seconds,
  duration_end_time,
  retry_max,
  retry_delay,
  onChange,
}) => {
  return (
    <div className="glass-card p-2.5 !rounded-lg space-y-2">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-brand-lime" />
        <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider">Trigger & Scheduling</h4>
      </div>

      {/* Trigger Mechanism */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-0.5">
          <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block mb-0.5">Trigger Mechanism</label>
          <select
            className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
            value={schedule_type}
            onChange={e => onChange({ schedule_type: e.target.value })}
          >
            <option value="manual">Manual Trigger Only</option>
            <option value="one_shot">One-shot (Target DateTime)</option>
            <option value="recurring">Recurring (Cron Schedule)</option>
          </select>
        </div>

        {/* Cron Expression (Recurring) */}
        {schedule_type === 'recurring' && (
          <div className="space-y-0.5">
            <label className="text-[9px] uppercase font-bold text-brand-lime tracking-wider block mb-0.5">Cron Expression</label>
            <input 
              type="text" required
              className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none focus:border-brand-lime transition-all text-brand-lime font-mono"
              placeholder="e.g. */15 * * * *"
              value={schedule_cron}
              onChange={e => onChange({ schedule_cron: e.target.value })}
            />
          </div>
        )}

        {/* One-shot DateTime */}
        {schedule_type === 'one_shot' && (
          <div className="space-y-0.5">
            <label className="text-[9px] uppercase font-bold text-brand-orange tracking-wider block mb-0.5">Target Date & Time</label>
            <input 
              type="datetime-local" required
              className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none focus:border-brand-orange transition-all text-white"
              value={schedule_datetime}
              onChange={e => onChange({ schedule_datetime: e.target.value })}
            />
          </div>
        )}
      </div>

      {/* Task duration limit */}
      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/5">
        <div className="space-y-0.5">
          <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block mb-0.5">Duration Type</label>
          <select
            className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
            value={duration_type}
            onChange={e => onChange({ duration_type: e.target.value })}
          >
            <option value="input_dependent">Input Dependent (FFmpeg processes naturally)</option>
            <option value="timer">Max Duration Timer</option>
            <option value="end_time">Target Datetime (Stop at absolute time)</option>
          </select>
        </div>

        {duration_type === 'timer' && (
          <div className="space-y-0.5">
            <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block mb-0.5">Duration Limit (Seconds)</label>
            <input
              type="number" min="1"
              className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
              value={duration_seconds}
              onChange={e => onChange({ duration_seconds: Number(e.target.value) })}
            />
          </div>
        )}

        {duration_type === 'end_time' && (
          <div className="space-y-0.5">
            <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block mb-0.5">Target Stop Datetime</label>
            <input
              type="datetime-local" required
              className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none text-white"
              value={duration_end_time || ''}
              onChange={e => onChange({ duration_end_time: e.target.value })}
            />
          </div>
        )}
      </div>

      {/* Retry policy */}
      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/5">
        <div className="space-y-0.5">
          <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block mb-0.5">Maximum Retries</label>
          <input
            type="number" min="0" max="10"
            className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
            value={retry_max}
            onChange={e => onChange({ retry_max: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-0.5">
          <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block mb-0.5">Retry Delay (Seconds)</label>
          <input
            type="number" min="1" max="300"
            className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
            value={retry_delay}
            onChange={e => onChange({ retry_delay: Number(e.target.value) })}
          />
        </div>
      </div>
    </div>
  );
};
export default SchedulingFormSection;
