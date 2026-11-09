import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { EngineLogo } from '../common/EngineLogo';

export interface ServiceRestartTaskFormProps {
  API: string;
  initialConfig?: any | null;
  onCancel: () => void;
  onSubmit: (taskPayload: any) => Promise<void>;
}

interface ServiceOption {
  id: number;
  name: string;
  service_type?: string;
  status?: string;
}

export const ServiceRestartTaskForm: React.FC<ServiceRestartTaskFormProps> = ({
  API,
  initialConfig,
  onCancel,
  onSubmit,
}) => {
  const { t } = useTranslation();

  const isEditing = Boolean(initialConfig && initialConfig.id);
  const inputCfg = initialConfig?.input_config || {};

  const [name, setName] = useState<string>(initialConfig?.name || '');
  const [alias, setAlias] = useState<string>(initialConfig?.alias || '');
  const [serviceIds, setServiceIds] = useState<number[]>(
    Array.isArray(inputCfg.service_ids) ? inputCfg.service_ids : []
  );
  const [staggerDelaySeconds, setStaggerDelaySeconds] = useState<number>(
    inputCfg.stagger_delay_seconds !== undefined ? inputCfg.stagger_delay_seconds : 5
  );
  const [onlyIfRunning, setOnlyIfRunning] = useState<boolean>(
    inputCfg.only_if_running !== undefined ? Boolean(inputCfg.only_if_running) : true
  );

  // Scheduling state
  const [isActive, setIsActive] = useState<boolean>(
    initialConfig?.is_active !== undefined ? Boolean(initialConfig.is_active) : true
  );
  const [scheduleType, setScheduleType] = useState<string>(
    initialConfig?.schedule_type || 'recurring'
  );
  const [scheduleCron, setScheduleCron] = useState<string>(
    initialConfig?.schedule_cron || '0 4 * * *'
  );
  const [scheduleDatetime, setScheduleDatetime] = useState<string>(
    initialConfig?.schedule_datetime
      ? new Date(initialConfig.schedule_datetime).toISOString().slice(0, 16)
      : ''
  );

  // Available services list
  const [availableServices, setAvailableServices] = useState<ServiceOption[]>([]);
  const [selectedServiceToAdd, setSelectedServiceToAdd] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const fetchServices = async () => {
      try {
        const res = await fetch(`${API}/processes`);
        if (res.ok) {
          const data = await res.json();
          if (isMounted && Array.isArray(data)) {
            setAvailableServices(data);
            if (data.length > 0 && !selectedServiceToAdd) {
              setSelectedServiceToAdd(String(data[0].id));
            }
          }
        }
      } catch (err) {
        console.error('Failed to load services for task restarter:', err);
      }
    };
    fetchServices();
    return () => {
      isMounted = false;
    };
  }, [API]);

  const handleAddService = () => {
    if (!selectedServiceToAdd) return;
    const sid = parseInt(selectedServiceToAdd, 10);
    if (!isNaN(sid)) {
      setServiceIds((prev) => [...prev, sid]);
      setValidationError(null);
    }
  };

  const handleMoveUp = (index: number) => {
    if (index <= 0) return;
    setServiceIds((prev) => {
      const copy = [...prev];
      const temp = copy[index - 1];
      copy[index - 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
  };

  const handleMoveDown = (index: number) => {
    setServiceIds((prev) => {
      if (index >= prev.length - 1) return prev;
      const copy = [...prev];
      const temp = copy[index + 1];
      copy[index + 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
  };

  const handleRemove = (index: number) => {
    setServiceIds((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setValidationError(t('common.nameRequired', 'Task name is required.'));
      return;
    }
    if (serviceIds.length === 0) {
      setValidationError(
        t('tasks.serviceRestart.noServicesSelectedError', 'Please add at least one service to the restart sequence.')
      );
      return;
    }

    setIsSubmitting(true);
    setValidationError(null);

    const payload = {
      name: name.trim(),
      alias: alias.trim() ? alias.trim() : null,
      is_active: scheduleType === 'manual' ? true : isActive,
      command: 'system://service_restart',
      input_config: {
        type: 'service_restart',
        service_ids: serviceIds,
        stagger_delay_seconds: Math.max(0, parseInt(String(staggerDelaySeconds), 10) || 0),
        only_if_running: onlyIfRunning,
      },
      output_config: {},
      codec_config: {},
      filter_config: null,
      ffmpeg_build_id: null,
      schedule_type: scheduleType,
      schedule_cron: scheduleType === 'recurring' ? scheduleCron.trim() : null,
      schedule_datetime: scheduleType === 'one_shot' && scheduleDatetime ? new Date(scheduleDatetime).toISOString() : null,
      duration_type: 'input_dependent',
      duration_seconds: null,
      duration_end_time: null,
      retry_policy: null,
      allow_auto_start_deps: false,
      allow_auto_stop_deps: false,
    };

    try {
      await onSubmit(payload);
    } catch (err: any) {
      setValidationError(err.message || 'Failed to save task');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 overflow-y-auto max-h-[80vh] p-1 pr-2">
      {validationError && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs font-semibold">
          ⚠ {validationError}
        </div>
      )}

      {/* Basic Task Information */}
      <div className="glass-card p-3 rounded-xl border border-[var(--glass-border)] bg-white/2 space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-brand-lime" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
            {t('common.general', 'General Configuration')}
          </h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2 space-y-1">
            <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)] tracking-wider">
              {t('common.name', 'Task Name')} *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Nightly Playout DeckLink Restarter"
              className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] focus:border-brand-lime outline-none"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)] tracking-wider">
              {t('settings.lcdAlias', 'LCD Alias')}
            </label>
            <input
              type="text"
              maxLength={12}
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="e.g. RESTART-DK"
              className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-xs font-mono text-[var(--text-primary)] focus:border-brand-lime outline-none uppercase"
            />
          </div>
        </div>
      </div>

      {/* Ordered Service Queue */}
      <div className="glass-card p-3 rounded-xl border border-[var(--glass-border)] bg-white/2 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-brand-orange" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
              {t('tasks.serviceRestart.sequenceTitle', 'Ordered Restart Sequence')}
            </h4>
          </div>

          {/* Add service bar */}
          <div className="flex items-center gap-2">
            <select
              value={selectedServiceToAdd}
              onChange={(e) => setSelectedServiceToAdd(e.target.value)}
              className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:border-brand-lime outline-none"
            >
              {availableServices.length === 0 ? (
                <option value="">{t('common.noData', 'No services found')}</option>
              ) : (
                availableServices.map((svc) => (
                  <option key={svc.id} value={String(svc.id)}>
                    {svc.name} (#{svc.id}) [{svc.service_type || 'ffmpeg_stream'}]
                  </option>
                ))
              )}
            </select>
            <button
              type="button"
              onClick={handleAddService}
              disabled={availableServices.length === 0}
              className="px-3 py-1.5 rounded-lg bg-brand-lime/10 hover:bg-brand-lime/20 text-brand-lime border border-brand-lime/30 text-xs font-bold transition-all disabled:opacity-50"
            >
              + {t('tasks.serviceRestart.addService', 'Add to Sequence')}
            </button>
          </div>
        </div>

        {/* Sequence List */}
        {serviceIds.length === 0 ? (
          <div className="p-6 border border-dashed border-white/10 rounded-xl text-center text-xs text-[var(--text-secondary)] italic">
            {t('tasks.serviceRestart.emptySequence', 'No services added yet. Select a service above and click "Add to Sequence".')}
          </div>
        ) : (
          <div className="space-y-1.5">
            {serviceIds.map((sid, index) => {
              const svc = availableServices.find((s) => s.id === sid);
              const svcName = svc ? svc.name : `Service #${sid}`;
              const svcType = svc?.service_type || 'ffmpeg_stream';
              const isRunning = svc?.status === 'running';

              return (
                <div
                  key={`${sid}-${index}`}
                  className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-white/5 border border-white/5 hover:border-white/10 transition-all text-xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-5 h-5 rounded-full bg-black/40 text-[10px] font-mono font-bold flex items-center justify-center text-[var(--text-secondary)] flex-shrink-0">
                      {index + 1}
                    </span>
                    <EngineLogo softwareType={svcType} size={16} API={API} />
                    <strong className="truncate text-[var(--text-primary)]">{svcName}</strong>
                    <span className="text-[10px] text-[var(--text-secondary)] font-mono">#{sid}</span>
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                        isRunning
                          ? 'bg-brand-lime/10 text-brand-lime border border-brand-lime/20'
                          : 'bg-white/5 text-[var(--text-secondary)] border border-white/5'
                      }`}
                    >
                      {svc?.status || 'unknown'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => handleMoveUp(index)}
                      className="w-7 h-7 rounded bg-white/5 hover:bg-white/10 text-[var(--text-primary)] disabled:opacity-20 flex items-center justify-center font-bold"
                      title={t('tasks.serviceRestart.stepMoveUp', 'Move up')}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={index === serviceIds.length - 1}
                      onClick={() => handleMoveDown(index)}
                      className="w-7 h-7 rounded bg-white/5 hover:bg-white/10 text-[var(--text-primary)] disabled:opacity-20 flex items-center justify-center font-bold"
                      title={t('tasks.serviceRestart.stepMoveDown', 'Move down')}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemove(index)}
                      className="w-7 h-7 rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 flex items-center justify-center font-bold ml-1"
                      title={t('tasks.serviceRestart.stepRemove', 'Remove')}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Options Row: Stagger Delay & only_if_running */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 border-t border-white/5">
          <div className="space-y-1">
            <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)] tracking-wider block">
              {t('tasks.serviceRestart.staggerDelay', 'Stagger Delay Between Restarts')}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                max="600"
                step="1"
                value={staggerDelaySeconds}
                onChange={(e) => setStaggerDelaySeconds(Math.max(0, parseInt(e.target.value, 10) || 0))}
                className="w-28 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-1.5 text-xs font-mono text-[var(--text-primary)] focus:border-brand-lime outline-none"
              />
              <span className="text-xs text-[var(--text-secondary)]">seconds</span>
            </div>
            <p className="text-[10px] text-[var(--text-secondary)]">
              {t('tasks.serviceRestart.staggerDelayDesc', 'Seconds to wait before initiating the restart of the next service.')}
            </p>
          </div>

          <div className="flex items-center justify-between p-2.5 bg-white/5 rounded-xl border border-white/5">
            <div className="flex flex-col gap-0.5 pr-2">
              <span className="text-xs font-semibold text-[var(--text-primary)]">
                {t('tasks.serviceRestart.onlyIfRunning', 'Only restart if currently running')}
              </span>
              <span className="text-[10px] text-[var(--text-secondary)]">
                {t('tasks.serviceRestart.onlyIfRunningDesc', 'Safeguard: Skips services that are stopped or disabled.')}
              </span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
              <input
                type="checkbox"
                checked={onlyIfRunning}
                onChange={(e) => setOnlyIfRunning(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-lime" />
            </label>
          </div>
        </div>
      </div>

      {/* Scheduling Mechanism */}
      <div className="glass-card p-3 rounded-xl border border-[var(--glass-border)] bg-white/2 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-brand-lime" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
              {t('tasks.triggerAndScheduling', 'Trigger & Scheduling')}
            </h4>
          </div>

          {scheduleType !== 'manual' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-secondary)] font-medium">
                {t('tasks.taskScheduleStatus', 'Task Schedule Status')}
              </span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-8 h-4.5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-brand-lime" />
              </label>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)] tracking-wider">
              Trigger Mechanism
            </label>
            <select
              value={scheduleType}
              onChange={(e) => setScheduleType(e.target.value)}
              className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] focus:border-brand-lime outline-none"
            >
              <option value="recurring">Recurring (Cron Schedule)</option>
              <option value="one_shot">One-shot (Target DateTime)</option>
              <option value="manual">Manual Trigger Only (On-Demand)</option>
            </select>
          </div>

          {scheduleType === 'recurring' && (
            <div className="space-y-1">
              <label className="text-[11px] font-bold uppercase text-brand-lime tracking-wider">
                {t('tasks.cronExpressionLabel', 'Cron Expression')} *
              </label>
              <input
                type="text"
                required
                value={scheduleCron}
                onChange={(e) => setScheduleCron(e.target.value)}
                placeholder="e.g. 0 4 * * * (Daily at 04:00 AM)"
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-xs font-mono text-brand-lime focus:border-brand-lime outline-none"
              />
              <span className="text-[10px] text-[var(--text-secondary)]">
                Default: <code>0 4 * * *</code> (daily at 04:00 AM).
              </span>
            </div>
          )}

          {scheduleType === 'one_shot' && (
            <div className="space-y-1">
              <label className="text-[11px] font-bold uppercase text-brand-orange tracking-wider">
                {t('tasks.targetDateLabel', 'Target Date & Time')} *
              </label>
              <input
                type="datetime-local"
                required
                value={scheduleDatetime}
                onChange={(e) => setScheduleDatetime(e.target.value)}
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] focus:border-brand-lime outline-none"
              />
            </div>
          )}
        </div>
      </div>

      {/* Form Action Buttons */}
      <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/5">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="px-4 py-2 rounded-lg text-xs font-bold text-[var(--text-secondary)] hover:text-white hover:bg-white/5 transition-all"
        >
          {t('common.cancel', 'Cancel')}
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-5 py-2 rounded-lg text-xs font-bold bg-brand-lime text-black hover:opacity-90 shadow-md shadow-brand-lime/20 transition-all disabled:opacity-50"
        >
          {isSubmitting ? t('common.saving', 'Saving...') : isEditing ? t('common.saveChanges', 'Save Changes') : t('tasks.newTask', 'Create Task')}
        </button>
      </div>
    </form>
  );
};
