import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  PencilIcon, 
  TrashIcon, 
  PlusIcon, 
  ShieldIcon, 
  CheckIcon 
} from '../Icons';

interface MediaMtxConfigFormProps {
  initialConfig?: any;
  onCancel: () => void;
  onSubmit: (config: any) => Promise<void> | void;
  API?: string;
}

interface ServicePortMap {
  port: number;
  label: string;
  serviceName: string;
  serviceId: number;
}

export interface PathConfig {
  path_id: string;
  mode: 'inherit' | 'open' | 'custom';
  publish_user?: string;
  publish_pass?: string;
  read_user?: string;
  read_pass?: string;
  run_on_publish?: string;
  source?: string;
}

export const MediaMtxConfigForm: React.FC<MediaMtxConfigFormProps> = ({
  initialConfig,
  onCancel,
  onSubmit,
  API = '',
}) => {
  const { t } = useTranslation();

  const mtxCfg = initialConfig?.config?.mediamtx_config || initialConfig?.mediamtx_config || {};

  const [name, setName] = useState(initialConfig?.name || 'MediaMTX Hub');
  const [alias, setAlias] = useState(initialConfig?.alias || '');
  const [buildId, setBuildId] = useState<number | null>(initialConfig?.ffmpeg_build_id || null);
  const [availableBuilds, setAvailableBuilds] = useState<any[]>([]);

  // Protocol toggles & ports
  const [rtmpEnabled, setRtmpEnabled] = useState(mtxCfg.rtmp_enabled !== false);
  const [rtmpPort, setRtmpPort] = useState(mtxCfg.rtmp_port || 1935);

  const [rtspEnabled, setRtspEnabled] = useState(mtxCfg.rtsp_enabled !== false);
  const [rtspPort, setRtspPort] = useState(mtxCfg.rtsp_port || 8554);
  const [rtpPort, setRtpPort] = useState(mtxCfg.rtp_port || 8000);
  const [rtcpPort, setRtcpPort] = useState(mtxCfg.rtcp_port || 8001);

  const [hlsEnabled, setHlsEnabled] = useState(mtxCfg.hls_enabled !== false);
  const [hlsPort, setHlsPort] = useState(mtxCfg.hls_port || 8888);

  const [webrtcEnabled, setWebrtcEnabled] = useState(mtxCfg.webrtc_enabled !== false);
  const [webrtcPort, setWebrtcPort] = useState(mtxCfg.webrtc_port || 8889);
  const [webrtcUdpPort, setWebrtcUdpPort] = useState(mtxCfg.webrtc_udp_port || 8189);

  const [srtEnabled, setSrtEnabled] = useState(mtxCfg.srt_enabled !== false);
  const [srtPort, setSrtPort] = useState(mtxCfg.srt_port || 8890);

  // SSL / TLS & Secure Protocols
  const [systemSslValid, setSystemSslValid] = useState<boolean>(false);
  const [sslEnabled, setSslEnabled] = useState<boolean>(Boolean(mtxCfg.ssl_enabled));
  const [rtmpsEnabled, setRtmpsEnabled] = useState<boolean>(mtxCfg.rtmps_enabled !== false);
  const [rtmpsPort, setRtmpsPort] = useState<number>(mtxCfg.rtmps_port || 1936);
  const [rtspsEnabled, setRtspsEnabled] = useState<boolean>(mtxCfg.rtsps_enabled !== false);
  const [rtspsPort, setRtspsPort] = useState<number>(mtxCfg.rtsps_port || 8322);

  // Default / Global Security
  const sec = mtxCfg.security || {};
  const initPubUser = sec.publish_user ?? sec.publishUser ?? mtxCfg.publish_user ?? '';
  const initPubPass = sec.publish_pass ?? sec.publishPass ?? mtxCfg.publish_pass ?? '';
  const initReadUser = sec.read_user ?? sec.readUser ?? mtxCfg.read_user ?? '';
  const initReadPass = sec.read_pass ?? sec.readPass ?? mtxCfg.read_pass ?? '';

  const [publishAuthEnabled, setPublishAuthEnabled] = useState<boolean>(
    Boolean(initPubUser || initPubPass)
  );
  const [publishUser, setPublishUser] = useState<string>(initPubUser);
  const [publishPass, setPublishPass] = useState<string>(initPubPass);
  const [showPublishPass, setShowPublishPass] = useState<boolean>(false);

  const [readAuthEnabled, setReadAuthEnabled] = useState<boolean>(
    Boolean(initReadUser || initReadPass)
  );
  const [readUser, setReadUser] = useState<string>(initReadUser);
  const [readPass, setReadPass] = useState<string>(initReadPass);
  const [showReadPass, setShowReadPass] = useState<boolean>(false);

  // Paths CRUD state
  const parseInitialPaths = (): PathConfig[] => {
    const rawPaths = mtxCfg.paths || {};
    if (Array.isArray(rawPaths)) {
      return rawPaths
        .map((p: any) => ({
          path_id: p.name || p.path || p.path_id || '',
          mode: (p.mode || 'inherit') as 'inherit' | 'open' | 'custom',
          publish_user: p.publish_user || p.publishUser || '',
          publish_pass: p.publish_pass || p.publishPass || '',
          read_user: p.read_user || p.readUser || '',
          read_pass: p.read_pass || p.readPass || '',
          run_on_publish: p.run_on_publish || p.runOnPublish || '',
          source: p.source || '',
        }))
        .filter((p) => p.path_id && p.path_id !== 'all_others');
    }
    if (typeof rawPaths === 'object' && rawPaths !== null) {
      return Object.entries(rawPaths)
        .filter(([k]) => k !== 'all_others')
        .map(([path_id, val]: [string, any]) => ({
          path_id,
          mode: (val?.mode || 'inherit') as 'inherit' | 'open' | 'custom',
          publish_user: val?.publish_user || val?.publishUser || '',
          publish_pass: val?.publish_pass || val?.publishPass || '',
          read_user: val?.read_user || val?.readUser || '',
          read_pass: val?.read_pass || val?.readPass || '',
          run_on_publish: val?.run_on_publish || val?.runOnPublish || '',
          source: val?.source || '',
        }));
    }
    return [];
  };

  const [paths, setPaths] = useState<PathConfig[]>(parseInitialPaths());
  const [isEditingPath, setIsEditingPath] = useState<boolean>(false);
  const [editingPathIndex, setEditingPathIndex] = useState<number | null>(null);
  const [currentPathId, setCurrentPathId] = useState<string>('');
  const [currentPathMode, setCurrentPathMode] = useState<'inherit' | 'open' | 'custom'>('inherit');
  const [currentPathPubUser, setCurrentPathPubUser] = useState<string>('');
  const [currentPathPubPass, setCurrentPathPubPass] = useState<string>('');
  const [currentPathReadUser, setCurrentPathReadUser] = useState<string>('');
  const [currentPathReadPass, setCurrentPathReadPass] = useState<string>('');
  const [currentPathShowPubPass, setCurrentPathShowPubPass] = useState<boolean>(false);
  const [currentPathShowReadPass, setCurrentPathShowReadPass] = useState<boolean>(false);
  const [currentPathRunOnPublish, setCurrentPathRunOnPublish] = useState<string>('');
  const [currentPathSource, setCurrentPathSource] = useState<string>('');
  const [pathFormError, setPathFormError] = useState<string | null>(null);

  // API & Diagnostics
  const [apiEnabled, setApiEnabled] = useState(mtxCfg.api_enabled !== false);
  const [apiPort, setApiPort] = useState(mtxCfg.api_port || 9997);

  // Storage
  const [storages, setStorages] = useState<any[]>([]);
  const [hlsStorageId, setHlsStorageId] = useState<number | null>(mtxCfg.hls_storage_id || null);
  const [logStorageId, setLogStorageId] = useState<number | null>(initialConfig?.log_storage_id || null);

  // Lifecycle
  const [autoStart, setAutoStart] = useState(initialConfig?.auto_start || false);
  const [startupOrder, setStartupOrder] = useState(initialConfig?.startup_order ?? 1);
  const [startupDelay, setStartupDelay] = useState(initialConfig?.startup_delay ?? 0);
  const [watchdogEnabled, setWatchdogEnabled] = useState(initialConfig?.watchdog_enabled !== false);

  // Conflict detection
  const [allOtherServicePorts, setAllOtherServicePorts] = useState<ServicePortMap[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check SSL Status
    fetch(`${API}/api/settings/ssl/status`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: any) => {
        if (data && data.valid === true) {
          setSystemSslValid(true);
        } else {
          setSystemSslValid(false);
        }
      })
      .catch((err) => console.error('Error fetching SSL status', err));

    // Fetch MediaMTX builds
    fetch(`${API}/builds`)
      .then((r) => (r.ok ? r.json() : []))
      .then((builds) => {
        const mtxBuilds = builds.filter(
          (b: any) => b.software_type === 'mediamtx' && b.status === 'ready'
        );
        setAvailableBuilds(mtxBuilds);
        if (!buildId && mtxBuilds.length > 0) {
          const def = mtxBuilds.find((b: any) => b.is_default) || mtxBuilds[0];
          setBuildId(def.id);
        }
      })
      .catch((err) => console.error(err));

    // Fetch Storages
    fetch(`${API}/settings/storages`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (Array.isArray(data)) {
          setStorages(data);
          const hlsList = data.filter((s: any) => s.type === 'hls');
          if (hlsList.length === 0) {
            setHlsEnabled(false);
            setHlsStorageId(null);
          } else {
            if (!hlsStorageId) {
              setHlsStorageId(hlsList[0].id);
            }
          }
          const logStorages = data.filter((s: any) => s.type === 'logs');
          if (!logStorageId && logStorages.length > 0) {
            setLogStorageId(logStorages[0].id);
          }
        }
      })
      .catch((err) => console.error(err));

    // Fetch all other services to build real-time port collision map
    fetch(`${API}/processes`)
      .then((r) => (r.ok ? r.json() : []))
      .then((services: any[]) => {
        const portList: ServicePortMap[] = [];
        const currentId = initialConfig?.id;
        for (const s of services) {
          if (currentId && s.id === currentId) continue;
          const sType = s.service_type || 'ffmpeg_stream';
          const cfg = s.config?.mediamtx_config || s.config || {};
          if (sType === 'mediamtx_hub') {
            if (cfg.rtmp_enabled !== false && cfg.rtmp_port) {
              portList.push({ port: Number(cfg.rtmp_port), label: 'RTMP', serviceName: s.name, serviceId: s.id });
            }
            if (cfg.ssl_enabled && cfg.rtmps_enabled && cfg.rtmps_port) {
              portList.push({ port: Number(cfg.rtmps_port), label: 'RTMPS', serviceName: s.name, serviceId: s.id });
            }
            if (cfg.rtsp_enabled !== false) {
              if (cfg.rtsp_port) portList.push({ port: Number(cfg.rtsp_port), label: 'RTSP', serviceName: s.name, serviceId: s.id });
              portList.push({ port: Number(cfg.rtp_port || 8000), label: 'RTP', serviceName: s.name, serviceId: s.id });
              portList.push({ port: Number(cfg.rtcp_port || 8001), label: 'RTCP', serviceName: s.name, serviceId: s.id });
            }
            if (cfg.ssl_enabled && cfg.rtsps_enabled && cfg.rtsps_port) {
              portList.push({ port: Number(cfg.rtsps_port), label: 'RTSPS', serviceName: s.name, serviceId: s.id });
            }
            if (cfg.hls_enabled !== false && cfg.hls_port) {
              portList.push({ port: Number(cfg.hls_port), label: 'HLS', serviceName: s.name, serviceId: s.id });
            }
            if (cfg.webrtc_enabled !== false) {
              if (cfg.webrtc_port) portList.push({ port: Number(cfg.webrtc_port), label: 'WebRTC HTTP', serviceName: s.name, serviceId: s.id });
              portList.push({ port: Number(cfg.webrtc_udp_port || 8189), label: 'WebRTC UDP', serviceName: s.name, serviceId: s.id });
            }
            if (cfg.srt_enabled && cfg.srt_port) {
              portList.push({ port: Number(cfg.srt_port), label: 'SRT', serviceName: s.name, serviceId: s.id });
            }
            if (cfg.api_enabled !== false) {
              portList.push({ port: Number(cfg.api_port || 9997), label: 'API', serviceName: s.name, serviceId: s.id });
            }
          } else if (sType === 'icecast_server') {
            const ice = s.config?.icecast_config || s.config || {};
            if (ice.port) portList.push({ port: Number(ice.port), label: 'Icecast', serviceName: s.name, serviceId: s.id });
          }
        }
        setAllOtherServicePorts(portList);
      })
      .catch((err) => console.error('Error fetching processes for port mapping', err));
  }, [API, initialConfig?.id]);

  const handleAutoAssignFreePorts = async () => {
    try {
      const url = initialConfig?.id
        ? `${API}/api/services/mediamtx/next-available-ports?exclude_service_id=${initialConfig.id}`
        : `${API}/api/services/mediamtx/next-available-ports`;
      const res = await fetch(url);
      if (res.ok) {
        const freePorts = await res.json();
        if (freePorts.rtmp_port) setRtmpPort(freePorts.rtmp_port);
        if (freePorts.rtmps_port) setRtmpsPort(freePorts.rtmps_port);
        if (freePorts.rtsp_port) setRtspPort(freePorts.rtsp_port);
        if (freePorts.rtsps_port) setRtspsPort(freePorts.rtsps_port);
        if (freePorts.rtp_port) setRtpPort(freePorts.rtp_port);
        if (freePorts.rtcp_port) setRtcpPort(freePorts.rtcp_port);
        if (freePorts.hls_port) setHlsPort(freePorts.hls_port);
        if (freePorts.webrtc_port) setWebrtcPort(freePorts.webrtc_port);
        if (freePorts.webrtc_udp_port) setWebrtcUdpPort(freePorts.webrtc_udp_port);
        if (freePorts.srt_port) setSrtPort(freePorts.srt_port);
        if (freePorts.api_port) setApiPort(freePorts.api_port);
      }
    } catch (err) {
      console.error('Failed to auto-assign free ports', err);
    }
  };

  const getConflict = (portNum: number) => {
    if (!portNum) return null;
    return allOtherServicePorts.find((p) => p.port === portNum);
  };

  // Active ports in current form
  const activeFormPorts = [
    ...(rtmpEnabled ? [{ port: Number(rtmpPort), label: 'RTMP' }] : []),
    ...(sslEnabled && rtmpsEnabled ? [{ port: Number(rtmpsPort), label: 'RTMPS' }] : []),
    ...(rtspEnabled
      ? [
          { port: Number(rtspPort), label: 'RTSP' },
          { port: Number(rtpPort), label: 'RTP' },
          { port: Number(rtcpPort), label: 'RTCP' },
        ]
      : []),
    ...(sslEnabled && rtspsEnabled ? [{ port: Number(rtspsPort), label: 'RTSPS' }] : []),
    ...(hlsEnabled ? [{ port: Number(hlsPort), label: 'HLS' }] : []),
    ...(webrtcEnabled
      ? [
          { port: Number(webrtcPort), label: 'WebRTC HTTP' },
          { port: Number(webrtcUdpPort), label: 'WebRTC UDP' },
        ]
      : []),
    ...(srtEnabled ? [{ port: Number(srtPort), label: 'SRT' }] : []),
    ...(apiEnabled ? [{ port: Number(apiPort), label: 'API' }] : []),
  ];

  const hasInternalDuplicate = () => {
    const seen = new Set<number>();
    for (const item of activeFormPorts) {
      if (seen.has(item.port)) return true;
      seen.add(item.port);
    }
    return false;
  };

  const hasExternalCollision = () => {
    return activeFormPorts.some((item) => getConflict(item.port) !== undefined);
  };

  const hasAnyConflict = hasInternalDuplicate() || hasExternalCollision();

  // Paths management handlers
  const handleOpenAddPath = () => {
    setIsEditingPath(true);
    setEditingPathIndex(null);
    setCurrentPathId('');
    setCurrentPathMode('inherit');
    setCurrentPathPubUser('');
    setCurrentPathPubPass('');
    setCurrentPathReadUser('');
    setCurrentPathReadPass('');
    setCurrentPathRunOnPublish('');
    setCurrentPathSource('');
    setPathFormError(null);
  };

  const handleOpenEditPath = (index: number) => {
    const p = paths[index];
    if (!p) return;
    setIsEditingPath(true);
    setEditingPathIndex(index);
    setCurrentPathId(p.path_id);
    setCurrentPathMode(p.mode || 'inherit');
    setCurrentPathPubUser(p.publish_user || '');
    setCurrentPathPubPass(p.publish_pass || '');
    setCurrentPathReadUser(p.read_user || '');
    setCurrentPathReadPass(p.read_pass || '');
    setCurrentPathRunOnPublish(p.run_on_publish || '');
    setCurrentPathSource(p.source || '');
    setPathFormError(null);
  };

  const handleSavePath = () => {
    const cleanId = currentPathId.trim();
    if (!cleanId) {
      setPathFormError(t('services.mediamtx.pathIdRequired', 'Path ID is required'));
      return;
    }

    // Check duplicate path_id
    const isDuplicate = paths.some((p, idx) => p.path_id === cleanId && idx !== editingPathIndex);
    if (isDuplicate) {
      setPathFormError(t('services.mediamtx.pathDuplicate', 'Path ID already exists'));
      return;
    }

    const newPath: PathConfig = {
      path_id: cleanId,
      mode: currentPathMode,
      source: currentPathSource.trim() || undefined,
      run_on_publish: currentPathRunOnPublish.trim() || undefined,
      publish_user: currentPathMode === 'custom' ? currentPathPubUser.trim() : undefined,
      publish_pass: currentPathMode === 'custom' ? currentPathPubPass : undefined,
      read_user: currentPathMode === 'custom' ? currentPathReadUser.trim() : undefined,
      read_pass: currentPathMode === 'custom' ? currentPathReadPass : undefined,
    };

    if (editingPathIndex !== null) {
      const updated = [...paths];
      updated[editingPathIndex] = newPath;
      setPaths(updated);
    } else {
      setPaths([...paths, newPath]);
    }

    setIsEditingPath(false);
    setEditingPathIndex(null);
    setPathFormError(null);
  };

  const handleDeletePath = (index: number) => {
    setPaths(paths.filter((_, idx) => idx !== index));
    if (isEditingPath && editingPathIndex === index) {
      setIsEditingPath(false);
      setEditingPathIndex(null);
    }
  };

  const handleCancelPathEdit = () => {
    setIsEditingPath(false);
    setEditingPathIndex(null);
    setPathFormError(null);
  };

  const hasCredentialsSet = Boolean(
    (publishAuthEnabled && (publishUser || publishPass)) ||
    (readAuthEnabled && (readUser || readPass))
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(t('services.nameRequired', 'Service name is required'));
      return;
    }
    if (!buildId) {
      setError(t('services.mediamtx.buildRequired', 'Please select or provision a MediaMTX build in Settings -> Software first.'));
      return;
    }

    if (hasAnyConflict) {
      setError(t('services.mediamtx.resolvePortConflicts', 'Please resolve highlighted port conflicts before saving.'));
      return;
    }

    setIsSubmitting(true);
    setError(null);

    // Build paths dictionary
    const pathsMap: Record<string, any> = {};
    for (const p of paths) {
      if (!p.path_id.trim()) continue;
      const pid = p.path_id.trim();
      const pEntry: Record<string, any> = {
        mode: p.mode,
      };
      if (p.source && p.source.trim()) pEntry.source = p.source.trim();
      if (p.run_on_publish && p.run_on_publish.trim()) pEntry.run_on_publish = p.run_on_publish.trim();
      if (p.mode === 'custom') {
        pEntry.publish_user = p.publish_user ? p.publish_user.trim() : '';
        pEntry.publish_pass = p.publish_pass || '';
        pEntry.read_user = p.read_user ? p.read_user.trim() : '';
        pEntry.read_pass = p.read_pass || '';
      }
      pathsMap[pid] = pEntry;
    }

    const payload = {
      name: name.trim(),
      alias: alias.trim() || undefined,
      type: 'service',
      service_type: 'mediamtx_hub',
      ffmpeg_build_id: buildId,
      auto_start: autoStart,
      startup_order: Number(startupOrder) || 1,
      startup_delay: Number(startupDelay) || 0,
      watchdog_enabled: watchdogEnabled,
      log_storage_id: logStorageId ? Number(logStorageId) : null,
      config: {
        mediamtx_config: {
          rtmp_enabled: rtmpEnabled,
          rtmp_port: Number(rtmpPort) || 1935,
          rtsp_enabled: rtspEnabled,
          rtsp_port: Number(rtspPort) || 8554,
          rtp_port: Number(rtpPort) || 8000,
          rtcp_port: Number(rtcpPort) || 8001,
          hls_enabled: hlsEnabled,
          hls_port: Number(hlsPort) || 8888,
          hls_storage_id: hlsStorageId ? Number(hlsStorageId) : null,
          webrtc_enabled: webrtcEnabled,
          webrtc_port: Number(webrtcPort) || 8889,
          webrtc_udp_port: Number(webrtcUdpPort) || 8189,
          srt_enabled: srtEnabled,
          srt_port: Number(srtPort) || 8890,
          api_enabled: apiEnabled,
          api_port: Number(apiPort) || 9997,
          ssl_enabled: sslEnabled,
          rtmps_enabled: sslEnabled && rtmpsEnabled,
          rtmps_port: Number(rtmpsPort) || 1936,
          rtsps_enabled: sslEnabled && rtspsEnabled,
          rtsps_port: Number(rtspsPort) || 8322,
          security: {
            publish_user: publishAuthEnabled ? publishUser.trim() : '',
            publish_pass: publishAuthEnabled ? publishPass : '',
            read_user: readAuthEnabled ? readUser.trim() : '',
            read_pass: readAuthEnabled ? readPass : '',
          },
          paths: pathsMap,
        },
      },
    };

    try {
      await onSubmit(payload);
    } catch (err: any) {
      setError(err.message || 'Error saving service');
    } finally {
      setIsSubmitting(false);
    }
  };

  const hlsStorages = storages.filter((s) => s.type === 'hls');
  const logStorages = storages.filter((s) => s.type === 'logs');

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 overflow-y-auto max-h-[80vh] p-1 custom-scrollbar text-[var(--text-primary)]">
      {error && (
        <div className="bg-red-500/15 border border-red-500/40 text-red-300 text-xs px-3 py-2 rounded-xl flex items-center gap-2">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* Section 1: General & Engine Build */}
      <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3.5 space-y-3">
        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] pb-2">
          <span className="w-2 h-2 rounded-full bg-brand-lime" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-brand-lime">
            {t('services.mediamtx.generalConfig', '1. General & Binary Build')}
          </h4>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div>
            <label className="block text-[11px] font-bold text-[var(--text-secondary)] uppercase mb-1">
              {t('services.serviceName', 'Service Name')} *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Master MediaMTX Hub"
              className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg px-3 py-1.5 focus:border-brand-lime outline-none text-xs"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-[var(--text-secondary)] uppercase mb-1">
              {t('services.lcdAlias', 'LCD / Short Alias')} (Max 12 chars)
            </label>
            <input
              type="text"
              maxLength={12}
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="e.g. MTX-HUB"
              className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg px-3 py-1.5 focus:border-brand-lime outline-none text-xs font-mono"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-[11px] font-bold text-[var(--text-secondary)] uppercase mb-1">
              {t('services.mediamtx.selectBinary', 'MediaMTX Binary Release')} *
            </label>
            {availableBuilds.length > 0 ? (
              <select
                value={buildId || ''}
                onChange={(e) => setBuildId(Number(e.target.value))}
                className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg px-3 py-1.5 focus:border-brand-lime outline-none text-xs font-mono"
              >
                {availableBuilds.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} (v{b.version_tag}) {b.is_default ? '★ Default' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
                {t('services.mediamtx.noBuildsWarning', 'No MediaMTX release found. Please go to Settings -> Software to download an official release or register your system binary.')}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Section 2: Active Protocols & Ports */}
      <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3.5 space-y-3">
        <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-400">
              {t('services.mediamtx.protocolsTitle', '2. Live Streaming Protocols & Ports')}
            </h4>
          </div>
          <button
            type="button"
            onClick={handleAutoAssignFreePorts}
            className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-brand-lime/10 hover:bg-brand-lime/20 text-brand-lime border border-brand-lime/30 flex items-center gap-1.5 transition-all hover:scale-105 cursor-pointer shadow-sm"
          >
            <span>⚡</span>
            <span>{t('services.mediamtx.suggestFreePorts', 'Auto-assign Free Ports')}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
          {/* RTMP */}
          <div className={`bg-[var(--bg-card)] border rounded-lg p-2.5 space-y-2 ${rtmpEnabled && getConflict(rtmpPort) ? 'border-red-500/50 bg-red-500/5' : 'border-[var(--glass-border)]'}`}>
            <div className="flex items-center justify-between">
              <span className="font-bold uppercase tracking-wider text-xs">RTMP</span>
              <input
                type="checkbox"
                checked={rtmpEnabled}
                onChange={(e) => setRtmpEnabled(e.target.checked)}
                className="rounded text-brand-lime"
              />
            </div>
            {rtmpEnabled && (
              <div>
                <label className="text-[10px] text-[var(--text-secondary)] block mb-0.5">Port (TCP)</label>
                <input
                  type="number"
                  value={rtmpPort}
                  onChange={(e) => setRtmpPort(Number(e.target.value))}
                  className={`w-full bg-[var(--input-bg)] border rounded px-2 py-1 text-xs font-mono ${getConflict(rtmpPort) ? 'border-red-500 text-red-300' : 'border-[var(--glass-border)]'}`}
                />
                {getConflict(rtmpPort) && (
                  <span className="text-[10px] text-red-400 block mt-1 leading-tight">
                    ⚠️ {t('services.mediamtx.portConflict', { port: rtmpPort, service: getConflict(rtmpPort)?.serviceName })}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* RTSP with RTP/RTCP Transport */}
          <div className={`bg-[var(--bg-card)] border rounded-lg p-2.5 space-y-2 sm:col-span-2 ${rtspEnabled && (getConflict(rtspPort) || getConflict(rtpPort) || getConflict(rtcpPort)) ? 'border-red-500/50 bg-red-500/5' : 'border-[var(--glass-border)]'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-bold uppercase tracking-wider text-xs">RTSP & UDP Transport</span>
              </div>
              <input
                type="checkbox"
                checked={rtspEnabled}
                onChange={(e) => setRtspEnabled(e.target.checked)}
                className="rounded text-brand-lime"
              />
            </div>
            {rtspEnabled && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                <div>
                  <label className="text-[10px] text-[var(--text-secondary)] block mb-0.5">RTSP (TCP)</label>
                  <input
                    type="number"
                    value={rtspPort}
                    onChange={(e) => setRtspPort(Number(e.target.value))}
                    className={`w-full bg-[var(--input-bg)] border rounded px-2 py-1 text-xs font-mono ${getConflict(rtspPort) ? 'border-red-500 text-red-300' : 'border-[var(--glass-border)]'}`}
                  />
                  {getConflict(rtspPort) && (
                    <span className="text-[9px] text-red-400 block mt-0.5 leading-tight">
                      ⚠️ {getConflict(rtspPort)?.serviceName}
                    </span>
                  )}
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-secondary)] block mb-0.5">RTP (UDP)</label>
                  <input
                    type="number"
                    value={rtpPort}
                    onChange={(e) => setRtpPort(Number(e.target.value))}
                    className={`w-full bg-[var(--input-bg)] border rounded px-2 py-1 text-xs font-mono ${getConflict(rtpPort) ? 'border-red-500 text-red-300' : 'border-[var(--glass-border)]'}`}
                  />
                  {getConflict(rtpPort) && (
                    <span className="text-[9px] text-red-400 block mt-0.5 leading-tight">
                      ⚠️ {getConflict(rtpPort)?.serviceName}
                    </span>
                  )}
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-secondary)] block mb-0.5">RTCP (UDP)</label>
                  <input
                    type="number"
                    value={rtcpPort}
                    onChange={(e) => setRtcpPort(Number(e.target.value))}
                    className={`w-full bg-[var(--input-bg)] border rounded px-2 py-1 text-xs font-mono ${getConflict(rtcpPort) ? 'border-red-500 text-red-300' : 'border-[var(--glass-border)]'}`}
                  />
                  {getConflict(rtcpPort) && (
                    <span className="text-[9px] text-red-400 block mt-0.5 leading-tight">
                      ⚠️ {getConflict(rtcpPort)?.serviceName}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* HLS */}
          <div className={`bg-[var(--bg-card)] border rounded-lg p-2.5 space-y-2 ${hlsEnabled && getConflict(hlsPort) ? 'border-red-500/50 bg-red-500/5' : 'border-[var(--glass-border)]'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="font-bold uppercase tracking-wider text-xs">HLS (HTTP)</span>
                {hlsStorages.length === 0 && (
                  <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20" title={t('services.mediamtx.noHlsStorageNotice', 'No HLS storage configured')}>
                    {t('services.mediamtx.noStorage', 'No Storage')}
                  </span>
                )}
              </div>
              <input
                type="checkbox"
                disabled={hlsStorages.length === 0}
                checked={hlsEnabled && hlsStorages.length > 0}
                onChange={(e) => setHlsEnabled(e.target.checked)}
                className="rounded text-brand-lime disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
              />
            </div>
            {hlsEnabled && hlsStorages.length > 0 && (
              <div>
                <label className="text-[10px] text-[var(--text-secondary)] block mb-0.5">Port (HTTP)</label>
                <input
                  type="number"
                  value={hlsPort}
                  onChange={(e) => setHlsPort(Number(e.target.value))}
                  className={`w-full bg-[var(--input-bg)] border rounded px-2 py-1 text-xs font-mono ${getConflict(hlsPort) ? 'border-red-500 text-red-300' : 'border-[var(--glass-border)]'}`}
                />
                {getConflict(hlsPort) && (
                  <span className="text-[10px] text-red-400 block mt-1 leading-tight">
                    ⚠️ {t('services.mediamtx.portConflict', { port: hlsPort, service: getConflict(hlsPort)?.serviceName })}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* WebRTC */}
          <div className={`bg-[var(--bg-card)] border rounded-lg p-2.5 space-y-2 ${webrtcEnabled && (getConflict(webrtcPort) || getConflict(webrtcUdpPort)) ? 'border-red-500/50 bg-red-500/5' : 'border-[var(--glass-border)]'}`}>
            <div className="flex items-center justify-between">
              <span className="font-bold uppercase tracking-wider text-xs">WebRTC (WHEP)</span>
              <input
                type="checkbox"
                checked={webrtcEnabled}
                onChange={(e) => setWebrtcEnabled(e.target.checked)}
                className="rounded text-brand-lime"
              />
            </div>
            {webrtcEnabled && (
              <div className="space-y-2">
                <div>
                  <label className="text-[10px] text-[var(--text-secondary)] block mb-0.5">{t('services.mediamtx.webrtcPort', 'Signaling Port (HTTP/WHEP)')}</label>
                  <input
                    type="number"
                    value={webrtcPort}
                    onChange={(e) => setWebrtcPort(Number(e.target.value))}
                    className={`w-full bg-[var(--input-bg)] border rounded px-2 py-1 text-xs font-mono ${getConflict(webrtcPort) ? 'border-red-500 text-red-300' : 'border-[var(--glass-border)]'}`}
                  />
                  {getConflict(webrtcPort) && (
                    <span className="text-[9px] text-red-400 block mt-0.5 leading-tight">
                      ⚠️ {getConflict(webrtcPort)?.serviceName}
                    </span>
                  )}
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-secondary)] block mb-0.5">{t('services.mediamtx.webrtcUdpPort', 'Media / ICE Port (UDP)')}</label>
                  <input
                    type="number"
                    value={webrtcUdpPort}
                    onChange={(e) => setWebrtcUdpPort(Number(e.target.value))}
                    className={`w-full bg-[var(--input-bg)] border rounded px-2 py-1 text-xs font-mono ${getConflict(webrtcUdpPort) ? 'border-red-500 text-red-300' : 'border-[var(--glass-border)]'}`}
                  />
                  {getConflict(webrtcUdpPort) && (
                    <span className="text-[9px] text-red-400 block mt-0.5 leading-tight">
                      ⚠️ {getConflict(webrtcUdpPort)?.serviceName}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* SRT */}
          <div className={`bg-[var(--bg-card)] border rounded-lg p-2.5 space-y-2 ${srtEnabled && getConflict(srtPort) ? 'border-red-500/50 bg-red-500/5' : 'border-[var(--glass-border)]'}`}>
            <div className="flex items-center justify-between">
              <span className="font-bold uppercase tracking-wider text-xs">SRT</span>
              <input
                type="checkbox"
                checked={srtEnabled}
                onChange={(e) => setSrtEnabled(e.target.checked)}
                className="rounded text-brand-lime"
              />
            </div>
            {srtEnabled && (
              <div>
                <label className="text-[10px] text-[var(--text-secondary)] block mb-0.5">Port (UDP)</label>
                <input
                  type="number"
                  value={srtPort}
                  onChange={(e) => setSrtPort(Number(e.target.value))}
                  className={`w-full bg-[var(--input-bg)] border rounded px-2 py-1 text-xs font-mono ${getConflict(srtPort) ? 'border-red-500 text-red-300' : 'border-[var(--glass-border)]'}`}
                />
                {getConflict(srtPort) && (
                  <span className="text-[10px] text-red-400 block mt-1 leading-tight">
                    ⚠️ {t('services.mediamtx.portConflict', { port: srtPort, service: getConflict(srtPort)?.serviceName })}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Master TLS/SSL & Secure Ports Subcard */}
        <div className="mt-3 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-3 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--glass-border)] pb-2.5">
            <div className="flex items-center gap-2">
              <ShieldIcon size={16} className={sslEnabled ? 'text-emerald-400' : 'text-[var(--text-secondary)]'} />
              <div>
                <span className="font-bold text-xs block text-[var(--text-primary)]">
                  {t('services.mediamtx.sslEnabled', 'Habilitar TLS / SSL Seguro')}
                </span>
                {!systemSslValid && (
                  <span className="text-[10px] text-amber-400 block">
                    {t('services.mediamtx.sslRequiresCert', '(Requiere configurar un certificado en Ajustes → SSL)')}
                  </span>
                )}
              </div>
            </div>

            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                disabled={!systemSslValid && !sslEnabled}
                checked={sslEnabled}
                onChange={(e) => setSslEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500 peer-disabled:opacity-40 peer-disabled:cursor-not-allowed"></div>
            </label>
          </div>

          {sslEnabled && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 text-xs">
              {/* RTMPS */}
              <div className={`bg-[var(--input-bg)] border rounded-lg p-2.5 space-y-2 ${rtmpsEnabled && getConflict(rtmpsPort) ? 'border-red-500/50 bg-red-500/5' : 'border-[var(--glass-border)]'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold uppercase tracking-wider text-xs">RTMPS (TLS)</span>
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                      SSL
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={rtmpsEnabled}
                    onChange={(e) => setRtmpsEnabled(e.target.checked)}
                    className="rounded text-brand-lime"
                  />
                </div>
                {rtmpsEnabled && (
                  <div>
                    <label className="text-[10px] text-[var(--text-secondary)] block mb-0.5">
                      {t('services.mediamtx.rtmpsPort', 'Puerto RTMPS (TCP / TLS)')}
                    </label>
                    <input
                      type="number"
                      value={rtmpsPort}
                      onChange={(e) => setRtmpsPort(Number(e.target.value))}
                      className={`w-full bg-[var(--bg-card)] border rounded px-2 py-1 text-xs font-mono ${getConflict(rtmpsPort) ? 'border-red-500 text-red-300' : 'border-[var(--glass-border)]'}`}
                    />
                    {getConflict(rtmpsPort) && (
                      <span className="text-[10px] text-red-400 block mt-1 leading-tight">
                        ⚠️ {t('services.mediamtx.portConflict', { port: rtmpsPort, service: getConflict(rtmpsPort)?.serviceName })}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* RTSPS */}
              <div className={`bg-[var(--input-bg)] border rounded-lg p-2.5 space-y-2 ${rtspsEnabled && getConflict(rtspsPort) ? 'border-red-500/50 bg-red-500/5' : 'border-[var(--glass-border)]'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold uppercase tracking-wider text-xs">RTSPS (TLS)</span>
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                      SSL
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={rtspsEnabled}
                    onChange={(e) => setRtspsEnabled(e.target.checked)}
                    className="rounded text-brand-lime"
                  />
                </div>
                {rtspsEnabled && (
                  <div>
                    <label className="text-[10px] text-[var(--text-secondary)] block mb-0.5">
                      {t('services.mediamtx.rtspsPort', 'Puerto RTSPS (TCP / TLS)')}
                    </label>
                    <input
                      type="number"
                      value={rtspsPort}
                      onChange={(e) => setRtspsPort(Number(e.target.value))}
                      className={`w-full bg-[var(--bg-card)] border rounded px-2 py-1 text-xs font-mono ${getConflict(rtspsPort) ? 'border-red-500 text-red-300' : 'border-[var(--glass-border)]'}`}
                    />
                    {getConflict(rtspsPort) && (
                      <span className="text-[10px] text-red-400 block mt-1 leading-tight">
                        ⚠️ {t('services.mediamtx.portConflict', { port: rtspsPort, service: getConflict(rtspsPort)?.serviceName })}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Section 3: Default / Global Security & Access Control */}
      <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3.5 space-y-3">
        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] pb-2">
          <ShieldIcon size={14} className="text-amber-400" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400">
            {t('services.mediamtx.securityTitle', '3. Seguridad y Control de Acceso por Defecto')}
          </h4>
        </div>

        {/* Security Warning Banner if passwords set without SSL */}
        {hasCredentialsSet && !sslEnabled && (
          <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs px-3 py-2 rounded-xl flex items-center gap-2">
            <span>ℹ️</span>
            <span>{t('services.mediamtx.plainTextWarning', 'Las credenciales viajarán en texto plano por la red salvo que habilites TLS o utilices un canal seguro.')}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          {/* Publish / Push Auth */}
          <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg p-3 space-y-2.5">
            <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2">
              <div>
                <span className="font-bold text-xs block text-[var(--text-primary)]">
                  {t('services.mediamtx.publishAuthTitle', 'Inyección (Publish / Push)')}
                </span>
                <span className="text-[10px] text-[var(--text-secondary)] block">
                  {t('services.mediamtx.publishAuthDesc', 'Requerir credenciales para publicar o inyectar streams en el hub.')}
                </span>
              </div>
              <input
                type="checkbox"
                checked={publishAuthEnabled}
                onChange={(e) => {
                  setPublishAuthEnabled(e.target.checked);
                  if (!e.target.checked) {
                    setPublishUser('');
                    setPublishPass('');
                  }
                }}
                className="rounded text-brand-lime"
              />
            </div>

            {publishAuthEnabled && (
              <div className="space-y-2 pt-1">
                <div>
                  <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase block mb-1">
                    {t('services.mediamtx.publishUser', 'Usuario de Inyección')}
                  </label>
                  <input
                    type="text"
                    value={publishUser}
                    onChange={(e) => setPublishUser(e.target.value)}
                    placeholder="e.g. publisher"
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded px-2.5 py-1.5 text-xs focus:border-brand-lime outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase block mb-1">
                    {t('services.mediamtx.publishPass', 'Contraseña de Inyección')}
                  </label>
                  <div className="relative">
                    <input
                      type={showPublishPass ? 'text' : 'password'}
                      value={publishPass}
                      onChange={(e) => setPublishPass(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded px-2.5 py-1.5 pr-8 text-xs focus:border-brand-lime outline-none font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPublishPass(!showPublishPass)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer text-xs"
                      title={showPublishPass ? 'Hide password' : 'Show password'}
                    >
                      {showPublishPass ? '👁️' : '🔒'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Read / Pull Auth */}
          <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg p-3 space-y-2.5">
            <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2">
              <div>
                <span className="font-bold text-xs block text-[var(--text-primary)]">
                  {t('services.mediamtx.readAuthTitle', 'Consumo (Read / Pull)')}
                </span>
                <span className="text-[10px] text-[var(--text-secondary)] block">
                  {t('services.mediamtx.readAuthDesc', 'Requerir credenciales para que los clientes consuman o reproduzcan streams.')}
                </span>
              </div>
              <input
                type="checkbox"
                checked={readAuthEnabled}
                onChange={(e) => {
                  setReadAuthEnabled(e.target.checked);
                  if (!e.target.checked) {
                    setReadUser('');
                    setReadPass('');
                  }
                }}
                className="rounded text-brand-lime"
              />
            </div>

            {readAuthEnabled && (
              <div className="space-y-2 pt-1">
                <div>
                  <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase block mb-1">
                    {t('services.mediamtx.readUser', 'Usuario de Consumo')}
                  </label>
                  <input
                    type="text"
                    value={readUser}
                    onChange={(e) => setReadUser(e.target.value)}
                    placeholder="e.g. viewer"
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded px-2.5 py-1.5 text-xs focus:border-brand-lime outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase block mb-1">
                    {t('services.mediamtx.readPass', 'Contraseña de Consumo')}
                  </label>
                  <div className="relative">
                    <input
                      type={showReadPass ? 'text' : 'password'}
                      value={readPass}
                      onChange={(e) => setReadPass(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded px-2.5 py-1.5 pr-8 text-xs focus:border-brand-lime outline-none font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowReadPass(!showReadPass)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer text-xs"
                      title={showReadPass ? 'Hide password' : 'Show password'}
                    >
                      {showReadPass ? '👁️' : '🔒'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Section 4: Stream Paths Management (CRUD) */}
      <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3.5 space-y-3">
        <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                {t('services.mediamtx.pathsTitle', '4. Gestión de Stream Paths')}
              </h4>
            </div>
          </div>
          {!isEditingPath && (
            <button
              type="button"
              onClick={handleOpenAddPath}
              className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-brand-lime/10 hover:bg-brand-lime/20 text-brand-lime border border-brand-lime/30 flex items-center gap-1.5 transition-all hover:scale-105 cursor-pointer shadow-sm"
            >
              <PlusIcon size={12} />
              <span>{t('services.mediamtx.addPath', '+ Añadir Stream Path')}</span>
            </button>
          )}
        </div>

        {/* Inline Add / Edit Path Form */}
        {isEditingPath && (
          <div className="bg-[var(--bg-card)] border border-brand-lime/40 rounded-xl p-3.5 space-y-3 shadow-md animate-fadeIn">
            <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2">
              <span className="text-xs font-bold uppercase tracking-wide text-brand-lime flex items-center gap-1.5">
                {editingPathIndex !== null ? <PencilIcon size={14} /> : <PlusIcon size={14} />}
                {editingPathIndex !== null ? t('services.mediamtx.editPath', 'Editar Stream Path') : t('services.mediamtx.addPath', 'Añadir Stream Path')}
              </span>
              <button
                type="button"
                onClick={handleCancelPathEdit}
                className="text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                ✕ {t('common.cancel', 'Cancelar')}
              </button>
            </div>

            {pathFormError && (
              <div className="bg-red-500/15 border border-red-500/40 text-red-300 text-xs px-2.5 py-1.5 rounded-lg">
                ⚠️ {pathFormError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase mb-1">
                  {t('services.mediamtx.pathId', 'Identificador de Path (Slug)')} *
                </label>
                <input
                  type="text"
                  required
                  value={currentPathId}
                  onChange={(e) => setCurrentPathId(e.target.value.replace(/[^a-zA-Z0-9_\-\/~]/g, ''))}
                  placeholder={t('services.mediamtx.pathIdPlaceholder', 'ej. cam1, tx_master')}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono focus:border-brand-lime outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase mb-1">
                  {t('services.mediamtx.authMode', 'Modo de Control de Acceso')}
                </label>
                <select
                  value={currentPathMode}
                  onChange={(e) => setCurrentPathMode(e.target.value as 'inherit' | 'open' | 'custom')}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs focus:border-brand-lime outline-none"
                >
                  <option value="inherit">{t('services.mediamtx.authModeInherit', 'Heredar reglas globales')}</option>
                  <option value="open">{t('services.mediamtx.authModeOpen', '100% Abierto (Modo LAN)')}</option>
                  <option value="custom">{t('services.mediamtx.authModeCustom', 'Personalizado')}</option>
                </select>
              </div>

              {/* Custom Credentials Subgrid */}
              {currentPathMode === 'custom' && (
                <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3 p-2.5 rounded-lg bg-[var(--input-bg)] border border-[var(--glass-border)]">
                  <div>
                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase block mb-1">
                      {t('services.mediamtx.customPublishUser', 'Usuario de Inyección')}
                    </label>
                    <input
                      type="text"
                      value={currentPathPubUser}
                      onChange={(e) => setCurrentPathPubUser(e.target.value)}
                      placeholder="e.g. cam_publisher"
                      className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded px-2 py-1 text-xs focus:border-brand-lime outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase block mb-1">
                      {t('services.mediamtx.customPublishPass', 'Contraseña de Inyección')}
                    </label>
                    <div className="relative">
                      <input
                        type={currentPathShowPubPass ? 'text' : 'password'}
                        value={currentPathPubPass}
                        onChange={(e) => setCurrentPathPubPass(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded px-2 py-1 pr-7 text-xs focus:border-brand-lime outline-none font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setCurrentPathShowPubPass(!currentPathShowPubPass)}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer text-xs"
                      >
                        {currentPathShowPubPass ? '👁️' : '🔒'}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase block mb-1">
                      {t('services.mediamtx.customReadUser', 'Usuario de Consumo')}
                    </label>
                    <input
                      type="text"
                      value={currentPathReadUser}
                      onChange={(e) => setCurrentPathReadUser(e.target.value)}
                      placeholder="e.g. cam_viewer"
                      className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded px-2 py-1 text-xs focus:border-brand-lime outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase block mb-1">
                      {t('services.mediamtx.customReadPass', 'Contraseña de Consumo')}
                    </label>
                    <div className="relative">
                      <input
                        type={currentPathShowReadPass ? 'text' : 'password'}
                        value={currentPathReadPass}
                        onChange={(e) => setCurrentPathReadPass(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded px-2 py-1 pr-7 text-xs focus:border-brand-lime outline-none font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setCurrentPathShowReadPass(!currentPathShowReadPass)}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer text-xs"
                      >
                        {currentPathShowReadPass ? '👁️' : '🔒'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Source Pull URL */}
              <div className="sm:col-span-2">
                <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase mb-1">
                  {t('services.mediamtx.source', 'URL de Fuente de Ingesta Externa (Opcional)')}
                </label>
                <input
                  type="text"
                  value={currentPathSource}
                  onChange={(e) => setCurrentPathSource(e.target.value)}
                  placeholder={t('services.mediamtx.sourcePlaceholder', 'ej. publisher o rtsp://192.168.1.50:554/stream1')}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono focus:border-brand-lime outline-none"
                />
              </div>

              {/* Run On Publish */}
              <div className="sm:col-span-2">
                <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase mb-1">
                  {t('services.mediamtx.runOnPublish', 'Comando al Publicar (Hook Run On Publish Opcional)')}
                </label>
                <input
                  type="text"
                  value={currentPathRunOnPublish}
                  onChange={(e) => setCurrentPathRunOnPublish(e.target.value)}
                  placeholder={t('services.mediamtx.runOnPublishPlaceholder', 'ej. ffmpeg -i rtsp://localhost:8554/$MTX_PATH ...')}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono focus:border-brand-lime outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--glass-border)]">
              <button
                type="button"
                onClick={handleCancelPathEdit}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[var(--input-bg)] border border-[var(--glass-border)] hover:bg-[var(--bg-card)] cursor-pointer"
              >
                {t('common.cancel', 'Cancelar')}
              </button>
              <button
                type="button"
                onClick={handleSavePath}
                className="px-4 py-1.5 rounded-lg text-xs font-bold bg-brand-lime text-black flex items-center gap-1.5 shadow hover:scale-105 cursor-pointer"
              >
                <CheckIcon size={14} />
                <span>{t('services.mediamtx.savePath', 'Guardar Path')}</span>
              </button>
            </div>
          </div>
        )}

        {/* Paths List Table / Cards */}
        {paths.length === 0 ? (
          <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--glass-border)] text-center text-xs text-[var(--text-secondary)]">
            {t('services.mediamtx.noPaths', 'No hay paths personalizados configurados (todos los streams utilizarán la configuración global).')}
          </div>
        ) : (
          <div className="space-y-2">
            {paths.map((p, idx) => {
              const isInherit = p.mode === 'inherit';
              const isOpen = p.mode === 'open';
              const isCustom = p.mode === 'custom';

              return (
                <div
                  key={p.path_id || idx}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-xl bg-[var(--bg-card)] border border-[var(--glass-border)] hover:border-brand-lime/30 transition-all text-xs"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-bold text-brand-lime bg-brand-lime/10 px-2 py-0.5 rounded border border-brand-lime/20">
                      /{p.path_id}
                    </span>

                    {/* Mode badge */}
                    {isInherit && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                        {t('services.mediamtx.authModeInherit', 'Heredar')}
                      </span>
                    )}
                    {isOpen && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        {t('services.mediamtx.authModeOpen', '100% Abierto LAN')}
                      </span>
                    )}
                    {isCustom && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        {t('services.mediamtx.authModeCustom', 'Personalizado')}
                      </span>
                    )}

                    {isCustom && (p.publish_user || p.read_user) && (
                      <span className="text-[10px] text-[var(--text-secondary)] font-mono">
                        {p.publish_user ? `pub:${p.publish_user} ` : ''}
                        {p.read_user ? `read:${p.read_user}` : ''}
                      </span>
                    )}

                    {p.source && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--input-bg)] text-[var(--text-secondary)] font-mono border border-[var(--glass-border)]" title={p.source}>
                        src: {p.source.length > 25 ? `${p.source.slice(0, 22)}...` : p.source}
                      </span>
                    )}

                    {p.run_on_publish && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 font-mono border border-purple-500/20" title={p.run_on_publish}>
                        hook
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 self-end sm:self-center">
                    <button
                      type="button"
                      onClick={() => handleOpenEditPath(idx)}
                      className="p-1.5 rounded-lg bg-[var(--input-bg)] hover:bg-[var(--glass-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-all"
                      title={t('common.edit', 'Editar')}
                    >
                      <PencilIcon size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeletePath(idx)}
                      className="p-1.5 rounded-lg bg-[var(--input-bg)] hover:bg-red-500/20 text-[var(--text-secondary)] hover:text-red-400 cursor-pointer transition-all"
                      title={t('common.delete', 'Eliminar')}
                    >
                      <TrashIcon size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 5: REST API & Telemetry Control */}
      <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3.5 space-y-3">
        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] pb-2">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400">
            {t('services.mediamtx.apiTitle', '5. API de Control y Diagnóstico')}
          </h4>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs items-center">
          <label className="flex items-center gap-2 cursor-pointer bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg p-2.5">
            <input
              type="checkbox"
              checked={apiEnabled}
              onChange={(e) => setApiEnabled(e.target.checked)}
              className="rounded text-brand-lime"
            />
            <div>
              <span className="font-bold uppercase tracking-wide text-xs block">
                {t('services.mediamtx.apiEnabled', 'Enable REST Control API')}
              </span>
              <span className="text-[10px] text-[var(--text-secondary)] block">
                {t('services.mediamtx.apiPortDesc', 'Used for live session telemetry, active path inspection, and stats polling.')}
              </span>
            </div>
          </label>

          {apiEnabled && (
            <div className={`bg-[var(--bg-card)] border rounded-lg p-2.5 ${getConflict(apiPort) ? 'border-red-500/50 bg-red-500/5' : 'border-[var(--glass-border)]'}`}>
              <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase block mb-1">
                {t('services.mediamtx.apiPort', 'Control API Port (TCP)')}
              </label>
              <input
                type="number"
                value={apiPort}
                onChange={(e) => setApiPort(Number(e.target.value))}
                className={`w-full bg-[var(--input-bg)] border rounded px-2.5 py-1.5 text-xs font-mono ${getConflict(apiPort) ? 'border-red-500 text-red-300' : 'border-[var(--glass-border)]'}`}
              />
              {getConflict(apiPort) && (
                <span className="text-[10px] text-red-400 block mt-1 leading-tight">
                  ⚠️ {t('services.mediamtx.portConflict', { port: apiPort, service: getConflict(apiPort)?.serviceName })}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Section 6: Dedicated Storage Allocations */}
      <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3.5 space-y-3">
        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] pb-2">
          <span className="w-2 h-2 rounded-full bg-purple-400" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-purple-400">
            {t('services.mediamtx.storageTitle', '6. Almacenamiento y Protección de Disco')}
          </h4>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div>
            <label className="block text-[11px] font-bold text-[var(--text-secondary)] uppercase mb-1">
              {t('services.mediamtx.hlsStorage', 'HLS Segment Storage Volume')}
            </label>
            {hlsStorages.length > 0 ? (
              <>
                <select
                  value={hlsStorageId || hlsStorages[0].id}
                  onChange={(e) => setHlsStorageId(Number(e.target.value))}
                  className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg px-3 py-1.5 focus:border-brand-lime outline-none text-xs font-mono"
                >
                  {hlsStorages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.path})
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-[var(--text-secondary)] mt-1 block">
                  {t('services.mediamtx.hlsStorageDesc', 'HLS chunks use circular ring retention (5 segments of 2s) to protect root storage.')}
                </span>
              </>
            ) : (
              <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs space-y-0.5">
                <span className="font-bold block">⚠️ {t('services.mediamtx.noHlsStorageTitle', 'No HLS Storage Volume Configured')}</span>
                <span className="text-[10px] text-[var(--text-secondary)] block">
                  {t('services.mediamtx.noHlsStorageNotice', 'HLS distribution is disabled to protect against root disk saturation. Configure an HLS storage volume in Settings -> Storage to enable.')}
                </span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-bold text-[var(--text-secondary)] uppercase mb-1">
              {t('services.mediamtx.logStorage', 'Dedicated Log Storage Volume')}
            </label>
            <select
              value={logStorageId || ''}
              onChange={(e) => setLogStorageId(e.target.value ? Number(e.target.value) : null)}
              className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg px-3 py-1.5 focus:border-brand-lime outline-none text-xs"
            >
              <option value="">{t('common.default', 'Default (System logs volume)')}</option>
              {logStorages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.path})
                </option>
              ))}
            </select>
            <span className="text-[10px] text-[var(--text-secondary)] mt-1 block">
              {t('services.mediamtx.logStorageDesc', 'High-volume daemon stdout/stderr covered by automatic log rotation.')}
            </span>
          </div>
        </div>
      </div>

      {/* Section 7: Lifecycle & Boot Options */}
      <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3.5 space-y-3">
        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] pb-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
            {t('services.mediamtx.lifecycleTitle', '7. Lifecycle & Autostart')}
          </h4>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs items-center">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoStart}
              onChange={(e) => setAutoStart(e.target.checked)}
              className="rounded text-brand-lime"
            />
            <span className="font-bold uppercase tracking-wide text-xs">
              {t('services.autoStart', 'Auto-start on Boot')}
            </span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={watchdogEnabled}
              onChange={(e) => setWatchdogEnabled(e.target.checked)}
              className="rounded text-brand-lime"
            />
            <span className="font-bold uppercase tracking-wide text-xs">
              {t('services.watchdog', 'Watchdog Restart')}
            </span>
          </label>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] shrink-0">
                {t('services.startupOrder', 'Order')}:
              </label>
              <input
                type="number"
                min={1}
                max={100}
                value={startupOrder}
                onChange={(e) => setStartupOrder(Number(e.target.value))}
                className="w-14 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded px-2 py-1 text-xs text-center font-mono"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] shrink-0">
                {t('services.startupDelay', 'Delay (s)')}:
              </label>
              <input
                type="number"
                min={0}
                max={300}
                value={startupDelay}
                onChange={(e) => setStartupDelay(Number(e.target.value))}
                className="w-14 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded px-2 py-1 text-xs text-center font-mono"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Form Action Buttons */}
      <div className="flex items-center justify-end gap-3 pt-3 border-t border-[var(--glass-border)]">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-[var(--input-bg)] border border-[var(--glass-border)] hover:bg-[var(--bg-card)] transition-all cursor-pointer"
        >
          {t('common.cancel', 'Cancel')}
        </button>
        <button
          type="submit"
          disabled={isSubmitting || hasAnyConflict}
          className="px-6 py-2 rounded-xl text-xs font-black uppercase tracking-wider bg-brand-lime text-black shadow-lg shadow-brand-lime/20 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
        >
          {isSubmitting ? t('common.saving', 'Saving...') : initialConfig ? t('services.saveChanges', 'Save Changes') : t('services.createService', 'Create Service')}
        </button>
      </div>
    </form>
  );
};
