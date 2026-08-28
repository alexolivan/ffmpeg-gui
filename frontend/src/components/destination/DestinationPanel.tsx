import React from 'react';
import { useTranslation } from 'react-i18next';
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
  hls_abr_enabled?: boolean;
  hls_stream_name?: string;
  variants?: HlsVariant[];
  muxrate?: string;
  service_provider?: string;
  service_name?: string;
  transport_stream_id?: string;
  original_network_id?: string;
  service_id?: string;
  pkt_size?: number;
  streamid?: string;
  storage_id?: number | null;
  relative_path?: string;
  provider_service_id?: number | null;
  mediamtx_mode?: boolean;
  path_id?: string;
  auth_user?: string;
  auth_pass?: string;
  publish_user?: string;
  publish_pass?: string;
  read_user?: string;
  read_pass?: string;
  passphrase?: string;
  pbkeylen?: number | string;
  stream_action?: string;
  service_target?: string;
}

interface DestinationPanelProps {
  config: OutputConfig;
  hasVideo: boolean;
  hasAudio: boolean;
  onChange: (config: OutputConfig) => void;
  systemCapabilities?: SystemCapabilities;
  validationErrors?: Record<string, string>;
  validationWarnings?: Record<string, string>;
  storages?: any[];
}

const OUTPUT_TYPES = [
  { value: 'udp', labelKey: 'destinations.types.udp', label: 'UDP Multicast (MPEG-TS)', requiresVideo: false },
  { value: 'srt', labelKey: 'destinations.types.srt', label: 'SRT Stream', requiresVideo: false },
  { value: 'rtmp', labelKey: 'destinations.types.rtmp', label: 'RTMP / RTMPS Push', requiresVideo: true },
  { value: 'whip', labelKey: 'destinations.types.whip', label: 'WHIP Push (WebRTC)', requiresVideo: false },
  { value: 'ndi', labelKey: 'destinations.types.ndi', label: 'NDI Output', requiresVideo: true },
  { value: 'decklink', labelKey: 'destinations.types.decklink', label: 'Blackmagic Decklink Output', requiresVideo: true },
  { value: 'file', labelKey: 'destinations.types.file', label: 'Local Recording', requiresVideo: false },
  { value: 'icecast', labelKey: 'destinations.types.icecast', label: 'Icecast2 (Audio Stream)', requiresVideo: false },
  { value: 'alsa', labelKey: 'destinations.types.alsa', label: 'ALSA Audio Device', requiresVideo: false },
  { value: 'rtp', labelKey: 'destinations.types.rtp', label: 'RTP Stream', requiresVideo: false },
  { value: 'hls', labelKey: 'destinations.types.hls', label: 'HLS Live Streaming', requiresVideo: false },
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
  alsaPlaybackDevices?: any[] | null;
} = {
  decklinkDevices: null,
  decklinkFormats: {},
  alsaPlaybackDevices: null,
};

