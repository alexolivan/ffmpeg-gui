import React, { useEffect } from 'react';
import type { CodecParam } from './codecRegistry';
import {
  getAvailableVideoCodecs,
  getDefaultParams,
  isParamVisible,
} from './codecRegistry';
import type { SystemCapabilities } from './codecRegistry';

interface VideoCodecPanelProps {
  codecId: string;
  params: Record<string, string | number | boolean>;
  buildOptions?: Record<string, boolean>;
  systemCapabilities?: SystemCapabilities;
  hwaccel: string;
  onHwaccelChange: (hwaccel: string) => void;
  onChange: (codecId: string, params: Record<string, string | number | boolean>) => void;
}

const VideoCodecPanel: React.FC<VideoCodecPanelProps> = ({
  codecId,
  params,
  buildOptions,
  systemCapabilities,
  hwaccel,
  onHwaccelChange,
  onChange,
}) => {
  const available = getAvailableVideoCodecs(buildOptions, systemCapabilities);
  const selected = available.find(c => c.id === codecId) || available[0];

  // Auto-heal selected codec if the current one becomes unavailable
  useEffect(() => {
    if (available.length > 0 && !available.some(c => c.id === codecId)) {
      onChange(available[0].id, getDefaultParams(available[0]));
    }
  }, [available, codecId, onChange]);

  // Auto-heal hardware decoding selection if capabilities change or are missing
  useEffect(() => {
    if (systemCapabilities) {
      if (hwaccel === 'cuda' && !systemCapabilities.nvenc?.available) {
        onHwaccelChange('none');
      } else if ((hwaccel === 'vaapi' || hwaccel === 'qsv') && !systemCapabilities.vaapi?.available) {
        onHwaccelChange('none');
      }
    }
  }, [systemCapabilities, hwaccel, onHwaccelChange]);

  const handleCodecChange = (newCodecId: string) => {
    const codec = available.find(c => c.id === newCodecId);
    if (codec) {
      onChange(newCodecId, getDefaultParams(codec));
    }
  };

  const handleParamChange = (key: string, value: string | number | boolean) => {
    onChange(codecId, { ...params, [key]: value });
  };

  const softwareCodecs = available.filter(c => c.category === 'software' || c.category === 'passthrough');
  const hardwareCodecs = available.filter(c => c.category.startsWith('hw_'));

  return (
    <div className="space-y-4">
      {/* Video Codec Selection */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-brand-orange animate-pulse" />
          <h4 className="text-brand-orange font-bold text-xs uppercase tracking-wider">Video Codec (Output)</h4>
        </div>

        <select
          className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm outline-none focus:border-brand-orange transition-all font-medium"
          value={selected?.id || ''}
          onChange={e => handleCodecChange(e.target.value)}
        >
          {softwareCodecs.length > 0 && (
            <optgroup label="Software Codecs (CPU)">
              {softwareCodecs.map(c => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </optgroup>
          )}
          {hardwareCodecs.length > 0 && (
            <optgroup label="Hardware Codecs (GPU)">
              {hardwareCodecs.map(c => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      {/* Hardware Decoding Selection */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-brand-lime" />
          <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider">Hardware Decoding (Input)</h4>
          <span className="text-[10px] text-white/20 italic ml-auto">-hwaccel</span>
        </div>

        <select
          className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm outline-none focus:border-brand-lime transition-all"
          value={hwaccel}
          onChange={e => onHwaccelChange(e.target.value)}
        >
          <option value="none">None (Software Decoding)</option>
          {(!systemCapabilities || systemCapabilities.nvenc?.available) && (
            <option value="cuda">NVIDIA GPU (CUDA)</option>
          )}
          {(!systemCapabilities || systemCapabilities.vaapi?.available) && (
            <>
              <option value="vaapi">Intel/AMD GPU (VAAPI)</option>
              <option value="qsv">Intel Quick Sync (QSV)</option>
            </>
          )}
          <option value="auto">Auto-detect</option>
        </select>
        <span className="text-[10px] text-text-secondary block px-1">
          Offloads video decoding to the selected GPU. Recommended for high-bitrate file or network inputs.
        </span>
      </div>

      {/* Codec Parameters */}
      {selected?.params && selected.params.length > 0 && (
        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/5">
          {selected.params.map(param =>
            isParamVisible(param, params) ? (
              <ParamControl
                key={param.key}
                param={param}
                value={params[param.key] ?? param.default}
                onChange={v => handleParamChange(param.key, v)}
              />
            ) : null,
          )}
        </div>
      )}

      {/* Dynamic Resource Pipeline Diagram */}
      <ResourcePipelineDiagram hwaccel={hwaccel} codecId={codecId} />
    </div>
  );
};

// ── Dynamic Resource Pipeline Diagram Component ───────────────────

const ResourcePipelineDiagram: React.FC<{
  hwaccel: string;
  codecId: string;
}> = ({ hwaccel, codecId }) => {
  // Determine Decode Resource
  let decodeResource = 'CPU 💻';
  let decodeDetails = 'Software';
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
  } else if (hwaccel === 'auto') {
    decodeResource = 'Auto ⚙️';
    decodeDetails = 'Dynamic Detect';
  }

  // Determine Encode Resource
  let encodeResource = 'CPU 💻';
  let encodeDetails = 'Software';
  let isEncodeGPU = false;

  if (codecId.includes('nvenc')) {
    encodeResource = 'GPU 🎮';
    encodeDetails = 'NVIDIA NVENC';
    isEncodeGPU = true;
  } else if (codecId.includes('vaapi')) {
    encodeResource = 'GPU 🎮';
    encodeDetails = 'Intel/AMD VAAPI';
    isEncodeGPU = true;
  } else if (codecId.includes('qsv')) {
    encodeResource = 'GPU 🎮';
    encodeDetails = 'Intel QSV';
    isEncodeGPU = true;
  } else if (codecId === 'copy') {
    encodeResource = 'Direct ⚡';
    encodeDetails = 'Passthrough';
  }

  // Determine Filter Resource (Always CPU for now)
  const filterResource = 'CPU 💻';
  const filterDetails = 'Software Filters';
  const isFilterGPU = false;

  // Determine Path Description
  let pathType = 'Full Software Path';
  let pathDesc = 'All processing is handled by the CPU. High CPU usage, maximum compatibility.';
  let pathColorClass = 'border-white/10 text-text-secondary';
  let badgeColorClass = 'bg-white/5 text-text-secondary border border-white/10';

  if (isDecodeGPU && isEncodeGPU) {
    pathType = 'Full GPU Accelerated Path';
    pathDesc = 'Transcoding is done entirely inside the GPU. Extremely low CPU usage, optimal performance.';
    pathColorClass = 'border-brand-lime/20 text-brand-lime';
    badgeColorClass = 'bg-brand-lime/10 text-brand-lime border border-brand-lime/20';
  } else if (isDecodeGPU || isEncodeGPU) {
    pathType = 'Hybrid CPU-GPU Path';
    pathDesc = 'Processing is shared between CPU and GPU. Frames are copied between system memory and GPU VRAM.';
    pathColorClass = 'border-brand-orange/20 text-brand-orange';
    badgeColorClass = 'bg-brand-orange/10 text-brand-orange border border-brand-orange/20';
  }

  return (
    <div className={`p-4 rounded-xl border bg-white/[0.02] flex flex-col gap-3.5 transition-all duration-300 ${pathColorClass}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase font-black tracking-widest text-text-secondary">
          Active Transcode Pipeline
        </span>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${badgeColorClass}`}>
          {pathType}
        </span>
      </div>

      <div className="flex items-center justify-between gap-1 py-1 font-mono text-xs text-center">
        {/* Step 1: Decode */}
        <div className="flex-1 flex flex-col items-center gap-1.5 p-2 rounded-lg bg-white/5 border border-white/10 min-w-0">
          <span className="text-[9px] uppercase font-bold text-text-secondary">1. Decode</span>
          <span className={`font-black truncate w-full ${isDecodeGPU ? 'text-brand-lime' : 'text-white'}`}>{decodeResource}</span>
          <span className="text-[10px] text-text-secondary truncate w-full">{decodeDetails}</span>
        </div>

        {/* Arrow 1 */}
        <div className="flex-shrink-0 flex items-center justify-center px-1 text-text-secondary">
          ➔
        </div>

        {/* Step 2: Filters */}
        <div className="flex-1 flex flex-col items-center gap-1.5 p-2 rounded-lg bg-white/5 border border-white/10 min-w-0">
          <span className="text-[9px] uppercase font-bold text-text-secondary">2. Filters</span>
          <span className={`font-black truncate w-full ${isFilterGPU ? 'text-brand-lime' : 'text-white'}`}>{filterResource}</span>
          <span className="text-[10px] text-text-secondary truncate w-full">{filterDetails}</span>
        </div>

        {/* Arrow 2 */}
        <div className="flex-shrink-0 flex items-center justify-center px-1 text-text-secondary">
          ➔
        </div>

        {/* Step 3: Encode */}
        <div className="flex-1 flex flex-col items-center gap-1.5 p-2 rounded-lg bg-white/5 border border-white/10 min-w-0">
          <span className="text-[9px] uppercase font-bold text-text-secondary">3. Encode</span>
          <span className={`font-black truncate w-full ${isEncodeGPU ? 'text-brand-lime' : 'text-white'}`}>{encodeResource}</span>
          <span className="text-[10px] text-text-secondary truncate w-full">{encodeDetails}</span>
        </div>
      </div>

      <p className="text-xs text-text-secondary leading-relaxed">
        {pathDesc}
      </p>
    </div>
  );
};

// ── Generic param control renderer ───────────────────────────────

interface ParamControlProps {
  param: CodecParam;
  value: string | number | boolean;
  onChange: (value: string | number | boolean) => void;
}

const ParamControl: React.FC<ParamControlProps> = ({ param, value, onChange }) => {
  const labelEl = (
    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block mb-1">
      {param.label}
      {param.hint && (
        <span className="ml-1 text-white/20 normal-case tracking-normal" title={param.hint}>ⓘ</span>
      )}
    </label>
  );

  if (param.type === 'select' && param.options) {
    return (
      <div>
        {labelEl}
        <select
          className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-sm outline-none"
          value={String(value)}
          onChange={e => onChange(e.target.value)}
        >
          {param.options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    );
  }

  if (param.type === 'number') {
    return (
      <div>
        {labelEl}
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={param.min}
            max={param.max}
            step={param.step}
            value={Number(value)}
            onChange={e => onChange(Number(e.target.value))}
            className="flex-1 accent-brand-orange h-1"
          />
          <input
            type="number"
            min={param.min}
            max={param.max}
            step={param.step}
            value={Number(value)}
            onChange={e => onChange(Number(e.target.value))}
            className="w-16 bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs text-center outline-none font-mono"
          />
        </div>
      </div>
    );
  }

  if (param.type === 'toggle') {
    return (
      <div className="flex items-center gap-3 col-span-2">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={e => onChange(e.target.checked)}
          className="w-4 h-4 accent-brand-orange"
        />
        <span className="text-sm">{param.label}</span>
      </div>
    );
  }

  // text
  return (
    <div>
      {labelEl}
      <input
        type="text"
        value={String(value)}
        onChange={e => onChange(e.target.value)}
        placeholder={param.hint}
        className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-sm outline-none"
      />
    </div>
  );
};

export default VideoCodecPanel;
