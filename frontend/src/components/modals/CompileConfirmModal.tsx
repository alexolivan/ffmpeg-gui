import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { BuildProfile } from '../BuildProfileCard';
import { EngineLogo } from '../common/EngineLogo';
import { PlayIcon } from '../Icons';
import { formatRecipeChangeLabel, getDefaultCompileJobs } from '../../utils/forgeBuildHelpers';

interface CompileConfirmModalProps {
  build: BuildProfile;
  cpuCores?: number;
  API?: string;
  onCancel: () => void;
  onConfirm: (opts: { clean: boolean; maxJobs: number; lowPriority: boolean }) => void;
}

export const CompileConfirmModal: React.FC<CompileConfirmModalProps> = ({
  build,
  cpuCores = 4,
  API = '',
  onCancel,
  onConfirm,
}) => {
  const { t } = useTranslation();
  const safeMaxCores = Math.max(1, Math.floor(cpuCores || 4));
  const recommendedJobs = getDefaultCompileJobs(safeMaxCores);
  const pendingChanges = build.pending_changes || [];
  const hasPreviousBuild = build.status === 'ready' || build.status === 'failed';

  const [maxJobs, setMaxJobs] = useState<number>(recommendedJobs);
  const [lowPriority, setLowPriority] = useState<boolean>(true);
  const [cleanCompile, setCleanCompile] = useState<boolean>(
    build.status === 'failed' || pendingChanges.length > 0
  );

  useEffect(() => {
    setMaxJobs(getDefaultCompileJobs(safeMaxCores));
    setLowPriority(true);
    setCleanCompile(build.status === 'failed' || (build.pending_changes?.length || 0) > 0);
  }, [build.id, safeMaxCores, build.status, build.pending_changes?.length]);

  const engine = (build.software_type || 'ffmpeg').toUpperCase();
  const isRecompile = build.status === 'ready';

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
      <div className="glass-card w-full max-w-lg p-6 border border-[var(--glass-border)] relative space-y-5 shadow-2xl">
        <button
          type="button"
          onClick={onCancel}
          className="absolute top-5 right-5 w-8 h-8 rounded-full bg-[var(--input-bg)] hover:bg-[var(--glass-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center transition-colors"
          aria-label={t('common.cancel', 'Cancel')}
        >
          ✕
        </button>

        <div className="flex items-start gap-3 pr-8">
          <div className="w-11 h-11 rounded-2xl bg-brand-orange/15 border border-brand-orange/30 flex items-center justify-center shrink-0">
            <EngineLogo softwareType={build.software_type || 'ffmpeg'} size={22} API={API} />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-black text-[var(--text-primary)] leading-tight">
              {isRecompile
                ? t('forge.recompileConfirmTitle', 'Confirm Recompilation')
                : t('forge.compileConfirmTitle', 'Confirm Compilation')}
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5 truncate font-mono">
              {build.name} · {engine} · {build.ffmpeg_version || build.version_tag}
            </p>
          </div>
        </div>

        {isRecompile && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-xs text-emerald-400">
            {t(
              'forge.compileSafeStagingNote',
              'Compiles into an isolated revision directory. Running binaries remain active until compilation finishes successfully.'
            )}
          </div>
        )}

        {pendingChanges.length > 0 && (
          <div className="p-3 rounded-xl bg-brand-orange/10 border border-brand-orange/30 space-y-1.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-brand-orange">
              {t('forge.pendingChangesHeading', 'Pending changes vs active binary')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {pendingChanges.map((diff, idx) => (
                <span
                  key={`${diff.field}-${idx}`}
                  className="text-[11px] font-mono px-2 py-0.5 rounded bg-[var(--input-bg)] border border-brand-orange/30 text-[var(--text-primary)]"
                >
                  {formatRecipeChangeLabel(diff)}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-4">
          {/* CPU Cores Control */}
          <div className="p-3.5 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label
                htmlFor="forge-compile-jobs"
                className="text-xs font-bold text-[var(--text-primary)]"
              >
                {t('forge.cpuCoresLimitLabel', 'Parallel build jobs (CPU cores)')}
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="forge-compile-jobs"
                  type="range"
                  min={1}
                  max={safeMaxCores}
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
              {t(
                'forge.cpuCoresLimitHint',
                'Recommended {{recommended}} of {{total}} cores to avoid saturating live encoding.',
                { recommended: recommendedJobs, total: safeMaxCores }
              )}
            </p>
          </div>

          {/* Low Priority Toggle */}
          <label className="flex items-start gap-3 p-3.5 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] cursor-pointer hover:border-brand-lime/30 transition-colors">
            <input
              type="checkbox"
              checked={lowPriority}
              onChange={(e) => setLowPriority(e.target.checked)}
              className="mt-0.5 accent-brand-lime w-4 h-4 cursor-pointer"
            />
            <div className="space-y-0.5">
              <div className="text-xs font-bold text-[var(--text-primary)]">
                {t('forge.lowPriorityLabel', 'Low CPU & Disk Priority (nice +15 / ionice idle)')}
              </div>
              <div className="text-[11px] text-[var(--text-secondary)]">
                {t(
                  'forge.lowPriorityDesc',
                  'Yields CPU and disk bandwidth to active broadcast encoders.'
                )}
              </div>
            </div>
          </label>

          {/* Clean Compile Checkbox */}
          {hasPreviousBuild && (
            <label className="flex items-start gap-3 p-3.5 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] cursor-pointer hover:border-brand-orange/30 transition-colors">
              <input
                type="checkbox"
                checked={cleanCompile}
                onChange={(e) => setCleanCompile(e.target.checked)}
                className="mt-0.5 accent-brand-orange w-4 h-4 cursor-pointer"
              />
              <div className="space-y-0.5">
                <div className="text-xs font-bold text-[var(--text-primary)]">
                  {t('forge.cleanCompileLabel', 'Clean Compile (wipe temporary sources)')}
                </div>
                <div className="text-[11px] text-[var(--text-secondary)]">
                  {t(
                    'forge.cleanCompileDesc',
                    'Removes previous temporary sources and re-downloads fresh code before building.'
                  )}
                </div>
              </div>
            </label>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-[var(--glass-border)]">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={() => onConfirm({ clean: cleanCompile, maxJobs, lowPriority })}
            className="px-5 py-2 rounded-xl bg-brand-orange text-black text-xs font-black hover:opacity-90 transition-all flex items-center gap-2"
          >
            <PlayIcon size={14} />
            {isRecompile
              ? t('forge.startRecompile', 'Start Recompilation')
              : t('forge.startCompile', 'Start Compilation')}
          </button>
        </div>
      </div>
    </div>
  );
};
