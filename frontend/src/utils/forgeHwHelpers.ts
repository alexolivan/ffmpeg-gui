export type NvencCompatStatus = 'ok' | 'incompatible' | 'unknown';

export interface NvencCompatResult {
  status: NvencCompatStatus;
  selectedApi: string | null;
  hostApi: string | null;
  recommendedTag: string | null;
}

const NVENC_TAG_RE = /^n?(\d+)\.(\d+)/i;

export function parseNvencApiTuple(raw?: string | null): [number, number] | null {
  if (!raw) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower === 'auto' || lower === 'master' || lower === 'latest' || lower === 'git' || lower === 'dev') {
    return null;
  }
  const m = NVENC_TAG_RE.exec(text);
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

function compareTuples(a: [number, number], b: [number, number]): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  return a[1] - b[1];
}

export function findHighestCompatibleNvencTag(
  availableTags: string[],
  hostApiVersion?: string | null
): string | null {
  const hostTuple = parseNvencApiTuple(hostApiVersion);
  if (!hostTuple || !Array.isArray(availableTags) || availableTags.length === 0) {
    return null;
  }

  let bestTag: string | null = null;
  let bestTuple: [number, number] | null = null;
  for (const tag of availableTags) {
    const t = parseNvencApiTuple(tag);
    if (!t) continue;
    if (compareTuples(t, hostTuple) <= 0) {
      if (!bestTuple || compareTuples(t, bestTuple) > 0) {
        bestTuple = t;
        bestTag = tag;
      }
    }
  }
  return bestTag;
}

/**
 * Evaluate whether the selected nv-codec-headers tag is compatible with
 * the host NVIDIA driver's max supported NVENC API version.
 */
export function evaluateNvencTagCompatibility(
  selectedTag: string | undefined | null,
  hostApiVersion: string | undefined | null,
  availableTags: string[] = []
): NvencCompatResult {
  const hostTuple = parseNvencApiTuple(hostApiVersion);
  const hostApi = hostTuple ? `${hostTuple[0]}.${hostTuple[1]}` : null;
  const recommendedTag = findHighestCompatibleNvencTag(availableTags, hostApiVersion);

  const selectedTuple = parseNvencApiTuple(selectedTag);
  const selectedApi = selectedTuple ? `${selectedTuple[0]}.${selectedTuple[1]}` : null;

  if (!hostTuple) {
    return { status: 'unknown', selectedApi, hostApi, recommendedTag: null };
  }

  // Empty / 'auto' relies on backend build_manager clamping, so it's compatible by design
  if (!selectedTuple) {
    return { status: 'ok', selectedApi: null, hostApi, recommendedTag };
  }

  if (compareTuples(selectedTuple, hostTuple) > 0) {
    return { status: 'incompatible', selectedApi, hostApi, recommendedTag };
  }

  return { status: 'ok', selectedApi, hostApi, recommendedTag };
}
