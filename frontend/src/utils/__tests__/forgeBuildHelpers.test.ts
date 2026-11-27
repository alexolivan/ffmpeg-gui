import { describe, it, expect } from 'vitest';
import {
  formatRecipeChangeLabel,
  getCompileButtonState,
  getDefaultCompileJobs,
  getDisplayBadgesFromBuild,
} from '../forgeBuildHelpers';

describe('forgeBuildHelpers', () => {
  it('computes safe default CPU core jobs clamped to 1..4', () => {
    expect(getDefaultCompileJobs(1)).toBe(1);
    expect(getDefaultCompileJobs(2)).toBe(1);
    expect(getDefaultCompileJobs(4)).toBe(2);
    expect(getDefaultCompileJobs(8)).toBe(4);
    expect(getDefaultCompileJobs(32)).toBe(4);
  });

  it('computes compile button visual state with pulse only when action needed', () => {
    expect(getCompileButtonState({ status: 'ready', needsRecompile: false }).phase).toBe('synced');
    expect(getCompileButtonState({ status: 'ready', needsRecompile: true }).className).toContain('animate-pulse');
    expect(getCompileButtonState({ status: 'pending' }).className).toContain('animate-pulse');
    expect(getCompileButtonState({ status: 'failed' }).phase).toBe('failed');
    expect(getCompileButtonState({ status: 'ready', needsRecompile: true, isAnyBuilding: true }).phase).toBe('disabled');
  });

  it('uses compiled_snapshot as operational truth when build is ready', () => {
    const badges = getDisplayBadgesFromBuild({
      status: 'ready',
      ffmpeg_version: 'n8.0',
      build_options: { libsrt: true, srt_version: 'v1.5.4', nvenc: true, vaapi: true },
      sdk_paths: { nvenc_headers: 'n12.2.72.0' },
      compiled_snapshot: {
        version_tag: 'n7.1',
        build_options: { libsrt: true, srt_version: 'v1.5.3', nvenc: true },
        sdk_paths: { nvenc_headers: 'n13.1.15.0' },
      },
    });
    expect(badges.versionTag).toBe('n7.1');
    expect(badges.srtVersion).toBe('v1.5.3');
    expect(badges.nvencTag).toBe('n13.1.15.0');
    expect(badges.vaapi).toBe(false);
  });

  it('formats recipe diff labels concisely', () => {
    expect(formatRecipeChangeLabel({ field: 'nvenc', from: 'n13.1.15.0', to: 'n12.2.72.0' })).toBe(
      'NVENC n13.1.15.0 → n12.2.72.0'
    );
    expect(formatRecipeChangeLabel({ field: 'vaapi', from: null, to: 'enabled' })).toBe('+VAAPI');
    expect(formatRecipeChangeLabel({ field: 'ndi', from: '6.0.0', to: null })).toBe('-NDI');
  });
});
