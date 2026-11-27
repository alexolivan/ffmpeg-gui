
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { 
  PlayIcon, 
  StopIcon, 
  PencilIcon, 
  TrashIcon, 
  ExportIcon,
  StarIcon,
  CheckIcon,
  BroomIcon,
  ClipboardIcon,
  UndoIcon
} from './Icons'
import { EngineLogo } from './common/EngineLogo'
import { hasMinLevel, type CapabilityLevel } from '../utils/permissions'
import {
  formatRecipeChangeLabel,
  getCompileButtonState,
  getDisplayBadgesFromBuild,
  type RecipeDiffItem,
  type RecipeSnapshot,
  type RollbackInfo,
} from '../utils/forgeBuildHelpers'

export interface BuildProfile {
  id: number
  name: string
  ffmpeg_version: string
  srt_version: string | null
  status: 'pending' | 'building' | 'ready' | 'failed'
  built_at: string | null
  disk_usage_mb: number | null
  sources_cleaned: boolean
  is_default: boolean
  auto_clean?: boolean
  storage_id: number | null
  build_options?: Record<string, any>
  sdk_paths?: Record<string, string> | null
  build_log_summary: string | null
  ffmpeg_version_output?: string | null
  created_at?: string | null
  software_type?: string
  source_type?: string
  system_path?: string
  is_managed?: boolean
  version_tag?: string
  binary_path?: string
  version_output?: string
  recipe_version?: string | null
  is_outdated?: boolean
  compiled_snapshot?: RecipeSnapshot | null
  pending_changes?: RecipeDiffItem[]
  needs_recompile?: boolean
  can_rollback?: boolean
  rollback_info?: RollbackInfo | null
  last_compile_error?: string | null
}

