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
    advanced: {
      realtime: boolean | null;
      stream_loop: number | null;
      threads: number;
      hwaccel: string;
      hwaccel_output_format: string;
      probesize: string;
      thread_queue_size: number;
    };
  };

  // Output
  output: OutputConfig;

  // Watchdog & Auto-start Settings
  auto_start: boolean;
  watchdog_enabled: boolean;
  watchdog_retries: number;

  // Task scheduling
  schedule_type: string;
  schedule_cron: string;
  schedule_datetime: string;
  duration_type: string;
  duration_seconds: number;
  duration_end_time: string;
  retry_max: number;
  retry_delay: number;
}

interface ProcessConfigFormProps {
  onCancel: () => void;
  onSubmit: (config: any) => void;
  onSaveAs?: (config: any) => void;
  initialConfig?: any;
  isTask?: boolean;
}

// ── Component ────────────────────────────────────────────────────

const ProcessConfigForm: React.FC<ProcessConfigFormProps> = ({ onCancel, onSubmit, onSaveAs, initialConfig, isTask = false }) => {
  const [availableBuilds, setAvailableBuilds] = useState<any[]>([]);
  const [selectedBuildOptions, setSelectedBuildOptions] = useState<Record<string, boolean> | undefined>();
  const [activeSection, setActiveSection] = useState<string>('inputs');
  const [previewCmd, setPreviewCmd] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  const defaultVideoCodec = VIDEO_CODECS[0];
  const defaultAudioCodec = AUDIO_CODECS[0];

  const getInitialState = (): ProcessConfig => {
    if (initialConfig) {
      const inputCfg = initialConfig.input_config || {};
      const codecCfg = initialConfig.codec_config || {};
      const filterCfg = initialConfig.filter_config || {};
      const outputCfg = initialConfig.output_config || {};

      const vCodecDef = VIDEO_CODECS.find(c => c.id === (codecCfg.vcodec || defaultVideoCodec.id)) || defaultVideoCodec;
      const aCodecDef = AUDIO_CODECS.find(c => c.id === (codecCfg.acodec || defaultAudioCodec.id)) || defaultAudioCodec;

      return {
        name: initialConfig.name || '',
        ffmpeg_build_id: initialConfig.ffmpeg_build_id ?? null,
        has_video: inputCfg.has_video !== false,
        has_audio: inputCfg.has_audio !== false,
        use_secondary_input: !!inputCfg.use_secondary_input,
        input1: inputCfg.input1 || { type: 'srt', host: '', port: '9000', mode: 'listener' },
        input2: inputCfg.input2 || { type: 'file', path: '' },
        video_codec_id: vCodecDef.id,
        video_codec_params: { ...getDefaultParams(vCodecDef), ...(codecCfg.video_params || {}) },
        audio_codec_id: aCodecDef.id,
        audio_codec_params: { ...getDefaultParams(aCodecDef), ...(codecCfg.audio_params || {}) },
        filters: {
          scale: filterCfg.scale || '',
          deinterlace: !!filterCfg.deinterlace,
          framerate: filterCfg.framerate || '',
          advanced: {
            realtime: (filterCfg.advanced?.realtime !== undefined) ? filterCfg.advanced.realtime : null,
            stream_loop: filterCfg.advanced?.stream_loop ?? null,
            threads: filterCfg.advanced?.threads ?? 0,
            hwaccel: filterCfg.advanced?.hwaccel ?? 'none',
            hwaccel_output_format: filterCfg.advanced?.hwaccel_output_format ?? '',
            probesize: filterCfg.advanced?.probesize ?? '',
            thread_queue_size: filterCfg.advanced?.thread_queue_size ?? 0,
          },
        },
        output: outputCfg || { type: 'udp', host: '239.0.0.1', port: '1234' },
        auto_start: !!initialConfig.auto_start,
        watchdog_enabled: !!initialConfig.watchdog_enabled,
        watchdog_retries: initialConfig.watchdog_retries ?? 5,
        schedule_type: initialConfig.schedule_type || 'manual',
        schedule_cron: initialConfig.schedule_cron || '*/30 * * * *',
        schedule_datetime: initialConfig.schedule_datetime ? initialConfig.schedule_datetime.substring(0, 16) : '',
        duration_type: initialConfig.duration_type || 'input_dependent',
        duration_seconds: initialConfig.duration_seconds ?? 60,
        duration_end_time: initialConfig.duration_end_time ? initialConfig.duration_end_time.substring(0, 16) : '',
        retry_max: initialConfig.retry_policy?.max_retries ?? 3,
        retry_delay: initialConfig.retry_policy?.retry_delay ?? 10
      };
    }
    return {
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
      filters: {
        scale: '', deinterlace: false, framerate: '',
        advanced: {
          realtime: null, stream_loop: null, threads: 0,
          hwaccel: 'none', hwaccel_output_format: '', probesize: '', thread_queue_size: 0,
        },
      },
      output: { type: 'udp', host: '239.0.0.1', port: '1234' },
      auto_start: false,
      watchdog_enabled: false,
      watchdog_retries: 5,
      schedule_type: 'manual',
      schedule_cron: '*/30 * * * *',
      schedule_datetime: '',
      duration_type: 'input_dependent',
      duration_seconds: 60,
      duration_end_time: '',
      retry_max: 3,
      retry_delay: 10
    };
  };

  const [config, setConfig] = useState<ProcessConfig>(getInitialState);

  useEffect(() => {
    fetch('http://localhost:8000/builds')
      .then(r => r.json())
      .then(builds => {
        const ready = builds.filter((b: any) => b.status === 'ready');
        setAvailableBuilds(ready);
        
        const currentBuildId = config.ffmpeg_build_id;
        if (currentBuildId) {
          const selected = ready.find((b: any) => b.id === currentBuildId);
          if (selected) {
            setSelectedBuildOptions(selected.build_options);
            return;
          }
        }

        const def = ready.find((b: any) => b.is_default);
        if (def && !initialConfig) {
          setConfig(prev => ({ ...prev, ffmpeg_build_id: def.id }));
          setSelectedBuildOptions(def.build_options);
        }
      })
      .catch(() => {});
  }, [config.ffmpeg_build_id, initialConfig]);

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
      input_config: {
        has_video: config.has_video,
        has_audio: config.has_audio,
        use_secondary_input: config.use_secondary_input,
        input1: config.input1,
        ...(config.use_secondary_input ? { input2: config.input2 } : {}),
      },
      codec_config: {
        ...(config.has_video ? {
          vcodec: config.video_codec_id,
          video_params: config.video_codec_params,
        } : {}),
        ...(config.has_audio ? {
          acodec: config.audio_codec_id,
          audio_params: config.audio_codec_params,
        } : {}),
      },
      output_config: config.output,
      filter_config: {
        scale: config.filters.scale,
        deinterlace: config.filters.deinterlace,
        framerate: config.filters.framerate,
        advanced: config.filters.advanced,
      },
      ...(isTask ? {
        schedule_type: config.schedule_type,
        schedule_cron: config.schedule_type === 'recurring' ? config.schedule_cron : null,
        schedule_datetime: config.schedule_type === 'one_shot' && config.schedule_datetime ? new Date(config.schedule_datetime).toISOString() : null,
        duration_type: config.duration_type,
        duration_seconds: config.duration_type === 'timer' ? Number(config.duration_seconds) : null,
        duration_end_time: config.duration_type === 'end_time' && config.duration_end_time ? new Date(config.duration_end_time).toISOString() : null,
        retry_policy: {
          max_retries: Number(config.retry_max),
          retry_delay: Number(config.retry_delay)
        }
      } : {
        auto_start: config.auto_start,
        watchdog_enabled: config.watchdog_enabled,
        watchdog_retries: config.watchdog_retries,
      })
    };
    onSubmit(payload);
  };

  const handleSaveAs = () => {
    if (!onSaveAs) return;
    const payload = {
      name: `${config.name} (Copy)`,
      ffmpeg_build_id: config.ffmpeg_build_id,
      input_config: {
        has_video: config.has_video,
        has_audio: config.has_audio,
        use_secondary_input: config.use_secondary_input,
        input1: config.input1,
        ...(config.use_secondary_input ? { input2: config.input2 } : {}),
      },
      codec_config: {
        ...(config.has_video ? {
          vcodec: config.video_codec_id,
          video_params: config.video_codec_params,
        } : {}),
        ...(config.has_audio ? {
          acodec: config.audio_codec_id,
          audio_params: config.audio_codec_params,
        } : {}),
      },
      output_config: config.output,
      filter_config: {
        scale: config.filters.scale,
        deinterlace: config.filters.deinterlace,
        framerate: config.filters.framerate,
        advanced: config.filters.advanced,
      },
      ...(isTask ? {
        schedule_type: config.schedule_type,
        schedule_cron: config.schedule_type === 'recurring' ? config.schedule_cron : null,
        schedule_datetime: config.schedule_type === 'one_shot' && config.schedule_datetime ? new Date(config.schedule_datetime).toISOString() : null,
        duration_type: config.duration_type,
        duration_seconds: config.duration_type === 'timer' ? Number(config.duration_seconds) : null,
        duration_end_time: config.duration_type === 'end_time' && config.duration_end_time ? new Date(config.duration_end_time).toISOString() : null,
        retry_policy: {
          max_retries: Number(config.retry_max),
          retry_delay: Number(config.retry_delay)
        }
      } : {
        auto_start: config.auto_start,
        watchdog_enabled: config.watchdog_enabled,
        watchdog_retries: config.watchdog_retries,
      })
    };
    onSaveAs(payload);
  };

  const handlePreview = async () => {
    setIsPreviewing(true);
    const previewUrl = isTask ? 'http://localhost:8000/tasks/preview-cmd' : 'http://localhost:8000/processes/preview-cmd';
    const payload = {
      name: config.name || 'preview',
      ffmpeg_build_id: config.ffmpeg_build_id,
      input_config: {
        has_video: config.has_video,
        has_audio: config.has_audio,
        use_secondary_input: config.use_secondary_input,
        input1: config.input1,
        ...(config.use_secondary_input ? { input2: config.input2 } : {}),
      },
      codec_config: {
        ...(config.has_video ? {
          vcodec: config.video_codec_id,
          video_params: config.video_codec_params,
        } : {}),
        ...(config.has_audio ? {
          acodec: config.audio_codec_id,
          audio_params: config.audio_codec_params,
        } : {}),
      },
      output_config: config.output,
      filter_config: {
        scale: config.filters.scale,
        deinterlace: config.filters.deinterlace,
        framerate: config.filters.framerate,
        advanced: config.filters.advanced,
      },
      ...(isTask ? {
        schedule_type: config.schedule_type,
        schedule_cron: config.schedule_type === 'recurring' ? config.schedule_cron : null,
        schedule_datetime: config.schedule_type === 'one_shot' && config.schedule_datetime ? new Date(config.schedule_datetime).toISOString() : null,
        duration_type: config.duration_type,
        duration_seconds: config.duration_type === 'timer' ? Number(config.duration_seconds) : null,
        duration_end_time: config.duration_type === 'end_time' && config.duration_end_time ? new Date(config.duration_end_time).toISOString() : null,
        retry_policy: {
          max_retries: Number(config.retry_max),
          retry_delay: Number(config.retry_delay)
        }
      } : {
        type: 'service',
        auto_start: false,
        watchdog_enabled: false,
        watchdog_retries: 5,
      })
    };

    try {
      const res = await fetch(previewUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        setPreviewCmd(data.command);
      }
    } catch (err) {
      console.error('Failed to get preview command', err);
    } finally {
      setIsPreviewing(false);
    }
  };

  // ── Section tabs ───────────────────────────────────────────────
  const sections = [
    { id: 'inputs', label: 'Sources', icon: '📡' },
    { id: 'encoding', label: 'Encoding', icon: '⚙️' },
    { id: 'filters', label: 'Filters', icon: '🎛️' },
    { id: 'output', label: 'Destination', icon: '📤' },
    { id: 'system', label: isTask ? 'Schedule & Limits' : 'System & Watchdog', icon: '🛡️' },
  ];

  return (
    <div className="flex flex-col h-full max-h-[75vh]">
      {/* ── Header: Name + Build ── */}
      <div className="space-y-3 mb-4 flex-shrink-0">
        <input
          type="text"
          className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-lime outline-none transition-all text-lg font-medium"
          placeholder={isTask ? "Task name (e.g. Daily Transcode of Stream)" : "Service name (e.g. Primary Encoder Node-01)"}
          value={config.name}
          onChange={e => setConfig({ ...config, name: e.target.value })}
        />
        <div className="flex gap-3 items-center">
          {availableBuilds.length > 0 && (
            <select
              className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-xl p-2.5 text-sm outline-none focus:border-brand-orange transition-all truncate"
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
          <div className="flex items-center gap-4 bg-white/5 rounded-xl px-4 py-2.5 border border-white/10 flex-shrink-0">
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
      <div className="flex-1 overflow-y-auto pr-3 space-y-4 min-h-0 custom-scrollbar">

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
        {/* ═══ SYSTEM & WATCHDOG SECTION ═══ */}
        {activeSection === 'system' && (
          <div className="space-y-4 animate-in fade-in duration-300">
            {isTask ? (
              <div className="glass-card p-4 !rounded-2xl space-y-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2 h-2 rounded-full bg-brand-lime" />
                  <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider">Trigger & Scheduling</h4>
                </div>

                {/* Trigger Mechanism */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">Trigger Mechanism</label>
                    <select
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
                      value={config.schedule_type}
                      onChange={e => setConfig({...config, schedule_type: e.target.value})}
                    >
                      <option value="manual">Manual Trigger Only</option>
                      <option value="one_shot">One-shot (Target DateTime)</option>
                      <option value="recurring">Recurring (Cron Schedule)</option>
                    </select>
                  </div>

                  {/* Cron Expression (Recurring) */}
                  {config.schedule_type === 'recurring' && (
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-brand-lime tracking-wider block">Cron Expression</label>
                      <input 
                        type="text" required
                        className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none focus:border-brand-lime transition-all text-brand-lime font-mono"
                        placeholder="e.g. */15 * * * *"
                        value={config.schedule_cron}
                        onChange={e => setConfig({...config, schedule_cron: e.target.value})}
                      />
                    </div>
                  )}

                  {/* One-shot DateTime */}
                  {config.schedule_type === 'one_shot' && (
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-brand-orange tracking-wider block">Target Date & Time</label>
                      <input 
                        type="datetime-local" required
                        className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none focus:border-brand-orange transition-all text-white"
                        value={config.schedule_datetime}
                        onChange={e => setConfig({...config, schedule_datetime: e.target.value})}
                      />
                    </div>
                  )}
                </div>

                {/* Task duration limit */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-white/5">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">Duration Type</label>
                    <select
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
                      value={config.duration_type}
                      onChange={e => setConfig({...config, duration_type: e.target.value})}
                    >
                      <option value="input_dependent">Input Dependent (FFmpeg processes naturally)</option>
                      <option value="timer">Max Duration Timer</option>
                      <option value="end_time">Target Datetime (Stop at absolute time)</option>
                    </select>
                  </div>

                  {config.duration_type === 'timer' && (
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">Duration Limit (Seconds)</label>
                      <input
                        type="number" min="1"
                        className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
                        value={config.duration_seconds}
                        onChange={e => setConfig({...config, duration_seconds: Number(e.target.value)})}
                      />
                    </div>
                  )}

                  {config.duration_type === 'end_time' && (
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">Target Stop Datetime</label>
                      <input
                        type="datetime-local" required
                        className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none text-white"
                        value={config.duration_end_time || ''}
                        onChange={e => setConfig({...config, duration_end_time: e.target.value})}
                      />
                    </div>
                  )}
                </div>

                {/* Retry policy */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-white/5">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">Maximum Retries on Failure</label>
                    <input
                      type="number" min="0" max="10"
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
                      value={config.retry_max}
                      onChange={e => setConfig({...config, retry_max: Number(e.target.value)})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">Retry Delay (Seconds)</label>
                    <input
                      type="number" min="1" max="300"
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
                      value={config.retry_delay}
                      onChange={e => setConfig({...config, retry_delay: Number(e.target.value)})}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="glass-card p-4 !rounded-2xl space-y-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2 h-2 rounded-full bg-brand-lime" />
                  <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider">Process Lifecycle Settings</h4>
                </div>

                {/* Auto Start Toggle */}
                <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-white">Auto-start on boot</span>
                    <span className="text-xs text-text-secondary">Launch this service automatically when the application starts.</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.auto_start}
                      onChange={e => setConfig({ ...config, auto_start: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-lime"></div>
                  </label>
                </div>

                {/* Watchdog Toggle */}
                <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-white">Enable Watchdog</span>
                    <span className="text-xs text-text-secondary">Monitor process health and auto-restart on unexpected crashes.</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.watchdog_enabled}
                      onChange={e => setConfig({ ...config, watchdog_enabled: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-lime"></div>
                  </label>
                </div>

                {/* Watchdog Retries */}
                {config.watchdog_enabled && (
                  <div className="p-3 bg-white/5 rounded-xl border border-white/5 space-y-3 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium text-white">Infinite Restart Attempts</span>
                        <span className="text-xs text-text-secondary">Keep trying to restart the process indefinitely.</span>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={config.watchdog_retries === -1}
                          onChange={e => setConfig({
                            ...config,
                            watchdog_retries: e.target.checked ? -1 : 5
                          })}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-lime"></div>
                      </label>
                    </div>

                    {config.watchdog_retries !== -1 && (
                      <div className="flex items-center gap-3 pt-2 border-t border-white/5 animate-in fade-in duration-200">
                        <label className="text-xs font-bold uppercase tracking-wider text-text-secondary block">
                          Maximum consecutive retries:
                         </label>
                        <input
                          type="number"
                          min="1"
                          max="100"
                          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none w-24 focus:border-brand-lime"
                          value={config.watchdog_retries}
                          onChange={e => setConfig({
                            ...config,
                            watchdog_retries: Math.max(1, parseInt(e.target.value) || 1)
                          })}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ═══ ADVANCED FFMPEG FLAGS ═══ */}
            <div className="glass-card p-4 !rounded-2xl space-y-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-full bg-brand-orange" />
                <h4 className="text-brand-orange font-bold text-xs uppercase tracking-wider">Advanced FFmpeg Flags</h4>
                <span className="text-[10px] text-white/20 italic ml-auto">Speed control & resource limits</span>
              </div>

              {/* Realtime (-re) */}
              <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-white">Realtime Playback <code className="text-[10px] text-brand-orange bg-white/5 px-1.5 py-0.5 rounded ml-1">-re</code></span>
                  <span className="text-xs text-text-secondary">
                    Throttle input read to native framerate. Essential for file/lavfi sources in live streaming.
                    {config.filters.advanced.realtime === null && (
                      <span className="text-brand-lime ml-1">(auto: {['file', 'lavfi_video', 'lavfi_audio'].includes(config.input1.type) ? 'ON' : 'OFF'})</span>
                    )}
                  </span>
                </div>
                <select
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none w-28 text-center"
                  value={config.filters.advanced.realtime === null ? 'auto' : config.filters.advanced.realtime ? 'on' : 'off'}
                  onChange={e => {
                    const val = e.target.value;
                    setConfig({
                      ...config,
                      filters: { ...config.filters, advanced: {
                        ...config.filters.advanced,
                        realtime: val === 'auto' ? null : val === 'on',
                      }},
                    });
                  }}
                >
                  <option value="auto">Auto</option>
                  <option value="on">Always ON</option>
                  <option value="off">Always OFF</option>
                </select>
              </div>

              {/* Stream Loop — only for file inputs */}
              {config.input1.type === 'file' && (
                <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5 animate-in fade-in duration-200">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-white">Input Loop <code className="text-[10px] text-brand-orange bg-white/5 px-1.5 py-0.5 rounded ml-1">-stream_loop</code></span>
                    <span className="text-xs text-text-secondary">Repeat file input. -1 = infinite (24/7 playout). 0 = off.</span>
                  </div>
                  <input
                    type="number" min="-1" max="9999"
                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none w-24 text-center font-mono focus:border-brand-orange"
                    value={config.filters.advanced.stream_loop ?? 0}
                    onChange={e => setConfig({
                      ...config,
                      filters: { ...config.filters, advanced: {
                        ...config.filters.advanced,
                        stream_loop: e.target.value === '' ? null : parseInt(e.target.value),
                      }},
                    })}
                  />
                </div>
              )}

              {/* Threads + HW Accel row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block mb-1">
                    Threads <code className="text-brand-orange">-threads</code>
                  </label>
                  <input
                    type="number" min="0" max="128" placeholder="0 = auto"
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono focus:border-brand-orange"
                    value={config.filters.advanced.threads || ''}
                    onChange={e => setConfig({
                      ...config,
                      filters: { ...config.filters, advanced: {
                        ...config.filters.advanced,
                        threads: parseInt(e.target.value) || 0,
                      }},
                    })}
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block mb-1">
                    HW Acceleration <code className="text-brand-orange">-hwaccel</code>
                  </label>
                  <select
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none focus:border-brand-orange"
                    value={config.filters.advanced.hwaccel}
                    onChange={e => setConfig({
                      ...config,
                      filters: { ...config.filters, advanced: {
                        ...config.filters.advanced,
                        hwaccel: e.target.value,
                        hwaccel_output_format: e.target.value === 'none' ? '' : e.target.value,
                      }},
                    })}
                  >
                    <option value="none">None (Software)</option>
                    <option value="vaapi">VAAPI (Intel/AMD)</option>
                    <option value="cuda">CUDA (NVIDIA)</option>
                    <option value="qsv">Quick Sync (Intel)</option>
                    <option value="auto">Auto-detect</option>
                  </select>
                </div>
              </div>

              {/* Probesize + Thread Queue Size row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block mb-1">
                    Probe Size <code className="text-brand-orange">-probesize</code>
                  </label>
                  <input
                    type="text" placeholder="e.g. 5M, 20M"
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono focus:border-brand-orange"
                    value={config.filters.advanced.probesize}
                    onChange={e => setConfig({
                      ...config,
                      filters: { ...config.filters, advanced: {
                        ...config.filters.advanced,
                        probesize: e.target.value,
                      }},
                    })}
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block mb-1">
                    Thread Queue <code className="text-brand-orange">-thread_queue_size</code>
                  </label>
                  <input
                    type="number" min="0" max="65536" placeholder="0 = default"
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono focus:border-brand-orange"
                    value={config.filters.advanced.thread_queue_size || ''}
                    onChange={e => setConfig({
                      ...config,
                      filters: { ...config.filters, advanced: {
                        ...config.filters.advanced,
                        thread_queue_size: parseInt(e.target.value) || 0,
                      }},
                    })}
                  />
                </div>
              </div>
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
          onClick={handlePreview}
          disabled={isPreviewing}
          className="flex-1 py-3 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-xl font-bold hover:bg-blue-500/30 transition-all uppercase tracking-widest text-sm"
        >
          {isPreviewing ? 'Wait...' : 'Preview CLI'}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!config.name.trim()}
          className="flex-1 py-3 bg-brand-lime text-black rounded-xl font-black hover:scale-[1.02] active:scale-[0.98] transition-all uppercase tracking-widest text-sm shadow-xl shadow-brand-lime/20 disabled:opacity-30 disabled:hover:scale-100"
        >
          {initialConfig ? 'Save Changes' : (isTask ? 'Create Task' : 'Deploy Service')}
        </button>
        {initialConfig && onSaveAs && (
          <button
            onClick={handleSaveAs}
            disabled={!config.name.trim()}
            className="flex-1 py-3 bg-brand-orange/20 text-brand-orange border border-brand-orange/30 rounded-xl font-bold hover:bg-brand-orange/30 transition-all uppercase tracking-widest text-sm"
          >
            Save as New
          </button>
        )}
      </div>

      {/* ── Preview Modal ── */}
      {previewCmd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#111] border border-white/10 rounded-2xl p-6 w-full max-w-3xl shadow-2xl flex flex-col">
            <h3 className="text-xl font-black text-white mb-4">FFmpeg Command Preview</h3>
            <div className="bg-black border border-white/10 p-4 rounded-xl mb-6 overflow-x-auto custom-scrollbar font-mono text-sm text-brand-lime break-all">
              {previewCmd}
            </div>
            <div className="flex justify-end gap-3 mt-auto">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(previewCmd);
                }}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg font-bold transition-all"
              >
                Copy to Clipboard
              </button>
              <button
                onClick={() => setPreviewCmd(null)}
                className="px-4 py-2 bg-brand-orange text-black rounded-lg font-bold hover:bg-orange-400 transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProcessConfigForm;
