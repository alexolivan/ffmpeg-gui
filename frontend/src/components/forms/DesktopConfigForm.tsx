import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshIcon, ShieldIcon } from '../Icons';

interface DesktopConfigFormProps {
  initialConfig?: any;
  onCancel: () => void;
  onSubmit: (config: any) => Promise<void> | void;
  API?: string;
}

export const DesktopConfigForm: React.FC<DesktopConfigFormProps> = ({
  initialConfig,
  onCancel,
  onSubmit,
  API = '',
}) => {
  const { t } = useTranslation();

  const deskCfg = initialConfig?.config?.desktop_config || initialConfig?.desktop_config || {};

  const [name, setName] = useState(initialConfig?.name || 'Virtual Desktop');
  const [alias, setAlias] = useState(initialConfig?.alias || '');

  // Desktop display parameters
  const [displayNum, setDisplayNum] = useState<number>(deskCfg.display_num ?? 99);
  const [vncPort, setVncPort] = useState<number>(deskCfg.vnc_port ?? 5999);
  const [resolution, setResolution] = useState<string>(deskCfg.resolution || '1920x1080');
  const [framerate, setFramerate] = useState<number>(deskCfg.framerate || 30);
  const [colorDepth, setColorDepth] = useState<number>(deskCfg.color_depth || 24);

  // Auto-allocate ports
  const [isAllocating, setIsAllocating] = useState(false);

  // Auto-start & Lifecycle
  const [autoStart, setAutoStart] = useState<boolean>(
    initialConfig?.auto_start ?? initialConfig?.config?.auto_start ?? false
  );
  const [startupOrder, setStartupOrder] = useState<number>(
    initialConfig?.startup_order ?? initialConfig?.config?.startup_order ?? 1
  );
  const [startupDelay, setStartupDelay] = useState<number>(
    initialConfig?.startup_delay ?? initialConfig?.config?.startup_delay ?? 0
  );

  // Watchdog
  const [watchdogEnabled, setWatchdogEnabled] = useState<boolean>(
    initialConfig?.watchdog_enabled ?? initialConfig?.config?.watchdog_enabled ?? true
  );
  const [watchdogRetries, setWatchdogRetries] = useState<number>(
    initialConfig?.watchdog_retries ?? initialConfig?.config?.watchdog_retries ?? 5
  );

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch clean candidate ports if creating new service
  useEffect(() => {
    if (!initialConfig?.id) {
      setIsAllocating(true);
      fetch(`${API}/api/services/desktop/next-available-ports`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data) {
            if (data.display_num !== undefined) setDisplayNum(data.display_num);
            if (data.vnc_port !== undefined) setVncPort(data.vnc_port);
          }
        })
        .catch(() => {})
        .finally(() => setIsAllocating(false));
    }
  }, [API, initialConfig?.id]);

  const handleAutoAssign = () => {
    setIsAllocating(true);
    const excludeId = initialConfig?.id ? `?exclude_service_id=${initialConfig.id}` : '';
    fetch(`${API}/api/services/desktop/next-available-ports${excludeId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          if (data.display_num !== undefined) setDisplayNum(data.display_num);
          if (data.vnc_port !== undefined) setVncPort(data.vnc_port);
        }
      })
      .catch((err) => {
        console.error('Error auto-allocating desktop ports:', err);
      })
      .finally(() => setIsAllocating(false));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const payload = {
        name: name.trim() || 'Virtual Desktop',
        alias: alias.trim() || null,
        service_type: 'desktop',
        config: {
          desktop_config: {
            display_num: Number(displayNum),
            vnc_port: Number(vncPort),
            resolution,
            framerate: Number(framerate),
            color_depth: Number(colorDepth),
          },
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
            <span>🖥️</span>
            {t('desktop.general_settings', 'Virtual Desktop Configuration')}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                {t('desktop.name_label', 'Service Name')} <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Desktop 1080p Master"
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:border-brand-lime outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                {t('desktop.alias_label', 'Custom Alias (Optional)')}
              </label>
              <input
                type="text"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="e.g. Main Studio Screen"
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:border-brand-lime outline-none"
              />
            </div>
          </div>
        </div>

        {/* Display & Remote Access Section */}
        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-4 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
              <span>🎛️</span>
              {t('desktop.display_parameters', 'X11 Display & Remote VNC Settings')}
            </h3>

            <button
              type="button"
              onClick={handleAutoAssign}
              disabled={isAllocating}
              className="text-xs bg-brand-lime/10 text-brand-lime border border-brand-lime/30 hover:bg-brand-lime/20 px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
              title="Automatically calculate conflict-free Display number and VNC port"
            >
              <RefreshIcon size={12} className={isAllocating ? 'animate-spin' : ''} />
              {t('desktop.auto_assign', 'Auto-Assign Free Ports')}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                {t('desktop.display_num_label', 'X11 Display Number (:N)')} <span className="text-red-400">*</span>
              </label>
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono text-[var(--text-secondary)]">:</span>
                <input
                  type="number"
                  required
                  min={1}
                  max={999}
                  value={displayNum}
                  onChange={(e) => {
                    const d = parseInt(e.target.value) || 0;
                    setDisplayNum(d);
                    setVncPort(5900 + d);
                  }}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] font-mono focus:border-brand-lime outline-none"
                />
              </div>
              <span className="text-[10px] text-[var(--text-secondary)] mt-1 block">
                {t('desktop.display_num_help', 'Internal Xvfb display socket. Default :99.')}
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                {t('desktop.vnc_port_label', 'Local VNC Port (TCP)')} <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                required
                min={1024}
                max={65535}
                value={vncPort}
                onChange={(e) => setVncPort(parseInt(e.target.value) || 5999)}
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] font-mono focus:border-brand-lime outline-none"
              />
              <span className="text-[10px] text-[var(--text-secondary)] mt-1 block">
                {t('desktop.vnc_port_help', 'Bound to 127.0.0.1. Remote clients connect securely through WebSocket proxy.')}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                {t('desktop.resolution_label', 'Canvas Resolution')}
              </label>
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:border-brand-lime outline-none"
              >
                <option value="1920x1080">1920x1080 (1080p Full HD)</option>
                <option value="1280x720">1280x720 (720p HD)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                {t('desktop.framerate_label', 'Target Framerate')}
              </label>
              <select
                value={framerate}
                onChange={(e) => setFramerate(Number(e.target.value))}
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:border-brand-lime outline-none"
              >
                <option value={30}>30 fps (Standard)</option>
                <option value={60}>60 fps (Smooth)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                {t('desktop.color_depth_label', 'Color Depth')}
              </label>
              <select
                value={colorDepth}
                onChange={(e) => setColorDepth(Number(e.target.value))}
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:border-brand-lime outline-none"
              >
                <option value={24}>24-bit TrueColor (RGB888)</option>
                <option value={16}>16-bit HighColor (RGB565)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Reliability, Lifecycle & Watchdog Section */}
        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-4 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
            <ShieldIcon size={14} className="text-purple-400" />
            {t('desktop.lifecycle_watchdog', 'Service Lifecycle & Reliability Watchdog')}
          </h3>

          <div className="space-y-3">
            {/* Auto Start Toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--input-bg)] border border-[var(--glass-border)]">
              <div>
                <p className="text-xs font-bold text-[var(--text-primary)]">
                  {t('services.autoStart', 'Auto-start on Boot')}
                </p>
                <p className="text-[11px] text-[var(--text-secondary)]">
                  {t('services.autoStartDesc', 'Automatically start this desktop server when ffmpeg-gui boots up')}
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
              <div className="grid grid-cols-2 gap-3 pl-3">
                <div className="p-3 rounded-lg bg-[var(--input-bg)] border border-[var(--glass-border)] flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-[var(--text-primary)]">
                      {t('services.startupOrder', 'Startup Order')}
                    </p>
                    <p className="text-[10px] text-[var(--text-secondary)]">
                      {t('services.startupOrderDesc', 'Execution sequence')}
                    </p>
                  </div>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={startupOrder}
                    onChange={(e) => setStartupOrder(parseInt(e.target.value) || 1)}
                    className="w-16 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded px-2 py-1 text-xs text-right font-mono text-[var(--text-primary)] focus:border-brand-lime outline-none"
                  />
                </div>

                <div className="p-3 rounded-lg bg-[var(--input-bg)] border border-[var(--glass-border)] flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-[var(--text-primary)]">
                      {t('services.startupDelay', 'Startup Delay (s)')}
                    </p>
                    <p className="text-[10px] text-[var(--text-secondary)]">
                      {t('services.startupDelayDesc', 'Seconds before launch')}
                    </p>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={startupDelay}
                    onChange={(e) => setStartupDelay(parseInt(e.target.value) || 0)}
                    className="w-16 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded px-2 py-1 text-xs text-right font-mono text-[var(--text-primary)] focus:border-brand-lime outline-none"
                  />
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
                  {t('services.watchdogDesc', 'Automatically recover and restart Xvfb or x11vnc if terminated unexpectedly')}
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
          disabled={isSubmitting}
          className="px-5 py-2 rounded-xl text-xs font-bold bg-brand-lime text-black hover:opacity-90 transition-all shadow-md cursor-pointer disabled:opacity-50"
        >
          {isSubmitting
            ? t('common.saving', 'Saving...')
            : initialConfig?.id
            ? t('common.save_changes', 'Save Changes')
            : t('common.create_service', 'Create Desktop Server')}
        </button>
      </div>
    </form>
  );
};
