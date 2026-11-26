export interface IcecastMountLike {
  mount_name: string;
  fallback_mount?: string;
  relay_enabled?: boolean;
}

export interface PeerIcecastProtocolsLike {
  http_enabled?: boolean;
  ssl_enabled?: boolean;
}

/**
 * Normalize an Icecast mount path to always carry a leading slash (or '' if blank).
 */
export function normalizeMountPath(raw?: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/**
 * Return distinct mountpoints eligible as fallback targets for the mount currently
 * being created or edited (never returning self / current index).
 */
export function getAvailableFallbackMounts<T extends IcecastMountLike>(
  mounts: T[],
  editingIndex: number | null,
  currentMountName?: string
): T[] {
  const selfPath = normalizeMountPath(currentMountName);
  const seen = new Set<string>();
  const result: T[] = [];

  mounts.forEach((mount, idx) => {
    if (editingIndex !== null && idx === editingIndex) return;
    const normPath = normalizeMountPath(mount?.mount_name);
    if (!normPath || normPath === selfPath || seen.has(normPath)) return;
    seen.add(normPath);
    result.push({ ...mount, mount_name: normPath });
  });

  return result;
}

/**
 * Prefer HTTP for Icecast peer relays whenever HTTP listening is enabled on the peer,
 * falling back to TLS only when HTTP is disabled and SSL is enabled.
 */
export function shouldDefaultPeerRelayTls(
  protocols?: PeerIcecastProtocolsLike | null
): boolean {
  if (!protocols) return false;
  return protocols.http_enabled === false && Boolean(protocols.ssl_enabled);
}

/**
 * Keep sibling mount fallback_mount references consistent when a mount is renamed or removed.
 */
export function cascadeMountRenameOrRemoval<T extends IcecastMountLike>(
  mounts: T[],
  oldMountName: string,
  newMountName?: string
): T[] {
  const normOld = normalizeMountPath(oldMountName);
  const normNew = normalizeMountPath(newMountName);
  if (!normOld) return mounts;

  return mounts.map((m) => {
    const normFb = normalizeMountPath(m.fallback_mount);
    if (!normFb || normFb !== normOld) return m;
    const normSelf = normalizeMountPath(m.mount_name);
    if (!normNew || normNew === normSelf) {
      return { ...m, fallback_mount: undefined };
    }
    return { ...m, fallback_mount: normNew };
  });
}
