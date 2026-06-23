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
    <div className="glass-card p-2.5 !rounded-lg space-y-2">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-brand-orange" />
        <h4 className="text-brand-orange font-bold text-xs uppercase tracking-wider">Advanced FFmpeg Flags</h4>
        <span className="text-[9px] text-white/20 italic ml-auto font-medium">Speed control & resource limits</span>
      </div>

      {/* Realtime (-re) */}
      <div className="flex items-center justify-between p-2 bg-white/5 rounded-lg border border-white/5">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold text-white">
            Realtime Playback <code className="text-[9px] text-brand-orange bg-white/5 px-1.5 py-0.5 rounded ml-1">-re</code>
          </span>
          <span className="text-[10px] text-text-secondary leading-snug">
            Throttle input read to native framerate. Essential for file/lavfi sources.
            {realtime === null && (
              <span className="text-brand-lime ml-1">
                (auto: {['file', 'lavfi_video', 'lavfi_audio'].includes(inputType) ? 'ON' : 'OFF'})
              </span>
            )}
          </span>
        </div>
        <select
          className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs outline-none w-24 text-center"
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
        <div className="flex items-center justify-between p-2 bg-white/5 rounded-lg border border-white/5 animate-in fade-in duration-200">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-semibold text-white">
              Input Loop <code className="text-[9px] text-brand-orange bg-white/5 px-1.5 py-0.5 rounded ml-1">-stream_loop</code>
            </span>
            <span className="text-[10px] text-text-secondary">Repeat file input. -1 = infinite, 0 = off.</span>
          </div>
          <input
            type="number" min="-1" max="9999"
            className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs outline-none w-20 text-center font-mono focus:border-brand-orange"
            value={stream_loop ?? 0}
            onChange={e => onChange({
              stream_loop: e.target.value === '' ? null : parseInt(e.target.value),
            })}
          />
        </div>
      )}

      {/* Resource Allocation Grid */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block mb-0.5">
            Threads <code className="text-[9px] text-brand-orange bg-white/5 px-1 rounded">-threads</code>
          </label>
          <input
            type="number" min="0" max="128" placeholder="0 = auto"
            className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono focus:border-brand-orange"
            value={threads || ''}
            onChange={e => onChange({
              threads: parseInt(e.target.value) || 0,
            })}
          />
        </div>
        <div>
          <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block mb-0.5">
            Queue Size <code className="text-[9px] text-brand-orange bg-white/5 px-1 rounded">-thread_queue_size</code>
          </label>
          <input
            type="number" min="0" max="65536" placeholder="0 = default"
            className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono focus:border-brand-orange"
            value={thread_queue_size || ''}
            onChange={e => onChange({
              thread_queue_size: parseInt(e.target.value) || 0,
            })}
          />
        </div>
      </div>

      {/* Probesize row */}
      <div>
        <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block mb-0.5">
          Probe Size <code className="text-[9px] text-brand-orange bg-white/5 px-1 rounded">-probesize</code>
        </label>
        <input
          type="text" placeholder="e.g. 5M, 20M"
          className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono focus:border-brand-orange"
          value={probesize}
          onChange={e => onChange({
            probesize: e.target.value,
          })}
        />
      </div>
    </div>
  );
};

export default React.memo(AdvancedFlagsFormSection);
