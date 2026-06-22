import React, { useState, useEffect } from 'react';
import InputSourcePanel from './source/InputSourcePanel';
import type { InputSourceConfig } from './source/InputSourcePanel';
import VideoCodecPanel from './codec/VideoCodecPanel';
import AudioCodecPanel from './codec/AudioCodecPanel';
import { getDefaultParams, VIDEO_CODECS, AUDIO_CODECS } from './codec/codecRegistry';
import type { SystemCapabilities } from './codec/codecRegistry';
import DestinationPanel from './destination/DestinationPanel';
import type { OutputConfig } from './destination/DestinationPanel';
import { ResourcePipelineDiagram } from './codec/ResourcePipelineDiagram';

import FiltersFormSection from './form/FiltersFormSection';
import SchedulingFormSection from './form/SchedulingFormSection';
import LifecycleFormSection from './form/LifecycleFormSection';
import AdvancedFlagsFormSection from './form/AdvancedFlagsFormSection';
import PreviewCmdModal from './modals/PreviewCmdModal';
import { SourceIcon, GearIcon, KnobsIcon, DestinationIcon, ShieldIcon, ToolsIcon } from './Icons';

const VIDEO_ALLOWED_TYPES = ['file', 'srt', 'ndi', 'udp', 'rtp', 'decklink', 'v4l2', 'lavfi_video', 'rtmp', 'hls'];
const AUDIO_ALLOWED_TYPES = ['file', 'srt', 'ndi', 'udp', 'rtp', 'decklink', 'alsa', 'lavfi_audio', 'http_audio', 'rtmp', 'hls'];

interface ProcessConfig {
  name: string;
  alias: string;
  ffmpeg_build_id: number | null;
  has_video: boolean;
  has_audio: boolean;
  use_secondary_input: boolean;

  input1: InputSourceConfig;
  input2: InputSourceConfig;

  video_codec_id: string;
  video_codec_params: Record<string, string | number | boolean>;
  audio_codec_id: string;
  audio_codec_params: Record<string, string | number | boolean>;

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
    highpass?: string;
    lowpass?: string;
    equalizer?: {
      enabled?: boolean;
      bands?: Record<string, number>;
    };
    compressor?: boolean;
    volume?: string;
    aresample?: boolean;
    overlays?: any[];
  };

  output: OutputConfig;

  auto_start: boolean;
  watchdog_enabled: boolean;
  watchdog_retries: number;

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

