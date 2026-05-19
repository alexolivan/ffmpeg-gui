import React, { useState, useEffect } from 'react';
import InputSourcePanel from './source/InputSourcePanel';
import type { InputSourceConfig } from './source/InputSourcePanel';
import VideoCodecPanel from './codec/VideoCodecPanel';
import AudioCodecPanel from './codec/AudioCodecPanel';
import { getDefaultParams, VIDEO_CODECS, AUDIO_CODECS } from './codec/codecRegistry';
import DestinationPanel from './destination/DestinationPanel';
import type { OutputConfig } from './destination/DestinationPanel';

// ── Types ────────────────────────────────────────────────────────

interface ProcessConfig {
  name: string;
  ffmpeg_build_id: number | null;
  has_video: boolean;
  has_audio: boolean;
  use_secondary_input: boolean;

  // Input 1 (primary — carries video, or audio if video disabled)
  input1: InputSourceConfig;
  // Input 2 (secondary — independent audio source when split)
  input2: InputSourceConfig;

  // Codec settings
  video_codec_id: string;
  video_codec_params: Record<string, string | number | boolean>;
  audio_codec_id: string;
  audio_codec_params: Record<string, string | number | boolean>;

  // Filters
  filters: {
    scale: string;
    deinterlace: boolean;
    framerate: string;
  };

  // Output
  output: OutputConfig;
}

interface ProcessConfigFormProps {
  onCancel: () => void;
  onSubmit: (config: any) => void;
}

// ── Component ────────────────────────────────────────────────────

