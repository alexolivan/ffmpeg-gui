import React from 'react';

// ── Input source types ───────────────────────────────────────────

export interface InputSourceConfig {
  type: string;
  path?: string;
  host?: string;
  port?: string;
  mode?: string;
  device?: string;
  name?: string;
  latency?: number;
  pattern?: string;
  size?: string;
  rate?: string;
  frequency?: number;
}

interface InputSourcePanelProps {
  label: string;
  accentColor: string;
  config: InputSourceConfig;
  /** Restrict available source types (e.g. audio-only sources) */
  allowedTypes?: string[];
  onChange: (config: InputSourceConfig) => void;
}

const ALL_SOURCE_TYPES = [
  { value: 'file', label: 'Local File / VOD' },
  { value: 'srt', label: 'SRT Stream' },
  { value: 'ndi', label: 'NDI Source' },
  { value: 'udp', label: 'UDP / MPEG-TS' },
  { value: 'rtp', label: 'RTP Stream' },
  { value: 'decklink', label: 'Blackmagic Decklink' },
  { value: 'alsa', label: 'ALSA Audio Device' },
  { value: 'v4l2', label: 'Video4Linux2 (USB/Magewell)' },
  { value: 'lavfi_video', label: 'Internal Generator (Video)' },
  { value: 'lavfi_audio', label: 'Internal Generator (Audio)' },
];

const InputSourcePanel: React.FC<InputSourcePanelProps> = ({
  label,
  accentColor,
  config,
  allowedTypes,
  onChange,
}) => {
  const types = allowedTypes
    ? ALL_SOURCE_TYPES.filter(t => allowedTypes.includes(t.value))
    : ALL_SOURCE_TYPES;

  const update = (patch: Partial<InputSourceConfig>) => {
    onChange({ ...config, ...patch });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: accentColor }} />
        <h4 className="font-bold text-xs uppercase tracking-wider" style={{ color: accentColor }}>
          {label}
        </h4>
      </div>

      <select
        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm outline-none transition-all"
        value={config.type}
        onChange={e => {
          const newType = e.target.value;
          update({
            type: newType,
            path: '', host: '', port: '', mode: 'listener', device: '', name: '',
            pattern: newType === 'lavfi_video' ? 'testsrc' : newType === 'lavfi_audio' ? 'sine' : '',
            size: newType === 'lavfi_video' ? '1920x1080' : undefined,
            rate: newType === 'lavfi_video' ? '25' : undefined,
            frequency: newType === 'lavfi_audio' ? 1000 : undefined
          });
        }}
      >
        {types.map(t => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>

      {/* ── Type-specific fields ── */}
      {config.type === 'file' && (
        <input
          type="text"
          placeholder="Absolute path to file"
          className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
          value={config.path || ''}
          onChange={e => update({ path: e.target.value })}
        />
      )}

      {config.type === 'srt' && (
        <div className="grid grid-cols-2 gap-3">
          <input
            type="text" placeholder="Host"
            className="bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
            value={config.host || ''} onChange={e => update({ host: e.target.value })}
          />
          <input
            type="text" placeholder="Port"
            className="bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
            value={config.port || ''} onChange={e => update({ port: e.target.value })}
          />
          <select
            className="col-span-1 bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
            value={config.mode || 'listener'} onChange={e => update({ mode: e.target.value })}
          >
            <option value="listener">Listener (Server)</option>
            <option value="caller">Caller (Client)</option>
          </select>
          <div>
            <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">Latency (ms)</label>
            <input
              type="number" placeholder="200" min={20} max={8000}
              className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono"
              value={config.latency || 200}
              onChange={e => update({ latency: Number(e.target.value) })}
            />
          </div>
        </div>
      )}

      {config.type === 'ndi' && (
        <input
          type="text"
          placeholder="NDI Source Name (e.g. MY-PC (OBS))"
          className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
          value={config.name || ''}
          onChange={e => update({ name: e.target.value })}
        />
      )}

      {config.type === 'udp' && (
        <div className="grid grid-cols-2 gap-3">
          <input
            type="text" placeholder="Multicast / Host"
            className="bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
            value={config.host || ''} onChange={e => update({ host: e.target.value })}
          />
          <input
            type="text" placeholder="Port"
            className="bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
            value={config.port || ''} onChange={e => update({ port: e.target.value })}
          />
        </div>
      )}

      {config.type === 'rtp' && (
        <div className="grid grid-cols-2 gap-3">
          <input
            type="text" placeholder="Host"
            className="bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
            value={config.host || ''} onChange={e => update({ host: e.target.value })}
          />
          <input
            type="text" placeholder="Port"
            className="bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
            value={config.port || ''} onChange={e => update({ port: e.target.value })}
          />
        </div>
      )}

      {config.type === 'decklink' && (
        <input
          type="text"
          placeholder="Device name (e.g. DeckLink Mini Recorder)"
          className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
          value={config.device || ''}
          onChange={e => update({ device: e.target.value })}
        />
      )}

      {config.type === 'alsa' && (
        <input
          type="text"
          placeholder="ALSA device (e.g. hw:0,0)"
          className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
          value={config.device || ''}
          onChange={e => update({ device: e.target.value })}
        />
      )}

      {config.type === 'v4l2' && (
        <input
          type="text"
          placeholder="V4L2 device (e.g. /dev/video0)"
          className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
          value={config.device || ''}
          onChange={e => update({ device: e.target.value })}
        />
      )}

      {config.type === 'lavfi_video' && (
        <div className="space-y-3">
          <select
            className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
            value={config.pattern || 'testsrc'}
            onChange={e => update({ pattern: e.target.value })}
          >
            <option value="testsrc">Color Bars (testsrc)</option>
            <option value="smptebars">SMPTE Bars (smptebars)</option>
            <option value="color=c=black">Black Screen</option>
            <option value="color=c=white">White Screen</option>
          </select>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">Resolution (size)</label>
              <select
                className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
                value={config.size || '1920x1080'}
                onChange={e => update({ size: e.target.value })}
              >
                <option value="1920x1080">1920x1080 (1080p)</option>
                <option value="1280x720">1280x720 (720p)</option>
                <option value="720x576">720x576 (PAL)</option>
                <option value="720x480">720x480 (NTSC)</option>
                <option value="640x360">640x360</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">Framerate (rate)</label>
              <select
                className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono"
                value={config.rate || '25'}
                onChange={e => update({ rate: e.target.value })}
              >
                <option value="60">60 fps</option>
                <option value="59.94">59.94 fps</option>
                <option value="50">50 fps</option>
                <option value="30">30 fps</option>
                <option value="29.97">29.97 fps</option>
                <option value="25">25 fps</option>
                <option value="24">24 fps</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {config.type === 'lavfi_audio' && (
        <div className="space-y-3">
          <select
            className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
            value={config.pattern || 'sine'}
            onChange={e => update({ pattern: e.target.value })}
          >
            <option value="sine">Sine Tone (sine)</option>
            <option value="anoisesrc=c=pink">Pink Noise</option>
            <option value="anoisesrc=c=white">White Noise</option>
            <option value="anullsrc">Silence</option>
          </select>
          {(config.pattern === 'sine' || !config.pattern) && (
            <div>
              <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">Frequency (Hz)</label>
              <input
                type="number"
                placeholder="1000"
                min={20}
                max={20000}
                className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono"
                value={config.frequency || 1000}
                onChange={e => update({ frequency: Number(e.target.value) })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default InputSourcePanel;