const ProcessConfigForm: React.FC<ProcessConfigFormProps> = ({ onCancel, onSubmit, onSaveAs, initialConfig, isTask = false }) => {
  const [availableBuilds, setAvailableBuilds] = useState<any[]>([]);
  const [selectedBuildOptions, setSelectedBuildOptions] = useState<Record<string, boolean> | undefined>();
  const [activeSection, setActiveSection] = useState<string>('system');
  const [previewCmd, setPreviewCmd] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [systemCapabilities, setSystemCapabilities] = useState<SystemCapabilities | undefined>();

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
        alias: initialConfig.alias || '',
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
          highpass: filterCfg.highpass || '',
          lowpass: filterCfg.lowpass || '',
          equalizer: filterCfg.equalizer || { enabled: false, bands: { '60': 0, '230': 0, '910': 0, '4000': 0, '14000': 0 } },
          compressor: !!filterCfg.compressor,
          volume: filterCfg.volume || '',
          aresample: !!filterCfg.aresample,
          overlays: filterCfg.overlays || [],
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
      alias: '',
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
        highpass: '',
        lowpass: '',
        equalizer: { enabled: false, bands: { '60': 0, '230': 0, '910': 0, '4000': 0, '14000': 0 } },
        compressor: false,
        volume: '',
        aresample: false,
        overlays: [],
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
    fetch('/builds')
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

  useEffect(() => {
    fetch('/system/capabilities')
      .then(r => r.json())
      .then(caps => setSystemCapabilities(caps))
      .catch(() => {});
  }, []);

  const isDeckLinkOutput = config.output.type === 'decklink';
  const hasDeckLinkCodecIncompatibility = isDeckLinkOutput && (
    (config.has_video && config.video_codec_id !== 'v210' && config.video_codec_id !== 'rawvideo') ||
    (config.has_audio && config.audio_codec_id !== 'pcm_s16le' && config.audio_codec_id !== 'pcm_s24le')
  );

  const handleBuildChange = (buildId: number | null) => {
    setConfig(prev => ({ ...prev, ffmpeg_build_id: buildId }));
    if (buildId) {
      const build = availableBuilds.find(b => b.id === buildId);
      setSelectedBuildOptions(build?.build_options);
    } else {
      setSelectedBuildOptions(undefined);
    }
  };

  const createPayload = () => {
    return {
      name: config.name,
      alias: config.alias ? config.alias.trim() : null,
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
        highpass: config.filters.highpass || null,
        lowpass: config.filters.lowpass || null,
        equalizer: config.filters.equalizer || null,
        compressor: config.filters.compressor || false,
        volume: config.filters.volume || null,
        aresample: config.filters.aresample || false,
        overlays: config.filters.overlays || [],
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
  };

  const handleSubmit = () => {
    onSubmit(createPayload());
  };

  const handleSaveAs = () => {
    if (!onSaveAs) return;
    const payload = createPayload();
    payload.name = `${config.name} (Copy)`;
    if (payload.alias) {
      payload.alias = `${config.alias.slice(0, 7)}_copy`.slice(0, 12);
    }
    onSaveAs(payload);
  };

  const handlePreview = async () => {
    setIsPreviewing(true);
    const previewUrl = isTask ? '/tasks/preview-cmd' : '/processes/preview-cmd';
    const payload = {
      ...createPayload(),
      ...(!isTask ? { type: 'service' } : {})
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

  const sections = [
    { id: 'system', label: 'General', icon: <ShieldIcon size={16} /> },
    { id: 'inputs', label: 'Input', icon: <SourceIcon size={16} /> },
    { id: 'output', label: 'Output', icon: <DestinationIcon size={16} /> },
    { id: 'encoding', label: 'Codecs', icon: <GearIcon size={16} /> },
    { id: 'filters', label: 'Filters', icon: <KnobsIcon size={16} /> },
  ];

  return (
    <div className="flex flex-col h-full max-h-[75vh]">
      {/* ── Header: Name + Build ── */}
      <div className="space-y-3 mb-4 flex-shrink-0">
        <div className="flex gap-3">
          <div className="flex-[3]">
            <input
              type="text"
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-lime outline-none transition-all text-lg font-medium"
              placeholder={isTask ? "Task name (e.g. Daily Transcode of Stream)" : "Service name (e.g. Primary Encoder Node-01)"}
              value={config.name}
              onChange={e => setConfig({ ...config, name: e.target.value })}
            />
          </div>
          <div className="w-[180px] flex-shrink-0">
            <input
              type="text"
              maxLength={12}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-lime outline-none transition-all text-lg font-medium text-brand-lime placeholder-white/20"
              placeholder="LCD Alias"
              title="Alias for LCD display (max 12 alphanumeric characters, spaces, hyphens, underscores)"
              value={config.alias}
              onChange={e => {
                const val = e.target.value.replace(/[^a-zA-Z0-9\s-_]/g, '').slice(0, 12);
                setConfig({ ...config, alias: val });
              }}
            />
          </div>
        </div>
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
                onChange={e => {
                  const val = e.target.checked;
                  const nextSecondary = val && config.has_audio ? config.use_secondary_input : false;
                  let nextInput1 = config.input1;
                  if (!val && config.has_audio) {
                    if (!AUDIO_ALLOWED_TYPES.includes(nextInput1.type)) {
                      nextInput1 = { ...nextInput1, type: 'file' };
                    }
                  } else if (val && !config.has_audio) {
                    if (!VIDEO_ALLOWED_TYPES.includes(nextInput1.type)) {
                      nextInput1 = { ...nextInput1, type: 'file' };
                    }
                  }
                  setConfig({ 
                    ...config, 
                    has_video: val, 
                    use_secondary_input: nextSecondary,
                    input1: nextInput1
                  });
                }}
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
                onChange={e => {
                  const val = e.target.checked;
                  const nextSecondary = config.has_video && val ? config.use_secondary_input : false;
                  let nextInput1 = config.input1;
                  if (config.has_video && !val) {
                    if (!VIDEO_ALLOWED_TYPES.includes(nextInput1.type)) {
                      nextInput1 = { ...nextInput1, type: 'file' };
                    }
                  } else if (!config.has_video && val) {
                    if (!AUDIO_ALLOWED_TYPES.includes(nextInput1.type)) {
                      nextInput1 = { ...nextInput1, type: 'file' };
                    }
                  }
                  setConfig({ 
                    ...config, 
                    has_audio: val, 
                    use_secondary_input: nextSecondary,
                    input1: nextInput1
                  });
                }}
                className="w-3.5 h-3.5 accent-blue-400"
              />
              <span className={`text-xs font-bold uppercase tracking-wider ${config.has_audio ? 'text-blue-400' : 'text-text-secondary'}`}>
                Audio
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* ── Persistent Transcode Flow Diagram ── */}
      {config.has_video && (
        <ResourcePipelineDiagram
          hwaccel={config.filters.advanced.hwaccel}
          isVram={
            config.filters.advanced.hwaccel_output_format !== '' &&
            config.filters.advanced.hwaccel_output_format !== 'system'
          }
          codecId={config.video_codec_id}
          hasCpuFilters={!!(config.filters.overlays && config.filters.overlays.length > 0)}
        />
      )}

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
            <span className="flex items-center justify-center">{s.icon}</span>
            {s.label}
          </button>
        ))}
      </div>

      {hasDeckLinkCodecIncompatibility && (
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-xs text-amber-300 mb-3 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex items-start gap-2.5">
            <span className="text-sm mt-0.5 text-amber-400">
              <ShieldIcon size={14} />
            </span>
            <div>
              <strong>Configuración de códec incompatible:</strong> Has seleccionado salida física DeckLink, pero la codificación de vídeo/audio configurada no es compatible con el hardware (requiere vídeo sin compresión v210 o rawvideo/uyvy422, y audio PCM).
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setConfig(prev => ({
                ...prev,
                video_codec_id: prev.has_video ? 'v210' : prev.video_codec_id,
                video_codec_params: prev.has_video ? {} : prev.video_codec_params,
                audio_codec_id: prev.has_audio ? 'pcm_s16le' : prev.audio_codec_id,
                audio_codec_params: prev.has_audio ? { ar: '48000', ac: '2' } : prev.audio_codec_params,
              }));
            }}
            className="flex-shrink-0 flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-black font-black px-3 py-1.5 rounded-lg transition-colors cursor-pointer text-xs"
          >
            <ToolsIcon size={14} /> Ajustar a compatible
          </button>
        </div>
      )}

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto pr-3 space-y-4 min-h-0 custom-scrollbar">

        {/* ═══ INPUTS SECTION ═══ */}
        {activeSection === 'inputs' && (
          <div className="space-y-4 animate-in fade-in duration-300">
            {/* Input 1 (Primary) */}
            <div className="glass-card p-4 !rounded-2xl">
              <InputSourcePanel
                label={
                  config.use_secondary_input
                    ? "Input 1 — Video Source"
                    : config.has_video && !config.has_audio
                    ? "Input 1 — Video Source"
                    : !config.has_video && config.has_audio
                    ? "Input 1 — Audio Source"
                    : "Primary Source (Audio & Video)"
                }
                accentColor="var(--accent-lime)"
                config={config.input1}
                allowedTypes={
                  !config.has_audio && config.has_video
                    ? VIDEO_ALLOWED_TYPES
                    : config.has_video && !config.has_audio
                    ? VIDEO_ALLOWED_TYPES
                    : config.use_secondary_input
                    ? VIDEO_ALLOWED_TYPES
                    : !config.has_video && config.has_audio
                    ? AUDIO_ALLOWED_TYPES
                    : undefined
                }
                onChange={input1 => setConfig({ ...config, input1 })}
                systemCapabilities={systemCapabilities}
                onSyncAlsaAudio={alsaDevice => {
                  setConfig(prev => ({
                    ...prev,
                    use_secondary_input: true,
                    input2: {
                      ...prev.input2,
                      type: 'alsa',
                      device: alsaDevice
                    }
                  }));
                }}
              />
            </div>

            {/* Toggle: Use secondary input */}
            {config.has_video && config.has_audio && (
              <div className="flex items-center gap-3 px-2">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={config.use_secondary_input}
                    onChange={e => {
                      const val = e.target.checked;
                      let nextInput1 = config.input1;
                      let nextInput2 = config.input2;
                      if (val) {
                        if (!VIDEO_ALLOWED_TYPES.includes(nextInput1.type)) {
                          nextInput1 = { ...nextInput1, type: 'file' };
                        }
                        if (!AUDIO_ALLOWED_TYPES.includes(nextInput2.type)) {
                          nextInput2 = { ...nextInput2, type: 'file' };
                        }
                      }
                      setConfig({ 
                        ...config, 
                        use_secondary_input: val,
                        input1: nextInput1,
                        input2: nextInput2
                      });
                    }}
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
            )}

            {/* Input 2 (Secondary) */}
            {config.use_secondary_input && (
              <div className="glass-card p-4 !rounded-2xl animate-in fade-in slide-in-from-top-2 duration-300">
                <InputSourcePanel
                  label="Input 2 — Audio Source"
                  accentColor="#60a5fa"
                  config={config.input2}
                  allowedTypes={AUDIO_ALLOWED_TYPES}
                  onChange={input2 => setConfig({ ...config, input2 })}
                  systemCapabilities={systemCapabilities}
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
                  systemCapabilities={systemCapabilities}
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
          <FiltersFormSection
            hasVideo={config.has_video}
            hasAudio={config.has_audio}
            scale={config.filters.scale}
            framerate={config.filters.framerate}
            deinterlace={config.filters.deinterlace}
            highpass={config.filters.highpass}
            lowpass={config.filters.lowpass}
            equalizer={config.filters.equalizer}
            compressor={config.filters.compressor}
            volume={config.filters.volume}
            aresample={config.filters.aresample}
            overlays={config.filters.overlays || []}
            onChange={updates => setConfig({
              ...config,
              filters: {
                ...config.filters,
                ...updates,
              }
            })}
          />
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
                systemCapabilities={systemCapabilities}
              />
            </div>
          </div>
        )}

        {/* ═══ SYSTEM & WATCHDOG SECTION ═══ */}
        {activeSection === 'system' && (
          <div className="space-y-4 animate-in fade-in duration-300">
            {isTask ? (
              <SchedulingFormSection
                schedule_type={config.schedule_type}
                schedule_cron={config.schedule_cron}
                schedule_datetime={config.schedule_datetime}
                duration_type={config.duration_type}
                duration_seconds={config.duration_seconds}
                duration_end_time={config.duration_end_time}
                retry_max={config.retry_max}
                retry_delay={config.retry_delay}
                onChange={updates => setConfig({
                  ...config,
                  ...updates
                })}
              />
            ) : (
              <LifecycleFormSection
                auto_start={config.auto_start}
                watchdog_enabled={config.watchdog_enabled}
                watchdog_retries={config.watchdog_retries}
                onChange={updates => setConfig({
                  ...config,
                  ...updates
                })}
              />
            )}

            <AdvancedFlagsFormSection
              inputType={config.input1.type}
              realtime={config.filters.advanced.realtime}
              stream_loop={config.filters.advanced.stream_loop}
              threads={config.filters.advanced.threads}
              probesize={config.filters.advanced.probesize}
              thread_queue_size={config.filters.advanced.thread_queue_size}
              onChange={updates => setConfig({
                ...config,
                filters: {
                  ...config.filters,
                  advanced: {
                    ...config.filters.advanced,
                    ...updates
                  }
                }
              })}
            />
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
        <PreviewCmdModal
          previewCmd={previewCmd}
          onClose={() => setPreviewCmd(null)}
        />
      )}
    </div>
  );
};

export default ProcessConfigForm;
