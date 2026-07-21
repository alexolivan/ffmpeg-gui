import { describe, it, expect } from 'vitest';
import {
  generateAnchorExpressions,
  parseAnchorFromExpressions,
  calculateCanvasCoords,
  type AnchorPreset,
} from '../overlayPositionHelper';

describe('overlayPositionHelper', () => {
  describe('generateAnchorExpressions', () => {
    it('should generate correct expressions for top-left with default margins', () => {
      const res = generateAnchorExpressions('top-left');
      expect(res).toEqual({ x: '10', y: '10' });
    });

    it('should generate correct expressions for top-center with custom margins', () => {
      const res = generateAnchorExpressions('top-center', 15, 25);
      expect(res).toEqual({ x: '(main_w-w)/2', y: '25' });
    });

    it('should generate correct expressions for top-right', () => {
      const res = generateAnchorExpressions('top-right', 20, 15);
      expect(res).toEqual({ x: 'main_w-w-20', y: '15' });
    });

    it('should generate correct expressions for center-left', () => {
      const res = generateAnchorExpressions('center-left', 30, 10);
      expect(res).toEqual({ x: '30', y: '(main_h-h)/2' });
    });

    it('should generate correct expressions for center', () => {
      const res = generateAnchorExpressions('center');
      expect(res).toEqual({ x: '(main_w-w)/2', y: '(main_h-h)/2' });
    });

    it('should generate correct expressions for center-right', () => {
      const res = generateAnchorExpressions('center-right', 12, 10);
      expect(res).toEqual({ x: 'main_w-w-12', y: '(main_h-h)/2' });
    });

    it('should generate correct expressions for bottom-left', () => {
      const res = generateAnchorExpressions('bottom-left', 8, 16);
      expect(res).toEqual({ x: '8', y: 'main_h-h-16' });
    });

    it('should generate correct expressions for bottom-center', () => {
      const res = generateAnchorExpressions('bottom-center', 10, 30);
      expect(res).toEqual({ x: '(main_w-w)/2', y: 'main_h-h-30' });
    });

    it('should generate correct expressions for bottom-right', () => {
      const res = generateAnchorExpressions('bottom-right', 40, 50);
      expect(res).toEqual({ x: 'main_w-w-40', y: 'main_h-h-50' });
    });
  });

  describe('parseAnchorFromExpressions', () => {
    const presets: AnchorPreset[] = [
      'top-left',
      'top-center',
      'top-right',
      'center-left',
      'center',
      'center-right',
      'bottom-left',
      'bottom-center',
      'bottom-right',
    ];

    presets.forEach((preset) => {
      it(`should roundtrip parse expressions generated for ${preset}`, () => {
        const generated = generateAnchorExpressions(preset, 15, 25);
        const parsed = parseAnchorFromExpressions(generated.x, generated.y);

        expect(parsed.anchor).toBe(preset);
        if (preset.includes('left') || preset.includes('right')) {
          expect(parsed.marginX).toBe(15);
        }
        if (preset.includes('top') || preset.includes('bottom')) {
          expect(parsed.marginY).toBe(25);
        }
      });
    });

    it('should handle extra whitespace in expressions', () => {
      const parsed = parseAnchorFromExpressions(' ( main_w - w ) / 2 ', ' 10 ');
      expect(parsed).toEqual({ anchor: 'top-center', marginX: 0, marginY: 10 });
    });

    it('should detect zero margin right and bottom expressions', () => {
      const parsed = parseAnchorFromExpressions('main_w-w', 'main_h-h');
      expect(parsed).toEqual({ anchor: 'bottom-right', marginX: 0, marginY: 0 });
    });

    it('should return custom for non-standard expressions', () => {
      const parsed = parseAnchorFromExpressions('overlay_w+100', 'sin(t)');
      expect(parsed).toEqual({ anchor: 'custom', marginX: 10, marginY: 10 });
    });

    it('should return custom for partial custom expressions', () => {
      const parsed = parseAnchorFromExpressions('(main_w-w)/3', '10');
      expect(parsed).toEqual({ anchor: 'custom', marginX: 10, marginY: 10 });
    });
  });

  describe('calculateCanvasCoords', () => {
    const canvasW = 1920;
    const canvasH = 1080;
    const layerW = 200;
    const layerH = 100;

    it('should calculate static pixel coordinates', () => {
      const coords = calculateCanvasCoords('50', '100', canvasW, canvasH, layerW, layerH);
      expect(coords).toEqual({ pxX: 50, pxY: 100 });
    });

    it('should calculate center expressions', () => {
      const coords = calculateCanvasCoords(
        '(main_w-w)/2',
        '(main_h-h)/2',
        canvasW,
        canvasH,
        layerW,
        layerH
      );
      expect(coords).toEqual({ pxX: 860, pxY: 490 });
    });

    it('should calculate bottom-right margin expressions', () => {
      const coords = calculateCanvasCoords(
        'main_w-w-20',
        'main_h-h-30',
        canvasW,
        canvasH,
        layerW,
        layerH
      );
      expect(coords).toEqual({ pxX: 1700, pxY: 950 });
    });

    it('should support shorthand variable names (W, H)', () => {
      const coords = calculateCanvasCoords('(W-w)/2', 'H-h-15', canvasW, canvasH, layerW, layerH);
      expect(coords).toEqual({ pxX: 860, pxY: 965 });
    });

    it('should calculate complex math arithmetic', () => {
      const coords = calculateCanvasCoords('100+50*2', '1000/2-50', canvasW, canvasH, layerW, layerH);
      expect(coords).toEqual({ pxX: 200, pxY: 450 });
    });

    it('should return 0 for invalid or unsupported syntax safely', () => {
      const coords = calculateCanvasCoords('invalid_var', 'import("fs")', canvasW, canvasH, layerW, layerH);
      expect(coords).toEqual({ pxX: 0, pxY: 0 });
    });
  });
});