interface BuildProfileCardProps {
  build: BuildProfile
  installedSdks?: any[]
  isAnyBuilding?: boolean
  onCompile: (id: number) => void
  onStop: (id: number) => void
  onValidate: (id: number) => void
  onCleanSources: (id: number) => void
  onRollback?: (build: BuildProfile) => void
  onDelete: (id: number) => void
  onSetDefault: (id: number) => void
  onEdit: (build: BuildProfile) => void
  onClone?: (build: BuildProfile) => void
  onViewLogs: (id: number) => void
  onExport: (id: number) => void
  forgeLevel?: CapabilityLevel
  API?: string
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatDiskSize(mb: number | null | undefined): string {
  if (mb == null) return '—'
  if (mb === 0) return '0 MB'
  if (mb < 1) {
    const kb = Math.round(mb * 1024)
    return `${kb} KB`
  }
  return `${Number(mb).toFixed(mb % 1 === 0 ? 0 : 1)} MB`
}

function normalizeVersion(v: string | null | undefined): string {
  if (!v) return ''
  return v.trim().toLowerCase().replace(/^v/, '')
}

function matchesVersion(sdkVersion: string | null | undefined, reqVersion: string | null | undefined): boolean {
  if (!sdkVersion || !reqVersion) return false
  if (sdkVersion === reqVersion) return true
  const normSdk = normalizeVersion(sdkVersion)
  const normReq = normalizeVersion(reqVersion)
  if (normSdk === normReq) return true
  if (normSdk && normReq) {
    const sdkParts = normSdk.split('.')
    const reqParts = normReq.split('.')
    if (sdkParts[0] === reqParts[0]) {
      if (sdkParts.length === 1 || reqParts.length === 1) return true
      if (sdkParts[1] === reqParts[1]) return true
    }
  }
  return false
}

export default function BuildProfileCard({
  build, installedSdks: installedSdksProp, isAnyBuilding = false, onCompile, onStop, onValidate, onCleanSources, onRollback, onDelete, onSetDefault, onEdit, onClone, onViewLogs, onExport, forgeLevel = 'admin', API = '',
}: BuildProfileCardProps) {
  const { t } = useTranslation()
  const canOperate = hasMinLevel(forgeLevel, 'operate')
  const canManage = hasMinLevel(forgeLevel, 'manage')
  const canAdmin = hasMinLevel(forgeLevel, 'admin')
  const [fetchedSdks, setFetchedSdks] = useState<any[]>([])

  useEffect(() => {
    if (!installedSdksProp) {
      fetch('/sdks')
        .then(res => res.ok ? res.json() : [])
        .then(data => setFetchedSdks(data))
        .catch(() => {})
    }
  }, [installedSdksProp, build])

  const sdks = installedSdksProp || fetchedSdks

  const isDecklinkEnabled = !!build.build_options?.decklink
  const reqDecklinkVer = build.sdk_paths?.decklink
  const missingDecklink = isDecklinkEnabled && (
    !reqDecklinkVer ||
    !sdks.some((s: any) => s.sdk_type === 'decklink' && s.status !== 'missing' && matchesVersion(s.version, reqDecklinkVer))
  )

  const isNdiEnabled = !!build.build_options?.ndi
  const reqNdiVer = build.sdk_paths?.ndi
  const missingNdi = isNdiEnabled && (
    !reqNdiVer ||
    !sdks.some((s: any) => s.sdk_type === 'ndi' && s.status !== 'missing' && matchesVersion(s.version, reqNdiVer))
  )

  const hasMissingSdk = missingDecklink || missingNdi

  const STATUS_STYLES: Record<string, { dot: string; badge: string; label: string }> = {
    pending:  { dot: 'bg-white/30',                    badge: 'bg-white/10 text-white/50',         label: t('forge.status.pending', 'PENDING') },
    building: { dot: 'bg-brand-orange animate-pulse',  badge: 'bg-brand-orange/20 text-brand-orange', label: t('forge.status.building', 'BUILDING') },
    ready:    { dot: 'bg-brand-lime',                   badge: 'bg-brand-lime/20 text-brand-lime',     label: t('forge.status.ready', 'READY') },
    failed:   { dot: 'bg-red-500',                      badge: 'bg-red-500/20 text-red-400',           label: t('forge.status.failed', 'FAILED') },
  }

  const style = STATUS_STYLES[build.status] || STATUS_STYLES.pending

  return (
    <div className={`glass-card p-5 border transition-all duration-300 ${
      build.is_default ? 'border-brand-lime/30' : 'border-[var(--glass-border)]'
    } hover:border-brand-lime/30`}>
      {/* 1. Top Header Bar */}
      <div className="flex items-center justify-between gap-3 mb-3 pb-3 border-b border-[var(--glass-border)]">
        <div className="flex items-center gap-2.5 min-w-0">
          <EngineLogo softwareType={build.software_type || 'ffmpeg'} size={18} API={API} />
          {build.is_default && (
            <span className="text-brand-lime text-base" title={t('forge.defaultBuildTitle', 'Default Build')}>★</span>
          )}
          <h4 className="text-base font-bold text-[var(--text-primary)] truncate">{build.name}</h4>
        </div>

        {/* Status Indicator */}
        <div className="flex items-center gap-2 shrink-0">
          <span className={`w-2 h-2 rounded-full ${style.dot}`}></span>
          <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full ${style.badge}`}>
            {style.label}
          </span>
        </div>
      </div>

      {/* 2. Main Card Body (Left Info & Metadata / Right Controls) */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        
        {/* Left Area: Compact Multi-line Info & Metadata */}
        <div className="space-y-2 flex-grow min-w-0">
          
          {/* Line 1: Version Tag & Feature Badges (Operational Truth when Ready) */}
          {(() => {
            const badges = getDisplayBadgesFromBuild(build)
            const isPendingBadges = build.status === 'pending'
            return (
              <div className={`flex items-center gap-1.5 flex-wrap ${isPendingBadges ? 'opacity-70' : ''}`}>
                <span className="text-[10px] font-mono bg-[var(--input-bg)] border border-[var(--glass-border)] px-2 py-0.5 rounded text-[var(--text-primary)]">
                  {build.software_type === 'decklink_tools' && build.version_output
                    ? (build.version_output.match(/v\d+\.\d+(\.\d+)?/)?.[0] || badges.versionTag || `v${build.recipe_version || '1.0.2'}`)
                    : (badges.versionTag || (build.software_type === 'decklink_tools' ? (build.recipe_version || '1.0.2') : '1.0.0'))}
                </span>
                {build.software_type === 'decklink_tools' && (
                  <span className="text-[10px] font-mono bg-blue-500/15 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded font-bold">
                    DeckLink SDK {badges.decklinkVer ? `v${badges.decklinkVer}` : 'v16.0'}
                  </span>
                )}
                {build.is_outdated && (
                  <span
                    className="text-[10px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded font-bold animate-pulse"
                    title={t('forge.outdatedBuildTooltip', 'Source code updated to v{{version}}. Recompile to update.', { version: build.recipe_version || '1.0.2' })}
                  >
                    ⚡ {t('forge.updateAvailable', 'Update Available')} (v{build.recipe_version || '1.0.2'})
                  </span>
                )}
                {(build.software_type || 'ffmpeg') === 'ffmpeg' && (
                  <>
                    {badges.srtVersion && (
                      <span className="text-[10px] font-mono bg-[var(--input-bg)] border border-[var(--glass-border)] px-2 py-0.5 rounded text-[var(--text-primary)]">
                        SRT {badges.srtVersion}
                      </span>
                    )}
                    {badges.vaapi && (
                      <span className="text-[10px] font-mono bg-[var(--input-bg)] border border-[var(--glass-border)] px-2 py-0.5 rounded text-[var(--text-primary)]">
                        VAAPI{badges.vaapiVer ? ` ${badges.vaapiVer}` : ''}
                      </span>
                    )}
                    {badges.ndi && (
                      missingNdi ? (
                        <span className="text-[10px] font-mono bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded font-bold">
                          ⚠️ {t('forge.missingNdiBadge', 'Missing NDI SDK v{{version}}', { version: reqNdiVer || '?' })}
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono bg-[var(--input-bg)] border border-[var(--glass-border)] px-2 py-0.5 rounded text-[var(--text-primary)]">
                          NDI{badges.ndiVer ? ` ${badges.ndiVer}` : ''}
                        </span>
                      )
                    )}
                    {badges.decklink && (
                      missingDecklink ? (
                        <span className="text-[10px] font-mono bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded font-bold">
                          ⚠️ {t('forge.missingDecklinkBadge', 'Missing DeckLink SDK v{{version}}', { version: reqDecklinkVer || '?' })}
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono bg-[var(--input-bg)] border border-[var(--glass-border)] px-2 py-0.5 rounded text-[var(--text-primary)]">
                          DeckLink{badges.decklinkVer ? ` ${badges.decklinkVer}` : ''}
                        </span>
                      )
                    )}
                    {badges.nvenc && (
                      <span className="text-[10px] font-mono bg-[var(--input-bg)] border border-[var(--glass-border)] px-2 py-0.5 rounded text-[var(--text-primary)]">
                        NVENC{badges.nvencTag ? ` ${badges.nvencTag}` : ''}
                      </span>
                    )}
                  </>
                )}
              </div>
            )
          })()}

          {/* Line 2: Key-Value Details Strip */}
          <div className="flex gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)] flex-wrap items-center font-mono tabular-nums">
            <span>Built: <strong className="text-[var(--text-primary)]">{formatDate(build.built_at)}</strong></span>
            <span className="opacity-20">|</span>
            <span>Size: <strong className="text-[var(--text-primary)]">{formatDiskSize(build.disk_usage_mb)}</strong></span>
            
            {build.sources_cleaned && (
              <>
                <span className="opacity-20">|</span>
                <span className="text-brand-lime/90 font-bold">✓ {t('forge.sourcesCleaned', 'Sources cleaned')}</span>
              </>
            )}
            {build.auto_clean && !build.sources_cleaned && (
              <>
                <span className="opacity-20">|</span>
                <span className="text-brand-orange/90 font-bold">⚡ {t('forge.autoCleanActive', 'Auto-clean active')}</span>
              </>
            )}
            {build.can_rollback && build.rollback_info && (
              <>
                <span className="opacity-20">|</span>
                <span
                  className="text-[var(--text-secondary)] font-bold"
                  title={formatDate(build.rollback_info.built_at || null)}
                >
                  ↩ {t('forge.backupRevisionChip', 'Backup')}: {build.rollback_info.version_tag || '—'}
                </span>
              </>
            )}
            {build.build_log_summary && build.status === 'failed' && (
              <>
                <span className="opacity-20">|</span>
                <span className="text-red-400 font-bold truncate max-w-xs" title={build.build_log_summary}>⚠ {build.build_log_summary}</span>
              </>
            )}
          </div>

          {/* Contextual Slim Bars (only shown when diverged or last recompile failed while active binary stayed intact) */}
          {build.status === 'ready' && (build.pending_changes?.length || 0) > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap px-2.5 py-1.5 rounded-lg bg-brand-orange/10 border border-brand-orange/30 text-[11px] font-mono text-brand-orange">
              <span className="font-bold shrink-0">⚡ {t('forge.needsRecompileLabel', 'Pending recompile')}:</span>
              <span className="text-[var(--text-primary)]">
                {(build.pending_changes || []).map(formatRecipeChangeLabel).join(' · ')}
              </span>
            </div>
          )}
          {build.status === 'ready' && build.last_compile_error && (
            <div
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-[11px] font-mono text-red-400 truncate"
              title={build.last_compile_error}
            >
              <span className="shrink-0">⚠</span>
              <span className="truncate">{t('forge.lastCompileFailedBanner', 'Last recompile attempt failed — previous working binaries preserved.')}</span>
            </div>
          )}
        </div>

        {/* Right Area: Compact Iconic Control Button Bar (Validate -> Default -> Compile/Abort -> Rollback -> Clean -> Logs -> Clone -> Export -> Edit -> Delete) */}
        <div className="flex items-center gap-1.5 mt-3 lg:mt-0 flex-shrink-0">
          {/* 1. Validate Button */}
          {canManage && build.status === 'ready' && (
            <button 
              onClick={() => onValidate(build.id)}
              title={t('forge.validate', 'VALIDATE')}
              className="w-9 h-9 rounded-xl bg-[var(--input-bg)] hover:bg-[var(--glass-border)] text-[var(--text-primary)] flex items-center justify-center border border-[var(--glass-border)] transition-all hover:scale-105 hover:border-brand-lime/40"
            >
              <CheckIcon size={16} />
            </button>
          )}

          {/* 2. Set Default Button */}
          {canManage && build.status === 'ready' && canAdmin && !build.is_default && (
            <button 
              onClick={() => onSetDefault(build.id)}
              title={t('common.setDefault', 'SET DEFAULT')}
              className="w-9 h-9 rounded-xl bg-brand-lime/10 text-brand-lime hover:bg-brand-lime/20 border border-brand-lime/30 flex items-center justify-center transition-all hover:scale-105"
            >
              <StarIcon size={16} />
            </button>
          )}

          {/* 3. Compile / Recompile / Abort Button */}
          {canOperate && (build.status === 'building' ? (
            <button
              onClick={() => onStop(build.id)}
              title={t('forge.abort', 'ABORT')}
              className="w-9 h-9 rounded-xl bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 flex items-center justify-center transition-all hover:scale-105 animate-pulse"
            >
              <StopIcon size={16} />
            </button>
          ) : (() => {
            const btnState = getCompileButtonState({
              status: build.status,
              needsRecompile: build.needs_recompile,
              isOutdated: build.is_outdated,
              isAnyBuilding,
              hasMissingSdk,
            })
            return (
              <button
                onClick={() => !hasMissingSdk && onCompile(build.id)}
                disabled={isAnyBuilding || hasMissingSdk}
                title={
                  hasMissingSdk
                    ? t('forge.missingSdkCompileTooltip', 'Required SDK version is missing and must be uploaded via Manage SDKs.')
                    : (build.pending_changes?.length || 0) > 0
                      ? t('forge.needsRecompileLabel', 'Pending recompile')
                      : build.is_outdated
                        ? t('forge.updateAndRecompile', 'UPDATE & RECOMPILE')
                        : (build.status === 'ready' ? t('forge.recompile', 'RECOMPILE') : build.status === 'failed' ? t('forge.retryBuild', 'RETRY BUILD') : t('forge.compile', 'COMPILE'))
                }
                className={`w-9 h-9 rounded-xl flex items-center justify-center border transition-all hover:scale-105 ${btnState.className}`}
              >
                <PlayIcon size={16} />
              </button>
            )
          })())}

          {/* 4. Rollback Button (only if previous working revision exists) */}
          {canOperate && build.can_rollback && build.status !== 'building' && onRollback && (
            <button
              onClick={() => onRollback(build)}
              title={t('forge.rollbackTooltip', 'Rollback to previous working binary ({{version}})', {
                version: build.rollback_info?.version_tag || '—',
              })}
              className="w-9 h-9 rounded-xl bg-brand-orange/15 text-brand-orange border border-brand-orange/30 hover:bg-brand-orange/25 flex items-center justify-center transition-all hover:scale-105"
            >
              <UndoIcon size={16} />
            </button>
          )}

          {/* 5. Clean Src Button */}
          {canManage && build.status === 'ready' && !build.sources_cleaned && (
            <button 
              onClick={() => onCleanSources(build.id)}
              title={t('forge.cleanSrc', 'CLEAN SRC')}
              className="w-9 h-9 rounded-xl bg-[var(--input-bg)] hover:bg-[var(--glass-border)] text-[var(--text-primary)] flex items-center justify-center border border-[var(--glass-border)] transition-all hover:scale-105 hover:border-brand-lime/40"
            >
              <BroomIcon size={16} />
            </button>
          )}

          {/* View Logs Button */}
          {(build.status === 'building' || build.status === 'ready' || build.status === 'failed') && (
            <button 
              onClick={() => onViewLogs(build.id)}
              title={t('forge.viewLogs', 'VIEW LOGS')}
              className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 text-[var(--text-primary)] flex items-center justify-center border border-white/10 transition-all hover:scale-105 hover:border-brand-lime/40"
            >
              📜
            </button>
          )}

          {/* Clone Recipe Button */}
          {canAdmin && onClone && (!build.source_type || build.source_type === 'compiled') && (
            <button
              onClick={() => onClone(build)}
              title={t('forge.cloneRecipe', 'CLONE RECIPE')}
              className="w-9 h-9 rounded-xl bg-[var(--input-bg)] hover:bg-[var(--glass-border)] text-[var(--text-primary)] flex items-center justify-center border border-[var(--glass-border)] transition-all hover:scale-105 hover:border-brand-lime/40"
            >
              <ClipboardIcon size={16} />
            </button>
          )}

          {/* Export Recipe Button */}
          {canAdmin && (
            <button 
              onClick={() => onExport(build.id)}
              title={t('forge.exportRecipe', 'EXPORT RECIPE')}
              className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 text-[var(--text-primary)] flex items-center justify-center border border-white/10 transition-all hover:scale-105 hover:border-brand-lime/40"
            >
              <ExportIcon size={16} />
            </button>
          )}

          {/* Edit Button */}
          {canManage && (
            <button
              onClick={() => onEdit(build)}
              disabled={build.status === 'building'}
              title={t('common.edit', 'EDIT')}
              className={`w-9 h-9 rounded-xl flex items-center justify-center border transition-all hover:scale-105 ${
                build.status === 'building' 
                  ? 'opacity-30 cursor-not-allowed bg-[var(--input-bg)] text-text-secondary border-[var(--glass-border)]' 
                  : 'bg-white/5 hover:bg-white/10 text-[var(--text-primary)] border border-white/10 hover:border-brand-lime/40'
              }`}
            >
              <PencilIcon size={16} />
            </button>
          )}

          {/* Delete Button */}
          {canAdmin && build.status !== 'building' && (
            <button 
              onClick={() => onDelete(build.id)}
              title={t('common.delete', 'DELETE')}
              className="w-9 h-9 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 flex items-center justify-center border border-red-500/20 transition-all hover:scale-105"
            >
              <TrashIcon size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
