import React, { useState } from 'react';

interface ProcessConfigFormProps {
  onCancel: () => void;
  onSubmit: (config: any) => void;
}

const ProcessConfigForm: React.FC<ProcessConfigFormProps> = ({ onCancel, onSubmit }) => {
  const [config, setConfig] = useState({
    name: '',
    input: { type: 'file', path: '', host: '', port: '', mode: 'listener', device: '' },
    codec: { vcodec: 'libx264', acodec: 'aac', bitrate: '4000k', hwaccel: 'none' },
    output: { type: 'udp', host: '127.0.0.1', port: '1234', path: '', url: '', mode: 'caller', latency: 200 },
    filters: { scale: '', deinterlace: false }
  });

  const handleChange = (path: string, value: any) => {
    const keys = path.split('.');
    const newConfig = { ...config };
    let current: any = newConfig;
    for (let i = 0; i < keys.length - 1; i++) {
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
    setConfig(newConfig);
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Name Section */}
      <div className="glass-card p-6 border-brand-lime/10">
        <label className="block text-sm text-text-secondary mb-3 uppercase font-bold tracking-wider">Service Identity</label>
        <input 
          type="text" 
          className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 focus:border-brand-lime outline-none transition-all text-xl font-medium"
          placeholder="e.g. Primary Encoder Node-01"
          value={config.name}
          onChange={e => setConfig({...config, name: e.target.value})}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Input Configuration */}
        <div className="glass-card p-6">
          <h4 className="text-brand-lime font-bold mb-6 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-brand-lime animate-pulse"></span>
            SOURCE CONFIGURATION
          </h4>
          <div className="space-y-4">
            <select 
              className="w-full bg-white/5 border border-white/10 rounded-xl p-4 outline-none focus:border-brand-lime transition-all"
              value={config.input.type}
              onChange={e => handleChange('input.type', e.target.value)}
            >
              <option value="file">Local File / VOD</option>
              <option value="srt">SRT Stream (Secure Reliable Transport)</option>
              <option value="ndi">NDI Source (Network Device Interface)</option>
              <option value="udp">UDP / MPEG-TS Multicast</option>
              <option value="decklink">Blackmagic Decklink</option>
            </select>

            {config.input.type === 'file' && (
              <input 
                type="text" 
                placeholder="Absolute path to file" 
                className="w-full bg-white/5 border border-white/10 rounded-xl p-4 outline-none"
                value={config.input.path}
                onChange={e => handleChange('input.path', e.target.value)}
              />
            )}

            {config.input.type === 'srt' && (
              <div className="grid grid-cols-2 gap-4">
                <input type="text" placeholder="Host" className="bg-white/5 border border-white/10 rounded-xl p-4" value={config.input.host} onChange={e => handleChange('input.host', e.target.value)} />
                <input type="text" placeholder="Port" className="bg-white/5 border border-white/10 rounded-xl p-4" value={config.input.port} onChange={e => handleChange('input.port', e.target.value)} />
                <select className="col-span-2 bg-white/5 border border-white/10 rounded-xl p-4" value={config.input.mode} onChange={e => handleChange('input.mode', e.target.value)}>
                  <option value="listener">Listener (Server)</option>
                  <option value="caller">Caller (Client)</option>
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Codec & Processing */}
        <div className="glass-card p-6">
          <h4 className="text-brand-orange font-bold mb-6 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-brand-orange animate-pulse"></span>
            CODEC & PROCESSING
          </h4>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <select className="bg-white/5 border border-white/10 rounded-xl p-4" value={config.codec.vcodec} onChange={e => handleChange('codec.vcodec', e.target.value)}>
                <option value="libx264">H.264 (AVC)</option>
                <option value="libx265">H.265 (HEVC)</option>
                <option value="prores">Apple ProRes</option>
              </select>
              <input type="text" placeholder="Bitrate (e.g. 6000k)" className="bg-white/5 border border-white/10 rounded-xl p-4" value={config.codec.bitrate} onChange={e => handleChange('codec.bitrate', e.target.value)} />
            </div>
            
            <div className="flex items-center gap-4 p-4 bg-white/5 rounded-xl border border-white/5">
              <input 
                type="checkbox" 
                id="deinterlace"
                className="w-5 h-5 accent-brand-lime"
                checked={config.filters.deinterlace}
                onChange={e => handleChange('filters.deinterlace', e.target.checked)}
              />
              <label htmlFor="deinterlace" className="text-sm font-medium">Enable Deinterlacing (YADIF)</label>
            </div>
          </div>
        </div>
      </div>

      {/* Destination Section */}
      <div className="glass-card p-6">
        <h4 className="text-blue-400 font-bold mb-6 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>
          DESTINATION CONFIGURATION
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <select 
            className="bg-white/5 border border-white/10 rounded-xl p-4 outline-none"
            value={config.output.type}
            onChange={e => handleChange('output.type', e.target.value)}
          >
            <option value="udp">UDP Multicast</option>
            <option value="srt">SRT Stream</option>
            <option value="rtmp">RTMP Push</option>
            <option value="file">Local Recording</option>
          </select>

          {config.output.type === 'udp' && (
            <>
              <input type="text" placeholder="Host" className="bg-white/5 border border-white/10 rounded-xl p-4" value={config.output.host} onChange={e => handleChange('output.host', e.target.value)} />
              <input type="text" placeholder="Port" className="bg-white/5 border border-white/10 rounded-xl p-4" value={config.output.port} onChange={e => handleChange('output.port', e.target.value)} />
            </>
          )}

          {config.output.type === 'srt' && (
            <>
              <input type="text" placeholder="Host" className="bg-white/5 border border-white/10 rounded-xl p-4" value={config.output.host} onChange={e => handleChange('output.host', e.target.value)} />
              <input type="text" placeholder="Port" className="bg-white/5 border border-white/10 rounded-xl p-4" value={config.output.port} onChange={e => handleChange('output.port', e.target.value)} />
            </>
          )}

          {config.output.type === 'rtmp' && (
            <input type="text" placeholder="RTMP URL (rtmp://...)" className="md:col-span-2 bg-white/5 border border-white/10 rounded-xl p-4" value={config.output.url} onChange={e => handleChange('output.url', e.target.value)} />
          )}
        </div>
      </div>

      <div className="flex gap-6 pt-4">
        <button 
          onClick={onCancel}
          className="flex-1 py-4 bg-white/5 border border-white/10 rounded-2xl font-bold hover:bg-white/10 transition-all uppercase tracking-widest"
        >
          Cancel
        </button>
        <button 
          onClick={() => onSubmit(config)}
          className="flex-1 py-4 bg-brand-lime text-black rounded-2xl font-black hover:scale-[1.02] active:scale-[0.98] transition-all uppercase tracking-widest shadow-xl shadow-brand-lime/20"
        >
          Deploy Service
        </button>
      </div>
    </div>
  );
};

export default ProcessConfigForm;
