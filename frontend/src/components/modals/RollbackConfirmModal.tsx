import React from 'react';
import { useTranslation } from 'react-i18next';
import type { BuildProfile } from '../BuildProfileCard';
import { UndoIcon } from '../Icons';
import { formatRecipeChangeLabel, type RecipeSnapshot } from '../../utils/forgeBuildHelpers';

interface RollbackConfirmModalProps {
  build: BuildProfile;
  onCancel: () => void;
  onConfirm: () => void;
}

function summarizeSnapshot(snap?: RecipeSnapshot | null): string[] {
  if (!snap) return [];
  const items: string[] = [];
  if (snap.version_tag) items.push(snap.version_tag);
  const opts = snap.build_options || {};
  const sdks = snap.sdk_paths || {};
  if (opts.libsrt) items.push(`SRT${opts.srt_version ? ` ${opts.srt_version}` : ''}`);
  if (opts.nvenc) items.push(`NVENC${sdks.nvenc_headers ? ` ${sdks.nvenc_headers}` : ''}`);
  if (opts.vaapi) items.push('VAAPI');
  if (opts.ndi) items.push(`NDI${sdks.ndi ? ` ${sdks.ndi}` : ''}`);
  if (opts.decklink) items.push(`DeckLink${sdks.decklink ? ` ${sdks.decklink}` : ''}`);
  if (opts.whip) items.push('WHIP');
  if (opts.cuda_filters) items.push('CUDA');
  return items;
}

function formatIsoDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const RollbackConfirmModal: React.FC<RollbackConfirmModalProps> = ({
  build,
  onCancel,
  onConfirm,
}) => {
  const { t } = useTranslation();
  const rollback = build.rollback_info;
  const diffs = rollback?.diff_from_current || [];
  const currentBadges = summarizeSnapshot(build.compiled_snapshot);
  const backupBadges = summarizeSnapshot(rollback?.snapshot);
  const hasPendingRecipeEdits = (build.pending_changes?.length || 0) > 0;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
      <div className="glass-card w-full max-w-2xl p-6 border border-[var(--glass-border)] relative space-y-5 shadow-2xl">
        <button
          type="button"
          onClick={onCancel}
          className="absolute top-5 right-5 w-8 h-8 rounded-full bg-[var(--input-bg)] hover:bg-[var(--glass-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center transition-colors"
          aria-label={t('common.cancel', 'Cancel')}
        >
          ✕
        </button>

        <div className="flex items-center gap-3 pr-8">
          <div className="w-10 h-10 rounded-2xl bg-brand-orange/15 border border-brand-orange/30 text-brand-orange flex items-center justify-center shrink-0">
            <UndoIcon size={18} />
          </div>
          <div>
            <h3 className="text-lg font-black text-[var(--text-primary)]">
              {t('forge.rollbackTitle', 'Rollback to Previous Revision')}
            </h3>
            <p className="text-xs text-[var(--text-secondary)] font-mono">{build.name}</p>
          </div>
        </div>

        {/* Side-by-side Comparison */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="p-3.5 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
              {t('forge.rollbackCurrentColumn', 'Current Active Binary')}
            </div>
            <div className="text-xs font-mono text-[var(--text-secondary)]">
              {t('forge.builtOnDate', 'Built {{date}}', { date: formatIsoDate(build.built_at) })}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {currentBadges.map((badge, idx) => (
                <span
                  key={`cur-${idx}`}
                  className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--glass-border)] text-[var(--text-primary)]"
                >
                  {badge}
                </span>
              ))}
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-brand-lime/10 border border-brand-lime/30 space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-brand-lime">
              {t('forge.rollbackBackupColumn', 'Backup to Restore')}
            </div>
            <div className="text-xs font-mono text-[var(--text-secondary)]">
              {t('forge.builtOnDate', 'Built {{date}}', { date: formatIsoDate(rollback?.built_at) })}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {backupBadges.map((badge, idx) => (
                <span
                  key={`bak-${idx}`}
                  className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--input-bg)] border border-brand-lime/30 text-[var(--text-primary)]"
                >
                  {badge}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Diff Strip */}
        <div className="p-3.5 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
            {t('forge.rollbackDiffTitle', 'Version & Component Differences')}
          </div>
          {diffs.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {diffs.map((d, idx) => (
                <span
                  key={`diff-${d.field}-${idx}`}
                  className="text-[11px] font-mono px-2.5 py-0.5 rounded bg-brand-orange/15 border border-brand-orange/30 text-[var(--text-primary)]"
                >
                  {formatRecipeChangeLabel(d)}
                </span>
              ))}
            </div>
          ) : (
            <div className="text-xs text-[var(--text-secondary)]">
              {t('forge.rollbackNoDiff', 'Same component set compiled earlier ({{date}})', {
                date: formatIsoDate(rollback?.built_at),
              })}
            </div>
          )}
        </div>

        {/* Rollback Consequences / Warnings */}
        <div className="p-3.5 rounded-xl bg-brand-orange/10 border border-brand-orange/30 text-xs text-[var(--text-primary)] space-y-1.5">
          <div>• {t('forge.rollbackWarnSources', 'Existing build sources (src/) will be deleted to keep storage clean.')}</div>
          {hasPendingRecipeEdits && (
            <div>• {t('forge.rollbackWarnRecipeSync', 'Pending uncompiled edits in the profile recipe will be reset to match the restored backup.')}</div>
          )}
          <div>• {t('forge.rollbackWarnRestart', 'Running services using this build will adopt the restored binary upon restart.')}</div>
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
            onClick={onConfirm}
            className="px-5 py-2 rounded-xl bg-brand-orange text-black text-xs font-black hover:opacity-90 transition-all flex items-center gap-2"
          >
            <UndoIcon size={14} />
            {t('forge.confirmRollbackAction', 'Restore Previous Binary')}
          </button>
        </div>
      </div>
    </div>
  );
};
