import React, { useState, useMemo, useRef, useLayoutEffect } from 'react';
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

const OverlayItemPreview: React.FC<{
  item: OverlayItem;
  idx: number;
  canvasW: number;
  canvasH: number;
  getImageUrl: (item: OverlayItem) => string | null;
  failedImages: Record<string, boolean>;
  handleImageError: (id: string) => void;
  handleImageLoad: (id: string, img: HTMLImageElement) => void;
}> = ({
  item,
  idx,
  canvasW,
  canvasH,
  getImageUrl,
  failedImages,
  handleImageError,
  handleImageLoad,
}) => {
  const itemRef = useRef<HTMLDivElement>(null);
  const [scaledSize, setScaledSize] = useState<{ w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    if (!itemRef.current) return;
    const parentCanvas = itemRef.current.closest('[data-screen-canvas]');
    if (!parentCanvas) return;

    const updateSize = () => {
      if (!itemRef.current || !parentCanvas) return;
      const elemRect = itemRef.current.getBoundingClientRect();
      const parentRect = parentCanvas.getBoundingClientRect();
      if (parentRect.width > 0 && parentRect.height > 0 && elemRect.width > 0 && elemRect.height > 0) {
        const scaleX = canvasW / parentRect.width;
        const scaleY = canvasH / parentRect.height;
        setScaledSize({
          w: elemRect.width * scaleX,
          h: elemRect.height * scaleY,
        });
      }
    };

    updateSize();

    const observer = new ResizeObserver(() => updateSize());
    observer.observe(itemRef.current);
    observer.observe(parentCanvas);
    return () => observer.disconnect();
  }, [canvasW, canvasH, item.text, item.fontsize, item.relative_path]);

  const fontSizePx = parseInt(item.fontsize || '24', 10) || 24;
  let layerW = scaledSize?.w ?? 160;
  let layerH = scaledSize?.h ?? 90;

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
      ref={itemRef}
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
          <span 
            className="opacity-0 group-hover:opacity-100 absolute -top-5 left-0 text-slate-950 font-bold font-mono text-[9px] px-1.5 py-0.2 rounded shadow-md transition-opacity whitespace-nowrap"
            style={{ backgroundColor: itemColor }}
          >
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
};

