import { describe, it, expect } from 'vitest';
import {
  cascadeMountRenameOrRemoval,
  getAvailableFallbackMounts,
  normalizeMountPath,
  shouldDefaultPeerRelayTls,
} from '../icecastHelpers';

describe('icecastHelpers', () => {
  it('normalizes mount paths with leading slash', () => {
    expect(normalizeMountPath('')).toBe('');
    expect(normalizeMountPath('   ')).toBe('');
    expect(normalizeMountPath('live.mp3')).toBe('/live.mp3');
    expect(normalizeMountPath('/backup.mp3 ')).toBe('/backup.mp3');
  });

  it('returns fallback candidates only when other distinct mounts exist and excludes self', () => {
    const single = [{ mount_name: '/live.mp3' }];
    expect(getAvailableFallbackMounts(single, 0, '/live.mp3')).toEqual([]);

    const addingSecond = getAvailableFallbackMounts(single, null, '/backup.mp3');
    expect(addingSecond.map((m) => m.mount_name)).toEqual(['/live.mp3']);

    // Typing a duplicate name while adding excludes that target self
    expect(getAvailableFallbackMounts(single, null, 'live.mp3')).toEqual([]);

    const multi = [
      { mount_name: 'live.mp3' },
      { mount_name: '/backup.mp3', relay_enabled: true },
      { mount_name: '/emergency.mp3' },
    ];
    const forLive = getAvailableFallbackMounts(multi, 0, '/live.mp3');
    expect(forLive).toEqual([
      { mount_name: '/backup.mp3', relay_enabled: true },
      { mount_name: '/emergency.mp3' },
    ]);
  });

  it('defaults peer relay TLS to false whenever HTTP is enabled on peer', () => {
    expect(shouldDefaultPeerRelayTls(null)).toBe(false);
    expect(shouldDefaultPeerRelayTls({ http_enabled: true, ssl_enabled: true })).toBe(false);
    expect(shouldDefaultPeerRelayTls({ ssl_enabled: true })).toBe(false);
    expect(shouldDefaultPeerRelayTls({ http_enabled: false, ssl_enabled: true })).toBe(true);
    expect(shouldDefaultPeerRelayTls({ http_enabled: false, ssl_enabled: false })).toBe(false);
  });

  it('updates or clears sibling fallback references on mount rename or removal', () => {
    const mounts = [
      { mount_name: '/main.mp3', fallback_mount: '/backup.mp3' },
      { mount_name: '/aux.mp3', fallback_mount: '/other.mp3' },
    ];
    expect(cascadeMountRenameOrRemoval(mounts, '/backup.mp3', '/standby.mp3')).toEqual([
      { mount_name: '/main.mp3', fallback_mount: '/standby.mp3' },
      { mount_name: '/aux.mp3', fallback_mount: '/other.mp3' },
    ]);
    expect(cascadeMountRenameOrRemoval(mounts, '/backup.mp3')).toEqual([
      { mount_name: '/main.mp3', fallback_mount: undefined },
      { mount_name: '/aux.mp3', fallback_mount: '/other.mp3' },
    ]);
  });
});
