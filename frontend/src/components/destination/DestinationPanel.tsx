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
  { value: 'whip', label: 'WHIP Push (WebRTC)', requiresVideo: false },
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

const destinationCache: {
  decklinkDevices: string[] | null;
  decklinkFormats: Record<string, any[]>;
} = {
  decklinkDevices: null,
  decklinkFormats: {},
};

const DestinationPanel: React.FC<DestinationPanelProps> = ({
  config,
  hasVideo,
  hasAudio,
  onChange,
  systemCapabilities,
}) => {
  const decklinkAvailable = systemCapabilities?.decklink?.available ?? true;
  const avahiAvailable = systemCapabilities?.avahi?.available ?? true;

  let filteredOutputTypes = OUTPUT_TYPES;
  if (!decklinkAvailable) {
    filteredOutputTypes = filteredOutputTypes.filter(t => t.value !== 'decklink');
  }
  if (!avahiAvailable) {
    filteredOutputTypes = filteredOutputTypes.filter(t => t.value !== 'ndi');
  }

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

    if (destinationCache.decklinkDevices !== null) {
      setDevices(destinationCache.decklinkDevices);
      if (destinationCache.decklinkDevices.length > 0) {
        const found = destinationCache.decklinkDevices.includes(config.device || '');
        if (!found && config.device) {
          setManualDeviceMode(true);
        }
      }
      return;
    }

    const fetchDevices = async () => {
      setLoadingDevices(true);
      try {
        const res = await fetch('/decklink/devices');
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        const outputs = data.outputs || [];
        destinationCache.decklinkDevices = outputs;
        if (active) {
          setDevices(outputs);
          if (outputs.length > 0) {
            const found = outputs.includes(config.device || '');
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

    const cacheKey = config.device;
    if (destinationCache.decklinkFormats[cacheKey] !== undefined) {
      setFormats(destinationCache.decklinkFormats[cacheKey]);
      return;
    }

    const fetchFormats = async () => {
      setLoadingFormats(true);
      try {
        const res = await fetch(`/decklink/formats?device=${encodeURIComponent(config.device || '')}`);
        if (!res.ok) throw new Error("Failed to fetch formats");
        const data = await res.json();
        const formatsList = data || [];
        destinationCache.decklinkFormats[cacheKey] = formatsList;
        if (active) {
          setFormats(formatsList);
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
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
        <label htmlFor="dest-type" className="text-purple-400 font-bold text-xs uppercase tracking-wider cursor-pointer">Destination</label>
      </div>

      <select
        id="dest-type"
        name="type"
        className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none focus:border-purple-400 transition-all"
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
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor={`dest-${config.type}-host`} className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">Host / Multicast IP</label>
              <input
                type="text"
                id={`dest-${config.type}-host`}
                name="host"
                placeholder="e.g. 239.0.0.1 or 127.0.0.1"
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
                value={config.host || ''} onChange={e => update({ host: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor={`dest-${config.type}-port`} className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">Port</label>
              <input
                type="text"
                id={`dest-${config.type}-port`}
                name="port"
                placeholder="1234"
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                value={config.port || ''} onChange={e => update({ port: e.target.value })}
              />
            </div>
          </div>

          {config.type === 'udp' && (
            <div className="border border-white/5 bg-white/[0.01] rounded-lg p-2.5 space-y-2">
              <span className="text-[9px] uppercase font-black tracking-widest text-text-secondary">
                MPEG-TS & DVB Broadcast Options
              </span>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="dest-udp-muxrate" className="text-[9px] text-text-secondary font-bold block mb-0.5">Constant Muxrate (bps)</label>
                  <input
                    type="text"
                    id="dest-udp-muxrate"
                    name="muxrate"
                    placeholder="e.g. 5000000 (5 Mbps)"
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                    value={config.muxrate || ''} onChange={e => update({ muxrate: e.target.value })}
                  />
                </div>

                <div>
                  <label htmlFor="dest-udp-pkt-size" className="text-[9px] text-text-secondary font-bold block mb-0.5">Socket Packet Size (pkt_size)</label>
                  <input
                    type="number"
                    id="dest-udp-pkt-size"
                    name="pkt_size"
                    placeholder="1316" min={188} max={65535}
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                    value={config.pkt_size || 1316} onChange={e => update({ pkt_size: Number(e.target.value) })}
                  />
                </div>

                <div>
                  <label htmlFor="dest-udp-service-provider" className="text-[9px] text-text-secondary font-bold block mb-0.5">Service Provider</label>
                  <input
                    type="text"
                    id="dest-udp-service-provider"
                    name="service_provider"
                    placeholder="e.g. Antigravity Broadcast"
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
                    value={config.service_provider || ''} onChange={e => update({ service_provider: e.target.value })}
                  />
                </div>

                <div>
                  <label htmlFor="dest-udp-service-name" className="text-[9px] text-text-secondary font-bold block mb-0.5">Service Name</label>
                  <input
                    type="text"
                    id="dest-udp-service-name"
                    name="service_name"
                    placeholder="e.g. Main HD Channel"
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
                    value={config.service_name || ''} onChange={e => update({ service_name: e.target.value })}
                  />
                </div>

                <div>
                  <label htmlFor="dest-udp-ts-id" className="text-[9px] text-text-secondary font-bold block mb-0.5">Transport Stream ID (HEX/DEC)</label>
                  <input
                    type="text"
                    id="dest-udp-ts-id"
                    name="transport_stream_id"
                    placeholder="e.g. 0x0001 or 1"
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                    value={config.transport_stream_id || ''} onChange={e => update({ transport_stream_id: e.target.value })}
                  />
                </div>

                <div>
                  <label htmlFor="dest-udp-net-id" className="text-[9px] text-text-secondary font-bold block mb-0.5">Original Network ID (HEX/DEC)</label>
                  <input
                    type="text"
                    id="dest-udp-net-id"
                    name="original_network_id"
                    placeholder="e.g. 0x20fa or 8442"
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                    value={config.original_network_id || ''} onChange={e => update({ original_network_id: e.target.value })}
                  />
                </div>

                <div className="col-span-2">
                  <label htmlFor="dest-udp-service-id" className="text-[9px] text-text-secondary font-bold block mb-0.5">Service ID (HEX/DEC)</label>
                  <input
                    type="text"
                    id="dest-udp-service-id"
                    name="service_id"
                    placeholder="e.g. 0x0001 or 1"
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                    value={config.service_id || ''} onChange={e => update({ service_id: e.target.value })}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {config.type === 'srt' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label htmlFor="dest-srt-mode" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">SRT Connection Mode</label>
              <select
                id="dest-srt-mode"
                name="mode"
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
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
              <label htmlFor="dest-srt-host" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">
                {config.mode === 'listener' ? 'Bind Interface / Host' : 'Remote Host / IP'}
              </label>
              <input
                type="text"
                id="dest-srt-host"
                name="host"
                placeholder={config.mode === 'listener' ? "0.0.0.0 (all interfaces)" : "e.g. 52.210.205.135"}
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
                value={config.host || ''}
                onChange={e => update({ host: e.target.value })}
              />
            </div>

            <div>
              <label htmlFor="dest-srt-port" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">Port</label>
              <input
                type="text"
                id="dest-srt-port"
                name="port"
                placeholder="9000"
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                value={config.port || ''}
                onChange={e => update({ port: e.target.value })}
              />
            </div>

            <div>
              <label htmlFor="dest-srt-latency" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">Latency (ms)</label>
              <input
                type="number"
                id="dest-srt-latency"
                name="latency"
                placeholder="200"
                min={20}
                max={8000}
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                value={config.latency || 200}
                onChange={e => update({ latency: Number(e.target.value) })}
              />
            </div>

            <div>
              <label htmlFor="dest-srt-streamid" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">Stream ID (Optional)</label>
              <input
                type="text"
                id="dest-srt-streamid"
                name="streamid"
                placeholder="e.g. output_stream_1"
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                value={config.streamid || ''}
                onChange={e => update({ streamid: e.target.value })}
              />
            </div>
          </div>

          <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-2 text-[10px] text-purple-300">
            {config.mode === 'caller' ? (
              <span>
                <strong>Caller Mode:</strong> FFmpeg pushes the stream to remote listener at <strong>{config.host || 'Host'}</strong>:<strong>{config.port || 'Port'}</strong>.
              </span>
            ) : config.mode === 'listener' ? (
              <span>
                <strong>Listener Mode:</strong> FFmpeg opens port <strong>{config.port || '9000'}</strong>. Transcoding starts when a client connects.
              </span>
            ) : (
              <span>
                <strong>Rendezvous Mode:</strong> Peer-to-peer connection. Requires the same port on both nodes.
              </span>
            )}
          </div>
        </div>
      )}

      {config.type === 'rtmp' && (
        <input
          type="text"
          id="dest-rtmp-url"
          name="url"
          placeholder="RTMP URL (rtmp://server/live/key)"
          className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
          value={config.url || ''} onChange={e => update({ url: e.target.value })}
        />
      )}

      {config.type === 'ndi' && (
        <div className="space-y-2">
          <div>
            <label htmlFor="dest-ndi-path" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">NDI Output Connection Name</label>
            <input
              type="text"
              id="dest-ndi-path"
              name="path"
              placeholder="e.g. MY-ENCODER-OUT"
              className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
              value={config.path || ''} onChange={e => update({ path: e.target.value })}
            />
          </div>
          <div className="p-2 bg-purple-500/10 border border-purple-500/20 rounded-lg text-[10px] text-purple-300 space-y-0.5">
            <div className="flex items-center gap-1 font-bold">
              <span>🔒 Locked NDI Specifications:</span>
            </div>
            <ul className="list-disc pl-3.5 space-y-0.5 text-text-secondary">
              <li>Format: <code className="text-purple-300 font-mono text-[9px]">libndi_newtek</code></li>
              <li>Pixel Format: <code className="text-purple-300 font-mono text-[9px]">uyvy422</code></li>
              <li>Framerate / Resolution: Dynamic (pass-through)</li>
            </ul>
          </div>
        </div>
      )}

      {config.type === 'decklink' && (
        <div className="space-y-2">
          <div className="p-2 bg-purple-500/10 border border-purple-500/20 rounded-lg text-[10px] text-purple-300 flex items-start gap-1.5">
            <span className="text-xs">ℹ️</span>
            <div>
              <strong>Salida física DeckLink:</strong> Las tarjetas de reproducción DeckLink requieren vídeo y audio sin compresión (como v210/rawvideo en formato UYVY 4:2:2, y audio PCM). Configura códecs compatibles en la pestaña de codificación.
            </div>
          </div>
          <div>
            <label htmlFor="dest-decklink-device" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">Dispositivo DeckLink de Salida</label>
            {loadingDevices ? (
              <div className="text-[10px] text-text-secondary animate-pulse">Cargando dispositivos...</div>
            ) : devices.length === 0 ? (
              <div className="space-y-1.5">
                <div className="text-[10px] text-amber-500 font-medium">⚠️ No se detectaron tarjetas de salida DeckLink.</div>
                <input
                  type="text"
                  id="dest-decklink-device"
                  name="device"
                  placeholder="Nombre del dispositivo (ej: DeckLink Mini Monitor)"
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
                  value={config.device || ''}
                  onChange={e => update({ device: e.target.value })}
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex gap-1.5">
                  {!manualDeviceMode ? (
                    <select
                      id="dest-decklink-device"
                      name="device"
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
                    <div className="flex w-full gap-1.5">
                      <input
                        type="text"
                        id="dest-decklink-device"
                        name="device"
                        placeholder="Nombre del dispositivo"
                        className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
                        value={config.device || ''}
                        onChange={e => update({ device: e.target.value })}
                      />
                      <button
                        type="button"
                        className="px-2.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs transition-colors"
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
            <label htmlFor="dest-decklink-format-code" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">Formato de Salida (format_code)</label>
            {manualDeviceMode ? (
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  id="dest-decklink-format-code"
                  name="format_code"
                  placeholder="Formato (ej: Hp25)"
                  className="col-span-1 bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                  value={config.format_code || ''}
                  onChange={e => update({ format_code: e.target.value })}
                />
                <input
                  type="text"
                  id="dest-decklink-video-size"
                  name="video_size"
                  placeholder="Resolución (ej: 1920x1080)"
                  className="col-span-1 bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                  value={config.video_size || ''}
                  onChange={e => update({ video_size: e.target.value })}
                />
                <input
                  type="text"
                  id="dest-decklink-framerate"
                  name="framerate"
                  placeholder="FPS (ej: 25)"
                  className="col-span-1 bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                  value={config.framerate || ''}
                  onChange={e => update({ framerate: e.target.value })}
                />
              </div>
            ) : loadingFormats ? (
              <div className="text-[10px] text-text-secondary animate-pulse">Cargando formatos soportados...</div>
            ) : formats.length === 0 ? (
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  id="dest-decklink-format-code"
                  name="format_code"
                  placeholder="Formato (ej: Hp25) - No detectados"
                  className="col-span-1 bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                  value={config.format_code || ''}
                  onChange={e => update({ format_code: e.target.value })}
                />
                <input
                  type="text"
                  id="dest-decklink-video-size"
                  name="video_size"
                  placeholder="Resolución (ej: 1920x1080)"
                  className="col-span-1 bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                  value={config.video_size || ''}
                  onChange={e => update({ video_size: e.target.value })}
                />
                <input
                  type="text"
                  id="dest-decklink-framerate"
                  name="framerate"
                  placeholder="FPS (ej: 25)"
                  className="col-span-1 bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                  value={config.framerate || ''}
                  onChange={e => update({ framerate: e.target.value })}
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <select
                  id="dest-decklink-format-code"
                  name="format_code"
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
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
                  <div className="flex gap-4 px-1 text-[10px] text-text-secondary font-mono">
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
        <div className="grid grid-cols-3 gap-2">
          <input
            type="text"
            id="dest-file-path"
            name="path"
            placeholder="Output file path"
            className="col-span-2 bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
            value={config.path || ''} onChange={e => update({ path: e.target.value })}
          />
          <select
            id="dest-file-container"
            name="container"
            className="bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
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
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            id="dest-icecast-host"
            name="host"
            placeholder="Icecast Host"
            className="bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
            value={config.host || ''} onChange={e => update({ host: e.target.value })}
          />
          <input
            type="text"
            id="dest-icecast-port"
            name="port"
            placeholder="Port (default: 8000)"
            className="bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
            value={config.port || ''} onChange={e => update({ port: e.target.value })}
          />
          <input
            type="text"
            id="dest-icecast-mount"
            name="icecast_mount"
            placeholder="Mount point (e.g. /live)"
            className="bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
            value={config.icecast_mount || ''} onChange={e => update({ icecast_mount: e.target.value })}
          />
          <input
            type="password"
            id="dest-icecast-password"
            name="icecast_password"
            placeholder="Source password"
            className="bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
            value={config.icecast_password || ''} onChange={e => update({ icecast_password: e.target.value })}
          />
        </div>
      )}

      {config.type === 'hls' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="dest-hls-method" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">HLS Ingest Method</label>
              <select
                id="dest-hls-method"
                name="hls_method"
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
                value={config.hls_method || 'local'}
                onChange={e => update({ hls_method: e.target.value })}
              >
                <option value="local">Local Directory (.m3u8 + .ts)</option>
                <option value="PUT">HTTP PUT Upload</option>
                <option value="POST">HTTP POST Upload</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label htmlFor="dest-hls-time" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">Segment (s)</label>
                <input
                  type="number"
                  id="dest-hls-time"
                  name="hls_time"
                  min={1} max={60}
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                  value={config.hls_time ?? 2}
                  onChange={e => update({ hls_time: Number(e.target.value) })}
                />
              </div>
              <div>
                <label htmlFor="dest-hls-list-size" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">List Size</label>
                <input
                  type="number"
                  id="dest-hls-list-size"
                  name="hls_list_size"
                  min={2} max={100}
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                  value={config.hls_list_size ?? 5}
                  onChange={e => update({ hls_list_size: Number(e.target.value) })}
                />
              </div>
            </div>
          </div>

          <div>
            <label htmlFor="dest-hls-path" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">
              {config.hls_method === 'local' ? 'Output Playlist File Path' : 'Remote Ingest URL'}
            </label>
            <input
              type="text"
              id="dest-hls-path"
              name="path"
              placeholder={config.hls_method === 'local' ? 'e.g. /var/www/html/live/stream.m3u8' : 'e.g. http://ingest.server/live/stream.m3u8'}
              className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
              value={config.path || ''}
              onChange={e => update({ path: e.target.value })}
            />
          </div>

          {config.hls_method === 'local' && (
            <div className="flex items-center gap-2 p-1.5 bg-white/5 rounded-lg border border-white/5">
              <input
                type="checkbox" id="hls-delete-chk"
                name="hls_delete_segments"
                className="w-3.5 h-3.5 accent-purple-400"
                checked={config.hls_delete_segments ?? true}
                onChange={e => update({ hls_delete_segments: e.target.checked })}
              />
              <label htmlFor="hls-delete-chk" className="text-xs font-medium cursor-pointer">
                Delete Expired Segments (keep playlist clean)
              </label>
            </div>
          )}

          {(config.hls_method === 'PUT' || config.hls_method === 'POST') && (
            <div>
              <label htmlFor="dest-hls-headers" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">Custom HTTP Headers (Optional)</label>
              <textarea
                id="dest-hls-headers"
                name="headers"
                placeholder="e.g. Authorization: Bearer token123&#10;X-Custom-Header: value"
                rows={2}
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono resize-none"
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

      {config.type === 'whip' && (
        <div className="space-y-1.5 animate-in fade-in duration-200">
          <label htmlFor="dest-whip-url" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">WHIP EndPoint (WebRTC)</label>
          <input
            type="text"
            id="dest-whip-url"
            name="url"
            placeholder="WHIP Ingestion URL (e.g. http://mediamtx:8889/mystream/whip)"
            className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
            value={config.url || ''}
            onChange={e => update({ url: e.target.value })}
          />
        </div>
      )}

      {/* ── Recommended Broadcast Recipe Card ── */}
      {renderBroadcastRecipe(config.type)}
    </div>
  );
};

const renderBroadcastRecipe = (type: string) => {
  const recipes: Record<string, { title: string; video: string; audio: string; details: string; container: string }> = {
    udp: {
      title: "UDP Multicast (MPEG-TS)",
      video: "H.264 (AVC) / H.265 (HEVC)",
      audio: "MP2 (MPEG-2 Audio) / AAC-LC",
      container: "MPEG-TS",
      details: "Ideal para cabeceras y decodificadores locales en redes LAN. Utiliza códecs estándar y un tamaño de paquete (pkt_size) de 1316 para alineación óptima de red."
    },
    srt: {
      title: "SRT Stream (Low Latency WAN)",
      video: "H.265 (HEVC) / H.264 (AVC)",
      audio: "Opus (libopus) / AAC / MP2",
      container: "MPEG-TS",
      details: "Recomendado para enlaces WAN inestables de contribución punto a punto. La combinación de HEVC con Opus o MP2 ofrece excelente eficiencia y tolerancia a pérdidas."
    },
    rtmp: {
      title: "RTMP / RTMPS Ingest",
      video: "H.264 (AVC)",
      audio: "AAC-LC",
      container: "FLV (Autogestionado)",
      details: "Estándar de facto para ingesta en redes sociales (YouTube, Twitch, Facebook). No admite HEVC u Opus en la mayoría de plataformas tradicionales."
    },
    whip: {
      title: "WHIP Push (WebRTC Live Ingest)",
      video: "H.264 (AVC) / VP8 / VP9 — zero-latency settings",
      audio: "Opus (libopus)",
      container: "WebRTC Payload",
      details: "Ideal para monitorización interactiva sub-segundo en MediaMTX o Janus. Se admiten códecs H.264, VP8 y VP9 (hardware y software). Requiere obligatoriamente tune: zerolatency."
    },
    ndi: {
      title: "NDI Output (Studio IP LAN)",
      video: "SpeedHQ (Interno)",
      audio: "PCM Sin Compresión",
      container: "NDI Stream",
      details: "Excelente para producción local y mezcladores software (vMix, OBS). El codificador SpeedHQ y audio raw se gestionan automáticamente."
    },
    decklink: {
      title: "Blackmagic DeckLink (Physical SDI/HDMI)",
      video: "rawvideo (UYVY 4:2:2 sin compresión) / v210",
      audio: "pcm_s16le / pcm_s24le (PCM)",
      container: "Dispositivo físico",
      details: "Salida de hardware directa para monitores profesionales o matrices SDI. Los códecs deben ser configurados estrictamente sin compresión en la pestaña de códecs."
    },
    file: {
      title: "Grabación Local (Archivo)",
      video: "ProRes (edición) / H.264 / H.265 (distribución)",
      audio: "PCM (16/24-bit) / AAC-LC",
      container: "MP4 / MKV / MOV / TS",
      details: "Muxer universal para volcado a disco local. Elige ProRes para flujos de edición sin pérdidas o H.264/H.265 para distribución final y compacta."
    },
    hls: {
      title: "HLS Live Streaming (HTTP Live)",
      video: "H.264 (AVC) / H.265 (HEVC)",
      audio: "AAC-LC / Opus",
      container: "HLS (.m3u8 + segmentos)",
      details: "Ideal para distribución masiva web. Genera playlists (.m3u8) y segmentos indexados. Requiere códecs con amplio soporte en navegadores móviles."
    },
    icecast: {
      title: "Icecast2 (Audio Streaming)",
      video: "Ninguno (Solo Audio)",
      audio: "MP3 / AAC / Opus",
      container: "ADTS / Ogg / MP3 Stream",
      details: "Destinado a radio por internet o streaming de audio puro. Permite ingesta remota hacia servidores Icecast2."
    },
    rtp: {
      title: "RTP Session Stream",
      video: "H.264 (AVC)",
      audio: "AAC / Opus / PCM",
      container: "RTP Session",
      details: "Flujo unicast directo sin contenedor de transporte pesado, comúnmente utilizado para contribuciones de bajísima latencia o integraciones con sistemas legacy."
    }
  };

  const recipe = recipes[type];
  if (!recipe) return null;

  return (
    <div className="mt-4 p-3 bg-brand-orange/5 border border-brand-orange/15 rounded-xl text-[10px] space-y-1.5 animate-in fade-in duration-200">
      <div className="flex items-center gap-1.5 font-bold text-brand-orange">
        <span>💡 Receta Broadcast Recomendada (Best Practices)</span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-text-secondary">
        <div>
          <span className="font-bold block text-[9px] uppercase tracking-wider text-white/55">Códec de Vídeo</span>
          <span className="text-white/85 font-mono">{recipe.video}</span>
        </div>
        <div>
          <span className="font-bold block text-[9px] uppercase tracking-wider text-white/55">Códec de Audio</span>
          <span className="text-white/85 font-mono">{recipe.audio}</span>
        </div>
        <div className="col-span-2">
          <span className="font-bold block text-[9px] uppercase tracking-wider text-white/55">Contenedor / Muxer</span>
          <span className="text-white/85 font-mono">{recipe.container}</span>
        </div>
      </div>
      <div className="text-[10px] text-text-secondary border-t border-white/5 pt-1.5 leading-relaxed">
        {recipe.details}
      </div>
    </div>
  );
};

export default React.memo(DestinationPanel);
