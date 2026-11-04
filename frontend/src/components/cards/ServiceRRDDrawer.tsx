import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useTelemetrySubscription } from '../../context/TelemetryContext';

interface ServiceRRDDrawerProps {
  serviceId: number;
  isOpen: boolean;
  hasVideo?: boolean;
  serviceType?: string;
  initialMetric?: MetricKey;
  onClose?: () => void;
}

type RRDTier = '30m' | '6h' | '24h';
type MetricKey = 'bitrate' | 'fps' | 'speed' | 'cpu' | 'ram';

interface MetricSeries {
  avg: number[];
  min: number[];
  max: number[];
}

interface RRDSeriesData {
  service_id?: number;
  metric?: string;
  range?: string;
  tier?: RRDTier;
  resolution_seconds?: number;
  timestamps: number[];
  avg?: number[];
  min?: number[];
  max?: number[];
  bitrate?: MetricSeries;
  fps?: MetricSeries;
  speed?: MetricSeries;
  cpu?: MetricSeries;
  ram?: MetricSeries;
  anomaly_summary?: {
    min_value: number;
    min_timestamp: number | null;
    max_value: number;
    max_timestamp: number | null;
    has_outliers: boolean;
  };
  has_outliers?: boolean;
}

export const ServiceRRDDrawer: React.FC<ServiceRRDDrawerProps> = ({
  serviceId,
  isOpen,
  hasVideo = true,
  serviceType = 'ffmpeg_stream',
  initialMetric,
  onClose,
}) => {
  const { t } = useTranslation();
  const [tier, setTier] = useState<RRDTier>('30m');

  const isAuxiliary = ['icecast_server', 'mediamtx_hub', 'pipewire_hub', 'desktop', 'kiosk_browser'].includes(serviceType);

  const availableMetrics: { key: MetricKey; label: string; unit: string }[] = useMemo(() => {
    if (isAuxiliary) {
      return [
        { key: 'cpu', label: t('services.rrd.metricCpu', 'CPU'), unit: '%' },
        { key: 'ram', label: t('services.rrd.metricRam', 'RAM'), unit: 'MB' },
      ];
    }
    if (hasVideo) {
      return [
        { key: 'bitrate', label: t('services.rrd.metricBitrate', 'Bitrate'), unit: 'kbps' },
        { key: 'fps', label: t('services.rrd.metricFps', 'FPS'), unit: 'fps' },
        { key: 'speed', label: t('services.rrd.metricSpeed', 'Speed'), unit: 'x' },
        { key: 'cpu', label: t('services.rrd.metricCpu', 'CPU'), unit: '%' },
        { key: 'ram', label: t('services.rrd.metricRam', 'RAM'), unit: 'MB' },
      ];
    }
    // Audio-only stream: CPU, RAM, Speed, Bitrate (Never show non-existent FPS)
    return [
      { key: 'cpu', label: t('services.rrd.metricCpu', 'CPU'), unit: '%' },
      { key: 'ram', label: t('services.rrd.metricRam', 'RAM'), unit: 'MB' },
      { key: 'speed', label: t('services.rrd.metricSpeed', 'Speed'), unit: 'x' },
      { key: 'bitrate', label: t('services.rrd.metricBitrate', 'Bitrate'), unit: 'kbps' },
    ];
  }, [isAuxiliary, hasVideo, t]);

  const defaultMetric = initialMetric && availableMetrics.some(m => m.key === initialMetric)
    ? initialMetric
    : availableMetrics[0].key;

  const [selectedMetric, setSelectedMetric] = useState<MetricKey>(defaultMetric);
  const [rrdData, setRrdData] = useState<RRDSeriesData | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Sync selected metric when initialMetric changes or if current selection is invalid for this service
  useEffect(() => {
    if (initialMetric && availableMetrics.some(m => m.key === initialMetric)) {
      setSelectedMetric(initialMetric);
    } else if (!availableMetrics.some(m => m.key === selectedMetric)) {
      setSelectedMetric(availableMetrics[0].key);
    }
  }, [initialMetric, availableMetrics]);

  // Clear hover and data on tier/metric change
  useEffect(() => {
    setHoverIndex(null);
  }, [tier, selectedMetric]);

  // Subscribe to WebSocket RRD telemetry stream when expanded
  useTelemetrySubscription(
    'service_metrics_rrd',
    isOpen ? serviceId : undefined,
    (msg: any) => {
      const targetId = msg.id ?? msg.service_id ?? msg.data?.service_id;
      if (msg.type === 'service_metrics_rrd' && targetId === serviceId) {
        const payload = msg.data || msg.rrd;
        if (payload) {
          const payloadRange = payload.range || payload.tier;
          if (!payloadRange || payloadRange === tier) {
            setRrdData(payload as RRDSeriesData);
          }
        }
      }
    },
    useMemo(() => ({ range: tier, metric: selectedMetric }), [tier, selectedMetric])
  );

  const currentSeries: MetricSeries | undefined = useMemo(() => {
    if (!rrdData) return undefined;
    if (Array.isArray(rrdData.avg) && rrdData.avg.length > 0) {
      return {
        avg: rrdData.avg,
        min: rrdData.min || rrdData.avg,
        max: rrdData.max || rrdData.avg,
      };
    }
    if ((rrdData as any)[selectedMetric]) {
      return (rrdData as any)[selectedMetric];
    }
    return undefined;
  }, [rrdData, selectedMetric]);

  const timestamps = rrdData?.timestamps || [];
  const pointCount = timestamps.length;
  const hasPoints = pointCount >= 2 && !!currentSeries && currentSeries.avg.length === pointCount;

  // Formatting helper based on metric
  const formatVal = (val: number | undefined | null) => {
    if (val === undefined || val === null || isNaN(val)) return '-';
    if (selectedMetric === 'bitrate') return `${val.toFixed(0)} kbps`;
    if (selectedMetric === 'fps') return `${val.toFixed(1)} fps`;
    if (selectedMetric === 'speed') return `${val.toFixed(2)}x`;
    if (selectedMetric === 'cpu') return `${val.toFixed(1)}%`;
    if (selectedMetric === 'ram') return `${val.toFixed(1)} MB`;
    return val.toFixed(1);
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  // Dimensions for SVG canvas
  const svgWidth = 600;
  const svgHeight = 120;
  const padLeft = 10;
  const padRight = 10;
  const padTop = 15;
  const padBottom = 22;
  const chartW = svgWidth - padLeft - padRight;
  const chartH = svgHeight - padTop - padBottom;

  // Compute min, max and path strings
  const chartGeometry = useMemo(() => {
    if (!isOpen || !hasPoints || !currentSeries) return null;

    let globalMin = Math.min(...currentSeries.min);
    let globalMax = Math.max(...currentSeries.max);

    if (globalMin === globalMax) {
      globalMax = globalMin + 1;
    }
    const valRange = globalMax - globalMin || 1;

    const coordsAvg: [number, number][] = [];
    const coordsMin: [number, number][] = [];
    const coordsMax: [number, number][] = [];

    for (let i = 0; i < pointCount; i++) {
      const x = padLeft + (i / (pointCount - 1)) * chartW;
      const yAvg = padTop + chartH - ((currentSeries.avg[i] - globalMin) / valRange) * chartH;
      const yMin = padTop + chartH - ((currentSeries.min[i] - globalMin) / valRange) * chartH;
      const yMax = padTop + chartH - ((currentSeries.max[i] - globalMin) / valRange) * chartH;

      coordsAvg.push([x, yAvg]);
      coordsMin.push([x, yMin]);
      coordsMax.push([x, yMax]);
    }

    const avgPolyline = coordsAvg.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

    // Corridor polygon: top line left to right, bottom line right to left
    const topPoints = coordsMax.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`);
    const bottomPoints = [...coordsMin].reverse().map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`);
    const corridorPoints = [...topPoints, ...bottomPoints].join(' ');

    return {
      globalMin,
      globalMax,
      coordsAvg,
      avgPolyline,
      corridorPoints,
    };
  }, [isOpen, hasPoints, currentSeries, pointCount, chartW, chartH, padLeft, padTop]);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!hasPoints) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, (clickX - (padLeft / svgWidth) * rect.width) / ((chartW / svgWidth) * rect.width)));
    const idx = Math.round(ratio * (pointCount - 1));
    setHoverIndex(Math.max(0, Math.min(pointCount - 1, idx)));
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
  };

  const tierOptions: { key: RRDTier; label: string; subtitle: string }[] = [
    { key: '30m', label: '30m', subtitle: '5s' },
    { key: '6h', label: '6h', subtitle: '1m' },
    { key: '24h', label: '24h', subtitle: '5m' },
  ];

  if (!isOpen) return null;

  return (
    <div 
      className="w-full mt-3 pt-3 border-t border-white/10 bg-black/15 -mx-4 px-4 pb-2 rounded-b-xl transition-all"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header bar: Metric selectors + Tier toggles */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-bold tracking-wider uppercase text-[var(--text-secondary)] mr-1">
            {t('services.rrd.metricsTitle', 'Histogram')}
          </span>
          {availableMetrics.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedMetric(m.key);
              }}
              className={`px-2 py-0.5 rounded text-[11px] font-mono font-medium transition-all ${
                selectedMetric === m.key
                  ? 'bg-brand-lime text-black font-bold shadow-sm shadow-brand-lime/20'
                  : 'bg-white/5 hover:bg-white/10 text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-white/5'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {(rrdData?.anomaly_summary?.has_outliers || rrdData?.has_outliers) && (
            <span
              className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1 animate-pulse"
              title={t('services.rrd.outlierNotice', 'Significant drop or deviation recorded in this timeframe')}
            >
              ⚠ {t('services.rrd.outlierAlert', 'Drop Detected')}
            </span>
          )}

          {/* Time range tier selector */}
          <div className="inline-flex rounded-lg p-0.5 bg-black/30 border border-white/10 text-[11px]">
            {tierOptions.map((tOpt) => (
              <button
                key={tOpt.key}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setTier(tOpt.key);
                }}
                className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-semibold transition-all ${
                  tier === tOpt.key
                    ? 'bg-white/20 text-white shadow-xs'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {tOpt.label}
              </button>
            ))}
          </div>

          {onClose && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="text-xs text-[var(--text-secondary)] hover:text-white px-1.5 py-0.5 rounded hover:bg-white/5"
              title={t('common.close', 'Close')}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* SVG Chart Container */}
      <div className="relative w-full rounded-lg bg-black/40 border border-white/5 p-2 overflow-hidden">
        {hasPoints && chartGeometry ? (
          <>
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="w-full h-28 select-none"
              preserveAspectRatio="none"
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            >
              <defs>
                <linearGradient id={`corridor-grad-${serviceId}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--brand-lime, #84cc16)" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="var(--brand-lime, #84cc16)" stopOpacity="0.05" />
                </linearGradient>
              </defs>

              {/* Horizontal Grid lines */}
              <line
                x1={padLeft}
                y1={padTop}
                x2={svgWidth - padRight}
                y2={padTop}
                stroke="rgba(255,255,255,0.08)"
                strokeDasharray="2,2"
              />
              <line
                x1={padLeft}
                y1={padTop + chartH / 2}
                x2={svgWidth - padRight}
                y2={padTop + chartH / 2}
                stroke="rgba(255,255,255,0.08)"
                strokeDasharray="2,2"
              />
              <line
                x1={padLeft}
                y1={padTop + chartH}
                x2={svgWidth - padRight}
                y2={padTop + chartH}
                stroke="rgba(255,255,255,0.12)"
              />

              {/* Min/Max corridor envelope */}
              <polygon
                points={chartGeometry.corridorPoints}
                fill={`url(#corridor-grad-${serviceId})`}
              />

              {/* Average Polyline */}
              <polyline
                points={chartGeometry.avgPolyline}
                fill="none"
                stroke="var(--brand-lime, #84cc16)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Time axis labels */}
              <text
                x={padLeft}
                y={svgHeight - 4}
                className="fill-[var(--text-secondary)] text-[9px] font-mono"
              >
                {formatTime(timestamps[0])}
              </text>
              <text
                x={svgWidth / 2}
                y={svgHeight - 4}
                textAnchor="middle"
                className="fill-[var(--text-secondary)] text-[9px] font-mono opacity-60"
              >
                -{tier}
              </text>
              <text
                x={svgWidth - padRight}
                y={svgHeight - 4}
                textAnchor="end"
                className="fill-[var(--text-secondary)] text-[9px] font-mono"
              >
                {formatTime(timestamps[pointCount - 1])}
              </text>

              {/* Hover guide line */}
              {hoverIndex !== null && chartGeometry.coordsAvg[hoverIndex] && (
                <g>
                  <line
                    x1={chartGeometry.coordsAvg[hoverIndex][0]}
                    y1={padTop}
                    x2={chartGeometry.coordsAvg[hoverIndex][0]}
                    y2={padTop + chartH}
                    stroke="rgba(255,255,255,0.5)"
                    strokeWidth="1"
                    strokeDasharray="2,2"
                  />
                  <circle
                    cx={chartGeometry.coordsAvg[hoverIndex][0]}
                    cy={chartGeometry.coordsAvg[hoverIndex][1]}
                    r={3.5}
                    className="fill-brand-lime stroke-black stroke-2"
                  />
                </g>
              )}
            </svg>

            {/* Readout overlay when hovered or header info */}
            <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-secondary)] pt-1 px-1">
              {hoverIndex !== null && currentSeries ? (
                <div className="flex items-center gap-3 text-white">
                  <span>⏱ {formatTime(timestamps[hoverIndex])}</span>
                  <span>
                    Avg: <strong className="text-brand-lime">{formatVal(currentSeries.avg[hoverIndex])}</strong>
                  </span>
                  <span>
                    Min: <strong className="text-amber-400">{formatVal(currentSeries.min[hoverIndex])}</strong>
                  </span>
                  <span>
                    Max: <strong className="text-cyan-400">{formatVal(currentSeries.max[hoverIndex])}</strong>
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="inline-block w-2.5 h-0.5 bg-brand-lime rounded-full" />
                  <span>{t('services.rrd.envelopeLegend', 'Min/Max corridor envelope with continuous average')}</span>
                </div>
              )}

              <span className="text-[9px] opacity-60">
                {t('services.rrd.zeroDisk', 'Volatile RAM • Zero flash wear')}
              </span>
            </div>
          </>
        ) : (
          <div className="h-28 flex flex-col items-center justify-center text-xs text-[var(--text-secondary)] font-mono gap-1">
            <span className="animate-pulse">⏳ {t('services.rrd.collectingBuffer', 'Buffering volatile metrics...')}</span>
            <span className="text-[10px] opacity-60">
              {t('services.rrd.collectingDetail', 'Zero disk writes • Updates every 5s')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
