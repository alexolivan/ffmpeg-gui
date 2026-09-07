import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
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
    <div className="space-y-3 p-3 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl mt-2">
      <div className="flex items-center justify-between">
        <h5 className="text-xs font-bold text-[var(--text-primary)]">
          {t('destinations.hlsAbrVariants', 'HLS Adaptive Bitrate (ABR) Variants')}
        </h5>
        <span className="text-[10px] bg-brand-lime/15 text-brand-lime font-mono px-2 py-0.5 rounded-full border border-brand-lime/30">
          {variants.length} variant{variants.length !== 1 ? 's' : ''}
        </span>
      </div>

      {variants.length > 0 ? (
        <div className="overflow-hidden border border-[var(--glass-border)] rounded-lg bg-[var(--bg-card)]">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[var(--input-bg)] border-b border-[var(--glass-border)] text-[var(--text-secondary)] font-semibold">
                <th className="p-2">{t('destinations.hlsResolution', 'Resolution')}</th>
                <th className="p-2">{t('destinations.hlsVideoBitrate', 'Video Bitrate')}</th>
                <th className="p-2">{t('destinations.hlsAudioBitrate', 'Audio Bitrate')}</th>
                <th className="p-2 text-right">{t('destinations.hlsActions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((v, idx) => (
                <tr key={idx} className="border-b border-[var(--glass-border)]/50 last:border-0 hover:bg-[var(--input-bg)]/50 transition-colors text-[var(--text-primary)]">
                  <td className="p-2 font-mono font-semibold text-brand-lime">{v.resolution}</td>
                  <td className="p-2 font-mono">{v.video_bitrate}</td>
                  <td className="p-2 font-mono">{v.audio_bitrate}</td>
                  <td className="p-2 text-right">
                    <button
                      type="button"
                      onClick={() => removeVariant(idx)}
                      className="text-red-500 hover:text-red-400 font-semibold transition-colors px-2 py-1 rounded hover:bg-red-500/10"
                    >
                      {t('destinations.hlsRemoveVariant', 'Remove')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-4 text-[var(--text-secondary)] text-xs border border-dashed border-[var(--glass-border)] rounded-lg bg-[var(--bg-card)]">
          {t('destinations.hlsNoVariantsDefined', 'No variants defined. Single-stream output will be used.')}
        </div>
      )}

      {/* Preset quick-add */}
      <div className="space-y-1.5">
        <label className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block">
          {t('destinations.hlsQuickAddPresets', 'Quick Add Presets')}
        </label>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p, idx) => {
            const exists = variants.some(v => v.resolution === p.resolution);
            return (
              <button
                key={idx}
                type="button"
                disabled={exists}
                onClick={() => handleApplyPreset(p)}
                className={`text-[11px] px-2.5 py-1 rounded-lg border font-medium transition-all ${
                  exists
                    ? 'border-[var(--glass-border)]/40 bg-[var(--input-bg)]/30 text-[var(--text-secondary)]/40 cursor-not-allowed'
                    : 'border-[var(--glass-border)] bg-[var(--bg-card)] text-[var(--text-primary)] hover:bg-[var(--input-bg)] hover:border-brand-lime/50'
                }`}
              >
                + {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom Add Form */}
      <form onSubmit={handleAddCustom} className="space-y-2 pt-2 border-t border-[var(--glass-border)]">
        <label className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block">
          {t('destinations.hlsCustomVariant', 'Custom Variant')}
        </label>
        <div className="grid grid-cols-3 gap-2">
          <input
            type="text"
            placeholder="e.g. 1920:1080"
            className={`bg-[var(--bg-card)] border rounded-lg p-2 text-xs outline-none text-[var(--text-primary)] placeholder-[var(--text-secondary)]/50 focus:border-brand-lime transition-colors font-mono ${
              resError ? 'border-red-500/50 focus:border-red-500 bg-red-500/5' : 'border-[var(--glass-border)]'
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
            placeholder={t('destinations.hlsVideoBitratePlaceholder', 'Video (e.g. 4500k)')}
            className={`bg-[var(--bg-card)] border rounded-lg p-2 text-xs outline-none text-[var(--text-primary)] placeholder-[var(--text-secondary)]/50 focus:border-brand-lime transition-colors font-mono ${
              videoError ? 'border-red-500/50 focus:border-red-500 bg-red-500/5' : 'border-[var(--glass-border)]'
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
            placeholder={t('destinations.hlsAudioBitratePlaceholder', 'Audio (e.g. 128k)')}
            className={`bg-[var(--bg-card)] border rounded-lg p-2 text-xs outline-none text-[var(--text-primary)] placeholder-[var(--text-secondary)]/50 focus:border-brand-lime transition-colors font-mono ${
              audioError ? 'border-red-500/50 focus:border-red-500 bg-red-500/5' : 'border-[var(--glass-border)]'
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
          className="w-full bg-brand-lime/15 hover:bg-brand-lime/25 text-brand-lime font-bold border border-brand-lime/30 rounded-lg py-2 text-xs transition-colors flex items-center justify-center gap-1.5"
        >
          <span>+</span>
          <span>{t('destinations.hlsAddCustomVariant', 'Add Custom Variant')}</span>
        </button>
      </form>
    </div>
  );
};
