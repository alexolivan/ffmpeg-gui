export interface SelectOption {
  value: string;
  label: string;
  group?: string;
  disabled?: boolean;
}

export interface TriggerRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface DropdownPlacement {
  openAbove: boolean;
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxWidth: number;
  maxHeight: number;
}

/**
 * Computes fixed-viewport coordinates for a portal dropdown so it never overlaps
 * its trigger button and stays clamped within the visible viewport.
 */
export function computeDropdownPlacement(
  rect: TriggerRect,
  viewport: ViewportSize,
  desiredMaxHeight = 280,
  minWidth = 180,
  maxWidth?: number
): DropdownPlacement {
  const margin = 8;
  const gap = 4;

  const spaceBelow = Math.max(0, viewport.height - rect.bottom - margin - gap);
  const spaceAbove = Math.max(0, rect.top - margin - gap);
  const openAbove = spaceBelow < Math.min(desiredMaxHeight, 200) && spaceAbove > spaceBelow;
  const available = openAbove ? spaceAbove : spaceBelow;
  const maxHeight = Math.min(desiredMaxHeight, Math.max(80, available));

  const maxAllowedWidth = Math.max(120, viewport.width - margin * 2);
  const width = Math.min(Math.max(rect.width, minWidth), maxAllowedWidth);
  const effectiveMaxWidth = maxWidth
    ? Math.min(Math.max(width, maxWidth), maxAllowedWidth)
    : width;
  const left = Math.max(margin, Math.min(rect.left, viewport.width - width - margin));

  if (openAbove) {
    return {
      openAbove: true,
      bottom: Math.max(margin, viewport.height - rect.top + gap),
      left,
      width,
      maxWidth: effectiveMaxWidth,
      maxHeight,
    };
  }

  return {
    openAbove: false,
    top: Math.max(margin, rect.bottom + gap),
    left,
    width,
    maxWidth: effectiveMaxWidth,
    maxHeight,
  };
}

/**
 * Filters select options case-insensitively across label, value, and group.
 */
export function filterSelectOptions(options: SelectOption[], query: string): SelectOption[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return options;
  return options.filter((opt) => {
    const labelMatch = opt.label.toLowerCase().includes(normalized);
    const valueMatch = opt.value.toLowerCase().includes(normalized);
    const groupMatch = opt.group ? opt.group.toLowerCase().includes(normalized) : false;
    return labelMatch || valueMatch || groupMatch;
  });
}
