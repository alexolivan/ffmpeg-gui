import React from 'react';

interface FiltersFormSectionProps {
  hasVideo: boolean;
  scale: string;
  framerate: string;
  deinterlace: boolean;
  onChange: (updates: { scale?: string; framerate?: string; deinterlace?: boolean }) => void;
}

export const FiltersFormSection: React.FC<FiltersFormSectionProps> = ({
  hasVideo,
  scale,
  framerate,
  deinterlace,
  onChange,
}) => {
  if (!hasVideo) {
    return (
      <div className="text-center py-12 text-text-secondary text-sm italic">
        Video filters are only available when video stream is enabled.
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <div className="glass-card p-4 !rounded-2xl">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2 h-2 rounded-full bg-brand-lime" />
          <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider">Video Filters</h4>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block mb-1">Scale / Resize</label>
            <input
              type="text"
              placeholder="e.g. 1920:1080 or -1:720"
              className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
              value={scale}
              onChange={e => onChange({ scale: e.target.value })}
            />
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block mb-1">Framerate Convert</label>
            <input
              type="text"
              placeholder="e.g. 25, 29.97, 50"
              className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
              value={framerate}
              onChange={e => onChange({ framerate: e.target.value })}
            />
          </div>
          <div className="col-span-2 flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/5">
            <input
              type="checkbox" id="deinterlace-chk"
              className="w-4 h-4 accent-brand-lime"
              checked={deinterlace}
              onChange={e => onChange({ deinterlace: e.target.checked })}
            />
            <label htmlFor="deinterlace-chk" className="text-sm font-medium cursor-pointer">
              Enable Deinterlacing (YADIF)
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};
export default FiltersFormSection;
