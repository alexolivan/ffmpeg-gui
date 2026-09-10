import React from 'react';
import { useTranslation } from 'react-i18next';
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
  mediamtx_target_type?: 'local' | 'remote' | 'managed' | 'external';
  peer_node_id?: number | null;
  peer_service_id?: number | null;
  icecast_mode?: boolean;
  icecast_mount?: string;
  icecast_target_type?: 'local' | 'remote' | 'managed' | 'external';
  tls?: boolean;
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
  ffmpegBuildId?: number | null;
  idPrefix?: string;
  storages?: any[];
}

const ALL_SOURCE_TYPES = [
  { value: 'file', labelKey: 'sources.types.file', label: 'Local File / VOD' },
  { value: 'srt', labelKey: 'sources.types.srt', label: 'SRT Stream' },
  { value: 'ndi', labelKey: 'sources.types.ndi', label: 'NDI Source' },
  { value: 'udp', labelKey: 'sources.types.udp', label: 'UDP / MPEG-TS' },
  { value: 'rtp', labelKey: 'sources.types.rtp', label: 'RTP Stream' },
  { value: 'decklink', labelKey: 'sources.types.decklink', label: 'Blackmagic Decklink' },
  { value: 'alsa', labelKey: 'sources.types.alsa', label: 'ALSA Audio Device' },
  { value: 'v4l2', labelKey: 'sources.types.v4l2', label: 'Video4Linux2 (USB/Magewell)' },
  { value: 'lavfi_video', labelKey: 'sources.types.lavfi_video', label: 'Internal Generator (Video)' },
  { value: 'lavfi_audio', labelKey: 'sources.types.lavfi_audio', label: 'Internal Generator (Audio)' },
  { value: 'http_audio', labelKey: 'sources.types.http_audio', label: 'HTTP Audio Stream (Icecast/Shoutcast)' },
  { value: 'rtmp', labelKey: 'sources.types.rtmp', label: 'RTMP Stream' },
  { value: 'hls', labelKey: 'sources.types.hls', label: 'HLS Stream' },
];

const deviceCache: {
  decklinkDevices: string[] | null;
  decklinkFormats: Record<string, any[]>;
  v4l2Devices: any[] | null;
  v4l2Formats: Record<string, any[]>;
  alsaDevices: any[] | null;
} = {
  decklinkDevices: null,
  decklinkFormats: {},
  v4l2Devices: null,
  v4l2Formats: {},
  alsaDevices: null,
};

