import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface MediaMtxConfigFormProps {
  initialConfig?: any;
  onCancel: () => void;
  onSubmit: (config: any) => Promise<void> | void;
  API?: string;
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

  const [hlsEnabled, setHlsEnabled] = useState(mtxCfg.hls_enabled !== false);
  const [hlsPort, setHlsPort] = useState(mtxCfg.hls_port || 8888);

  const [webrtcEnabled, setWebrtcEnabled] = useState(mtxCfg.webrtc_enabled !== false);
  const [webrtcPort, setWebrtcPort] = useState(mtxCfg.webrtc_port || 8889);

  const [srtEnabled, setSrtEnabled] = useState(mtxCfg.srt_enabled !== false);
  const [srtPort, setSrtPort] = useState(mtxCfg.srt_port || 8890);

  // Storage
  const [storages, setStorages] = useState<any[]>([]);
  const [hlsStorageId, setHlsStorageId] = useState<number | null>(mtxCfg.hls_storage_id || null);
  const [logStorageId, setLogStorageId] = useState<number | null>(initialConfig?.log_storage_id || null);

  // Lifecycle
  const [autoStart, setAutoStart] = useState(initialConfig?.auto_start || false);
  const [startupOrder, setStartupOrder] = useState(initialConfig?.startup_order ?? 1);
  const [startupDelay, setStartupDelay] = useState(initialConfig?.startup_delay ?? 0);
  const [watchdogEnabled, setWatchdogEnabled] = useState(initialConfig?.watchdog_enabled !== false);

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
  }, [API]);

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
          hls_enabled: hlsEnabled,
          hls_port: Number(hlsPort) || 8888,
          hls_storage_id: hlsStorageId ? Number(hlsStorageId) : null,
          webrtc_enabled: webrtcEnabled,
          webrtc_port: Number(webrtcPort) || 8889,
          srt_enabled: srtEnabled,
          srt_port: Number(srtPort) || 8890,
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
        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] pb-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-400">
            {t('services.mediamtx.protocolsTitle', '2. Live Streaming Protocols & Ports')}
          </h4>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
          {/* RTMP */}
          <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg p-2.5 space-y-2">
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
                <label className="text-[10px] text-[var(--text-secondary)] block mb-0.5">Port</label>
                <input
                  type="number"
                  value={rtmpPort}
                  onChange={(e) => setRtmpPort(Number(e.target.value))}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded px-2 py-1 text-xs font-mono"
                />
              </div>
            )}
          </div>

          {/* RTSP */}
          <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold uppercase tracking-wider text-xs">RTSP</span>
              <input
                type="checkbox"
                checked={rtspEnabled}
                onChange={(e) => setRtspEnabled(e.target.checked)}
                className="rounded text-brand-lime"
              />
            </div>
            {rtspEnabled && (
              <div>
                <label className="text-[10px] text-[var(--text-secondary)] block mb-0.5">Port</label>
                <input
                  type="number"
                  value={rtspPort}
                  onChange={(e) => setRtspPort(Number(e.target.value))}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded px-2 py-1 text-xs font-mono"
                />
              </div>
            )}
          </div>

          {/* HLS */}
          <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg p-2.5 space-y-2">
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
                <label className="text-[10px] text-[var(--text-secondary)] block mb-0.5">Port</label>
                <input
                  type="number"
                  value={hlsPort}
                  onChange={(e) => setHlsPort(Number(e.target.value))}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded px-2 py-1 text-xs font-mono"
                />
              </div>
            )}
          </div>

          {/* WebRTC */}
          <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg p-2.5 space-y-2">
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
                <label className="text-[10px] text-[var(--text-secondary)] block mb-0.5">Port</label>
                <input
                  type="number"
                  value={webrtcPort}
                  onChange={(e) => setWebrtcPort(Number(e.target.value))}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded px-2 py-1 text-xs font-mono"
                />
              </div>
            )}
          </div>

          {/* SRT */}
          <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg p-2.5 space-y-2">
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
                <label className="text-[10px] text-[var(--text-secondary)] block mb-0.5">Port</label>
                <input
                  type="number"
                  value={srtPort}
                  onChange={(e) => setSrtPort(Number(e.target.value))}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded px-2 py-1 text-xs font-mono"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Section 3: Dedicated Storage Allocations */}
      <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3.5 space-y-3">
        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] pb-2">
          <span className="w-2 h-2 rounded-full bg-purple-400" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-purple-400">
            {t('services.mediamtx.storageTitle', '3. Storage & Retention Protection')}
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

      {/* Section 4: Lifecycle & Boot Options */}
      <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3.5 space-y-3">
        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] pb-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
            {t('services.mediamtx.lifecycleTitle', '4. Lifecycle & Autostart')}
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
          disabled={isSubmitting}
          className="px-6 py-2 rounded-xl text-xs font-black uppercase tracking-wider bg-brand-lime text-black shadow-lg shadow-brand-lime/20 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
        >
          {isSubmitting ? t('common.saving', 'Saving...') : initialConfig ? t('services.saveChanges', 'Save Changes') : t('services.createService', 'Create Service')}
        </button>
      </div>
    </form>
  );
};
