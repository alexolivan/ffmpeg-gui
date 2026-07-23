import React from 'react';

export interface FiltersConfig {
  scale?: string;
  deinterlace?: boolean;
  framerate?: string;
  overlays?: any[];
  highpass?: string;
  lowpass?: string;
  equalizer?: {
    enabled?: boolean;
    bands?: Record<string, number>;
  };
  compressor?: {
    enabled?: boolean;
    attack?: number;
    release?: number;
    gate?: number;
    gate_ratio?: number;
    threshold?: number;
    ratio?: number;
    gain?: number;
  };
  limiter?: {
    enabled?: boolean;
    ceiling?: number;
    release?: number;
  };
  volume?: string;
  aresample?: {
    enabled?: boolean;
    mode?: 'basic' | 'advanced';
    osr?: string;
    min_comp?: number;
    min_hard_comp?: number;
  };
}

interface ResourcePipelineDiagramProps {
  hwaccel: string;
  isVram: boolean;
  codecId: string;
  audioCodecId?: string;
  hasCpuFilters: boolean;
  inputType?: string;
  outputType?: string;
  filters?: FiltersConfig;
  hasVideo?: boolean;
  hasAudio?: boolean;
}

export const ResourcePipelineDiagram = React.memo<ResourcePipelineDiagramProps>((props) => {
  const {
    hwaccel,
    isVram,
    codecId,
    audioCodecId,
    inputType,
    outputType,
    filters,
    hasVideo = false,
    hasAudio = false,
  } = props;

  // 1. Raw/Compressed detection for input/output
  const isRawInput = inputType ? ['decklink', 'v4l2', 'alsa'].includes(inputType) : false;
  const isRawOutput = outputType ? ['decklink'].includes(outputType) : false;

  // 2. Decode/Encode GPU detection
  const isDecodeGPU = !isRawInput && ['cuda', 'vaapi', 'qsv'].includes(hwaccel);
  const isHwEncoder = codecId ? (codecId.toLowerCase().includes('nvenc') || codecId.toLowerCase().includes('vaapi') || codecId.toLowerCase().includes('qsv')) : false;
  const isEncodeGPU = !isRawOutput && isHwEncoder;

  // 3. Calculate filter locations
  const hasGpuFilters = !!(hasVideo && isDecodeGPU && isVram && (filters?.scale || filters?.deinterlace || filters?.framerate) && !filters?.overlays?.length);
  const hasCpuFilters = !!(hasVideo && (!isVram || !!(filters?.overlays && filters.overlays.length > 0) || !isDecodeGPU));
  
  // Recalculate helper flags for diagram
  const hasVideoGpuFilters = !!(hasVideo && isDecodeGPU && isVram && (filters?.scale || filters?.deinterlace || filters?.framerate));
  const isHybridFilters = hasVideoGpuFilters && !!(filters?.overlays && filters.overlays.length > 0);

  // Audio filter count and presence
  let audioFilterCount = 0;
  if (hasAudio) {
    if (filters?.highpass) audioFilterCount++;
    if (filters?.lowpass) audioFilterCount++;
    if (filters?.equalizer?.enabled) audioFilterCount++;
    if (filters?.compressor) audioFilterCount++;
    if (filters?.volume) audioFilterCount++;
    if (filters?.aresample) audioFilterCount++;
  }
  const hasAudioFilters = audioFilterCount > 0;

  // Codec copy flags
  const isVideoCopy = (codecId || '').toLowerCase() === 'copy';
  const isAudioCopy = (audioCodecId || '').toLowerCase() === 'copy';

  // Calculate layout coordinates
  const useOffset = hasVideo && hasAudio;
  const videoCpuY = useOffset ? 90 : 95;
  const audioCpuY = useOffset ? 100 : 95;
  const gpuY = 35;

  // Generate paths
  let videoPath = '';
  if (hasVideo) {
    if (isVideoCopy) {
      videoPath = `M 60,${videoCpuY} L 540,${videoCpuY}`;
    } else {
      videoPath = `M 60,${videoCpuY}`;
      let currentY = videoCpuY;
      
      if (!isRawInput) {
        currentY = isDecodeGPU ? gpuY : videoCpuY;
        videoPath += ` L 180,${currentY}`;
      }
      
      if (isHybridFilters) {
        videoPath += ` L 300,35 L 300,${videoCpuY}`;
        currentY = videoCpuY;
      } else if (hasVideoGpuFilters && !filters?.overlays?.length) {
        videoPath += ` L 300,35`;
        currentY = 35;
      } else if (hasCpuFilters) {
        videoPath += ` L 300,${videoCpuY}`;
        currentY = videoCpuY;
      } else {
        videoPath += ` L 300,${currentY}`;
      }
      
      if (!isRawOutput) {
        currentY = isEncodeGPU ? gpuY : videoCpuY;
        videoPath += ` L 420,${currentY}`;
      }
      
      videoPath += ` L 540,${videoCpuY}`;
    }
  }

  const audioPath = hasAudio ? `M 60,${audioCpuY} L 540,${audioCpuY}` : '';

  // Determine active states for nodes at stations
  // Station 60: INPUT
  const inputCpuActive = hasVideo || hasAudio;
  const inputGpuActive = false;

  // Station 180: DECODE
  const decodeCpuActive = (hasVideo && !isRawInput && !isVideoCopy && !isDecodeGPU) || (hasAudio && !isAudioCopy);
  const decodeGpuActive = hasVideo && !isRawInput && !isVideoCopy && isDecodeGPU;

  // Station 300: FILTER
  const filterCpuActive = (hasVideo && !isVideoCopy && hasCpuFilters) || (hasAudio && !isAudioCopy && hasAudioFilters);
  const filterGpuActive = hasVideo && !isVideoCopy && hasVideoGpuFilters;

  // Station 420: ENCODE
  const encodeCpuActive = (hasVideo && !isRawOutput && !isVideoCopy && !isEncodeGPU) || (hasAudio && !isAudioCopy);
  const encodeGpuActive = hasVideo && !isRawOutput && !isVideoCopy && isEncodeGPU;

  // Station 540: OUTPUT
  const outputCpuActive = hasVideo || hasAudio;
  const outputGpuActive = false;

  // Operation count calculations
  // CPU Video count per station
  const cpuVideoCount = (station: string) => {
    if (!hasVideo) return '-';
    if (station === 'input') return 1;
    if (station === 'decode') return (isRawInput || isVideoCopy || isDecodeGPU) ? 0 : 1;
    if (station === 'filter') {
      let count = 0;
      if (!isDecodeGPU || !isVram) {
        if (filters?.scale) count++;
        if (filters?.deinterlace) count++;
        if (filters?.framerate) count++;
      }
      if (filters?.overlays?.length) count += filters.overlays.length;
      return count;
    }
    if (station === 'encode') return (isRawOutput || isVideoCopy || isEncodeGPU) ? 0 : 1;
    if (station === 'output') return 1;
    return 0;
  };

  // CPU Audio count per station
  const cpuAudioCount = (station: string) => {
    if (!hasAudio) return '-';
    if (station === 'input') return 1;
    if (station === 'decode') return isAudioCopy ? 0 : 1;
    if (station === 'filter') return audioFilterCount;
    if (station === 'encode') return isAudioCopy ? 0 : 1;
    if (station === 'output') return 1;
    return 0;
  };

  // GPU Video count per station
  const gpuVideoCount = (station: string) => {
    if (!hasVideo) return '-';
    if (station === 'decode') return 1;
    if (station === 'filter') {
      let count = 0;
      if (isDecodeGPU && isVram) {
        if (filters?.scale) count++;
        if (filters?.deinterlace) count++;
        if (filters?.framerate) count++;
      }
      return count;
    }
    if (station === 'encode') return 1;
    return 0;
  };

  // Path classification for info box (re-calculate with local flags)
  let pathType = 'Full Software Path';
  let pathDesc = 'All processing is handled by the CPU. High CPU usage, maximum compatibility.';
  let pathColorClass = 'border-white/10 text-text-secondary';
  let badgeColorClass = 'bg-white/5 text-text-secondary border border-white/10';

  const boundaryDownload = isDecodeGPU && isVram && hasCpuFilters;
  const boundaryUpload = isEncodeGPU && (!isDecodeGPU || !isVram || hasCpuFilters);

  if (isDecodeGPU && isEncodeGPU && isVram && !hasCpuFilters) {
    pathType = 'Full GPU Accelerated Path';
    pathDesc = 'Transcoding is done entirely inside the GPU VRAM. Zero-copy, maximum efficiency and performance.';
    pathColorClass = 'border-brand-lime/20 text-brand-lime';
    badgeColorClass = 'bg-brand-lime/10 text-brand-lime border border-brand-lime/20';
  } else if (isDecodeGPU || isEncodeGPU) {
    pathType = 'Hybrid CPU-GPU Path';
    if (boundaryDownload && boundaryUpload) {
      pathDesc = 'Mixed pipeline: GPU decode ➔ Download to CPU RAM for filters ➔ Upload to GPU VRAM for encoding.';
    } else if (boundaryDownload) {
      pathDesc = 'Hybrid pipeline: GPU decode ➔ Download to CPU RAM for software filters & encoding.';
    } else if (boundaryUpload) {
      pathDesc = 'Hybrid pipeline: CPU decode/filtering ➔ Upload to GPU VRAM for hardware encoding.';
    } else {
      pathDesc = 'Processing is shared between CPU and GPU with memory copies.';
    }
    pathColorClass = 'border-brand-orange/20 text-brand-orange';
    badgeColorClass = 'bg-brand-orange/10 text-brand-orange border border-brand-orange/20';
  }

  // Helper render for stations
  const renderStationNode = (x: number, cpuActive: boolean, gpuActive: boolean, videoCpuActive: boolean, audioCpuActive: boolean, stationId: string) => {
    return (
      <g key={stationId}>
        {/* CPU Node(s) */}
        {cpuActive && (
          videoCpuActive && audioCpuActive ? (
            <rect
              x={x - 10}
              y={videoCpuY - 10}
              width={20}
              height={(audioCpuY - videoCpuY) + 20}
              rx={10}
              ry={10}
              fill="var(--bg-card)"
              stroke="var(--text-primary)"
              strokeWidth={2}
            />
          ) : videoCpuActive ? (
            <circle
              cx={x}
              cy={videoCpuY}
              r={6}
              fill="var(--bg-card)"
              stroke="#f97316"
              strokeWidth={2}
            />
          ) : audioCpuActive ? (
            <circle
              cx={x}
              cy={audioCpuY}
              r={6}
              fill="var(--bg-card)"
              stroke="#3b82f6"
              strokeWidth={2}
            />
          ) : null
        )}

        {/* GPU Node */}
        {gpuActive && (
          <circle
            cx={x}
            cy={gpuY}
            r={6}
            fill="var(--bg-card)"
            stroke="#f97316"
            strokeWidth={2}
          />
        )}
      </g>
    );
  };

  return (
    <div 
      className={`p-2.5 rounded-xl border bg-[var(--input-bg)] border-[var(--glass-border)] flex flex-col gap-2 transition-all duration-300 ${pathColorClass} mb-2.5`}
      data-gpu-filters={hasGpuFilters}
    >
      <div className="flex items-center justify-between">
        <span className="text-[9px] uppercase font-black tracking-widest text-text-secondary">
          Active Transcode Pipeline
        </span>
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider ${badgeColorClass}`}>
          {pathType}
        </span>
      </div>

      <div className="relative w-full overflow-hidden rounded-lg bg-[var(--input-bg)] border border-[var(--glass-border)] py-2">
        <svg viewBox="0 0 600 135" className="w-full text-[var(--text-primary)]">
          {/* Track Labels */}
          <text x={12} y={39} className="fill-[var(--text-secondary)] text-[9px] font-black tracking-wider uppercase font-mono">GPU</text>
          <text x={12} y={videoCpuY + 8} className="fill-[var(--text-secondary)] text-[9px] font-black tracking-wider uppercase font-mono">CPU</text>

          {/* Guide rails / Track Bed (Dark thick lines) */}
          <line x1={50} y1={gpuY} x2={550} y2={gpuY} stroke="var(--glass-border)" strokeWidth={5} strokeLinecap="round" />
          {useOffset ? (
            <>
              <line x1={50} y1={videoCpuY} x2={550} y2={videoCpuY} stroke="var(--glass-border)" strokeWidth={5} strokeLinecap="round" />
              <line x1={50} y1={audioCpuY} x2={550} y2={audioCpuY} stroke="var(--glass-border)" strokeWidth={5} strokeLinecap="round" />
            </>
          ) : (
            <line x1={50} y1={videoCpuY} x2={550} y2={videoCpuY} stroke="var(--glass-border)" strokeWidth={5} strokeLinecap="round" />
          )}
          {isHybridFilters && (
            <line x1={300} y1={35} x2={300} y2={videoCpuY} stroke="var(--glass-border)" strokeWidth={5} strokeLinecap="round" />
          )}

          {/* Audio line path */}
          {hasAudio && (
            <path
              d={audioPath}
              fill="none"
              stroke="#3b82f6"
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray={isAudioCopy ? "4,4" : undefined}
            />
          )}

          {/* Video line path */}
          {hasVideo && (
            <path
              d={videoPath}
              fill="none"
              stroke="#f97316"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={isVideoCopy ? "4,4" : undefined}
            />
          )}

          {/* Station Column Name Labels */}
          <text x={60} y={15} textAnchor="middle" className="fill-[var(--text-secondary)] text-[9px] font-black tracking-widest font-mono uppercase">INPUT</text>
          <text x={180} y={15} textAnchor="middle" className="fill-[var(--text-secondary)] text-[9px] font-black tracking-widest font-mono uppercase">DECODE</text>
          <text x={300} y={15} textAnchor="middle" className="fill-[var(--text-secondary)] text-[9px] font-black tracking-widest font-mono uppercase">FILTER</text>
          <text x={420} y={15} textAnchor="middle" className="fill-[var(--text-secondary)] text-[9px] font-black tracking-widest font-mono uppercase">ENCODE</text>
          <text x={540} y={15} textAnchor="middle" className="fill-[var(--text-secondary)] text-[9px] font-black tracking-widest font-mono uppercase">OUTPUT</text>

          {/* Render Station Circles/Capsules */}
          {renderStationNode(60, inputCpuActive, inputGpuActive, hasVideo, hasAudio, 'input')}
          {renderStationNode(180, decodeCpuActive, decodeGpuActive, hasVideo && !isRawInput && !isVideoCopy && !isDecodeGPU, hasAudio && !isAudioCopy, 'decode')}
          {renderStationNode(300, filterCpuActive, filterGpuActive, hasVideo && !isVideoCopy && hasCpuFilters, hasAudio && !isAudioCopy && hasAudioFilters, 'filter')}
          {renderStationNode(420, encodeCpuActive, encodeGpuActive, hasVideo && !isRawOutput && !isVideoCopy && !isEncodeGPU, hasAudio && !isAudioCopy, 'encode')}
          {renderStationNode(540, outputCpuActive, outputGpuActive, hasVideo, hasAudio, 'output')}

          {/* Display operation counts for CPU nodes */}
          {inputCpuActive && (
            <text x={60} y={120} textAnchor="middle" className="fill-[var(--text-primary)] text-[8px] font-mono font-bold">
              {`[ ${cpuAudioCount('input')} | ${cpuVideoCount('input')} ]`}
            </text>
          )}
          {decodeCpuActive && (
            <text x={180} y={120} textAnchor="middle" className="fill-[var(--text-primary)] text-[8px] font-mono font-bold">
              {`[ ${cpuAudioCount('decode')} | ${cpuVideoCount('decode')} ]`}
            </text>
          )}
          {filterCpuActive && (
            <text x={300} y={120} textAnchor="middle" className="fill-[var(--text-primary)] text-[8px] font-mono font-bold">
              {`[ ${cpuAudioCount('filter')} | ${cpuVideoCount('filter')} ]`}
            </text>
          )}
          {encodeCpuActive && (
            <text x={420} y={120} textAnchor="middle" className="fill-[var(--text-primary)] text-[8px] font-mono font-bold">
              {`[ ${cpuAudioCount('encode')} | ${cpuVideoCount('encode')} ]`}
            </text>
          )}
          {outputCpuActive && (
            <text x={540} y={120} textAnchor="middle" className="fill-[var(--text-primary)] text-[8px] font-mono font-bold">
              {`[ ${cpuAudioCount('output')} | ${cpuVideoCount('output')} ]`}
            </text>
          )}

          {/* Display operation counts for GPU nodes */}
          {decodeGpuActive && (
            <text x={180} y={51} textAnchor="middle" className="fill-[var(--text-primary)] text-[8px] font-mono font-bold">
              {`[ ${gpuVideoCount('decode')} ]`}
            </text>
          )}
          {filterGpuActive && (
            <text x={300} y={51} textAnchor="middle" className="fill-[var(--text-primary)] text-[8px] font-mono font-bold">
              {`[ ${gpuVideoCount('filter')} ]`}
            </text>
          )}
          {encodeGpuActive && (
            <text x={420} y={51} textAnchor="middle" className="fill-[var(--text-primary)] text-[8px] font-mono font-bold">
              {`[ ${gpuVideoCount('encode')} ]`}
            </text>
          )}

          {/* Input/Output format labels at the ends */}
          <text x={60} y={131} textAnchor="middle" className="fill-[var(--text-secondary)] text-[8px] font-mono uppercase">
            {isRawInput ? 'INPUT (RAW)' : 'INPUT (COMPRESSED)'}
          </text>
          <text x={540} y={131} textAnchor="middle" className="fill-[var(--text-secondary)] text-[8px] font-mono uppercase">
            {isRawOutput ? 'OUTPUT (RAW)' : 'OUTPUT (COMPRESSED)'}
          </text>
        </svg>
      </div>

      <p className="text-[10px] text-text-secondary leading-normal">
        {pathDesc}
      </p>
    </div>
  );
});

