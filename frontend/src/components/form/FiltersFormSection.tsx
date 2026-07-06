import React, { useState } from 'react';

interface OverlayItem {
  id: string; // client-side unique id
  type: 'text' | 'image';
  text?: string;
  path?: string;
  x: string;
  y: string;
  fontsize?: string;
  fontcolor?: string;
  order: number;
}

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
  compressor?: boolean;
  volume?: string;
  aresample?: boolean;

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
}

export const FiltersFormSection: React.FC<FiltersFormSectionProps> = ({
  hasVideo,
  hasAudio,
  scale,
  framerate,
  deinterlace,
  highpass = '',
  lowpass = '',
  equalizer = { enabled: false, bands: { '60': 0, '230': 0, '910': 0, '4000': 0, '14000': 0 } },
  compressor = false,
  volume = '',
  aresample = false,
  overlays = [],
  onChange,
  hwaccel = 'none',
  isVram = false,
  systemCapabilities = null,
  videoCodecId,
  audioCodecId,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'video' | 'audio' | 'overlays'>('video');

  const isVideoCopy = videoCodecId === 'copy';
  const isAudioCopy = audioCodecId === 'copy';

  if (!hasVideo && !hasAudio) {
    return (
      <div className="text-center py-12 text-text-secondary text-sm italic">
        Filters are only available when video or audio streams are enabled.
      </div>
    );
  }

  // Ensure default bands are present
  const defaultBands: Record<string, number> = { '60': 0, '230': 0, '910': 0, '4000': 0, '14000': 0 };
  const bandsObj: Record<string, number> = { ...defaultBands, ...(equalizer.bands || {}) };

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

  // Overlay management
  const addOverlay = (type: 'text' | 'image') => {
    const newItem: OverlayItem = {
      id: Math.random().toString(36).substr(2, 9),
      type,
      x: '10',
      y: '10',
      order: overlays.length,
      ...(type === 'text' ? { text: 'LIVE BROADCAST', fontsize: '24', fontcolor: 'white' } : { path: '/path/to/logo.png' })
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

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block mb-0.5">Volume Adjustment</label>
              <input
                type="text"
                placeholder="e.g. 1.0 (no change), 1.5 (+50%), 0.5 (-50%), -10dB"
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono disabled:opacity-35 disabled:cursor-not-allowed"
                value={volume}
                onChange={e => onChange({ volume: e.target.value })}
                disabled={isAudioCopy}
              />
            </div>

            <div className="flex flex-col justify-end">
              <div className="flex items-center gap-2 p-1.5 bg-white/5 rounded-lg border border-white/5 h-[28px]">
                <input
                  type="checkbox" id="compressor-chk"
                  className="w-3.5 h-3.5 accent-brand-lime cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                  checked={compressor}
                  onChange={e => onChange({ compressor: e.target.checked })}
                  disabled={isAudioCopy}
                />
                <label htmlFor="compressor-chk" className={`text-[11px] font-semibold cursor-pointer select-none ${isAudioCopy ? 'opacity-35 cursor-not-allowed' : ''}`}>
                  Enable Compand Dynamic Limiter
                </label>
              </div>
            </div>

            <div>
              <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block mb-0.5">Highpass Filter (Hz)</label>
              <input
                type="text"
                placeholder="Cutoff frequency, e.g. 80"
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono disabled:opacity-35 disabled:cursor-not-allowed"
                value={highpass}
                onChange={e => onChange({ highpass: e.target.value })}
                disabled={isAudioCopy}
              />
            </div>

            <div>
              <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block mb-0.5">Lowpass Filter (Hz)</label>
              <input
                type="text"
                placeholder="Cutoff frequency, e.g. 15000"
                className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono disabled:opacity-35 disabled:cursor-not-allowed"
                value={lowpass}
                onChange={e => onChange({ lowpass: e.target.value })}
                disabled={isAudioCopy}
              />
            </div>

            <div className="col-span-2 border-t border-white/5 pt-2">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <input
                    type="checkbox" id="eq-chk"
                    className="w-3.5 h-3.5 accent-brand-lime cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                    checked={equalizer.enabled || false}
                    onChange={e => onChange({ equalizer: { ...equalizer, enabled: e.target.checked } })}
                    disabled={isAudioCopy}
                  />
                  <label htmlFor="eq-chk" className={`text-[11px] font-bold uppercase tracking-wider text-text-secondary select-none cursor-pointer ${isAudioCopy ? 'opacity-35 cursor-not-allowed' : ''}`}>
                    5-Band Graphic Equalizer
                  </label>
                </div>
                {equalizer.enabled && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-brand-lime/10 text-brand-lime">ACTIVE</span>}
              </div>

              {equalizer.enabled && (
                <div className="grid grid-cols-5 gap-1.5 p-2 bg-white/5 rounded-lg border border-white/5">
                  {Object.keys(bandsObj).map(band => (
                    <div key={band} className="flex flex-col items-center gap-1 font-mono">
                      <span className="text-[9px] text-text-secondary">{band}Hz</span>
                      <input
                        type="range"
                        min="-20"
                        max="20"
                        step="1"
                        className="h-16 w-1 bg-white/10 accent-brand-lime rounded-lg outline-none appearance-none orientation-vertical cursor-ns-resize disabled:opacity-35 disabled:cursor-not-allowed"
                        style={{ writingMode: 'bt-lr', WebkitAppearance: 'slider-vertical' } as any}
                        value={bandsObj[band]}
                        onChange={e => updateEqBand(band, Number(e.target.value))}
                        disabled={isAudioCopy}
                      />
                      <span className={`text-[9px] font-bold ${bandsObj[band] > 0 ? 'text-brand-lime' : bandsObj[band] < 0 ? 'text-brand-orange' : 'text-text-secondary'} ${isAudioCopy ? 'opacity-35' : ''}`}>
                        {bandsObj[band] > 0 ? `+${bandsObj[band]}` : bandsObj[band]}dB
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="col-span-2 flex items-center gap-2 p-1.5 bg-white/5 rounded-lg border border-white/5">
              <input
                type="checkbox" id="aresample-chk"
                className="w-3.5 h-3.5 accent-brand-lime cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                checked={aresample}
                onChange={e => onChange({ aresample: e.target.checked })}
                disabled={isAudioCopy}
              />
              <label htmlFor="aresample-chk" className={`text-[11px] font-semibold cursor-pointer select-none ${isAudioCopy ? 'opacity-35 cursor-not-allowed' : ''}`}>
                Enable Audio Resampling Sync (aresample=async=1)
              </label>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB: Overlays */}
      {activeSubTab === 'overlays' && hasVideo && (
        <div className="glass-card p-2.5 !rounded-lg space-y-2">
          {isVideoCopy && (
            <div className="bg-brand-orange/10 border border-brand-orange/20 text-brand-orange text-[10px] p-2 rounded-lg leading-snug font-bold">
              ⚠️ Video codec is set to 'copy'. Overlays cannot be applied because the stream is copied directly without re-encoding.
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-lime" />
              <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider">Video Overlays Layering</h4>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={isVideoCopy}
                onClick={() => addOverlay('text')}
                className="px-2.5 py-1.5 bg-white/10 hover:bg-white/20 text-white font-bold rounded-lg text-[10px] uppercase tracking-wider transition-all disabled:opacity-35 disabled:cursor-not-allowed"
              >
                + Text Overlay
              </button>
              <button
                type="button"
                disabled={isVideoCopy}
                onClick={() => addOverlay('image')}
                className="px-2.5 py-1.5 bg-white/10 hover:bg-white/20 text-white font-bold rounded-lg text-[10px] uppercase tracking-wider transition-all disabled:opacity-35 disabled:cursor-not-allowed"
              >
                + Image Overlay
              </button>
            </div>
          </div>

          {overlays.length === 0 ? (
            <div className="text-center py-8 text-xs text-text-secondary italic border border-dashed border-white/10 rounded-xl">
              No overlays added yet. Adding overlays will automatically execute download filters if GPU VRAM path is active.
            </div>
          ) : (
            <div className="space-y-3">
              {overlays.map((overlay, idx) => (
                <div
                  key={overlay.id || idx}
                  className="flex flex-col gap-2.5 p-3 rounded-xl border border-white/10 bg-white/5 relative group transition-all"
                >
                  {/* Layer controls */}
                  <div className="flex items-center justify-between border-b border-white/5 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black px-2 py-0.5 rounded bg-brand-orange/20 text-brand-orange uppercase">
                        Layer {idx + 1}
                      </span>
                      <span className="text-xs font-bold text-white uppercase">
                        {overlay.type === 'text' ? '📝 Text' : '🖼️ Image'}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isVideoCopy || idx === 0}
                        onClick={() => moveOverlay(idx, 'up')}
                        className="p-1 bg-white/5 hover:bg-brand-lime hover:text-black disabled:opacity-30 disabled:cursor-not-allowed rounded text-xs transition-all shrink-0 cursor-pointer"
                        title="Move layer up"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        disabled={isVideoCopy || idx === overlays.length - 1}
                        onClick={() => moveOverlay(idx, 'down')}
                        className="p-1 bg-white/5 hover:bg-brand-lime hover:text-black disabled:opacity-30 disabled:cursor-not-allowed rounded text-xs transition-all shrink-0 cursor-pointer"
                        title="Move layer down"
                      >
                        ▼
                      </button>
                      <button
                        type="button"
                        disabled={isVideoCopy}
                        onClick={() => removeOverlay(idx)}
                        className="p-1 bg-white/5 hover:bg-red-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed rounded text-xs transition-all shrink-0 ml-1 cursor-pointer"
                        title="Remove overlay"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {/* Input controls based on type */}
                  {overlay.type === 'text' ? (
                    <div className="grid grid-cols-2 gap-3.5">
                      <div className="col-span-2">
                        <label className="text-[9px] uppercase font-bold text-text-secondary block mb-1">Text String</label>
                        <input
                          type="text"
                          className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none disabled:opacity-35 disabled:cursor-not-allowed"
                          value={overlay.text || ''}
                          onChange={e => updateOverlayItem(idx, { text: e.target.value })}
                          disabled={isVideoCopy}
                        />
                      </div>
                      <div>
                        <label className="text-[9px] uppercase font-bold text-text-secondary block mb-1">Font Size</label>
                        <input
                          type="text"
                          className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none font-mono disabled:opacity-35 disabled:cursor-not-allowed"
                          value={overlay.fontsize || '24'}
                          onChange={e => updateOverlayItem(idx, { fontsize: e.target.value })}
                          disabled={isVideoCopy}
                        />
                      </div>
                      <div>
                        <label className="text-[9px] uppercase font-bold text-text-secondary block mb-1">Font Color</label>
                        <input
                          type="text"
                          className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none font-mono disabled:opacity-35 disabled:cursor-not-allowed"
                          value={overlay.fontcolor || 'white'}
                          onChange={e => updateOverlayItem(idx, { fontcolor: e.target.value })}
                          disabled={isVideoCopy}
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="text-[9px] uppercase font-bold text-text-secondary block mb-1">Image File Path</label>
                      <input
                        type="text"
                        placeholder="e.g. /home/user/watermark.png"
                        className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none font-mono disabled:opacity-35 disabled:cursor-not-allowed"
                        value={overlay.path || ''}
                        onChange={e => updateOverlayItem(idx, { path: e.target.value })}
                        disabled={isVideoCopy}
                      />
                    </div>
                  )}

                  {/* Positioning coordinates */}
                  <div className="grid grid-cols-2 gap-3.5">
                    <div>
                      <label className="text-[9px] uppercase font-bold text-text-secondary block mb-1">X Position</label>
                      <input
                        type="text"
                        placeholder="e.g. 10 or main_w-w-10"
                        className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none font-mono disabled:opacity-35 disabled:cursor-not-allowed"
                        value={overlay.x || '10'}
                        onChange={e => updateOverlayItem(idx, { x: e.target.value })}
                        disabled={isVideoCopy}
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase font-bold text-text-secondary block mb-1">Y Position</label>
                      <input
                        type="text"
                        placeholder="e.g. 10 or main_h-h-10"
                        className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none font-mono disabled:opacity-35 disabled:cursor-not-allowed"
                        value={overlay.y || '10'}
                        onChange={e => updateOverlayItem(idx, { y: e.target.value })}
                        disabled={isVideoCopy}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default React.memo(FiltersFormSection);
