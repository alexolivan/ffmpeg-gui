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
  onChange: (codecId: string, params: Record<string, string | number | boolean>) => void;
}

const VideoCodecPanel: React.FC<VideoCodecPanelProps> = ({
  codecId,
  params,
  buildOptions,
  systemCapabilities,
  onChange,
}) => {
  const available = React.useMemo(() => {
    return getAvailableVideoCodecs(buildOptions, systemCapabilities);
  }, [buildOptions, systemCapabilities]);
  const selected = available.find(c => c.id === codecId) || available[0];

  // Auto-heal selected codec if the current one becomes unavailable
  useEffect(() => {
    if (available.length > 0 && !available.some(c => c.id === codecId)) {
      onChange(available[0].id, getDefaultParams(available[0]));
    }
  }, [available, codecId, onChange]);

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
    <div className="space-y-2">
      {/* Video Codec Selection */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-orange animate-pulse" />
          <h4 className="text-brand-orange font-bold text-xs uppercase tracking-wider">Video Codec (Output)</h4>
        </div>

        <select
          className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none focus:border-brand-orange transition-all font-medium"
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
        {codecId === 'v210' && (
          <span className="text-[9px] text-brand-lime block px-1">
            💡 Recommended for professional playout on modern DeckLink cards (10-bit YUV).
          </span>
        )}
        {codecId === 'rawvideo' && (
          <span className="text-[9px] text-brand-orange block px-1">
            ⚠️ Legacy 8-bit format. Recommended only for older DeckLink cards (like the original Intensity Pro).
          </span>
        )}
        {codecId === 'wrapped_avframe' && (
          <span className="text-[9px] text-brand-lime block px-1">
            💡 Required for professional live playout over NDI networks.
          </span>
        )}

        {/* VA-API Hardware Incompatibility Warnings */}
        {selected?.category === 'hw_vaapi' && systemCapabilities?.vaapi?.available && systemCapabilities.vaapi.vainfo_installed === false && (
          <div className="mt-2 p-2 bg-brand-orange/10 border border-brand-orange/20 rounded-lg text-[10px] text-brand-orange/90 leading-normal">
            <strong>⚠️ Diagnóstico VA-API limitado:</strong> El comando <code className="text-white bg-white/10 px-1 rounded font-mono text-[9px]">vainfo</code> no está instalado en el servidor. Instálalo (<code className="text-white bg-white/10 px-1 rounded font-mono text-[9px]">apt install vainfo</code>) para validar si tu GPU soporta este códec.
          </div>
        )}

        {codecId === 'hevc_vaapi' && systemCapabilities?.vaapi?.vainfo_installed && systemCapabilities.vaapi.encoders && !systemCapabilities.vaapi.encoders.includes('hevc') && (
          <div className="mt-2 p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-[10px] text-red-400 leading-normal space-y-1">
            <strong>❌ Hardware no compatible detectado:</strong>
            <p>Tu tarjeta gráfica <strong>no soporta codificación HEVC por hardware</strong> vía VA-API (verificado mediante <code className="text-white bg-white/10 px-1 rounded font-mono text-[9px]">vainfo</code>).</p>
            <p>El proceso fallará al arrancar. Selecciona <strong>H.264 — VAAPI</strong> o un códec por software.</p>
          </div>
        )}

        {codecId === 'h264_vaapi' && systemCapabilities?.vaapi?.vainfo_installed && systemCapabilities.vaapi.encoders && !systemCapabilities.vaapi.encoders.includes('h264') && (
          <div className="mt-2 p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-[10px] text-red-400 leading-normal space-y-1">
            <strong>❌ Hardware no compatible detectado:</strong>
            <p>Tu tarjeta gráfica <strong>no soporta codificación H.264 por hardware</strong> vía VA-API (verificado mediante <code className="text-white bg-white/10 px-1 rounded font-mono text-[9px]">vainfo</code>).</p>
            <p>El proceso fallará al arrancar. Selecciona un códec por software.</p>
          </div>
        )}

        {codecId === 'vp8_vaapi' && systemCapabilities?.vaapi?.vainfo_installed && systemCapabilities.vaapi.encoders && !systemCapabilities.vaapi.encoders.includes('vp8') && (
          <div className="mt-2 p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-[10px] text-red-400 leading-normal space-y-1">
            <strong>❌ Hardware no compatible detectado:</strong>
            <p>Tu tarjeta gráfica <strong>no soporta codificación VP8 por hardware</strong> vía VA-API (verificado mediante <code className="text-white bg-white/10 px-1 rounded font-mono text-[9px]">vainfo</code>).</p>
            <p>El proceso fallará al arrancar. Selecciona un códec por software.</p>
          </div>
        )}

        {codecId === 'vp9_vaapi' && systemCapabilities?.vaapi?.vainfo_installed && systemCapabilities.vaapi.encoders && !systemCapabilities.vaapi.encoders.includes('vp9') && (
          <div className="mt-2 p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-[10px] text-red-400 leading-normal space-y-1">
            <strong>❌ Hardware no compatible detectado:</strong>
            <p>Tu tarjeta gráfica <strong>no soporta codificación VP9 por hardware</strong> vía VA-API (verificado mediante <code className="text-white bg-white/10 px-1 rounded font-mono text-[9px]">vainfo</code>).</p>
            <p>El proceso fallará al arrancar. Selecciona un códec por software.</p>
          </div>
        )}
      </div>

      {/* Codec Parameters */}
      {selected?.params && selected.params.length > 0 && (
        <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-white/5">
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
            className="flex-1 accent-brand-orange h-1"
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
          className="w-3.5 h-3.5 accent-brand-orange"
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

export default React.memo(VideoCodecPanel);
