import React from 'react';

interface AdvancedFlagsFormSectionProps {
  inputType: string;
  realtime: boolean | null;
  stream_loop: number | null;
  threads: number;
  probesize: string;
  thread_queue_size: number;
  onChange: (updates: {
    realtime?: boolean | null;
    stream_loop?: number | null;
    threads?: number;
    probesize?: string;
    thread_queue_size?: number;
  }) => void;
}

export const AdvancedFlagsFormSection: React.FC<AdvancedFlagsFormSectionProps> = ({
  inputType,
  realtime,
  stream_loop,
  threads,
  probesize,
  thread_queue_size,
  onChange,
}) => {
  return (
    <div className="glass-card p-4 !rounded-2xl space-y-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-brand-orange" />
        <h4 className="text-brand-orange font-bold text-xs uppercase tracking-wider">Advanced FFmpeg Flags</h4>
        <span className="text-[10px] text-white/20 italic ml-auto">Speed control & resource limits</span>
      </div>

      {/* Realtime (-re) */}
      <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-white">
            Realtime Playback <code className="text-[10px] text-brand-orange bg-white/5 px-1.5 py-0.5 rounded ml-1">-re</code>
          </span>
          <span className="text-xs text-text-secondary">
            Throttle input read to native framerate. Essential for file/lavfi sources in live streaming.
            {realtime === null && (
              <span className="text-brand-lime ml-1">
                (auto: {['file', 'lavfi_video', 'lavfi_audio'].includes(inputType) ? 'ON' : 'OFF'})
              </span>
            )}
          </span>
        </div>
        <select
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none w-28 text-center"
          value={realtime === null ? 'auto' : realtime ? 'on' : 'off'}
          onChange={e => {
            const val = e.target.value;
            onChange({ realtime: val === 'auto' ? null : val === 'on' });
          }}
        >
          <option value="auto">Auto</option>
          <option value="on">Always ON</option>
          <option value="off">Always OFF</option>
        </select>
      </div>

      {/* Stream Loop — only for file inputs */}
      {inputType === 'file' && (
        <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5 animate-in fade-in duration-200">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-white">
              Input Loop <code className="text-[10px] text-brand-orange bg-white/5 px-1.5 py-0.5 rounded ml-1">-stream_loop</code>
            </span>
            <span className="text-xs text-text-secondary">Repeat file input. -1 = infinite (24/7 playout). 0 = off.</span>
          </div>
          <input
            type="number" min="-1" max="9999"
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none w-24 text-center font-mono focus:border-brand-orange"
            value={stream_loop ?? 0}
            onChange={e => onChange({
              stream_loop: e.target.value === '' ? null : parseInt(e.target.value),
            })}
          />
        </div>
      )}

      {/* Resource Allocation Grid */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block mb-1">
            Threads <code className="text-brand-orange">-threads</code>
          </label>
          <input
            type="number" min="0" max="128" placeholder="0 = auto"
            className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono focus:border-brand-orange"
            value={threads || ''}
            onChange={e => onChange({
              threads: parseInt(e.target.value) || 0,
            })}
          />
        </div>
        <div>
          <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block mb-1">
            Thread Queue <code className="text-brand-orange">-thread_queue_size</code>
          </label>
          <input
            type="number" min="0" max="65536" placeholder="0 = default"
            className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono focus:border-brand-orange"
            value={thread_queue_size || ''}
            onChange={e => onChange({
              thread_queue_size: parseInt(e.target.value) || 0,
            })}
          />
        </div>
      </div>

      {/* Probesize row */}
      <div>
        <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block mb-1">
          Probe Size <code className="text-brand-orange">-probesize</code>
        </label>
        <input
          type="text" placeholder="e.g. 5M, 20M"
          className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono focus:border-brand-orange"
          value={probesize}
          onChange={e => onChange({
            probesize: e.target.value,
          })}
        />
      </div>
    </div>
  );
};

export default AdvancedFlagsFormSection;
