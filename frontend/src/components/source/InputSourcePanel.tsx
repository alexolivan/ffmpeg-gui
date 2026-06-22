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
  hwaccel?: string;
  hwaccel_output_format?: string;
  streamid?: string;
  frames_destination?: string;
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

  // NDI Scan State
  const [ndiSources, setNdiSources] = React.useState<string[]>([]);
  const [scanningNdi, setScanningNdi] = React.useState(false);
  const [manualNdiMode, setManualNdiMode] = React.useState(false);

  const scanNdi = async () => {
    setScanningNdi(true);
    try {
      const res = await fetch('/ndi/sources');
      if (res.ok) {
        const data = await res.json();
        setNdiSources(data.sources || []);
        if (data.sources && data.sources.length > 0) {
          update({ name: data.sources[0] });
          setManualNdiMode(false);
        } else {
          setManualNdiMode(true);
        }
      }
    } catch (err) {
      console.error("Failed to scan NDI sources", err);
    } finally {
      setScanningNdi(false);
    }
  };

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
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: accentColor }} />
        <h4 className="font-bold text-[10px] uppercase tracking-wider" style={{ color: accentColor }}>
          {label}
        </h4>
      </div>

      <select
        className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none transition-all"
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
          className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
          value={config.path || ''}
          onChange={e => update({ path: e.target.value })}
        />
      )}

      {config.type === 'srt' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">SRT Connection Mode</label>
              <select
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
                value={config.mode || 'listener'}
                onChange={e => {
                  const m = e.target.value;
                  update({ 
                    mode: m, 
                    host: m === 'listener' ? '0.0.0.0' : config.host 
                  });
                }}
              >
                <option value="listener">Listener (Server Mode — wait for connection)</option>
                <option value="caller">Caller (Client Mode — initiate connection)</option>
                <option value="rendezvous">Rendezvous Mode (Peer-to-peer connection)</option>
              </select>
            </div>

            <div>
              <label className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">
                {config.mode === 'listener' ? 'Bind Interface / Host' : 'Remote Host / IP'}
              </label>
              <input
                type="text"
                placeholder={config.mode === 'listener' ? "0.0.0.0 (all interfaces)" : "e.g. 52.210.205.135"}
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
                value={config.host || ''}
                onChange={e => update({ host: e.target.value })}
              />
            </div>

            <div>
              <label className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">Port</label>
              <input
                type="text"
                placeholder="9000"
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                value={config.port || ''}
                onChange={e => update({ port: e.target.value })}
              />
            </div>

            <div>
              <label className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">Latency (ms)</label>
              <input
                type="number"
                placeholder="200"
                min={20}
                max={8000}
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                value={config.latency || 200}
                onChange={e => update({ latency: Number(e.target.value) })}
              />
            </div>

            <div>
              <label className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">Stream ID (Optional)</label>
              <input
                type="text"
                placeholder="e.g. input_stream_1"
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                value={config.streamid || ''}
                onChange={e => update({ streamid: e.target.value })}
              />
            </div>
          </div>
          
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-2 text-[10px] text-blue-300">
            {config.mode === 'listener' ? (
              <span>
                <strong>Listener Mode:</strong> FFmpeg opens a local UDP socket on port <strong>{config.port || '9000'}</strong> and waits.
              </span>
            ) : config.mode === 'caller' ? (
              <span>
                <strong>Caller Mode:</strong> FFmpeg actively connects to remote host <strong>{config.host || 'Host'}</strong> on port <strong>{config.port || 'Port'}</strong>.
              </span>
            ) : (
              <span>
                <strong>Rendezvous Mode:</strong> Both nodes must use Rendezvous mode on the same port.
              </span>
            )}
          </div>
        </div>
      )}

      {config.type === 'ndi' && (
        <div className="space-y-1.5">
          <label className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">
            NDI Source Name
          </label>
          <div className="flex gap-1.5">
            {!manualNdiMode ? (
              <select
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
                value={config.name || ''}
                onChange={e => {
                  if (e.target.value === '__manual__') {
                     setManualNdiMode(true);
                     update({ name: '' });
                  } else {
                     update({ name: e.target.value });
                  }
                }}
              >
                <option value="">-- Select NDI Source --</option>
                {ndiSources.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
                <option value="__manual__">📝 Manual input...</option>
              </select>
            ) : (
              <div className="flex w-full gap-1.5">
                <input
                  type="text"
                  placeholder="NDI Source Name (e.g. MY-PC (OBS))"
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
                  value={config.name || ''}
                  onChange={e => update({ name: e.target.value })}
                />
                {ndiSources.length > 0 && (
                  <button
                    type="button"
                    className="px-2.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs transition-colors shrink-0"
                    onClick={() => {
                      setManualNdiMode(false);
                      update({ name: ndiSources[0] || '' });
                    }}
                  >
                    List
                  </button>
                )}
              </div>
            )}
            <button
              type="button"
              disabled={scanningNdi}
              onClick={scanNdi}
              className="px-2.5 bg-brand-lime hover:bg-brand-lime/80 disabled:opacity-50 text-black font-black rounded-lg text-xs transition-colors shrink-0 cursor-pointer"
            >
              {scanningNdi ? "Scanning..." : "Scan"}
            </button>
          </div>
        </div>
      )}

      {config.type === 'udp' && (
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text" placeholder="Multicast / Host"
            className="bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
            value={config.host || ''} onChange={e => update({ host: e.target.value })}
          />
          <input
            type="text" placeholder="Port"
            className="bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
            value={config.port || ''} onChange={e => update({ port: e.target.value })}
          />
        </div>
      )}

      {config.type === 'rtp' && (
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text" placeholder="Host"
            className="bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
            value={config.host || ''} onChange={e => update({ host: e.target.value })}
          />
          <input
            type="text" placeholder="Port"
            className="bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
            value={config.port || ''} onChange={e => update({ port: e.target.value })}
          />
        </div>
      )}

      {config.type === 'decklink' && (
        <div className="space-y-2">
          <div>
            <label className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">Dispositivo DeckLink</label>
            {loadingDevices ? (
              <div className="text-[10px] text-text-secondary animate-pulse">Cargando dispositivos...</div>
            ) : devices.length === 0 ? (
              <div className="space-y-1.5">
                <div className="text-[10px] text-amber-500 font-medium">⚠️ No se detectaron tarjetas de captura DeckLink.</div>
                <input
                  type="text"
                  placeholder="Nombre del dispositivo (ej: DeckLink Mini Recorder)"
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
                  value={config.device || ''}
                  onChange={e => update({ device: e.target.value })}
                />
                <p className="text-[9px] text-text-secondary">
                  Ejemplo: <code className="text-brand-orange font-mono">DeckLink Mini Recorder</code>.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex gap-1.5">
                  {!manualDeviceMode ? (
                    <select
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
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
                    <div className="flex flex-col w-full gap-1.5">
                      <div className="flex w-full gap-1.5">
                        <input
                          type="text"
                          placeholder="Nombre del dispositivo"
                          className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
                          value={config.device || ''}
                          onChange={e => update({ device: e.target.value })}
                        />
                        <button
                          type="button"
                          className="px-2.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs transition-colors shrink-0"
                          onClick={() => {
                            setManualDeviceMode(false);
                            update({ device: devices[0] || '' });
                          }}
                        >
                          Lista
                        </button>
                      </div>
                      <p className="text-[9px] text-text-secondary">
                        Ejemplo: <code className="text-brand-orange font-mono">DeckLink Mini Recorder</code>.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">Conector de Video (video_input)</label>
            <select
              className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
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
            <label className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">Conector de Audio (audio_input)</label>
            <select
              className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
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
            <label className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">Formato de Entrada (format_code)</label>
            {manualDeviceMode ? (
              <input
                type="text"
                placeholder="Código de formato (ej: hp50)"
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                value={config.format_code || ''}
                onChange={e => update({ format_code: e.target.value })}
              />
            ) : loadingFormats ? (
              <div className="text-[10px] text-text-secondary animate-pulse">Cargando formatos soportados...</div>
            ) : formats.length === 0 ? (
              <input
                type="text"
                placeholder="Código de formato (ej: hp50) - No se detectaron formatos"
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                value={config.format_code || ''}
                onChange={e => update({ format_code: e.target.value })}
              />
            ) : (
              <select
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
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
        <div className="space-y-2">
          <div>
            <label className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">Dispositivo ALSA</label>
            {loadingAlsaDevices ? (
              <div className="text-[10px] text-text-secondary animate-pulse">Cargando dispositivos ALSA...</div>
            ) : alsaDevices.length === 0 ? (
              <div className="space-y-1.5">
                <div className="text-[10px] text-amber-500 font-medium">⚠️ No se detectaron tarjetas de sonido ALSA.</div>
                <input
                  type="text"
                  placeholder="ID del dispositivo ALSA (ej: hw:0,0)"
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
                  value={config.device || ''}
                  onChange={e => update({ device: e.target.value })}
                />
                <p className="text-[9px] text-text-secondary">
                  Ejemplo: <code className="text-brand-orange font-mono">hw:0,0</code>.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex gap-1.5">
                  {!manualAlsaMode ? (
                    <select
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
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
                    <div className="flex flex-col w-full gap-1.5">
                      <div className="flex w-full gap-1.5">
                        <input
                          type="text"
                          placeholder="ID del dispositivo ALSA (ej: hw:0,0)"
                          className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
                          value={config.device || ''}
                          onChange={e => update({ device: e.target.value })}
                        />
                        <button
                          type="button"
                          className="px-2.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs transition-colors shrink-0"
                          onClick={() => {
                            setManualAlsaMode(false);
                            update({ device: alsaDevices[0]?.device || '' });
                          }}
                        >
                          Lista
                        </button>
                      </div>
                      <p className="text-[9px] text-text-secondary">
                        Ejemplo: <code className="text-brand-orange font-mono">hw:0,0</code>.
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
        <div className="space-y-2">
          <div>
            <label className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">Dispositivo V4L2</label>
            {loadingV4l2Devices ? (
              <div className="text-[10px] text-text-secondary animate-pulse">Cargando dispositivos V4L2...</div>
            ) : v4l2Devices.length === 0 ? (
              <div className="space-y-1.5">
                <div className="text-[10px] text-amber-500 font-medium">⚠️ No se detectaron dispositivos V4L2.</div>
                <input
                  type="text"
                  placeholder="Ruta del dispositivo (ej: /dev/video0)"
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
                  value={config.device || ''}
                  onChange={e => update({ device: e.target.value })}
                />
                <p className="text-[9px] text-text-secondary">
                  Ejemplo: <code className="text-brand-orange font-mono">/dev/video0</code>.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex gap-1.5">
                  {!manualV4l2Mode ? (
                    <select
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
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
                    <div className="flex flex-col w-full gap-1.5">
                      <div className="flex w-full gap-1.5">
                        <input
                          type="text"
                          placeholder="Ruta del dispositivo (ej: /dev/video0)"
                          className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
                          value={config.device || ''}
                          onChange={e => update({ device: e.target.value })}
                        />
                        <button
                          type="button"
                          className="px-2.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs transition-colors shrink-0"
                          onClick={() => {
                            setManualV4l2Mode(false);
                            update({ device: v4l2Devices[0]?.device || '' });
                          }}
                        >
                          Lista
                        </button>
                      </div>
                      <p className="text-[9px] text-text-secondary">
                        Ejemplo: <code className="text-brand-orange font-mono">/dev/video0</code>.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {!manualV4l2Mode && config.device && (
            <div>
              <label className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">Formato y Resolución</label>
              {loadingV4l2Formats ? (
                <div className="text-[10px] text-text-secondary animate-pulse">Cargando formatos...</div>
              ) : v4l2Formats.length === 0 ? (
                <div className="text-[10px] text-text-secondary italic">No se detectaron formatos.</div>
              ) : (
                <select
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
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
                <div className="border border-lime-500/20 bg-lime-500/5 p-2 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1.5 animate-in fade-in duration-300">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] bg-lime-500/20 text-lime-400 px-1 py-0.5 rounded-full font-bold uppercase tracking-wider">
                        Magewell Link
                      </span>
                      <span className="text-[11px] font-semibold text-white">Audio Embebido Detectado</span>
                    </div>
                    <p className="text-[10px] text-text-secondary">
                      Asociado a ALSA <span className="font-mono text-lime-400">{selDev.alsa_device}</span>.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSyncAlsaAudio(selDev.alsa_device)}
                    className="text-[10px] bg-lime-500 hover:bg-lime-600 text-black font-bold px-2 py-1 rounded-lg transition-colors whitespace-nowrap self-end sm:self-center"
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
        <div className="space-y-2">
          <select
            className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
            value={config.pattern || 'testsrc'}
            onChange={e => update({ pattern: e.target.value })}
          >
            <option value="testsrc">Color Bars (testsrc)</option>
            <option value="smptebars">SMPTE Bars (smptebars)</option>
            <option value="color=c=black">Black Screen</option>
            <option value="color=c=white">White Screen</option>
          </select>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">Resolution (size)</label>
              <select
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
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
              <label className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">Framerate (rate)</label>
              <select
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
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
        <div className="space-y-2">
          <select
            className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
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
              <label className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">Frequency (Hz)</label>
              <input
                type="number"
                placeholder="1000"
                min={20}
                max={20000}
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                value={config.frequency || 1000}
                onChange={e => update({ frequency: Number(e.target.value) })}
              />
            </div>
          )}
        </div>
      )}

      {['file', 'srt', 'udp', 'rtp', 'rtmp', 'hls'].includes(config.type) && (
        <div className="space-y-1.5 pt-2 border-t border-white/5 animate-in fade-in duration-300">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-lime" />
            <h4 className="text-brand-lime font-bold text-[10px] uppercase tracking-wider">Hardware Decoding (Input)</h4>
            <span className="text-[9px] text-white/20 italic ml-auto">-hwaccel</span>
          </div>

          <select
            className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none transition-all focus:border-brand-lime"
            value={config.hwaccel || 'none'}
            onChange={e => {
              const val = e.target.value;
              update({ 
                hwaccel: val,
                hwaccel_output_format: val !== 'none' ? 'system' : '',
                frames_destination: 'cpu'
              });
            }}
          >
            <option value="none">None (Software Decoding)</option>
            {(!systemCapabilities || systemCapabilities.nvenc?.available) && (
              <option value="cuda">NVIDIA GPU (CUDA)</option>
            )}
            {(!systemCapabilities || systemCapabilities.vaapi?.available) && (
              <>
                <option value="vaapi">Intel/AMD GPU (VAAPI)</option>
                <option value="qsv">Intel Quick Sync (QSV)</option>
              </>
            )}
            <option value="auto">Auto-detect</option>
          </select>
          <span className="text-[9px] text-text-secondary block px-1">
            Offloads video decoding to the selected GPU. Recommended for high-bitrate file or network inputs.
          </span>

          {config.hwaccel && config.hwaccel !== 'none' && (
            <div className="mt-1.5 animate-in fade-in duration-200">
              <label className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">
                Decoded Frames Destination
              </label>
              <select
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
                value={config.hwaccel_output_format || 'system'}
                onChange={e => {
                  const val = e.target.value;
                  update({ 
                    hwaccel_output_format: val,
                    frames_destination: val === 'system' ? 'cpu' : 'vram'
                  });
                }}
              >
                <option value="system">System Memory (CPU RAM) — Maximum Compatibility</option>
                <option value={config.hwaccel}>GPU Memory (VRAM) — High Performance GPU Transcode</option>
              </select>
              <span className="text-[9px] text-text-secondary block mt-1 px-1">
                {config.hwaccel_output_format === 'system'
                  ? "Copies decoded frames to system RAM. Works with all software filters/encoders."
                  : "Keeps decoded frames in VRAM. Bypasses CPU copies, requires hardware filters/encoders."
                }
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default InputSourcePanel;
