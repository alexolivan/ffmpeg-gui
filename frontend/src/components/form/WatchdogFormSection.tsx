import React from 'react';
import { useTranslation } from 'react-i18next';

export interface SignalWatchdogConfig {
  silence_enabled: boolean;
  silence_threshold_db: number;
  silence_duration: number;
  black_enabled: boolean;
  black_duration: number;
  black_picture_ratio: number;
  black_threshold: number;
  freeze_enabled: boolean;
  freeze_noise_db: number;
  freeze_duration: number;
  condition_logic: 'or' | 'and';
  recovery_delay: number;
  reaction_mode: 'alert_only' | 'restart_self' | 'activate_backup';
  backup_service_id: number | null;
}

export const DEFAULT_SIGNAL_WATCHDOG: SignalWatchdogConfig = {
  silence_enabled: false,
  silence_threshold_db: -50,
  silence_duration: 10,
  black_enabled: false,
  black_duration: 5,
  black_picture_ratio: 0.98,
  black_threshold: 0.1,
  freeze_enabled: false,
  freeze_noise_db: -60,
  freeze_duration: 10,
  condition_logic: 'or',
  recovery_delay: 15,
  reaction_mode: 'alert_only',
  backup_service_id: null,
};

interface WatchdogFormSectionProps {
  watchdog_enabled: boolean;
  watchdog_retries: number;
  watchdog_circuit_breaker: boolean;
  watchdog_min_speed: number | null;
  watchdog_min_speed_duration: number;
  watchdog_max_memory_mb: number | null;
  watchdog_max_memory_duration: number;
  onLifecycleChange: (updates: any) => void;
  signal_watchdog: SignalWatchdogConfig;
  onSignalWatchdogChange: (updates: Partial<SignalWatchdogConfig>) => void;
  hasVideo: boolean;
  hasAudio: boolean;
  isVideoCopy: boolean;
  isAudioCopy: boolean;
  isHardwareVideoCodec: boolean;
  availableServices: Array<{ id: number; name: string; service_type?: string }>;
  currentProcessId?: number | null;
}

