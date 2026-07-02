
interface BuildProfile {
  id: number
  name: string
  ffmpeg_version: string
  srt_version: string | null
  datachannel_version: string | null
  build_options: Record<string, boolean>
  sdk_paths: Record<string, string> | null
  status: string
  is_default: boolean
  sources_cleaned: boolean
  auto_clean?: boolean
  disk_usage_mb: number | null
  build_log_summary: string | null
  ffmpeg_version_output: string | null
  created_at: string | null
  built_at: string | null
}

interface BuildProfileCardProps {
  build: BuildProfile
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

const STATUS_STYLES: Record<string, { dot: string; badge: string; label: string }> = {
  pending:  { dot: 'bg-white/30',                    badge: 'bg-white/10 text-white/50',         label: 'PENDING' },
  building: { dot: 'bg-brand-orange animate-pulse',  badge: 'bg-brand-orange/20 text-brand-orange', label: 'BUILDING' },
  ready:    { dot: 'bg-brand-lime',                   badge: 'bg-brand-lime/20 text-brand-lime',     label: 'READY' },
  failed:   { dot: 'bg-red-500',                      badge: 'bg-red-500/20 text-red-400',           label: 'FAILED' },
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}



export default function BuildProfileCard({
  build, isAnyBuilding = false, onCompile, onStop, onValidate, onCleanSources, onDelete, onSetDefault, onEdit, onViewLogs, onExport,
}: BuildProfileCardProps) {
  const style = STATUS_STYLES[build.status] || STATUS_STYLES.pending

  return (
    <div className={`glass-card p-6 border transition-all duration-300 ${
      build.is_default ? 'border-brand-lime/30' : 'border-white/5'
    } hover:border-white/15`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          {build.is_default && (
            <span className="text-brand-lime text-lg" title="Default Build">★</span>
          )}
          <div>
            <h4 className="text-lg font-bold">{build.name}</h4>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="text-[10px] font-mono bg-white/5 border border-white/10 px-2 py-0.5 rounded text-white/80">
                FFmpeg {build.ffmpeg_version}
              </span>
              {build.srt_version && (
                <span className="text-[10px] font-mono bg-white/5 border border-white/10 px-2 py-0.5 rounded text-white/80">
                  SRT {build.srt_version}
                </span>
              )}
              {build.build_options?.vaapi && (
                <span className="text-[10px] font-mono bg-white/5 border border-white/10 px-2 py-0.5 rounded text-white/80">
                  VAAPI{build.sdk_paths?.vaapi ? ` ${build.sdk_paths.vaapi}` : ''}
                </span>
              )}
              {build.build_options?.ndi && (
                <span className="text-[10px] font-mono bg-white/5 border border-white/10 px-2 py-0.5 rounded text-white/80">
                  NDI{build.sdk_paths?.ndi ? ` ${build.sdk_paths.ndi}` : ''}
                </span>
              )}
              {build.build_options?.decklink && (
                <span className="text-[10px] font-mono bg-white/5 border border-white/10 px-2 py-0.5 rounded text-white/80">
                  DeckLink{build.sdk_paths?.decklink ? ` ${build.sdk_paths.decklink}` : ''}
                </span>
              )}
              {build.build_options?.nvenc && (
                <span className="text-[10px] font-mono bg-white/5 border border-white/10 px-2 py-0.5 rounded text-white/80">
                  NVENC{build.sdk_paths?.nvenc_headers ? ` ${build.sdk_paths.nvenc_headers}` : ''}
                </span>
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
      <div className="flex items-center gap-6 text-[11px] text-text-secondary mb-5 border-t border-white/5 pt-4">
        <div>
          <span className="uppercase tracking-widest text-[9px] block mb-0.5">Built</span>
          <span className="text-white/70 font-mono">{formatDate(build.built_at)}</span>
        </div>
        <div>
          <span className="uppercase tracking-widest text-[9px] block mb-0.5">Size</span>
          <span className="text-white/70 font-mono">
            {build.disk_usage_mb != null ? `${build.disk_usage_mb} MB` : '—'}
          </span>
        </div>
        {build.sources_cleaned ? (
          <div className="text-brand-lime/60 text-[9px] uppercase tracking-widest font-bold">
            ✓ Sources cleaned
          </div>
        ) : build.auto_clean ? (
          <div className="text-brand-orange/60 text-[9px] uppercase tracking-widest font-bold">
            ⚡ Auto-clean active
          </div>
        ) : null}
        {build.build_log_summary && build.status === 'failed' && (
          <div className="text-red-400 text-[10px] truncate max-w-xs" title={build.build_log_summary}>
            ⚠ {build.build_log_summary}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        {build.status === 'building' ? (
          <button
            onClick={() => onStop(build.id)}
            className="pill-button bg-red-500/20 text-red-400 text-xs animate-pulse"
          >ABORT</button>
        ) : (
          <button
            onClick={() => onCompile(build.id)}
            disabled={isAnyBuilding}
            className={`pill-button text-xs transition-all ${
              isAnyBuilding
                ? 'opacity-30 cursor-not-allowed bg-white/5 text-white/40 border border-white/5'
                : build.status === 'failed' 
                  ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30' 
                  : 'bg-brand-orange/20 text-brand-orange hover:bg-brand-orange/30'
            }`}
          >
            {build.status === 'ready' ? 'RECOMPILE' : build.status === 'failed' ? 'RETRY BUILD' : 'COMPILE'}
          </button>
        )}

        {build.status === 'ready' && (
          <>
            <button onClick={() => onValidate(build.id)}
              className="pill-button bg-white/5 text-xs hover:bg-white/10">VALIDATE</button>
            {!build.sources_cleaned && (
              <button onClick={() => onCleanSources(build.id)}
                className="pill-button bg-white/5 text-xs hover:bg-white/10">CLEAN SRC</button>
            )}
            {!build.is_default && (
              <button onClick={() => onSetDefault(build.id)}
                className="pill-button bg-brand-lime/10 text-brand-lime text-xs hover:bg-brand-lime/20">SET DEFAULT</button>
            )}
          </>
        )}

        {(build.status === 'building' || build.status === 'ready' || build.status === 'failed') && (
          <button onClick={() => onViewLogs(build.id)}
            className="pill-button bg-white/5 text-xs hover:bg-white/10">VIEW LOGS</button>
        )}

        <button onClick={() => onExport(build.id)}
          className="pill-button bg-white/5 text-xs hover:bg-white/10">EXPORT RECIPE</button>

        <button
          onClick={() => onEdit(build)}
          disabled={build.status === 'building'}
          className={`pill-button text-xs ml-auto ${build.status === 'building' ? 'opacity-30 cursor-not-allowed bg-white/5 text-white/40' : 'bg-white/5 hover:bg-white/10'}`}
        >
          EDIT
        </button>

        {build.status !== 'building' && (
          <button onClick={() => onDelete(build.id)}
            className="pill-button bg-white/5 text-xs hover:bg-red-500/10 hover:text-red-400">DELETE</button>
        )}
      </div>
    </div>
  )
}

export type { BuildProfile }