const ProcessConfigForm: React.FC<ProcessConfigFormProps> = ({ onCancel, onSubmit }) => {
  const [availableBuilds, setAvailableBuilds] = useState<any[]>([]);
  const [selectedBuildOptions, setSelectedBuildOptions] = useState<Record<string, boolean> | undefined>();
  const [activeSection, setActiveSection] = useState<string>('inputs');

  const defaultVideoCodec = VIDEO_CODECS[0];
  const defaultAudioCodec = AUDIO_CODECS[0];

  const [config, setConfig] = useState<ProcessConfig>({
    name: '',
    ffmpeg_build_id: null,
    has_video: true,
    has_audio: true,
    use_secondary_input: false,
    input1: { type: 'srt', host: '', port: '9000', mode: 'listener' },
    input2: { type: 'file', path: '' },
    video_codec_id: defaultVideoCodec.id,
    video_codec_params: getDefaultParams(defaultVideoCodec),
    audio_codec_id: defaultAudioCodec.id,
    audio_codec_params: getDefaultParams(defaultAudioCodec),
    filters: { scale: '', deinterlace: false, framerate: '' },
    output: { type: 'udp', host: '239.0.0.1', port: '1234' },
  });

  useEffect(() => {
    fetch('http://localhost:8000/builds')
      .then(r => r.json())
      .then(builds => {
        const ready = builds.filter((b: any) => b.status === 'ready');
        setAvailableBuilds(ready);
        const def = ready.find((b: any) => b.is_default);
        if (def) {
          setConfig(prev => ({ ...prev, ffmpeg_build_id: def.id }));
          setSelectedBuildOptions(def.build_options);
        }
      })
      .catch(() => {});
  }, []);

  const handleBuildChange = (buildId: number | null) => {
    setConfig(prev => ({ ...prev, ffmpeg_build_id: buildId }));
    if (buildId) {
      const build = availableBuilds.find(b => b.id === buildId);
      setSelectedBuildOptions(build?.build_options);
    } else {
      setSelectedBuildOptions(undefined);
    }
  };

  const handleSubmit = () => {
    // Transform to API-compatible structure
    const payload = {
      name: config.name,
      ffmpeg_build_id: config.ffmpeg_build_id,
      input: {
        has_video: config.has_video,
        has_audio: config.has_audio,
        use_secondary_input: config.use_secondary_input,
        input1: config.input1,
        ...(config.use_secondary_input ? { input2: config.input2 } : {}),
      },
      codec: {
        ...(config.has_video ? {
          vcodec: config.video_codec_id,
          video_params: config.video_codec_params,
        } : {}),
        ...(config.has_audio ? {
          acodec: config.audio_codec_id,
          audio_params: config.audio_codec_params,
        } : {}),
      },
      output: config.output,
      filters: config.filters,
    };
    onSubmit(payload);
  };

  // ── Section tabs ───────────────────────────────────────────────
  const sections = [
    { id: 'inputs', label: 'Sources', icon: '📡' },
    { id: 'encoding', label: 'Encoding', icon: '⚙️' },
    { id: 'filters', label: 'Filters', icon: '🎛️' },
    { id: 'output', label: 'Destination', icon: '📤' },
  ];

  return (
    <div className="flex flex-col h-full max-h-[75vh]">
      {/* ── Header: Name + Build ── */}
      <div className="space-y-3 mb-4 flex-shrink-0">
        <input
          type="text"
          className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-lime outline-none transition-all text-lg font-medium"
          placeholder="Service name (e.g. Primary Encoder Node-01)"
          value={config.name}
          onChange={e => setConfig({ ...config, name: e.target.value })}
        />
        <div className="flex gap-3 items-center">
          {availableBuilds.length > 0 && (
            <select
              className="flex-1 bg-white/5 border border-white/10 rounded-xl p-2.5 text-sm outline-none focus:border-brand-orange transition-all"
              value={config.ffmpeg_build_id ?? ''}
              onChange={e => handleBuildChange(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Default FFmpeg build</option>
              {availableBuilds.map(b => (
                <option key={b.id} value={b.id}>
                  {b.name} — FFmpeg {b.ffmpeg_version}{b.is_default ? ' ★' : ''}
                </option>
              ))}
            </select>
          )}
          {/* Stream toggles */}
          <div className="flex items-center gap-4 bg-white/5 rounded-xl px-4 py-2.5 border border-white/10">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox" checked={config.has_video}
                onChange={e => setConfig({ ...config, has_video: e.target.checked })}
                className="w-3.5 h-3.5 accent-brand-orange"
              />
              <span className={`text-xs font-bold uppercase tracking-wider ${config.has_video ? 'text-brand-orange' : 'text-text-secondary'}`}>
                Video
              </span>
            </label>
            <span className="w-px h-4 bg-white/10" />
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox" checked={config.has_audio}
                onChange={e => setConfig({ ...config, has_audio: e.target.checked })}
                className="w-3.5 h-3.5 accent-blue-400"
              />
              <span className={`text-xs font-bold uppercase tracking-wider ${config.has_audio ? 'text-blue-400' : 'text-text-secondary'}`}>
                Audio
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* ── Section tabs ── */}
      <div className="flex gap-1 mb-3 flex-shrink-0 border-b border-white/5 pb-3">
        {sections.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
              activeSection === s.id
                ? 'bg-white/10 text-white'
                : 'text-text-secondary hover:bg-white/5 hover:text-white/70'
            }`}
          >
            <span>{s.icon}</span>
            {s.label}
          </button>
        ))}
      </div>

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-4 min-h-0">

        {/* ═══ INPUTS SECTION ═══ */}
        {activeSection === 'inputs' && (
          <div className="space-y-4 animate-in fade-in duration-300">
            {/* Input 1 (Primary) */}
            <div className="glass-card p-4 !rounded-2xl">
              <InputSourcePanel
                label="Input 1 — Primary Source"
                accentColor="var(--accent-lime)"
                config={config.input1}
                onChange={input1 => setConfig({ ...config, input1 })}
              />
            </div>

            {/* Toggle: Use secondary input */}
            <div className="flex items-center gap-3 px-2">
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={config.use_secondary_input}
                  onChange={e => setConfig({ ...config, use_secondary_input: e.target.checked })}
                  className="w-4 h-4 accent-brand-lime"
                />
                <span className="text-xs font-bold uppercase tracking-wider text-text-secondary group-hover:text-white transition-colors">
                  Use separate source for Input 2
                </span>
              </label>
              <span className="text-[10px] text-white/20 italic">
                (e.g. video from SDI + audio from network)
              </span>
            </div>

            {/* Input 2 (Secondary) */}
            {config.use_secondary_input && (
              <div className="glass-card p-4 !rounded-2xl animate-in fade-in slide-in-from-top-2 duration-300">
                <InputSourcePanel
                  label="Input 2 — Secondary Source"
                  accentColor="#60a5fa"
                  config={config.input2}
                  onChange={input2 => setConfig({ ...config, input2 })}
                />
              </div>
            )}
          </div>
        )}

        {/* ═══ ENCODING SECTION ═══ */}
        {activeSection === 'encoding' && (
          <div className="space-y-4 animate-in fade-in duration-300">
            {config.has_video && (
              <div className="glass-card p-4 !rounded-2xl">
                <VideoCodecPanel
                  codecId={config.video_codec_id}
                  params={config.video_codec_params}
                  buildOptions={selectedBuildOptions}
                  onChange={(id, params) => setConfig({
                    ...config,
                    video_codec_id: id,
                    video_codec_params: params,
                  })}
                />
              </div>
            )}
            {config.has_audio && (
              <div className="glass-card p-4 !rounded-2xl">
                <AudioCodecPanel
                  codecId={config.audio_codec_id}
                  params={config.audio_codec_params}
                  buildOptions={selectedBuildOptions}
                  onChange={(id, params) => setConfig({
                    ...config,
                    audio_codec_id: id,
                    audio_codec_params: params,
                  })}
                />
              </div>
            )}
            {!config.has_video && !config.has_audio && (
              <div className="text-center py-12 text-text-secondary text-sm italic">
                Enable at least one stream (Video or Audio) to configure encoding.
              </div>
            )}
          </div>
        )}

        {/* ═══ FILTERS SECTION ═══ */}
        {activeSection === 'filters' && (
          <div className="space-y-4 animate-in fade-in duration-300">
            {config.has_video ? (
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
                      value={config.filters.scale}
                      onChange={e => setConfig({ ...config, filters: { ...config.filters, scale: e.target.value } })}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block mb-1">Framerate Convert</label>
                    <input
                      type="text"
                      placeholder="e.g. 25, 29.97, 50"
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
                      value={config.filters.framerate}
                      onChange={e => setConfig({ ...config, filters: { ...config.filters, framerate: e.target.value } })}
                    />
                  </div>
                  <div className="col-span-2 flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/5">
                    <input
                      type="checkbox" id="deinterlace-chk"
                      className="w-4 h-4 accent-brand-lime"
                      checked={config.filters.deinterlace}
                      onChange={e => setConfig({ ...config, filters: { ...config.filters, deinterlace: e.target.checked } })}
                    />
                    <label htmlFor="deinterlace-chk" className="text-sm font-medium cursor-pointer">
                      Enable Deinterlacing (YADIF)
                    </label>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-text-secondary text-sm italic">
                Video filters are only available when video stream is enabled.
              </div>
            )}
          </div>
        )}

        {/* ═══ OUTPUT SECTION ═══ */}
        {activeSection === 'output' && (
          <div className="animate-in fade-in duration-300">
            <div className="glass-card p-4 !rounded-2xl">
              <DestinationPanel
                config={config.output}
                hasVideo={config.has_video}
                hasAudio={config.has_audio}
                onChange={output => setConfig({ ...config, output })}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Sticky footer ── */}
      <div className="flex gap-4 pt-4 mt-3 border-t border-white/5 flex-shrink-0">
        <button
          onClick={onCancel}
          className="flex-1 py-3 bg-white/5 border border-white/10 rounded-xl font-bold hover:bg-white/10 transition-all uppercase tracking-widest text-sm"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!config.name.trim()}
          className="flex-1 py-3 bg-brand-lime text-black rounded-xl font-black hover:scale-[1.02] active:scale-[0.98] transition-all uppercase tracking-widest text-sm shadow-xl shadow-brand-lime/20 disabled:opacity-30 disabled:hover:scale-100"
        >
          Deploy Service
        </button>
      </div>
    </div>
  );
};

export default ProcessConfigForm;
