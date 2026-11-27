export interface CollisionCheckContext {
  initialConfig?: { id?: number | null; name?: string | null } | null;
  isTask?: boolean;
}

export function isSrtLocalListener(out?: Record<string, any> | null): boolean {
  if (!out || String(out.type || '').toLowerCase() !== 'srt') {
    return false;
  }
  if (out.is_mediamtx) {
    return false;
  }
  const mode = String(out.mode || '').toLowerCase();
  return mode === 'listener' || mode === 'listen';
}

function isSelfConfig(item: any, ctx?: CollisionCheckContext): boolean {
  if (!ctx?.initialConfig) return false;
  const isSelfTask = Boolean(ctx.isTask) === Boolean(item?.is_task);
  if (!isSelfTask) return false;
  if (
    ctx.initialConfig.id !== undefined &&
    ctx.initialConfig.id !== null &&
    item?.id === ctx.initialConfig.id
  ) {
    return true;
  }
  if (ctx.initialConfig.name && item?.name === ctx.initialConfig.name) {
    return true;
  }
  return false;
}

export function findOutputPortCollision(
  targetOut: Record<string, any> | null | undefined,
  existingConfigs: any[],
  ctx?: CollisionCheckContext
): any | null {
  if (!targetOut) return null;
  const port = Number(String(targetOut.port || '').trim());
  if (!port || Number.isNaN(port)) return null;

  const outType = String(targetOut.type || '').toLowerCase();
  const host = String(targetOut.host || '').trim() || '127.0.0.1';

  if (outType === 'srt') {
    // SRT caller & MediaMTX SRT outputs connect outbound and multiplex by streamid; they never bind a local port.
    if (!isSrtLocalListener(targetOut)) {
      return null;
    }

    for (const item of existingConfigs) {
      if (isSelfConfig(item, ctx)) continue;
      const itemOut = item?.output_config;
      if (!isSrtLocalListener(itemOut)) continue;
      if (Number(itemOut.port) === port) {
        const itemHost = String(itemOut.host || '').trim() || '127.0.0.1';
        if (host === '0.0.0.0' || itemHost === '0.0.0.0' || host === itemHost) {
          return item;
        }
      }
    }
    return null;
  }

  if (outType === 'udp' || outType === 'rtp') {
    for (const item of existingConfigs) {
      if (isSelfConfig(item, ctx)) continue;
      const itemOut = item?.output_config;
      const itemType = String(itemOut?.type || '').toLowerCase();
      if (itemType !== 'udp' && itemType !== 'rtp') continue;
      if (Number(itemOut.port) === port) {
        const itemHost = String(itemOut.host || '').trim() || '127.0.0.1';
        if (host === '0.0.0.0' || itemHost === '0.0.0.0' || host === itemHost) {
          return item;
        }
      }
    }
  }

  return null;
}

export function findNextAvailableOutputPort(
  basePort: number,
  existingConfigs: any[],
  ctx?: CollisionCheckContext
): string {
  let port = basePort;
  const used = new Set<number>();
  for (const item of existingConfigs) {
    if (isSelfConfig(item, ctx)) continue;
    const out = item?.output_config;
    if (!out) continue;
    const outType = String(out.type || '').toLowerCase();
    if (outType === 'udp' || outType === 'rtp' || isSrtLocalListener(out)) {
      const p = Number(out.port);
      if (p && !Number.isNaN(p)) {
        used.add(p);
      }
    }
  }
  while (used.has(port)) {
    port++;
  }
  return String(port);
}
