import { describe, it, expect } from 'vitest';
import { computeDropdownPlacement, filterSelectOptions } from '../searchableSelectHelper';

describe('searchableSelectHelper', () => {
  it('opens below trigger when sufficient space exists', () => {
    const placement = computeDropdownPlacement(
      { top: 100, bottom: 136, left: 40, width: 240 },
      { width: 1280, height: 800 },
      280
    );

    expect(placement.openAbove).toBe(false);
    expect(placement.top).toBe(140);
    expect(placement.bottom).toBeUndefined();
    expect(placement.maxHeight).toBe(280);
    expect(placement.left).toBe(40);
    expect(placement.width).toBe(240);
  });

  it('flips above trigger and clamps maxHeight when near bottom of viewport', () => {
    const placement = computeDropdownPlacement(
      { top: 680, bottom: 716, left: 40, width: 220 },
      { width: 1280, height: 760 },
      280
    );

    expect(placement.openAbove).toBe(true);
    expect(placement.bottom).toBe(84);
    expect(placement.top).toBeUndefined();
    expect(placement.maxHeight).toBe(280);
  });

  it('clamps maxHeight to available space without overlapping trigger on short viewports', () => {
    const placement = computeDropdownPlacement(
      { top: 180, bottom: 210, left: 20, width: 200 },
      { width: 800, height: 340 },
      280
    );

    expect(placement.openAbove).toBe(true);
    expect(placement.maxHeight).toBe(168);
  });

  it('clamps horizontal position inside viewport edges', () => {
    const placement = computeDropdownPlacement(
      { top: 100, bottom: 130, left: 720, width: 120 },
      { width: 800, height: 600 },
      280,
      180
    );

    expect(placement.width).toBe(180);
    expect(placement.left).toBe(612);
  });

  it('filters options case-insensitively across label, value, and group', () => {
    const options = [
      { value: 'n9.1', label: 'n9.1', group: 'Latest' },
      { value: 'n8.1', label: 'n8.1', group: 'Stable' },
      { value: 'custom.patch', label: 'Fix NDI 6.1', group: 'Recommended' },
    ];

    expect(filterSelectOptions(options, '')).toHaveLength(3);
    expect(filterSelectOptions(options, '9.1').map((o) => o.value)).toEqual(['n9.1']);
    expect(filterSelectOptions(options, 'stable').map((o) => o.value)).toEqual(['n8.1']);
    expect(filterSelectOptions(options, 'ndi').map((o) => o.value)).toEqual(['custom.patch']);
  });
});
