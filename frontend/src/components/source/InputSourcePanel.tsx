import React from 'react';
import type { SystemCapabilities } from '../codec/codecRegistry';

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
  pixel_format?: string;
}

interface InputSourcePanelProps {
  label: string;
  accentColor: string;
  config: InputSourceConfig;
  /** Restrict available source types (e.g. audio-only sources) */
  allowedTypes?: string[];
  onChange: (config: InputSourceConfig) => void;
  systemCapabilities?: SystemCapabilities;
  onSyncAlsaAudio?: (alsaDevice: string) => void;
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
  systemCapabilities,
  onSyncAlsaAudio,
}) => {
  const decklinkAvailable = systemCapabilities?.decklink?.available ?? true;
  const filteredSourceTypes = decklinkAvailable
    ? ALL_SOURCE_TYPES
    : ALL_SOURCE_TYPES.filter(t => t.value !== 'decklink');

  const types = allowedTypes
    ? filteredSourceTypes.filter(t => allowedTypes.includes(t.value))
    : filteredSourceTypes;

  const update = (patch: Partial<InputSourceConfig>) => {
    onChange({ ...config, ...patch });
  };

  const [devices, setDevices] = React.useState<string[]>([]);
  const [loadingDevices, setLoadingDevices] = React.useState(false);
  const [formats, setFormats] = React.useState<{ code: string; description: string }[]>([]);
  const [loadingFormats, setLoadingFormats] = React.useState(false);
  const [manualDeviceMode, setManualDeviceMode] = React.useState(false);

  // V4L2 State
  const [v4l2Devices, setV4l2Devices] = React.useState<any[]>([]);
  const [loadingV4l2Devices, setLoadingV4l2Devices] = React.useState(false);
  const [v4l2Formats, setV4l2Formats] = React.useState<any[]>([]);
  const [loadingV4l2Formats, setLoadingV4l2Formats] = React.useState(false);
  const [manualV4l2Mode, setManualV4l2Mode] = React.useState(false);

  // ALSA State
  const [alsaDevices, setAlsaDevices] = React.useState<any[]>([]);
  const [loadingAlsaDevices, setLoadingAlsaDevices] = React.useState(false);
  const [manualAlsaMode, setManualAlsaMode] = React.useState(false);

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

  // Fetch V4L2 devices
  React.useEffect(() => {
    if (config.type !== 'v4l2') return;
    let active = true;
    const fetchV4l2 = async () => {
      setLoadingV4l2Devices(true);
      try {
        const res = await fetch('/v4l2/devices');
        if (!res.ok) throw new Error("Failed to fetch V4L2 devices");
        const data = await res.json();
        if (active) {
          setV4l2Devices(data || []);
          if (data && data.length > 0) {
            const found = data.some((d: any) => d.device === config.device);
            if (!found && config.device) {
              setManualV4l2Mode(true);
            }
          }
        }
      } catch (err) {
        console.error("Error fetching V4L2 devices:", err);
      } finally {
        if (active) setLoadingV4l2Devices(false);
      }
    };
    fetchV4l2();
    return () => { active = false; };
  }, [config.type]);

  // Fetch V4L2 formats
  React.useEffect(() => {
    if (config.type !== 'v4l2' || !config.device || manualV4l2Mode) {
      setV4l2Formats([]);
      return;
    }
    let active = true;
    const fetchV4l2Formats = async () => {
      setLoadingV4l2Formats(true);
      try {
        const res = await fetch(`/v4l2/formats?device=${encodeURIComponent(config.device || '')}`);
        if (!res.ok) throw new Error("Failed to fetch V4L2 formats");
        const data = await res.json();
        if (active) {
          setV4l2Formats(data || []);
        }
      } catch (err) {
        console.error("Error fetching V4L2 formats:", err);
        if (active) setV4l2Formats([]);
      } finally {
        if (active) setLoadingV4l2Formats(false);
      }
    };
    fetchV4l2Formats();
    return () => { active = false; };
  }, [config.type, config.device, manualV4l2Mode]);

  // Fetch ALSA devices
  React.useEffect(() => {
    if (config.type !== 'alsa') return;
    let active = true;
    const fetchAlsa = async () => {
      setLoadingAlsaDevices(true);
      try {
        const res = await fetch('/alsa/devices');
        if (!res.ok) throw new Error("Failed to fetch ALSA devices");
        const data = await res.json();
        if (active) {
          setAlsaDevices(data || []);
          if (data && data.length > 0) {
            const found = data.some((d: any) => d.device === config.device);
            if (!found && config.device) {
              setManualAlsaMode(true);
            }
          }
        }
      } catch (err) {
        console.error("Error fetching ALSA devices:", err);
      } finally {
        if (active) setLoadingAlsaDevices(false);
      }
    };
    fetchAlsa();
    return () => { active = false; };
  }, [config.type]);


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
                <p className="text-[10px] text-text-secondary">
                  Ejemplo: <code className="text-brand-orange font-mono">DeckLink Mini Recorder</code> o <code className="text-brand-orange font-mono">DeckLink Quad HDMI Recorder (1)</code>.
                </p>
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
                    <div className="flex flex-col w-full gap-2">
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
                          className="px-3 bg-white/10 hover:bg-white/20 rounded-lg text-xs transition-colors shrink-0"
                          onClick={() => {
                            setManualDeviceMode(false);
                            update({ device: devices[0] || '' });
                          }}
                        >
                          Lista
                        </button>
                      </div>
                      <p className="text-[10px] text-text-secondary">
                        Ejemplo: <code className="text-brand-orange font-mono">DeckLink Mini Recorder</code> o <code className="text-brand-orange font-mono">DeckLink Duo (2)</code>.
                      </p>
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
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">Dispositivo ALSA</label>
            {loadingAlsaDevices ? (
              <div className="text-xs text-text-secondary animate-pulse">Cargando dispositivos ALSA...</div>
            ) : alsaDevices.length === 0 ? (
              <div className="space-y-2">
                <div className="text-xs text-amber-500 font-medium">⚠️ No se detectaron tarjetas de sonido ALSA.</div>
                <input
                  type="text"
                  placeholder="ID del dispositivo ALSA (ej: hw:0,0)"
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
                  value={config.device || ''}
                  onChange={e => update({ device: e.target.value })}
                />
                <p className="text-[10px] text-text-secondary">
                  Ejemplo: <code className="text-brand-orange font-mono">hw:0,0</code> (primera tarjeta, primer canal) o <code className="text-brand-orange font-mono">hw:1,0</code> (segunda tarjeta).
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  {!manualAlsaMode ? (
                    <select
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
                      value={config.device || ''}
                      onChange={e => {
                        if (e.target.value === '__manual__') {
                          setManualAlsaMode(true);
                          update({ device: '' });
                        } else {
                          update({ device: e.target.value });
                        }
                      }}
                    >
                      <option value="">-- Seleccionar dispositivo ALSA --</option>
                      {alsaDevices.map(d => (
                        <option key={d.device} value={d.device}>{d.name} ({d.device})</option>
                      ))}
                      <option value="__manual__">📝 Entrada manual...</option>
                    </select>
                  ) : (
                    <div className="flex flex-col w-full gap-2">
                      <div className="flex w-full gap-2">
                        <input
                          type="text"
                          placeholder="ID del dispositivo ALSA (ej: hw:0,0)"
                          className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
                          value={config.device || ''}
                          onChange={e => update({ device: e.target.value })}
                        />
                        <button
                          type="button"
                          className="px-3 bg-white/10 hover:bg-white/20 rounded-lg text-xs transition-colors shrink-0"
                          onClick={() => {
                            setManualAlsaMode(false);
                            update({ device: alsaDevices[0]?.device || '' });
                          }}
                        >
                          Lista
                        </button>
                      </div>
                      <p className="text-[10px] text-text-secondary">
                        Ejemplo: <code className="text-brand-orange font-mono">hw:0,0</code> (primera tarjeta, primer canal) o <code className="text-brand-orange font-mono">hw:1,0</code> (segunda tarjeta).
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {config.type === 'v4l2' && (
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">Dispositivo V4L2</label>
            {loadingV4l2Devices ? (
              <div className="text-xs text-text-secondary animate-pulse">Cargando dispositivos V4L2...</div>
            ) : v4l2Devices.length === 0 ? (
              <div className="space-y-2">
                <div className="text-xs text-amber-500 font-medium">⚠️ No se detectaron dispositivos V4L2.</div>
                <input
                  type="text"
                  placeholder="Ruta del dispositivo (ej: /dev/video0)"
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
                  value={config.device || ''}
                  onChange={e => update({ device: e.target.value })}
                />
                <p className="text-[10px] text-text-secondary">
                  Ejemplo: <code className="text-brand-orange font-mono">/dev/video0</code> o <code className="text-brand-orange font-mono">/dev/video1</code> para tarjetas de captura físicas o webcams.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  {!manualV4l2Mode ? (
                    <select
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
                      value={config.device || ''}
                      onChange={e => {
                        if (e.target.value === '__manual__') {
                          setManualV4l2Mode(true);
                          update({ device: '' });
                        } else {
                          update({ device: e.target.value });
                        }
                      }}
                    >
                      <option value="">-- Seleccionar dispositivo V4L2 --</option>
                      {v4l2Devices.map(d => (
                        <option key={d.device} value={d.device}>{d.name} ({d.device})</option>
                      ))}
                      <option value="__manual__">📝 Entrada manual...</option>
                    </select>
                  ) : (
                    <div className="flex flex-col w-full gap-2">
                      <div className="flex w-full gap-2">
                        <input
                          type="text"
                          placeholder="Ruta del dispositivo (ej: /dev/video0)"
                          className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
                          value={config.device || ''}
                          onChange={e => update({ device: e.target.value })}
                        />
                        <button
                          type="button"
                          className="px-3 bg-white/10 hover:bg-white/20 rounded-lg text-xs transition-colors shrink-0"
                          onClick={() => {
                            setManualV4l2Mode(false);
                            update({ device: v4l2Devices[0]?.device || '' });
                          }}
                        >
                          Lista
                        </button>
                      </div>
                      <p className="text-[10px] text-text-secondary">
                        Ejemplo: <code className="text-brand-orange font-mono">/dev/video0</code> o <code className="text-brand-orange font-mono">/dev/video1</code> para tarjetas de captura físicas o webcams.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {!manualV4l2Mode && config.device && (
            <div>
              <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">Formato y Resolución</label>
              {loadingV4l2Formats ? (
                <div className="text-xs text-text-secondary animate-pulse">Cargando formatos...</div>
              ) : v4l2Formats.length === 0 ? (
                <div className="text-xs text-text-secondary italic">No se detectaron formatos. Se usará el valor por defecto.</div>
              ) : (
                <select
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono"
                  value={config.pixel_format && config.size ? `${config.pixel_format}|${config.size}` : ''}
                  onChange={e => {
                    const val = e.target.value;
                    if (!val) {
                      update({ pixel_format: undefined, size: undefined });
                    } else {
                      const [fmt, sz] = val.split('|');
                      update({ pixel_format: fmt, size: sz });
                    }
                  }}
                >
                  <option value="">Por defecto / Detección automática</option>
                  {v4l2Formats.map(f => (
                    <optgroup key={`${f.type}-${f.pixel_format}`} label={`${f.type}: ${f.description || f.pixel_format}`}>
                      {f.resolutions.map((r: string) => (
                        <option key={`${f.pixel_format}|${r}`} value={`${f.pixel_format}|${r}`}>
                          {f.pixel_format} @ {r}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              )}
            </div>
          )}

          {(() => {
            const selDev = v4l2Devices.find(d => d.device === config.device);
            if (selDev && selDev.is_magewell && selDev.alsa_device && onSyncAlsaAudio) {
              return (
                <div className="border border-lime-500/20 bg-lime-500/5 p-3 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 animate-in fade-in duration-300">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] bg-lime-500/20 text-lime-400 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider">
                        Magewell Link
                      </span>
                      <span className="text-xs font-semibold text-white">Audio Embebido Detectado</span>
                    </div>
                    <p className="text-[11px] text-text-secondary">
                      Este dispositivo Magewell tiene asociado el dispositivo ALSA <span className="font-mono text-lime-400">{selDev.alsa_device}</span>.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSyncAlsaAudio(selDev.alsa_device)}
                    className="text-xs bg-lime-500 hover:bg-lime-600 text-black font-bold px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap self-end sm:self-center"
                  >
                    Sincronizar Audio (Input 2)
                  </button>
                </div>
              );
            }
            return null;
          })()}
        </div>
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
