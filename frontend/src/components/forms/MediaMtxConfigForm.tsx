import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

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

  const [srtEnabled, setSrtEnabled] = useState(mtxCfg.srt_enabled !== false);
  const [srtPort, setSrtPort] = useState(mtxCfg.srt_port || 8890);

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
            if (cfg.rtmp_enabled !== false && cfg.rtmp_port) portList.push({ port: Number(cfg.rtmp_port), label: 'RTMP', serviceName: s.name, serviceId: s.id });
            if (cfg.rtsp_enabled !== false) {
              if (cfg.rtsp_port) portList.push({ port: Number(cfg.rtsp_port), label: 'RTSP', serviceName: s.name, serviceId: s.id });
              portList.push({ port: Number(cfg.rtp_port || 8000), label: 'RTP', serviceName: s.name, serviceId: s.id });
              portList.push({ port: Number(cfg.rtcp_port || 8001), label: 'RTCP', serviceName: s.name, serviceId: s.id });
            }
            if (cfg.hls_enabled !== false && cfg.hls_port) portList.push({ port: Number(cfg.hls_port), label: 'HLS', serviceName: s.name, serviceId: s.id });
            if (cfg.webrtc_enabled && cfg.webrtc_port) portList.push({ port: Number(cfg.webrtc_port), label: 'WebRTC', serviceName: s.name, serviceId: s.id });
            if (cfg.srt_enabled && cfg.srt_port) portList.push({ port: Number(cfg.srt_port), label: 'SRT', serviceName: s.name, serviceId: s.id });
            if (cfg.api_enabled !== false) portList.push({ port: Number(cfg.api_port || 9997), label: 'API', serviceName: s.name, serviceId: s.id });
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
        ? `${API}/services/mediamtx/next-available-ports?exclude_service_id=${initialConfig.id}`
        : `${API}/services/mediamtx/next-available-ports`;
      const res = await fetch(url);
      if (res.ok) {
        const freePorts = await res.json();
        setRtmpPort(freePorts.rtmp_port);
        setRtspPort(freePorts.rtsp_port);
        setRtpPort(freePorts.rtp_port);
        setRtcpPort(freePorts.rtcp_port);
        setHlsPort(freePorts.hls_port);
        setWebrtcPort(freePorts.webrtc_port);
        setSrtPort(freePorts.srt_port);
        setApiPort(freePorts.api_port);
      }
    } catch (err) {
      console.error('Failed to auto-assign free ports', err);
    }
  };

  const getConflict = (portNum: number) => {
    if (!portNum) return null;
    return allOtherServicePorts.find((p) => p.port === portNum);
  };

  // Internal collision checking within the form
  const activeFormPorts = [
    ...(rtmpEnabled ? [{ port: Number(rtmpPort), label: 'RTMP' }] : []),
    ...(rtspEnabled
      ? [
          { port: Number(rtspPort), label: 'RTSP' },
          { port: Number(rtpPort), label: 'RTP' },
          { port: Number(rtcpPort), label: 'RTCP' },
        ]
      : []),
    ...(hlsEnabled ? [{ port: Number(hlsPort), label: 'HLS' }] : []),
    ...(webrtcEnabled ? [{ port: Number(webrtcPort), label: 'WebRTC' }] : []),
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
          srt_enabled: srtEnabled,
          srt_port: Number(srtPort) || 8890,
          api_enabled: apiEnabled,
          api_port: Number(apiPort) || 9997,
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
          <div className={`bg-[var(--bg-card)] border rounded-lg p-2.5 space-y-2 ${webrtcEnabled && getConflict(webrtcPort) ? 'border-red-500/50 bg-red-500/5' : 'border-[var(--glass-border)]'}`}>
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
              <div>
                <label className="text-[10px] text-[var(--text-secondary)] block mb-0.5">Port (HTTP/TCP)</label>
                <input
                  type="number"
                  value={webrtcPort}
                  onChange={(e) => setWebrtcPort(Number(e.target.value))}
                  className={`w-full bg-[var(--input-bg)] border rounded px-2 py-1 text-xs font-mono ${getConflict(webrtcPort) ? 'border-red-500 text-red-300' : 'border-[var(--glass-border)]'}`}
                />
                {getConflict(webrtcPort) && (
                  <span className="text-[10px] text-red-400 block mt-1 leading-tight">
                    ⚠️ {t('services.mediamtx.portConflict', { port: webrtcPort, service: getConflict(webrtcPort)?.serviceName })}
                  </span>
                )}
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
      </div>

      {/* Section 3: REST API & Telemetry Control */}
      <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3.5 space-y-3">
        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] pb-2">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400">
            {t('services.mediamtx.apiTitle', '3. Control API & Diagnostics')}
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

      {/* Section 4: Dedicated Storage Allocations */}
      <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3.5 space-y-3">
        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] pb-2">
          <span className="w-2 h-2 rounded-full bg-purple-400" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-purple-400">
            {t('services.mediamtx.storageTitle', '4. Storage & Retention Protection')}
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

      {/* Section 5: Lifecycle & Boot Options */}
      <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3.5 space-y-3">
        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] pb-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
            {t('services.mediamtx.lifecycleTitle', '5. Lifecycle & Autostart')}
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