export const WatchdogFormSection: React.FC<WatchdogFormSectionProps> = ({
  watchdog_enabled,
  watchdog_retries,
  watchdog_circuit_breaker,
  watchdog_min_speed,
  watchdog_min_speed_duration,
  watchdog_max_memory_mb,
  watchdog_max_memory_duration,
  onLifecycleChange,
  signal_watchdog,
  onSignalWatchdogChange,
  hasVideo,
  hasAudio,
  isVideoCopy,
  isAudioCopy,
  isHardwareVideoCodec,
  availableServices,
  currentProcessId,
}) => {
  const { t } = useTranslation();
  const sw = { ...DEFAULT_SIGNAL_WATCHDOG, ...(signal_watchdog || {}) };

  const audioDisabled = !hasAudio || isAudioCopy;
  const videoDisabled = !hasVideo || isVideoCopy;
  const anySensorEnabled =
    (sw.silence_enabled && !audioDisabled) ||
    (sw.black_enabled && !videoDisabled) ||
    (sw.freeze_enabled && !videoDisabled);

  const backupCandidates = (availableServices || []).filter(
    svc => svc.id !== currentProcessId && svc.service_type !== 'pipewire_hub'
  );

  return (
    <div className="space-y-4">
      {/* 1. Process Watchdog */}
      <div className="p-3 bg-[var(--input-bg)] rounded-xl border border-[var(--glass-border)] space-y-2.5">
        <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
          {t('watchdog.processSectionTitle', 'Process Watchdog & Crash Recovery')}
        </h4>

        <div className="flex items-center justify-between p-2 rounded-lg border border-[var(--glass-border)]">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              {t('lifecycle.enableWatchdog', 'Enable Watchdog')}
            </span>
            <span className="text-[10px] text-[var(--text-secondary)]">
              {t('lifecycle.watchdogDesc', 'Monitor process health and auto-restart on unexpected crashes.')}
            </span>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={watchdog_enabled}
              onChange={e => onLifecycleChange({ watchdog_enabled: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-lime"></div>
          </label>
        </div>

        {watchdog_enabled && (
          <div className="p-2 rounded-lg border border-[var(--glass-border)] space-y-2 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-semibold text-[var(--text-primary)]">
                  {t('lifecycle.infiniteRetries', 'Infinite Restart Attempts')}
                </span>
                <span className="text-[10px] text-[var(--text-secondary)]">
                  {t('lifecycle.infiniteRetriesDesc', 'Keep trying to restart the process indefinitely.')}
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={watchdog_retries === -1}
                  onChange={e => onLifecycleChange({ watchdog_retries: e.target.checked ? -1 : 5 })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-lime"></div>
              </label>
            </div>

            {watchdog_retries !== -1 && (
              <div className="flex items-center gap-2 pt-1.5 border-t border-[var(--glass-border)]">
                <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] block">
                  {t('lifecycle.maxRetries', 'Maximum consecutive retries:')}
                </label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] outline-none w-20 focus:border-brand-lime"
                  value={watchdog_retries}
                  onChange={e => onLifecycleChange({ watchdog_retries: Math.max(1, parseInt(e.target.value) || 1) })}
                />
              </div>
            )}

            {/* Minimum Speed */}
            <div className="flex items-center gap-4 pt-2.5 border-t border-[var(--glass-border)] flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] block">
                  {t('lifecycle.minSpeed', 'Minimum Speed:')}
                </label>
                <input
                  type="number"
                  step="0.05"
                  min="0.05"
                  max="10.0"
                  placeholder={t('common.disabled', 'Disabled')}
                  className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] outline-none w-28 focus:border-brand-lime"
                  value={watchdog_min_speed === null || watchdog_min_speed === undefined ? '' : watchdog_min_speed}
                  onChange={e => {
                    const val = e.target.value ? parseFloat(e.target.value) : null;
                    onLifecycleChange({ watchdog_min_speed: val });
                  }}
                />
              </div>
              {watchdog_min_speed !== null && watchdog_min_speed !== undefined && (
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] block">
                    {t('lifecycle.tolerance', 'Tolerance (s):')}
                  </label>
                  <input
                    type="number"
                    min="5"
                    max="3600"
                    className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] outline-none w-20 focus:border-brand-lime"
                    value={watchdog_min_speed_duration}
                    onChange={e =>
                      onLifecycleChange({ watchdog_min_speed_duration: Math.max(5, parseInt(e.target.value) || 30) })
                    }
                  />
                </div>
              )}
            </div>

            {/* Max RAM */}
            <div className="flex items-center gap-4 pt-2.5 border-t border-[var(--glass-border)] flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] block">
                  {t('lifecycle.maxMemory', 'Max RAM (MB):')}
                </label>
                <input
                  type="number"
                  step="64"
                  min="128"
                  max="65536"
                  placeholder={t('common.disabled', 'Disabled')}
                  className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] outline-none w-28 focus:border-brand-lime font-mono"
                  value={watchdog_max_memory_mb === null || watchdog_max_memory_mb === undefined ? '' : watchdog_max_memory_mb}
                  onChange={e => {
                    const val = e.target.value ? parseInt(e.target.value, 10) : null;
                    onLifecycleChange({ watchdog_max_memory_mb: val });
                  }}
                />
              </div>
              {watchdog_max_memory_mb !== null && watchdog_max_memory_mb !== undefined && (
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] block">
                    {t('lifecycle.tolerance', 'Tolerance (s):')}
                  </label>
                  <input
                    type="number"
                    min="5"
                    max="3600"
                    className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] outline-none w-20 focus:border-brand-lime font-mono"
                    value={watchdog_max_memory_duration ?? 30}
                    onChange={e =>
                      onLifecycleChange({ watchdog_max_memory_duration: Math.max(5, parseInt(e.target.value, 10) || 30) })
                    }
                  />
                </div>
              )}
            </div>

            {/* Circuit Breaker */}
            <div className="flex items-center justify-between pt-2 border-t border-[var(--glass-border)]">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-semibold text-[var(--text-primary)]">
                  {t('lifecycle.circuitBreaker', 'Crash-Loop Circuit Breaker')}
                </span>
                <span className="text-[10px] text-[var(--text-secondary)]">
                  {t('lifecycle.circuitBreakerDesc', 'Abort retries automatically on fatal unrecoverable errors (missing binary protocol, format or codec).')}
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={watchdog_circuit_breaker}
                  onChange={e => onLifecycleChange({ watchdog_circuit_breaker: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-lime"></div>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* 2. In-Band Signal Watchdog */}
      <div className="p-3 bg-[var(--input-bg)] rounded-xl border border-[var(--glass-border)] space-y-3">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
            {t('watchdog.signalSectionTitle', 'In-Band Signal Watchdog')}
          </h4>
          <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">
            {t('watchdog.signalSectionDesc', 'Real-time audio/video content anomaly detection via FFmpeg pass-through filters.')}
          </p>
        </div>

        {(isAudioCopy || isVideoCopy) && (
          <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300">
            {t('watchdog.streamCopyWarning', 'In-band signal sensors are unavailable while the corresponding stream is set to Stream Copy (passthrough).')}
          </div>
        )}

        {/* Silence Sensor */}
        <div className={`p-2.5 rounded-lg border border-[var(--glass-border)] space-y-2 ${audioDisabled ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              {t('watchdog.silenceEnable', 'Enable Silence Detection')}
            </span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                disabled={audioDisabled}
                checked={sw.silence_enabled && !audioDisabled}
                onChange={e => onSignalWatchdogChange({ silence_enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-white/10 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-lime"></div>
            </label>
          </div>
          {sw.silence_enabled && !audioDisabled && (
            <div className="grid grid-cols-2 gap-3 pt-1.5 border-t border-[var(--glass-border)]">
              <div>
                <label className="text-[10px] font-bold uppercase text-[var(--text-secondary)] block mb-1">
                  {t('watchdog.silenceThreshold', 'Noise Threshold (dBFS)')}
                </label>
                <input
                  type="number"
                  min="-90"
                  max="0"
                  value={sw.silence_threshold_db}
                  onChange={e => onSignalWatchdogChange({ silence_threshold_db: parseFloat(e.target.value) || -50 })}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] font-mono outline-none focus:border-brand-lime"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-[var(--text-secondary)] block mb-1">
                  {t('watchdog.silenceDuration', 'Minimum Silence Duration (s)')}
                </label>
                <input
                  type="number"
                  min="1"
                  max="3600"
                  value={sw.silence_duration}
                  onChange={e => onSignalWatchdogChange({ silence_duration: Math.max(1, parseInt(e.target.value, 10) || 10) })}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] font-mono outline-none focus:border-brand-lime"
                />
              </div>
            </div>
          )}
        </div>

        {/* Black Frame Sensor */}
        <div className={`p-2.5 rounded-lg border border-[var(--glass-border)] space-y-2 ${videoDisabled ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              {t('watchdog.blackEnable', 'Enable Black Frame Detection')}
            </span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                disabled={videoDisabled}
                checked={sw.black_enabled && !videoDisabled}
                onChange={e => onSignalWatchdogChange({ black_enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-white/10 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-lime"></div>
            </label>
          </div>
          {sw.black_enabled && !videoDisabled && (
            <div className="grid grid-cols-3 gap-3 pt-1.5 border-t border-[var(--glass-border)]">
              <div>
                <label className="text-[10px] font-bold uppercase text-[var(--text-secondary)] block mb-1">
                  {t('watchdog.blackDuration', 'Minimum Black Duration (s)')}
                </label>
                <input
                  type="number"
                  min="1"
                  max="3600"
                  value={sw.black_duration}
                  onChange={e => onSignalWatchdogChange({ black_duration: Math.max(1, parseInt(e.target.value, 10) || 5) })}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] font-mono outline-none focus:border-brand-lime"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-[var(--text-secondary)] block mb-1">
                  {t('watchdog.blackPictureRatio', 'Pixel Ratio Threshold')}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.5"
                  max="1"
                  value={sw.black_picture_ratio}
                  onChange={e => onSignalWatchdogChange({ black_picture_ratio: parseFloat(e.target.value) || 0.98 })}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] font-mono outline-none focus:border-brand-lime"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-[var(--text-secondary)] block mb-1">
                  {t('watchdog.blackThreshold', 'Luma Threshold')}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="0.5"
                  value={sw.black_threshold}
                  onChange={e => onSignalWatchdogChange({ black_threshold: parseFloat(e.target.value) || 0.1 })}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] font-mono outline-none focus:border-brand-lime"
                />
              </div>
            </div>
          )}
        </div>

        {/* Freeze Sensor */}
        <div className={`p-2.5 rounded-lg border border-[var(--glass-border)] space-y-2 ${videoDisabled ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              {t('watchdog.freezeEnable', 'Enable Freeze Detection')}
            </span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                disabled={videoDisabled}
                checked={sw.freeze_enabled && !videoDisabled}
                onChange={e => onSignalWatchdogChange({ freeze_enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-white/10 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-lime"></div>
            </label>
          </div>
          {sw.freeze_enabled && !videoDisabled && (
            <div className="grid grid-cols-2 gap-3 pt-1.5 border-t border-[var(--glass-border)]">
              <div>
                <label className="text-[10px] font-bold uppercase text-[var(--text-secondary)] block mb-1">
                  {t('watchdog.freezeNoise', 'Noise Tolerance (dBFS)')}
                </label>
                <input
                  type="number"
                  min="-90"
                  max="-10"
                  value={sw.freeze_noise_db}
                  onChange={e => onSignalWatchdogChange({ freeze_noise_db: parseFloat(e.target.value) || -60 })}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] font-mono outline-none focus:border-brand-lime"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-[var(--text-secondary)] block mb-1">
                  {t('watchdog.freezeDuration', 'Minimum Freeze Duration (s)')}
                </label>
                <input
                  type="number"
                  min="1"
                  max="3600"
                  value={sw.freeze_duration}
                  onChange={e => onSignalWatchdogChange({ freeze_duration: Math.max(1, parseInt(e.target.value, 10) || 10) })}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] font-mono outline-none focus:border-brand-lime"
                />
              </div>
            </div>
          )}
        </div>

        {isHardwareVideoCodec && !videoDisabled && (sw.black_enabled || sw.freeze_enabled) && (
          <div className="p-2 rounded-lg bg-brand-lime/10 border border-brand-lime/30 text-[11px] text-brand-lime">
            {t('watchdog.vramBridgeHint', 'Hardware codec active: frames will be downloaded to CPU RAM for pixel inspection and re-uploaded if needed.')}
          </div>
        )}

        {/* Evaluation & Reaction */}
        {anySensorEnabled && (
          <div className="p-2.5 rounded-lg border border-[var(--glass-border)] space-y-2.5 animate-in fade-in duration-200">
            <h5 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-primary)]">
              {t('watchdog.evaluationTitle', 'Evaluation Logic & Reaction')}
            </h5>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold uppercase text-[var(--text-secondary)] block mb-1">
                  {t('watchdog.conditionLogic', 'Trigger Logic')}
                </label>
                <select
                  value={sw.condition_logic}
                  onChange={e => onSignalWatchdogChange({ condition_logic: e.target.value as 'or' | 'and' })}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-brand-lime"
                >
                  <option value="or">{t('watchdog.logicOr', 'OR (Any enabled sensor trips)')}</option>
                  <option value="and">{t('watchdog.logicAnd', 'AND (All enabled sensors must trip)')}</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-[var(--text-secondary)] block mb-1">
                  {t('watchdog.recoveryDelay', 'Recovery Hold-off Delay (s)')}
                </label>
                <input
                  type="number"
                  min="0"
                  max="3600"
                  value={sw.recovery_delay}
                  onChange={e => onSignalWatchdogChange({ recovery_delay: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2 py-1.5 text-xs text-[var(--text-primary)] font-mono outline-none focus:border-brand-lime"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold uppercase text-[var(--text-secondary)] block mb-1">
                  {t('watchdog.reactionMode', 'Failover Reaction')}
                </label>
                <select
                  value={sw.reaction_mode}
                  onChange={e =>
                    onSignalWatchdogChange({
                      reaction_mode: e.target.value as 'alert_only' | 'restart_self' | 'activate_backup',
                    })
                  }
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-brand-lime"
                >
                  <option value="alert_only">{t('watchdog.reactionAlertOnly', 'Alert Only (Log, Badge, Email & Metrics)')}</option>
                  <option value="restart_self">{t('watchdog.reactionRestartSelf', 'Restart This Service')}</option>
                  <option value="activate_backup">{t('watchdog.reactionActivateBackup', 'Activate Backup Service (Failover Lease)')}</option>
                </select>
              </div>

              {sw.reaction_mode === 'activate_backup' && (
                <div>
                  <label className="text-[10px] font-bold uppercase text-[var(--text-secondary)] block mb-1">
                    {t('watchdog.backupService', 'Backup Service')}
                  </label>
                  <select
                    value={sw.backup_service_id ?? ''}
                    onChange={e =>
                      onSignalWatchdogChange({
                        backup_service_id: e.target.value ? parseInt(e.target.value, 10) : null,
                      })
                    }
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-brand-lime"
                  >
                    <option value="">
                      {backupCandidates.length === 0
                        ? t('watchdog.noBackupServices', 'No other services available')
                        : t('watchdog.selectBackupService', 'Select a backup service...')}
                    </option>
                    {backupCandidates.map(svc => (
                      <option key={svc.id} value={svc.id}>
                        {svc.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