const InputSourcePanel: React.FC<InputSourcePanelProps> = ({
  label,
  accentColor,
  config,
  allowedTypes,
  onChange,
  systemCapabilities,
  onSyncAlsaAudio,
  ffmpegBuildId,
  idPrefix = 'input',
  storages = [],
}) => {
  const { t } = useTranslation();
  const decklinkAvailable = systemCapabilities?.decklink?.available ?? true;
  const avahiAvailable = systemCapabilities?.avahi?.available ?? true;

  let filteredSourceTypes = ALL_SOURCE_TYPES;
  if (!decklinkAvailable) {
    filteredSourceTypes = filteredSourceTypes.filter(t => t.value !== 'decklink');
  }

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
  const [scanResult, setScanResult] = React.useState<{ success: boolean; count: number; error?: string } | null>(null);

  const displayedNdiSources = React.useMemo(() => {
    const list = [...ndiSources];
    if (config.name && config.type === 'ndi' && !list.includes(config.name) && config.name !== '__manual__') {
      list.unshift(config.name);
    }
    return list;
  }, [ndiSources, config.name, config.type]);

  const scanNdi = async () => {
    setScanningNdi(true);
    setScanResult(null);
    try {
      const buildParam = ffmpegBuildId ? `?build_id=${ffmpegBuildId}` : '';
      const res = await fetch(`/ndi/sources${buildParam}`);
      if (res.ok) {
        const data = await res.json();
        const sourcesList = data.sources || [];
        setNdiSources(sourcesList);
        setScanResult({ success: true, count: sourcesList.length });
      } else {
        setScanResult({ success: false, count: 0, error: "Failed to scan" });
      }
    } catch (err) {
      console.error("Failed to scan NDI sources", err);
      setScanResult({ success: false, count: 0, error: String(err) });
    } finally {
      setScanningNdi(false);
    }
  };

  React.useEffect(() => {
    if (config.type !== 'decklink') return;
    let active = true;

    if (deviceCache.decklinkDevices !== null) {
      setDevices(deviceCache.decklinkDevices);
      if (deviceCache.decklinkDevices.length > 0) {
        const found = deviceCache.decklinkDevices.includes(config.device || '');
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
        const inputs = data.inputs || [];
        deviceCache.decklinkDevices = inputs;
        if (active) {
          setDevices(inputs);
          if (inputs.length > 0) {
            const found = inputs.includes(config.device || '');
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

    const cacheKey = config.device;
    if (deviceCache.decklinkFormats[cacheKey] !== undefined) {
      setFormats(deviceCache.decklinkFormats[cacheKey]);
      return;
    }

    const fetchFormats = async () => {
      setLoadingFormats(true);
      try {
        const res = await fetch(`/decklink/formats?device=${encodeURIComponent(config.device || '')}`);
        if (!res.ok) throw new Error("Failed to fetch formats");
        const data = await res.json();
        const formatsList = data || [];
        deviceCache.decklinkFormats[cacheKey] = formatsList;
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

  // Fetch V4L2 devices
  React.useEffect(() => {
    if (config.type !== 'v4l2') return;
    let active = true;

    if (deviceCache.v4l2Devices !== null) {
      setV4l2Devices(deviceCache.v4l2Devices);
      if (deviceCache.v4l2Devices.length > 0) {
        const found = deviceCache.v4l2Devices.some((d: any) => d.device === config.device);
        if (!found && config.device) {
          setManualV4l2Mode(true);
        }
      }
      return;
    }

    const fetchV4l2 = async () => {
      setLoadingV4l2Devices(true);
      try {
        const res = await fetch('/v4l2/devices');
        if (!res.ok) throw new Error("Failed to fetch V4L2 devices");
        const data = await res.json();
        const devicesList = data || [];
        deviceCache.v4l2Devices = devicesList;
        if (active) {
          setV4l2Devices(devicesList);
          if (devicesList.length > 0) {
            const found = devicesList.some((d: any) => d.device === config.device);
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

    const cacheKey = config.device;
    if (deviceCache.v4l2Formats[cacheKey] !== undefined) {
      setV4l2Formats(deviceCache.v4l2Formats[cacheKey]);
      return;
    }

    const fetchV4l2Formats = async () => {
      setLoadingV4l2Formats(true);
      try {
        const res = await fetch(`/v4l2/formats?device=${encodeURIComponent(config.device || '')}`);
        if (!res.ok) throw new Error("Failed to fetch V4L2 formats");
        const data = await res.json();
        const formatsList = data || [];
        deviceCache.v4l2Formats[cacheKey] = formatsList;
        if (active) {
          setV4l2Formats(formatsList);
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

    if (deviceCache.alsaDevices !== null) {
      setAlsaDevices(deviceCache.alsaDevices);
      if (deviceCache.alsaDevices.length > 0) {
        const found = deviceCache.alsaDevices.some((d: any) => d.device === config.device);
        if (!found && config.device) {
          setManualAlsaMode(true);
        }
      }
      return;
    }

    const fetchAlsa = async () => {
      setLoadingAlsaDevices(true);
      try {
        const res = await fetch('/alsa/devices');
        if (!res.ok) throw new Error("Failed to fetch ALSA devices");
        const data = await res.json();
        const devicesList = data || [];
        deviceCache.alsaDevices = devicesList;
        if (active) {
          setAlsaDevices(devicesList);
          if (devicesList.length > 0) {
            const found = devicesList.some((d: any) => d.device === config.device);
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

  const [providers, setProviders] = React.useState<any[]>([]);
  const [remotePeers, setRemotePeers] = React.useState<any[]>([]);

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

    fetch('/api/peers/remote-nodes')
      .then(res => res.ok ? res.json() : [])
      .then(data => {
        if (active) setRemotePeers(data || []);
      })
      .catch(() => {
        if (active) setRemotePeers([]);
      });

    return () => { active = false; };
  }, []);

  // Deterministic self-healing port & provider reconciliation
  React.useEffect(() => {
    if (!providers || providers.length === 0) return;
    const mediamtxProviders = providers.filter(p => p.service_type === 'mediamtx_hub');
    const icecastProviders = providers.filter(p => p.service_type === 'icecast_server');

    if (config.type === 'srt' && (config.mediamtx_mode || config.service_target === 'mediamtx')) {
      if (!config.peer_node_id && config.mediamtx_target_type !== 'remote' && config.mediamtx_target_type !== 'external' && mediamtxProviders.length > 0) {
        const prov = mediamtxProviders.find(p => p.id === config.provider_service_id) || mediamtxProviders[0];
        if (prov) {
          const pCfg = prov.config || {};
          const expectedPort = String(pCfg.srt_port || 8890);
          if (config.port !== expectedPort || config.provider_service_id !== prov.id) {
            update({
              provider_service_id: prov.id,
              port: expectedPort,
              host: config.host || '127.0.0.1',
            });
          }
        }
      }
    } else if (config.type === 'rtmp' && (config.mediamtx_mode || config.service_target === 'mediamtx')) {
      if (!config.peer_node_id && config.mediamtx_target_type !== 'remote' && config.mediamtx_target_type !== 'external' && mediamtxProviders.length > 0) {
        const prov = mediamtxProviders.find(p => p.id === config.provider_service_id) || mediamtxProviders[0];
        if (prov) {
          const pCfg = prov.config || {};
          const isTls = Boolean(config.tls && pCfg.ssl_enabled && pCfg.rtmps_enabled);
          const expectedPort = String(isTls ? (pCfg.rtmps_port || 1936) : (pCfg.rtmp_port || 1935));
          if (config.port !== expectedPort || config.provider_service_id !== prov.id) {
            update({
              provider_service_id: prov.id,
              port: expectedPort,
              host: config.host || '127.0.0.1',
            });
          }
        }
      }
    } else if (config.type === 'hls' && (config.mediamtx_mode || config.service_target === 'mediamtx')) {
      if (!config.peer_node_id && config.mediamtx_target_type !== 'remote' && config.mediamtx_target_type !== 'external' && mediamtxProviders.length > 0) {
        const prov = mediamtxProviders.find(p => p.id === config.provider_service_id) || mediamtxProviders[0];
        if (prov) {
          const pCfg = prov.config || {};
          const expectedPort = String(pCfg.hls_port || 8888);
          if (config.port !== expectedPort || config.provider_service_id !== prov.id) {
            update({
              provider_service_id: prov.id,
              port: expectedPort,
              host: config.host || '127.0.0.1',
            });
          }
        }
      }
    } else if (config.type === 'http_audio' && (config.icecast_mode || config.service_target === 'icecast')) {
      if (!config.peer_node_id && config.icecast_target_type !== 'remote' && config.icecast_target_type !== 'external' && icecastProviders.length > 0) {
        const prov = icecastProviders.find(p => p.id === config.provider_service_id) || icecastProviders[0];
        if (prov) {
          const pCfg = prov.config || {};
          const isTls = Boolean(config.tls || pCfg.is_ssl);
          const expectedPort = String(isTls ? (pCfg.ssl_port || 7443) : (pCfg.port || 7000));
          if (config.port !== expectedPort || config.provider_service_id !== prov.id) {
            update({
              provider_service_id: prov.id,
              port: expectedPort,
              host: config.host || '127.0.0.1',
            });
          }
        }
      }
    }
  }, [providers, config.type, config.provider_service_id, config.mediamtx_mode, config.service_target, config.icecast_mode, config.tls, config.peer_node_id, config.mediamtx_target_type, config.icecast_target_type]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: accentColor }} />
        <label htmlFor={`${idPrefix}-type`} className="font-bold text-[10px] uppercase tracking-wider cursor-pointer" style={{ color: accentColor }}>
          {label}
        </label>
      </div>

      <select
        id={`${idPrefix}-type`}
        name="type"
        className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none transition-all"
        value={config.type}
        onChange={e => {
          const newType = e.target.value;
          const isHwSupported = ['file', 'srt', 'udp', 'rtp', 'rtmp', 'hls'].includes(newType);
          update({
            type: newType,
            path: '', host: '', port: '', mode: 'listener', device: '', name: '',
            pattern: newType === 'lavfi_video' ? 'testsrc' : newType === 'lavfi_audio' ? 'sine' : '',
            size: newType === 'lavfi_video' ? '1920x1080' : undefined,
            rate: newType === 'lavfi_video' ? '25' : undefined,
            frequency: newType === 'lavfi_audio' ? 1000 : undefined,
            ...(!isHwSupported ? {
              hwaccel: 'none',
              hwaccel_output_format: '',
              frames_destination: 'cpu'
            } : {})
          });
        }}
      >
        {types.map(tItem => (
          <option key={tItem.value} value={tItem.value}>{t(tItem.labelKey, tItem.label)}</option>
        ))}
      </select>

      {/* ── Type-specific fields ── */}
      {config.type === 'file' && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={`${idPrefix}-storage`} className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">{t('sources.mediaStorage')}</label>
            <select
              id={`${idPrefix}-storage`}
              name="storage_id"
              className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-brand-lime"
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
            <label htmlFor={`${idPrefix}-relative-path`} className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">{t('sources.relativePath')}</label>
            <input
              type="text"
              id={`${idPrefix}-relative-path`}
              name="relative_path"
              placeholder="e.g. movies/clip.mp4"
              className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-brand-lime font-mono"
              value={config.relative_path || ''}
              onChange={e => update({ relative_path: e.target.value })}
            />
          </div>
        </div>
      )}

      {/* ── HTTP Audio (Icecast / Shoutcast) Input Assistant ── */}
      {config.type === 'http_audio' && (() => {
        const icecastProviders = providers.filter(p => p.service_type === 'icecast_server');
        const remoteIcecastServices = remotePeers.flatMap(peer =>
          (peer.cached_services || peer.cached_services_json || [])
            .filter((s: any) => s.service_type === 'icecast_server')
            .map((s: any) => ({ peer, svc: s }))
        );
        const hasManagedProviders = icecastProviders.length > 0 || remoteIcecastServices.length > 0;
        const isIcecastMode = Boolean(config.icecast_mode || config.service_target === 'icecast' || config.provider_service_id || config.peer_node_id);
        const isExternal = (config.icecast_target_type === 'external' || (config.icecast_target_type === 'remote' && !config.peer_node_id)) || (!config.provider_service_id && !config.peer_node_id && !hasManagedProviders);
        const selectedProvider = icecastProviders.find(p => p.id === config.provider_service_id) || icecastProviders[0];

        // Resolve active icecast configuration (Local vs Peer)
        let availableMounts: any[] = [];
        let activeTls = false;
        let activePort = '7000';
        let currentHost = '127.0.0.1';

        if (config.peer_node_id) {
          const peer = remotePeers.find(p => p.id === config.peer_node_id);
          const services = peer ? (peer.cached_services || peer.cached_services_json || []) : [];
          const svc = services.find((s: any) => s.id === config.peer_service_id);
          const protos = svc?.protocols || {};
          availableMounts = Array.isArray(protos.mounts) ? protos.mounts : [];
          activeTls = Boolean(protos.ssl_enabled);
          activePort = String(config.tls ? (protos.ssl_port || 7443) : (protos.port || 7000));
          try {
            currentHost = peer ? new URL(peer.base_url).hostname : '127.0.0.1';
          } catch {
            currentHost = peer ? peer.base_url.replace(/https?:\/\//, '').split(':')[0] : '127.0.0.1';
          }
        } else {
          const iceCfg = selectedProvider?.config || {};
          availableMounts = Array.isArray(iceCfg.mounts) ? iceCfg.mounts : [];
          activeTls = Boolean(iceCfg.ssl_enabled || iceCfg.is_ssl);
          activePort = String(config.tls ? (iceCfg.ssl_port || 7443) : (iceCfg.port || 7000));
          currentHost = '127.0.0.1';
        }

        const mountNames = availableMounts.map((m: any) => typeof m === 'string' ? m : m.mount_name).filter(Boolean);

        const handleSelectProvider = (provId: number, isTls?: boolean) => {
          const prov = icecastProviders.find(p => p.id === provId);
          if (!prov) return;
          const pCfg = prov.config || {};
          const pMounts: any[] = Array.isArray(pCfg.mounts) ? pCfg.mounts : [];
          const firstMount = pMounts.length > 0 ? (typeof pMounts[0] === 'string' ? pMounts[0] : pMounts[0].mount_name) : (config.icecast_mount || '/live.mp3');

          const useTls = isTls !== undefined ? isTls : Boolean(pCfg.ssl_enabled || pCfg.is_ssl);
          const port = useTls ? (pCfg.ssl_port || 7443) : (pCfg.port || 7000);
          const scheme = useTls ? 'https' : 'http';
          const rUser = config.read_user || config.auth_user || '';
          const rPass = config.read_pass || config.auth_pass || '';
          const authPrefix = rUser ? `${encodeURIComponent(rUser)}:${encodeURIComponent(rPass)}@` : '';
          const genUrl = `${scheme}://${authPrefix}127.0.0.1:${port}${firstMount.startsWith('/') ? firstMount : `/${firstMount}`}`;

          update({
            provider_service_id: prov.id,
            peer_node_id: undefined,
            peer_service_id: undefined,
            service_target: 'icecast',
            icecast_target_type: 'managed',
            host: '127.0.0.1',
            port: String(port),
            icecast_mount: firstMount,
            icecast_mode: true,
            tls: useTls,
            path: genUrl,
          });
        };

        const handleSelectRemotePeer = (peerId: number, svcId: number) => {
          const peer = remotePeers.find(p => p.id === peerId);
          if (!peer) return;
          const services = peer.cached_services || peer.cached_services_json || [];
          const svc = services.find((s: any) => s.id === svcId);
          if (!svc) return;

          let host = '127.0.0.1';
          try {
            host = new URL(peer.base_url).hostname;
          } catch {
            host = peer.base_url.replace(/https?:\/\//, '').split(':')[0];
          }

          const protos = svc.protocols || {};
          const pMounts: any[] = Array.isArray(protos.mounts) ? protos.mounts : [];
          const firstMount = pMounts.length > 0
            ? (typeof pMounts[0] === 'string' ? pMounts[0] : pMounts[0].mount_name)
            : (config.icecast_mount || '/live.mp3');

          const useTls = Boolean(protos.ssl_enabled && config.tls);
          const port = useTls ? (protos.ssl_port || 7443) : (protos.port || 7000);
          const scheme = useTls ? 'https' : 'http';
          const rUser = config.read_user || config.auth_user || '';
          const rPass = config.read_pass || config.auth_pass || '';
          const authPrefix = rUser ? `${encodeURIComponent(rUser)}:${encodeURIComponent(rPass)}@` : '';
          const genUrl = `${scheme}://${authPrefix}${host}:${port}${firstMount.startsWith('/') ? firstMount : `/${firstMount}`}`;

          update({
            provider_service_id: undefined,
            peer_node_id: peer.id,
            peer_service_id: svc.id,
            service_target: 'icecast',
            icecast_target_type: 'managed',
            host: host,
            port: String(port),
            icecast_mount: firstMount,
            icecast_mode: true,
            tls: useTls,
            path: genUrl,
          });
        };

        const handleSelectMount = (val: string) => {
          const mountName = val === '__custom__' ? (config.icecast_mount && !mountNames.includes(config.icecast_mount) ? config.icecast_mount : '') : val;
          const scheme = config.tls ? 'https' : 'http';
          const rUser = config.read_user || config.auth_user || '';
          const rPass = config.read_pass || config.auth_pass || '';
          const authPrefix = rUser ? `${encodeURIComponent(rUser)}:${encodeURIComponent(rPass)}@` : '';
          const port = config.port || activePort;
          const cleanMount = mountName ? (mountName.startsWith('/') ? mountName : `/${mountName}`) : '/live.mp3';
          const genUrl = `${scheme}://${authPrefix}${config.host || currentHost}:${port}${cleanMount}`;

          update({
            icecast_mount: mountName,
            path: genUrl,
          });
        };

        return (
          <div className="space-y-3">
            {/* Mode Switcher */}
            <div className="flex bg-[var(--input-bg)] p-0.5 rounded-lg border border-[var(--glass-border)]">
              <button
                type="button"
                className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-md transition-colors ${
                  !isIcecastMode
                    ? 'bg-amber-500/25 text-[var(--text-primary)] border border-amber-500/40 shadow-sm font-bold'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
                onClick={() => update({
                  icecast_mode: false,
                  service_target: undefined,
                  icecast_mount: undefined,
                  provider_service_id: undefined,
                  peer_node_id: undefined,
                  peer_service_id: undefined,
                  icecast_target_type: undefined,
                })}
              >
                {t('sources.httpAudioManual', 'Manual Direct HTTP / Icecast URL')}
              </button>
              <button
                type="button"
                className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 ${
                  isIcecastMode
                    ? 'bg-brand-lime/20 text-brand-lime border border-brand-lime/40 shadow-sm font-bold'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
                onClick={() => {
                  if (icecastProviders.length > 0) {
                    const defaultProv = icecastProviders.find(p => p.id === config.provider_service_id) || icecastProviders[0];
                    handleSelectProvider(defaultProv.id);
                  } else if (remoteIcecastServices.length > 0) {
                    handleSelectRemotePeer(remoteIcecastServices[0].peer.id, remoteIcecastServices[0].svc.id);
                  } else {
                    update({
                      icecast_mode: true,
                      icecast_target_type: 'external',
                      service_target: 'icecast',
                      host: config.host && config.host !== '127.0.0.1' ? config.host : '',
                      port: config.port || '8000',
                      icecast_mount: config.icecast_mount || '/live.mp3',
                      path: `http://${config.host || '127.0.0.1'}:${config.port || '8000'}${config.icecast_mount || '/live.mp3'}`,
                    });
                  }
                }}
              >
                <span>📻</span>
                {t('sources.httpAudioIcecastServer', 'Icecast Server Integration')}
              </button>
            </div>

            {isIcecastMode ? (
              <div className="p-3 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl space-y-3">
                {/* Managed Service vs Manual External Server */}
                <div className="flex bg-[var(--input-bg)] p-0.5 rounded-lg border border-[var(--glass-border)] text-xs">
                  <button
                    type="button"
                    disabled={!hasManagedProviders}
                    className={`flex-1 py-1 px-2 font-bold rounded transition-all flex items-center justify-center gap-1 ${
                      !isExternal && hasManagedProviders
                        ? 'bg-brand-lime/20 text-brand-lime border border-brand-lime/40 shadow-sm'
                        : 'text-[var(--text-secondary)] opacity-60 hover:text-[var(--text-primary)]'
                    }`}
                    onClick={() => {
                      if (icecastProviders.length > 0) {
                        const defaultProv = icecastProviders.find(p => p.id === config.provider_service_id) || icecastProviders[0];
                        if (defaultProv) handleSelectProvider(defaultProv.id);
                      } else if (remoteIcecastServices.length > 0) {
                        handleSelectRemotePeer(remoteIcecastServices[0].peer.id, remoteIcecastServices[0].svc.id);
                      }
                    }}
                  >
                    <span>📻</span> {t('sources.managedService', 'Managed Service (Local & Peers)')} {!hasManagedProviders ? `(${t('common.none', 'None')})` : ''}
                  </button>
                  <button
                    type="button"
                    className={`flex-1 py-1 px-2 font-bold rounded transition-all flex items-center justify-center gap-1 ${
                      isExternal
                        ? 'bg-brand-lime/20 text-brand-lime border border-brand-lime/40 shadow-sm'
                        : 'text-[var(--text-secondary)] opacity-60 hover:text-[var(--text-primary)]'
                    }`}
                    onClick={() => update({
                      icecast_target_type: 'external',
                      provider_service_id: undefined,
                      peer_node_id: undefined,
                      peer_service_id: undefined,
                      host: config.host && config.host !== '127.0.0.1' ? config.host : '',
                      port: config.port || '8000',
                    })}
                  >
                    <span>🌐</span> {t('sources.externalServer', 'Manual External Server (Unfederated Host)')}
                  </button>
                </div>

                {!isExternal ? (
                  <div className="space-y-2.5">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                          {t('sources.selectIcecastService', 'Icecast Service')}
                        </label>
                        <select
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-brand-lime font-mono"
                          value={config.peer_node_id ? `peer:${config.peer_node_id}:${config.peer_service_id}` : (config.provider_service_id || selectedProvider?.id || '')}
                          onChange={e => {
                            const val = e.target.value;
                            if (val.startsWith('peer:')) {
                              const [, pId, sId] = val.split(':');
                              handleSelectRemotePeer(parseInt(pId), parseInt(sId));
                            } else {
                              handleSelectProvider(Number(val));
                            }
                          }}
                        >
                          {icecastProviders.length > 0 && (
                            <optgroup label={t('sources.localServices', 'Local Services (This Node)')}>
                              {icecastProviders.map(p => (
                                <option key={p.id} value={p.id}>
                                  {p.name} (Port :{p.config?.port || 7000})
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {remoteIcecastServices.length > 0 && (
                            <optgroup label={t('sources.remotePeers', 'Federated Remote Peers')}>
                              {remoteIcecastServices.map(({ peer, svc }) => (
                                <option key={`peer:${peer.id}:${svc.id}`} value={`peer:${peer.id}:${svc.id}`}>
                                  {svc.name} @ {peer.name} ({peer.status === 'online' ? `${peer.latency_ms || 0}ms` : 'offline'})
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </div>
                      <div>
                        <label className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                          {t('sources.icecastMountPoint', 'Mountpoint')}
                        </label>
                        <select
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-brand-lime font-mono"
                          value={mountNames.includes(config.icecast_mount || '') ? config.icecast_mount : '__custom__'}
                          onChange={e => handleSelectMount(e.target.value)}
                        >
                          {mountNames.map(mName => (
                            <option key={mName} value={mName}>{mName}</option>
                          ))}
                          <option value="__custom__">{t('sources.customMountOption', '+ Custom Mountpoint...')}</option>
                        </select>
                      </div>
                    </div>

                    {/* TLS / HTTPS toggle if supported by server */}
                    {activeTls && (
                      <div className="flex items-center justify-between p-2 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg">
                        <div className="text-xs">
                          <span className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                            🔒 {t('sources.enableHttpsIcecast', 'Secure HTTPS Pull (TLS)')}
                          </span>
                          <span className="text-[10px] text-[var(--text-secondary)] block">
                            Port :{activePort}
                          </span>
                        </div>
                        <input
                          type="checkbox"
                          checked={Boolean(config.tls)}
                          onChange={e => {
                            const useTls = e.target.checked;
                            if (config.peer_node_id) {
                              const peer = remotePeers.find(p => p.id === config.peer_node_id);
                              const services = peer ? (peer.cached_services || peer.cached_services_json || []) : [];
                              const svc = services.find((s: any) => s.id === config.peer_service_id);
                              const protos = svc?.protocols || {};
                              const port = useTls ? (protos.ssl_port || 7443) : (protos.port || 7000);
                              const scheme = useTls ? 'https' : 'http';
                              const rUser = config.read_user || config.auth_user || '';
                              const rPass = config.read_pass || config.auth_pass || '';
                              const authPrefix = rUser ? `${encodeURIComponent(rUser)}:${encodeURIComponent(rPass)}@` : '';
                              const mount = config.icecast_mount || '/live.mp3';
                              const cleanMount = mount.startsWith('/') ? mount : `/${mount}`;
                              update({
                                tls: useTls,
                                port: String(port),
                                path: `${scheme}://${authPrefix}${currentHost}:${port}${cleanMount}`,
                              });
                            } else if (selectedProvider) {
                              handleSelectProvider(selectedProvider.id, useTls);
                            }
                          }}
                          className="accent-brand-lime cursor-pointer w-4 h-4"
                        />
                      </div>
                    )}

                    {(!config.icecast_mount || !mountNames.includes(config.icecast_mount)) && (
                      <div>
                        <label className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                          {t('sources.customMountSlug', 'Custom Mountpoint')}
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. /live.mp3, /stream.ogg"
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-brand-lime"
                          value={config.icecast_mount || ''}
                          onChange={e => {
                            const newMount = e.target.value;
                            const scheme = config.tls ? 'https' : 'http';
                            const rUser = config.read_user || config.auth_user || '';
                            const rPass = config.read_pass || config.auth_pass || '';
                            const authPrefix = rUser ? `${encodeURIComponent(rUser)}:${encodeURIComponent(rPass)}@` : '';
                            const cleanMount = newMount ? (newMount.startsWith('/') ? newMount : `/${newMount}`) : '/live.mp3';
                            update({
                              icecast_mount: newMount,
                              path: `${scheme}://${authPrefix}${config.host || currentHost}:${config.port || activePort}${cleanMount}`,
                            });
                          }}
                        />
                      </div>
                    )}

                    {/* Generated URL & Auto-computed field */}
                    <div>
                      <label className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                        {t('sources.generatedStreamUrl', 'Generated Pull Audio URL')}
                      </label>
                      <input
                        type="text"
                        readOnly
                        className="w-full bg-[var(--input-bg)] border border-brand-lime/40 rounded-lg p-1.5 text-xs font-mono text-brand-lime select-all cursor-pointer"
                        value={config.path || ''}
                      />
                    </div>
                  </div>
                ) : (
                  /* Remote Server Mode */
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                          {t('sources.remoteHostIp', 'Remote Host / IP')}<span className="text-red-500 ml-0.5">*</span>
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. icecast.radio.lan"
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-brand-lime"
                          value={config.host || ''}
                          onChange={e => {
                            const h = e.target.value;
                            const port = config.port || '8000';
                            const mount = config.icecast_mount || '/live.mp3';
                            const cleanMount = mount.startsWith('/') ? mount : `/${mount}`;
                            update({ host: h, path: `http://${h}:${port}${cleanMount}` });
                          }}
                        />
                      </div>
                      <div>
                        <label className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                          {t('sources.port', 'Port')}
                        </label>
                        <input
                          type="text"
                          placeholder="8000"
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-brand-lime"
                          value={config.port || '8000'}
                          onChange={e => {
                            const p = e.target.value;
                            const mount = config.icecast_mount || '/live.mp3';
                            const cleanMount = mount.startsWith('/') ? mount : `/${mount}`;
                            update({ port: p, path: `http://${config.host || '127.0.0.1'}:${p}${cleanMount}` });
                          }}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                        {t('sources.icecastMountPoint', 'Mountpoint')}
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. /live.mp3"
                        className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-brand-lime"
                        value={config.icecast_mount || ''}
                        onChange={e => {
                          const m = e.target.value;
                          const cleanMount = m ? (m.startsWith('/') ? m : `/${m}`) : '/live.mp3';
                          update({
                            icecast_mount: m,
                            path: `http://${config.host || '127.0.0.1'}:${config.port || '8000'}${cleanMount}`,
                          });
                        }}
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                        {t('sources.generatedStreamUrl', 'Generated Pull Audio URL')}
                      </label>
                      <input
                        type="text"
                        readOnly
                        className="w-full bg-[var(--input-bg)] border border-brand-lime/40 rounded-lg p-1.5 text-xs font-mono text-brand-lime select-all"
                        value={config.path || ''}
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Manual Mode */
              <div className="space-y-1.5">
                <label htmlFor={`${idPrefix}-http-audio-url`} className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                  {t('sources.streamUrl', 'Stream URL')}<span className="text-red-500 ml-0.5">*</span>
                </label>
                <input
                  type="text"
                  id={`${idPrefix}-http-audio-url`}
                  name="path"
                  placeholder="e.g. http://icecast.radio.org:8000/live.mp3"
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-brand-lime font-mono"
                  value={config.path || ''}
                  onChange={e => update({ path: e.target.value })}
                />
              </div>
            )}
          </div>
        );
      })()}

      {/* ── RTMP Input Assistant ── */}
      {config.type === 'rtmp' && (() => {
        const mediamtxProviders = providers.filter(p => p.service_type === 'mediamtx_hub');
        const remoteMtxServices = remotePeers.flatMap(peer =>
          (peer.cached_services || peer.cached_services_json || [])
            .filter((s: any) => s.service_type === 'mediamtx_hub')
            .map((s: any) => ({ peer, svc: s }))
        );
        const hasManagedProviders = mediamtxProviders.length > 0 || remoteMtxServices.length > 0;
        const isMediaMtxMode = (config.mediamtx_mode === false || config.service_target === 'manual')
          ? false
          : Boolean(config.mediamtx_mode || config.service_target === 'mediamtx' || config.provider_service_id || config.peer_node_id);
        const isExternal = (config.mediamtx_target_type === 'external' || (config.mediamtx_target_type === 'remote' && !config.peer_node_id)) || (!config.provider_service_id && !config.peer_node_id && !hasManagedProviders);
        const selectedProvider = mediamtxProviders.find(p => p.id === config.provider_service_id) || mediamtxProviders[0];

        // Resolve active paths dictionary and security (Local vs Peer)
        let activePathsDict: Record<string, any> = {};
        let activeSecurity: any = {};
        let currentHost = '127.0.0.1';
        let activeSsl = false;
        let activeRtmpsPort = 1936;

        if (config.peer_node_id) {
          const peer = remotePeers.find(p => p.id === config.peer_node_id);
          const services = peer ? (peer.cached_services || peer.cached_services_json || []) : [];
          const svc = services.find((s: any) => s.id === config.peer_service_id);
          const protos = svc?.protocols || {};
          activeSecurity = protos.security || {};
          activeSsl = Boolean(protos.ssl_enabled);
          activeRtmpsPort = protos.rtmps?.port || 1936;
          try {
            currentHost = peer ? new URL(peer.base_url).hostname : '127.0.0.1';
          } catch {
            currentHost = peer ? peer.base_url.replace(/https?:\/\//, '').split(':')[0] : '127.0.0.1';
          }
          const paths = protos.paths || {};
          if (Array.isArray(paths)) {
            for (const p of paths) {
              if (typeof p === 'string') activePathsDict[p] = { mode: 'inherit' };
              else if (p && p.path_id) activePathsDict[p.path_id] = p;
            }
          } else if (typeof paths === 'object' && paths !== null) {
            activePathsDict = paths;
          }
        } else {
          const mtxCfg = selectedProvider?.config || {};
          activeSecurity = mtxCfg.security || {};
          activeSsl = Boolean(mtxCfg.ssl_enabled && mtxCfg.rtmps_enabled);
          activeRtmpsPort = mtxCfg.rtmps_port || 1936;
          currentHost = '127.0.0.1';
          const rawPaths = mtxCfg.paths || {};
          if (Array.isArray(rawPaths)) {
            for (const p of rawPaths) {
              if (typeof p === 'string') activePathsDict[p] = { mode: 'inherit' };
              else if (p && p.path_id) activePathsDict[p.path_id] = p;
            }
          } else if (typeof rawPaths === 'object' && rawPaths !== null) {
            activePathsDict = rawPaths;
          }
        }
        const configuredPaths = Object.keys(activePathsDict);

        const handleSelectProvider = (provId: number, isTls?: boolean) => {
          const prov = mediamtxProviders.find(p => p.id === provId);
          if (!prov) return;
          const pCfg = prov.config || {};
          const paths = pCfg.paths || {};
          let pKeys: string[] = [];
          let pathsDict: Record<string, any> = {};
          if (Array.isArray(paths)) {
            for (const p of paths) {
              if (typeof p === 'string') { pKeys.push(p); pathsDict[p] = { mode: 'inherit' }; }
              else if (p && p.path_id) { pKeys.push(p.path_id); pathsDict[p.path_id] = p; }
            }
          } else if (typeof paths === 'object' && paths !== null) {
            pKeys = Object.keys(paths);
            pathsDict = paths;
          }
          const firstPath = pKeys.length > 0 ? pKeys[0] : (config.path_id || 'stream1');
          const pathConf = pathsDict[firstPath] || {};

          let rUser = '';
          let rPass = '';
          if (pathConf.mode === 'custom') {
            rUser = pathConf.read_user || '';
            rPass = pathConf.read_pass || '';
          } else if (pathConf.mode !== 'open') {
            rUser = pathConf.read_user || pCfg.security?.read_user || pCfg.read_user || '';
            rPass = pathConf.read_pass || pCfg.security?.read_pass || pCfg.read_pass || '';
          }

          const useTls = isTls !== undefined ? isTls : Boolean(pCfg.ssl_enabled && pCfg.rtmps_enabled && config.tls);
          const port = useTls ? (pCfg.rtmps_port || 1936) : (pCfg.rtmp_port || 1935);
          const scheme = useTls ? 'rtmps' : 'rtmp';
          const authPrefix = rUser ? `${encodeURIComponent(rUser)}:${encodeURIComponent(rPass)}@` : '';
          const genUrl = `${scheme}://${authPrefix}127.0.0.1:${port}/${firstPath}`;

          update({
            provider_service_id: prov.id,
            peer_node_id: undefined,
            peer_service_id: undefined,
            service_target: 'mediamtx',
            mediamtx_target_type: 'managed',
            host: '127.0.0.1',
            port: String(port),
            path_id: firstPath,
            read_user: rUser,
            read_pass: rPass,
            auth_user: rUser,
            auth_pass: rPass,
            mediamtx_mode: true,
            tls: useTls,
            path: genUrl,
          });
        };

        const handleSelectRemotePeer = (peerId: number, svcId: number, isTls?: boolean) => {
          const peer = remotePeers.find(p => p.id === peerId);
          if (!peer) return;
          const services = peer.cached_services || peer.cached_services_json || [];
          const svc = services.find((s: any) => s.id === svcId);
          if (!svc) return;

          let host = '127.0.0.1';
          try {
            host = new URL(peer.base_url).hostname;
          } catch {
            host = peer.base_url.replace(/https?:\/\//, '').split(':')[0];
          }

          const protos = svc.protocols || {};
          const paths = protos.paths || {};
          let pKeys: string[] = [];
          let pathsDict: Record<string, any> = {};
          if (Array.isArray(paths)) {
            for (const p of paths) {
              if (typeof p === 'string') { pKeys.push(p); pathsDict[p] = { mode: 'inherit' }; }
              else if (p && p.path_id) { pKeys.push(p.path_id); pathsDict[p.path_id] = p; }
            }
          } else if (typeof paths === 'object' && paths !== null) {
            pKeys = Object.keys(paths);
            pathsDict = paths;
          }
          const firstPath = pKeys.length > 0 ? pKeys[0] : (config.path_id || 'stream1');
          const pathConf = pathsDict[firstPath] || {};

          let rUser = '';
          let rPass = '';
          if (pathConf.mode === 'custom') {
            rUser = pathConf.read_user || '';
            rPass = pathConf.read_pass || '';
          } else if (pathConf.mode !== 'open') {
            rUser = pathConf.read_user || protos.security?.read_user || '';
            rPass = pathConf.read_pass || protos.security?.read_pass || '';
          }

          const useTls = isTls !== undefined ? isTls : Boolean(protos.ssl_enabled && protos.rtmps?.enabled && config.tls);
          const rtmpPort = useTls ? (protos.rtmps?.port || 1936) : (protos.rtmp?.port || 1935);
          const scheme = useTls ? 'rtmps' : 'rtmp';
          const authPrefix = rUser ? `${encodeURIComponent(rUser)}:${encodeURIComponent(rPass)}@` : '';
          const genUrl = `${scheme}://${authPrefix}${host}:${rtmpPort}/${firstPath}`;

          update({
            peer_node_id: peer.id,
            peer_service_id: svc.id,
            provider_service_id: undefined,
            service_target: 'mediamtx',
            mediamtx_target_type: 'managed',
            host: host,
            port: String(rtmpPort),
            path_id: firstPath,
            read_user: rUser,
            read_pass: rPass,
            auth_user: rUser,
            auth_pass: rPass,
            mediamtx_mode: true,
            tls: useTls,
            path: genUrl,
          });
        };

        const handleSelectPath = (val: string) => {
          const pathId = val === '__custom__' ? (config.path_id && !configuredPaths.includes(config.path_id) ? config.path_id : '') : val;
          const pathConf = activePathsDict[pathId] || {};
          let rUser = '';
          let rPass = '';
          if (pathConf.mode === 'custom') {
            rUser = pathConf.read_user || '';
            rPass = pathConf.read_pass || '';
          } else if (pathConf.mode !== 'open') {
            rUser = pathConf.read_user || activeSecurity?.read_user || '';
            rPass = pathConf.read_pass || activeSecurity?.read_pass || '';
          }

          const scheme = config.tls ? 'rtmps' : 'rtmp';
          const authPrefix = rUser ? `${encodeURIComponent(rUser)}:${encodeURIComponent(rPass)}@` : '';
          const port = config.port || (config.tls ? '1936' : '1935');
          const genUrl = `${scheme}://${authPrefix}${config.host || currentHost}:${port}/${pathId || 'stream1'}`;

          update({
            path_id: pathId,
            read_user: rUser,
            read_pass: rPass,
            auth_user: rUser,
            auth_pass: rPass,
            path: genUrl,
          });
        };

        return (
          <div className="space-y-3">
            {/* Mode Switcher */}
            <div className="flex bg-[var(--input-bg)] p-0.5 rounded-lg border border-[var(--glass-border)]">
              <button
                type="button"
                className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-md transition-colors ${
                  !isMediaMtxMode
                    ? 'bg-amber-500/25 text-[var(--text-primary)] border border-amber-500/40 shadow-sm font-bold'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
                onClick={() => update({
                  mediamtx_mode: false,
                  service_target: undefined,
                  path_id: undefined,
                  provider_service_id: undefined,
                  peer_node_id: undefined,
                  peer_service_id: undefined,
                  mediamtx_target_type: undefined,
                })}
              >
                {t('sources.rtmpManualDirect', 'Manual Direct RTMP')}
              </button>
              <button
                type="button"
                className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 ${
                  isMediaMtxMode
                    ? 'bg-brand-lime/20 text-brand-lime border border-brand-lime/40 shadow-sm font-bold'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
                onClick={() => {
                  if (mediamtxProviders.length > 0) {
                    const defaultProv = mediamtxProviders.find(p => p.id === config.provider_service_id) || mediamtxProviders[0];
                    handleSelectProvider(defaultProv.id);
                  } else if (remoteMtxServices.length > 0) {
                    handleSelectRemotePeer(remoteMtxServices[0].peer.id, remoteMtxServices[0].svc.id);
                  } else {
                    update({
                      mediamtx_mode: true,
                      mediamtx_target_type: 'external',
                      service_target: 'mediamtx',
                      host: config.host && config.host !== '127.0.0.1' ? config.host : '',
                      port: config.port || '1935',
                      path_id: config.path_id || 'stream1',
                      path: `rtmp://${config.host || '127.0.0.1'}:${config.port || '1935'}/${config.path_id || 'stream1'}`,
                    });
                  }
                }}
              >
                <span>⚡</span>
                {t('sources.rtmpMediaMtxHub', 'MediaMTX Hub Integration')}
              </button>
            </div>

            {isMediaMtxMode ? (
              <div className="p-3 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl space-y-3">
                {/* Managed Service vs Manual External Server */}
                <div className="flex bg-[var(--input-bg)] p-0.5 rounded-lg border border-[var(--glass-border)] text-xs">
                  <button
                    type="button"
                    disabled={!hasManagedProviders}
                    className={`flex-1 py-1 px-2 font-bold rounded transition-all flex items-center justify-center gap-1 ${
                      !isExternal && hasManagedProviders
                        ? 'bg-brand-lime/20 text-brand-lime border border-brand-lime/40 shadow-sm'
                        : 'text-[var(--text-secondary)] opacity-60 hover:text-[var(--text-primary)]'
                    }`}
                    onClick={() => {
                      if (mediamtxProviders.length > 0) {
                        const defaultProv = mediamtxProviders.find(p => p.id === config.provider_service_id) || mediamtxProviders[0];
                        if (defaultProv) handleSelectProvider(defaultProv.id);
                      } else if (remoteMtxServices.length > 0) {
                        handleSelectRemotePeer(remoteMtxServices[0].peer.id, remoteMtxServices[0].svc.id);
                      }
                    }}
                  >
                    <span>⚡</span> {t('sources.managedService', 'Managed Service (Local & Peers)')} {!hasManagedProviders ? `(${t('common.none', 'None')})` : ''}
                  </button>
                  <button
                    type="button"
                    className={`flex-1 py-1 px-2 font-bold rounded transition-all flex items-center justify-center gap-1 ${
                      isExternal
                        ? 'bg-brand-lime/20 text-brand-lime border border-brand-lime/40 shadow-sm'
                        : 'text-[var(--text-secondary)] opacity-60 hover:text-[var(--text-primary)]'
                    }`}
                    onClick={() => update({
                      mediamtx_target_type: 'external',
                      provider_service_id: undefined,
                      peer_node_id: undefined,
                      peer_service_id: undefined,
                      host: config.host && config.host !== '127.0.0.1' ? config.host : '',
                      port: config.port || '1935',
                    })}
                  >
                    <span>🌐</span> {t('sources.externalServer', 'Manual External Server (Unfederated Host)')}
                  </button>
                </div>

                {!isExternal ? (
                  <div className="space-y-2.5">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                          {t('sources.selectHubService', 'MediaMTX Service')}
                        </label>
                        <select
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-brand-lime font-mono"
                          value={config.peer_node_id ? `peer:${config.peer_node_id}:${config.peer_service_id}` : (config.provider_service_id || selectedProvider?.id || '')}
                          onChange={e => {
                            const val = e.target.value;
                            if (val.startsWith('peer:')) {
                              const [, pId, sId] = val.split(':');
                              handleSelectRemotePeer(parseInt(pId), parseInt(sId));
                            } else {
                              handleSelectProvider(Number(val));
                            }
                          }}
                        >
                          {mediamtxProviders.length > 0 && (
                            <optgroup label={t('sources.localServices', 'Local Hubs (This Node)')}>
                              {mediamtxProviders.map(p => (
                                <option key={p.id} value={p.id}>
                                  {p.name} (Port :{p.config?.rtmp_port || 1935})
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {remoteMtxServices.length > 0 && (
                            <optgroup label={t('sources.remotePeers', 'Federated Remote Peers')}>
                              {remoteMtxServices.map(({ peer, svc }) => (
                                <option key={`peer:${peer.id}:${svc.id}`} value={`peer:${peer.id}:${svc.id}`}>
                                  {svc.name} @ {peer.name} ({peer.status === 'online' ? `${peer.latency_ms || 0}ms` : 'offline'})
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </div>
                      <div>
                        <label className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                          {t('sources.streamPath', 'Stream Path')}
                        </label>
                        <select
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-brand-lime font-mono"
                          value={configuredPaths.includes(config.path_id || '') ? config.path_id : '__custom__'}
                          onChange={e => handleSelectPath(e.target.value)}
                        >
                          {configuredPaths.map(pName => (
                            <option key={pName} value={pName}>
                              /{pName} {activePathsDict[pName]?.mode === 'open' ? '(LAN Open)' : ''}
                            </option>
                          ))}
                          <option value="__custom__">{t('sources.customPathOption', '+ Custom Path Slug...')}</option>
                        </select>
                      </div>
                    </div>

                    {/* TLS / RTMPS toggle if supported by hub */}
                    {activeSsl && (
                      <div className="flex items-center justify-between p-2 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg">
                        <div className="text-xs">
                          <span className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                            🔒 {t('sources.enableRtmps', 'Encrypted RTMPS Pull (TLS)')}
                          </span>
                          <span className="text-[10px] text-[var(--text-secondary)] block">
                            Port :{activeRtmpsPort}
                          </span>
                        </div>
                        <input
                          type="checkbox"
                          checked={Boolean(config.tls)}
                          onChange={e => {
                            const useTls = e.target.checked;
                            if (config.peer_node_id && config.peer_service_id) {
                              handleSelectRemotePeer(config.peer_node_id, config.peer_service_id, useTls);
                            } else if (selectedProvider) {
                              handleSelectProvider(selectedProvider.id, useTls);
                            }
                          }}
                          className="accent-brand-lime cursor-pointer w-4 h-4"
                        />
                      </div>
                    )}

                    {(!config.path_id || !configuredPaths.includes(config.path_id)) && (
                      <div>
                        <label className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                          {t('sources.customPathSlug', 'Custom Path Slug')}
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. live1, channel_master"
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-brand-lime"
                          value={config.path_id || ''}
                          onChange={e => {
                            const newPath = e.target.value.replace(/[^a-zA-Z0-9_\-\/]/g, '');
                            const scheme = config.tls ? 'rtmps' : 'rtmp';
                            const rUser = config.read_user || config.auth_user || '';
                            const rPass = config.read_pass || config.auth_pass || '';
                            const authPrefix = rUser ? `${encodeURIComponent(rUser)}:${encodeURIComponent(rPass)}@` : '';
                            update({
                              path_id: newPath,
                              path: `${scheme}://${authPrefix}${config.host || currentHost}:${config.port || (config.tls ? activeRtmpsPort : 1935)}/${newPath}`,
                            });
                          }}
                        />
                      </div>
                    )}

                    {/* Generated URL & Auto-computed field */}
                    <div>
                      <label className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                        {t('sources.generatedRtmpUrl', 'Generated Source RTMP URL')}
                      </label>
                      <input
                        type="text"
                        readOnly
                        className="w-full bg-[var(--input-bg)] border border-brand-lime/40 rounded-lg p-1.5 text-xs font-mono text-brand-lime select-all cursor-pointer"
                        value={config.path || ''}
                      />
                    </div>
                  </div>
                ) : (
                  /* Remote Hub Mode */
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                          {t('sources.remoteHostIp', 'Remote Host / IP')}<span className="text-red-500 ml-0.5">*</span>
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. mediamtx.mycorp.lan"
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-brand-lime"
                          value={config.host || ''}
                          onChange={e => {
                            const h = e.target.value;
                            const port = config.port || '1935';
                            const path = config.path_id || 'stream1';
                            update({ host: h, path: `rtmp://${h}:${port}/${path}` });
                          }}
                        />
                      </div>
                      <div>
                        <label className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                          {t('sources.port', 'Port')}
                        </label>
                        <input
                          type="text"
                          placeholder="1935"
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-brand-lime"
                          value={config.port || '1935'}
                          onChange={e => {
                            const p = e.target.value;
                            update({ port: p, path: `rtmp://${config.host || '127.0.0.1'}:${p}/${config.path_id || 'stream1'}` });
                          }}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                        {t('sources.generatedRtmpUrl', 'Generated Source RTMP URL')}
                      </label>
                      <input
                        type="text"
                        readOnly
                        className="w-full bg-[var(--input-bg)] border border-brand-lime/40 rounded-lg p-1.5 text-xs font-mono text-brand-lime select-all"
                        value={config.path || ''}
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Manual Standalone RTMP Mode */
              <div className="space-y-1.5">
                <label htmlFor={`${idPrefix}-rtmp-path`} className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                  {t('sources.streamUrl', 'Stream URL')}<span className="text-red-500 ml-0.5">*</span>
                </label>
                <input
                  type="text"
                  id={`${idPrefix}-rtmp-path`}
                  name="path"
                  placeholder="RTMP URL (rtmp://server/live/stream)"
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-brand-lime"
                  value={config.path || ''}
                  onChange={e => update({ path: e.target.value })}
                />
              </div>
            )}
          </div>
        );
      })()}

      {/* ── HLS Input Assistant ── */}
      {config.type === 'hls' && (() => {
        const mediamtxProviders = providers.filter(p => p.service_type === 'mediamtx_hub');
        const remoteMtxServices = remotePeers.flatMap(peer =>
          (peer.cached_services || peer.cached_services_json || [])
            .filter((s: any) => s.service_type === 'mediamtx_hub')
            .map((s: any) => ({ peer, svc: s }))
        );
        const hasManagedProviders = mediamtxProviders.length > 0 || remoteMtxServices.length > 0;
        const isMediaMtxMode = (config.mediamtx_mode === false || config.service_target === 'manual')
          ? false
          : Boolean(config.mediamtx_mode || config.service_target === 'mediamtx' || config.provider_service_id || config.peer_node_id);
        const isExternal = (config.mediamtx_target_type === 'external' || (config.mediamtx_target_type === 'remote' && !config.peer_node_id)) || (!config.provider_service_id && !config.peer_node_id && !hasManagedProviders);
        const selectedProvider = mediamtxProviders.find(p => p.id === config.provider_service_id) || mediamtxProviders[0];

        // Resolve active paths dictionary and security (Local vs Peer)
        let activePathsDict: Record<string, any> = {};
        let activeSecurity: any = {};
        let currentHost = '127.0.0.1';
        let activeSsl = false;
        let activeHlsPort = 8888;

        if (config.peer_node_id) {
          const peer = remotePeers.find(p => p.id === config.peer_node_id);
          const services = peer ? (peer.cached_services || peer.cached_services_json || []) : [];
          const svc = services.find((s: any) => s.id === config.peer_service_id);
          const protos = svc?.protocols || {};
          activeSecurity = protos.security || {};
          activeSsl = Boolean(protos.ssl_enabled);
          activeHlsPort = protos.hls?.port || 8888;
          try {
            currentHost = peer ? new URL(peer.base_url).hostname : '127.0.0.1';
          } catch {
            currentHost = peer ? peer.base_url.replace(/https?:\/\//, '').split(':')[0] : '127.0.0.1';
          }
          const paths = protos.paths || {};
          if (Array.isArray(paths)) {
            for (const p of paths) {
              if (typeof p === 'string') activePathsDict[p] = { mode: 'inherit' };
              else if (p && p.path_id) activePathsDict[p.path_id] = p;
            }
          } else if (typeof paths === 'object' && paths !== null) {
            activePathsDict = paths;
          }
        } else {
          const mtxCfg = selectedProvider?.config || {};
          activeSecurity = mtxCfg.security || {};
          activeSsl = Boolean(mtxCfg.ssl_enabled && (mtxCfg.hls_encryption || mtxCfg.hlsEncryption || mtxCfg.ssl_enabled));
          activeHlsPort = mtxCfg.hls_port || 8888;
          currentHost = '127.0.0.1';
          const rawPaths = mtxCfg.paths || {};
          if (Array.isArray(rawPaths)) {
            for (const p of rawPaths) {
              if (typeof p === 'string') activePathsDict[p] = { mode: 'inherit' };
              else if (p && p.path_id) activePathsDict[p.path_id] = p;
            }
          } else if (typeof rawPaths === 'object' && rawPaths !== null) {
            activePathsDict = rawPaths;
          }
        }
        const configuredPaths = Object.keys(activePathsDict);

        const handleSelectProvider = (provId: number, isTls?: boolean) => {
          const prov = mediamtxProviders.find(p => p.id === provId);
          if (!prov) return;
          const pCfg = prov.config || {};
          const paths = pCfg.paths || {};
          let pKeys: string[] = [];
          let pathsDict: Record<string, any> = {};
          if (Array.isArray(paths)) {
            for (const p of paths) {
              if (typeof p === 'string') { pKeys.push(p); pathsDict[p] = { mode: 'inherit' }; }
              else if (p && p.path_id) { pKeys.push(p.path_id); pathsDict[p.path_id] = p; }
            }
          } else if (typeof paths === 'object' && paths !== null) {
            pKeys = Object.keys(paths);
            pathsDict = paths;
          }
          const firstPath = pKeys.length > 0 ? pKeys[0] : (config.path_id || 'stream1');
          const pathConf = pathsDict[firstPath] || {};

          let rUser = '';
          let rPass = '';
          if (pathConf.mode === 'custom') {
            rUser = pathConf.read_user || '';
            rPass = pathConf.read_pass || '';
          } else if (pathConf.mode !== 'open') {
            rUser = pathConf.read_user || pCfg.security?.read_user || pCfg.read_user || '';
            rPass = pathConf.read_pass || pCfg.security?.read_pass || pCfg.read_pass || '';
          }

          const useTls = isTls !== undefined ? isTls : Boolean(pCfg.ssl_enabled && (pCfg.hls_encryption || pCfg.hlsEncryption));
          const port = pCfg.hls_port || 8888;
          const scheme = useTls ? 'https' : 'http';
          const authPrefix = rUser ? `${encodeURIComponent(rUser)}:${encodeURIComponent(rPass)}@` : '';
          const genUrl = `${scheme}://${authPrefix}127.0.0.1:${port}/${firstPath}/index.m3u8`;

          update({
            provider_service_id: prov.id,
            peer_node_id: undefined,
            peer_service_id: undefined,
            service_target: 'mediamtx',
            mediamtx_target_type: 'managed',
            host: '127.0.0.1',
            port: String(port),
            path_id: firstPath,
            read_user: rUser,
            read_pass: rPass,
            auth_user: rUser,
            auth_pass: rPass,
            mediamtx_mode: true,
            tls: useTls,
            path: genUrl,
          });
        };

        const handleSelectRemotePeer = (peerId: number, svcId: number, isTls?: boolean) => {
          const peer = remotePeers.find(p => p.id === peerId);
          if (!peer) return;
          const services = peer.cached_services || peer.cached_services_json || [];
          const svc = services.find((s: any) => s.id === svcId);
          if (!svc) return;

          let host = '127.0.0.1';
          try {
            host = new URL(peer.base_url).hostname;
          } catch {
            host = peer.base_url.replace(/https?:\/\//, '').split(':')[0];
          }

          const protos = svc.protocols || {};
          const paths = protos.paths || {};
          let pKeys: string[] = [];
          let pathsDict: Record<string, any> = {};
          if (Array.isArray(paths)) {
            for (const p of paths) {
              if (typeof p === 'string') { pKeys.push(p); pathsDict[p] = { mode: 'inherit' }; }
              else if (p && p.path_id) { pKeys.push(p.path_id); pathsDict[p.path_id] = p; }
            }
          } else if (typeof paths === 'object' && paths !== null) {
            pKeys = Object.keys(paths);
            pathsDict = paths;
          }
          const firstPath = pKeys.length > 0 ? pKeys[0] : (config.path_id || 'stream1');
          const pathConf = pathsDict[firstPath] || {};

          let rUser = '';
          let rPass = '';
          if (pathConf.mode === 'custom') {
            rUser = pathConf.read_user || '';
            rPass = pathConf.read_pass || '';
          } else if (pathConf.mode !== 'open') {
            rUser = pathConf.read_user || protos.security?.read_user || '';
            rPass = pathConf.read_pass || protos.security?.read_pass || '';
          }

          const useTls = isTls !== undefined ? isTls : Boolean(protos.ssl_enabled && config.tls);
          const hlsPort = protos.hls?.port || 8888;
          const scheme = useTls ? 'https' : 'http';
          const authPrefix = rUser ? `${encodeURIComponent(rUser)}:${encodeURIComponent(rPass)}@` : '';
          const genUrl = `${scheme}://${authPrefix}${host}:${hlsPort}/${firstPath}/index.m3u8`;

          update({
            peer_node_id: peer.id,
            peer_service_id: svc.id,
            provider_service_id: undefined,
            service_target: 'mediamtx',
            mediamtx_target_type: 'managed',
            host: host,
            port: String(hlsPort),
            path_id: firstPath,
            read_user: rUser,
            read_pass: rPass,
            auth_user: rUser,
            auth_pass: rPass,
            mediamtx_mode: true,
            tls: useTls,
            path: genUrl,
          });
        };

        const handleSelectPath = (val: string) => {
          const pathId = val === '__custom__' ? (config.path_id && !configuredPaths.includes(config.path_id) ? config.path_id : '') : val;
          const pathConf = activePathsDict[pathId] || {};
          let rUser = '';
          let rPass = '';
          if (pathConf.mode === 'custom') {
            rUser = pathConf.read_user || '';
            rPass = pathConf.read_pass || '';
          } else if (pathConf.mode !== 'open') {
            rUser = pathConf.read_user || activeSecurity?.read_user || '';
            rPass = pathConf.read_pass || activeSecurity?.read_pass || '';
          }

          const scheme = config.tls ? 'https' : 'http';
          const authPrefix = rUser ? `${encodeURIComponent(rUser)}:${encodeURIComponent(rPass)}@` : '';
          const port = config.port || activeHlsPort;
          const genUrl = `${scheme}://${authPrefix}${config.host || currentHost}:${port}/${pathId || 'stream1'}/index.m3u8`;

          update({
            path_id: pathId,
            read_user: rUser,
            read_pass: rPass,
            auth_user: rUser,
            auth_pass: rPass,
            path: genUrl,
          });
        };

        return (
          <div className="space-y-3">
            {/* Mode Switcher */}
            <div className="flex bg-[var(--input-bg)] p-0.5 rounded-lg border border-[var(--glass-border)]">
              <button
                type="button"
                className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-md transition-colors ${
                  !isMediaMtxMode
                    ? 'bg-amber-500/25 text-[var(--text-primary)] border border-amber-500/40 shadow-sm font-bold'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
                onClick={() => update({
                  mediamtx_mode: false,
                  service_target: undefined,
                  path_id: undefined,
                  provider_service_id: undefined,
                  peer_node_id: undefined,
                  peer_service_id: undefined,
                  mediamtx_target_type: undefined,
                })}
              >
                {t('sources.hlsManualDirect', 'Manual Direct HLS URL')}
              </button>
              <button
                type="button"
                className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 ${
                  isMediaMtxMode
                    ? 'bg-brand-lime/20 text-brand-lime border border-brand-lime/40 shadow-sm font-bold'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
                onClick={() => {
                  if (mediamtxProviders.length > 0) {
                    const defaultProv = mediamtxProviders.find(p => p.id === config.provider_service_id) || mediamtxProviders[0];
                    handleSelectProvider(defaultProv.id);
                  } else if (remoteMtxServices.length > 0) {
                    handleSelectRemotePeer(remoteMtxServices[0].peer.id, remoteMtxServices[0].svc.id);
                  } else {
                    update({
                      mediamtx_mode: true,
                      mediamtx_target_type: 'external',
                      service_target: 'mediamtx',
                      host: config.host && config.host !== '127.0.0.1' ? config.host : '',
                      port: config.port || '8888',
                      path_id: config.path_id || 'stream1',
                      path: `http://${config.host || '127.0.0.1'}:${config.port || '8888'}/${config.path_id || 'stream1'}/index.m3u8`,
                    });
                  }
                }}
              >
                <span>⚡</span>
                {t('sources.hlsMediaMtxHub', 'MediaMTX Hub Integration')}
              </button>
            </div>

            {isMediaMtxMode ? (
              <div className="p-3 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl space-y-3">
                {/* Managed Service vs Manual External Server */}
                <div className="flex bg-[var(--input-bg)] p-0.5 rounded-lg border border-[var(--glass-border)] text-xs">
                  <button
                    type="button"
                    disabled={!hasManagedProviders}
                    className={`flex-1 py-1 px-2 font-bold rounded transition-all flex items-center justify-center gap-1 ${
                      !isExternal && hasManagedProviders
                        ? 'bg-brand-lime/20 text-brand-lime border border-brand-lime/40 shadow-sm'
                        : 'text-[var(--text-secondary)] opacity-60 hover:text-[var(--text-primary)]'
                    }`}
                    onClick={() => {
                      if (mediamtxProviders.length > 0) {
                        const defaultProv = mediamtxProviders.find(p => p.id === config.provider_service_id) || mediamtxProviders[0];
                        if (defaultProv) handleSelectProvider(defaultProv.id);
                      } else if (remoteMtxServices.length > 0) {
                        handleSelectRemotePeer(remoteMtxServices[0].peer.id, remoteMtxServices[0].svc.id);
                      }
                    }}
                  >
                    <span>⚡</span> {t('sources.managedService', 'Managed Service (Local & Peers)')} {!hasManagedProviders ? `(${t('common.none', 'None')})` : ''}
                  </button>
                  <button
                    type="button"
                    className={`flex-1 py-1 px-2 font-bold rounded transition-all flex items-center justify-center gap-1 ${
                      isExternal
                        ? 'bg-brand-lime/20 text-brand-lime border border-brand-lime/40 shadow-sm'
                        : 'text-[var(--text-secondary)] opacity-60 hover:text-[var(--text-primary)]'
                    }`}
                    onClick={() => update({
                      mediamtx_target_type: 'external',
                      provider_service_id: undefined,
                      peer_node_id: undefined,
                      peer_service_id: undefined,
                      host: config.host && config.host !== '127.0.0.1' ? config.host : '',
                      port: config.port || '8888',
                    })}
                  >
                    <span>🌐</span> {t('sources.externalServer', 'Manual External Server (Unfederated Host)')}
                  </button>
                </div>

                {!isExternal ? (
                  <div className="space-y-2.5">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                          {t('sources.selectHubService', 'MediaMTX Service')}
                        </label>
                        <select
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-brand-lime font-mono"
                          value={config.peer_node_id ? `peer:${config.peer_node_id}:${config.peer_service_id}` : (config.provider_service_id || selectedProvider?.id || '')}
                          onChange={e => {
                            const val = e.target.value;
                            if (val.startsWith('peer:')) {
                              const [, pId, sId] = val.split(':');
                              handleSelectRemotePeer(parseInt(pId), parseInt(sId));
                            } else {
                              handleSelectProvider(Number(val));
                            }
                          }}
                        >
                          {mediamtxProviders.length > 0 && (
                            <optgroup label={t('sources.localServices', 'Local Hubs (This Node)')}>
                              {mediamtxProviders.map(p => (
                                <option key={p.id} value={p.id}>
                                  {p.name} (Port :{p.config?.hls_port || 8888})
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {remoteMtxServices.length > 0 && (
                            <optgroup label={t('sources.remotePeers', 'Federated Remote Peers')}>
                              {remoteMtxServices.map(({ peer, svc }) => (
                                <option key={`peer:${peer.id}:${svc.id}`} value={`peer:${peer.id}:${svc.id}`}>
                                  {svc.name} @ {peer.name} ({peer.status === 'online' ? `${peer.latency_ms || 0}ms` : 'offline'})
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </div>
                      <div>
                        <label className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                          {t('sources.streamPath', 'Stream Path')}
                        </label>
                        <select
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-brand-lime font-mono"
                          value={configuredPaths.includes(config.path_id || '') ? config.path_id : '__custom__'}
                          onChange={e => handleSelectPath(e.target.value)}
                        >
                          {configuredPaths.map(pName => (
                            <option key={pName} value={pName}>
                              /{pName} {activePathsDict[pName]?.mode === 'open' ? '(LAN Open)' : ''}
                            </option>
                          ))}
                          <option value="__custom__">{t('sources.customPathOption', '+ Custom Path Slug...')}</option>
                        </select>
                      </div>
                    </div>

                    {/* TLS / HTTPS toggle if supported by hub */}
                    {activeSsl && (
                      <div className="flex items-center justify-between p-2 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg">
                        <div className="text-xs">
                          <span className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                            🔒 {t('sources.enableHttpsHls', 'Encrypted HTTPS HLS Pull (TLS)')}
                          </span>
                          <span className="text-[10px] text-[var(--text-secondary)] block">
                            Port :{activeHlsPort}
                          </span>
                        </div>
                        <input
                          type="checkbox"
                          checked={Boolean(config.tls)}
                          onChange={e => {
                            const useTls = e.target.checked;
                            if (config.peer_node_id && config.peer_service_id) {
                              handleSelectRemotePeer(config.peer_node_id, config.peer_service_id, useTls);
                            } else if (selectedProvider) {
                              handleSelectProvider(selectedProvider.id, useTls);
                            }
                          }}
                          className="accent-brand-lime cursor-pointer w-4 h-4"
                        />
                      </div>
                    )}

                    {(!config.path_id || !configuredPaths.includes(config.path_id)) && (
                      <div>
                        <label className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                          {t('sources.customPathSlug', 'Custom Path Slug')}
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. live1, channel_master"
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-brand-lime"
                          value={config.path_id || ''}
                          onChange={e => {
                            const newPath = e.target.value.replace(/[^a-zA-Z0-9_\-\/]/g, '');
                            const scheme = config.tls ? 'https' : 'http';
                            const rUser = config.read_user || config.auth_user || '';
                            const rPass = config.read_pass || config.auth_pass || '';
                            const authPrefix = rUser ? `${encodeURIComponent(rUser)}:${encodeURIComponent(rPass)}@` : '';
                            update({
                              path_id: newPath,
                              path: `${scheme}://${authPrefix}${config.host || currentHost}:${config.port || activeHlsPort}/${newPath}/index.m3u8`,
                            });
                          }}
                        />
                      </div>
                    )}

                    {/* Generated URL & Auto-computed field */}
                    <div>
                      <label className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                        {t('sources.generatedHlsUrl', 'Generated Source HLS URL')}
                      </label>
                      <input
                        type="text"
                        readOnly
                        className="w-full bg-[var(--input-bg)] border border-brand-lime/40 rounded-lg p-1.5 text-xs font-mono text-brand-lime select-all cursor-pointer"
                        value={config.path || ''}
                      />
                    </div>
                  </div>
                ) : (
                  /* Remote Hub Mode */
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                          {t('sources.remoteHostIp', 'Remote Host / IP')}<span className="text-red-500 ml-0.5">*</span>
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. mediamtx.mycorp.lan"
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-brand-lime"
                          value={config.host || ''}
                          onChange={e => {
                            const h = e.target.value;
                            const port = config.port || '8888';
                            const path = config.path_id || 'stream1';
                            update({ host: h, path: `http://${h}:${port}/${path}/index.m3u8` });
                          }}
                        />
                      </div>
                      <div>
                        <label className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                          {t('sources.port', 'Port')}
                        </label>
                        <input
                          type="text"
                          placeholder="8888"
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-brand-lime"
                          value={config.port || '8888'}
                          onChange={e => {
                            const p = e.target.value;
                            update({ port: p, path: `http://${config.host || '127.0.0.1'}:${p}/${config.path_id || 'stream1'}/index.m3u8` });
                          }}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                        {t('sources.generatedHlsUrl', 'Generated Source HLS URL')}
                      </label>
                      <input
                        type="text"
                        readOnly
                        className="w-full bg-[var(--input-bg)] border border-brand-lime/40 rounded-lg p-1.5 text-xs font-mono text-brand-lime select-all"
                        value={config.path || ''}
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Manual Standalone HLS Mode */
              <div className="space-y-1.5">
                <label htmlFor={`${idPrefix}-hls-path`} className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                  {t('sources.streamUrl', 'Stream URL')}<span className="text-red-500 ml-0.5">*</span>
                </label>
                <input
                  type="text"
                  id={`${idPrefix}-hls-path`}
                  name="path"
                  placeholder="HLS URL (http://server/live/index.m3u8)"
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-brand-lime"
                  value={config.path || ''}
                  onChange={e => update({ path: e.target.value })}
                />
              </div>
            )}
          </div>
        );
      })()}

      {config.type === 'srt' && (() => {
        const mediamtxProviders = providers.filter(p => p.service_type === 'mediamtx_hub');
        const remoteMtxServices = remotePeers.flatMap(peer =>
          (peer.cached_services || peer.cached_services_json || [])
            .filter((s: any) => s.service_type === 'mediamtx_hub')
            .map((s: any) => ({ peer, svc: s }))
        );
        const hasManagedProviders = mediamtxProviders.length > 0 || remoteMtxServices.length > 0;
        const isMediaMtxMode = (config.mediamtx_mode === false || config.service_target === 'manual')
          ? false
          : Boolean(config.mediamtx_mode || config.service_target === 'mediamtx' || config.provider_service_id || config.peer_node_id);
        const isExternal = (config.mediamtx_target_type === 'external' || (config.mediamtx_target_type === 'remote' && !config.peer_node_id)) || (!config.provider_service_id && !config.peer_node_id && !hasManagedProviders);
        const selectedProvider = mediamtxProviders.find(p => p.id === config.provider_service_id) || mediamtxProviders[0];

        // Resolve active paths dictionary and security (Local vs Peer)
        let activePathsDict: Record<string, any> = {};
        let activeSecurity: any = {};
        if (config.peer_node_id) {
          const peer = remotePeers.find(p => p.id === config.peer_node_id);
          const services = peer ? (peer.cached_services || peer.cached_services_json || []) : [];
          const svc = services.find((s: any) => s.id === config.peer_service_id);
          const protos = svc?.protocols || {};
          activeSecurity = protos.security || {};
          const paths = protos.paths || {};
          if (Array.isArray(paths)) {
            for (const p of paths) {
              if (typeof p === 'string') activePathsDict[p] = { mode: 'inherit' };
              else if (p && p.path_id) activePathsDict[p.path_id] = p;
            }
          } else if (typeof paths === 'object' && paths !== null) {
            activePathsDict = paths;
          }
        } else {
          const mtxCfg = selectedProvider?.config || {};
          activeSecurity = mtxCfg.security || {};
          const rawPaths = mtxCfg.paths || {};
          if (Array.isArray(rawPaths)) {
            for (const p of rawPaths) {
              if (typeof p === 'string') activePathsDict[p] = { mode: 'inherit' };
              else if (p && p.path_id) activePathsDict[p.path_id] = p;
            }
          } else if (typeof rawPaths === 'object' && rawPaths !== null) {
            activePathsDict = rawPaths;
          }
        }
        const configuredPaths = Object.keys(activePathsDict);
        const isCustomPath = !config.path_id || !configuredPaths.includes(config.path_id);

        const handleSelectProvider = (provId: number) => {
          const prov = mediamtxProviders.find(p => p.id === provId);
          if (!prov) return;
          const pCfg = prov.config || {};
          const paths = pCfg.paths || {};
          let pKeys: string[] = [];
          let pathsDict: Record<string, any> = {};
          if (Array.isArray(paths)) {
            for (const p of paths) {
              if (typeof p === 'string') { pKeys.push(p); pathsDict[p] = { mode: 'inherit' }; }
              else if (p && p.path_id) { pKeys.push(p.path_id); pathsDict[p.path_id] = p; }
            }
          } else if (typeof paths === 'object' && paths !== null) {
            pKeys = Object.keys(paths);
            pathsDict = paths;
          }
          const firstPath = pKeys.length > 0 ? pKeys[0] : (config.path_id || 'stream1');
          const pathConf = pathsDict[firstPath] || {};

          let rUser = '';
          let rPass = '';
          if (pathConf.mode === 'custom') {
            rUser = pathConf.read_user || '';
            rPass = pathConf.read_pass || '';
          } else if (pathConf.mode !== 'open') {
            rUser = pathConf.read_user || pCfg.security?.read_user || pCfg.read_user || '';
            rPass = pathConf.read_pass || pCfg.security?.read_pass || pCfg.read_pass || '';
          }

          update({
            provider_service_id: prov.id,
            peer_node_id: undefined,
            peer_service_id: undefined,
            service_target: 'mediamtx',
            mediamtx_target_type: 'managed',
            host: '127.0.0.1',
            port: String(pCfg.srt_port || 8890),
            path_id: firstPath,
            read_user: rUser,
            read_pass: rPass,
            auth_user: rUser,
            auth_pass: rPass,
            mode: 'caller',
            stream_action: 'request',
            mediamtx_mode: true,
          });
        };

        const handleSelectRemotePeer = (peerId: number, svcId: number) => {
          const peer = remotePeers.find(p => p.id === peerId);
          if (!peer) return;
          const services = peer.cached_services || peer.cached_services_json || [];
          const svc = services.find((s: any) => s.id === svcId);
          if (!svc) return;

          let host = '127.0.0.1';
          try {
            host = new URL(peer.base_url).hostname;
          } catch {
            host = peer.base_url.replace(/https?:\/\//, '').split(':')[0];
          }

          const protos = svc.protocols || {};
          const srtPort = protos.srt?.port || 8890;
          const paths = protos.paths || {};
          let pKeys: string[] = [];
          let pathsDict: Record<string, any> = {};
          if (Array.isArray(paths)) {
            for (const p of paths) {
              if (typeof p === 'string') { pKeys.push(p); pathsDict[p] = { mode: 'inherit' }; }
              else if (p && p.path_id) { pKeys.push(p.path_id); pathsDict[p.path_id] = p; }
            }
          } else if (typeof paths === 'object' && paths !== null) {
            pKeys = Object.keys(paths);
            pathsDict = paths;
          }
          const firstPath = pKeys.length > 0 ? pKeys[0] : (config.path_id || 'stream1');
          const pathConf = pathsDict[firstPath] || {};

          let rUser = '';
          let rPass = '';
          if (pathConf.mode === 'custom') {
            rUser = pathConf.read_user || '';
            rPass = pathConf.read_pass || '';
          } else if (pathConf.mode !== 'open') {
            rUser = pathConf.read_user || protos.security?.read_user || '';
            rPass = pathConf.read_pass || protos.security?.read_pass || '';
          }

          update({
            peer_node_id: peer.id,
            peer_service_id: svc.id,
            provider_service_id: undefined,
            service_target: 'mediamtx',
            mediamtx_target_type: 'managed',
            host: host,
            port: String(srtPort),
            path_id: firstPath,
            read_user: rUser,
            read_pass: rPass,
            auth_user: rUser,
            auth_pass: rPass,
            mode: 'caller',
            stream_action: 'request',
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
          const pathConf = activePathsDict[val] || {};
          let rUser = '';
          let rPass = '';
          if (pathConf.mode === 'custom') {
            rUser = pathConf.read_user || '';
            rPass = pathConf.read_pass || '';
          } else if (pathConf.mode !== 'open') {
            rUser = pathConf.read_user || activeSecurity?.read_user || '';
            rPass = pathConf.read_pass || activeSecurity?.read_pass || '';
          }

          update({
            path_id: val,
            read_user: rUser,
            read_pass: rPass,
            auth_user: rUser,
            auth_pass: rPass,
          });
        };

        const currentPathConf = activePathsDict[config.path_id || ''];
        const authHint = isMediaMtxMode && !isExternal ? (
          currentPathConf?.mode === 'custom'
            ? t('sources.srtAuthCustomHint', 'Credentials loaded from path-specific rules')
            : currentPathConf?.mode === 'open'
            ? t('sources.srtAuthOpenHint', 'Open path (no credentials required)')
            : (config.read_user || config.auth_user || activeSecurity?.read_user)
            ? t('sources.srtAuthInheritedHint', 'Credentials inherited from MediaMTX global security')
            : null
        ) : null;

        const effectiveReadUser = config.read_user ?? config.auth_user ?? '';
        const effectiveReadPass = config.read_pass ?? config.auth_pass ?? '';
        const streamIdPreview = isMediaMtxMode
          ? `#!::r=${config.path_id || '<path>'},m=request${effectiveReadUser ? `,u=${effectiveReadUser}` : ''}${effectiveReadPass ? `,p=••••••••` : ''}`
          : (config.streamid || '');

        return (
          <div className="space-y-3">
            {/* Connection Mode Switch */}
            <div className="flex bg-[var(--input-bg)] p-0.5 rounded-lg border border-[var(--glass-border)]">
              <button
                type="button"
                className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-md transition-colors ${
                  !isMediaMtxMode
                    ? 'bg-blue-600/30 text-[var(--text-primary)] border border-blue-500/40 shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
                onClick={() => update({
                  mediamtx_mode: false,
                  service_target: undefined,
                  stream_action: undefined,
                  path_id: undefined,
                  provider_service_id: undefined,
                  peer_node_id: undefined,
                  peer_service_id: undefined,
                  mediamtx_target_type: undefined,
                })}
              >
                {t('sources.srtManualDirect', 'Manual Direct SRT')}
              </button>
              <button
                type="button"
                className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 ${
                  isMediaMtxMode
                    ? 'bg-brand-lime/20 text-brand-lime border border-brand-lime/40 shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
                onClick={() => {
                  if (mediamtxProviders.length > 0) {
                    const defaultProv = mediamtxProviders.find(p => p.id === config.provider_service_id) || mediamtxProviders[0];
                    handleSelectProvider(defaultProv.id);
                  } else if (remoteMtxServices.length > 0) {
                    handleSelectRemotePeer(remoteMtxServices[0].peer.id, remoteMtxServices[0].svc.id);
                  } else {
                    update({
                      mediamtx_mode: true,
                      mediamtx_target_type: 'external',
                      mode: 'caller',
                      stream_action: 'request',
                      service_target: 'mediamtx',
                      host: config.host && config.host !== '127.0.0.1' ? config.host : '',
                      port: config.port || '8890',
                      path_id: config.path_id || 'stream1',
                    });
                  }
                }}
              >
                <span>⚡</span>
                {t('sources.srtMediaMtxHub', 'MediaMTX Hub Integration')}
              </button>
            </div>

            {isMediaMtxMode ? (
              /* MediaMTX Hub Integration Mode */
              <div className="space-y-2.5 bg-brand-lime/5 border border-brand-lime/20 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-brand-lime tracking-wider flex items-center gap-1">
                    <span>⚡</span> {t('sources.srtMediaMtxHub', 'MediaMTX Hub Integration')}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-lime/10 text-brand-lime font-mono">
                    caller → request ({config.host || '127.0.0.1'}:{config.port || '8890'})
                  </span>
                </div>

                {/* Sub-selector: Managed Service vs Manual External Server */}
                <div className="flex bg-[var(--input-bg)] p-0.5 rounded-lg border border-[var(--glass-border)] text-xs">
                  <button
                    type="button"
                    disabled={!hasManagedProviders}
                    className={`flex-1 py-1 px-2 font-bold rounded transition-all flex items-center justify-center gap-1 ${
                      !isExternal && hasManagedProviders
                        ? 'bg-brand-lime/20 text-brand-lime border border-brand-lime/40 shadow-sm'
                        : 'text-[var(--text-secondary)] opacity-60 hover:text-[var(--text-primary)]'
                    }`}
                    onClick={() => {
                      if (mediamtxProviders.length > 0) {
                        const defaultProv = mediamtxProviders.find(p => p.id === config.provider_service_id) || mediamtxProviders[0];
                        if (defaultProv) {
                          handleSelectProvider(defaultProv.id);
                        }
                      } else if (remoteMtxServices.length > 0) {
                        handleSelectRemotePeer(remoteMtxServices[0].peer.id, remoteMtxServices[0].svc.id);
                      }
                    }}
                  >
                    <span>⚡</span> {t('sources.managedService', 'Managed Service (Local & Peers)')} {!hasManagedProviders ? `(${t('common.none', 'None')})` : ''}
                  </button>
                  <button
                    type="button"
                    className={`flex-1 py-1 px-2 font-bold rounded transition-all flex items-center justify-center gap-1 ${
                      isExternal
                        ? 'bg-brand-lime/20 text-brand-lime border border-brand-lime/40 shadow-sm'
                        : 'text-[var(--text-secondary)] opacity-60 hover:text-[var(--text-primary)]'
                    }`}
                    onClick={() => update({
                      mediamtx_target_type: 'external',
                      provider_service_id: undefined,
                      peer_node_id: undefined,
                      peer_service_id: undefined,
                      service_target: 'mediamtx',
                      mediamtx_mode: true,
                      mode: 'caller',
                      stream_action: 'request',
                      host: config.host && config.host !== '127.0.0.1' ? config.host : '',
                      port: config.port || '8890',
                      path_id: config.path_id || 'stream1',
                    })}
                  >
                    <span>🌐</span> {t('sources.externalServer', 'Manual External Server (Unfederated Host)')}
                  </button>
                </div>

                {!isExternal ? (
                  /* Managed Hub selector */
                  <div className="space-y-2">
                    <div>
                      <label htmlFor={`${idPrefix}-srt-hub`} className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                        {t('sources.srtSelectHub', 'Source MediaMTX Hub')}
                      </label>
                      <select
                        id={`${idPrefix}-srt-hub`}
                        className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-brand-lime font-mono"
                        value={config.peer_node_id ? `peer:${config.peer_node_id}:${config.peer_service_id}` : (config.provider_service_id || selectedProvider?.id || '')}
                        onChange={e => {
                          const val = e.target.value;
                          if (val.startsWith('peer:')) {
                            const [, pId, sId] = val.split(':');
                            handleSelectRemotePeer(parseInt(pId), parseInt(sId));
                          } else {
                            handleSelectProvider(parseInt(val));
                          }
                        }}
                      >
                        {mediamtxProviders.length > 0 && (
                          <optgroup label={t('sources.localServices', 'Local Hubs (This Node)')}>
                            {mediamtxProviders.map(p => (
                              <option key={p.id} value={p.id}>
                                {p.name} {p.alias ? `(${p.alias})` : ''} — {p.status}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {remoteMtxServices.length > 0 && (
                          <optgroup label={t('sources.remotePeers', 'Federated Remote Peers')}>
                            {remoteMtxServices.map(({ peer, svc }) => (
                              <option key={`peer:${peer.id}:${svc.id}`} value={`peer:${peer.id}:${svc.id}`}>
                                {svc.name} @ {peer.name} ({peer.status === 'online' ? `${peer.latency_ms || 0}ms` : 'offline'})
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor={`${idPrefix}-srt-path-select`} className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                          {t('sources.srtTargetPath', 'Stream Path (Channel)')}
                        </label>
                        <select
                          id={`${idPrefix}-srt-path-select`}
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-brand-lime font-mono"
                          value={isCustomPath ? '__custom__' : (config.path_id || '')}
                          onChange={e => handleSelectPath(e.target.value)}
                        >
                          {configuredPaths.map(pKey => (
                            <option key={pKey} value={pKey}>
                              /{pKey} {activePathsDict[pKey]?.mode ? `(${activePathsDict[pKey].mode})` : ''}
                            </option>
                          ))}
                          <option value="__custom__">{t('sources.srtCustomPath', '✏️ Custom Path Slug...')}</option>
                        </select>
                      </div>

                      <div>
                        <label htmlFor={`${idPrefix}-srt-latency-mtx`} className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                          {t('sources.latencyMs', 'Latency (ms)')}
                        </label>
                        <input
                          type="number"
                          id={`${idPrefix}-srt-latency-mtx`}
                          min={20}
                          max={8000}
                          placeholder="250"
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-brand-lime"
                          value={config.latency || 250}
                          onChange={e => update({ latency: Number(e.target.value) })}
                        />
                      </div>
                    </div>

                    {isCustomPath && (
                      <div>
                        <label htmlFor={`${idPrefix}-srt-path-custom`} className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                          {t('sources.srtCustomPathSlug', 'Custom Path Slug')}
                        </label>
                        <input
                          type="text"
                          id={`${idPrefix}-srt-path-custom`}
                          placeholder={t('sources.srtCustomPathPlaceholder', 'e.g. live, studio_main, tx1')}
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-brand-lime font-mono"
                          value={config.path_id || ''}
                          onChange={e => update({ path_id: e.target.value })}
                        />
                      </div>
                    )}

                    {authHint && (
                      <div className="text-[10px] text-brand-lime/90 bg-brand-lime/10 px-2 py-1 rounded border border-brand-lime/20 flex items-center gap-1.5">
                        <span>🔐</span>
                        <span>{authHint}</span>
                      </div>
                    )}

                    {/* Stream ID Preview */}
                    <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2">
                      <span className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                        {t('sources.srtStreamIdPreview', 'Generated SRT Stream ID & URI')}
                      </span>
                      <p className="text-[11px] font-mono text-brand-lime break-all select-all">
                        srt://{config.host || '127.0.0.1'}:{config.port || '8890'}?mode=caller&latency={config.latency || 250}&streamid={streamIdPreview}
                      </p>
                    </div>
                  </div>
                ) : (
                  /* Remote Server fields */
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor={`${idPrefix}-srt-remote-host`} className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                          {t('sources.srtRemoteHost', 'Remote Host / IP')}<span className="text-red-500 ml-0.5">*</span>
                        </label>
                        <input
                          type="text"
                          id={`${idPrefix}-srt-remote-host`}
                          placeholder="e.g. ingest.streamingserver.com"
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-brand-lime font-mono"
                          value={config.host || ''}
                          onChange={e => update({ host: e.target.value })}
                        />
                      </div>
                      <div>
                        <label htmlFor={`${idPrefix}-srt-remote-port`} className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                          {t('sources.srtRemotePort', 'SRT Port')}<span className="text-red-500 ml-0.5">*</span>
                        </label>
                        <input
                          type="text"
                          id={`${idPrefix}-srt-remote-port`}
                          placeholder="8890"
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-brand-lime font-mono"
                          value={config.port || '8890'}
                          onChange={e => update({ port: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor={`${idPrefix}-srt-remote-path`} className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                          {t('sources.srtTargetPath', 'Stream Path (Channel)')}<span className="text-red-500 ml-0.5">*</span>
                        </label>
                        <input
                          type="text"
                          id={`${idPrefix}-srt-remote-path`}
                          placeholder="e.g. live/cam1, tx_main"
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-brand-lime font-mono"
                          value={config.path_id || ''}
                          onChange={e => update({ path_id: e.target.value })}
                        />
                      </div>
                      <div>
                        <label htmlFor={`${idPrefix}-srt-remote-latency`} className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                          {t('sources.latencyMs', 'Latency (ms)')}
                        </label>
                        <input
                          type="number"
                          id={`${idPrefix}-srt-remote-latency`}
                          min={20}
                          max={8000}
                          placeholder="250"
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-brand-lime"
                          value={config.latency || 250}
                          onChange={e => update({ latency: Number(e.target.value) })}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor={`${idPrefix}-srt-remote-user`} className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                          {t('sources.srtReadUser', 'Read Username (Optional)')}
                        </label>
                        <input
                          type="text"
                          id={`${idPrefix}-srt-remote-user`}
                          placeholder="e.g. consumer"
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-brand-lime"
                          value={config.read_user || config.auth_user || ''}
                          onChange={e => update({ read_user: e.target.value, auth_user: e.target.value })}
                        />
                      </div>
                      <div>
                        <label htmlFor={`${idPrefix}-srt-remote-pass`} className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                          {t('sources.srtReadPass', 'Read Password (Optional)')}
                        </label>
                        <input
                          type="password"
                          id={`${idPrefix}-srt-remote-pass`}
                          placeholder="••••••••"
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-brand-lime"
                          value={config.read_pass || config.auth_pass || ''}
                          onChange={e => update({ read_pass: e.target.value, auth_pass: e.target.value })}
                        />
                      </div>
                    </div>

                    {/* Stream ID Preview */}
                    <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2">
                      <span className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                        {t('sources.srtStreamIdPreview', 'Generated SRT Stream ID & URI')}
                      </span>
                      <p className="text-[11px] font-mono text-brand-lime break-all select-all">
                        srt://{config.host || 'remote.host'}:{config.port || '8890'}?mode=caller&latency={config.latency || 250}&streamid={streamIdPreview}
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
                    <label htmlFor={`${idPrefix}-srt-mode`} className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                      {t('sources.srtConnectionMode', 'SRT Connection Mode')}
                    </label>
                    <select
                      id={`${idPrefix}-srt-mode`}
                      name="mode"
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-blue-400"
                      value={config.mode || 'listener'}
                      onChange={e => {
                        const m = e.target.value;
                        update({ 
                          mode: m, 
                          host: m === 'listener' ? '0.0.0.0' : (config.host === '0.0.0.0' ? '127.0.0.1' : config.host) 
                        });
                      }}
                    >
                      <option value="listener">{t('sources.listenerMode')}</option>
                      <option value="caller">{t('sources.callerMode')}</option>
                      <option value="rendezvous">{t('sources.rendezvousMode')}</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor={`${idPrefix}-host`} className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                      {config.mode === 'listener' ? t('sources.bindInterfaceHost') : t('sources.remoteHostIp')}
                    </label>
                    <input
                      type="text"
                      id={`${idPrefix}-host`}
                      name="host"
                      placeholder={config.mode === 'listener' ? "0.0.0.0 (all interfaces)" : "e.g. 52.210.205.135"}
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-blue-400"
                      value={config.host || ''}
                      onChange={e => update({ host: e.target.value })}
                    />
                  </div>

                  <div>
                    <label htmlFor={`${idPrefix}-port`} className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                      {t('sources.port')}
                    </label>
                    <input
                      type="text"
                      id={`${idPrefix}-port`}
                      name="port"
                      placeholder="9000"
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-blue-400"
                      value={config.port || ''}
                      onChange={e => update({ port: e.target.value })}
                    />
                  </div>

                  <div>
                    <label htmlFor={`${idPrefix}-latency`} className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                      {t('sources.latencyMs')}
                    </label>
                    <input
                      type="number"
                      id={`${idPrefix}-latency`}
                      name="latency"
                      placeholder="200"
                      min={20}
                      max={8000}
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-blue-400"
                      value={config.latency || 200}
                      onChange={e => update({ latency: Number(e.target.value) })}
                    />
                  </div>

                  <div>
                    <label htmlFor={`${idPrefix}-streamid`} className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                      {t('sources.streamId')}
                    </label>
                    <input
                      type="text"
                      id={`${idPrefix}-streamid`}
                      name="streamid"
                      placeholder="e.g. input_stream_1"
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-blue-400"
                      value={config.streamid || ''}
                      onChange={e => update({ streamid: e.target.value })}
                    />
                  </div>

                  {/* Passphrase & Keylen */}
                  <div>
                    <label htmlFor={`${idPrefix}-passphrase`} className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                      {t('sources.srtPassphrase', 'Passphrase (Secret Key)')}
                    </label>
                    <input
                      type="password"
                      id={`${idPrefix}-passphrase`}
                      name="passphrase"
                      placeholder={t('sources.srtPassphrasePlaceholder', 'Enter passphrase (optional)...')}
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-blue-400"
                      value={config.passphrase || ''}
                      onChange={e => update({ passphrase: e.target.value })}
                    />
                  </div>

                  <div>
                    <label htmlFor={`${idPrefix}-pbkeylen`} className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-0.5">
                      {t('sources.srtPbkeylen', 'Key Length (pbkeylen)')}
                    </label>
                    <select
                      id={`${idPrefix}-pbkeylen`}
                      name="pbkeylen"
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-blue-400"
                      value={config.pbkeylen || ''}
                      onChange={e => update({ pbkeylen: e.target.value ? Number(e.target.value) : undefined })}
                    >
                      <option value="">{t('sources.srtPbkeylenDefault', 'Auto / Default')}</option>
                      <option value="16">16 bytes (AES-128)</option>
                      <option value="24">24 bytes (AES-192)</option>
                      <option value="32">32 bytes (AES-256)</option>
                    </select>
                  </div>
                </div>
                
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-2 text-[10px] text-blue-300">
                  {config.mode === 'listener' ? (
                    <span>
                      <strong>Listener Mode:</strong> {t('sources.listenerDesc')} (Port: {config.port || '9000'})
                    </span>
                  ) : config.mode === 'caller' ? (
                    <span>
                      <strong>Caller Mode:</strong> {t('sources.callerDesc')} ({config.host || 'Host'}:{config.port || 'Port'})
                    </span>
                  ) : (
                    <span>
                      <strong>Rendezvous Mode:</strong> {t('sources.rendezvousDesc')}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {config.type === 'ndi' && (
        <div className="space-y-1.5">
          {!avahiAvailable && (
            <div className="bg-brand-orange/10 border border-brand-orange/20 text-brand-orange text-xs p-2.5 rounded-lg leading-relaxed font-bold mb-2 flex flex-col gap-1">
              <div>{t('sources.ndiAvahiWarning')}</div>
              <div>{t('sources.ndiAvahiCommandHint')}</div>
            </div>
          )}
          <label htmlFor={`${idPrefix}-ndi-name`} className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">
            {t('sources.ndiSourceName')}
          </label>
          <div className="flex gap-1.5">
            {!manualNdiMode ? (
              <select
                id={`${idPrefix}-ndi-name`}
                name="name"
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
                <option value="">{t('sources.selectNdiSource')}</option>
                {displayedNdiSources.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
                <option value="__manual__">{t('sources.manualInput')}</option>
              </select>
            ) : (
              <div className="flex w-full gap-1.5">
                <input
                  type="text"
                  id={`${idPrefix}-ndi-name`}
                  name="name"
                  placeholder="NDI Source Name (e.g. MY-PC (OBS))"
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
                  value={config.name || ''}
                  onChange={e => update({ name: e.target.value })}
                />
                <button
                  type="button"
                  className="px-2.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs transition-colors shrink-0"
                  onClick={() => {
                    setManualNdiMode(false);
                    update({ name: ndiSources[0] || '' });
                  }}
                >
                  {t('common.list')}
                </button>
              </div>
            )}
            <button
              type="button"
              disabled={scanningNdi}
              onClick={scanNdi}
              className="px-2.5 bg-brand-lime hover:bg-brand-lime/80 disabled:opacity-50 text-black font-black rounded-lg text-xs transition-colors shrink-0 cursor-pointer"
            >
              {scanningNdi ? t('common.scanning') : t('common.scan')}
            </button>
          </div>
          
          {/* NDI Scan Feedback and Helper Tips */}
          {scanningNdi && (
            <p className="text-[10px] text-brand-orange animate-pulse font-bold mt-1.5">
              {t('sources.scanningNdi')}
            </p>
          )}
          {!scanningNdi && scanResult && (
            <div className="space-y-1 mt-1.5">
              <p className={`text-[10px] font-bold ${scanResult.success && scanResult.count > 0 ? 'text-brand-lime' : 'text-brand-orange'}`}>
                {scanResult.success 
                  ? (scanResult.count > 0 
                    ? t('sources.foundNdiSources', { count: scanResult.count })
                    : t('sources.noNdiSources'))
                  : t('sources.ndiScanError')}
              </p>
              {scanResult.success && scanResult.count > 0 && manualNdiMode && (
                <button
                  type="button"
                  onClick={() => setManualNdiMode(false)}
                  className="text-[9px] text-brand-lime underline hover:text-brand-lime/80 block font-bold cursor-pointer text-left"
                >
                  {t('sources.clickToSelectNdi')}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {config.type === 'udp' && (
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            id={`${idPrefix}-udp-host`}
            name="host"
            placeholder={t('sources.bindInterfaceHost')}
            className="bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
            value={config.host || ''} onChange={e => update({ host: e.target.value })}
          />
          <input
            type="text"
            id={`${idPrefix}-udp-port`}
            name="port"
            placeholder={t('sources.port')}
            className="bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
            value={config.port || ''} onChange={e => update({ port: e.target.value })}
          />
        </div>
      )}

      {config.type === 'rtp' && (
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            id={`${idPrefix}-rtp-host`}
            name="host"
            placeholder={t('sources.remoteHostIp')}
            className="bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
            value={config.host || ''} onChange={e => update({ host: e.target.value })}
          />
          <input
            type="text"
            id={`${idPrefix}-rtp-port`}
            name="port"
            placeholder={t('sources.port')}
            className="bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
            value={config.port || ''} onChange={e => update({ port: e.target.value })}
          />
        </div>
      )}

      {config.type === 'decklink' && (
        <div className="space-y-2">
          <div>
            <label htmlFor={`${idPrefix}-decklink-device`} className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">{t('sources.decklinkDevice')}</label>
            {loadingDevices ? (
              <div className="text-[10px] text-text-secondary animate-pulse">{t('sources.loadingDevices')}</div>
            ) : devices.length === 0 ? (
              <div className="space-y-1.5">
                <div className="text-[10px] text-amber-500 font-medium">{t('sources.noDecklinkDetected')}</div>
                <input
                  type="text"
                  id={`${idPrefix}-decklink-device`}
                  name="device"
                  placeholder="Device name (e.g. DeckLink Mini Recorder)"
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
                      id={`${idPrefix}-decklink-device`}
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
                      <option value="">{t('sources.selectDevice')}</option>
                      {devices.map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                      <option value="__manual__">{t('sources.manualInput')}</option>
                    </select>
                  ) : (
                    <div className="flex flex-col w-full gap-1.5">
                      <div className="flex w-full gap-1.5">
                        <input
                          type="text"
                          id={`${idPrefix}-decklink-device`}
                          name="device"
                          placeholder="Device Name"
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
                          {t('common.list')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div>
            <label htmlFor={`${idPrefix}-decklink-video-input`} className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">{t('sources.videoConnector')}</label>
            <select
              id={`${idPrefix}-decklink-video-input`}
              name="video_input"
              className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
              value={config.video_input || ''}
              onChange={e => update({ video_input: e.target.value })}
            >
              <option value="">{t('sources.defaultUnspecified')}</option>
              <option value="sdi">SDI</option>
              <option value="hdmi">HDMI</option>
              <option value="optical_sdi">Optical SDI</option>
              <option value="component">Component</option>
              <option value="composite">Composite</option>
              <option value="s_video">S-Video</option>
            </select>
          </div>

          <div>
            <label htmlFor={`${idPrefix}-decklink-audio-input`} className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">{t('sources.audioConnector')}</label>
            <select
              id={`${idPrefix}-decklink-audio-input`}
              name="audio_input"
              className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
              value={config.audio_input || ''}
              onChange={e => update({ audio_input: e.target.value })}
            >
              <option value="">{t('sources.defaultUnspecified')}</option>
              <option value="embedded">Embedded (SDI/HDMI)</option>
              <option value="aes_ebu">AES/EBU (Digital)</option>
              <option value="analog">Analog (XLR/RCA)</option>
            </select>
          </div>

          <div>
            <label htmlFor={`${idPrefix}-decklink-format-code`} className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">{t('sources.inputFormat')}</label>
            {manualDeviceMode ? (
              <input
                type="text"
                id={`${idPrefix}-decklink-format-code`}
                name="format_code"
                placeholder="Format code (e.g. hp50)"
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                value={config.format_code || ''}
                onChange={e => update({ format_code: e.target.value })}
              />
            ) : loadingFormats ? (
              <div className="text-[10px] text-text-secondary animate-pulse">{t('sources.loadingFormats')}</div>
            ) : formats.length === 0 ? (
              <input
                type="text"
                id={`${idPrefix}-decklink-format-code`}
                name="format_code"
                placeholder="Format code (e.g. hp50)"
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                value={config.format_code || ''}
                onChange={e => update({ format_code: e.target.value })}
              />
            ) : (
              <select
                id={`${idPrefix}-decklink-format-code`}
                name="format_code"
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono"
                value={config.format_code || ''}
                onChange={e => update({ format_code: e.target.value })}
              >
                <option value="">{t('sources.defaultAutoSdk')}</option>
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
            <label htmlFor={`${idPrefix}-alsa-device`} className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">{t('sources.alsaDevice')}</label>
            {loadingAlsaDevices ? (
              <div className="text-[10px] text-text-secondary animate-pulse">{t('sources.loadingAlsa')}</div>
            ) : alsaDevices.length === 0 ? (
              <div className="space-y-1.5">
                <div className="text-[10px] text-amber-500 font-medium">{t('sources.noAlsaDetected')}</div>
                <input
                  type="text"
                  id={`${idPrefix}-alsa-device`}
                  name="device"
                  placeholder="ALSA Device ID (e.g. hw:0,0)"
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
                  value={config.device || ''}
                  onChange={e => update({ device: e.target.value })}
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex gap-1.5">
                  {!manualAlsaMode ? (
                    <select
                      id={`${idPrefix}-alsa-device`}
                      name="device"
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
                      <option value="">{t('sources.selectAlsa')}</option>
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
                          id={`${idPrefix}-alsa-device`}
                          name="device"
                          placeholder="ALSA Device ID (e.g. hw:0,0)"
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
                          {t('common.list')}
                        </button>
                      </div>
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
            <label htmlFor={`${idPrefix}-v4l2-device`} className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">{t('sources.v4l2Device')}</label>
            {loadingV4l2Devices ? (
              <div className="text-[10px] text-text-secondary animate-pulse">{t('sources.loadingV4l2')}</div>
            ) : v4l2Devices.length === 0 ? (
              <div className="space-y-1.5">
                <div className="text-[10px] text-amber-500 font-medium">{t('sources.noV4l2Detected')}</div>
                <input
                  type="text"
                  id={`${idPrefix}-v4l2-device`}
                  name="device"
                  placeholder="Device Path (e.g. /dev/video0)"
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
                  value={config.device || ''}
                  onChange={e => update({ device: e.target.value })}
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex gap-1.5">
                  {!manualV4l2Mode ? (
                    <select
                      id={`${idPrefix}-v4l2-device`}
                      name="device"
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
                      <option value="">{t('sources.selectV4l2')}</option>
                      {v4l2Devices.map(d => (
                        <option key={d.device} value={d.device}>{d.name} ({d.device})</option>
                      ))}
                      <option value="__manual__">{t('sources.manualInput')}</option>
                    </select>
                  ) : (
                    <div className="flex flex-col w-full gap-1.5">
                      <div className="flex w-full gap-1.5">
                        <input
                          type="text"
                          placeholder="Device Path (e.g. /dev/video0)"
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
                          {t('common.list')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {!manualV4l2Mode && config.device && (
            <div>
              <label htmlFor={`${idPrefix}-v4l2-format`} className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">{t('sources.formatResolution')}</label>
              {loadingV4l2Formats ? (
                <div className="text-[10px] text-text-secondary animate-pulse">{t('sources.loadingFormats')}</div>
              ) : v4l2Formats.length === 0 ? (
                <div className="text-[10px] text-text-secondary italic">No formats detected.</div>
              ) : (
                <select
                  id={`${idPrefix}-v4l2-format`}
                  name="pixel_format"
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
                  <option value="">{t('sources.defaultAutoSdk')}</option>
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
                      <span className="text-[11px] font-semibold text-white">{t('sources.magewellEmbeddedAudio')}</span>
                    </div>
                    <p className="text-[10px] text-text-secondary">
                      {t('sources.magewellAssociatedAlsa')} <span className="font-mono text-lime-400">{selDev.alsa_device}</span>.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSyncAlsaAudio(selDev.alsa_device)}
                    className="text-[10px] bg-lime-500 hover:bg-lime-600 text-black font-bold px-2 py-1 rounded-lg transition-colors whitespace-nowrap self-end sm:self-center"
                  >
                    {t('sources.syncAudio')}
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
            id={`${idPrefix}-lavfi-video-pattern`}
            name="pattern"
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
              <label htmlFor={`${idPrefix}-lavfi-video-size`} className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">{t('sources.resolution')}</label>
              <select
                id={`${idPrefix}-lavfi-video-size`}
                name="size"
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
              <label htmlFor={`${idPrefix}-lavfi-video-rate`} className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">{t('sources.framerate')}</label>
              <select
                id={`${idPrefix}-lavfi-video-rate`}
                name="rate"
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
            id={`${idPrefix}-lavfi-audio-pattern`}
            name="pattern"
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
              <label htmlFor={`${idPrefix}-lavfi-audio-frequency`} className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">{t('sources.frequencyHz')}</label>
              <input
                type="number"
                id={`${idPrefix}-lavfi-audio-frequency`}
                name="frequency"
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
            <label htmlFor={`${idPrefix}-hwaccel`} className="text-brand-lime font-bold text-[10px] uppercase tracking-wider cursor-pointer">{t('sources.hardwareDecoding')}</label>
            <span className="text-[9px] text-white/20 italic ml-auto">-hwaccel</span>
          </div>

          <select
            id={`${idPrefix}-hwaccel`}
            name="hwaccel"
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
            <option value="none">{t('sources.noneSoftware')}</option>
            {(!systemCapabilities || systemCapabilities.nvenc?.available) && (
              <option value="cuda">{t('sources.nvidiaGpuCuda')}</option>
            )}
            {(!systemCapabilities || systemCapabilities.vaapi?.available) && (
              <>
                <option value="vaapi">{t('sources.intelAmdVaapi')}</option>
                <option value="qsv">{t('sources.intelQsv')}</option>
              </>
            )}
            <option value="auto">{t('sources.autoDetect')}</option>
          </select>
          <span className="text-[9px] text-text-secondary block px-1">
            {t('sources.hardwareDecodingDesc')}
          </span>

          {config.hwaccel && config.hwaccel !== 'none' && (
            <div className="mt-1.5 animate-in fade-in duration-200">
              <label htmlFor={`${idPrefix}-hwaccel-output-format`} className="text-[9px] text-text-secondary uppercase font-bold block mb-0.5">
                {t('sources.decodedFramesDest')}
              </label>
              <select
                id={`${idPrefix}-hwaccel-output-format`}
                name="hwaccel_output_format"
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
                <option value="system">{t('sources.systemMemoryCpu')}</option>
                <option value={config.hwaccel}>{t('sources.gpuMemoryVram')}</option>
              </select>
              <span className="text-[9px] text-text-secondary block mt-1 px-1">
                {config.hwaccel_output_format === 'system'
                  ? t('sources.systemMemoryDesc')
                  : t('sources.gpuMemoryDesc')
                }
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default React.memo(InputSourcePanel);
