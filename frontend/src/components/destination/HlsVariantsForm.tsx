import React, { useState } from 'react';

export interface HlsVariant {
  resolution: string;
  video_bitrate: string;
  audio_bitrate: string;
}

interface HlsVariantsFormProps {
  variants: HlsVariant[];
  onChange: (variants: HlsVariant[]) => void;
}

const PRESETS = [
  { label: '1080p Full HD', resolution: '1920:1080', video_bitrate: '4500k', audio_bitrate: '192k' },
  { label: '720p HD', resolution: '1280:720', video_bitrate: '2500k', audio_bitrate: '128k' },
  { label: '480p SD', resolution: '854:480', video_bitrate: '1200k', audio_bitrate: '96k' },
  { label: '360p Low', resolution: '640:360', video_bitrate: '800k', audio_bitrate: '96k' }
];

export const HlsVariantsForm: React.FC<HlsVariantsFormProps> = ({ variants, onChange }) => {
  const [resolution, setResolution] = useState('');
  const [videoBitrate, setVideoBitrate] = useState('');
  const [audioBitrate, setAudioBitrate] = useState('');

  const [resError, setResError] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [audioError, setAudioError] = useState(false);

  const addVariant = (v: HlsVariant) => {
    if (!v.resolution || !v.video_bitrate || !v.audio_bitrate) return;
    onChange([...variants, v]);
  };

  const removeVariant = (index: number) => {
    const next = [...variants];
    next.splice(index, 1);
    onChange(next);
  };

  const handleApplyPreset = (preset: typeof PRESETS[0]) => {
    addVariant({
      resolution: preset.resolution,
      video_bitrate: preset.video_bitrate,
      audio_bitrate: preset.audio_bitrate
    });
  };

  const handleAddCustom = (e: React.FormEvent) => {
    e.preventDefault();

    let processedVideoBitrate = videoBitrate.trim();
    if (/^\d+$/.test(processedVideoBitrate)) {
      processedVideoBitrate += 'k';
    }

    let processedAudioBitrate = audioBitrate.trim();
    if (/^\d+$/.test(processedAudioBitrate)) {
      processedAudioBitrate += 'k';
    }

    const trimmedRes = resolution.trim();

    const isResInvalid = !/^\d+:\d+$/.test(trimmedRes);
    const isVideoInvalid = !/^\d+[kM]$/.test(processedVideoBitrate);
    const isAudioInvalid = !/^\d+[kM]$/.test(processedAudioBitrate);

    setResError(isResInvalid);
    setVideoError(isVideoInvalid);
    setAudioError(isAudioInvalid);

    if (isResInvalid || isVideoInvalid || isAudioInvalid) {
      return;
    }

    addVariant({
      resolution: trimmedRes,
      video_bitrate: processedVideoBitrate,
      audio_bitrate: processedAudioBitrate
    });
    setResolution('');
    setVideoBitrate('');
    setAudioBitrate('');
  };

  return (
    <div className="space-y-2.5 p-2 bg-white/5 border border-white/10 rounded-lg mt-2">
      <div className="flex items-center justify-between">
        <h5 className="text-xs font-bold text-white/90">HLS Adaptive Bitrate (ABR) Variants</h5>
        <span className="text-[9px] bg-purple-500/20 text-purple-300 font-mono px-1.5 py-0.5 rounded-full border border-purple-500/30">
          {variants.length} variant{variants.length !== 1 ? 's' : ''}
        </span>
      </div>

      {variants.length > 0 ? (
        <div className="overflow-hidden border border-white/5 rounded-lg">
          <table className="w-full text-left border-collapse text-[11px]">
            <thead>
              <tr className="bg-white/5 border-b border-white/10 text-white/60 font-medium">
                <th className="p-1.5">Resolution</th>
                <th className="p-1.5">Video Bitrate</th>
                <th className="p-1.5">Audio Bitrate</th>
                <th className="p-1.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((v, idx) => (
                <tr key={idx} className="border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors">
                  <td className="p-1.5 font-mono text-purple-300">{v.resolution}</td>
                  <td className="p-1.5 font-mono">{v.video_bitrate}</td>
                  <td className="p-1.5 font-mono">{v.audio_bitrate}</td>
                  <td className="p-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => removeVariant(idx)}
                      className="text-red-400 hover:text-red-300 font-medium transition-colors px-1.5 py-0.5 rounded hover:bg-red-500/10"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-3 text-white/40 text-[10px] border border-dashed border-white/10 rounded-lg">
          No variants defined. Single-stream output will be used.
        </div>
      )}

      {/* Preset quick-add */}
      <div className="space-y-1.5">
        <label className="text-[9px] text-text-secondary uppercase font-bold block">Quick Add Presets</label>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p, idx) => {
            const exists = variants.some(v => v.resolution === p.resolution);
            return (
              <button
                key={idx}
                type="button"
                disabled={exists}
                onClick={() => handleApplyPreset(p)}
                className={`text-[10px] px-2 py-0.5 rounded-lg border transition-all ${
                  exists
                    ? 'border-white/5 bg-white/5 text-white/30 cursor-not-allowed'
                    : 'border-white/10 bg-white/5 text-white/80 hover:bg-white/10 hover:border-purple-400/50'
                }`}
              >
                + {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom Add Form */}
      <form onSubmit={handleAddCustom} className="space-y-1.5 pt-1.5 border-t border-white/5">
        <label className="text-[9px] text-text-secondary uppercase font-bold block">Custom Variant</label>
        <div className="grid grid-cols-3 gap-1.5">
          <input
            type="text"
            placeholder="e.g. 1920:1080"
            className={`bg-white/5 border rounded-lg p-1.5 text-xs outline-none text-white focus:border-purple-400/50 transition-colors ${
              resError ? 'border-red-500/50 focus:border-red-500 bg-red-500/5' : 'border-white/10'
            }`}
            value={resolution}
            onChange={e => {
              setResolution(e.target.value);
              setResError(false);
            }}
            required
          />
          <input
            type="text"
            placeholder="Video (e.g. 4500k)"
            className={`bg-white/5 border rounded-lg p-1.5 text-xs outline-none text-white focus:border-purple-400/50 transition-colors ${
              videoError ? 'border-red-500/50 focus:border-red-500 bg-red-500/5' : 'border-white/10'
            }`}
            value={videoBitrate}
            onChange={e => {
              setVideoBitrate(e.target.value);
              setVideoError(false);
            }}
            required
          />
          <input
            type="text"
            placeholder="Audio (e.g. 128k)"
            className={`bg-white/5 border rounded-lg p-1.5 text-xs outline-none text-white focus:border-purple-400/50 transition-colors ${
              audioError ? 'border-red-500/50 focus:border-red-500 bg-red-500/5' : 'border-white/10'
            }`}
            value={audioBitrate}
            onChange={e => {
              setAudioBitrate(e.target.value);
              setAudioError(false);
            }}
            required
          />
        </div>
        <button
          type="submit"
          className="w-full bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 font-bold border border-purple-500/30 rounded-lg py-1.5 text-xs transition-colors"
        >
          Add Custom Variant
        </button>
      </form>
    </div>
  );
};
