export type AnchorPreset =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

/**
 * Generates FFmpeg overlay position expressions for a 3x3 anchor grid with custom margins.
 */
export function generateAnchorExpressions(
  anchor: AnchorPreset,
  marginX: number = 10,
  marginY: number = 10
): { x: string; y: string } {
  const formatRightMargin = (m: number) => (m >= 0 ? `main_w-w-${m}` : `main_w-w+${Math.abs(m)}`);
  const formatBottomMargin = (m: number) => (m >= 0 ? `main_h-h-${m}` : `main_h-h+${Math.abs(m)}`);

  switch (anchor) {
    case 'top-left':
      return { x: `${marginX}`, y: `${marginY}` };
    case 'top-center':
      return { x: '(main_w-w)/2', y: `${marginY}` };
    case 'top-right':
      return { x: formatRightMargin(marginX), y: `${marginY}` };
    case 'center-left':
      return { x: `${marginX}`, y: '(main_h-h)/2' };
    case 'center':
      return { x: '(main_w-w)/2', y: '(main_h-h)/2' };
    case 'center-right':
      return { x: formatRightMargin(marginX), y: '(main_h-h)/2' };
    case 'bottom-left':
      return { x: `${marginX}`, y: formatBottomMargin(marginY) };
    case 'bottom-center':
      return { x: '(main_w-w)/2', y: formatBottomMargin(marginY) };
    case 'bottom-right':
      return { x: formatRightMargin(marginX), y: formatBottomMargin(marginY) };
  }
}

/**
 * Parses X and Y position expressions to detect if they match a standard 3x3 anchor preset
 * and extracts any associated margin values.
 */
export function parseAnchorFromExpressions(
  x: string,
  y: string
): { anchor: AnchorPreset | 'custom'; marginX: number; marginY: number } {
  const cleanX = (x || '').replace(/\s+/g, '');
  const cleanY = (y || '').replace(/\s+/g, '');

  let xType: 'left' | 'center' | 'right' | 'custom' = 'custom';
  let extractedMarginX: number | null = null;

  // X logic
  if (cleanX === '(main_w-w)/2' || cleanX === '(W-w)/2') {
    xType = 'center';
    extractedMarginX = 0;
  } else if (cleanX === 'main_w-w' || cleanX === 'W-w') {
    xType = 'right';
    extractedMarginX = 0;
  } else {
    const rightMinusMatch = cleanX.match(/^(?:main_w-w|W-w)-(\d+(?:\.\d+)?)$/i);
    const rightPlusMatch = cleanX.match(/^(?:main_w-w|W-w)\+(\d+(?:\.\d+)?)$/i);
    if (rightMinusMatch) {
      xType = 'right';
      extractedMarginX = parseFloat(rightMinusMatch[1]);
    } else if (rightPlusMatch) {
      xType = 'right';
      extractedMarginX = -parseFloat(rightPlusMatch[1]);
    } else {
      const leftMatch = cleanX.match(/^(-?\d+(?:\.\d+)?)$/);
      if (leftMatch) {
        xType = 'left';
        extractedMarginX = parseFloat(leftMatch[1]);
      }
    }
  }

  let yType: 'top' | 'center' | 'bottom' | 'custom' = 'custom';
  let extractedMarginY: number | null = null;

  // Y logic
  if (cleanY === '(main_h-h)/2' || cleanY === '(H-h)/2') {
    yType = 'center';
    extractedMarginY = 0;
  } else if (cleanY === 'main_h-h' || cleanY === 'H-h') {
    yType = 'bottom';
    extractedMarginY = 0;
  } else {
    const bottomMinusMatch = cleanY.match(/^(?:main_h-h|H-h)-(\d+(?:\.\d+)?)$/i);
    const bottomPlusMatch = cleanY.match(/^(?:main_h-h|H-h)\+(\d+(?:\.\d+)?)$/i);
    if (bottomMinusMatch) {
      yType = 'bottom';
      extractedMarginY = parseFloat(bottomMinusMatch[1]);
    } else if (bottomPlusMatch) {
      yType = 'bottom';
      extractedMarginY = -parseFloat(bottomPlusMatch[1]);
    } else {
      const topMatch = cleanY.match(/^(-?\d+(?:\.\d+)?)$/);
      if (topMatch) {
        yType = 'top';
        extractedMarginY = parseFloat(topMatch[1]);
      }
    }
  }

  // Map to preset
  let anchor: AnchorPreset | 'custom' = 'custom';
  if (xType !== 'custom' && yType !== 'custom') {
    const key = `${yType}-${xType}`;
    if (key === 'top-left') anchor = 'top-left';
    else if (key === 'top-center') anchor = 'top-center';
    else if (key === 'top-right') anchor = 'top-right';
    else if (key === 'center-left') anchor = 'center-left';
    else if (key === 'center-center') anchor = 'center';
    else if (key === 'center-right') anchor = 'center-right';
    else if (key === 'bottom-left') anchor = 'bottom-left';
    else if (key === 'bottom-center') anchor = 'bottom-center';
    else if (key === 'bottom-right') anchor = 'bottom-right';
  }

  if (anchor === 'custom') {
    return { anchor: 'custom', marginX: 10, marginY: 10 };
  }

  return {
    anchor,
    marginX: extractedMarginX !== null ? extractedMarginX : 10,
    marginY: extractedMarginY !== null ? extractedMarginY : 10,
  };
}

/**
 * Evaluates position expressions (e.g. "main_w-w-10", "(main_h-h)/2", "100") against canvas and layer dimensions
 * returning absolute pixel coordinates for frontend preview rendering.
 */
export function calculateCanvasCoords(
  xExpr: string,
  yExpr: string,
  canvasW: number,
  canvasH: number,
  layerW: number,
  layerH: number
): { pxX: number; pxY: number } {
  const vars: Record<string, number> = {
    main_w: canvasW,
    main_h: canvasH,
    overlay_w: layerW,
    overlay_h: layerH,
    W: canvasW,
    H: canvasH,
    w: layerW,
    h: layerH,
  };

  const evaluate = (expr: string): number => {
    if (!expr || typeof expr !== 'string') return 0;

    let substituted = expr.trim();
    const sortedKeys = Object.keys(vars).sort((a, b) => b.length - a.length);

    for (const key of sortedKeys) {
      const regex = new RegExp(`\\b${key}\\b`, 'g');
      substituted = substituted.replace(regex, String(vars[key]));
    }

    if (!/^[0-9+*/().\s-]+$/.test(substituted)) {
      return 0;
    }

    try {
      const result = new Function(`"use strict"; return (${substituted});`)();
      if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
        return result;
      }
    } catch {
      return 0;
    }
    return 0;
  };

  return {
    pxX: evaluate(xExpr),
    pxY: evaluate(yExpr),
  };
}
