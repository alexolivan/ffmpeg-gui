
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
  BroomIcon
} from './Icons'

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
  version_tag?: string
  binary_path?: string
  version_output?: string
}

interface BuildProfileCardProps {
  build: BuildProfile
  installedSdks?: any[]
  isAnyBuilding?: boolean
  onCompile: (id: number) => void
  onStop: (id: number) => void
  onValidate: (id: number) => void
  onCleanSources: (id: number) => void
  onDelete: (id: number) => void
  onSetDefault: (id: number) => void
  onEdit: (build: BuildProfile) => void
  onViewLogs: (id: number) => void
  onExport: (id: number) => void
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
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
  build, installedSdks: installedSdksProp, isAnyBuilding = false, onCompile, onStop, onValidate, onCleanSources, onDelete, onSetDefault, onEdit, onViewLogs, onExport,
}: BuildProfileCardProps) {
  const { t } = useTranslation()
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
    <div className={`glass-card p-6 border transition-all duration-300 ${
      build.is_default ? 'border-brand-lime/30' : 'border-[var(--glass-border)]'
    } hover:border-brand-lime/30`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          {build.is_default && (
            <span className="text-brand-lime text-lg" title={t('forge.defaultBuildTitle', 'Default Build')}>★</span>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-lg font-bold text-[var(--text-primary)]">{build.name}</h4>
              <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded border ${
                (build.software_type || 'ffmpeg') === 'ffmpeg'
                  ? 'bg-brand-orange/10 text-brand-orange border-brand-orange/20'
                  : (build.software_type || 'ffmpeg') === 'icecast2'
                    ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                    : (build.software_type || 'ffmpeg') === 'mediamtx'
                      ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                      : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
              }`}>
                {build.software_type || 'ffmpeg'}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="text-[10px] font-mono bg-[var(--input-bg)] border border-[var(--glass-border)] px-2 py-0.5 rounded text-[var(--text-primary)]">
                {build.ffmpeg_version || build.version_tag}
              </span>
              {(build.software_type || 'ffmpeg') === 'ffmpeg' && (
                <>
                  {build.srt_version && (
                    <span className="text-[10px] font-mono bg-[var(--input-bg)] border border-[var(--glass-border)] px-2 py-0.5 rounded text-[var(--text-primary)]">
                      SRT {build.srt_version}
                    </span>
                  )}
                  {build.build_options?.vaapi && (
                    <span className="text-[10px] font-mono bg-[var(--input-bg)] border border-[var(--glass-border)] px-2 py-0.5 rounded text-[var(--text-primary)]">
                      VAAPI{build.sdk_paths?.vaapi ? ` ${build.sdk_paths.vaapi}` : ''}
                    </span>
                  )}
                  {isNdiEnabled && (
                    missingNdi ? (
                      <span className="text-[10px] font-mono bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded font-bold">
                        ⚠️ {t('forge.missingNdiBadge', 'Missing NDI SDK v{{version}}', { version: reqNdiVer || '?' })}
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono bg-[var(--input-bg)] border border-[var(--glass-border)] px-2 py-0.5 rounded text-[var(--text-primary)]">
                        NDI{reqNdiVer ? ` ${reqNdiVer}` : ''}
                      </span>
                    )
                  )}
                  {isDecklinkEnabled && (
                    missingDecklink ? (
                      <span className="text-[10px] font-mono bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded font-bold">
                        ⚠️ {t('forge.missingDecklinkBadge', 'Missing DeckLink SDK v{{version}}', { version: reqDecklinkVer || '?' })}
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono bg-[var(--input-bg)] border border-[var(--glass-border)] px-2 py-0.5 rounded text-[var(--text-primary)]">
                        DeckLink{reqDecklinkVer ? ` ${reqDecklinkVer}` : ''}
                      </span>
                    )
                  )}
                  {build.build_options?.nvenc && (
                    <span className="text-[10px] font-mono bg-[var(--input-bg)] border border-[var(--glass-border)] px-2 py-0.5 rounded text-[var(--text-primary)]">
                      NVENC{build.sdk_paths?.nvenc_headers ? ` ${build.sdk_paths.nvenc_headers}` : ''}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${style.dot}`}></span>
          <span className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full ${style.badge}`}>
            {style.label}
          </span>
        </div>
      </div>

      {/* Metadata Row */}
      <div className="flex items-center gap-6 text-[11px] text-text-secondary mb-5 border-t border-[var(--glass-border)] pt-4">
        <div>
          <span className="uppercase tracking-widest text-[9px] block mb-0.5">{t('forge.built', 'Built')}</span>
          <span className="text-[var(--text-primary)] opacity-80 font-mono">{formatDate(build.built_at)}</span>
        </div>
        <div>
          <span className="uppercase tracking-widest text-[9px] block mb-0.5">{t('forge.size', 'Size')}</span>
          <span className="text-[var(--text-primary)] opacity-80 font-mono">
            {build.disk_usage_mb != null ? `${build.disk_usage_mb} MB` : '—'}
          </span>
        </div>
        {build.sources_cleaned ? (
          <div className="text-brand-lime/80 text-[9px] uppercase tracking-widest font-bold">
            ✓ {t('forge.sourcesCleaned', 'Sources cleaned')}
          </div>
        ) : build.auto_clean ? (
          <div className="text-brand-orange/80 text-[9px] uppercase tracking-widest font-bold">
            ⚡ {t('forge.autoCleanActive', 'Auto-clean active')}
          </div>
        ) : null}
        {build.build_log_summary && build.status === 'failed' && (
          <div className="text-red-400 text-[10px] truncate max-w-xs" title={build.build_log_summary}>
            ⚠ {build.build_log_summary}
          </div>
        )}
      </div>

      {/* Iconic Action Buttons Bar */}
      <div className="flex items-center justify-end gap-1.5 flex-wrap pt-3 border-t border-white/5">
        {/* Compile / Abort Button */}
        {build.status === 'building' ? (
          <button
            onClick={() => onStop(build.id)}
            title={t('forge.abort', 'ABORT')}
            className="w-9 h-9 rounded-xl bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 flex items-center justify-center transition-all hover:scale-105 animate-pulse"
          >
            <StopIcon size={16} />
          </button>
        ) : (
          <button
            onClick={() => !hasMissingSdk && onCompile(build.id)}
            disabled={isAnyBuilding || hasMissingSdk}
            title={hasMissingSdk ? t('forge.missingSdkCompileTooltip', 'Required SDK version is missing and must be uploaded via Manage SDKs.') : (build.status === 'ready' ? t('forge.recompile', 'RECOMPILE') : build.status === 'failed' ? t('forge.retryBuild', 'RETRY BUILD') : t('forge.compile', 'COMPILE'))}
            className={`w-9 h-9 rounded-xl flex items-center justify-center border transition-all hover:scale-105 ${
              isAnyBuilding || hasMissingSdk
                ? 'opacity-40 cursor-not-allowed bg-[var(--input-bg)] text-text-secondary border-[var(--glass-border)]'
                : build.status === 'failed' 
                  ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30' 
                  : 'bg-brand-orange/20 text-brand-orange border border-brand-orange/30 hover:bg-brand-orange/30'
            }`}
          >
            <PlayIcon size={16} />
          </button>
        )}

        {build.status === 'ready' && (
          <>
            {/* Validate Button */}
            <button 
              onClick={() => onValidate(build.id)}
              title={t('forge.validate', 'VALIDATE')}
              className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 text-[var(--text-primary)] flex items-center justify-center border border-white/10 transition-all hover:scale-105 hover:border-brand-lime/40"
            >
              <CheckIcon size={16} />
            </button>

            {/* Clean Src Button */}
            {!build.sources_cleaned && (
              <button 
                onClick={() => onCleanSources(build.id)}
                title={t('forge.cleanSrc', 'CLEAN SRC')}
                className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 text-[var(--text-primary)] flex items-center justify-center border border-white/10 transition-all hover:scale-105 hover:border-brand-lime/40"
              >
                <BroomIcon size={16} />
              </button>
            )}

            {/* Set Default Button */}
            {!build.is_default && (
              <button 
                onClick={() => onSetDefault(build.id)}
                title={t('common.setDefault', 'SET DEFAULT')}
                className="w-9 h-9 rounded-xl bg-brand-lime/10 text-brand-lime hover:bg-brand-lime/20 border border-brand-lime/30 flex items-center justify-center transition-all hover:scale-105"
              >
                <StarIcon size={16} />
              </button>
            )}
          </>
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

        {/* Export Recipe Button */}
        <button 
          onClick={() => onExport(build.id)}
          title={t('forge.exportRecipe', 'EXPORT RECIPE')}
          className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 text-[var(--text-primary)] flex items-center justify-center border border-white/10 transition-all hover:scale-105 hover:border-brand-lime/40"
        >
          <ExportIcon size={16} />
        </button>

        {/* Edit Button */}
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
        {/* Delete Button */}
        {build.status !== 'building' && (
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
  )
}
