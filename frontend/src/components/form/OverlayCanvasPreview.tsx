import React, { useState, useMemo } from 'react';
import { calculateCanvasCoords } from '../../utils/overlayPositionHelper';

export interface OverlayItem {
  id: string;
  name?: string;
  type: 'text' | 'image';
  color?: string;
  text?: string;
  path?: string;
  storage_id?: number | null;
  relative_path?: string;
  x: string;
  y: string;
  fontsize?: string;
  fontcolor?: string;
  order: number;
  box?: boolean;
  boxcolor?: string;
  boxborderw?: string;
}

interface OverlayCanvasPreviewProps {
  overlays: OverlayItem[];
  scaleResolution?: string;
  storages?: any[];
}

export const OverlayCanvasPreview: React.FC<OverlayCanvasPreviewProps> = ({
  overlays = [],
  scaleResolution,
  storages = [],
}) => {
  // Safe Area Guides Toggle States
  const [showTitleSafe, setShowTitleSafe] = useState<boolean>(true);
  const [showActionSafe, setShowActionSafe] = useState<boolean>(true);
  const [showCenterCross, setShowCenterCross] = useState<boolean>(true);

  // Image load error & dimensions tracker
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [imgDimensions, setImgDimensions] = useState<Record<string, { w: number; h: number }>>({});

  const handleImageError = (id: string) => {
    setFailedImages((prev) => ({ ...prev, [id]: true }));
  };

  const handleImageLoad = (id: string, img: HTMLImageElement) => {
    if (img.naturalWidth && img.naturalHeight) {
      setImgDimensions((prev) => ({
        ...prev,
        [id]: { w: img.naturalWidth, h: img.naturalHeight },
      }));
    }
  };

  // Manual Aspect Ratio Selection (null = auto from scaleResolution)
  const [manualRatio, setManualRatio] = useState<'16:9' | '4:3' | '9:16' | '1:1' | null>(null);

  // Parse resolution and compute native aspect ratio
  const parsed = useMemo(() => {
    if (scaleResolution) {
      const match = scaleResolution.match(/(\d+)\s*x\s*(\d+)/i);
      if (match) {
        const w = parseInt(match[1], 10);
        const h = parseInt(match[2], 10);
        if (w > 0 && h > 0) {
          const ratioVal = w / h;
          let ratioTag = '16:9';
          if (Math.abs(ratioVal - 16 / 9) < 0.05) ratioTag = '16:9';
          else if (Math.abs(ratioVal - 9 / 16) < 0.05) ratioTag = '9:16';
          else if (Math.abs(ratioVal - 4 / 3) < 0.05) ratioTag = '4:3';
          else if (Math.abs(ratioVal - 1) < 0.05) ratioTag = '1:1';
          else ratioTag = `${w}:${h}`;

          return { width: w, height: h, ratioTag, isCustom: false };
        }
      }
    }
    return { width: 1920, height: 1080, ratioTag: '16:9', isCustom: true };
  }, [scaleResolution]);

  // Determine active aspect ratio & canvas dimensions
  const activeRatio = manualRatio || parsed.ratioTag;

  const { canvasW, canvasH, aspectRatioCSS } = useMemo(() => {
    if (manualRatio) {
      switch (manualRatio) {
        case '16:9':
          return { canvasW: 1920, canvasH: 1080, aspectRatioCSS: '16 / 9' };
        case '4:3':
          return { canvasW: 1440, canvasH: 1080, aspectRatioCSS: '4 / 3' };
        case '9:16':
          return { canvasW: 1080, canvasH: 1920, aspectRatioCSS: '9 / 16' };
        case '1:1':
          return { canvasW: 1080, canvasH: 1080, aspectRatioCSS: '1 / 1' };
      }
    }
    return {
      canvasW: parsed.width,
      canvasH: parsed.height,
      aspectRatioCSS: `${parsed.width} / ${parsed.height}`,
    };
  }, [manualRatio, parsed]);

  // Helper to build image URL if available from storages or direct path
  const getImageUrl = (overlay: OverlayItem): string | null => {
    if (overlay.path) return overlay.path;
    if (overlay.storage_id && overlay.relative_path) {
      const storage = storages.find((s) => String(s.id) === String(overlay.storage_id));
      if (storage) {
        const cleanBase = (storage.path || '').replace(/\/$/, '');
        const cleanRel = overlay.relative_path.replace(/^\//, '');
        return `${cleanBase}/${cleanRel}`;
      }
    }
    return null;
  };

  // Sort overlays by order ascending
  const sortedOverlays = useMemo(() => {
    return [...overlays].sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [overlays]);

  return (
    <div className="w-full flex flex-col gap-3 p-4 bg-slate-900/90 border border-slate-800 rounded-2xl shadow-xl backdrop-blur-xl">
      {/* Top Controls & Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
        {/* Left: Monitor Badge Pill */}
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
          <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
            TV Monitor Preview
          </span>
          <div className="px-2.5 py-1 rounded-full bg-white/10 border border-white/15 backdrop-blur-md flex items-center gap-1.5 text-[11px] font-mono text-cyan-300 shadow-sm">
            <span>
              {scaleResolution ? scaleResolution : `${canvasW}x${canvasH}`}
            </span>
            <span className="text-white/40">•</span>
            <span className="font-bold text-amber-300">{activeRatio} BROADCAST</span>
          </div>
        </div>

        {/* Right: Aspect Ratio Selector & Safe Area Toggles */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Aspect Ratio Buttons */}
          <div className="flex items-center bg-slate-950/80 p-0.5 rounded-lg border border-white/10">
            {(['16:9', '4:3', '9:16', '1:1'] as const).map((ratio) => {
              const isActive = activeRatio === ratio;
              return (
                <button
                  key={ratio}
                  type="button"
                  onClick={() => setManualRatio(ratio)}
                  className={`px-2 py-0.5 text-[10px] font-bold rounded transition-all ${
                    isActive
                      ? 'bg-cyan-500 text-slate-950 shadow-[0_0_10px_rgba(6,182,212,0.5)]'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {ratio}
                </button>
              );
            })}
          </div>

          {/* Broadcast Safe Area Toggle Buttons */}
          <div className="flex items-center gap-1 bg-slate-950/80 p-0.5 rounded-lg border border-white/10">
            <button
              type="button"
              onClick={() => setShowTitleSafe(!showTitleSafe)}
              className={`px-2 py-0.5 text-[10px] font-bold rounded transition-all border ${
                showTitleSafe
                  ? 'bg-cyan-950/60 border-cyan-500 text-cyan-300 shadow-[0_0_8px_rgba(6,182,212,0.3)]'
                  : 'border-transparent text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              Title Safe 80%
            </button>
            <button
              type="button"
              onClick={() => setShowActionSafe(!showActionSafe)}
              className={`px-2 py-0.5 text-[10px] font-bold rounded transition-all border ${
                showActionSafe
                  ? 'bg-amber-950/60 border-amber-500 text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.3)]'
                  : 'border-transparent text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              Action Safe 90%
            </button>
            <button
              type="button"
              onClick={() => setShowCenterCross(!showCenterCross)}
              className={`px-2 py-0.5 text-[10px] font-bold rounded transition-all border ${
                showCenterCross
                  ? 'bg-slate-800 border-slate-500 text-slate-200'
                  : 'border-transparent text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              Center +
            </button>
          </div>
        </div>
      </div>

      {/* TV Monitor Display Frame */}
      <div className="w-full flex justify-center bg-slate-950 p-3 rounded-xl border border-slate-800 shadow-2xl relative overflow-hidden">
        {/* Outer Monitor Frame Bezel */}
        <div
          className="w-full relative bg-slate-950 rounded-lg border-2 border-slate-700/80 shadow-[inset_0_0_20px_rgba(0,0,0,0.9)] overflow-hidden transition-all duration-300"
          style={{
            aspectRatio: aspectRatioCSS,
            maxHeight: activeRatio === '9:16' ? '520px' : '440px',
            containerType: 'size',
          }}
        >
          {/* TV Screen Grid / CRT lines effect background */}
          <div className="absolute inset-0 bg-gradient-to-b from-slate-900/90 via-slate-950 to-black pointer-events-none" />
          <div
            className="absolute inset-0 opacity-10 pointer-events-none"
            style={{
              backgroundImage:
                'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.15) 1px, transparent 1px)',
              backgroundSize: '16px 16px',
            }}
          />

          {/* Broadcast Safe Area SVG Guides */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-20">
            {/* Action Safe (90% Box in Yellow) */}
            {showActionSafe && (
              <g>
                <rect
                  x="5%"
                  y="5%"
                  width="90%"
                  height="90%"
                  fill="none"
                  stroke="#facc15"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                  opacity="0.8"
                />
                <text
                  x="5.5%"
                  y="8.5%"
                  fill="#facc15"
                  fontSize="10"
                  fontFamily="monospace"
                  fontWeight="bold"
                  opacity="0.75"
                >
                  ACTION SAFE (90%)
                </text>
              </g>
            )}

            {/* Title Safe (80% Box in Cyan) */}
            {showTitleSafe && (
              <g>
                <rect
                  x="10%"
                  y="10%"
                  width="80%"
                  height="80%"
                  fill="none"
                  stroke="#22d3ee"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                  opacity="0.85"
                />
                <text
                  x="10.5%"
                  y="13.5%"
                  fill="#22d3ee"
                  fontSize="10"
                  fontFamily="monospace"
                  fontWeight="bold"
                  opacity="0.85"
                >
                  TITLE SAFE (80%)
                </text>
              </g>
            )}

            {/* Center Crosshair (+) Lines */}
            {showCenterCross && (
              <g opacity="0.6">
                <line
                  x1="50%"
                  y1="0"
                  x2="50%"
                  y2="100%"
                  stroke="rgba(255, 255, 255, 0.25)"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                <line
                  x1="0"
                  y1="50%"
                  x2="100%"
                  y2="50%"
                  stroke="rgba(255, 255, 255, 0.25)"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                <circle
                  cx="50%"
                  cy="50%"
                  r="6"
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="1.5"
                />
                <line
                  x1="50%"
                  y1="46%"
                  x2="50%"
                  y2="54%"
                  stroke="#38bdf8"
                  strokeWidth="1.5"
                />
                <line
                  x1="48%"
                  y1="50%"
                  x2="52%"
                  y2="50%"
                  stroke="#38bdf8"
                  strokeWidth="1.5"
                />
              </g>
            )}
          </svg>

          {/* Render Overlays Layers */}
          <div className="absolute inset-0 w-full h-full z-10 overflow-hidden">
            {sortedOverlays.length === 0 ? (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-slate-500 p-4 text-center">
                <div className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 font-mono text-xs">
                  PAT
                </div>
                <p className="text-xs font-mono tracking-wide text-slate-400">
                  NO OVERLAY LAYERS ACTIVE
                </p>
                <p className="text-[10px] text-slate-500 max-w-xs">
                  Add Text or Image overlays to preview broadcast positions
                </p>
              </div>
            ) : (
              sortedOverlays.map((item, idx) => {
                const fontSizePx = parseInt(item.fontsize || '24', 10) || 24;

                let layerW = 160;
                let layerH = 90;

                if (item.type === 'text') {
                  layerH = Math.round(fontSizePx * 1.3);
                  const textStr = item.text || 'Sample Text';
                  layerW = Math.max(80, Math.round(textStr.length * fontSizePx * 0.55));
                } else if (imgDimensions[item.id]) {
                  const dims = imgDimensions[item.id];
                  layerW = Math.min(480, dims.w);
                  layerH = Math.min(270, dims.h);
                }

                const { pxX, pxY } = calculateCanvasCoords(
                  item.x || '10',
                  item.y || '10',
                  canvasW,
                  canvasH,
                  layerW,
                  layerH
                );

                const leftPct = (pxX / canvasW) * 100;
                const topPct = (pxY / canvasH) * 100;
                const fontCQH = (fontSizePx / canvasH) * 100;

                const imgUrl = getImageUrl(item);
                const isImgFailed = item.type === 'image' && (!imgUrl || failedImages[item.id]);

                const rawRel = item.relative_path || item.path || '';
                const ext = rawRel.split('.').pop()?.toUpperCase() || 'IMG';
                const extBadge = ext.length <= 4 ? ext : 'IMG';

                const displayName = item.name?.trim() || (
                  item.type === 'text' 
                    ? (item.text || 'Text Layer')
                    : (rawRel ? rawRel.split('/').pop() : 'Image Layer')
                );
                
                const itemColor = item.color || '#22d3ee';

                return (
                  <div
                    key={item.id || idx}
                    className="absolute transition-all duration-150 group select-none pointer-events-auto"
                    style={{
                      left: `${leftPct}%`,
                      top: `${topPct}%`,
                      zIndex: item.order ?? idx + 1,
                    }}
                  >
                    {item.type === 'text' ? (
                      <div
                        className="inline-block relative rounded px-1.5 py-0.5 leading-tight font-sans whitespace-nowrap shadow-md"
                        style={{
                          fontSize: `${fontCQH}cqh`,
                          color: item.fontcolor || '#ffffff',
                          backgroundColor:
                            item.box || item.boxcolor
                              ? item.boxcolor || 'rgba(0, 0, 0, 0.75)'
                              : 'transparent',
                          border: item.boxborderw ? `${item.boxborderw}px solid currentColor` : 'none',
                        }}
                      >
                        {item.text || 'Sample Text'}
                        <span className="opacity-0 group-hover:opacity-100 absolute -top-5 left-0 bg-cyan-500 text-slate-950 font-bold font-mono text-[9px] px-1 py-0.2 rounded shadow transition-opacity whitespace-nowrap">
                          #{item.order ?? idx + 1} {displayName} ({Math.round(pxX)}, {Math.round(pxY)})
                        </span>
                      </div>
                    ) : (
                      <div className="inline-block relative group">
                        {isImgFailed ? (
                          <div 
                            className="flex items-center justify-center px-2 py-1 rounded shadow-md backdrop-blur-sm border"
                            style={{ 
                              backgroundColor: `${itemColor}20`, 
                              borderColor: `${itemColor}80` 
                            }}
                          >
                            <span 
                              className="text-black font-black font-mono text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider shadow-sm"
                              style={{ backgroundColor: itemColor }}
                            >
                              {extBadge}
                            </span>
                          </div>
                        ) : (
                          <img
                            src={imgUrl!}
                            alt={`Overlay ${item.order ?? idx + 1}`}
                            onError={() => handleImageError(item.id)}
                            onLoad={(e) => handleImageLoad(item.id, e.currentTarget)}
                            className="max-h-24 max-w-48 object-contain rounded border shadow-md"
                            style={{ borderColor: `${itemColor}80` }}
                          />
                        )}
                        <span 
                          className="opacity-0 group-hover:opacity-100 absolute -top-5 left-0 text-slate-950 font-bold font-mono text-[9px] px-1.5 py-0.2 rounded shadow-md transition-opacity whitespace-nowrap"
                          style={{ backgroundColor: itemColor }}
                        >
                          #{item.order ?? idx + 1} {displayName} ({Math.round(pxX)}, {Math.round(pxY)})
                        </span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(OverlayCanvasPreview);
