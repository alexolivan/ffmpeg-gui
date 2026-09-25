import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface LockedIP {
  ip: string;
  remaining_seconds: number;
  expires_at: string;
}

interface BruteForceProtectionCardProps {
  API: string;
  settings: any;
  onUpdateSettings: (newSettings: any) => Promise<void>;
}

export const BruteForceProtectionCard: React.FC<BruteForceProtectionCardProps> = ({
  API,
  settings,
  onUpdateSettings,
}) => {
  const { t } = useTranslation();

  const [enabled, setEnabled] = useState<boolean>(settings.brute_force_enabled ?? true);
  const [maxAttempts, setMaxAttempts] = useState<number>(settings.brute_force_max_attempts ?? 5);
  const [windowSeconds, setWindowSeconds] = useState<number>(settings.brute_force_window_seconds ?? 300);
  const [lockoutSeconds, setLockoutSeconds] = useState<number>(settings.brute_force_lockout_seconds ?? 900);
  const [whitelist, setWhitelist] = useState<string>(settings.brute_force_whitelist ?? '');

  const [saving, setSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<string>('');
  const [saveError, setSaveError] = useState<string>('');

  const [lockedIPs, setLockedIPs] = useState<LockedIP[]>([]);
  const [loadingStatus, setLoadingStatus] = useState<boolean>(false);
  const [unblockingIp, setUnblockingIp] = useState<string | null>(null);

  // Synchronize state if external settings change
  useEffect(() => {
    setEnabled(settings.brute_force_enabled ?? true);
    setMaxAttempts(settings.brute_force_max_attempts ?? 5);
    setWindowSeconds(settings.brute_force_window_seconds ?? 300);
    setLockoutSeconds(settings.brute_force_lockout_seconds ?? 900);
    setWhitelist(settings.brute_force_whitelist ?? '');
  }, [settings]);

  const fetchSecurityStatus = async () => {
    setLoadingStatus(true);
    try {
      const res = await fetch(`${API}/api/settings/security/status`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setLockedIPs(data.active_lockouts || []);
      }
    } catch {
      // Ignore network noise
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    fetchSecurityStatus();
    const interval = setInterval(fetchSecurityStatus, 10000);
    return () => clearInterval(interval);
  }, [API]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    setSaveSuccess('');
    try {
      await onUpdateSettings({
        brute_force_enabled: enabled,
        brute_force_max_attempts: maxAttempts,
        brute_force_window_seconds: windowSeconds,
        brute_force_lockout_seconds: lockoutSeconds,
        brute_force_whitelist: whitelist,
      });
      setSaveSuccess(t('settings.security.bruteForce.savedSuccess', 'Brute-force protection settings saved.'));
      setTimeout(() => setSaveSuccess(''), 4000);
      fetchSecurityStatus();
    } catch (err: any) {
      setSaveError(err.message || t('settings.security.bruteForce.saveError', 'Failed to save settings.'));
    } finally {
      setSaving(false);
    }
  };

  const handleUnblock = async (ip: string) => {
    setUnblockingIp(ip);
    try {
      const res = await fetch(`${API}/api/settings/security/unblock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ip }),
      });
      if (res.ok) {
        setLockedIPs(prev => prev.filter(item => item.ip !== ip));
      }
    } catch {
      // Handled silently
    } finally {
      setUnblockingIp(null);
    }
  };

  return (
    <div className="glass-card p-5 !rounded-2xl space-y-5 animate-in fade-in duration-300">
      {/* CARD HEADER */}
      <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-3">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${enabled ? 'bg-brand-lime' : 'bg-red-500'}`} />
          <h4 className="text-[var(--text-primary)] font-bold text-xs uppercase tracking-wider flex items-center gap-2">
            <span>🛡️</span>
            {t('settings.security.bruteForce.title', 'BRUTE-FORCE & LOGIN PROTECTION')}
          </h4>
        </div>

        {/* Master Enabled Badge */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase font-bold text-text-secondary tracking-wider">
            {enabled ? t('common.enabled', 'ENABLED') : t('common.disabled', 'DISABLED')}
          </span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => setEnabled(e.target.checked)}
            className="rounded text-brand-lime cursor-pointer w-4 h-4"
          />
        </div>
      </div>

      <p className="text-xs text-text-secondary leading-relaxed">
        {t(
          'settings.security.bruteForce.description',
          'Tracks failed login attempts in fast in-memory RAM and temporarily locks out malicious IP addresses. Compatible with Fail2ban and external IDS/IPS via standardized security logs.'
        )}
      </p>

      {/* PARAMETERS GRID */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Max Attempts */}
        <div className="space-y-1">
          <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">
            {t('settings.security.bruteForce.maxAttempts', 'Max Failed Attempts')}
          </label>
          <input
            type="number"
            min={1}
            max={50}
            disabled={!enabled}
            value={maxAttempts}
            onChange={e => setMaxAttempts(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime text-[var(--text-primary)] font-mono disabled:opacity-40"
          />
          <span className="text-[9px] text-text-secondary block">
            {t('settings.security.bruteForce.maxAttemptsHelp', 'Attempts before lockout')}
          </span>
        </div>

        {/* Observation Window */}
        <div className="space-y-1">
          <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">
            {t('settings.security.bruteForce.windowSeconds', 'Observation Window (sec)')}
          </label>
          <input
            type="number"
            min={10}
            max={86400}
            step={10}
            disabled={!enabled}
            value={windowSeconds}
            onChange={e => setWindowSeconds(Math.max(10, parseInt(e.target.value) || 10))}
            className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime text-[var(--text-primary)] font-mono disabled:opacity-40"
          />
          <span className="text-[9px] text-text-secondary block">
            {Math.round(windowSeconds / 60)} {t('common.minutes', 'min')}
          </span>
        </div>

        {/* Lockout Duration */}
        <div className="space-y-1">
          <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">
            {t('settings.security.bruteForce.lockoutSeconds', 'Lockout Duration (sec)')}
          </label>
          <input
            type="number"
            min={30}
            max={604800}
            step={30}
            disabled={!enabled}
            value={lockoutSeconds}
            onChange={e => setLockoutSeconds(Math.max(30, parseInt(e.target.value) || 30))}
            className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime text-[var(--text-primary)] font-mono disabled:opacity-40"
          />
          <span className="text-[9px] text-text-secondary block">
            {Math.round(lockoutSeconds / 60)} {t('common.minutes', 'min')}
          </span>
        </div>
      </div>

      {/* WHITELIST INPUT */}
      <div className="space-y-1.5 pt-1">
        <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">
          {t('settings.security.bruteForce.whitelist', 'IP Whitelist (Immune to lockout)')}
        </label>
        <textarea
          rows={2}
          disabled={!enabled}
          placeholder="192.168.1.50, 10.0.0.0/24"
          value={whitelist}
          onChange={e => setWhitelist(e.target.value)}
          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime text-[var(--text-primary)] font-mono resize-y disabled:opacity-40"
        />
        <div className="flex items-center gap-1.5 text-[9px] text-text-secondary">
          <span className="text-brand-lime">✓</span>
          <span>
            {t(
              'settings.security.bruteForce.loopbackNotice',
              'Localhost (127.0.0.1, ::1) is permanently whitelisted by kernel and application code.'
            )}
          </span>
        </div>
      </div>

      {/* FEEDBACK MESSAGES */}
      {saveSuccess && (
        <p className="text-xs text-brand-lime font-bold animate-in fade-in duration-300">
          ✓ {saveSuccess}
        </p>
      )}
      {saveError && (
        <p className="text-xs text-red-500 font-bold animate-in fade-in duration-300">
          ⚠️ {saveError}
        </p>
      )}

      {/* ACTION BUTTON */}
      <div className="flex justify-end pt-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-brand-lime/15 hover:bg-brand-lime/25 text-brand-lime border border-brand-lime/30 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <span>💾</span>
          <span>{saving ? t('common.saving', 'Saving...') : t('settings.security.bruteForce.saveBtn', 'Save Security Settings')}</span>
        </button>
      </div>

      {/* ACTIVE LOCKOUTS SECTION */}
      <div className="pt-3 border-t border-[var(--glass-border)] space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
              🚫 {t('settings.security.bruteForce.activeLockoutsTitle', 'Active IP Lockouts (RAM)')}
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--input-bg)] text-text-secondary font-mono border border-[var(--glass-border)]">
              {lockedIPs.length}
            </span>
          </div>

          <button
            type="button"
            onClick={fetchSecurityStatus}
            disabled={loadingStatus}
            className="text-[10px] text-text-secondary hover:text-[var(--text-primary)] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1"
          >
            <span>🔄</span>
            <span>{loadingStatus ? '...' : t('common.refresh', 'Refresh')}</span>
          </button>
        </div>

        {lockedIPs.length === 0 ? (
          <div className="p-3 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl text-center">
            <span className="text-xs text-text-secondary">
              {t('settings.security.bruteForce.noLockouts', 'No IP addresses currently locked out.')}
            </span>
          </div>
        ) : (
          <div className="space-y-2">
            {lockedIPs.map(item => (
              <div
                key={item.ip}
                className="flex items-center justify-between p-2.5 bg-red-500/10 border border-red-500/20 rounded-xl text-xs font-mono text-[var(--text-primary)] animate-in fade-in duration-200"
              >
                <div className="flex items-center gap-3">
                  <span className="text-red-400 font-bold">{item.ip}</span>
                  <span className="text-[10px] text-text-secondary">
                    {item.remaining_seconds}s {t('settings.security.bruteForce.remaining', 'remaining')}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => handleUnblock(item.ip)}
                  disabled={unblockingIp === item.ip}
                  className="px-2.5 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1"
                >
                  <span>🔓</span>
                  <span>
                    {unblockingIp === item.ip
                      ? t('common.processing', 'Unblocking...')
                      : t('settings.security.bruteForce.unblockBtn', 'Unblock')}
                  </span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
