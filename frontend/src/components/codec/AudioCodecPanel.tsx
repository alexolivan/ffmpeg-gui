import React from 'react';
import type { CodecParam } from './codecRegistry';
import {
  getAvailableAudioCodecs,
  getDefaultParams,
  isParamVisible,
} from './codecRegistry';

interface AudioCodecPanelProps {
  codecId: string;
  params: Record<string, string | number | boolean>;
  buildOptions?: Record<string, boolean>;
  outputType?: string;
  onChange: (codecId: string, params: Record<string, string | number | boolean>) => void;
}

const AudioCodecPanel: React.FC<AudioCodecPanelProps> = ({
  codecId,
  params,
  buildOptions,
  outputType,
  onChange,
}) => {
  const available = React.useMemo(() => {
    return getAvailableAudioCodecs(buildOptions, outputType);
  }, [buildOptions, outputType]);
  const selected = available.find(c => c.id === codecId) || available[0];

  const handleCodecChange = (newCodecId: string) => {
    const codec = available.find(c => c.id === newCodecId);
    if (codec) {
      onChange(newCodecId, getDefaultParams(codec));
    }
  };

  const handleParamChange = (key: string, value: string | number | boolean) => {
    onChange(codecId, { ...params, [key]: value });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
        <h4 className="text-blue-400 font-bold text-xs uppercase tracking-wider">Audio Codec</h4>
      </div>

      <select
        className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none focus:border-blue-400 transition-all"
        value={selected.id}
        onChange={e => handleCodecChange(e.target.value)}
      >
        {available.map(c => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>

      {selected.params.length > 0 && (
        <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-white/5">
          {selected.params.map(param =>
            isParamVisible(param, params) ? (
              <AudioParamControl
                key={param.key}
                param={param}
                value={params[param.key] ?? param.default}
                onChange={v => handleParamChange(param.key, v)}
              />
            ) : null,
          )}
        </div>
      )}
    </div>
  );
};

// ── Generic param control renderer ───────────────────────────────

interface AudioParamControlProps {
  param: CodecParam;
  value: string | number | boolean;
  onChange: (value: string | number | boolean) => void;
}

const AudioParamControl: React.FC<AudioParamControlProps> = ({ param, value, onChange }) => {
  const labelEl = (
    <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block mb-0.5">
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
          className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
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
            className="flex-1 accent-blue-400 h-1"
          />
          <input
            type="number"
            min={param.min}
            max={param.max}
            step={param.step}
            value={Number(value)}
            onChange={e => onChange(Number(e.target.value))}
            className="w-12 bg-white/5 border border-white/10 rounded-lg p-1 text-[11px] text-center outline-none font-mono"
          />
        </div>
      </div>
    );
  }

  if (param.type === 'toggle') {
    return (
      <div className="flex items-center gap-2 col-span-2 py-0.5">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={e => onChange(e.target.checked)}
          className="w-3.5 h-3.5 accent-blue-400"
        />
        <span className="text-xs">{param.label}</span>
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
        className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none"
      />
    </div>
  );
};

export default React.memo(AudioCodecPanel);
