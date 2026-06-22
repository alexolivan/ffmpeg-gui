import React from 'react';
import type { SystemCapabilities } from '../codec/codecRegistry';
import { HlsVariantsForm, type HlsVariant } from './HlsVariantsForm';

export interface OutputConfig {
  type: string;
  host?: string;
  port?: string;
  path?: string;
  url?: string;
  mode?: string;
  latency?: number;
  container?: string;
  icecast_mount?: string;
  icecast_password?: string;
  device?: string;
  format_code?: string;
  video_size?: string;
  framerate?: string;
  hls_method?: string;
  hls_time?: number;
  hls_list_size?: number;
  hls_delete_segments?: boolean;
  headers?: string;
  variants?: HlsVariant[];
  muxrate?: string;
  service_provider?: string;
  service_name?: string;
  transport_stream_id?: string;
  original_network_id?: string;
  service_id?: string;
  pkt_size?: number;
  streamid?: string;
}

interface DestinationPanelProps {
  config: OutputConfig;
  hasVideo: boolean;
  hasAudio: boolean;
  onChange: (config: OutputConfig) => void;
  systemCapabilities?: SystemCapabilities;
}

const OUTPUT_TYPES = [
  { value: 'udp', label: 'UDP Multicast (MPEG-TS)', requiresVideo: false },
  { value: 'srt', label: 'SRT Stream', requiresVideo: false },
  { value: 'rtmp', label: 'RTMP / RTMPS Push', requiresVideo: true },
  { value: 'ndi', label: 'NDI Output', requiresVideo: true },
  { value: 'decklink', label: 'Blackmagic Decklink Output', requiresVideo: true },
  { value: 'file', label: 'Local Recording', requiresVideo: false },
  { value: 'icecast', label: 'Icecast2 (Audio Stream)', requiresVideo: false },
  { value: 'rtp', label: 'RTP Stream', requiresVideo: false },
  { value: 'hls', label: 'HLS Live Streaming', requiresVideo: false },
];

const CONTAINERS = [
  { value: 'mp4', label: 'MP4' },
  { value: 'mkv', label: 'MKV (Matroska)' },
  { value: 'mov', label: 'MOV (QuickTime)' },
  { value: 'ts', label: 'MPEG-TS' },
];

