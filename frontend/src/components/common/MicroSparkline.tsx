import React from 'react';

interface MicroSparklineProps {
  data?: number[] | null;
  hasOutlier?: boolean;
  isExpanded?: boolean;
  onToggle?: () => void;
  width?: number;
  height?: number;
  strokeColor?: string;
  title?: string;
}

export const MicroSparkline: React.FC<MicroSparklineProps> = ({
  data,
  hasOutlier = false,
  isExpanded = false,
  onToggle,
  width = 84,
  height = 20,
  strokeColor = 'var(--brand-lime, #84cc16)',
  title,
}) => {
  const uniqueId = React.useId().replace(/:/g, '_');
  const gradId = `sparkline-grad-${uniqueId}`;

  const rawPoints = data && data.length > 0 ? data : [];
  // If exactly 1 point has arrived so far, duplicate it to immediately render an active flat segment
  const points = rawPoints.length === 1 ? [rawPoints[0], rawPoints[0]] : rawPoints;
  const valid = points.length >= 2;

  let polylineCoords = '';
  let areaCoords = '';

  if (valid) {
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min;

    const padX = 2;
    const padY = 2;
    const effWidth = width - padX * 2;
    const effHeight = height - padY * 2;

    const coords = points.map((val, idx) => {
      const x = padX + (idx / (points.length - 1)) * effWidth;
      const normalized = range > 0 ? (val - min) / range : (max > 0 ? 0.5 : 0.2);
      const y = padY + effHeight - normalized * effHeight;
      return [x.toFixed(1), y.toFixed(1)];
    });

    polylineCoords = coords.map(([x, y]) => `${x},${y}`).join(' ');
    const firstX = coords[0][0];
    const lastX = coords[coords.length - 1][0];
    const bottomY = (height - 1).toFixed(1);
    areaCoords = `M ${firstX},${bottomY} L ` + coords.map(([x, y]) => `${x},${y}`).join(' L ') + ` L ${lastX},${bottomY} Z`;
  }

  const tooltipText = title || (hasOutlier 
    ? 'Drop/Outlier detected. Click to view 24h RRD metrics.' 
    : 'Live telemetry sparkline. Click to view 24h RRD metrics.');

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (onToggle) onToggle();
      }}
      className={`relative inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded transition-all cursor-pointer border ${
        isExpanded 
          ? 'bg-white/10 border-brand-lime/40 ring-1 ring-brand-lime/30' 
          : 'bg-black/20 hover:bg-white/5 border-white/10 hover:border-white/20'
      }`}
      title={tooltipText}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="overflow-visible block"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.35" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {valid ? (
          <>
            <path d={areaCoords} fill={`url(#${gradId})`} />
            <polyline
              points={polylineCoords}
              fill="none"
              stroke={strokeColor}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : (
          <line
            x1="2"
            y1={height / 2}
            x2={width - 2}
            y2={height / 2}
            stroke="var(--text-secondary, #71717a)"
            strokeWidth="1"
            strokeDasharray="2,2"
            opacity="0.4"
          />
        )}

        {hasOutlier && (
          <g>
            <circle
              cx={width - 4}
              cy={4}
              r={3}
              className="fill-amber-400 animate-ping opacity-75"
            />
            <circle
              cx={width - 4}
              cy={4}
              r={2.5}
              className="fill-amber-400"
            />
          </g>
        )}
      </svg>

      {/* Tiny toggle chevron */}
      <span className={`text-[9px] transition-transform duration-200 text-[var(--text-secondary)] ${isExpanded ? 'rotate-180 text-brand-lime' : ''}`}>
        ▼
      </span>
    </button>
  );
};
