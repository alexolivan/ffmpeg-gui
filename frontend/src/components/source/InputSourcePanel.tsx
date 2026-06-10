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
  video_input?: string;
  audio_input?: string;
  format_code?: string;
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
  { value: 'http_audio', label: 'HTTP Audio Stream (Icecast/Shoutcast)' },
  { value: 'rtmp', label: 'RTMP Stream' },
  { value: 'hls', label: 'HLS Stream' },
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

  const [devices, setDevices] = React.useState<string[]>([]);
  const [loadingDevices, setLoadingDevices] = React.useState(false);
  const [formats, setFormats] = React.useState<{ code: string; description: string }[]>([]);
  const [loadingFormats, setLoadingFormats] = React.useState(false);
  const [manualDeviceMode, setManualDeviceMode] = React.useState(false);

  React.useEffect(() => {
    if (config.type !== 'decklink') return;
    let active = true;
    const fetchDevices = async () => {
      setLoadingDevices(true);
      try {
        const res = await fetch('/decklink/devices');
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        if (active) {
          setDevices(data.inputs || []);
          if (data.inputs && data.inputs.length > 0) {
            const found = data.inputs.includes(config.device || '');
            if (!found && config.device) {
              setManualDeviceMode(true);
            }
          }
        }
      } catch (err) {
        console.error("Error fetching decklink devices:", err);
      } finally {
        if (active) setLoadingDevices(false);
      }
    };
    fetchDevices();
    return () => { active = false; };
  }, [config.type]);

  React.useEffect(() => {
    if (config.type !== 'decklink' || !config.device || manualDeviceMode) {
      setFormats([]);
      return;
    }
    let active = true;
    const fetchFormats = async () => {
      setLoadingFormats(true);
      try {
        const res = await fetch(`/decklink/formats?device=${encodeURIComponent(config.device || '')}`);
        if (!res.ok) throw new Error("Failed to fetch formats");
        const data = await res.json();
        if (active) {
          setFormats(data || []);
        }
      } catch (err) {
        console.error("Error fetching formats:", err);
        if (active) setFormats([]);
      } finally {
        if (active) setLoadingFormats(false);
      }
    };
    fetchFormats();
    return () => { active = false; };
  }, [config.type, config.device, manualDeviceMode]);

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
      {(config.type === 'file' || config.type === 'http_audio' || config.type === 'rtmp' || config.type === 'hls') && (
        <input
          type="text"
          placeholder={config.type === 'file' ? "Absolute path to file" : "Stream URL (e.g. rtmp://... or http://...)"}
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
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">Dispositivo DeckLink</label>
            {loadingDevices ? (
              <div className="text-xs text-text-secondary animate-pulse">Cargando dispositivos...</div>
            ) : devices.length === 0 ? (
              <div className="space-y-2">
                <div className="text-xs text-amber-500 font-medium">⚠️ No se detectaron tarjetas de captura DeckLink.</div>
                <input
                  type="text"
                  placeholder="Nombre del dispositivo (ej: DeckLink Mini Recorder)"
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
                  value={config.device || ''}
                  onChange={e => update({ device: e.target.value })}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  {!manualDeviceMode ? (
                    <select
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
                      value={config.device || ''}
                      onChange={e => {
                        if (e.target.value === '__manual__') {
                          setManualDeviceMode(true);
                          update({ device: '' });
                        } else {
                          update({ device: e.target.value });
                        }
                      }}
                    >
                      <option value="">-- Seleccionar dispositivo --</option>
                      {devices.map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                      <option value="__manual__">📝 Entrada manual...</option>
                    </select>
                  ) : (
                    <div className="flex w-full gap-2">
                      <input
                        type="text"
                        placeholder="Nombre del dispositivo"
                        className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
                        value={config.device || ''}
                        onChange={e => update({ device: e.target.value })}
                      />
                      <button
                        type="button"
                        className="px-3 bg-white/10 hover:bg-white/20 rounded-lg text-xs transition-colors"
                        onClick={() => {
                          setManualDeviceMode(false);
                          update({ device: devices[0] || '' });
                        }}
                      >
                        Lista
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">Conector de Video (video_input)</label>
            <select
              className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
              value={config.video_input || ''}
              onChange={e => update({ video_input: e.target.value })}
            >
              <option value="">Por defecto / No especificado</option>
              <option value="sdi">SDI</option>
              <option value="hdmi">HDMI</option>
              <option value="optical_sdi">Optical SDI</option>
              <option value="component">Component</option>
              <option value="composite">Composite</option>
              <option value="s_video">S-Video</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">Conector de Audio (audio_input)</label>
            <select
              className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
              value={config.audio_input || ''}
              onChange={e => update({ audio_input: e.target.value })}
            >
              <option value="">Por defecto / No especificado</option>
              <option value="embedded">Embedded (SDI/HDMI)</option>
              <option value="aes_ebu">AES/EBU (Digital)</option>
              <option value="analog">Analog (XLR/RCA)</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">Formato de Entrada (format_code)</label>
            {manualDeviceMode ? (
              <input
                type="text"
                placeholder="Código de formato (ej: hp50)"
                className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono"
                value={config.format_code || ''}
                onChange={e => update({ format_code: e.target.value })}
              />
            ) : loadingFormats ? (
              <div className="text-xs text-text-secondary animate-pulse">Cargando formatos soportados...</div>
            ) : formats.length === 0 ? (
              <input
                type="text"
                placeholder="Código de formato (ej: hp50) - No se detectaron formatos"
                className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono"
                value={config.format_code || ''}
                onChange={e => update({ format_code: e.target.value })}
              />
            ) : (
              <select
                className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono"
                value={config.format_code || ''}
                onChange={e => update({ format_code: e.target.value })}
              >
                <option value="">Por defecto / Detección automática (SDK)</option>
                {formats.map(f => (
                  <option key={f.code} value={f.code}>
                    {f.code} ({f.description})
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
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
