import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EngineLogo } from '../common/EngineLogo';
import { SearchableSelect } from '../common/SearchableSelect';
import type { BuildProfile } from '../BuildProfileCard';
import { getDefaultCompileJobs, getNextNightlyDatetimeLocal } from '../../utils/forgeBuildHelpers';

export interface ForgeBuildTaskFormProps {
  API: string;
  initialConfig?: any | null;
  onCancel: () => void;
  onSubmit: (taskPayload: any) => Promise<void>;
}

export const ForgeBuildTaskForm: React.FC<ForgeBuildTaskFormProps> = ({
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
  const [targetMode, setTargetMode] = useState<'all_pending' | 'selected'>(
    inputCfg.target_mode === 'all_pending' || inputCfg.target_mode === 'selected'
      ? inputCfg.target_mode
      : Array.isArray(inputCfg.build_ids) && inputCfg.build_ids.length > 0
        ? 'selected'
        : 'all_pending'
  );
  const [buildIds, setBuildIds] = useState<number[]>(
    Array.isArray(inputCfg.build_ids) ? inputCfg.build_ids.map(Number) : []
  );
  const [onlyIfPending, setOnlyIfPending] = useState<boolean>(
    inputCfg.only_if_pending !== undefined ? Boolean(inputCfg.only_if_pending) : true
  );
  const [cpuCores, setCpuCores] = useState<number>(4);
  const [maxJobs, setMaxJobs] = useState<number>(
    inputCfg.max_jobs !== undefined && inputCfg.max_jobs !== null
      ? Number(inputCfg.max_jobs)
      : getDefaultCompileJobs(4)
  );
  const [lowPriority, setLowPriority] = useState<boolean>(
    inputCfg.low_priority !== undefined ? Boolean(inputCfg.low_priority) : true
  );
  const [cleanCompile, setCleanCompile] = useState<boolean>(
    inputCfg.clean !== undefined ? Boolean(inputCfg.clean) : true
  );

  const [isActive, setIsActive] = useState<boolean>(
    initialConfig?.is_active !== undefined ? Boolean(initialConfig.is_active) : true
  );
  const [scheduleType, setScheduleType] = useState<string>(
    initialConfig?.schedule_type || 'recurring'
  );
  const [scheduleCron, setScheduleCron] = useState<string>(
    initialConfig?.schedule_cron || '0 3 * * *'
  );
  const [scheduleDatetime, setScheduleDatetime] = useState<string>(() => {
    if (initialConfig?.schedule_datetime) {
      const d = new Date(initialConfig.schedule_datetime);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mi = String(d.getMinutes()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
    }
    return getNextNightlyDatetimeLocal(3, 0);
  });

  const [availableBuilds, setAvailableBuilds] = useState<BuildProfile[]>([]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`${API}/builds`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (active && Array.isArray(data)) {
          setAvailableBuilds(
            data.filter((b: BuildProfile) => !b.source_type || b.source_type === 'compiled')
          );
        }
      })
      .catch((err) => console.error('Failed loading Forge profiles:', err));

    fetch(`${API}/builds/disk-info`)
      .then((res) => (res.ok ? res.json() : null))
      .then((info) => {
        if (active && info?.cpu_cores) {
          const cores = Math.max(1, Number(info.cpu_cores));
          setCpuCores(cores);
          if (inputCfg.max_jobs === undefined || inputCfg.max_jobs === null) {
            setMaxJobs(getDefaultCompileJobs(cores));
          }
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [API]);

  const toggleBuildSelection = (id: number) => {
    setValidationError(null);
    setBuildIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setValidationError(t('common.nameRequired', 'Task name is required.'));
      return;
    }
    if (targetMode === 'selected' && buildIds.length === 0) {
      setValidationError(
        t('tasks.forgeBuild.noBuildsSelectedError', 'Select at least one Forge profile when targeting specific builds.')
      );
      return;
    }

    setIsSubmitting(true);
    setValidationError(null);

    const payload = {
      name: name.trim(),
      alias: alias.trim() ? alias.trim() : null,
      is_active: scheduleType === 'manual' ? true : isActive,
      command: 'system://forge_build',
      input_config: {
        type: 'forge_build',
        target_mode: targetMode,
        build_ids: targetMode === 'selected' ? buildIds : [],
        only_if_pending: targetMode === 'all_pending' ? true : onlyIfPending,
        max_jobs: Math.max(1, Math.min(cpuCores, maxJobs)),
        low_priority: lowPriority,
        clean: cleanCompile,
      },
      output_config: {},
      codec_config: {},
      filter_config: null,
      ffmpeg_build_id: null,
      schedule_type: scheduleType,
      schedule_cron: scheduleType === 'recurring' ? scheduleCron.trim() : null,
      schedule_datetime:
        scheduleType === 'one_shot' && scheduleDatetime
          ? new Date(scheduleDatetime).toISOString()
          : null,
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

      {/* General Config */}
      <div className="glass-card p-3 rounded-xl border border-[var(--glass-border)] space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-brand-orange" />
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
              placeholder={t('tasks.forgeBuild.namePlaceholder', 'e.g. Nightly Forge Rebuild')}
              className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] focus:border-brand-orange outline-none"
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
              placeholder="NIGHT-BLD"
              className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-xs font-mono text-[var(--text-primary)] focus:border-brand-orange outline-none uppercase"
            />
          </div>
        </div>
      </div>

      {/* Target Forge Profiles */}
      <div className="glass-card p-3 rounded-xl border border-[var(--glass-border)] space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-brand-lime" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
              {t('tasks.forgeBuild.targetSectionTitle', 'Forge Build Targets')}
            </h4>
          </div>

          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)]">
            <button
              type="button"
              onClick={() => {
                setTargetMode('all_pending');
                setOnlyIfPending(true);
              }}
              className={`px-3 py-1 rounded-lg text-[11px] font-bold transition-all ${
                targetMode === 'all_pending'
                  ? 'bg-brand-orange text-black'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {t('tasks.forgeBuild.modeAllPending', 'All Pending Profiles')}
            </button>
            <button
              type="button"
              onClick={() => setTargetMode('selected')}
              className={`px-3 py-1 rounded-lg text-[11px] font-bold transition-all ${
                targetMode === 'selected'
                  ? 'bg-brand-orange text-black'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {t('tasks.forgeBuild.modeSelected', 'Selected Profiles')}
            </button>
          </div>
        </div>

        {targetMode === 'all_pending' ? (
          <div className="p-3 rounded-xl bg-brand-orange/10 border border-brand-orange/25 text-xs text-[var(--text-primary)]">
            {t(
              'tasks.forgeBuild.allPendingDesc',
              'Automatically scans every managed Forge profile at run time and compiles only those pending, failed, outdated, or with uncompiled recipe edits.'
            )}
          </div>
        ) : (
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {availableBuilds.length === 0 ? (
              <div className="text-xs text-[var(--text-secondary)] italic p-2">
                {t('forge.noProfilesYet', 'No build profiles yet')}
              </div>
            ) : (
              availableBuilds.map((b) => {
                const checked = buildIds.includes(b.id);
                return (
                  <label
                    key={b.id}
                    className={`flex items-center justify-between gap-3 p-2.5 rounded-xl border cursor-pointer transition-colors ${
                      checked
                        ? 'bg-brand-orange/10 border-brand-orange/40'
                        : 'bg-[var(--input-bg)] border-[var(--glass-border)] hover:border-brand-orange/30'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleBuildSelection(b.id)}
                        className="accent-brand-orange w-4 h-4 cursor-pointer shrink-0"
                      />
                      <EngineLogo softwareType={b.software_type || 'ffmpeg'} size={15} API={API} />
                      <span className="text-xs font-bold text-[var(--text-primary)] truncate">
                        {b.name}
                      </span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--input-bg)] border border-[var(--glass-border)] text-[var(--text-secondary)]">
                        {b.ffmpeg_version || b.version_tag}
                      </span>
                    </div>
                    {b.needs_recompile && (
                      <span className="text-[10px] font-mono font-bold text-brand-orange shrink-0">
                        ⚡ {t('forge.needsRecompileLabel', 'Pending recompile')}
                      </span>
                    )}
                  </label>
                );
              })
            )}
          </div>
        )}

        {targetMode === 'selected' && (
          <label className="flex items-start gap-3 p-2.5 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] cursor-pointer">
            <input
              type="checkbox"
              checked={onlyIfPending}
              onChange={(e) => setOnlyIfPending(e.target.checked)}
              className="mt-0.5 accent-brand-lime w-4 h-4 cursor-pointer"
            />
            <div>
              <div className="text-xs font-bold text-[var(--text-primary)]">
                {t('tasks.forgeBuild.onlyIfPendingLabel', 'Only compile if recipe has pending changes')}
              </div>
              <div className="text-[11px] text-[var(--text-secondary)]">
                {t('tasks.forgeBuild.onlyIfPendingDesc', 'Skips up-to-date profiles instead of forcing an unnecessary rebuild.')}
              </div>
            </div>
          </label>
        )}
      </div>

      {/* Resources & Safeguards */}
      <div className="glass-card p-3 rounded-xl border border-[var(--glass-border)] space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-brand-orange" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
            {t('tasks.forgeBuild.resourcesTitle', 'Resource Throttling & Compilation Options')}
          </h4>
        </div>

        <div className="p-3 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] space-y-2">
          <div className="flex items-center justify-between gap-3">
            <label className="text-xs font-bold text-[var(--text-primary)]">
              {t('forge.cpuCoresLimitLabel', 'Parallel build jobs (CPU cores)')}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={1}
                max={cpuCores}
                value={maxJobs}
                onChange={(e) => setMaxJobs(Number(e.target.value))}
                className="w-28 accent-brand-orange cursor-pointer"
              />
              <span className="font-mono text-xs font-black px-2 py-0.5 rounded bg-brand-orange/15 text-brand-orange border border-brand-orange/30 min-w-[3.2rem] text-center">
                -j{maxJobs}
              </span>
            </div>
          </div>
          <p className="text-[11px] text-[var(--text-secondary)]">
            {t('forge.cpuCoresLimitHint', 'Recommended {{recommended}} of {{total}} cores to avoid saturating live encoding.', {
              recommended: getDefaultCompileJobs(cpuCores),
              total: cpuCores,
            })}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex items-start gap-3 p-3 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] cursor-pointer">
            <input
              type="checkbox"
              checked={lowPriority}
              onChange={(e) => setLowPriority(e.target.checked)}
              className="mt-0.5 accent-brand-lime w-4 h-4 cursor-pointer"
            />
            <div>
              <div className="text-xs font-bold text-[var(--text-primary)]">
                {t('forge.lowPriorityLabel', 'Low CPU & Disk Priority (nice +15 / ionice idle)')}
              </div>
              <div className="text-[11px] text-[var(--text-secondary)]">
                {t('forge.lowPriorityDesc', 'Yields CPU and disk bandwidth to active broadcast encoders.')}
              </div>
            </div>
          </label>

          <label className="flex items-start gap-3 p-3 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] cursor-pointer">
            <input
              type="checkbox"
              checked={cleanCompile}
              onChange={(e) => setCleanCompile(e.target.checked)}
              className="mt-0.5 accent-brand-orange w-4 h-4 cursor-pointer"
            />
            <div>
              <div className="text-xs font-bold text-[var(--text-primary)]">
                {t('forge.cleanCompileLabel', 'Clean Compile (wipe temporary sources)')}
              </div>
              <div className="text-[11px] text-[var(--text-secondary)]">
                {t('forge.cleanCompileDesc', 'Removes previous temporary sources and re-downloads fresh code before building.')}
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* Scheduling */}
      <div className="glass-card p-3 rounded-xl border border-[var(--glass-border)] space-y-3">
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
              {t('tasks.triggerMechanism', 'Trigger Mechanism')}
            </label>
            <SearchableSelect
              accent="lime"
              searchable={false}
              buttonClassName="px-3 py-2"
              value={scheduleType}
              onChange={(val) => setScheduleType(val)}
              options={[
                { value: 'recurring', label: t('tasks.recurringCronOption', 'Recurring (Cron Schedule)') },
                { value: 'one_shot', label: t('tasks.oneShotOption', 'One-shot (Target DateTime)') },
                { value: 'manual', label: t('tasks.manualOption', 'Manual Trigger Only (On-Demand)') },
              ]}
            />
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
                placeholder="0 3 * * *"
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-xs font-mono text-brand-lime focus:border-brand-lime outline-none"
              />
              <span className="text-[10px] text-[var(--text-secondary)]">
                0 3 * * * (03:00 AM daily)
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
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] focus:border-brand-orange outline-none"
              />
            </div>
          )}
        </div>
      </div>

      {/* Form Actions */}
      <div className="flex items-center justify-end gap-3 pt-3 border-t border-[var(--glass-border)]">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="px-4 py-2 rounded-lg text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--input-bg)] border border-[var(--glass-border)] transition-all"
        >
          {t('common.cancel', 'Cancel')}
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-5 py-2 rounded-lg text-xs font-black bg-brand-orange text-black hover:opacity-90 transition-all disabled:opacity-50"
        >
          {isSubmitting
            ? t('common.saving', 'Saving...')
            : isEditing
              ? t('common.saveChanges', 'Save Changes')
              : t('tasks.newTask', 'Create Task')}
        </button>
      </div>
    </form>
  );
};
