import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldIcon } from '../Icons';
import { EngineLogo } from '../common/EngineLogo';

interface KioskConfigFormProps {
  initialConfig?: any;
  onCancel: () => void;
  onSubmit: (config: any) => Promise<void> | void;
  API?: string;
}

export const KioskConfigForm: React.FC<KioskConfigFormProps> = ({
  initialConfig,
  onCancel,
  onSubmit,
  API = '',
}) => {
  const { t } = useTranslation();

  const kCfg = initialConfig?.config?.kiosk_config || initialConfig?.kiosk_config || {};

  const [name, setName] = useState(initialConfig?.name || 'Web Kiosk Display');
  const [alias, setAlias] = useState(initialConfig?.alias || '');

  // Desktop selection
  const [desktopServiceId, setDesktopServiceId] = useState<number | ''>(
    kCfg.desktop_service_id ? Number(kCfg.desktop_service_id) : ''
  );
  const [availableDesktops, setAvailableDesktops] = useState<any[]>([]);
  const [isLoadingDesktops, setIsLoadingDesktops] = useState<boolean>(true);

  // Engine & Build
  const [engineId, setEngineId] = useState<'chromium' | 'firefox'>(
    kCfg.engine_id === 'firefox' ? 'firefox' : 'chromium'
  );
  const [buildId, setBuildId] = useState<number | string>(
    kCfg.build_id || initialConfig?.ffmpeg_build_id || initialConfig?.config?.software_build_id || ''
  );
  const [availableBuilds, setAvailableBuilds] = useState<any[]>([]);
  const [systemBinaryStatus, setSystemBinaryStatus] = useState<Record<string, { found: boolean; path?: string; version?: string }>>({});

  // Target Source
  const [targetSource, setTargetSource] = useState<string>(
    kCfg.target_source || 'https://google.com'
  );

  // Display & Performance Options
  const [hideScrollbars, setHideScrollbars] = useState<boolean>(
    kCfg.hide_scrollbars !== undefined ? Boolean(kCfg.hide_scrollbars) : true
  );
  const [diskCacheDisabled, setDiskCacheDisabled] = useState<boolean>(
    kCfg.disk_cache_disabled !== undefined ? Boolean(kCfg.disk_cache_disabled) : true
  );
  const [gpuAcceleration, setGpuAcceleration] = useState<'auto' | 'enabled' | 'disabled'>(
    kCfg.gpu_acceleration || 'auto'
  );
  const [customFlags, setCustomFlags] = useState<string>(kCfg.custom_flags || '');

  // Auto-start & Lifecycle
  const [autoStart, setAutoStart] = useState<boolean>(
    initialConfig?.auto_start ?? initialConfig?.config?.auto_start ?? false
  );
  const [startupOrder, setStartupOrder] = useState<number>(
    initialConfig?.startup_order ?? initialConfig?.config?.startup_order ?? 2
  );
  const [startupDelay, setStartupDelay] = useState<number>(
    initialConfig?.startup_delay ?? initialConfig?.config?.startup_delay ?? 2
  );

  // Watchdog
  const [watchdogEnabled, setWatchdogEnabled] = useState<boolean>(
    initialConfig?.watchdog_enabled ?? initialConfig?.config?.watchdog_enabled ?? true
  );
  const [watchdogRetries, setWatchdogRetries] = useState<number>(
    initialConfig?.watchdog_retries ?? initialConfig?.config?.watchdog_retries ?? 5
  );

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch available Virtual Desktop services
  useEffect(() => {
    setIsLoadingDesktops(true);
    fetch(`${API}/processes`)
      .then((r) => (r.ok ? r.json() : []))
      .then((procs: any[]) => {
        const desktops = procs.filter((p) => p.service_type === 'desktop');
        setAvailableDesktops(desktops);
        if (desktops.length > 0 && !desktopServiceId) {
          setDesktopServiceId(desktops[0].id);
        }
      })
      .catch((err) => console.error('Error fetching desktops for kiosk:', err))
      .finally(() => setIsLoadingDesktops(false));
  }, [API]);

  // Fetch system software capabilities and binary presence
  useEffect(() => {
    fetch(`${API}/settings/software`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.engines) {
          const statusMap: Record<string, { found: boolean; path?: string; version?: string }> = {};
          for (const [key, val] of Object.entries(data.engines as Record<string, any>)) {
            statusMap[key] = {
              found: Boolean(val?.system_binary?.found),
              path: val?.system_binary?.path,
              version: val?.system_binary?.version
            };
          }
          setSystemBinaryStatus(statusMap);
        }
      })
      .catch((err) => console.error('Error fetching software status for kiosk:', err));
  }, [API]);

  const handleEngineChange = (newEngine: 'chromium' | 'firefox') => {
    setEngineId(newEngine);
  };

  // Fetch builds for selected engine
  useEffect(() => {
    fetch(`${API}/builds`)
      .then((r) => (r.ok ? r.json() : []))
      .then((builds: any[]) => {
        if (initialConfig?.ffmpeg_build_id && !kCfg.engine_id) {
          const matched = builds.find((b: any) => b.id === initialConfig.ffmpeg_build_id);
          if (matched && (matched.software_type === 'firefox' || matched.software_type === 'chromium')) {
            setEngineId(matched.software_type);
          }
        }
        const engineBuilds = builds.filter(
          (b) => b.software_type === engineId && b.status === 'ready'
        );
        setAvailableBuilds(engineBuilds);
      })
      .catch((err) => console.error('Error fetching engine builds:', err));
  }, [API, engineId]);

  const hasSystemBinary = Boolean(systemBinaryStatus[engineId]?.found);
  const systemPath = systemBinaryStatus[engineId]?.path;

  // Synchronize and validate buildId when engine, available builds, or software status changes
  useEffect(() => {
    const isBuildValid = availableBuilds.some((b) => String(b.id) === String(buildId));
    const isSystemValid = buildId === 'system' && hasSystemBinary;

    if (!isBuildValid && !isSystemValid) {
      if (availableBuilds.length > 0) {
        setBuildId(String(availableBuilds[0].id));
      } else if (hasSystemBinary) {
        setBuildId('system');
      } else {
        setBuildId('');
      }
    }
  }, [availableBuilds, hasSystemBinary, buildId, engineId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!desktopServiceId) {
      alert(t('kiosk.no_desktop_warning', 'Please select or create a Virtual Desktop Server first.'));
      return;
    }
    if (!buildId || (buildId === 'system' && !hasSystemBinary)) {
      alert(t('kiosk.invalid_binary_warning', 'Please select a valid browser binary or install one in Settings → Software.'));
      return;
    }

    setIsSubmitting(true);
    try {
      const parsedBuildId = buildId === 'system' || !buildId ? null : Number(buildId);
      const payload = {
        name: name.trim() || 'Web Kiosk Display',
        alias: alias.trim() || null,
        service_type: 'kiosk_browser',
        ffmpeg_build_id: parsedBuildId,
        config: {
          kiosk_config: {
            desktop_service_id: Number(desktopServiceId),
            engine_id: engineId,
            build_id: parsedBuildId,
            target_source: targetSource.trim() || 'about:blank',
            hide_scrollbars: hideScrollbars,
            disk_cache_disabled: diskCacheDisabled,
            gpu_acceleration: gpuAcceleration,
            custom_flags: customFlags.trim(),
          },
          software_build_id: parsedBuildId,
          auto_start: autoStart,
          startup_order: Number(startupOrder),
          startup_delay: Number(startupDelay),
          watchdog_enabled: watchdogEnabled,
          watchdog_retries: Number(watchdogRetries),
        },
        auto_start: autoStart,
        startup_order: Number(startupOrder),
        startup_delay: Number(startupDelay),
        watchdog_enabled: watchdogEnabled,
        watchdog_retries: Number(watchdogRetries),
      };

      await onSubmit(payload);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full overflow-hidden text-[var(--text-primary)]">
      {/* Scrollable Form Body */}
      <div className="flex-1 overflow-y-auto space-y-6 p-1 pr-2">
        {/* Basic Service Identification */}
        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-4 shadow-sm space-y-4">
          <h3 className="text-sm font-bold flex items-center gap-2 text-brand-lime">
            <span>🌐</span>
            {t('kiosk.general_settings', 'Web Kiosk Display Configuration')}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                {t('kiosk.name_label', 'Service Name')} <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Kiosk Display Master"
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:border-brand-lime outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                {t('kiosk.alias_label', 'Custom Alias (Optional)')}
              </label>
              <input
                type="text"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="e.g. Studio TV Main Feed"
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:border-brand-lime outline-none"
              />
            </div>
          </div>
        </div>

        {/* Target Virtual Desktop Association */}
        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-4 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
            <span>🖥️</span>
            {t('kiosk.target_desktop_label', 'Target Virtual Desktop')} <span className="text-red-400">*</span>
          </h3>

          {isLoadingDesktops ? (
            <div className="text-xs text-[var(--text-secondary)] py-2">
              {t('common.loading', 'Loading virtual desktops...')}
            </div>
          ) : availableDesktops.length === 0 ? (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2">
              <span>⚠️</span>
              <span>
                {t(
                  'kiosk.no_desktop_warning',
                  'No active Virtual Desktop found. Please create a Virtual Desktop Server service first before launching a kiosk.'
                )}
              </span>
            </div>
          ) : (
            <div>
              <select
                required
                value={desktopServiceId}
                onChange={(e) => setDesktopServiceId(Number(e.target.value))}
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:border-brand-lime outline-none"
              >
                {availableDesktops.map((desk) => {
                  const dCfg = desk.config?.desktop_config || desk.desktop_config || {};
                  return (
                    <option key={desk.id} value={desk.id}>
                      #{desk.id} - {desk.alias || desk.name} (Display :{dCfg.display_num ?? 99} • {dCfg.resolution || '1920x1080'})
                    </option>
                  );
                })}
              </select>
              <span className="text-[10px] text-[var(--text-secondary)] mt-1 block">
                {t('kiosk.target_desktop_help', 'The browser will attach full-screen to this virtual X11 display socket.')}
              </span>
            </div>
          )}
        </div>

        {/* Browser Engine & Binary Selector */}
        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-4 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
            <span>🚀</span>
            {t('kiosk.browser_engine', 'Browser Engine & Binary')}
          </h3>

          {/* Engine Choice Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div
              onClick={() => handleEngineChange('chromium')}
              className={`p-3 rounded-xl border flex items-center gap-3 cursor-pointer transition-all ${
                engineId === 'chromium'
                  ? 'bg-brand-lime/10 border-brand-lime shadow-sm ring-1 ring-brand-lime/30'
                  : 'bg-[var(--input-bg)] border-[var(--glass-border)] hover:border-brand-lime/30'
              }`}
            >
              <div className="w-9 h-9 rounded-lg bg-[var(--bg-card)] border border-[var(--glass-border)] flex items-center justify-center p-1.5 shrink-0">
                <EngineLogo softwareType="chromium" size={24} API={API} />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-[var(--text-primary)]">
                  {t('kiosk.engine_chromium', 'Chromium / Google Chrome')}
                </div>
                <div className="text-[10px] text-[var(--text-secondary)] truncate">
                  Blink / V8 • Autoplay & WebGL
                </div>
              </div>
            </div>

            <div
              onClick={() => handleEngineChange('firefox')}
              className={`p-3 rounded-xl border flex items-center gap-3 cursor-pointer transition-all ${
                engineId === 'firefox'
                  ? 'bg-brand-lime/10 border-brand-lime shadow-sm ring-1 ring-brand-lime/30'
                  : 'bg-[var(--input-bg)] border-[var(--glass-border)] hover:border-brand-lime/30'
              }`}
            >
              <div className="w-9 h-9 rounded-lg bg-[var(--bg-card)] border border-[var(--glass-border)] flex items-center justify-center p-1.5 shrink-0">
                <EngineLogo softwareType="firefox" size={24} API={API} />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-[var(--text-primary)]">
                  {t('kiosk.engine_firefox', 'Mozilla Firefox')}
                </div>
                <div className="text-[10px] text-[var(--text-secondary)] truncate">
                  Gecko • Custom Profiles & Hardware Accel
                </div>
              </div>
            </div>
          </div>

          {/* Release / Build Selector */}
          <div>
            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
              {t('kiosk.build_label', 'Software Release / Binary')}
            </label>
            <select
              value={buildId}
              onChange={(e) => setBuildId(e.target.value)}
              className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:border-brand-lime outline-none"
            >
              {hasSystemBinary && (
                <option value="system">
                  {t('kiosk.build_system', 'Host System Binary (PATH audit)')} ({systemPath || 'PATH'})
                </option>
              )}
              {availableBuilds.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name || `${b.software_type} v${b.version_tag || b.version}`} ({b.binary_path || 'Precompiled'})
                </option>
              ))}
              {!hasSystemBinary && availableBuilds.length === 0 && (
                <option value="" disabled>
                  {t('kiosk.no_binaries_available', 'No binary available (System or Downloaded)')}
                </option>
              )}
            </select>

            {!hasSystemBinary && availableBuilds.length === 0 && (
              <div className="mt-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs flex items-center gap-2">
                <span>⚠️</span>
                <span>
                  {t(
                    'kiosk.no_browser_binary_warning',
                    'No executable binary found for this engine. Please install it on the host or provision an official release in Settings → Software.'
                  )}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Target Source URL or Path */}
        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-4 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
            <span>🔗</span>
            {t('kiosk.target_source_label', 'Target URL or File Path')} <span className="text-red-400">*</span>
          </h3>

          <div>
            <input
              type="text"
              required
              value={targetSource}
              onChange={(e) => setTargetSource(e.target.value)}
              placeholder={t('kiosk.target_source_placeholder', 'https://example.com or /var/www/dashboard/index.html')}
              className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] font-mono focus:border-brand-lime outline-none"
            />
            <span className="text-[10px] text-[var(--text-secondary)] mt-1 block">
              {t('kiosk.target_source_help', 'Web page URL or local HTML file loaded on launch in full-screen kiosk mode.')}
            </span>
          </div>
        </div>

        {/* Kiosk Options & Flash Protection */}
        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-4 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
            <span>⚙️</span>
            {t('kiosk.advanced_options', 'Kiosk & Flash Protection Options')}
          </h3>

          {/* Hide Scrollbars */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--input-bg)] border border-[var(--glass-border)]">
            <div>
              <p className="text-xs font-bold text-[var(--text-primary)]">
                {t('kiosk.hide_scrollbars', 'Hide Scrollbars')}
              </p>
              <p className="text-[11px] text-[var(--text-secondary)]">
                {t('kiosk.hide_scrollbars_desc', 'Collapse and hide all scrollbars for clean broadcast and signage output.')}
              </p>
            </div>
            <input
              type="checkbox"
              checked={hideScrollbars}
              onChange={(e) => setHideScrollbars(e.target.checked)}
              className="w-4 h-4 accent-brand-lime cursor-pointer"
            />
          </div>

          {/* SATADOM Flash Storage Protection */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--input-bg)] border border-[var(--glass-border)]">
            <div>
              <p className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <span>🛡️</span>
                {t('kiosk.disk_cache_disabled', 'SATADOM / Flash Storage Protection')}
              </p>
              <p className="text-[11px] text-[var(--text-secondary)]">
                {t('kiosk.disk_cache_disabled_desc', 'Disable on-disk browser caching (/dev/null) to extend flash media lifespan.')}
              </p>
            </div>
            <input
              type="checkbox"
              checked={diskCacheDisabled}
              onChange={(e) => setDiskCacheDisabled(e.target.checked)}
              className="w-4 h-4 accent-brand-lime cursor-pointer"
            />
          </div>

          {/* GPU Acceleration */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                {t('kiosk.gpu_accel_label', 'GPU Hardware Acceleration')}
              </label>
              <select
                value={gpuAcceleration}
                onChange={(e) => setGpuAcceleration(e.target.value as any)}
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:border-brand-lime outline-none"
              >
                <option value="auto">{t('kiosk.gpu_accel_auto', 'Automatic (System Default)')}</option>
                <option value="enabled">{t('kiosk.gpu_accel_enabled', 'Force Enabled (Hardware Rasterization)')}</option>
                <option value="disabled">{t('kiosk.gpu_accel_disabled', 'Disabled (Software Rasterization)')}</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                {t('kiosk.custom_flags_label', 'Custom Operator CLI Flags')}
              </label>
              <input
                type="text"
                value={customFlags}
                onChange={(e) => setCustomFlags(e.target.value)}
                placeholder={t('kiosk.custom_flags_placeholder', 'e.g. --disable-web-security')}
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] font-mono focus:border-brand-lime outline-none"
              />
              <span className="text-[10px] text-[var(--text-secondary)] mt-1 block">
                {t('kiosk.custom_flags_help', 'Appended directly to the browser executable on launch.')}
              </span>
            </div>
          </div>
        </div>

        {/* Reliability, Auto-Start & Watchdog */}
        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-4 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
            <ShieldIcon size={16} className="text-brand-lime" />
            {t('desktop.lifecycle_watchdog', 'Service Lifecycle & Reliability Watchdog')}
          </h3>

          <div className="space-y-3">
            {/* Auto-start Toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--input-bg)] border border-[var(--glass-border)]">
              <div>
                <p className="text-xs font-bold text-[var(--text-primary)]">
                  {t('services.autoStart', 'Auto-Start on Boot / Daemon Initialization')}
                </p>
                <p className="text-[11px] text-[var(--text-secondary)]">
                  {t('services.autoStartDesc', 'Automatically start this kiosk when the system daemon initializes')}
                </p>
              </div>
              <input
                type="checkbox"
                checked={autoStart}
                onChange={(e) => setAutoStart(e.target.checked)}
                className="w-4 h-4 accent-brand-lime cursor-pointer"
              />
            </div>

            {autoStart && (
              <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-[var(--input-bg)] border border-[var(--glass-border)]">
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                    {t('services.startupOrder', 'Startup Order')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={startupOrder}
                    onChange={(e) => setStartupOrder(parseInt(e.target.value) || 2)}
                    className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded px-3 py-1.5 text-xs font-mono text-[var(--text-primary)] focus:border-brand-lime outline-none"
                  />
                  <span className="text-[10px] text-[var(--text-secondary)] mt-0.5 block">
                    Higher order runs after Virtual Desktop (Order #1)
                  </span>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                    {t('services.startupDelay', 'Startup Delay (seconds)')}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={300}
                    value={startupDelay}
                    onChange={(e) => setStartupDelay(parseInt(e.target.value) || 2)}
                    className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded px-3 py-1.5 text-xs font-mono text-[var(--text-primary)] focus:border-brand-lime outline-none"
                  />
                  <span className="text-[10px] text-[var(--text-secondary)] mt-0.5 block">
                    Gives X11 time to initialize
                  </span>
                </div>
              </div>
            )}

            {/* Watchdog Toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--input-bg)] border border-[var(--glass-border)]">
              <div>
                <p className="text-xs font-bold text-[var(--text-primary)]">
                  {t('services.watchdogEnable', 'Supervised Process Watchdog')}
                </p>
                <p className="text-[11px] text-[var(--text-secondary)]">
                  {t('services.watchdogDesc', 'Automatically restart browser if terminated unexpectedly')}
                </p>
              </div>
              <input
                type="checkbox"
                checked={watchdogEnabled}
                onChange={(e) => setWatchdogEnabled(e.target.checked)}
                className="w-4 h-4 accent-brand-lime cursor-pointer"
              />
            </div>

            {watchdogEnabled && (
              <div className="p-3 rounded-lg bg-[var(--input-bg)] border border-[var(--glass-border)] flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-[var(--text-primary)]">
                    {t('services.watchdogRetries', 'Max Restart Retries')}
                  </p>
                  <p className="text-[10px] text-[var(--text-secondary)]">
                    {t('services.watchdogRetriesDesc', 'Consecutive failure restart threshold (-1 for unlimited)')}
                  </p>
                </div>
                <input
                  type="number"
                  min={-1}
                  max={50}
                  value={watchdogRetries}
                  onChange={(e) => setWatchdogRetries(parseInt(e.target.value) || 0)}
                  className="w-20 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded px-2 py-1 text-xs text-right font-mono text-[var(--text-primary)] focus:border-brand-lime outline-none"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer Action Buttons */}
      <div className="pt-4 border-t border-[var(--glass-border)] flex items-center justify-end gap-3 shrink-0">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="px-4 py-2 rounded-xl text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-white/5 hover:bg-white/10 transition-all cursor-pointer"
        >
          {t('common.cancel', 'Cancel')}
        </button>
        <button
          type="submit"
          disabled={isSubmitting || !desktopServiceId || !buildId || (!hasSystemBinary && availableBuilds.length === 0)}
          className="px-5 py-2 rounded-xl text-xs font-bold bg-brand-lime text-black hover:opacity-90 transition-all shadow-md cursor-pointer disabled:opacity-50"
        >
          {isSubmitting
            ? t('common.saving', 'Saving...')
            : initialConfig?.id
            ? t('common.save_changes', 'Save Changes')
            : t('kiosk.create_button', 'Create Kiosk Display')}
        </button>
      </div>
    </form>
  );
};
