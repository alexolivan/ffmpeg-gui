import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

interface CloudHubStatus {
  enabled: boolean;
  connected: boolean;
  hub_url: string | null;
  node_id: string | null;
  sso_enabled: boolean;
  org_name: string | null;
  group_name: string | null;
  last_connected_at: number | null;
  last_error: string | null;
  version: string;
}

interface CloudHubSettingsCardProps {
  API: string;
}

export const CloudHubSettingsCard: React.FC<CloudHubSettingsCardProps> = ({ API }) => {
  const { t } = useTranslation();

  const [status, setStatus] = useState<CloudHubStatus | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hubUrlInput, setHubUrlInput] = useState<string>('');
  const [tokenInput, setTokenInput] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/settings/cloudhub/status`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch {
      // Keep silent on fetch errors
    } finally {
      setIsLoading(false);
    }
  }, [API]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 4000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hubUrlInput.trim() || !tokenInput.trim()) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch(`${API}/api/settings/cloudhub/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          hub_url: hubUrlInput.trim(),
          token: tokenInput.trim(),
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || t('settings.cloudhub.enrollFailed', 'Enrollment failed'));
      }

      setSuccessMessage(t('settings.cloudhub.enrollSuccess', 'Appliance successfully enrolled to CloudHub'));
      setHubUrlInput('');
      setTokenInput('');
      await fetchStatus();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm(t('settings.cloudhub.confirmUnlink', 'Are you sure you want to unlink this appliance from CloudHub?'))) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch(`${API}/api/settings/cloudhub/disconnect`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!res.ok) {
        throw new Error(t('settings.cloudhub.unlinkFailed', 'Failed to unlink from CloudHub'));
      }

      setSuccessMessage(t('settings.cloudhub.unlinkSuccess', 'Appliance unlinked from CloudHub'));
      await fetchStatus();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleSSO = async () => {
    if (!status) return;
    const newSSO = !status.sso_enabled;

    try {
      const res = await fetch(`${API}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cloudhub_sso_enabled: newSSO }),
      });

      if (res.ok) {
        setStatus({ ...status, sso_enabled: newSSO });
      }
    } catch {
      // Ignored
    }
  };

  const handleToggleEnabled = async () => {
    if (!status) return;
    const newEnabled = !status.enabled;

    try {
      const res = await fetch(`${API}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cloudhub_enabled: newEnabled }),
      });

      if (res.ok) {
        setStatus({ ...status, enabled: newEnabled, connected: newEnabled ? status.connected : false });
        await fetchStatus();
      }
    } catch {
      // Ignored
    }
  };

  const isEnrolled = Boolean(status?.node_id);

  return (
    <div className="glass-card p-5 !rounded-2xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-brand-cyan" />
          <h4 className="text-brand-cyan font-bold text-xs uppercase tracking-wider flex items-center gap-1.5">
            ☁️ {t('settings.cloudhub.cardTitle', 'CLOUDHUB REVERSE TUNNEL CONNECTOR')}
          </h4>
        </div>

        {/* Status Pill */}
        <div className="flex items-center gap-2">
          {isLoading ? (
            <span className="text-[10px] text-[var(--text-secondary)] font-mono animate-pulse">...</span>
          ) : !isEnrolled ? (
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-white/5 text-[var(--text-secondary)] border border-[var(--glass-border)]">
              {t('settings.cloudhub.statusUnenrolled', 'Not Enrolled')}
            </span>
          ) : status?.connected ? (
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {t('settings.cloudhub.statusConnected', 'Connected')}
            </span>
          ) : status?.enabled ? (
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
              {t('settings.cloudhub.statusReconnecting', 'Reconnecting')}
            </span>
          ) : (
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-500/10 text-zinc-400 border border-zinc-500/30">
              {t('settings.cloudhub.statusDisabled', 'Tunnel Disabled')}
            </span>
          )}
        </div>
      </div>

      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
        {t(
          'settings.cloudhub.description',
          'Enables outbound WebSocket reverse tunneling to a central CloudHub bastion, providing zero-port-forwarding NAT/CGNAT remote access and telemetry.'
        )}
      </p>

      {/* Messages */}
      {errorMessage && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
          ⚠️ {errorMessage}
        </div>
      )}
      {successMessage && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs">
          ✓ {successMessage}
        </div>
      )}

      {/* Enrolled View */}
      {isEnrolled ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4 rounded-xl bg-black/20 border border-[var(--glass-border)]">
            <div>
              <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider block">
                {t('settings.cloudhub.hubUrl', 'CloudHub URL')}
              </span>
              <span className="text-xs font-mono text-[var(--text-primary)] font-semibold break-all">
                {status?.hub_url || '—'}
              </span>
            </div>

            <div>
              <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider block">
                {t('settings.cloudhub.nodeId', 'Node ID')}
              </span>
              <span className="text-xs font-mono text-brand-cyan font-semibold">
                {status?.node_id || '—'}
              </span>
            </div>

            {status?.org_name && (
              <div>
                <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider block">
                  {t('settings.cloudhub.organization', 'Organization')}
                </span>
                <span className="text-xs text-[var(--text-primary)]">
                  {status.org_name}
                </span>
              </div>
            )}

            {status?.group_name && (
              <div>
                <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider block">
                  {t('settings.cloudhub.nodeGroup', 'Node Group')}
                </span>
                <span className="text-xs text-[var(--text-primary)]">
                  {status.group_name}
                </span>
              </div>
            )}
          </div>

          {/* Toggles */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-[var(--text-primary)] block">
                  {t('settings.cloudhub.enableTunnel', 'Enable Outbound Tunnel')}
                </span>
                <span className="text-[11px] text-[var(--text-secondary)]">
                  {t('settings.cloudhub.enableTunnelHelp', 'Keep persistent WebSocket tunnel active to receive remote connections.')}
                </span>
              </div>
              <button
                type="button"
                onClick={handleToggleEnabled}
                disabled={isSubmitting}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${
                  status?.enabled ? 'bg-brand-cyan' : 'bg-white/10'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-black transition-transform ${
                    status?.enabled ? 'translate-x-4' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between border-t border-[var(--glass-border)] pt-3">
              <div>
                <span className="text-xs font-bold text-[var(--text-primary)] block">
                  {t('settings.cloudhub.enableSSO', 'Accept Ephemeral SSO Assertions')}
                </span>
                <span className="text-[11px] text-[var(--text-secondary)]">
                  {t('settings.cloudhub.ssoHelp', 'Allows authenticated CloudHub operators to sign in automatically via HMAC assertions without exposing local password.')}
                </span>
              </div>
              <button
                type="button"
                onClick={handleToggleSSO}
                disabled={isSubmitting}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${
                  status?.sso_enabled ? 'bg-brand-lime' : 'bg-white/10'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-black transition-transform ${
                    status?.sso_enabled ? 'translate-x-4' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Unlink Button */}
          <div className="pt-2 border-t border-[var(--glass-border)] flex justify-end">
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={isSubmitting}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 transition-colors cursor-pointer"
            >
              {t('settings.cloudhub.unlinkButton', 'Unlink from CloudHub')}
            </button>
          </div>
        </div>
      ) : (
        /* Enrollment Form */
        <form onSubmit={handleEnroll} className="space-y-4 pt-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider block">
                {t('settings.cloudhub.hubUrlLabel', 'CloudHub Orchestrator URL')}
              </label>
              <input
                type="url"
                required
                placeholder="https://hub.example.com"
                value={hubUrlInput}
                onChange={(e) => setHubUrlInput(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--input-bg)] border border-[var(--glass-border)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-brand-cyan/60"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider block">
                {t('settings.cloudhub.tokenLabel', 'Enrollment Token')}
              </label>
              <input
                type="text"
                required
                placeholder="chub_enr_..."
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--input-bg)] border border-[var(--glass-border)] text-xs text-[var(--text-primary)] font-mono focus:outline-none focus:border-brand-cyan/60"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <span className="text-[11px] text-[var(--text-secondary)]">
              {t('settings.cloudhub.tokenHelp', 'Obtain this one-time token from your CloudHub organization administrator.')}
            </span>
            <button
              type="submit"
              disabled={isSubmitting || !hubUrlInput.trim() || !tokenInput.trim()}
              className="px-4 py-2 rounded-lg text-xs font-bold text-black bg-brand-cyan hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? '...' : t('settings.cloudhub.enrollButton', 'Enroll Appliance')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
