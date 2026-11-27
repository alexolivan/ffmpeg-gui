import { describe, it, expect } from 'vitest';
import {
  evaluateNvencTagCompatibility,
  findHighestCompatibleNvencTag,
  parseNvencApiTuple,
} from '../forgeHwHelpers';

describe('forgeHwHelpers', () => {
  const SAMPLE_TAGS = ['n13.1.15.0', 'n13.0.19.0', 'n12.2.72.0', 'n12.1.14.0', 'n11.1.5.3'];

  it('parses nv-codec-headers tags and host API strings accurately', () => {
    expect(parseNvencApiTuple('n13.1.15.0')).toEqual([13, 1]);
    expect(parseNvencApiTuple('n12.2.72.0')).toEqual([12, 2]);
    expect(parseNvencApiTuple('12.2')).toEqual([12, 2]);
    expect(parseNvencApiTuple('auto')).toBeNull();
    expect(parseNvencApiTuple('master')).toBeNull();
    expect(parseNvencApiTuple('')).toBeNull();
  });

  it('flags mismatched SDK tag and recommends highest compatible host tag', () => {
    const res = evaluateNvencTagCompatibility('n13.1.15.0', '12.2', SAMPLE_TAGS);
    expect(res.status).toBe('incompatible');
    expect(res.selectedApi).toBe('13.1');
    expect(res.hostApi).toBe('12.2');
    expect(res.recommendedTag).toBe('n12.2.72.0');
  });

  it('accepts matching, lower, auto, and future versions without hardcoded tables', () => {
    expect(evaluateNvencTagCompatibility('n12.2.72.0', '12.2', SAMPLE_TAGS).status).toBe('ok');
    expect(evaluateNvencTagCompatibility('n12.1.14.0', '12.2', SAMPLE_TAGS).status).toBe('ok');
    expect(evaluateNvencTagCompatibility('auto', '12.2', SAMPLE_TAGS).status).toBe('ok');
    expect(evaluateNvencTagCompatibility('n14.0.0.0', '14.1', ['n14.0.0.0']).status).toBe('ok');
    expect(findHighestCompatibleNvencTag(SAMPLE_TAGS, '13.0')).toBe('n13.0.19.0');
  });

  it('returns unknown gracefully when host NVENC API version is unavailable', () => {
    const res = evaluateNvencTagCompatibility('n13.1.15.0', null, SAMPLE_TAGS);
    expect(res.status).toBe('unknown');
    expect(res.recommendedTag).toBeNull();
  });
});
