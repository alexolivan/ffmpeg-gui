import React, { useState } from 'react';

interface BatchJobFormProps {
  onCancel: () => void;
  onSubmit: (config: any) => void;
}

const BatchJobForm: React.FC<BatchJobFormProps> = ({ onCancel, onSubmit }) => {
  const [config, setConfig] = useState({
    name: '',
    input: { type: 'file', path: '' },
    codec: { vcodec: 'libx264', acodec: 'aac', bitrate: '4000k' },
    output: { type: 'file', path: '' }
  });

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label className="text-xs font-bold text-text-secondary uppercase">Job Name</label>
        <input 
          type="text" 
          className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none focus:border-brand-lime transition-all"
          placeholder="e.g. Transcode EP01 to MP4"
          value={config.name}
          onChange={e => setConfig({...config, name: e.target.value})}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label className="text-xs font-bold text-text-secondary uppercase">Source File Path</label>
          <input 
            type="text" 
            className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none focus:border-brand-lime transition-all"
            placeholder="/media/storage/input.mkv"
            value={config.input.path}
            onChange={e => setConfig({...config, input: {...config.input, path: e.target.value}})}
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-text-secondary uppercase">Destination File Path</label>
          <input 
            type="text" 
            className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none focus:border-brand-lime transition-all"
            placeholder="/media/storage/output.mp4"
            value={config.output.path}
            onChange={e => setConfig({...config, output: {...config.output, path: e.target.value}})}
          />
        </div>
      </div>

      <div className="glass-card p-4 bg-white/5 border-white/5">
        <label className="text-xs font-bold text-text-secondary uppercase block mb-4">Target Format</label>
        <div className="grid grid-cols-2 gap-4">
          <select 
            className="bg-white/5 border border-white/10 rounded-xl p-3 outline-none"
            value={config.codec.vcodec}
            onChange={e => setConfig({...config, codec: {...config.codec, vcodec: e.target.value}})}
          >
            <option value="libx264">H.264 (High Compatibility)</option>
            <option value="libx265">H.265 (HEVC - High Quality)</option>
            <option value="copy">Copy (No Transcode)</option>
          </select>
          <input 
            type="text" 
            className="bg-white/5 border border-white/10 rounded-xl p-3 outline-none"
            placeholder="Bitrate (e.g. 5M)"
            value={config.codec.bitrate}
            onChange={e => setConfig({...config, codec: {...config.codec, bitrate: e.target.value}})}
          />
        </div>
      </div>

      <div className="flex gap-4 pt-4">
        <button 
          onClick={onCancel}
          className="flex-1 py-3 bg-white/5 border border-white/10 rounded-xl font-bold hover:bg-white/10 transition-all"
        >Cancel</button>
        <button 
          onClick={() => onSubmit(config)}
          className="flex-1 py-3 bg-brand-lime text-black rounded-xl font-black shadow-lg shadow-brand-lime/20"
        >Queue Batch Job</button>
      </div>
    </div>
  );
};

export default BatchJobForm;
