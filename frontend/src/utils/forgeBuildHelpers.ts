export interface RecipeSnapshot {
  software_type?: string;
  version_tag?: string;
  build_options?: Record<string, any>;
  sdk_paths?: Record<string, string>;
}

export interface RecipeDiffItem {
  field: string;
  from: string | null;
  to: string | null;
}

export interface RollbackInfo {
  version_tag?: string | null;
  built_at?: string | null;
  snapshot?: RecipeSnapshot | null;
  diff_from_current?: RecipeDiffItem[];
}

export interface CompileButtonVisualState {
  phase: 'disabled' | 'failed' | 'pending_action' | 'synced';
  className: string;
}

export function getDefaultCompileJobs(cpuCores?: number): number {
  const cores = cpuCores && cpuCores > 0 ? Math.floor(cpuCores) : 4;
  return Math.max(1, Math.min(4, Math.floor(cores / 2) || 1));
}

export function getCompileButtonState(opts: {
  status: string;
  needsRecompile?: boolean;
  isOutdated?: boolean;
  isAnyBuilding?: boolean;
  hasMissingSdk?: boolean;
}): CompileButtonVisualState {
  if (opts.isAnyBuilding || opts.hasMissingSdk) {
    return {
      phase: 'disabled',
      className:
        'opacity-40 cursor-not-allowed bg-[var(--input-bg)] text-text-secondary border-[var(--glass-border)]',
    };
  }
  if (opts.status === 'failed') {
    return {
      phase: 'failed',
      className:
        'bg-red-500/20 text-red-400 border-red-500/40 hover:bg-red-500/30 animate-pulse',
    };
  }
  if (opts.needsRecompile || opts.isOutdated || opts.status === 'pending') {
    return {
      phase: 'pending_action',
      className:
        'bg-brand-orange/20 hover:bg-brand-orange/30 border-brand-orange text-brand-orange animate-pulse shadow-sm',
    };
  }
  return {
    phase: 'synced',
    className:
      'bg-[var(--input-bg)] hover:bg-[var(--glass-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-[var(--glass-border)]',
  };
}

export function getDisplayBadgesFromBuild(build: {
  status: string;
  ffmpeg_version?: string;
  version_tag?: string;
  srt_version?: string | null;
  build_options?: Record<string, any>;
  sdk_paths?: Record<string, string> | null;
  compiled_snapshot?: RecipeSnapshot | null;
}): {
  versionTag: string;
  srtVersion: string | null;
  vaapi: boolean;
  vaapiVer: string | null;
  ndi: boolean;
  ndiVer: string | null;
  decklink: boolean;
  decklinkVer: string | null;
  nvenc: boolean;
  nvencTag: string | null;
} {
  const useCompiled = build.status === 'ready' && Boolean(build.compiled_snapshot);
  const snap = useCompiled ? build.compiled_snapshot! : null;
  const opts = (snap ? snap.build_options : build.build_options) || {};
  const sdks = (snap ? snap.sdk_paths : build.sdk_paths) || {};
  const versionTag =
    (snap ? snap.version_tag : build.ffmpeg_version || build.version_tag) ||
    build.ffmpeg_version ||
    build.version_tag ||
    '';

  const libsrt = Boolean(opts.libsrt);
  const srtVersion = libsrt ? opts.srt_version || build.srt_version || null : null;

  return {
    versionTag,
    srtVersion,
    vaapi: Boolean(opts.vaapi),
    vaapiVer: (!snap && build.sdk_paths?.vaapi) || null,
    ndi: Boolean(opts.ndi),
    ndiVer: sdks.ndi || null,
    decklink: Boolean(opts.decklink),
    decklinkVer: sdks.decklink || opts.decklink_version || null,
    nvenc: Boolean(opts.nvenc),
    nvencTag: sdks.nvenc_headers || null,
  };
}

const FIELD_LABELS: Record<string, string> = {
  version: 'Version',
  srt: 'SRT',
  nvenc: 'NVENC',
  vaapi: 'VAAPI',
  ndi: 'NDI',
  ndi_patch: 'NDI Patch',
  decklink: 'DeckLink',
  cuda_filters: 'CUDA',
  whip: 'WHIP',
};

export function formatRecipeChangeLabel(change: RecipeDiffItem): string {
  const label = FIELD_LABELS[change.field] || change.field.toUpperCase();
  if (!change.from && change.to) {
    return change.to === 'enabled' ? `+${label}` : `+${label} ${change.to}`;
  }
  if (change.from && !change.to) {
    return `-${label}`;
  }
  if (change.from && change.to) {
    return `${label} ${change.from} → ${change.to}`;
  }
  return label;
}
