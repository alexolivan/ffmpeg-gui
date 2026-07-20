import React, { useState, useEffect } from 'react';
import { OverlayCanvasPreview } from './OverlayCanvasPreview';
import {
  generateAnchorExpressions,
  parseAnchorFromExpressions,
  type AnchorPreset,
} from '../../utils/overlayPositionHelper';

export interface OverlayItem {
  id: string; // client-side unique id
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

export const LAYER_COLOR_PRESETS = [
  { name: 'Cyan', hex: '#22d3ee' },
  { name: 'Lime', hex: '#a3e635' },
  { name: 'Yellow', hex: '#facc15' },
  { name: 'Pink', hex: '#ec4899' },
  { name: 'Purple', hex: '#a855f7' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Red', hex: '#ef4444' },
  { name: 'Blue', hex: '#3b82f6' },
];

interface FiltersFormSectionProps {
  hasVideo: boolean;
  hasAudio: boolean;
  scale: string;
  framerate: string;
  deinterlace: boolean;
  
  // Audio fields
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

  // Overlays
  overlays: OverlayItem[];

  onChange: (updates: any) => void;

  // Hardware capabilities validation
  hwaccel?: string;
  isVram?: boolean;
  systemCapabilities?: any;

  // Codec constraint tracking
  videoCodecId?: string;
  audioCodecId?: string;
  storages?: any[];
}

const ANCHOR_GRID_PRESETS: { id: AnchorPreset; symbol: string; label: string }[] = [
  { id: 'top-left', symbol: '↖', label: 'Top Left' },
  { id: 'top-center', symbol: '↑', label: 'Top Center' },
  { id: 'top-right', symbol: '↗', label: 'Top Right' },
  { id: 'center-left', symbol: '←', label: 'Center Left' },
  { id: 'center', symbol: '┼', label: 'Center' },
  { id: 'center-right', symbol: '→', label: 'Center Right' },
  { id: 'bottom-left', symbol: '↙', label: 'Bottom Left' },
  { id: 'bottom-center', symbol: '↓', label: 'Bottom Center' },
  { id: 'bottom-right', symbol: '↘', label: 'Bottom Right' },
];

export const FiltersFormSection: React.FC<FiltersFormSectionProps> = ({
  hasVideo,
  hasAudio,
  scale,
  framerate,
  deinterlace,
  highpass = '',
  lowpass = '',
  equalizer = { enabled: false, bands: { '31.5': 0, '63': 0, '125': 0, '250': 0, '500': 0, '1000': 0, '2000': 0, '4000': 0, '8000': 0, '16000': 0 } },
  compressor = { enabled: false, attack: 0.3, release: 0.3, gate: -60, gate_ratio: 4, threshold: -30, ratio: 4, gain: 0 },
  limiter = { enabled: false, ceiling: -0.1, release: 50 },
  volume = '',
  aresample = { enabled: false, mode: 'basic', osr: '', min_comp: 0.01, min_hard_comp: 0.1 },
  overlays = [],
  onChange,
  hwaccel = 'none',
  isVram = false,
  systemCapabilities = null,
  videoCodecId,
  audioCodecId,
  storages = [],
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'video' | 'audio' | 'overlays'>(hasVideo ? 'video' : 'audio');
  const [customModes, setCustomModes] = useState<Record<string, boolean>>({});
  const [expandedOverlayId, setExpandedOverlayId] = useState<string | null>('');

  useEffect(() => {
    if (!hasVideo && (activeSubTab === 'video' || activeSubTab === 'overlays')) {
      setActiveSubTab('audio');
    } else if (!hasAudio && activeSubTab === 'audio') {
      setActiveSubTab('video');
    }
  }, [hasVideo, hasAudio, activeSubTab]);

  const isVideoCopy = videoCodecId === 'copy';
  const isAudioCopy = audioCodecId === 'copy';

  if (!hasVideo && !hasAudio) {
    return (
      <div className="text-center py-12 text-text-secondary text-sm italic">
        Filters are only available when video or audio streams are enabled.
      </div>
    );
  }

  // Ensure default bands are present (10-Band ISO)
  const defaultBands: Record<string, number> = {
    '31.5': 0, '63': 0, '125': 0, '250': 0, '500': 0,
    '1000': 0, '2000': 0, '4000': 0, '8000': 0, '16000': 0
  };
  const bandsObj: Record<string, number> = { ...defaultBands, ...(equalizer.bands || {}) };

  const isoBands = ["31.5", "63", "125", "250", "500", "1000", "2000", "4000", "8000", "16000"];

  const updateEqBand = (band: string, val: number) => {
    onChange({
      equalizer: {
        ...equalizer,
        bands: {
          ...bandsObj,
          [band]: val,
        }
      }
    });
  };

  const getEqCurvePath = () => {
    const width = 450;
    const height = 80;
    const points: string[] = [];
    
    // Sample 90 points across 20Hz-20kHz logarithmically
    for (let i = 0; i <= 90; i++) {
      const f = 20 * Math.pow(1000, i / 90);
      let totalGain = 0;
      
      isoBands.forEach(bandFreq => {
        const fc = parseFloat(bandFreq);
        const gain = bandsObj[bandFreq] ?? 0;
        if (gain !== 0) {
          const logRatio = Math.log10(f / fc);
          const sigma = 0.35; // 1-octave band standard approximation
          const response = gain * Math.exp(-Math.pow(logRatio, 2) / (2 * Math.pow(sigma, 2)));
          totalGain += response;
        }
      });
      
      // Map totalGain (-12dB to +12dB) to Y coordinate (height - Y)
      const y = (height / 2) - (totalGain * 35 / 12);
      const x = (i / 90) * width;
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return `M ${points.join(' L ')}`;
  };

  const applyPreset = (presetName: string) => {
    const newBands: Record<string, number> = {};
    isoBands.forEach(b => { newBands[b] = 0; });
    
    if (presetName === 'vocal') {
      newBands['31.5'] = -8;
      newBands['63'] = -4;
      newBands['125'] = -1;
      newBands['250'] = 0;
      newBands['500'] = 0;
      newBands['1000'] = 1;
      newBands['2000'] = 3;
      newBands['4000'] = 4;
      newBands['8000'] = 2;
      newBands['16000'] = 0;
    } else if (presetName === 'bass') {
      newBands['31.5'] = 6;
      newBands['63'] = 5;
      newBands['125'] = 3;
      newBands['250'] = 1;
    } else if (presetName === 'treble') {
      newBands['2000'] = 1;
      newBands['4000'] = 3;
      newBands['8000'] = 5;
      newBands['16000'] = 6;
    } else if (presetName === 'radio') {
      newBands['31.5'] = -12;
      newBands['63'] = -10;
      newBands['125'] = -6;
      newBands['250'] = 1;
      newBands['500'] = 4;
      newBands['1000'] = 5;
      newBands['2000'] = 3;
      newBands['4000'] = -2;
      newBands['8000'] = -8;
      newBands['16000'] = -12;
    }
    onChange({ equalizer: { ...equalizer, bands: newBands } });
  };

  const resetEq = () => {
    const flatBands: Record<string, number> = {};
    isoBands.forEach(b => { flatBands[b] = 0; });
    onChange({ equalizer: { ...equalizer, bands: flatBands } });
  };

  const getCompandOutputY = (xDb: number) => {
    let yDb = xDb;
    const gateVal = compressor?.gate ?? -60;
    const gateRatioVal = compressor?.gate_ratio ?? 4;
    const threshVal = compressor?.threshold ?? -30;
    const ratioVal = compressor?.ratio ?? 4;
    const gainVal = compressor?.gain ?? 0;
    
    if (xDb < gateVal) {
      yDb = gateVal + (xDb - gateVal) * gateRatioVal;
    } else if (xDb > threshVal) {
      yDb = threshVal + (xDb - threshVal) / ratioVal;
    } else {
      yDb = xDb;
    }
    
    return Math.min(0, yDb + gainVal);
  };

  const getCompandCurvePath = () => {
    const points: string[] = [];
    for (let db = -100; db <= 0; db += 2) {
      const out = getCompandOutputY(db);
      const x = 100 + db; // maps -100..0 to 0..100
      const y = -out; // maps -100..0 to 0..100
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return `M ${points.join(' L ')}`;
  };

  const parseVolumeToDb = (volStr: string): number => {
    if (!volStr) return 0;
    const clean = volStr.toLowerCase().replace('volume=', '').trim();
    if (clean.endsWith('db')) {
      return parseFloat(clean.replace('db', '')) || 0;
    }
    const factor = parseFloat(clean);
    if (!isNaN(factor) && factor > 0) {
      return Math.round(20 * Math.log10(factor) * 10) / 10;
    }
    return 0;
  };

  const applyCompPreset = (presetName: string) => {
    if (presetName === 'vocal') {
      onChange({
        compressor: {
          enabled: true,
          attack: 0.1,
          release: 0.3,
          gate: -50,
          gate_ratio: 3,
          threshold: -24,
          ratio: 3,
          gain: 4
        }
      });
    } else if (presetName === 'broadcast') {
      onChange({
        compressor: {
          enabled: true,
          attack: 0.05,
          release: 0.3,
          gate: -55,
          gate_ratio: 4,
          threshold: -18,
          ratio: 5,
          gain: 8
        }
      });
    } else if (presetName === 'gate_only') {
      onChange({
        compressor: {
          enabled: true,
          attack: 0.01,
          release: 0.1,
          gate: -45,
          gate_ratio: 8,
          threshold: 0,
          ratio: 1,
          gain: 0
        }
      });
    } else if (presetName === 'limiter') {
      onChange({
        compressor: {
          enabled: true,
          attack: 0.01,
          release: 0.1,
          gate: -60,
          gate_ratio: 1,
          threshold: -3,
          ratio: 20,
          gain: 0
        }
      });
    } else if (presetName === 'flat') {
      onChange({
        compressor: {
          enabled: true,
          attack: 0.3,
          release: 0.3,
          gate: -60,
          gate_ratio: 1,
          threshold: 0,
          ratio: 1,
          gain: 0
        }
      });
    }
  };

  // Overlay management
  const addOverlay = (type: 'text' | 'image') => {
    const defaultPos = generateAnchorExpressions('top-left', 10, 10);
    const defaultColor = LAYER_COLOR_PRESETS[overlays.length % LAYER_COLOR_PRESETS.length].hex;
    const newItem: OverlayItem = {
      id: Math.random().toString(36).substr(2, 9),
      type,
      color: defaultColor,
      x: defaultPos.x,
      y: defaultPos.y,
      order: overlays.length,
      ...(type === 'text'
        ? { text: 'LIVE BROADCAST', fontsize: '24', fontcolor: '#ffffff', box: false, boxcolor: 'black@0.6', boxborderw: '5' }
        : { relative_path: '' })
    };
    onChange({ overlays: [...overlays, newItem] });
  };

  const removeOverlay = (index: number) => {
    const nextList = overlays.filter((_, i) => i !== index).map((o, idx) => ({ ...o, order: idx }));
    onChange({ overlays: nextList });
  };

  const updateOverlayItem = (index: number, patch: Partial<OverlayItem>) => {
    const nextList = overlays.map((o, i) => i === index ? { ...o, ...patch } : o);
    onChange({ overlays: nextList });
  };

  const moveOverlay = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === overlays.length - 1) return;
    
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    const nextList = [...overlays];
    
    // Swap
    const temp = nextList[index];
    nextList[index] = nextList[targetIdx];
    nextList[targetIdx] = temp;
    
    // Re-assign order properties
    const orderedList = nextList.map((o, idx) => ({ ...o, order: idx }));
    onChange({ overlays: orderedList });
  };

  return (
    <div className="space-y-2 animate-in fade-in duration-300">
      {/* Sub-tabs header */}
      <div className="flex gap-1.5 border-b border-white/5 pb-1.5">
        {hasVideo && (
          <button
            type="button"
            onClick={() => setActiveSubTab('video')}
            className={`px-2 py-1 rounded text-[11px] font-black uppercase tracking-wider transition-all ${
              activeSubTab === 'video' ? 'bg-brand-lime text-black' : 'text-text-secondary hover:bg-white/5 hover:text-white'
            }`}
          >
            Video Settings
          </button>
        )}
        {hasAudio && (
          <button
            type="button"
            onClick={() => setActiveSubTab('audio')}
            className={`px-2 py-1 rounded text-[11px] font-black uppercase tracking-wider transition-all ${
              activeSubTab === 'audio' ? 'bg-brand-lime text-black' : 'text-text-secondary hover:bg-white/5 hover:text-white'
            }`}
          >
            Audio Settings
          </button>
        )}
        {hasVideo && (
          <button
            type="button"
            onClick={() => setActiveSubTab('overlays')}
            className={`px-2 py-1 rounded text-[11px] font-black uppercase tracking-wider transition-all ${
              activeSubTab === 'overlays' ? 'bg-brand-lime text-black' : 'text-text-secondary hover:bg-white/5 hover:text-white'
            }`}
          >
            Overlays ({overlays.length})
          </button>
        )}
      </div>

      {/* SUB-TAB: Video Settings */}
      {activeSubTab === 'video' && hasVideo && (
        <div className="glass-card p-2.5 !rounded-lg space-y-2">
          {isVideoCopy && (
            <div className="bg-brand-orange/10 border border-brand-orange/20 text-brand-orange text-[10px] p-2 rounded-lg leading-snug font-bold">
              ⚠️ Video codec is set to 'copy'. Video filters and scaling are disabled because the stream is copied directly without re-encoding.
            </div>
          )}

          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-lime" />
            <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider">Video Filters</h4>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block mb-0.5">Scale / Resize</label>
              <input
                type="text"
                placeholder="e.g. 1920:1080 or -1:720"
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono disabled:opacity-35 disabled:cursor-not-allowed"
                value={scale}
                onChange={e => onChange({ scale: e.target.value })}
                disabled={isVideoCopy}
              />
            </div>
            <div>
              <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block mb-0.5">Framerate Convert</label>
              <input
                type="text"
                placeholder="e.g. 25, 29.97, 50"
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono disabled:opacity-35 disabled:cursor-not-allowed"
                value={framerate}
                onChange={e => onChange({ framerate: e.target.value })}
                disabled={isVideoCopy}
              />
            </div>
            <div className="col-span-2 flex items-center gap-2 p-1.5 bg-white/5 rounded-lg border border-white/5">
              <input
                type="checkbox" id="deinterlace-chk"
                className="w-3.5 h-3.5 accent-brand-lime cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                checked={deinterlace}
                onChange={e => onChange({ deinterlace: e.target.checked })}
                disabled={isVideoCopy}
              />
              <label htmlFor="deinterlace-chk" className={`text-xs font-semibold cursor-pointer select-none ${isVideoCopy ? 'opacity-35 cursor-not-allowed' : ''}`}>
                Enable Deinterlacing (YADIF / QSV VPP / CUDA yadif)
              </label>
            </div>
            {deinterlace && isVram && hwaccel === 'cuda' && systemCapabilities?.ffmpeg?.filters && !systemCapabilities.ffmpeg.filters.includes('yadif_cuda') && (
              <div className="col-span-2 bg-brand-orange/10 border border-brand-orange/20 text-brand-orange text-[10px] p-2 rounded-lg leading-snug font-bold">
                ⚠️ El binario activo de FFmpeg no soporta el filtro de hardware 'yadif_cuda'.
                Se recomienda cambiar el formato de salida a 'System Memory (CPU RAM)' en la pestaña Source, o recompilar con soporte CUDA Filters.
              </div>
            )}
            {deinterlace && isVram && hwaccel === 'vaapi' && systemCapabilities?.ffmpeg?.filters && !systemCapabilities.ffmpeg.filters.includes('deinterlace_vaapi') && (
              <div className="col-span-2 bg-brand-orange/10 border border-brand-orange/20 text-brand-orange text-[10px] p-2 rounded-lg leading-snug font-bold">
                ⚠️ El binario activo de FFmpeg no soporta el filtro de hardware 'deinterlace_vaapi'.
                Se recomienda cambiar el formato de salida a 'System Memory (CPU RAM)' en la pestaña Source.
              </div>
            )}
            {deinterlace && isVram && hwaccel === 'qsv' && systemCapabilities?.ffmpeg?.filters && !systemCapabilities.ffmpeg.filters.includes('vpp_qsv') && (
              <div className="col-span-2 bg-brand-orange/10 border border-brand-orange/20 text-brand-orange text-[10px] p-2 rounded-lg leading-snug font-bold">
                ⚠️ El binario activo de FFmpeg no soporta el filtro de hardware 'vpp_qsv'.
                Se recomienda cambiar el formato de salida a 'System Memory (CPU RAM)' en la pestaña Source.
              </div>
            )}
            
            {/* Audio / Video Sync (aresample) - Conditional on hasAudio */}
            {hasAudio && (
              <div className="col-span-2 border-t border-white/5 pt-2 mt-1 space-y-2">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-lime" />
                  <h5 className="text-[10px] uppercase font-bold text-text-secondary tracking-wider">
                    Audio / Video Sync
                  </h5>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block mb-0.5">
                      Sync Mode
                    </label>
                    <select
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono text-white disabled:opacity-35 disabled:cursor-not-allowed"
                      value={!aresample?.enabled ? 'off' : aresample?.mode || 'basic'}
                      onChange={e => {
                        const val = e.target.value;
                        if (val === 'off') {
                          onChange({ aresample: { enabled: false, mode: 'basic', osr: '', min_comp: 0.01, min_hard_comp: 0.1 } });
                        } else if (val === 'basic') {
                          onChange({ aresample: { enabled: true, mode: 'basic', osr: '', min_comp: 0.01, min_hard_comp: 0.1 } });
                        } else {
                          onChange({ aresample: { enabled: true, mode: 'advanced', osr: aresample?.osr || '', min_comp: aresample?.min_comp ?? 0.01, min_hard_comp: aresample?.min_hard_comp ?? 0.1 } });
                        }
                      }}
                      disabled={isAudioCopy}
                    >
                      <option value="off">Off (Disabled)</option>
                      <option value="basic">Basic Sync (async=1)</option>
                      <option value="advanced">Advanced Sync Configuration</option>
                    </select>
                  </div>
                  {aresample?.enabled && aresample?.mode === 'advanced' && (
                    <div className="col-span-2 grid grid-cols-3 gap-2 bg-white/5 p-2 rounded-lg border border-white/5 mt-1">
                      <div>
                        <label className="text-[8px] uppercase font-bold text-text-secondary block mb-0.5">
                          Sample Rate (osr)
                        </label>
                        <select
                          className="w-full bg-black/40 border border-white/10 rounded-lg p-1 text-[10px] outline-none text-white"
                          value={aresample?.osr || ''}
                          onChange={e => onChange({ aresample: { ...aresample, osr: e.target.value } })}
                        >
                          <option value="">Keep Original</option>
                          <option value="48000">48000 Hz</option>
                          <option value="44100">44100 Hz</option>
                          <option value="32000">32000 Hz</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[8px] uppercase font-bold text-text-secondary block mb-0.5">
                          Min Sync (sec)
                        </label>
                        <input
                          type="number"
                          step="0.001"
                          className="w-full bg-black/40 border border-white/10 rounded-lg p-1 text-[10px] outline-none text-white font-mono"
                          value={aresample?.min_comp ?? 0.01}
                          onChange={e => onChange({ aresample: { ...aresample, min_comp: Number(e.target.value) } })}
                        />
                      </div>
                      <div>
                        <label className="text-[8px] uppercase font-bold text-text-secondary block mb-0.5">
                          Hard Sync (sec)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          className="w-full bg-black/40 border border-white/10 rounded-lg p-1 text-[10px] outline-none text-white font-mono"
                          value={aresample?.min_hard_comp ?? 0.1}
                          onChange={e => onChange({ aresample: { ...aresample, min_hard_comp: Number(e.target.value) } })}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB: Audio Settings */}
      {activeSubTab === 'audio' && hasAudio && (
        <div className="glass-card p-2.5 !rounded-lg space-y-2">
          {isAudioCopy && (
            <div className="bg-brand-orange/10 border border-brand-orange/20 text-brand-orange text-[10px] p-2 rounded-lg leading-snug font-bold">
              ⚠️ Audio codec is set to 'copy'. Audio filters and DSP settings are disabled because the stream is copied directly without re-encoding.
            </div>
          )}

          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-lime" />
            <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider">Audio DSP & Levels</h4>
          </div>

          {/* Card 1: Input Level & Clean Filters */}
          <div className="glass-card p-3 rounded-lg border border-white/5 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-lime" />
                <h5 className="text-[10px] uppercase font-bold text-text-secondary tracking-wider">
                  Input Level & Clean Filters
                </h5>
              </div>
              {(volume !== '' || highpass !== '' || lowpass !== '') && (
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-brand-lime/10 text-brand-lime">ACTIVE</span>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Volume Slider */}
              <div className="bg-white/5 p-2 rounded-lg border border-white/5 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <input
                    type="checkbox" id="vol-enable-chk"
                    className="w-3.5 h-3.5 accent-brand-lime cursor-pointer disabled:opacity-35"
                    checked={volume !== ''}
                    onChange={e => onChange({ volume: e.target.checked ? '0dB' : '' })}
                    disabled={isAudioCopy}
                  />
                  <label htmlFor="vol-enable-chk" className="text-[9px] uppercase font-bold text-text-secondary cursor-pointer select-none">
                    Input Gain{volume !== '' ? `: ${parseVolumeToDb(volume) > 0 ? `+${parseVolumeToDb(volume)}` : parseVolumeToDb(volume)} dB` : ''}
                  </label>
                </div>
                <input
                  type="range" min="-20" max="20" step="0.5"
                  className="w-full h-1.5 bg-white/10 accent-brand-lime rounded-lg outline-none appearance-none cursor-pointer disabled:opacity-35"
                  value={volume !== '' ? parseVolumeToDb(volume) : 0}
                  onChange={e => onChange({ volume: `${e.target.value}dB` })}
                  disabled={isAudioCopy || volume === ''}
                />
              </div>

              {/* Highpass Slider */}
              <div className="bg-white/5 p-2 rounded-lg border border-white/5 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <input
                    type="checkbox" id="hp-enable-chk"
                    className="w-3.5 h-3.5 accent-brand-lime cursor-pointer disabled:opacity-35"
                    checked={highpass !== ''}
                    onChange={e => onChange({ highpass: e.target.checked ? '80' : '' })}
                    disabled={isAudioCopy}
                  />
                  <label htmlFor="hp-enable-chk" className="text-[9px] uppercase font-bold text-text-secondary cursor-pointer select-none">
                    Highpass{highpass !== '' ? `: ${highpass} Hz` : ''}
                  </label>
                </div>
                <input
                  type="range" min="20" max="500" step="5"
                  className="w-full h-1.5 bg-white/10 accent-brand-lime rounded-lg outline-none appearance-none cursor-pointer disabled:opacity-35"
                  value={highpass !== '' ? parseInt(highpass) : 80}
                  onChange={e => onChange({ highpass: e.target.value })}
                  disabled={isAudioCopy || highpass === ''}
                />
              </div>

              {/* Lowpass Slider */}
              <div className="bg-white/5 p-2 rounded-lg border border-white/5 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <input
                    type="checkbox" id="lp-enable-chk"
                    className="w-3.5 h-3.5 accent-brand-lime cursor-pointer disabled:opacity-35"
                    checked={lowpass !== ''}
                    onChange={e => onChange({ lowpass: e.target.checked ? '12000' : '' })}
                    disabled={isAudioCopy}
                  />
                  <label htmlFor="lp-enable-chk" className="text-[9px] uppercase font-bold text-text-secondary cursor-pointer select-none">
                    Lowpass{lowpass !== '' ? `: ${parseInt(lowpass) >= 1000 ? `${parseInt(lowpass)/1000}k` : lowpass} Hz` : ''}
                  </label>
                </div>
                <input
                  type="range" min="1000" max="20000" step="100"
                  className="w-full h-1.5 bg-white/10 accent-brand-lime rounded-lg outline-none appearance-none cursor-pointer disabled:opacity-35"
                  value={lowpass !== '' ? parseInt(lowpass) : 12000}
                  onChange={e => onChange({ lowpass: e.target.value })}
                  disabled={isAudioCopy || lowpass === ''}
                />
              </div>
            </div>
          </div>

          {/* Card 2: 10-Band Graphic Equalizer */}
          <div className="glass-card p-3 rounded-lg border border-white/5 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <input
                  type="checkbox" id="eq-chk"
                  className="w-3.5 h-3.5 accent-brand-lime cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                  checked={equalizer.enabled || false}
                  onChange={e => onChange({ equalizer: { ...equalizer, enabled: e.target.checked } })}
                  disabled={isAudioCopy}
                />
                <label htmlFor="eq-chk" className={`text-[11px] font-bold uppercase tracking-wider text-text-secondary select-none cursor-pointer ${isAudioCopy ? 'opacity-35 cursor-not-allowed' : ''}`}>
                  10-Band ISO Graphic Equalizer
                </label>
              </div>
              {equalizer.enabled && (
                <div className="flex items-center gap-2">
                  <select
                    className="bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[9px] outline-none text-white font-semibold cursor-pointer"
                    onChange={e => applyPreset(e.target.value)}
                    defaultValue=""
                  >
                    <option value="" disabled>Presets...</option>
                    <option value="flat">Flat (0dB)</option>
                    <option value="vocal">Vocal Clarity</option>
                    <option value="bass">Bass Boost</option>
                    <option value="treble">Treble Boost</option>
                    <option value="radio">Radio AM</option>
                  </select>
                  <button
                    type="button"
                    onClick={resetEq}
                    className="bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded px-1.5 py-0.5 text-[9px] font-semibold"
                  >
                    Reset (Flat)
                  </button>
                  <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-brand-lime/10 text-brand-lime">ACTIVE</span>
                </div>
              )}
            </div>

            {equalizer.enabled && (
              <div className="space-y-3 p-2 bg-white/5 rounded-lg border border-white/5">
                {/* EQ Curve Display */}
                <div className="relative h-20 bg-black/40 rounded border border-white/5 overflow-hidden">
                  <svg viewBox="0 0 450 80" className="w-full h-full" preserveAspectRatio="none">
                    {/* Grid Lines */}
                    <line x1="0" y1="40" x2="450" y2="40" stroke="rgba(255,255,255,0.1)" strokeWidth="1" strokeDasharray="3,3" />
                    <line x1="112.5" y1="0" x2="112.5" y2="80" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                    <line x1="225" y1="0" x2="225" y2="80" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                    <line x1="337.5" y1="0" x2="337.5" y2="80" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                    
                    {/* Curve Line */}
                    <path d={getEqCurvePath()} fill="none" stroke="#a3e635" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <div className="absolute top-0.5 left-1 text-[7px] text-white/30 uppercase font-mono">20Hz</div>
                  <div className="absolute top-0.5 right-1 text-[7px] text-white/30 uppercase font-mono">20kHz</div>
                  <div className="absolute top-1/2 -translate-y-1/2 right-1 text-[7px] text-white/30 font-mono">0dB</div>
                </div>

                {/* EQ Sliders Grid */}
                <div className="grid grid-cols-10 gap-1.5">
                  {isoBands.map(band => {
                    const label = parseFloat(band) >= 1000 ? `${parseFloat(band) / 1000}k` : band;
                    return (
                      <div key={band} className="flex flex-col items-center gap-1 font-mono">
                        <span className="text-[7.5px] text-text-secondary">{label}</span>
                        <input
                          type="range"
                          min="-12"
                          max="12"
                          step="0.5"
                          className="h-16 w-1 bg-white/10 accent-brand-lime rounded-lg outline-none appearance-none cursor-ns-resize disabled:opacity-35 disabled:cursor-not-allowed"
                          style={{ writingMode: 'bt-lr', WebkitAppearance: 'slider-vertical' } as any}
                          value={bandsObj[band] ?? 0}
                          onChange={e => updateEqBand(band, Number(e.target.value))}
                          disabled={isAudioCopy}
                        />
                        <span className={`text-[8px] font-bold ${bandsObj[band] > 0 ? 'text-brand-lime' : bandsObj[band] < 0 ? 'text-brand-orange' : 'text-text-secondary'} ${isAudioCopy ? 'opacity-35' : ''}`}>
                          {bandsObj[band] > 0 ? `+${bandsObj[band]}` : bandsObj[band]}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Card 3: Dynamics Compressor / Expander */}
          <div className="glass-card p-3 rounded-lg border border-white/5 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <input
                  type="checkbox" id="compressor-chk"
                  className="w-3.5 h-3.5 accent-brand-lime cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                  checked={compressor?.enabled || false}
                  onChange={e => onChange({ compressor: { ...compressor, enabled: e.target.checked } })}
                  disabled={isAudioCopy}
                />
                <label htmlFor="compressor-chk" className={`text-[11px] font-bold uppercase tracking-wider text-text-secondary select-none cursor-pointer ${isAudioCopy ? 'opacity-35 cursor-not-allowed' : ''}`}>
                  Dynamics Compressor & Noise Gate (Compand)
                </label>
              </div>
              {compressor?.enabled && (
                <div className="flex items-center gap-2">
                  <select
                    className="bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[9px] outline-none text-white font-semibold cursor-pointer"
                    onChange={e => applyCompPreset(e.target.value)}
                    defaultValue=""
                  >
                    <option value="" disabled>Presets...</option>
                    <option value="flat">Bypass / Flat</option>
                    <option value="vocal">Vocal / Speech</option>
                    <option value="broadcast">Radio Broadcast</option>
                    <option value="gate_only">Noise Gate Only</option>
                    <option value="limiter">Peak Limiting</option>
                  </select>
                  <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-brand-lime/10 text-brand-lime">ACTIVE</span>
                </div>
              )}
            </div>

            {compressor?.enabled && (
              <div className="flex flex-col md:flex-row gap-3 p-2 bg-white/5 rounded-lg border border-white/5">
                {/* SVG Curve Plot */}
                <div className="w-full md:w-1/3 flex flex-col justify-between">
                  <div className="relative aspect-square w-full bg-black/40 rounded border border-white/5 overflow-hidden">
                    <svg viewBox="0 0 100 100" className="w-full h-full" preserveAspectRatio="none">
                      {/* Grid Lines every 25 dB */}
                      <line x1="25" y1="0" x2="25" y2="100" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                      <line x1="50" y1="0" x2="50" y2="100" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                      <line x1="75" y1="0" x2="75" y2="100" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                      <line x1="0" y1="25" x2="100" y2="25" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                      <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                      <line x1="0" y1="75" x2="100" y2="75" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />

                      {/* Translucent colored areas (VU meter style) */}
                      {/* Gate (Red/Orange): below gate */}
                      <rect x="0" y="0" width={100 + (compressor.gate ?? -60)} height="100" fill="rgba(239, 68, 68, 0.08)" />
                      {/* Linear (Green): between gate and threshold */}
                      <rect x={100 + (compressor.gate ?? -60)} y="0" width={(compressor.threshold ?? -30) - (compressor.gate ?? -60)} height="100" fill="rgba(163, 230, 53, 0.08)" />
                      {/* Compression (Yellow/Amber): above threshold */}
                      <rect x={100 + (compressor.threshold ?? -30)} y="0" width={-(compressor.threshold ?? -30)} height="100" fill="rgba(234, 179, 8, 0.08)" />

                      {/* Bypass Line (y = x) */}
                      <line x1="0" y1="100" x2="100" y2="0" stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="2,2" />

                      {/* Dynamic Curve Line */}
                      <path d={getCompandCurvePath()} fill="none" stroke="#a3e635" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    
                    {/* Corner text labels */}
                    <div className="absolute bottom-0.5 left-1 text-[6.5px] text-white/30 font-mono">-100dB</div>
                    <div className="absolute bottom-0.5 right-1 text-[6.5px] text-white/30 font-mono">0dB (In)</div>
                    <div className="absolute top-0.5 left-1 text-[6.5px] text-white/30 font-mono">0dB (Out)</div>
                  </div>
                  <div className="text-[7.5px] text-text-secondary mt-1 font-mono leading-tight">
                    <span className="inline-block w-2.5 h-2.5 rounded bg-red-500/20 border border-red-500/40 mr-1 align-middle" />
                    Gate / Expander (Atn)
                    <br />
                    <span className="inline-block w-2.5 h-2.5 rounded bg-lime-500/20 border border-lime-500/40 mr-1 align-middle" />
                    Bypass / Linear
                    <br />
                    <span className="inline-block w-2.5 h-2.5 rounded bg-yellow-500/20 border border-yellow-500/40 mr-1 align-middle" />
                    Gain Compression
                  </div>
                </div>

                {/* Parameters Controls */}
                <div className="flex-1 grid grid-cols-2 gap-2 text-xs">
                  {/* Gate settings */}
                  <div className="bg-black/20 p-1.5 rounded border border-white/5 space-y-1">
                    <div className="text-[9px] uppercase font-bold text-red-400">Noise Gate</div>
                    <div>
                      <div className="flex justify-between text-[9px] font-mono text-text-secondary">
                        <span>Threshold</span>
                        <span>{compressor.gate ?? -60} dB</span>
                      </div>
                      <input
                        type="range" min="-100" max="-40" step="1"
                        className="w-full h-1 bg-white/10 accent-red-400 rounded-lg outline-none appearance-none cursor-pointer"
                        value={compressor.gate ?? -60}
                        onChange={e => onChange({ compressor: { ...compressor, gate: Number(e.target.value) } })}
                        disabled={isAudioCopy}
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-[9px] font-mono text-text-secondary">
                        <span>Ratio (Expansion)</span>
                        <span>1:{compressor.gate_ratio ?? 4}</span>
                      </div>
                      <input
                        type="range" min="1" max="8" step="0.5"
                        className="w-full h-1 bg-white/10 accent-red-400 rounded-lg outline-none appearance-none cursor-pointer"
                        value={compressor.gate_ratio ?? 4}
                        onChange={e => onChange({ compressor: { ...compressor, gate_ratio: Number(e.target.value) } })}
                        disabled={isAudioCopy}
                      />
                    </div>
                  </div>

                  {/* Compressor settings */}
                  <div className="bg-black/20 p-1.5 rounded border border-white/5 space-y-1">
                    <div className="text-[9px] uppercase font-bold text-yellow-400">Compressor</div>
                    <div>
                      <div className="flex justify-between text-[9px] font-mono text-text-secondary">
                        <span>Threshold</span>
                        <span>{compressor.threshold ?? -30} dB</span>
                      </div>
                      <input
                        type="range" min="-50" max="0" step="1"
                        className="w-full h-1 bg-white/10 accent-yellow-400 rounded-lg outline-none appearance-none cursor-pointer"
                        value={compressor.threshold ?? -30}
                        onChange={e => onChange({ compressor: { ...compressor, threshold: Number(e.target.value) } })}
                        disabled={isAudioCopy}
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-[9px] font-mono text-text-secondary">
                        <span>Ratio</span>
                        <span>{compressor.ratio ?? 4}:1</span>
                      </div>
                      <input
                        type="range" min="1" max="20" step="0.5"
                        className="w-full h-1 bg-white/10 accent-yellow-400 rounded-lg outline-none appearance-none cursor-pointer"
                        value={compressor.ratio ?? 4}
                        onChange={e => onChange({ compressor: { ...compressor, ratio: Number(e.target.value) } })}
                        disabled={isAudioCopy}
                      />
                    </div>
                  </div>

                  {/* Makeup Gain */}
                  <div className="col-span-2 bg-black/20 p-1.5 rounded border border-white/5">
                    <div className="flex justify-between text-[9px] font-mono text-text-secondary">
                      <span className="font-bold text-white">Makeup Gain</span>
                      <span>+{compressor.gain ?? 0} dB</span>
                    </div>
                    <input
                      type="range" min="0" max="24" step="0.5"
                      className="w-full h-1 bg-white/10 accent-brand-lime rounded-lg outline-none appearance-none cursor-pointer"
                      value={compressor.gain ?? 0}
                      onChange={e => onChange({ compressor: { ...compressor, gain: Number(e.target.value) } })}
                      disabled={isAudioCopy}
                    />
                  </div>

                  {/* Attack / Release */}
                  <div>
                    <label className="text-[8px] uppercase font-bold text-text-secondary block mb-0.5">Attack Time (s)</label>
                    <select
                      className="w-full bg-white/5 border border-white/10 rounded p-1 text-[10px] outline-none text-white font-mono"
                      value={compressor.attack ?? 0.3}
                      onChange={e => onChange({ compressor: { ...compressor, attack: Number(e.target.value) } })}
                      disabled={isAudioCopy}
                    >
                      <option value="0.01">0.01s (Fast)</option>
                      <option value="0.05">0.05s</option>
                      <option value="0.1">0.1s</option>
                      <option value="0.3">0.3s (Default)</option>
                      <option value="0.5">0.5s</option>
                      <option value="1.0">1.0s (Slow)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[8px] uppercase font-bold text-text-secondary block mb-0.5">Release Time (s)</label>
                    <select
                      className="w-full bg-white/5 border border-white/10 rounded p-1 text-[10px] outline-none text-white font-mono"
                      value={compressor.release ?? 0.3}
                      onChange={e => onChange({ compressor: { ...compressor, release: Number(e.target.value) } })}
                      disabled={isAudioCopy}
                    >
                      <option value="0.05">0.05s (Fast)</option>
                      <option value="0.1">0.1s</option>
                      <option value="0.3">0.3s (Default)</option>
                      <option value="0.5">0.5s</option>
                      <option value="1.0">1.0s</option>
                      <option value="2.0">2.0s (Slow)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Card 4: Output Brickwall Limiter */}
          <div className="glass-card p-3 rounded-lg border border-white/5 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <input
                  type="checkbox" id="limiter-chk"
                  className="w-3.5 h-3.5 accent-brand-lime cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                  checked={limiter?.enabled || false}
                  onChange={e => onChange({ limiter: { ...limiter, enabled: e.target.checked } })}
                  disabled={isAudioCopy}
                />
                <label htmlFor="limiter-chk" className={`text-[11px] font-bold uppercase tracking-wider text-text-secondary select-none cursor-pointer ${isAudioCopy ? 'opacity-35 cursor-not-allowed' : ''}`}>
                  Output Brickwall Limiter (alimiter)
                </label>
              </div>
              {limiter?.enabled && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-brand-lime/10 text-brand-lime">ACTIVE</span>}
            </div>

            {limiter?.enabled && (
              <div className="grid grid-cols-2 gap-3 p-2 bg-white/5 rounded-lg border border-white/5 text-xs">
                <div>
                  <div className="flex justify-between text-[9px] font-mono text-text-secondary mb-0.5">
                    <span>Ceiling (Output Limit)</span>
                    <span className="font-bold text-white">{limiter.ceiling ?? -0.1} dBFS</span>
                  </div>
                  <input
                    type="range" min="-10" max="0" step="0.1"
                    className="w-full h-1 bg-white/10 accent-brand-lime rounded-lg outline-none appearance-none cursor-pointer"
                    value={limiter.ceiling ?? -0.1}
                    onChange={e => onChange({ limiter: { ...limiter, ceiling: Number(e.target.value) } })}
                    disabled={isAudioCopy}
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[9px] font-mono text-text-secondary mb-0.5">
                    <span>Release Time</span>
                    <span className="font-bold text-white">{limiter.release ?? 50} ms</span>
                  </div>
                  <input
                    type="range" min="5" max="1000" step="5"
                    className="w-full h-1 bg-white/10 accent-brand-lime rounded-lg outline-none appearance-none cursor-pointer"
                    value={limiter.release ?? 50}
                    onChange={e => onChange({ limiter: { ...limiter, release: Number(e.target.value) } })}
                    disabled={isAudioCopy}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB: Overlays */}
      {activeSubTab === 'overlays' && hasVideo && (
        <div className="glass-card p-3 !rounded-xl space-y-4">
          {isVideoCopy && (
            <div className="bg-brand-orange/10 border border-brand-orange/20 text-brand-orange text-[10px] p-2 rounded-lg leading-snug font-bold">
              ⚠️ Video codec is set to 'copy'. Overlays cannot be applied because the stream is copied directly without re-encoding.
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Left Column: TV Preview Monitor (Sticky on lg desktop) */}
            <div className="lg:col-span-5 space-y-2 lg:sticky lg:top-4 self-start">
              <OverlayCanvasPreview
                overlays={overlays}
                scaleResolution={scale || ''}
                storages={storages}
              />
            </div>

            {/* Right Column: Layer Editor Controls */}
            <div className="lg:col-span-7 space-y-3">
              <div className="flex items-center justify-between bg-white/5 p-2.5 rounded-xl border border-white/5">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-brand-lime shadow-[0_0_8px_rgba(163,230,53,0.8)]" />
                  <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider">
                    Overlay Layers ({overlays.length})
                  </h4>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={isVideoCopy}
                    onClick={() => addOverlay('text')}
                    className="px-2.5 py-1.5 bg-brand-lime/10 hover:bg-brand-lime/20 border border-brand-lime/30 text-brand-lime font-bold rounded-lg text-[10px] uppercase tracking-wider transition-all disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                  >
                    + Text Overlay
                  </button>
                  <button
                    type="button"
                    disabled={isVideoCopy}
                    onClick={() => addOverlay('image')}
                    className="px-2.5 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 font-bold rounded-lg text-[10px] uppercase tracking-wider transition-all disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                  >
                    + Image Overlay
                  </button>
                </div>
              </div>

              {overlays.length === 0 ? (
                <div className="text-center py-12 text-xs text-text-secondary italic border border-dashed border-white/10 rounded-xl bg-black/20">
                  No overlay layers added yet. Click "+ Text Overlay" or "+ Image Overlay" above to start building broadcast graphics.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {overlays.map((overlay, idx) => {
                    const { anchor, marginX, marginY } = parseAnchorFromExpressions(
                      overlay.x || '10',
                      overlay.y || '10'
                    );
                    const isCustomMode = customModes[overlay.id] ?? (anchor === 'custom');
                    const isExpanded = expandedOverlayId === overlay.id;

                    const displayName = overlay.name?.trim() || (
                      overlay.type === 'text' 
                        ? (overlay.text ? `"${overlay.text}"` : `Text Layer ${idx + 1}`)
                        : (overlay.relative_path ? overlay.relative_path.split('/').pop() : `Image Layer ${idx + 1}`)
                    );

                    return (
                      <div
                        key={overlay.id || idx}
                        className={`rounded-xl border transition-all overflow-hidden ${
                          isExpanded 
                            ? 'border-brand-lime/40 bg-slate-900/95 shadow-lg' 
                            : 'border-white/10 bg-white/5 hover:border-white/20'
                        }`}
                      >
                        {/* Compact Accordion Header */}
                        <div 
                          className="flex items-center justify-between p-3 select-none cursor-pointer bg-white/2 hover:bg-white/5 transition-colors"
                          onClick={() => setExpandedOverlayId(isExpanded ? '' : overlay.id)}
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
                            {/* Layer Reorder Buttons */}
                            <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                              <button
                                type="button"
                                disabled={isVideoCopy || idx === 0}
                                onClick={() => moveOverlay(idx, 'up')}
                                className="p-1 px-1.5 bg-white/5 hover:bg-brand-lime hover:text-black disabled:opacity-30 disabled:cursor-not-allowed rounded text-xs transition-all cursor-pointer font-black"
                                title="Move layer up (render order)"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                disabled={isVideoCopy || idx === overlays.length - 1}
                                onClick={() => moveOverlay(idx, 'down')}
                                className="p-1 px-1.5 bg-white/5 hover:bg-brand-lime hover:text-black disabled:opacity-30 disabled:cursor-not-allowed rounded text-xs transition-all cursor-pointer font-black"
                                title="Move layer down (render order)"
                              >
                                ↓
                              </button>
                            </div>

                            {/* Type Badge */}
                            <span 
                              className="text-[9.5px] font-black px-2 py-0.5 rounded uppercase shrink-0 flex items-center gap-1.5"
                              style={{
                                backgroundColor: `${overlay.color || (overlay.type === 'text' ? '#a3e635' : '#22d3ee')}25`,
                                color: overlay.color || (overlay.type === 'text' ? '#a3e635' : '#22d3ee'),
                                border: `1px solid ${overlay.color || (overlay.type === 'text' ? '#a3e635' : '#22d3ee')}50`
                              }}
                            >
                              <span 
                                className="w-2 h-2 rounded-full shadow-sm" 
                                style={{ backgroundColor: overlay.color || (overlay.type === 'text' ? '#a3e635' : '#22d3ee') }} 
                              />
                              #{idx + 1} {overlay.type === 'text' ? 'TEXT' : 'IMAGE'}
                            </span>

                            {/* Custom Display Name */}
                            <span className="text-xs font-bold text-white truncate max-w-[200px]">
                              {displayName}
                            </span>

                            {/* Position Summary Badge */}
                            <span className="text-[9px] font-mono text-white/50 bg-black/40 px-2 py-0.5 rounded border border-white/5 shrink-0 hidden sm:inline-block">
                              {anchor.toUpperCase()} ({overlay.x}, {overlay.y})
                            </span>
                          </div>

                          <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                            <button
                              type="button"
                              disabled={isVideoCopy}
                              onClick={() => removeOverlay(idx)}
                              className="p-1.5 bg-white/5 hover:bg-red-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed rounded-md text-xs transition-all cursor-pointer"
                              title="Delete layer"
                            >
                              ✕
                            </button>
                            <button
                              type="button"
                              onClick={() => setExpandedOverlayId(isExpanded ? '' : overlay.id)}
                              className={`px-2.5 py-1 text-[10px] font-bold rounded-lg transition-all cursor-pointer border ${
                                isExpanded 
                                  ? 'bg-brand-lime/20 border-brand-lime/50 text-brand-lime' 
                                  : 'bg-white/5 border-white/10 text-white/70 hover:text-white hover:bg-white/10'
                              }`}
                            >
                              {isExpanded ? '▴ CLOSE' : '▾ EDIT'}
                            </button>
                          </div>
                        </div>

                        {/* Expanded Layer Settings Form */}
                        {isExpanded && (
                          <div className="p-4 border-t border-white/10 space-y-4 bg-black/40 animate-in fade-in duration-200">
                            {/* Layer Name / Tag */}
                            <div>
                              <label className="text-[9px] uppercase font-bold text-text-secondary block mb-1">
                                Layer Name / Label (Optional)
                              </label>
                              <input
                                type="text"
                                placeholder="e.g. Mosca TV, Lower Third, Watermark 4K"
                                className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none focus:border-brand-lime text-white disabled:opacity-35"
                                value={overlay.name || ''}
                                onChange={(e) => updateOverlayItem(idx, { name: e.target.value })}
                                disabled={isVideoCopy}
                              />
                            </div>

                            {/* Layer Content Editors */}
                            {overlay.type === 'text' ? (
                              <div className="space-y-3">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                                  <div className="md:col-span-3">
                                    <label className="text-[9px] uppercase font-bold text-text-secondary block mb-1">
                                      Text String
                                    </label>
                                    <input
                                      type="text"
                                      className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none focus:border-brand-lime text-white disabled:opacity-35"
                                      value={overlay.text || ''}
                                      onChange={(e) => updateOverlayItem(idx, { text: e.target.value })}
                                      disabled={isVideoCopy}
                                    />
                                  </div>

                                  <div>
                                    <label className="text-[9px] uppercase font-bold text-text-secondary block mb-1">
                                      Font Size (px)
                                    </label>
                                    <input
                                      type="number"
                                      min="8"
                                      max="300"
                                      className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none font-mono focus:border-brand-lime text-white disabled:opacity-35"
                                      value={overlay.fontsize || '24'}
                                      onChange={(e) => updateOverlayItem(idx, { fontsize: e.target.value })}
                                      disabled={isVideoCopy}
                                    />
                                  </div>

                                  <div className="md:col-span-2">
                                    <label className="text-[9px] uppercase font-bold text-text-secondary block mb-1">
                                      Font Color
                                    </label>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="color"
                                        className="w-8 h-8 rounded bg-transparent border border-white/10 cursor-pointer shrink-0"
                                        value={
                                          overlay.fontcolor && overlay.fontcolor.startsWith('#')
                                            ? overlay.fontcolor
                                            : '#ffffff'
                                        }
                                        onChange={(e) => updateOverlayItem(idx, { fontcolor: e.target.value })}
                                        disabled={isVideoCopy}
                                      />
                                      <input
                                        type="text"
                                        className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none font-mono focus:border-brand-lime text-white disabled:opacity-35"
                                        value={overlay.fontcolor || 'white'}
                                        onChange={(e) => updateOverlayItem(idx, { fontcolor: e.target.value })}
                                        disabled={isVideoCopy}
                                      />
                                    </div>
                                    <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                                      {[
                                        { name: 'White', color: '#ffffff' },
                                        { name: 'Yellow', color: '#facc15' },
                                        { name: 'Lime', color: '#a3e635' },
                                        { name: 'Cyan', color: '#22d3ee' },
                                        { name: 'Red', color: '#ef4444' },
                                        { name: 'Black', color: '#000000' },
                                      ].map((preset) => (
                                        <button
                                          key={preset.color}
                                          type="button"
                                          disabled={isVideoCopy}
                                          onClick={() => updateOverlayItem(idx, { fontcolor: preset.color })}
                                          className="px-1.5 py-0.5 rounded text-[9px] font-mono border border-white/10 hover:border-white/30 transition-all flex items-center gap-1 cursor-pointer text-white"
                                          style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                                        >
                                          <span
                                            className="w-2 h-2 rounded-full border border-white/20"
                                            style={{ backgroundColor: preset.color }}
                                          />
                                          {preset.name}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                </div>

                                {/* Background Box Settings */}
                                <div className="bg-black/20 p-2.5 rounded-lg border border-white/5 space-y-2">
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      id={`box-chk-${overlay.id}`}
                                      className="w-3.5 h-3.5 accent-brand-lime cursor-pointer disabled:opacity-35"
                                      checked={!!overlay.box}
                                      onChange={(e) => updateOverlayItem(idx, { box: e.target.checked })}
                                      disabled={isVideoCopy}
                                    />
                                    <label
                                      htmlFor={`box-chk-${overlay.id}`}
                                      className="text-[10px] font-bold uppercase tracking-wider text-text-secondary select-none cursor-pointer"
                                    >
                                      Enable Background Box (box=1)
                                    </label>
                                  </div>

                                  {overlay.box && (
                                    <div className="grid grid-cols-2 gap-2.5 pt-1">
                                      <div>
                                        <label className="text-[8px] uppercase font-bold text-text-secondary block mb-0.5">
                                          Box Color (e.g. black@0.6)
                                        </label>
                                        <input
                                          type="text"
                                          className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono focus:border-brand-lime text-white disabled:opacity-35"
                                          value={overlay.boxcolor || 'black@0.6'}
                                          onChange={(e) => updateOverlayItem(idx, { boxcolor: e.target.value })}
                                          disabled={isVideoCopy}
                                        />
                                      </div>
                                      <div>
                                        <label className="text-[8px] uppercase font-bold text-text-secondary block mb-0.5">
                                          Box Border Width (px)
                                        </label>
                                        <input
                                          type="number"
                                          min="0"
                                          max="50"
                                          className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono focus:border-brand-lime text-white disabled:opacity-35"
                                          value={overlay.boxborderw || '5'}
                                          onChange={(e) => updateOverlayItem(idx, { boxborderw: e.target.value })}
                                          disabled={isVideoCopy}
                                        />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ) : (
                              /* Image Overlay Parameters */
                              <div className="space-y-3">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <div>
                                    <label className="text-[9px] uppercase font-bold text-text-secondary block mb-1">
                                      Media Storage Selector
                                    </label>
                                    <select
                                      className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none text-white focus:border-brand-lime disabled:opacity-35"
                                      value={overlay.storage_id || ''}
                                      onChange={(e) =>
                                        updateOverlayItem(idx, {
                                          storage_id: e.target.value ? Number(e.target.value) : null,
                                        })
                                      }
                                      disabled={isVideoCopy}
                                    >
                                      <option value="" className="bg-slate-900 text-white">-- Select Media Storage --</option>
                                      {storages
                                        .filter((s: any) => s.type === 'media')
                                        .map((s: any) => (
                                          <option key={s.id} value={s.id} className="bg-slate-900 text-white">
                                            {s.name} ({s.path})
                                          </option>
                                        ))}
                                    </select>
                                  </div>

                                  <div>
                                    <label className="text-[9px] uppercase font-bold text-text-secondary block mb-1">
                                      Relative Path
                                    </label>
                                    <input
                                      type="text"
                                      placeholder="e.g. logos/watermark.png"
                                      className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none font-mono focus:border-brand-lime text-white disabled:opacity-35"
                                      value={overlay.relative_path || ''}
                                      onChange={(e) => updateOverlayItem(idx, { relative_path: e.target.value })}
                                      disabled={isVideoCopy}
                                    />
                                  </div>
                                </div>

                                {/* Canvas Badge Accent Color Selector */}
                                <div className="bg-black/20 p-2.5 rounded-lg border border-white/5 space-y-1.5">
                                  <label className="text-[9px] uppercase font-bold text-text-secondary block">
                                    Canvas Badge Accent Color
                                  </label>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {LAYER_COLOR_PRESETS.map((preset) => (
                                      <button
                                        key={preset.hex}
                                        type="button"
                                        disabled={isVideoCopy}
                                        onClick={() => updateOverlayItem(idx, { color: preset.hex })}
                                        className={`px-2 py-1 rounded-md text-[9.5px] font-mono font-bold transition-all flex items-center gap-1.5 border cursor-pointer ${
                                          (overlay.color || '#22d3ee') === preset.hex
                                            ? 'border-white text-white shadow-sm scale-105 bg-white/10'
                                            : 'border-white/10 text-white/70 hover:border-white/30 hover:text-white bg-black/20'
                                        }`}
                                      >
                                        <span
                                          className="w-2.5 h-2.5 rounded-full border border-white/20 shadow-sm"
                                          style={{ backgroundColor: preset.hex }}
                                        />
                                        {preset.name}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Position Positioning Section */}
                            <div className="border-t border-white/5 pt-3 space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-[9px] font-bold uppercase tracking-wider text-text-secondary">
                                  Position & Alignment Mode
                                </span>

                                {/* Position Mode Toggle */}
                                <div className="flex items-center bg-black/40 p-0.5 rounded-lg border border-white/10">
                                  <button
                                    type="button"
                                    disabled={isVideoCopy}
                                    onClick={() => {
                                      setCustomModes((prev) => ({ ...prev, [overlay.id]: false }));
                                      const targetAnchor = anchor === 'custom' ? 'top-left' : anchor;
                                      const { x, y } = generateAnchorExpressions(targetAnchor, marginX, marginY);
                                      updateOverlayItem(idx, { x, y });
                                    }}
                                    className={`px-2 py-1 text-[9.5px] font-bold rounded transition-all cursor-pointer ${
                                      !isCustomMode
                                        ? 'bg-brand-lime text-black shadow-sm'
                                        : 'text-text-secondary hover:text-white'
                                    }`}
                                  >
                                    3x3 Broadcast Anchor Grid
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isVideoCopy}
                                    onClick={() => setCustomModes((prev) => ({ ...prev, [overlay.id]: true }))}
                                    className={`px-2 py-1 text-[9.5px] font-bold rounded transition-all cursor-pointer ${
                                      isCustomMode
                                        ? 'bg-cyan-400 text-black shadow-sm'
                                        : 'text-text-secondary hover:text-white'
                                    }`}
                                  >
                                    Custom Expression
                                  </button>
                                </div>
                              </div>

                              {!isCustomMode ? (
                                <div className="space-y-3">
                                  {/* 3x3 Grid Matrix Buttons */}
                                  <div className="grid grid-cols-3 gap-1 bg-black/30 p-2 rounded-xl border border-white/5 max-w-xs mx-auto">
                                    {ANCHOR_GRID_PRESETS.map((preset) => (
                                      <button
                                        key={preset.id}
                                        type="button"
                                        disabled={isVideoCopy}
                                        onClick={() => {
                                          const { x, y } = generateAnchorExpressions(preset.id, marginX, marginY);
                                          updateOverlayItem(idx, { x, y });
                                        }}
                                        className={`p-2 rounded-lg flex flex-col items-center justify-center gap-0.5 text-xs font-mono transition-all border cursor-pointer ${
                                          anchor === preset.id
                                            ? 'bg-brand-lime text-black font-bold border-brand-lime shadow-md scale-102'
                                            : 'bg-white/5 border-white/10 hover:bg-white/10 text-white hover:border-white/20'
                                        } disabled:opacity-35`}
                                        title={preset.label}
                                      >
                                        <span className="text-base leading-none">{preset.symbol}</span>
                                        <span className="text-[8px] uppercase font-sans font-semibold tracking-tighter truncate">
                                          {preset.label}
                                        </span>
                                      </button>
                                    ))}
                                  </div>

                                  {/* Margin Sliders + Numeric Precision Inputs */}
                                  <div className="grid grid-cols-2 gap-3 bg-black/20 p-2.5 rounded-lg border border-white/5">
                                    <div>
                                      <div className="flex justify-between items-center text-[9px] font-mono text-text-secondary mb-1">
                                        <span>Margin X (px)</span>
                                        <input
                                          type="number"
                                          className="w-16 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-xs text-right font-mono text-white outline-none focus:border-brand-lime"
                                          value={marginX}
                                          onChange={(e) => {
                                            const newXMargin = Number(e.target.value);
                                            const curAnchor = anchor === 'custom' ? 'top-left' : anchor;
                                            const { x, y } = generateAnchorExpressions(curAnchor, newXMargin, marginY);
                                            updateOverlayItem(idx, { x, y });
                                          }}
                                          disabled={isVideoCopy}
                                        />
                                      </div>
                                      <input
                                        type="range"
                                        min="-100"
                                        max="500"
                                        step="1"
                                        className="w-full h-1 bg-white/10 accent-brand-lime rounded-lg outline-none appearance-none cursor-pointer disabled:opacity-35"
                                        value={marginX}
                                        onChange={(e) => {
                                          const newXMargin = Number(e.target.value);
                                          const curAnchor = anchor === 'custom' ? 'top-left' : anchor;
                                          const { x, y } = generateAnchorExpressions(curAnchor, newXMargin, marginY);
                                          updateOverlayItem(idx, { x, y });
                                        }}
                                        disabled={isVideoCopy}
                                      />
                                    </div>

                                    <div>
                                      <div className="flex justify-between items-center text-[9px] font-mono text-text-secondary mb-1">
                                        <span>Margin Y (px)</span>
                                        <input
                                          type="number"
                                          className="w-16 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-xs text-right font-mono text-white outline-none focus:border-brand-lime"
                                          value={marginY}
                                          onChange={(e) => {
                                            const newYMargin = Number(e.target.value);
                                            const curAnchor = anchor === 'custom' ? 'top-left' : anchor;
                                            const { x, y } = generateAnchorExpressions(curAnchor, marginX, newYMargin);
                                            updateOverlayItem(idx, { x, y });
                                          }}
                                          disabled={isVideoCopy}
                                        />
                                      </div>
                                      <input
                                        type="range"
                                        min="-100"
                                        max="500"
                                        step="1"
                                        className="w-full h-1 bg-white/10 accent-brand-lime rounded-lg outline-none appearance-none cursor-pointer disabled:opacity-35"
                                        value={marginY}
                                        onChange={(e) => {
                                          const newYMargin = Number(e.target.value);
                                          const curAnchor = anchor === 'custom' ? 'top-left' : anchor;
                                          const { x, y } = generateAnchorExpressions(curAnchor, marginX, newYMargin);
                                          updateOverlayItem(idx, { x, y });
                                        }}
                                        disabled={isVideoCopy}
                                      />
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                /* Custom Expressions Input */
                                <div className="grid grid-cols-2 gap-3 bg-black/20 p-2.5 rounded-lg border border-white/5">
                                  <div>
                                    <label className="text-[9px] uppercase font-bold text-text-secondary block mb-1">
                                      X Position Expression
                                    </label>
                                    <input
                                      type="text"
                                      placeholder="e.g. (main_w-w)/2 or 50"
                                      className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none font-mono focus:border-brand-lime text-white disabled:opacity-35"
                                      value={overlay.x || ''}
                                      onChange={(e) => updateOverlayItem(idx, { x: e.target.value })}
                                      disabled={isVideoCopy}
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[9px] uppercase font-bold text-text-secondary block mb-1">
                                      Y Position Expression
                                    </label>
                                    <input
                                      type="text"
                                      placeholder="e.g. main_h-h-20 or 50"
                                      className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none font-mono focus:border-brand-lime text-white disabled:opacity-35"
                                      value={overlay.y || ''}
                                      onChange={(e) => updateOverlayItem(idx, { y: e.target.value })}
                                      disabled={isVideoCopy}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default React.memo(FiltersFormSection);