const DestinationPanel: React.FC<DestinationPanelProps> = ({
  config,
  hasVideo,
  hasAudio,
  onChange,
  systemCapabilities,
}) => {
  const decklinkAvailable = systemCapabilities?.decklink?.available ?? true;
  const filteredOutputTypes = decklinkAvailable
    ? OUTPUT_TYPES
    : OUTPUT_TYPES.filter(t => t.value !== 'decklink');

  const availableTypes = filteredOutputTypes.filter(t => {
    if (t.requiresVideo && !hasVideo) return false;
    if (t.value === 'icecast' && (!hasAudio || hasVideo)) return false;
    return true;
  });

  const update = (patch: Partial<OutputConfig>) => {
    onChange({ ...config, ...patch });
  };

  const [devices, setDevices] = React.useState<string[]>([]);
  const [loadingDevices, setLoadingDevices] = React.useState(false);
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
          setDevices(data.outputs || []);
          if (data.outputs && data.outputs.length > 0) {
            const found = data.outputs.includes(config.device || '');
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

  const [formats, setFormats] = React.useState<any[]>([]);
  const [loadingFormats, setLoadingFormats] = React.useState(false);

  React.useEffect(() => {
    if (config.type !== 'decklink' || !config.device) {
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

  const parseFormatDescription = (desc: string) => {
    const resMatch = desc.match(/(\d+)x(\d+)/);
    const fpsMatch = desc.match(/at ([\d/]+) fps/);
    return {
      video_size: resMatch ? `${resMatch[1]}x${resMatch[2]}` : undefined,
      framerate: fpsMatch ? fpsMatch[1] : undefined,
    };
  };

  const handleFormatChange = (code: string) => {
    if (!code) {
      update({
        format_code: '',
        video_size: '',
        framerate: '',
      });
      return;
    }
    const fmt = formats.find(f => f.code === code);
    if (fmt) {
      const parsed = parseFormatDescription(fmt.description);
      update({
        format_code: code,
        video_size: parsed.video_size || '',
        framerate: parsed.framerate || '',
      });
    } else {
      update({
        format_code: code,
      });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
        <h4 className="text-purple-400 font-bold text-xs uppercase tracking-wider">Destination</h4>
      </div>

      <select
        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm outline-none focus:border-purple-400 transition-all"
        value={config.type}
        onChange={e => update({
          type: e.target.value,
          host: '', port: '', path: '', url: '',
          mode: 'caller', latency: 200,
          container: 'mp4', icecast_mount: '', icecast_password: '',
          hls_method: 'local', hls_time: 2, hls_list_size: 5, hls_delete_segments: true, headers: '',
        })}
      >
        {availableTypes.map(t => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>

      {/* ── Type-specific fields ── */}

      {(config.type === 'udp' || config.type === 'rtp') && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">Host / Multicast IP</label>
              <input
                type="text" placeholder="e.g. 239.0.0.1 or 127.0.0.1"
                className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
                value={config.host || ''} onChange={e => update({ host: e.target.value })}
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">Port</label>
              <input
                type="text" placeholder="1234"
                className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono"
                value={config.port || ''} onChange={e => update({ port: e.target.value })}
              />
            </div>
          </div>

          {config.type === 'udp' && (
            <div className="border border-white/5 bg-white/[0.01] rounded-xl p-3.5 space-y-3">
              <span className="text-[10px] uppercase font-black tracking-widest text-text-secondary">
                MPEG-TS & DVB Broadcast Options
              </span>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-text-secondary font-bold block mb-1">Constant Muxrate (bps)</label>
                  <input
                    type="text" placeholder="e.g. 5000000 (5 Mbps)"
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-xs outline-none font-mono"
                    value={config.muxrate || ''} onChange={e => update({ muxrate: e.target.value })}
                  />
                </div>

                <div>
                  <label className="text-[10px] text-text-secondary font-bold block mb-1">Socket Packet Size (pkt_size)</label>
                  <input
                    type="number" placeholder="1316" min={188} max={65535}
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-xs outline-none font-mono"
                    value={config.pkt_size || 1316} onChange={e => update({ pkt_size: Number(e.target.value) })}
                  />
                </div>

                <div>
                  <label className="text-[10px] text-text-secondary font-bold block mb-1">Service Provider</label>
                  <input
                    type="text" placeholder="e.g. Antigravity Broadcast"
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-xs outline-none"
                    value={config.service_provider || ''} onChange={e => update({ service_provider: e.target.value })}
                  />
                </div>

                <div>
                  <label className="text-[10px] text-text-secondary font-bold block mb-1">Service Name</label>
                  <input
                    type="text" placeholder="e.g. Main HD Channel"
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-xs outline-none"
                    value={config.service_name || ''} onChange={e => update({ service_name: e.target.value })}
                  />
                </div>

                <div>
                  <label className="text-[10px] text-text-secondary font-bold block mb-1">Transport Stream ID (HEX/DEC)</label>
                  <input
                    type="text" placeholder="e.g. 0x0001 or 1"
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-xs outline-none font-mono"
                    value={config.transport_stream_id || ''} onChange={e => update({ transport_stream_id: e.target.value })}
                  />
                </div>

                <div>
                  <label className="text-[10px] text-text-secondary font-bold block mb-1">Original Network ID (HEX/DEC)</label>
                  <input
                    type="text" placeholder="e.g. 0x20fa or 8442"
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-xs outline-none font-mono"
                    value={config.original_network_id || ''} onChange={e => update({ original_network_id: e.target.value })}
                  />
                </div>

                <div className="col-span-2">
                  <label className="text-[10px] text-text-secondary font-bold block mb-1">Service ID (HEX/DEC)</label>
                  <input
                    type="text" placeholder="e.g. 0x0001 or 1"
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-xs outline-none font-mono"
                    value={config.service_id || ''} onChange={e => update({ service_id: e.target.value })}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {config.type === 'srt' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">SRT Connection Mode</label>
              <select
                className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
                value={config.mode || 'caller'}
                onChange={e => {
                  const m = e.target.value;
                  update({ 
                    mode: m, 
                    host: m === 'listener' ? '0.0.0.0' : config.host 
                  });
                }}
              >
                <option value="caller">Caller (Client Mode — push stream to remote listener)</option>
                <option value="listener">Listener (Server Mode — wait for remote caller to fetch stream)</option>
                <option value="rendezvous">Rendezvous Mode (Peer-to-peer connection)</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">
                {config.mode === 'listener' ? 'Bind Interface / Host' : 'Remote Host / IP'}
              </label>
              <input
                type="text"
                placeholder={config.mode === 'listener' ? "0.0.0.0 (all interfaces)" : "e.g. 52.210.205.135"}
                className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
                value={config.host || ''}
                onChange={e => update({ host: e.target.value })}
              />
            </div>

            <div>
              <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">Port</label>
              <input
                type="text"
                placeholder="9000"
                className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono"
                value={config.port || ''}
                onChange={e => update({ port: e.target.value })}
              />
            </div>

            <div>
              <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">Latency (ms)</label>
              <input
                type="number"
                placeholder="200"
                min={20}
                max={8000}
                className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono"
                value={config.latency || 200}
                onChange={e => update({ latency: Number(e.target.value) })}
              />
            </div>

            <div>
              <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">Stream ID (Optional)</label>
              <input
                type="text"
                placeholder="e.g. output_stream_1"
                className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono"
                value={config.streamid || ''}
                onChange={e => update({ streamid: e.target.value })}
              />
            </div>
          </div>

          <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-3 text-xs text-purple-300">
            {config.mode === 'caller' ? (
              <span>
                <strong>Caller Mode (Standard):</strong> FFmpeg will push the transcoded stream to the remote SRT listener at <strong>{config.host || 'Host'}</strong>:<strong>{config.port || 'Port'}</strong>.
              </span>
            ) : config.mode === 'listener' ? (
              <span>
                <strong>Listener Mode:</strong> FFmpeg will open a port at <strong>{config.port || '9000'}</strong>. The stream will start transcoding and broadcasting only when a remote client connects.
              </span>
            ) : (
              <span>
                <strong>Rendezvous Mode:</strong> Peer-to-peer streaming connection. Requires both nodes to use the same port.
              </span>
            )}
          </div>
        </div>
      )}

      {config.type === 'rtmp' && (
        <input
          type="text"
          placeholder="RTMP URL (rtmp://server/live/key)"
          className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
          value={config.url || ''} onChange={e => update({ url: e.target.value })}
        />
      )}

      {config.type === 'ndi' && (
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">NDI Output Connection Name</label>
            <input
              type="text"
              placeholder="e.g. MY-ENCODER-OUT"
              className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono"
              value={config.path || ''} onChange={e => update({ path: e.target.value })}
            />
          </div>
          <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl text-xs text-purple-300 space-y-1">
            <div className="flex items-center gap-1.5 font-bold">
              <span>🔒 Locked NDI Specifications:</span>
            </div>
            <ul className="list-disc pl-4 space-y-0.5 text-text-secondary">
              <li>Format: <code className="text-purple-300 font-mono">libndi_newtek</code></li>
              <li>Pixel Format: <code className="text-purple-300 font-mono">uyvy422</code> (enforced)</li>
              <li>Framerate / Resolution: Dynamic (passed through from filters)</li>
            </ul>
          </div>
        </div>
      )}

      {config.type === 'decklink' && (
        <div className="space-y-3">
          <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl text-xs text-purple-300 flex items-start gap-2.5">
            <span className="text-sm">ℹ️</span>
            <div>
              <strong>Salida física DeckLink:</strong> Las tarjetas de reproducción física DeckLink requieren vídeo y audio sin compresión (como v210 o rawvideo en formato UYVY 4:2:2, y audio PCM). Asegúrate de configurar códecs compatibles en la pestaña de codificación.
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">Dispositivo DeckLink de Salida</label>
            {loadingDevices ? (
              <div className="text-xs text-text-secondary animate-pulse">Cargando dispositivos...</div>
            ) : devices.length === 0 ? (
              <div className="space-y-2">
                <div className="text-xs text-amber-500 font-medium">⚠️ No se detectaron tarjetas de salida DeckLink.</div>
                <input
                  type="text"
                  placeholder="Nombre del dispositivo (ej: DeckLink Mini Monitor)"
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
            <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">Formato de Salida (format_code)</label>
            {manualDeviceMode ? (
              <div className="grid grid-cols-3 gap-3">
                <input
                  type="text"
                  placeholder="Formato (ej: Hp25)"
                  className="col-span-1 bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono"
                  value={config.format_code || ''}
                  onChange={e => update({ format_code: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="Resolución (ej: 1920x1080)"
                  className="col-span-1 bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono"
                  value={config.video_size || ''}
                  onChange={e => update({ video_size: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="FPS (ej: 25)"
                  className="col-span-1 bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono"
                  value={config.framerate || ''}
                  onChange={e => update({ framerate: e.target.value })}
                />
              </div>
            ) : loadingFormats ? (
              <div className="text-xs text-text-secondary animate-pulse">Cargando formatos soportados...</div>
            ) : formats.length === 0 ? (
              <div className="grid grid-cols-3 gap-3">
                <input
                  type="text"
                  placeholder="Formato (ej: Hp25) - No detectados"
                  className="col-span-1 bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono"
                  value={config.format_code || ''}
                  onChange={e => update({ format_code: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="Resolución (ej: 1920x1080)"
                  className="col-span-1 bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono"
                  value={config.video_size || ''}
                  onChange={e => update({ video_size: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="FPS (ej: 25)"
                  className="col-span-1 bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono"
                  value={config.framerate || ''}
                  onChange={e => update({ framerate: e.target.value })}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <select
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono"
                  value={config.format_code || ''}
                  onChange={e => handleFormatChange(e.target.value)}
                >
                  <option value="">Por defecto / Detección automática (SDK)</option>
                  {formats.map(f => (
                    <option key={f.code} value={f.code}>
                      {f.code} ({f.description})
                    </option>
                  ))}
                </select>
                
                {config.format_code && (
                  <div className="flex gap-4 px-1 text-[11px] text-text-secondary font-mono">
                    <div>Resolución forzada: <span className="text-purple-300">{config.video_size || 'Auto'}</span></div>
                    <div>Tasa de frames forzada: <span className="text-purple-300">{config.framerate || 'Auto'}</span></div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {config.type === 'file' && (
        <div className="grid grid-cols-3 gap-3">
          <input
            type="text"
            placeholder="Output file path"
            className="col-span-2 bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
            value={config.path || ''} onChange={e => update({ path: e.target.value })}
          />
          <select
            className="bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
            value={config.container || 'mp4'}
            onChange={e => update({ container: e.target.value })}
          >
            {CONTAINERS.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
      )}

      {config.type === 'icecast' && (
        <div className="grid grid-cols-2 gap-3">
          <input
            type="text" placeholder="Icecast Host"
            className="bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
            value={config.host || ''} onChange={e => update({ host: e.target.value })}
          />
          <input
            type="text" placeholder="Port (default: 8000)"
            className="bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
            value={config.port || ''} onChange={e => update({ port: e.target.value })}
          />
          <input
            type="text" placeholder="Mount point (e.g. /live)"
            className="bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
            value={config.icecast_mount || ''} onChange={e => update({ icecast_mount: e.target.value })}
          />
          <input
            type="password" placeholder="Source password"
            className="bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
            value={config.icecast_password || ''} onChange={e => update({ icecast_password: e.target.value })}
          />
        </div>
      )}

      {config.type === 'hls' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">HLS Ingest Method</label>
              <select
                className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
                value={config.hls_method || 'local'}
                onChange={e => update({ hls_method: e.target.value })}
              >
                <option value="local">Local Directory (.m3u8 + .ts)</option>
                <option value="PUT">HTTP PUT Upload</option>
                <option value="POST">HTTP POST Upload</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">Segment (s)</label>
                <input
                  type="number" min={1} max={60}
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono"
                  value={config.hls_time ?? 2}
                  onChange={e => update({ hls_time: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">List Size</label>
                <input
                  type="number" min={2} max={100}
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono"
                  value={config.hls_list_size ?? 5}
                  onChange={e => update({ hls_list_size: Number(e.target.value) })}
                />
              </div>
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">
              {config.hls_method === 'local' ? 'Output Playlist File Path' : 'Remote Ingest URL'}
            </label>
            <input
              type="text"
              placeholder={config.hls_method === 'local' ? 'e.g. /var/www/html/live/stream.m3u8' : 'e.g. http://ingest.server/live/stream.m3u8'}
              className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
              value={config.path || ''}
              onChange={e => update({ path: e.target.value })}
            />
          </div>

          {config.hls_method === 'local' && (
            <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/5">
              <input
                type="checkbox" id="hls-delete-chk"
                className="w-4 h-4 accent-purple-400"
                checked={config.hls_delete_segments ?? true}
                onChange={e => update({ hls_delete_segments: e.target.checked })}
              />
              <label htmlFor="hls-delete-chk" className="text-sm font-medium cursor-pointer">
                Delete Expired Segments (keep playlist clean)
              </label>
            </div>
          )}

          {(config.hls_method === 'PUT' || config.hls_method === 'POST') && (
            <div>
              <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">Custom HTTP Headers (Optional)</label>
              <textarea
                placeholder="e.g. Authorization: Bearer token123&#10;X-Custom-Header: value"
                rows={2}
                className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono resize-none"
                value={config.headers || ''}
                onChange={e => update({ headers: e.target.value })}
              />
            </div>
          )}

          <HlsVariantsForm
            variants={config.variants || []}
            onChange={variants => update({ variants })}
          />
        </div>
      )}
    </div>
  );
};

export default DestinationPanel;
