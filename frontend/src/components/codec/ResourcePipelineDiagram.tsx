import React from 'react';

interface ResourcePipelineDiagramProps {
  hwaccel: string;
  isVram: boolean;
  codecId: string;
  hasCpuFilters: boolean;
}

export const ResourcePipelineDiagram: React.FC<ResourcePipelineDiagramProps> = ({
  hwaccel,
  isVram,
  codecId,
  hasCpuFilters,
}) => {
  // Determine Decode Resource
  let decodeResource = 'CPU 💻';
  let decodeDetails = 'Software Decode';
  let isDecodeGPU = false;

  if (hwaccel === 'cuda') {
    decodeResource = 'GPU 🎮';
    decodeDetails = 'NVIDIA CUDA';
    isDecodeGPU = true;
  } else if (hwaccel === 'vaapi') {
    decodeResource = 'GPU 🎮';
    decodeDetails = 'Intel/AMD VAAPI';
    isDecodeGPU = true;
  } else if (hwaccel === 'qsv') {
    decodeResource = 'GPU 🎮';
    decodeDetails = 'Intel QSV';
    isDecodeGPU = true;
  }

  // Determine Filter Resource
  let filterResource = 'CPU 💻';
  let filterDetails = 'Software Filters';
  let isFilterGPU = false;
  let boundaryDownload = false;

  if (isDecodeGPU && isVram) {
    if (hasCpuFilters) {
      filterResource = 'CPU 💻';
      filterDetails = 'RAM (VRAM Download)';
      boundaryDownload = true;
    } else {
      filterResource = 'GPU 🎮';
      filterDetails = 'VRAM Filter';
      isFilterGPU = true;
    }
  }

  // Determine Encode Resource
  let encodeResource = 'CPU 💻';
  let encodeDetails = 'Software Encode';
  let isEncodeGPU = false;
  let boundaryUpload = false;

  const codecLower = codecId.toLowerCase();
  const isHwEncoder = codecLower.includes('nvenc') || codecLower.includes('vaapi') || codecLower.includes('qsv');

  if (isHwEncoder) {
    encodeResource = 'GPU 🎮';
    isEncodeGPU = true;
    if (codecLower.includes('nvenc')) {
      encodeDetails = 'NVIDIA NVENC';
    } else if (codecLower.includes('vaapi')) {
      encodeDetails = 'Intel/AMD VAAPI';
    } else if (codecLower.includes('qsv')) {
      encodeDetails = 'Intel QSV';
    }
    
    // If frames ended up on CPU, we need to upload them
    const framesCurrentlyOnCpu = !isDecodeGPU || !isVram || hasCpuFilters;
    if (framesCurrentlyOnCpu) {
      boundaryUpload = true;
      encodeDetails += ' (VRAM Upload)';
    }
  } else if (codecLower === 'copy') {
    encodeResource = 'Direct ⚡';
    encodeDetails = 'Passthrough';
  }

  // Path classification
  let pathType = 'Full Software Path';
  let pathDesc = 'All processing is handled by the CPU. High CPU usage, maximum compatibility.';
  let pathColorClass = 'border-white/10 text-text-secondary';
  let badgeColorClass = 'bg-white/5 text-text-secondary border border-white/10';

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

  return (
    <div className={`p-2.5 rounded-xl border bg-white/[0.02] flex flex-col gap-2 transition-all duration-300 ${pathColorClass} mb-2.5`}>
      <div className="flex items-center justify-between">
        <span className="text-[9px] uppercase font-black tracking-widest text-text-secondary">
          Active Transcode Pipeline
        </span>
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider ${badgeColorClass}`}>
          {pathType}
        </span>
      </div>

      <div className="flex items-center justify-between gap-1 py-0.5 font-mono text-[10px] text-center">
        {/* Step 1: Decode */}
        <div className="flex-1 flex flex-col items-center gap-1 p-1.5 rounded-lg bg-white/5 border border-white/10 min-w-0">
          <span className="text-[8px] uppercase font-bold text-text-secondary">1. Decode</span>
          <span className={`font-black truncate w-full ${isDecodeGPU ? 'text-brand-lime' : 'text-white'}`}>{decodeResource}</span>
          <span className="text-[9px] text-text-secondary truncate w-full">{decodeDetails}</span>
        </div>

        {/* Arrow 1 */}
        <div className="flex-shrink-0 flex flex-col items-center justify-center px-0.5 text-text-secondary text-[9px]">
          <span>➔</span>
          {boundaryDownload && <span className="text-[7px] text-brand-orange font-bold">DOWN</span>}
        </div>

        {/* Step 2: Filters */}
        <div className="flex-1 flex flex-col items-center gap-1 p-1.5 rounded-lg bg-white/5 border border-white/10 min-w-0">
          <span className="text-[8px] uppercase font-bold text-text-secondary">2. Filters</span>
          <span className={`font-black truncate w-full ${isFilterGPU ? 'text-brand-lime' : 'text-white'}`}>{filterResource}</span>
          <span className="text-[9px] text-text-secondary truncate w-full">{filterDetails}</span>
        </div>

        {/* Arrow 2 */}
        <div className="flex-shrink-0 flex flex-col items-center justify-center px-0.5 text-text-secondary text-[9px]">
          <span>➔</span>
          {boundaryUpload && <span className="text-[7px] text-brand-orange font-bold">UP</span>}
        </div>

        {/* Step 3: Encode */}
        <div className="flex-1 flex flex-col items-center gap-1 p-1.5 rounded-lg bg-white/5 border border-white/10 min-w-0">
          <span className="text-[8px] uppercase font-bold text-text-secondary">3. Encode</span>
          <span className={`font-black truncate w-full ${isEncodeGPU ? 'text-brand-lime' : 'text-white'}`}>{encodeResource}</span>
          <span className="text-[9px] text-text-secondary truncate w-full">{encodeDetails}</span>
        </div>
      </div>

      <p className="text-[10px] text-text-secondary leading-normal">
        {pathDesc}
      </p>
    </div>
  );
};