export const OverlayCanvasPreview: React.FC<OverlayCanvasPreviewProps> = ({
  overlays = [],
  scaleResolution,
  storages = [],
}) => {
  const [showTitleSafe, setShowTitleSafe] = useState<boolean>(true);
  const [showActionSafe, setShowActionSafe] = useState<boolean>(true);
  const [showCenterCross, setShowCenterCross] = useState<boolean>(true);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  const handleImageError = (id: string) => {
    setFailedImages((prev) => ({ ...prev, [id]: true }));
  };

  const handleImageLoad = (_id: string, _img: HTMLImageElement) => {};

  const [manualRatio, setManualRatio] = useState<'16:9' | '4:3' | '9:16' | '1:1' | null>(null);

  const { canvasW, canvasH, activeRatio, aspectRatioCSS } = useMemo(() => {
    let w = 1920;
    let h = 1080;

    if (scaleResolution && scaleResolution.includes('x')) {
      const parts = scaleResolution.split('x');
      const parsedW = parseInt(parts[0], 10);
      const parsedH = parseInt(parts[1], 10);
      if (!isNaN(parsedW) && !isNaN(parsedH) && parsedW > 0 && parsedH > 0) {
        w = parsedW;
        h = parsedH;
      }
    }

    if (manualRatio) {
      if (manualRatio === '16:9') return { canvasW: 1920, canvasH: 1080, activeRatio: '16:9', aspectRatioCSS: '16/9' };
      if (manualRatio === '4:3') return { canvasW: 1440, canvasH: 1080, activeRatio: '4:3', aspectRatioCSS: '4/3' };
      if (manualRatio === '9:16') return { canvasW: 1080, canvasH: 1920, activeRatio: '9:16', aspectRatioCSS: '9/16' };
      if (manualRatio === '1:1') return { canvasW: 1080, canvasH: 1080, activeRatio: '1:1', aspectRatioCSS: '1/1' };
    }

    const ratioVal = w / h;
    let ratioLabel: '16:9' | '4:3' | '9:16' | '1:1' = '16:9';
    let cssAspect = '16/9';

    if (Math.abs(ratioVal - 16 / 9) < 0.1) {
      ratioLabel = '16:9';
      cssAspect = '16/9';
    } else if (Math.abs(ratioVal - 4 / 3) < 0.1) {
      ratioLabel = '4:3';
      cssAspect = '4/3';
    } else if (Math.abs(ratioVal - 9 / 16) < 0.1) {
      ratioLabel = '9:16';
      cssAspect = '9/16';
    } else if (Math.abs(ratioVal - 1) < 0.1) {
      ratioLabel = '1:1';
      cssAspect = '1/1';
    }

    return { canvasW: w, canvasH: h, activeRatio: ratioLabel, aspectRatioCSS: cssAspect };
  }, [scaleResolution, manualRatio]);

  const getImageUrl = (item: OverlayItem): string | null => {
    if (item.type !== 'image') return null;
    if (item.path && item.path.startsWith('http')) return item.path;

    if (item.storage_id && item.relative_path) {
      const matchedStorage = storages.find((s: any) => s.id === item.storage_id);
      if (matchedStorage) {
        const cleanRel = item.relative_path.replace(/^\/+/, '');
        return `/api/media/serve?storage_id=${matchedStorage.id}&path=${encodeURIComponent(cleanRel)}`;
      }
    }
    return null;
  };

  const sortedOverlays = useMemo(() => {
    return [...overlays].sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [overlays]);

  return (
    <div className="w-full flex flex-col gap-3 p-4 bg-[var(--bg-card)] border border-[var(--glass-border)] text-[var(--text-primary)] rounded-2xl shadow-xl backdrop-blur-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
          <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
            TV Monitor Preview
          </span>
          <div className="px-2.5 py-1 rounded-full bg-[var(--input-bg)] border border-[var(--glass-border)] backdrop-blur-md flex items-center gap-1.5 text-[11px] font-mono text-cyan-300 shadow-sm">
            <span>
              {scaleResolution ? scaleResolution : `${canvasW}x${canvasH}`}
            </span>
            <span className="text-white/40">•</span>
            <span className="font-bold text-amber-300">{activeRatio} BROADCAST</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-[var(--input-bg)] p-0.5 rounded-lg border border-[var(--glass-border)]">
            {(['16:9', '4:3', '9:16', '1:1'] as const).map((ratio) => {
              const isActive = activeRatio === ratio;
              return (
                <button
                  key={ratio}
                  type="button"
                  onClick={() => setManualRatio(manualRatio === ratio ? null : ratio)}
                  className={`px-2 py-1 text-[10px] font-mono font-bold rounded transition-all cursor-pointer ${
                    isActive
                      ? 'bg-cyan-500 text-slate-950 shadow-md font-extrabold'
                      : 'text-text-secondary hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)]'
                  }`}
                >
                  {ratio}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 bg-[var(--input-bg)] p-1 rounded-lg border border-[var(--glass-border)] text-[10px] font-mono">
            <button
              type="button"
              onClick={() => setShowActionSafe(!showActionSafe)}
              className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                showActionSafe ? 'bg-amber-500/20 text-amber-400 font-bold border border-amber-500/40' : 'text-text-secondary hover:text-[var(--text-primary)]'
              }`}
            >
              SAFE 90%
            </button>
            <button
              type="button"
              onClick={() => setShowTitleSafe(!showTitleSafe)}
              className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                showTitleSafe ? 'bg-cyan-500/20 text-cyan-400 font-bold border border-cyan-500/40' : 'text-text-secondary hover:text-[var(--text-primary)]'
              }`}
            >
              SAFE 80%
            </button>
            <button
              type="button"
              onClick={() => setShowCenterCross(!showCenterCross)}
              className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                showCenterCross ? 'bg-sky-500/20 text-sky-400 font-bold border border-sky-500/40' : 'text-text-secondary hover:text-[var(--text-primary)]'
              }`}
            >
              CROSS
            </button>
          </div>
        </div>
      </div>

      <div className="w-full flex justify-center bg-[var(--input-bg)] p-3 rounded-xl border border-[var(--glass-border)] shadow-2xl relative overflow-hidden">
        <div
          data-screen-canvas="true"
          className="w-full relative bg-[var(--bg-dark)] rounded-lg border-2 border-[var(--glass-border)] shadow-[inset_0_0_20px_rgba(0,0,0,0.9)] overflow-hidden transition-all duration-300"
          style={{
            aspectRatio: aspectRatioCSS,
            maxHeight: activeRatio === '9:16' ? '520px' : '440px',
            containerType: 'size',
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-b from-[var(--bg-card)] to-[var(--bg-dark)] pointer-events-none" />
          <div
            className="absolute inset-0 opacity-10 pointer-events-none"
            style={{
              backgroundImage:
                'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.15) 1px, transparent 1px)',
              backgroundSize: '16px 16px',
            }}
          />

          <svg className="absolute inset-0 w-full h-full pointer-events-none z-20">
            {showActionSafe && (
              <g>
                <rect x="5%" y="5%" width="90%" height="90%" fill="none" stroke="#facc15" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.8" />
              </g>
            )}
            {showTitleSafe && (
              <g>
                <rect x="10%" y="10%" width="80%" height="80%" fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.85" />
              </g>
            )}
            {showCenterCross && (
              <g opacity="0.6">
                <line x1="50%" y1="0" x2="50%" y2="100%" stroke="rgba(255, 255, 255, 0.25)" strokeWidth="1" strokeDasharray="3 3" />
                <line x1="0" y1="50%" x2="100%" y2="50%" stroke="rgba(255, 255, 255, 0.25)" strokeWidth="1" strokeDasharray="3 3" />
              </g>
            )}
          </svg>

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
              sortedOverlays.map((item, idx) => (
                <OverlayItemPreview
                  key={item.id || idx}
                  item={item}
                  idx={idx}
                  canvasW={canvasW}
                  canvasH={canvasH}
                  getImageUrl={getImageUrl}
                  failedImages={failedImages}
                  handleImageError={handleImageError}
                  handleImageLoad={handleImageLoad}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(OverlayCanvasPreview);
