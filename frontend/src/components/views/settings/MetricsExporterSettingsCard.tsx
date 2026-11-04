import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface MetricsExporterSettingsCardProps {
  settings: any;
  onUpdateSettings: (newSettings: any) => Promise<void>;
  API?: string;
}

export const MetricsExporterSettingsCard: React.FC<MetricsExporterSettingsCardProps> = ({
  settings,
  onUpdateSettings,
  API = '',
}) => {
  const { t } = useTranslation();

  const [enabled, setEnabled] = useState<boolean>(settings?.metrics_exporter_enabled ?? false);
  const [token, setToken] = useState<string>(settings?.metrics_exporter_token ?? '');
  const [allowedIps, setAllowedIps] = useState<string>(settings?.metrics_exporter_allowed_ips ?? '');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);
  const [copiedConfig, setCopiedConfig] = useState<boolean>(false);

  useEffect(() => {
    setEnabled(settings?.metrics_exporter_enabled ?? false);
    setToken(settings?.metrics_exporter_token ?? '');
    setAllowedIps(settings?.metrics_exporter_allowed_ips ?? '');
  }, [settings?.metrics_exporter_enabled, settings?.metrics_exporter_token, settings?.metrics_exporter_allowed_ips]);

  const handleGenerateToken = () => {
    const array = new Uint8Array(24);
    window.crypto.getRandomValues(array);
    const hex = Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
    setToken(hex);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      await onUpdateSettings({
        metrics_exporter_enabled: enabled,
        metrics_exporter_token: token.trim(),
        metrics_exporter_allowed_ips: allowedIps.trim(),
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) {
      console.error('Failed to update metrics exporter settings', e);
    } finally {
      setIsSaving(false);
    }
  };

  const baseUrl = API ? (API.startsWith('http') ? API : `${window.location.protocol}//${window.location.host}${API}`) : window.location.origin;
  const metricsUrl = `${baseUrl}/api/metrics`;
  const metricsUrlWithToken = token ? `${metricsUrl}?token=${token}` : metricsUrl;

  const scrapeHost = API ? new URL(baseUrl).host : window.location.host;
  const scrapeConfigYaml = `# Prometheus Scrape Target for ffmpeg-gui node
scrape_configs:
  - job_name: 'ffmpeg-gui'
    scrape_interval: 10s
    metrics_path: '/api/metrics'
    ${token ? `bearer_token: '${token}'` : '# No auth token configured'}
    static_configs:
      - targets: ['${scrapeHost}']`;

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(metricsUrlWithToken);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch (err) {
      console.error('Copy failed', err);
    }
  };

  const handleCopyConfig = async () => {
    try {
      await navigator.clipboard.writeText(scrapeConfigYaml);
      setCopiedConfig(true);
      setTimeout(() => setCopiedConfig(false), 2000);
    } catch (err) {
      console.error('Copy failed', err);
    }
  };

  return (
    <div className="glass-card p-5 !rounded-2xl space-y-5">
      {/* Header with Title and Master Enable Toggle */}
      <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-3">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              enabled ? 'bg-brand-lime shadow-[0_0_8px_var(--color-brand-lime,#D4FF5B)]' : 'bg-zinc-600'
            }`}
          />
          <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider">
            📊 {t('settings.metricsExporter.title', 'PROMETHEUS & OPENMETRICS EXPORTER')}
          </h4>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-[var(--text-primary)]">
            {t('settings.metricsExporter.enabledLabel', 'Enable Metrics Exporter (/api/metrics)')}
          </span>
          <button
            type="button"
            onClick={() => setEnabled(!enabled)}
            className={`w-11 h-6 rounded-full transition-colors p-0.5 relative cursor-pointer border ${
              enabled ? 'bg-brand-lime border-brand-lime/40' : 'bg-white/10 border-white/10'
            }`}
            title="Toggle metrics exporter"
          >
            <div
              className={`w-5 h-5 rounded-full bg-black transition-transform ${
                enabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
        {t(
          'settings.metricsExporter.subtitle',
          'Secure real-time metrics HTTP scraper endpoint for Prometheus, InfluxDB, VictoriaMetrics, and Grafana Agent. Pure volatile RAM with zero flash storage wear.'
        )}
      </p>

      {/* Exporter Configuration Fields */}
      {enabled && (
        <div className="space-y-4 pt-1 animate-fade-in">
          {/* Bearer Token */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                🔑 {t('settings.metricsExporter.tokenLabel', 'Bearer Authentication Token')}
              </label>
              <button
                type="button"
                onClick={handleGenerateToken}
                className="text-[11px] text-brand-lime hover:underline font-mono cursor-pointer"
              >
                ⚡ {t('settings.metricsExporter.generateToken', 'Generate Random Token')}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={t(
                  'settings.metricsExporter.tokenPlaceholder',
                  'Enter secret bearer token or click generate'
                )}
                className="input-field flex-1 font-mono text-xs py-2 px-3 bg-black/30 border border-white/10 rounded-lg text-[var(--text-primary)]"
              />
              {token && (
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="px-3 py-2 bg-white/5 hover:bg-white/10 text-xs text-[var(--text-primary)] rounded-lg border border-white/10 cursor-pointer font-mono whitespace-nowrap"
                >
                  {copiedUrl ? `✓ ${t('settings.metricsExporter.copied', 'Copied!')}` : t('settings.metricsExporter.copyUrl', 'Copy URL')}
                </button>
              )}
            </div>
            <p className="text-[10px] text-[var(--text-secondary)]">
              {t(
                'settings.metricsExporter.tokenHelp',
                "Scrapers authenticate using 'Authorization: Bearer <token>' header or '?token=<token>' query parameter."
              )}
            </p>
          </div>

          {/* Allowed IPs / CIDR Subnets */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
              🛡️ {t('settings.metricsExporter.allowedIpsLabel', 'Allowed Scraper IPs / Subnets')}
            </label>
            <input
              type="text"
              value={allowedIps}
              onChange={(e) => setAllowedIps(e.target.value)}
              placeholder={t(
                'settings.metricsExporter.allowedIpsPlaceholder',
                '127.0.0.1, 192.168.1.0/24 (leave empty to allow all authorized IPs)'
              )}
              className="input-field w-full font-mono text-xs py-2 px-3 bg-black/30 border border-white/10 rounded-lg text-[var(--text-primary)]"
            />
            <p className="text-[10px] text-[var(--text-secondary)]">
              {t(
                'settings.metricsExporter.allowedIpsHelp',
                'Comma-separated IP addresses or CIDR blocks permitted to scrape metrics. Leave blank to accept any authenticated source IP.'
              )}
            </p>
          </div>

          {/* Scrape Target Information & Sample prometheus.yml snippet */}
          <div className="space-y-2 pt-2 border-t border-white/5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[var(--text-primary)]">
                {t('settings.metricsExporter.prometheusConfigTitle', 'Prometheus Scrape Configuration (prometheus.yml)')}
              </span>
              <button
                type="button"
                onClick={handleCopyConfig}
                className="text-[11px] px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 text-brand-lime border border-white/10 cursor-pointer font-mono"
              >
                {copiedConfig ? `✓ ${t('settings.metricsExporter.copied', 'Copied!')}` : t('settings.metricsExporter.copyConfig', 'Copy Config')}
              </button>
            </div>
            <pre className="p-3 rounded-lg bg-black/50 border border-white/5 text-[11px] font-mono text-zinc-300 overflow-x-auto select-all">
              {scrapeConfigYaml}
            </pre>
          </div>
        </div>
      )}

      {/* Save Button Row */}
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-[var(--glass-border)]">
        {saveSuccess && (
          <span className="text-xs text-brand-lime font-bold animate-fade-in flex items-center gap-1">
            ✓ {t('settings.metricsExporter.savedSuccess', 'Metrics exporter settings saved successfully.')}
          </span>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="pill-button bg-brand-lime hover:bg-brand-lime/90 text-black font-bold text-xs py-2 px-4 flex items-center gap-1.5 transition-all cursor-pointer shadow-lg shadow-brand-lime/10 disabled:opacity-50"
        >
          {isSaving ? (
            <span className="animate-spin">⏳</span>
          ) : (
            <span>💾</span>
          )}
          {t('settings.metricsExporter.saveSettings', 'Save Exporter Settings')}
        </button>
      </div>
    </div>
  );
};