const DestinationPanel: React.FC<DestinationPanelProps> = ({
  config,
  hasVideo,
  hasAudio,
  onChange,
  systemCapabilities,
  validationErrors,
  validationWarnings,
  storages = [],
}) => {
  const { t } = useTranslation();
  const decklinkAvailable = systemCapabilities?.decklink?.available ?? true;
  const avahiAvailable = systemCapabilities?.avahi?.available ?? true;

  let filteredOutputTypes = OUTPUT_TYPES;
  if (!decklinkAvailable) {
    filteredOutputTypes = filteredOutputTypes.filter(t => t.value !== 'decklink');
  }

  const availableTypes = filteredOutputTypes.filter(t => {
    if (t.requiresVideo && !hasVideo) return false;
    if (t.value === 'icecast' && !hasAudio) return false;
    if (t.value === 'alsa' && !hasAudio) return false;
    return true;
  });

  const update = (patch: Partial<OutputConfig>) => {
    onChange({ ...config, ...patch });
  };

  const [devices, setDevices] = React.useState<string[]>([]);
  const [loadingDevices, setLoadingDevices] = React.useState(false);
  const [manualDeviceMode, setManualDeviceMode] = React.useState(false);

  const [alsaDevices, setAlsaDevices] = React.useState<any[]>([]);
  const [loadingAlsaDevices, setLoadingAlsaDevices] = React.useState(false);
  const [manualAlsaMode, setManualAlsaMode] = React.useState(false);

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

  React.useEffect(() => {
    if (config.type !== 'alsa') return;
    let active = true;

    if (destinationCache.alsaPlaybackDevices !== undefined && destinationCache.alsaPlaybackDevices !== null) {
      setAlsaDevices(destinationCache.alsaPlaybackDevices);
      if (destinationCache.alsaPlaybackDevices.length > 0) {
        const found = destinationCache.alsaPlaybackDevices.some((d: any) => d.device === config.device);
        if (!found && config.device && config.device !== 'default') {
          setManualAlsaMode(true);
        }
      }
      return;
    }

    const fetchAlsaPlayback = async () => {
      setLoadingAlsaDevices(true);
      try {
        const res = await fetch('/alsa/playback-devices');
        if (!res.ok) throw new Error("Failed to fetch ALSA playback devices");
        const data = await res.json();
        const devicesList = data || [];
        destinationCache.alsaPlaybackDevices = devicesList;
        if (active) {
          setAlsaDevices(devicesList);
          if (devicesList.length > 0) {
            const found = devicesList.some((d: any) => d.device === config.device);
            if (!found && config.device && config.device !== 'default') {
              setManualAlsaMode(true);
            }
          }
        }
      } catch (err) {
        console.error("Error fetching ALSA playback devices:", err);
      } finally {
        if (active) setLoadingAlsaDevices(false);
      }
    };
    fetchAlsaPlayback();
    return () => { active = false; };
  }, [config.type]);

  const [providers, setProviders] = React.useState<any[]>([]);

  React.useEffect(() => {
    let active = true;
    fetch('/api/dependencies/providers')
      .then(res => res.ok ? res.json() : [])
      .then(data => {
        if (active) setProviders(data || []);
      })
      .catch(() => {
        if (active) setProviders([]);
      });
    return () => { active = false; };
  }, []);

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
        <label htmlFor="dest-type" className="text-purple-400 font-bold text-xs uppercase tracking-wider cursor-pointer">{t('destinations.destination')}</label>
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
          hls_abr_enabled: false, hls_stream_name: '', variants: [],
        })}
      >
        {availableTypes.map(tItem => (
          <option key={tItem.value} value={tItem.value}>{t(tItem.labelKey, tItem.label)}</option>
        ))}
      </select>

      {/* Auxiliary Hub Quick-Preset Bar (for RTMP and WHIP) */}
      {providers.length > 0 && ['rtmp', 'whip'].includes(config.type) && (
        <div className="bg-brand-lime/5 border border-brand-lime/20 rounded-lg p-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs">⚡</span>
            <span className="text-[10px] font-semibold text-brand-lime truncate">
              {t('destinations.hubPresetTitle', 'Route to Auxiliary Hub')}:
            </span>
          </div>
          <select
            className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded px-2 py-1 text-[10px] font-mono text-[var(--text-primary)] focus:border-brand-lime focus:outline-none"
            value={config.provider_service_id || ''}
            onChange={e => {
              const selectedId = parseInt(e.target.value);
              if (!selectedId) {
                update({ provider_service_id: undefined });
                return;
              }
              const provider = providers.find(p => p.id === selectedId);
              if (!provider) return;

              const cfg = provider.config || {};
              if (config.type === 'rtmp') {
                const port = cfg.rtmp_port || 1935;
                update({ 
                  provider_service_id: selectedId,
                  url: `rtmp://127.0.0.1:${port}/live/stream1` 
                });
              } else if (config.type === 'whip') {
                const port = cfg.webrtc_port || 8889;
                update({ 
                  provider_service_id: selectedId,
                  url: `http://127.0.0.1:${port}/live_stream/whip` 
                });
              }
            }}
          >
            <option value="">{t('destinations.selectHubPreset', '-- Direct / Standalone (No Managed Provider) --')}</option>
            {providers.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.service_type === 'mediamtx_hub' ? 'MediaMTX' : 'Icecast'})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* ── Type-specific fields ── */}

      {(config.type === 'udp' || config.type === 'rtp') && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor={`dest-${config.type}-host`} className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">
                {t('destinations.hostMulticastIp')}<span className="text-red-500 ml-0.5">*</span>
              </label>
              <input
                type="text"
                id={`dest-${config.type}-host`}
                name="host"
                placeholder="e.g. 239.0.0.1 or 127.0.0.1"
                className={`w-full bg-white/5 border rounded-lg p-1.5 text-xs outline-none placeholder-white/20 ${
                  validationErrors?.host ? 'border-red-500/50' : 'border-white/10 focus:border-brand-lime'
                }`}
                value={config.host || ''}
                onChange={e => update({ host: e.target.value })}
              />
              {validationErrors?.host && (
                <p className="text-[9px] text-red-400 mt-0.5">{validationErrors.host}</p>
              )}
            </div>

            <div>
              <label htmlFor={`dest-${config.type}-port`} className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">
                {t('destinations.port')}<span className="text-red-500 ml-0.5">*</span>
              </label>
              <input
                type="text"
                id={`dest-${config.type}-port`}
                name="port"
                placeholder="e.g. 1234"
                className={`w-full bg-white/5 border rounded-lg p-1.5 text-xs outline-none placeholder-white/20 ${
                  validationErrors?.port ? 'border-red-500/50' : 'border-white/10 focus:border-brand-lime'
                }`}
                value={config.port || ''}
                onChange={e => update({ port: e.target.value })}
              />
              {validationErrors?.port && (
                <p className="text-[9px] text-red-400 mt-0.5">{validationErrors.port}</p>
              )}
            </div>
          </div>

          {config.type === 'udp' && (
            <div className="space-y-2 pt-2 border-t border-white/5">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="dest-udp-pkt-size" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">
                    {t('destinations.packetSize')}
                  </label>
                  <select
                    id="dest-udp-pkt-size"
                    name="pkt_size"
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
                    value={config.pkt_size || 1316}
                    onChange={e => update({ pkt_size: Number(e.target.value) })}
                  >
                    <option value={1316}>1316 {t('destinations.standardDvb')}</option>
                    <option value={188}>188 {t('destinations.singlePacket')}</option>
                    <option value={7}>7 {t('destinations.lanJumbo')}</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="dest-udp-muxrate" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">
                    {t('destinations.cbrMuxrate')}
                  </label>
                  <input
                    type="text"
                    id="dest-udp-muxrate"
                    name="muxrate"
                    placeholder="e.g. 10M, 5000k"
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none placeholder-white/20"
                    value={config.muxrate || ''}
                    onChange={e => update({ muxrate: e.target.value })}
                  />
                </div>
              </div>

              {/* DVB / MPEG-TS SI Table Metadata Form */}
              <div className="bg-white/[0.03] border border-white/5 rounded-lg p-2.5 space-y-2">
                <span className="text-[9px] font-bold text-brand-lime uppercase tracking-wider block">
                  {t('destinations.dvbMetadata')}
                </span>
                
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="dest-udp-service-prov" className="text-[9px] text-text-secondary font-bold block mb-0.5">{t('destinations.serviceProvider')}</label>
                    <input
                      type="text"
                      id="dest-udp-service-prov"
                      name="service_provider"
                      placeholder="e.g. Broadcaster TV"
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                      value={config.service_provider || ''} onChange={e => update({ service_provider: e.target.value })}
                    />
                  </div>

                  <div>
                    <label htmlFor="dest-udp-service-name" className="text-[9px] text-text-secondary font-bold block mb-0.5">{t('destinations.serviceName')}</label>
                    <input
                      type="text"
                      id="dest-udp-service-name"
                      name="service_name"
                      placeholder="e.g. Channel 1 HD"
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                      value={config.service_name || ''} onChange={e => update({ service_name: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="dest-udp-ts-id" className="text-[9px] text-text-secondary font-bold block mb-0.5">{t('destinations.transportStreamId')}</label>
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
                    <label htmlFor="dest-udp-net-id" className="text-[9px] text-text-secondary font-bold block mb-0.5">{t('destinations.originalNetworkId')}</label>
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
                    <label htmlFor="dest-udp-service-id" className="text-[9px] text-text-secondary font-bold block mb-0.5">{t('destinations.serviceId')}</label>
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
            </div>
          )}
        </div>
      )}

      {config.type === 'srt' && (() => {
        const mediamtxProviders = providers.filter(p => p.service_type === 'mediamtx_hub');
        const isMediaMtxMode = Boolean(config.mediamtx_mode || config.service_target === 'mediamtx' || config.provider_service_id);
        const selectedProvider = mediamtxProviders.find(p => p.id === config.provider_service_id) || mediamtxProviders[0];
        const mtxCfg = selectedProvider?.config || {};
        const rawPaths = mtxCfg.paths || {};
        const configuredPaths = Object.keys(rawPaths);
        const isCustomPath = !config.path_id || !configuredPaths.includes(config.path_id);

        const handleSelectProvider = (provId: number) => {
          const prov = mediamtxProviders.find(p => p.id === provId);
          if (!prov) return;
          const pCfg = prov.config || {};
          const paths = pCfg.paths || {};
          const pKeys = Object.keys(paths);
          const firstPath = pKeys.length > 0 ? pKeys[0] : (config.path_id || 'stream1');
          const pathConf = paths[firstPath] || {};

          let pubUser = '';
          let pubPass = '';
          if (pathConf.mode === 'custom') {
            pubUser = pathConf.publish_user || '';
            pubPass = pathConf.publish_pass || '';
          } else if (pathConf.mode !== 'open') {
            pubUser = pathConf.publish_user || pCfg.security?.publish_user || pCfg.publish_user || '';
            pubPass = pathConf.publish_pass || pCfg.security?.publish_pass || pCfg.publish_pass || '';
          }

          update({
            provider_service_id: prov.id,
            service_target: 'mediamtx',
            host: '127.0.0.1',
            port: String(pCfg.srt_port || 8890),
            path_id: firstPath,
            publish_user: pubUser,
            publish_pass: pubPass,
            auth_user: pubUser,
            auth_pass: pubPass,
            mode: 'caller',
            stream_action: 'publish',
            mediamtx_mode: true,
          });
        };

        const handleSelectPath = (val: string) => {
          if (val === '__custom__') {
            update({
              path_id: config.path_id && !configuredPaths.includes(config.path_id) ? config.path_id : '',
            });
            return;
          }
          const pathConf = rawPaths[val] || {};
          let pubUser = '';
          let pubPass = '';
          if (pathConf.mode === 'custom') {
            pubUser = pathConf.publish_user || '';
            pubPass = pathConf.publish_pass || '';
          } else if (pathConf.mode !== 'open') {
            pubUser = pathConf.publish_user || mtxCfg.security?.publish_user || mtxCfg.publish_user || '';
            pubPass = pathConf.publish_pass || mtxCfg.security?.publish_pass || mtxCfg.publish_pass || '';
          }

          update({
            path_id: val,
            publish_user: pubUser,
            publish_pass: pubPass,
            auth_user: pubUser,
            auth_pass: pubPass,
          });
        };

        const currentPathConf = rawPaths[config.path_id || ''];
        const authHint = isMediaMtxMode ? (
          currentPathConf?.mode === 'custom'
            ? t('destinations.srtAuthCustomHint', 'Credentials loaded from path-specific rules')
            : currentPathConf?.mode === 'open'
            ? t('destinations.srtAuthOpenHint', 'Open path (no credentials required)')
            : (config.publish_user || config.auth_user || mtxCfg.security?.publish_user)
            ? t('destinations.srtAuthInheritedHint', 'Credentials inherited from MediaMTX global security')
            : null
        ) : null;

        const effectivePubUser = config.publish_user ?? config.auth_user ?? '';
        const effectivePubPass = config.publish_pass ?? config.auth_pass ?? '';
        const streamIdPreview = isMediaMtxMode
          ? `#!::r=${config.path_id || '<path>'},m=publish${effectivePubUser ? `,u=${effectivePubUser}` : ''}${effectivePubPass ? `,p=${effectivePubPass}` : ''}`
          : (config.streamid || '');

        return (
          <div className="space-y-3">
            {/* Connection Mode Switch */}
            <div className="flex bg-[var(--input-bg)] p-0.5 rounded-lg border border-[var(--glass-border)]">
              <button
                type="button"
                className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-md transition-colors ${
                  !isMediaMtxMode
                    ? 'bg-purple-600/30 text-[var(--text-primary)] border border-purple-500/40 shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
                onClick={() => update({
                  mediamtx_mode: false,
                  service_target: undefined,
                  stream_action: undefined,
                  path_id: undefined,
                  provider_service_id: undefined,
                })}
              >
                {t('destinations.srtManualDirect', 'Manual Direct SRT')}
              </button>
              <button
                type="button"
                className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 ${
                  isMediaMtxMode
                    ? 'bg-brand-lime/20 text-brand-lime border border-brand-lime/40 shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
                onClick={() => {
                  const defaultProv = mediamtxProviders.find(p => p.id === config.provider_service_id) || mediamtxProviders[0];
                  if (defaultProv) {
                    handleSelectProvider(defaultProv.id);
                  } else {
                    update({
                      mediamtx_mode: true,
                      mode: 'caller',
                      stream_action: 'publish',
                      service_target: 'mediamtx',
                      host: config.host || '127.0.0.1',
                      port: config.port || '8890',
                      path_id: config.path_id || 'stream1',
                    });
                  }
                }}
              >
                <span>⚡</span>
                {t('destinations.srtMediaMtxHub', 'MediaMTX Hub Integration')}
              </button>
            </div>

            {isMediaMtxMode ? (
              /* MediaMTX Hub Integration Mode */
              <div className="space-y-2.5 bg-brand-lime/5 border border-brand-lime/20 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-brand-lime tracking-wider flex items-center gap-1">
                    <span>⚡</span> {t('destinations.srtMediaMtxHub', 'MediaMTX Hub Integration')}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-lime/10 text-brand-lime font-mono">
                    caller → publish
                  </span>
                </div>

                {mediamtxProviders.length === 0 ? (
                  <div className="bg-amber-500/10 border border-amber-500/20 text-amber-300 p-2 rounded text-xs">
                    {t('destinations.srtNoHubsFound', 'No active MediaMTX Hub services found.')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div>
                      <label htmlFor="dest-srt-hub" className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                        {t('destinations.srtSelectHub', 'Target MediaMTX Hub')}
                      </label>
                      <select
                        id="dest-srt-hub"
                        className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-brand-lime font-mono"
                        value={config.provider_service_id || selectedProvider?.id || ''}
                        onChange={e => handleSelectProvider(parseInt(e.target.value))}
                      >
                        {mediamtxProviders.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name} {p.alias ? `(${p.alias})` : ''} — {p.status}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor="dest-srt-path-select" className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                          {t('destinations.srtTargetPath', 'Stream Path (Channel)')}
                        </label>
                        <select
                          id="dest-srt-path-select"
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-brand-lime font-mono"
                          value={isCustomPath ? '__custom__' : (config.path_id || '')}
                          onChange={e => handleSelectPath(e.target.value)}
                        >
                          {configuredPaths.map(pKey => (
                            <option key={pKey} value={pKey}>
                              /{pKey} {rawPaths[pKey]?.mode ? `(${rawPaths[pKey].mode})` : ''}
                            </option>
                          ))}
                          <option value="__custom__">{t('destinations.srtCustomPath', '✏️ Custom Path Slug...')}</option>
                        </select>
                      </div>

                      {isCustomPath ? (
                        <div>
                          <label htmlFor="dest-srt-path-custom" className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                            {t('destinations.srtCustomPathSlug', 'Custom Path Slug')}
                          </label>
                          <input
                            type="text"
                            id="dest-srt-path-custom"
                            placeholder={t('destinations.srtCustomPathPlaceholder', 'e.g. live, studio_main, tx1')}
                            className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-brand-lime font-mono"
                            value={config.path_id || ''}
                            onChange={e => update({ path_id: e.target.value })}
                          />
                        </div>
                      ) : (
                        <div>
                          <label htmlFor="dest-srt-latency-mtx" className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                            {t('sources.latencyMs', 'Latency (ms)')}
                          </label>
                          <input
                            type="number"
                            id="dest-srt-latency-mtx"
                            min={20}
                            max={8000}
                            placeholder="200"
                            className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-brand-lime"
                            value={config.latency || 200}
                            onChange={e => update({ latency: Number(e.target.value) })}
                          />
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor="dest-srt-host-mtx" className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                          {t('destinations.hostMulticastIp', 'Host')}
                        </label>
                        <input
                          type="text"
                          id="dest-srt-host-mtx"
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-brand-lime"
                          value={config.host || '127.0.0.1'}
                          onChange={e => update({ host: e.target.value })}
                        />
                      </div>
                      <div>
                        <label htmlFor="dest-srt-port-mtx" className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                          {t('destinations.port', 'Port')}
                        </label>
                        <input
                          type="text"
                          id="dest-srt-port-mtx"
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-brand-lime"
                          value={config.port || '8890'}
                          onChange={e => update({ port: e.target.value })}
                        />
                      </div>
                    </div>

                    {/* Publish Credentials */}
                    <div className="pt-1 border-t border-[var(--glass-border)]">
                      <label className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-1">
                        {t('destinations.srtPublishAuth', 'Publish Authentication')}
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <input
                            type="text"
                            placeholder={t('destinations.srtPublishUser', 'Publish Username (u=...)')}
                            className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-brand-lime"
                            value={effectivePubUser}
                            onChange={e => update({ publish_user: e.target.value, auth_user: e.target.value })}
                          />
                        </div>
                        <div>
                          <input
                            type="password"
                            placeholder={t('destinations.srtPublishPass', 'Publish Password (p=...)')}
                            className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-brand-lime"
                            value={effectivePubPass}
                            onChange={e => update({ publish_pass: e.target.value, auth_pass: e.target.value })}
                          />
                        </div>
                      </div>
                      {authHint && (
                        <p className="text-[10px] text-brand-lime/80 mt-1">{authHint}</p>
                      )}
                    </div>

                    {/* Stream ID Preview */}
                    <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2">
                      <span className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                        {t('destinations.srtStreamIdPreview', 'Generated SRT Stream ID & URI')}
                      </span>
                      <p className="text-[11px] font-mono text-brand-lime break-all select-all">
                        srt://{config.host || '127.0.0.1'}:{config.port || '8890'}?mode=caller&latency={config.latency || 200}&streamid={streamIdPreview}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Manual Direct SRT Mode */
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <label htmlFor="dest-srt-mode" className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                      {t('destinations.srtConnectionMode', 'SRT Connection Mode')}
                    </label>
                    <select
                      id="dest-srt-mode"
                      name="mode"
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-purple-400"
                      value={config.mode || 'caller'}
                      onChange={e => {
                        const m = e.target.value;
                        update({ 
                          mode: m, 
                          host: m === 'listener' ? '0.0.0.0' : (config.host === '0.0.0.0' ? '127.0.0.1' : config.host) 
                        });
                      }}
                    >
                      <option value="caller">{t('destinations.callerMode')}</option>
                      <option value="listener">{t('destinations.listenerMode')}</option>
                      <option value="rendezvous">{t('destinations.rendezvousMode')}</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="dest-srt-host" className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                      {config.mode === 'listener' ? t('sources.bindInterfaceHost') : t('destinations.hostMulticastIp')}
                      <span className="text-red-500 ml-0.5">*</span>
                    </label>
                    <input
                      type="text"
                      id="dest-srt-host"
                      name="host"
                      placeholder={config.mode === 'listener' ? "0.0.0.0 (all interfaces)" : "e.g. 52.210.205.135"}
                      className={`w-full bg-[var(--input-bg)] border rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none placeholder-[var(--text-secondary)]/40 ${
                        validationErrors?.host
                          ? 'border-red-500/50 focus:border-red-500 bg-red-500/5'
                          : 'border-[var(--glass-border)] focus:border-purple-400'
                      }`}
                      value={config.host || ''}
                      onChange={e => update({ host: e.target.value })}
                    />
                    {validationErrors?.host && (
                      <span className="text-[10px] text-red-400 block mt-1">{validationErrors.host}</span>
                    )}
                  </div>

                  <div>
                    <label htmlFor="dest-srt-port" className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                      {t('destinations.port')}<span className="text-red-500 ml-0.5">*</span>
                    </label>
                    <input
                      type="text"
                      id="dest-srt-port"
                      name="port"
                      placeholder="9000"
                      className={`w-full bg-[var(--input-bg)] border rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono placeholder-[var(--text-secondary)]/40 ${
                        validationErrors?.port
                          ? 'border-red-500/50 focus:border-red-500 bg-red-500/5'
                          : 'border-[var(--glass-border)] focus:border-purple-400'
                      }`}
                      value={config.port || ''}
                      onChange={e => update({ port: e.target.value })}
                    />
                    {validationErrors?.port && (
                      <span className="text-[10px] text-red-400 block mt-1">{validationErrors.port}</span>
                    )}
                  </div>

                  <div>
                    <label htmlFor="dest-srt-latency" className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                      {t('sources.latencyMs')}
                    </label>
                    <input
                      type="number"
                      id="dest-srt-latency"
                      name="latency"
                      placeholder="200"
                      min={20}
                      max={8000}
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-purple-400"
                      value={config.latency || 200}
                      onChange={e => update({ latency: Number(e.target.value) })}
                    />
                  </div>

                  <div>
                    <label htmlFor="dest-srt-streamid" className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                      {t('sources.streamId')}
                    </label>
                    <input
                      type="text"
                      id="dest-srt-streamid"
                      name="streamid"
                      placeholder="e.g. output_stream_1"
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-purple-400"
                      value={config.streamid || ''}
                      onChange={e => update({ streamid: e.target.value })}
                    />
                  </div>

                  {/* Passphrase & Keylen */}
                  <div>
                    <label htmlFor="dest-srt-passphrase" className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                      {t('destinations.srtPassphrase', 'Passphrase (Secret Key)')}
                    </label>
                    <input
                      type="password"
                      id="dest-srt-passphrase"
                      name="passphrase"
                      placeholder={t('destinations.srtPassphrasePlaceholder', 'Enter passphrase (optional)...')}
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-purple-400"
                      value={config.passphrase || ''}
                      onChange={e => update({ passphrase: e.target.value })}
                    />
                  </div>

                  <div>
                    <label htmlFor="dest-srt-pbkeylen" className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                      {t('destinations.srtPbkeylen', 'Key Length (pbkeylen)')}
                    </label>
                    <select
                      id="dest-srt-pbkeylen"
                      name="pbkeylen"
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-purple-400"
                      value={config.pbkeylen || ''}
                      onChange={e => update({ pbkeylen: e.target.value ? Number(e.target.value) : undefined })}
                    >
                      <option value="">{t('destinations.srtPbkeylenDefault', 'Auto / Default')}</option>
                      <option value="16">16 bytes (AES-128)</option>
                      <option value="24">24 bytes (AES-192)</option>
                      <option value="32">32 bytes (AES-256)</option>
                    </select>
                  </div>
                </div>

                <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-2 text-[10px] text-purple-300">
                  {config.mode === 'caller' ? (
                    <span>
                      <strong>Caller Mode:</strong> {t('destinations.callerDesc')} ({config.host || 'Host'}:{config.port || 'Port'})
                    </span>
                  ) : config.mode === 'listener' ? (
                    <span>
                      <strong>Listener Mode:</strong> {t('destinations.listenerDesc')} (Port: {config.port || '9000'})
                    </span>
                  ) : (
                    <span>
                      <strong>Rendezvous Mode:</strong> {t('destinations.rendezvousDesc')}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {config.type === 'rtmp' && (
        <div className="space-y-1.5">
          <label htmlFor="dest-rtmp-url" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">
            {t('destinations.streamUrl')}<span className="text-red-500 ml-0.5">*</span>
          </label>
          <input
            type="text"
            id="dest-rtmp-url"
            name="url"
            placeholder="RTMP URL (rtmp://server/live/key)"
            className={`w-full bg-white/5 border rounded-lg p-1.5 text-xs outline-none placeholder-white/20 ${
              validationErrors?.url
                ? 'border-red-500/50 focus:border-red-500 bg-red-500/5'
                : 'border-white/10'
            }`}
            value={config.url || ''} onChange={e => update({ url: e.target.value })}
          />
          {validationErrors?.url && (
            <span className="text-[10px] text-red-400 block mt-1">{validationErrors.url}</span>
          )}
        </div>
      )}

      {config.type === 'ndi' && (
        <div className="space-y-2">
          {!avahiAvailable && (
            <div className="bg-brand-orange/10 border border-brand-orange/20 text-brand-orange text-xs p-2.5 rounded-lg leading-relaxed font-bold mb-2 flex flex-col gap-1">
              <div>{t('destinations.ndiAvahiWarning')}</div>
              <div>{t('destinations.ndiAvahiCommandHint')}</div>
            </div>
          )}
          <div>
            <label htmlFor="dest-ndi-path" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">
              {t('destinations.ndiStreamName')}<span className="text-red-500 ml-0.5">*</span>
            </label>
            <input
              type="text"
              id="dest-ndi-path"
              name="path"
              placeholder="e.g. MY-ENCODER-OUT"
              className={`w-full bg-white/5 border rounded-lg p-1.5 text-xs outline-none font-mono placeholder-white/20 ${
                validationErrors?.path
                  ? 'border-red-500/50 focus:border-red-500 bg-red-500/5'
                  : 'border-white/10'
              }`}
              value={config.path || ''} onChange={e => update({ path: e.target.value })}
            />
            {validationErrors?.path && (
              <span className="text-[10px] text-red-400 block mt-1">{validationErrors.path}</span>
            )}
          </div>
          <div className="p-2 bg-purple-500/10 border border-purple-500/20 rounded-lg text-[10px] text-purple-300 space-y-0.5">
            <div className="flex items-center gap-1 font-bold">
              <span>{t('destinations.ndiSpecsLocked')}</span>
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
              {t('destinations.decklinkNotice')}
            </div>
          </div>
          <div>
            <label htmlFor="dest-decklink-device" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">
              {t('destinations.deviceNameIndex')}<span className="text-red-500 ml-0.5">*</span>
            </label>
            {loadingDevices ? (
              <div className="text-[10px] text-text-secondary animate-pulse">{t('sources.loadingDevices')}</div>
            ) : devices.length === 0 ? (
              <div className="space-y-1.5">
                <div className="text-[10px] text-amber-500 font-medium">{t('destinations.noDecklinkOutputs')}</div>
                <input
                  type="text"
                  id="dest-decklink-device"
                  name="device"
                  placeholder="Device Name (e.g. DeckLink Mini Monitor)"
                  className={`w-full bg-white/5 border rounded-lg p-1.5 text-xs outline-none placeholder-white/20 ${
                    validationErrors?.device
                      ? 'border-red-500/50 focus:border-red-500 bg-red-500/5'
                      : 'border-white/10'
                  }`}
                  value={config.device || ''}
                  onChange={e => update({ device: e.target.value })}
                />
                {validationErrors?.device && (
                  <span className="text-[10px] text-red-400 block mt-1">{validationErrors.device}</span>
                )}
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex gap-1.5">
                  {!manualDeviceMode ? (
                    <select
                      id="dest-decklink-device"
                      name="device"
                      className={`w-full bg-white/5 border rounded-lg p-1.5 text-xs outline-none ${
                        validationErrors?.device
                          ? 'border-red-500/50 focus:border-red-500 bg-red-500/5'
                          : 'border-white/10'
                      }`}
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
                      <option value="">{t('sources.selectDevice')}</option>
                      {devices.map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                      <option value="__manual__">{t('sources.manualInput')}</option>
                    </select>
                  ) : (
                    <div className="flex w-full gap-1.5">
                      <input
                        type="text"
                        id="dest-decklink-device"
                        name="device"
                        placeholder="Device Name"
                        className={`w-full bg-white/5 border rounded-lg p-1.5 text-xs outline-none placeholder-white/20 ${
                          validationErrors?.device
                            ? 'border-red-500/50 focus:border-red-500 bg-red-500/5'
                            : 'border-white/10'
                        }`}
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
                        {t('common.list')}
                      </button>
                    </div>
                  )}
                </div>
                {validationErrors?.device && (
                  <span className="text-[10px] text-red-400 block mt-1">{validationErrors.device}</span>
                )}
              </div>
            )}
          </div>

          <div>
            <label htmlFor="dest-decklink-format-code" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">{t('destinations.outputFormatCode')}</label>
            {manualDeviceMode ? (
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  id="dest-decklink-format-code"
                  name="format_code"
                  placeholder="Format (e.g. Hp25)"
                  className="col-span-1 bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                  value={config.format_code || ''}
                  onChange={e => update({ format_code: e.target.value })}
                />
                <input
                  type="text"
                  id="dest-decklink-video-size"
                  name="video_size"
                  placeholder="Resolution (e.g. 1920x1080)"
                  className="col-span-1 bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                  value={config.video_size || ''}
                  onChange={e => update({ video_size: e.target.value })}
                />
                <input
                  type="text"
                  id="dest-decklink-framerate"
                  name="framerate"
                  placeholder="FPS (e.g. 25)"
                  className="col-span-1 bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                  value={config.framerate || ''}
                  onChange={e => update({ framerate: e.target.value })}
                />
              </div>
            ) : loadingFormats ? (
              <div className="text-[10px] text-text-secondary animate-pulse">{t('sources.loadingFormats')}</div>
            ) : formats.length === 0 ? (
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  id="dest-decklink-format-code"
                  name="format_code"
                  placeholder="Format (e.g. Hp25)"
                  className="col-span-1 bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                  value={config.format_code || ''}
                  onChange={e => update({ format_code: e.target.value })}
                />
                <input
                  type="text"
                  id="dest-decklink-video-size"
                  name="video_size"
                  placeholder="Resolution (e.g. 1920x1080)"
                  className="col-span-1 bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                  value={config.video_size || ''}
                  onChange={e => update({ video_size: e.target.value })}
                />
                <input
                  type="text"
                  id="dest-decklink-framerate"
                  name="framerate"
                  placeholder="FPS (e.g. 25)"
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
                  <option value="">{t('sources.defaultAutoSdk')}</option>
                  {formats.map(f => (
                    <option key={f.code} value={f.code}>
                      {f.code} ({f.description})
                    </option>
                  ))}
                </select>
                
                {config.format_code && (
                  <div className="flex gap-4 px-1 text-[10px] text-text-secondary font-mono">
                    <div>{t('destinations.forcedResolution')} <span className="text-purple-300">{config.video_size || 'Auto'}</span></div>
                    <div>{t('destinations.forcedFramerate')} <span className="text-purple-300">{config.framerate || 'Auto'}</span></div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {config.type === 'file' && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label htmlFor="dest-file-storage" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">
                {t('destinations.mediaStorage')}<span className="text-red-500 ml-0.5">*</span>
              </label>
              <select
                id="dest-file-storage"
                name="storage_id"
                className={`w-full bg-white/5 border rounded-lg p-1.5 text-xs outline-none focus:border-purple-400 ${
                  validationErrors?.storage_id || validationErrors?.path
                    ? 'border-red-500/50 focus:border-red-500 bg-red-500/5'
                    : 'border-white/10'
                }`}
                value={config.storage_id || ''}
                onChange={e => update({ storage_id: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">{t('sources.selectStorage')}</option>
                {storages.filter((s: any) => s.type === 'media').map((s: any) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.path})</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="dest-file-relative-path" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">
                {t('destinations.relativePathFilename')}<span className="text-red-500 ml-0.5">*</span>
              </label>
              <input
                type="text"
                id="dest-file-relative-path"
                name="relative_path"
                placeholder="e.g. movies/clip.mp4"
                className={`w-full bg-white/5 border rounded-lg p-1.5 text-xs outline-none placeholder-white/20 focus:border-purple-400 ${
                  validationErrors?.relative_path || validationErrors?.path
                    ? 'border-red-500/50 focus:border-red-500 bg-red-500/5'
                    : validationWarnings?.path
                      ? 'border-amber-500/50 focus:border-amber-500 bg-amber-500/5'
                      : 'border-white/10'
                }`}
                value={config.relative_path || ''}
                onChange={e => update({ relative_path: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="dest-file-container" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">
                {t('destinations.container')}
              </label>
              <select
                id="dest-file-container"
                name="container"
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none focus:border-purple-400"
                value={config.container || 'mp4'}
                onChange={e => update({ container: e.target.value })}
              >
                {CONTAINERS.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>
          {(validationErrors?.storage_id || validationErrors?.relative_path || validationErrors?.path) && (
            <span className="text-[10px] text-red-400 block mt-1">
              {validationErrors.storage_id || validationErrors.relative_path || validationErrors.path}
            </span>
          )}
          {validationWarnings?.path && !(validationErrors?.storage_id || validationErrors?.relative_path || validationErrors?.path) && (
            <span className="text-[10px] text-amber-400 block mt-1">{validationWarnings.path}</span>
          )}
        </div>
      )}

      {config.type === 'icecast' && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="dest-icecast-host" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">
              {t('destinations.serverUrl')}<span className="text-red-500 ml-0.5">*</span>
            </label>
            <input
              type="text"
              id="dest-icecast-host"
              name="host"
              placeholder="Icecast Host"
              className={`w-full bg-white/5 border rounded-lg p-1.5 text-xs outline-none placeholder-white/20 ${
                validationErrors?.host
                  ? 'border-red-500/50 focus:border-red-500 bg-red-500/5'
                  : 'border-white/10'
              }`}
              value={config.host || ''} onChange={e => update({ host: e.target.value })}
            />
            {validationErrors?.host && (
              <span className="text-[10px] text-red-400 block mt-1">{validationErrors.host}</span>
            )}
          </div>
          <div>
            <label htmlFor="dest-icecast-port" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">
              {t('destinations.port')}
            </label>
            <input
              type="text"
              id="dest-icecast-port"
              name="port"
              placeholder="Port (default: 8000)"
              className={`w-full bg-white/5 border rounded-lg p-1.5 text-xs outline-none placeholder-white/20 ${
                validationErrors?.port
                  ? 'border-red-500/50 focus:border-red-500 bg-red-500/5'
                  : 'border-white/10'
              }`}
              value={config.port || ''} onChange={e => update({ port: e.target.value })}
            />
            {validationErrors?.port && (
              <span className="text-[10px] text-red-400 block mt-1">{validationErrors.port}</span>
            )}
          </div>
          <div>
            <label htmlFor="dest-icecast-mount" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">
              {t('destinations.mountpointUrl')}<span className="text-red-500 ml-0.5">*</span>
            </label>
            <input
              type="text"
              id="dest-icecast-mount"
              name="icecast_mount"
              placeholder="Mount point (e.g. /live)"
              className={`w-full bg-white/5 border rounded-lg p-1.5 text-xs outline-none placeholder-white/20 ${
                validationErrors?.icecast_mount
                  ? 'border-red-500/50 focus:border-red-500 bg-red-500/5'
                  : 'border-white/10'
              }`}
              value={config.icecast_mount || ''} onChange={e => update({ icecast_mount: e.target.value })}
            />
            {validationErrors?.icecast_mount && (
              <span className="text-[10px] text-red-400 block mt-1">{validationErrors.icecast_mount}</span>
            )}
          </div>
          <div>
            <label htmlFor="dest-icecast-password" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">
              {t('destinations.sourcePassword')}
            </label>
            <input
              type="password"
              id="dest-icecast-password"
              name="icecast_password"
              placeholder="Source password"
              className={`w-full bg-white/5 border rounded-lg p-1.5 text-xs outline-none placeholder-white/20 ${
                validationErrors?.icecast_password
                  ? 'border-red-500/50 focus:border-red-500 bg-red-500/5'
                  : 'border-white/10'
              }`}
              value={config.icecast_password || ''} onChange={e => update({ icecast_password: e.target.value })}
            />
            {validationErrors?.icecast_password && (
              <span className="text-[10px] text-red-400 block mt-1">{validationErrors.icecast_password}</span>
            )}
          </div>
        </div>
      )}

      {config.type === 'hls' && (
        <div className="space-y-2">
          {storages.filter((s: any) => s.type === 'hls').length === 0 && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-200 p-2.5 rounded-lg text-xs leading-relaxed font-bold mb-2">
              {t('destinations.hlsNoStorageWarning')}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="dest-hls-method" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">{t('destinations.hlsIngestMethod')}</label>
              <select
                id="dest-hls-method"
                name="hls_method"
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none focus:border-purple-400"
                value={config.hls_method || 'local'}
                onChange={e => update({ hls_method: e.target.value })}
              >
                <option value="local">{t('destinations.localDir')}</option>
                <option value="PUT">{t('destinations.httpPutUpload')}</option>
                <option value="POST">{t('destinations.httpPostUpload')}</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label htmlFor="dest-hls-time" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">{t('destinations.segmentSeconds')}</label>
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
                <label htmlFor="dest-hls-list-size" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">{t('destinations.listSize')}</label>
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

          {config.hls_method === 'local' ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="dest-hls-storage" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">
                  {t('destinations.hlsStorage')}<span className="text-red-500 ml-0.5">*</span>
                </label>
                <select
                  id="dest-hls-storage"
                  name="storage_id"
                  className={`w-full bg-white/5 border rounded-lg p-1.5 text-xs outline-none focus:border-purple-400 ${
                    validationErrors?.storage_id || validationErrors?.path
                      ? 'border-red-500/50 focus:border-red-500 bg-red-500/5'
                      : 'border-white/10'
                  }`}
                  value={config.storage_id || ''}
                  onChange={e => update({ storage_id: e.target.value ? Number(e.target.value) : null })}
                  disabled={storages.filter((s: any) => s.type === 'hls').length === 0}
                >
                  <option value="">{t('sources.selectStorage')}</option>
                  {storages.filter((s: any) => s.type === 'hls').map((s: any) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.path})</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="dest-hls-relative-path" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">
                  {t('destinations.relativePathDir')}<span className="text-red-500 ml-0.5">*</span>
                </label>
                <input
                  type="text"
                  id="dest-hls-relative-path"
                  name="relative_path"
                  placeholder="e.g. live/stream"
                  className={`w-full bg-white/5 border rounded-lg p-1.5 text-xs outline-none placeholder-white/20 focus:border-purple-400 ${
                    validationErrors?.relative_path || validationErrors?.path
                      ? 'border-red-500/50 focus:border-red-500 bg-red-500/5'
                      : validationWarnings?.path
                        ? 'border-amber-500/50 focus:border-amber-500 bg-amber-500/5'
                        : 'border-white/10'
                  }`}
                  value={config.relative_path || ''}
                  onChange={e => update({ relative_path: e.target.value })}
                  disabled={storages.filter((s: any) => s.type === 'hls').length === 0}
                />
              </div>
              {(validationErrors?.storage_id || validationErrors?.relative_path || validationErrors?.path) && (
                <div className="col-span-2">
                  <span className="text-[10px] text-red-400 block mt-1">
                    {validationErrors.storage_id || validationErrors.relative_path || validationErrors.path}
                  </span>
                </div>
              )}
              {validationWarnings?.path && !(validationErrors?.storage_id || validationErrors?.relative_path || validationErrors?.path) && (
                <div className="col-span-2">
                  <span className="text-[10px] text-amber-400 block mt-1">{validationWarnings.path}</span>
                </div>
              )}
            </div>
          ) : (
            <div>
              <label htmlFor="dest-hls-path" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">
                {t('destinations.serverIngestUrl')}<span className="text-red-500 ml-0.5">*</span>
              </label>
              <input
                type="text"
                id="dest-hls-path"
                name="path"
                placeholder="e.g. http://ingest.server/live/"
                className={`w-full bg-white/5 border rounded-lg p-1.5 text-xs outline-none placeholder-white/20 focus:border-purple-400 ${
                  validationErrors?.path
                    ? 'border-red-500/50 focus:border-red-500 bg-red-500/5'
                    : 'border-white/10'
                }`}
                value={config.path || ''}
                onChange={e => update({ path: e.target.value })}
              />
              {validationErrors?.path && (
                <span className="text-[10px] text-red-400 block mt-1">{validationErrors.path}</span>
              )}
            </div>
          )}

          <div>
            <label htmlFor="dest-hls-stream-name" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">
              {t('destinations.ndiStreamName')}<span className="text-red-500 ml-0.5">*</span>
            </label>
            <input
              type="text"
              id="dest-hls-stream-name"
              name="hls_stream_name"
              placeholder="e.g. stream"
              className={`w-full bg-white/5 border rounded-lg p-1.5 text-xs outline-none placeholder-white/20 ${
                validationErrors?.hls_stream_name
                  ? 'border-red-500/50 focus:border-red-500 bg-red-500/5'
                  : 'border-white/10'
              }`}
              value={config.hls_stream_name ?? 'stream'}
              onChange={e => update({ hls_stream_name: e.target.value.replace(/\.m3u8$/, '') })}
              required
            />
            <span className="text-[10px] text-white/40 block mt-0.5">
              {t('destinations.hlsExtensionNote')}
            </span>
            {validationErrors?.hls_stream_name && (
              <span className="text-[10px] text-red-400 block mt-1">{validationErrors.hls_stream_name}</span>
            )}
          </div>

          <div className="flex items-center gap-2 p-1.5 bg-white/5 rounded-lg border border-white/5">
            <input
              type="checkbox"
              id="hls-abr-enabled-chk"
              name="hls_abr_enabled"
              className="w-3.5 h-3.5 accent-purple-400"
              checked={config.hls_abr_enabled ?? false}
              onChange={e => {
                const checked = e.target.checked;
                update({
                  hls_abr_enabled: checked,
                  variants: checked ? (config.variants || []) : [],
                });
              }}
            />
            <label htmlFor="hls-abr-enabled-chk" className="text-xs font-medium cursor-pointer">
              {t('destinations.enableAbr')}
            </label>
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
                {t('destinations.deleteExpiredSegments')}
              </label>
            </div>
          )}

          {(config.hls_method === 'PUT' || config.hls_method === 'POST') && (
            <div>
              <label htmlFor="dest-hls-headers" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">{t('destinations.customHttpHeaders')}</label>
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

          {config.hls_abr_enabled && (
            <HlsVariantsForm
              variants={config.variants || []}
              onChange={variants => update({ variants })}
            />
          )}
        </div>
      )}

      {config.type === 'whip' && (
        <div className="space-y-1.5 animate-in fade-in duration-200">
          <label htmlFor="dest-whip-url" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">
            {t('destinations.whipIngestUrl')}<span className="text-red-500 ml-0.5">*</span>
          </label>
          <input
            type="text"
            id="dest-whip-url"
            name="url"
            placeholder="WHIP Ingestion URL (e.g. http://mediamtx:8889/mystream/whip)"
            className={`w-full bg-white/5 border rounded-lg p-1.5 text-xs outline-none font-mono placeholder-white/20 ${
              validationErrors?.url
                ? 'border-red-500/50 focus:border-red-500 bg-red-500/5'
                : 'border-white/10'
            }`}
            value={config.url || ''}
            onChange={e => update({ url: e.target.value })}
          />
          {validationErrors?.url && (
            <span className="text-[10px] text-red-400 block mt-1">{validationErrors.url}</span>
          )}
        </div>
      )}

      {config.type === 'alsa' && (
        <div className="space-y-1.5 animate-in fade-in duration-200">
          <label htmlFor="dest-alsa-device" className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">
            {t('destinations.alsaPlayoutDevice')}<span className="text-red-500 ml-0.5">*</span>
          </label>
          {loadingAlsaDevices ? (
            <div className="text-[10px] text-text-secondary animate-pulse">{t('sources.loadingAlsa')}</div>
          ) : alsaDevices.length === 0 ? (
            <div className="space-y-1.5">
              <div className="text-[10px] text-amber-500 font-medium">{t('destinations.noAlsaPlaybackDetected')}</div>
              <input
                type="text"
                id="dest-alsa-device"
                name="device"
                placeholder="default, hw:0,0, sysdefault"
                className={`w-full bg-white/5 border rounded-lg p-1.5 text-xs outline-none font-mono placeholder-white/20 ${
                  validationErrors?.device ? 'border-red-500/50 focus:border-red-500 bg-red-500/5' : 'border-white/10'
                }`}
                value={config.device || ''}
                onChange={e => update({ device: e.target.value })}
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              {!manualAlsaMode ? (
                <select
                  id="dest-alsa-device"
                  name="device"
                  className={`w-full bg-white/5 border rounded-lg p-1.5 text-xs outline-none focus:border-purple-400 transition-all ${
                    validationErrors?.device ? 'border-red-500/50 bg-red-500/5' : 'border-white/10'
                  }`}
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
                  <option value="default">{t('destinations.defaultDevice')}</option>
                  {alsaDevices.map(d => (
                    <option key={d.device} value={d.device}>{d.name} ({d.device})</option>
                  ))}
                  <option value="__manual__">{t('sources.manualInput')}</option>
                </select>
              ) : (
                <div className="flex flex-col w-full gap-1.5">
                  <div className="flex w-full gap-1.5">
                    <input
                      type="text"
                      id="dest-alsa-device"
                      name="device"
                      placeholder="default, hw:0,0"
                      className={`w-full bg-white/5 border rounded-lg p-1.5 text-xs outline-none font-mono placeholder-white/20 ${
                        validationErrors?.device ? 'border-red-500/50 focus:border-red-500 bg-red-500/5' : 'border-white/10'
                      }`}
                      value={config.device || ''}
                      onChange={e => update({ device: e.target.value })}
                    />
                    <button
                      type="button"
                      className="px-2.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs transition-colors shrink-0"
                      onClick={() => {
                        setManualAlsaMode(false);
                        update({ device: 'default' });
                      }}
                    >
                      {t('common.list')}
                    </button>
                  </div>
                </div>
              )}
              {validationErrors?.device && (
                <span className="text-[10px] text-red-400 block mt-1">{validationErrors.device}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Recommended Broadcast Recipe Card ── */}
      {renderBroadcastRecipe(config.type, t)}
    </div>
  );
};

const renderBroadcastRecipe = (type: string, t: any) => {
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
    alsa: {
      title: "ALSA Audio Playout (Dispositivo de Sonido)",
      video: "Ninguno (Solo Audio)",
      audio: "PCM (16/24-bit)",
      container: "Dispositivo de audio ALSA",
      details: "Salida directa hacia dispositivos de hardware Linux/ALSA (por ejemplo, tarjetas de sonido analógicas, digitales o interfaces virtuales)."
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
        <span>{t('destinations.recommendedRecipe')}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-text-secondary">
        <div>
          <span className="font-bold block text-[9px] uppercase tracking-wider text-text-secondary">{t('destinations.videoCodec')}</span>
          <span className="text-[var(--text-primary)] font-mono">{recipe.video}</span>
        </div>
        <div>
          <span className="font-bold block text-[9px] uppercase tracking-wider text-text-secondary">{t('destinations.audioCodec')}</span>
          <span className="text-[var(--text-primary)] font-mono">{recipe.audio}</span>
        </div>
        <div className="col-span-2">
          <span className="font-bold block text-[9px] uppercase tracking-wider text-text-secondary">{t('destinations.containerMuxer')}</span>
          <span className="text-[var(--text-primary)] font-mono">{recipe.container}</span>
        </div>
      </div>
      <div className="text-[10px] text-text-secondary border-t border-[var(--glass-border)] pt-1.5 leading-relaxed">
        {recipe.details}
      </div>
    </div>
  );
};

export default React.memo(DestinationPanel);
