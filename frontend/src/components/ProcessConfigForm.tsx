import React, { useState, useEffect, useCallback } from 'react';
import InputSourcePanel from './source/InputSourcePanel';
import type { InputSourceConfig } from './source/InputSourcePanel';
import VideoCodecPanel from './codec/VideoCodecPanel';
import AudioCodecPanel from './codec/AudioCodecPanel';
import { getDefaultParams, VIDEO_CODECS, AUDIO_CODECS, getAvailableVideoCodecs, getAvailableAudioCodecs } from './codec/codecRegistry';
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
  validationErrors?: Record<string, string>;
}

const EMPTY_ARRAY: any[] = [];

const ProcessConfigForm: React.FC<ProcessConfigFormProps> = ({
  onCancel,
  onSubmit,
  onSaveAs,
  initialConfig,
  isTask = false,
  validationErrors: propsValidationErrors,
}) => {
  const [availableBuilds, setAvailableBuilds] = useState<any[]>([]);
  const [selectedBuildOptions, setSelectedBuildOptions] = useState<Record<string, boolean> | undefined>();
  const [activeSection, setActiveSection] = useState<string>('system');
  const [previewCmd, setPreviewCmd] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [systemCapabilities, setSystemCapabilities] = useState<SystemCapabilities | undefined>();
  const [existingConfigs, setExistingConfigs] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      fetch('/processes')
        .then(r => r.ok ? r.json() : [])
        .then(data => data.map((x: any) => ({ ...x, is_task: false }))),
      fetch('/tasks')
        .then(r => r.ok ? r.json() : [])
        .then(data => data.map((x: any) => ({ ...x, is_task: true })))
    ]).then(([procs, tsks]) => {
      setExistingConfigs([...procs, ...tsks]);
    }).catch(() => {});
  }, []);

  const getNextAvailablePort = (basePort: number): string => {
    let port = basePort;
    const used = new Set<number>();
    for (const item of existingConfigs) {
      if (initialConfig) {
        const isSelfTask = !!isTask === !!item.is_task;
        if (isSelfTask) {
          if (initialConfig.id !== undefined && initialConfig.id !== null && item.id === initialConfig.id) continue;
          if (initialConfig.name && item.name === initialConfig.name) continue;
        }
      }
      const out = item.output_config;
      if (out && ['udp', 'srt', 'rtp'].includes(out.type)) {
        const p = Number(out.port);
        if (p && !isNaN(p)) used.add(p);
      }
    }
    while (used.has(port)) {
      port++;
    }
    return String(port);
  };

  const checkPortCollision = (portStr: string, hostStr: string): any | null => {
    const port = Number(portStr);
    if (!port || isNaN(port)) return null;
    const host = (hostStr || '').trim() || '127.0.0.1';

    for (const item of existingConfigs) {
      if (initialConfig) {
        const isSelfTask = !!isTask === !!item.is_task;
        if (isSelfTask) {
          if (initialConfig.id !== undefined && initialConfig.id !== null && item.id === initialConfig.id) continue;
          if (initialConfig.name && item.name === initialConfig.name) continue;
        }
      }
      const out = item.output_config;
      if (out && ['udp', 'srt', 'rtp'].includes(out.type)) {
        const itemPort = Number(out.port);
        const itemHost = (out.host || '').trim() || '127.0.0.1';
        if (itemPort === port) {
          if (host === '0.0.0.0' || itemHost === '0.0.0.0' || host === itemHost) {
            return item;
          }
        }
      }
    }
    return null;
  };

  const checkFilePathCollision = (pathStr: string): any | null => {
    const cleanPath = (pathStr || '').trim().replace(/\/+$/, '');
    if (!cleanPath) return null;

    for (const item of existingConfigs) {
      if (initialConfig) {
        const isSelfTask = !!isTask === !!item.is_task;
        if (isSelfTask) {
          if (initialConfig.id !== undefined && initialConfig.id !== null && item.id === initialConfig.id) continue;
          if (initialConfig.name && item.name === initialConfig.name) continue;
        }
      }
      const out = item.output_config;
      if (out) {
        let itemPath = '';
        if (out.type === 'file') {
          itemPath = (out.path || '').trim();
        } else if (out.type === 'hls' && out.hls_method === 'local') {
          const hName = out.hls_stream_name || 'stream';
          const p = (out.path || '').trim().replace(/\/+$/, '');
          itemPath = p ? `${p}/${hName}.m3u8` : `${hName}.m3u8`;
        }

        if (itemPath && itemPath.replace(/\/+$/, '') === cleanPath) {
          return item;
        }
      }
    }
    return null;
  };

  const validateConfig = (): boolean => {
    const errors: Record<string, string> = {};

    // 1. General name is required
    if (!config.name.trim()) {
      errors.name = 'General name is required';
    }

    // 2. Output validations based on type
    const out = config.output;
    if (out.type === 'udp' || out.type === 'rtp' || out.type === 'srt') {
      if (!(out.host || '').trim()) {
        errors.host = 'Host is required';
      }
      const portVal = (out.port || '').trim();
      if (!portVal) {
        errors.port = 'Port is required';
      } else {
        const portNum = Number(portVal);
        if (isNaN(portNum) || !Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
          errors.port = 'Port must be an integer between 1 and 65535';
        } else {
          const collision = checkPortCollision(portVal, out.host || '');
          if (collision) {
            errors.port = `Port collision: port ${portVal} is already in use by active configuration "${collision.name}"`;
          }
        }
      }
    } else if (out.type === 'rtmp' || out.type === 'whip') {
      if (!(out.url || '').trim()) {
        errors.url = 'Stream URL is required';
      }
    } else if (out.type === 'hls') {
      const hPath = (out.path || '').trim();
      const hName = (out.hls_stream_name || '').trim();
      if (!hPath) {
        errors.path = 'HLS directory path or ingest URL is required';
      }
      if (!hName) {
        errors.hls_stream_name = 'Stream Name is required';
      }

      if (hPath && hName && out.hls_method === 'local') {
        const cleanHlsPath = hPath.replace(/\/+$/, '');
        const finalHlsPlaylist = cleanHlsPath ? `${cleanHlsPath}/${hName}.m3u8` : `${hName}.m3u8`;
        const collision = checkFilePathCollision(finalHlsPlaylist);
        if (collision) {
          errors.path = `HLS playlist path collision: already in use by active configuration "${collision.name}"`;
        }
      }
    } else if (out.type === 'icecast') {
      if (!(out.host || '').trim()) {
        errors.host = 'Icecast server host/URL is required';
      }
      if (!(out.icecast_mount || '').trim()) {
        errors.icecast_mount = 'Icecast mountpoint is required';
      }
    } else if (out.type === 'file') {
      const fPath = (out.path || '').trim();
      if (!fPath) {
        errors.path = 'Output file path is required';
      } else {
        const collision = checkFilePathCollision(fPath);
        if (collision) {
          errors.path = `Output file path collision: already in use by active configuration "${collision.name}"`;
        }
      }
    } else if (out.type === 'ndi') {
      if (!(out.path || '').trim()) {
        errors.path = 'NDI name/path is required';
      }
    } else if (out.type === 'decklink') {
      if (!(out.device || '').trim()) {
        errors.device = 'DeckLink device is required';
      }
    } else if (out.type === 'alsa') {
      if (!(out.device || '').trim()) {
        errors.device = 'ALSA device is required';
      }
    }

    setLocalValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

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
        input1: inputCfg.input1 || { type: 'srt', host: '', port: getNextAvailablePort(9000), mode: 'listener' },
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
          equalizer: filterCfg.equalizer ? {
            enabled: !!filterCfg.equalizer.enabled,
            bands: {
              '31.5': filterCfg.equalizer.bands?.['31.5'] ?? 0,
              '63': filterCfg.equalizer.bands?.['63'] ?? 0,
              '125': filterCfg.equalizer.bands?.['125'] ?? 0,
              '250': filterCfg.equalizer.bands?.['250'] ?? 0,
              '500': filterCfg.equalizer.bands?.['500'] ?? 0,
              '1000': filterCfg.equalizer.bands?.['1000'] ?? 0,
              '2000': filterCfg.equalizer.bands?.['2000'] ?? 0,
              '4000': filterCfg.equalizer.bands?.['4000'] ?? 0,
              '8000': filterCfg.equalizer.bands?.['8000'] ?? 0,
              '16000': filterCfg.equalizer.bands?.['16000'] ?? 0,
            }
          } : {
            enabled: false,
            bands: { '31.5': 0, '63': 0, '125': 0, '250': 0, '500': 0, '1000': 0, '2000': 0, '4000': 0, '8000': 0, '16000': 0 }
          },
          compressor: typeof filterCfg.compressor === 'object' ? {
            enabled: !!filterCfg.compressor.enabled,
            attack: filterCfg.compressor.attack ?? 0.3,
            release: filterCfg.compressor.release ?? 0.3,
            gate: filterCfg.compressor.gate ?? -60,
            gate_ratio: filterCfg.compressor.gate_ratio ?? 4,
            threshold: filterCfg.compressor.threshold ?? -30,
            ratio: filterCfg.compressor.ratio ?? 4,
            gain: filterCfg.compressor.gain ?? 0,
          } : {
            enabled: !!filterCfg.compressor,
            attack: 0.3,
            release: 0.3,
            gate: -60,
            gate_ratio: 4,
            threshold: -30,
            ratio: 4,
            gain: 0,
          },
          limiter: filterCfg.limiter ? {
            enabled: !!filterCfg.limiter.enabled,
            ceiling: filterCfg.limiter.ceiling ?? -0.1,
            release: filterCfg.limiter.release ?? 50,
          } : {
            enabled: false,
            ceiling: -0.1,
            release: 50,
          },
          volume: filterCfg.volume || '',
          aresample: typeof filterCfg.aresample === 'object' ? {
            enabled: !!filterCfg.aresample.enabled,
            mode: filterCfg.aresample.mode || 'basic',
            osr: filterCfg.aresample.osr || '',
            min_comp: filterCfg.aresample.min_comp ?? 0.01,
            min_hard_comp: filterCfg.aresample.min_hard_comp ?? 0.1,
          } : {
            enabled: !!filterCfg.aresample,
            mode: 'basic',
            osr: '',
            min_comp: 0.01,
            min_hard_comp: 0.1,
          },
          overlays: filterCfg.overlays || [],
        },
        output: Object.keys(outputCfg).length > 0 ? outputCfg : { type: 'udp', host: '239.0.0.1', port: getNextAvailablePort(1234) },
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
      input1: { type: 'srt', host: '', port: getNextAvailablePort(9000), mode: 'listener' },
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
        equalizer: { enabled: false, bands: { '31.5': 0, '63': 0, '125': 0, '250': 0, '500': 0, '1000': 0, '2000': 0, '4000': 0, '8000': 0, '16000': 0 } },
        compressor: { enabled: false, attack: 0.3, release: 0.3, gate: -60, gate_ratio: 4, threshold: -30, ratio: 4, gain: 0 },
        limiter: { enabled: false, ceiling: -0.1, release: 50 },
        volume: '',
        aresample: { enabled: false, mode: 'basic', osr: '', min_comp: 0.01, min_hard_comp: 0.1 },
        overlays: [],
      },
      output: { type: 'udp', host: '239.0.0.1', port: getNextAvailablePort(1234) },
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
  const [localValidationErrors, setLocalValidationErrors] = useState<Record<string, string>>({});
  const validationErrors = { ...propsValidationErrors, ...localValidationErrors };

  useEffect(() => {
    setLocalValidationErrors({});
  }, [config.output.type]);

  useEffect(() => {
    if (!initialConfig && existingConfigs.length > 0) {
      setConfig(prev => {
        const newOutputPort = getNextAvailablePort(1234);
        const newInput1Port = getNextAvailablePort(9000);
        let updated = false;
        const patch: Partial<ProcessConfig> = {};
        if (prev.output && prev.output.type === 'udp' && prev.output.port === '1234') {
          patch.output = { ...prev.output, port: newOutputPort };
          updated = true;
        }
        if (prev.input1 && prev.input1.type === 'srt' && prev.input1.port === '9000') {
          patch.input1 = { ...prev.input1, port: newInput1Port };
          updated = true;
        }
        if (updated) {
          return { ...prev, ...patch };
        }
        return prev;
      });
    }
  }, [existingConfigs, initialConfig]);

  useEffect(() => {
    fetch('/builds')
      .then(r => r.json())
      .then(builds => {
        const ready = builds.filter((b: any) => b.status === 'ready');
        setAvailableBuilds(ready);
        
        const currentBuildId = initialConfig?.ffmpeg_build_id ?? null;
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
  }, [initialConfig]);

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

  const isNDIOutput = config.output.type === 'ndi';
  const hasNDICodecIncompatibility = isNDIOutput && (
    (config.has_video && config.video_codec_id !== 'wrapped_avframe') ||
    (config.has_audio && config.audio_codec_id !== 'pcm_s16le')
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
        compressor: config.filters.compressor || null,
        limiter: config.filters.limiter || null,
        volume: config.filters.volume || null,
        aresample: config.filters.aresample || null,
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
    if (!validateConfig()) return;
    onSubmit(createPayload());
  };

  const handleSaveAs = () => {
    if (!onSaveAs) return;
    if (!validateConfig()) return;
    const payload = createPayload();
    payload.name = `${config.name} (Copy)`;
    if (payload.alias) {
      payload.alias = `${config.alias.slice(0, 7)}_copy`.slice(0, 12);
    }
    onSaveAs(payload);
  };

  const handlePreview = async () => {
    if (!validateConfig()) return;
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

  const handleInput1Change = useCallback((input1: InputSourceConfig) => {
    const isPureAudio = input1.type === 'alsa' || input1.type === 'lavfi_audio' || input1.type === 'http_audio';
    if (isPureAudio && config.has_video) {
      const label = input1.type === 'http_audio' 
        ? 'Icecast/HTTP Audio' 
        : input1.type === 'lavfi_audio' 
        ? 'Generador de audio' 
        : 'ALSA';
      const proceed = window.confirm(
        `La entrada seleccionada (${label}) es de solo audio. Se desactivará el flujo de vídeo de esta configuración.\n\n¿Deseas continuar?`
      );
      if (!proceed) return;
    }

    setConfig(prev => {
      let finalHasVideo = prev.has_video;
      let finalHasAudio = prev.has_audio;
      if (isPureAudio) {
        finalHasVideo = false;
        finalHasAudio = true;
      }
      return {
        ...prev,
        input1,
        has_video: finalHasVideo,
        has_audio: finalHasAudio,
      };
    });
  }, [config.has_video]);

  const handleInput2Change = useCallback((input2: InputSourceConfig) => {
    setConfig(prev => ({ ...prev, input2 }));
  }, []);

  const handleSyncAlsaAudio = useCallback((alsaDevice: string) => {
    setConfig(prev => ({
      ...prev,
      use_secondary_input: true,
      input2: {
        ...prev.input2,
        type: 'alsa',
        device: alsaDevice
      }
    }));
  }, []);

  const handleVideoCodecChange = useCallback((id: string, params: Record<string, string | number | boolean>) => {
    setConfig(prev => {
      const filters = id === 'copy'
        ? {
            ...prev.filters,
            scale: '',
            deinterlace: false,
            framerate: '',
            overlays: []
          }
        : prev.filters;
      return {
        ...prev,
        video_codec_id: id,
        video_codec_params: params,
        filters,
      };
    });
  }, []);

  const handleAudioCodecChange = useCallback((id: string, params: Record<string, string | number | boolean>) => {
    setConfig(prev => {
      const filters = id === 'copy'
        ? {
            ...prev.filters,
            highpass: '',
            lowpass: '',
            equalizer: { enabled: false, bands: { '31.5': 0, '63': 0, '125': 0, '250': 0, '500': 0, '1000': 0, '2000': 0, '4000': 0, '8000': 0, '16000': 0 } },
            compressor: { enabled: false, attack: 0.3, release: 0.3, gate: -60, gate_ratio: 4, threshold: -30, ratio: 4, gain: 0 },
            limiter: { enabled: false, ceiling: -0.1, release: 50 },
            volume: '',
            aresample: { enabled: false, mode: 'basic' as 'basic' | 'advanced', osr: '', min_comp: 0.01, min_hard_comp: 0.1 }
          }
        : prev.filters;
      return {
        ...prev,
        audio_codec_id: id,
        audio_codec_params: params,
        filters,
      };
    });
  }, []);

  const handleFiltersChange = useCallback((updates: any) => {
    setConfig(prev => ({
      ...prev,
      filters: {
        ...prev.filters,
        ...updates,
      }
    }));
  }, []);

  const handleOutputChange = useCallback((output: OutputConfig) => {
    const oldType = config.output.type;
    const newType = output.type;

    if (oldType !== newType && (newType === 'icecast' || newType === 'alsa') && config.has_video) {
      const proceed = window.confirm(
        `La salida seleccionada (${newType === 'icecast' ? 'Icecast' : 'ALSA'}) es de solo audio. Se desactivará el flujo de vídeo de esta configuración.\n\n¿Deseas continuar?`
      );
      if (!proceed) return;
    }

    if (oldType === newType) {
      setConfig(prev => ({ ...prev, output }));
      return;
    }

    // Apply default properties when output type changes
    const finalOutput = { ...output };
    let finalHasVideo = config.has_video;
    let finalHasAudio = config.has_audio;

    if (newType === 'udp' || newType === 'rtp') {
      finalOutput.host = '127.0.0.1';
      finalOutput.port = getNextAvailablePort(1234);
    } else if (newType === 'srt') {
      finalOutput.host = '127.0.0.1';
      finalOutput.port = getNextAvailablePort(9000);
      finalOutput.mode = 'caller';
    } else if (newType === 'ndi') {
      finalOutput.path = '';
      (finalOutput as any).name = '';
    } else if (newType === 'file') {
      finalOutput.path = '';
    } else if (newType === 'hls') {
      finalOutput.path = '';
      (finalOutput as any).hls_stream_name = '';
    } else if (newType === 'icecast') {
      finalOutput.url = '';
      finalOutput.host = '';
      finalOutput.icecast_mount = '';
      finalOutput.icecast_password = '';
      finalHasVideo = false;
      finalHasAudio = true;
    } else if (newType === 'alsa') {
      finalOutput.device = '';
      finalHasVideo = false;
      finalHasAudio = true;
    } else if (newType === 'rtmp') {
      finalOutput.url = '';
    } else if (newType === 'whip') {
      finalOutput.url = '';
    }

    // Check codec compatibility
    const availableVideo = getAvailableVideoCodecs(selectedBuildOptions, systemCapabilities, newType);
    const availableAudio = getAvailableAudioCodecs(selectedBuildOptions, newType);

    const videoIncompatible = finalHasVideo && !availableVideo.some(c => c.id === config.video_codec_id);
    const audioIncompatible = finalHasAudio && !availableAudio.some(c => c.id === config.audio_codec_id);

    if (videoIncompatible || audioIncompatible) {
      const videoMsg = videoIncompatible 
        ? `\n- El códec de vídeo actual (${config.video_codec_id}) se cambiará a ${availableVideo[0]?.label || 'H.264'}.` 
        : '';
      const audioMsg = audioIncompatible 
        ? `\n- El códec de audio actual (${config.audio_codec_id}) se cambiará a ${availableAudio[0]?.label || 'AAC'}.` 
        : '';

      const proceed = window.confirm(
        `El cambio de tipo de salida a ${newType.toUpperCase()} requiere reconfigurar los códecs:${videoMsg}${audioMsg}\n\n¿Deseas continuar?`
      );

      if (!proceed) return;

      // User accepted: update output and auto-heal codecs
      setConfig(prev => {
        const patch: Partial<ProcessConfig> = { 
          ...prev, 
          output: finalOutput,
          has_video: finalHasVideo,
          has_audio: finalHasAudio
        };
        if (videoIncompatible && availableVideo.length > 0) {
          patch.video_codec_id = availableVideo[0].id;
          patch.video_codec_params = getDefaultParams(availableVideo[0]);
        }
        if (audioIncompatible && availableAudio.length > 0) {
          patch.audio_codec_id = availableAudio[0].id;
          patch.audio_codec_params = getDefaultParams(availableAudio[0]);
        }
        return patch as ProcessConfig;
      });
    } else {
      setConfig(prev => ({ 
        ...prev, 
        output: finalOutput,
        has_video: finalHasVideo,
        has_audio: finalHasAudio
      }));
    }
  }, [config.output.type, config.video_codec_id, config.audio_codec_id, config.has_video, config.has_audio, selectedBuildOptions, systemCapabilities, getNextAvailablePort]);

  const handleLifecycleOrSchedulingChange = useCallback((updates: any) => {
    setConfig(prev => ({
      ...prev,
      ...updates
    }));
  }, []);

  const handleAdvancedFlagsChange = useCallback((updates: any) => {
    setConfig(prev => ({
      ...prev,
      filters: {
        ...prev.filters,
        advanced: {
          ...prev.filters.advanced,
          ...updates
        }
      }
    }));
  }, []);

  const handleHasVideoChange = useCallback((val: boolean) => {
    const isPureAudioInput = config.input1.type === 'alsa' || config.input1.type === 'lavfi_audio' || config.input1.type === 'http_audio';
    const isPureAudioOutput = config.output.type === 'icecast' || config.output.type === 'alsa';

    if (val && (isPureAudioInput || isPureAudioOutput)) {
      const proceed = window.confirm(
        `Has activado el flujo de vídeo, pero la entrada/salida actuales son de solo audio.\n\n` +
        `Al continuar:\n` +
        `- Si la entrada es de solo audio, se moverá a Entrada Secundaria (INPUT 2) y la Entrada Principal (INPUT 1) se restablecerá a un archivo.\n` +
        `- Si la salida es de solo audio, se cambiará a UDP Multicast.\n\n` +
        `¿Deseas reconfigurar la entrada/salida para habilitar el vídeo?`
      );
      if (!proceed) return;

      setConfig(prev => {
        let nextInput1 = { ...prev.input1 };
        let nextInput2 = { ...prev.input2 };
        let nextSecondary = prev.use_secondary_input;
        let nextOutput = { ...prev.output };

        if (isPureAudioInput) {
          nextSecondary = true;
          nextInput2.type = prev.input1.type;
          nextInput2.device = (prev.input1 as any).device || '';
          nextInput2.path = prev.input1.path || '';
          (nextInput2 as any).url = (prev.input1 as any).url || '';

          // Reset input1 to file
          nextInput1.type = 'file';
          nextInput1.path = '/var/tmp/input.mp4';
        }

        if (isPureAudioOutput) {
          nextOutput.type = 'udp';
          nextOutput.host = '127.0.0.1';
          nextOutput.port = getNextAvailablePort(1234);
        }

        return {
          ...prev,
          has_video: true,
          use_secondary_input: nextSecondary,
          input1: nextInput1,
          input2: nextInput2,
          output: nextOutput
        };
      });
      return;
    }

    setConfig(prev => {
      const nextSecondary = val && prev.has_audio ? prev.use_secondary_input : false;
      let nextInput1 = prev.input1;
      if (!val && prev.has_audio) {
        if (!AUDIO_ALLOWED_TYPES.includes(nextInput1.type)) {
          nextInput1 = { ...nextInput1, type: 'file' };
        }
      } else if (val && !prev.has_audio) {
        if (!VIDEO_ALLOWED_TYPES.includes(nextInput1.type)) {
          nextInput1 = { ...nextInput1, type: 'file' };
        }
      }
      return {
        ...prev,
        has_video: val,
        use_secondary_input: nextSecondary,
        input1: nextInput1
      };
    });
  }, [config.input1, config.output, config.has_video, config.has_audio, getNextAvailablePort]);

  const handleHasAudioChange = useCallback((val: boolean) => {
    setConfig(prev => {
      const nextSecondary = prev.has_video && val ? prev.use_secondary_input : false;
      let nextInput1 = prev.input1;
      if (prev.has_video && !val) {
        if (!VIDEO_ALLOWED_TYPES.includes(nextInput1.type)) {
          nextInput1 = { ...nextInput1, type: 'file' };
        }
      } else if (!prev.has_video && val) {
        if (!AUDIO_ALLOWED_TYPES.includes(nextInput1.type)) {
          nextInput1 = { ...nextInput1, type: 'file' };
        }
      }
      return {
        ...prev,
        has_audio: val,
        use_secondary_input: nextSecondary,
        input1: nextInput1
      };
    });
  }, []);

  const handleUseSecondaryInputChange = useCallback((val: boolean) => {
    setConfig(prev => {
      let nextInput1 = prev.input1;
      let nextInput2 = prev.input2;
      if (val) {
        if (!VIDEO_ALLOWED_TYPES.includes(nextInput1.type)) {
          nextInput1 = { ...nextInput1, type: 'file' };
        }
        if (!AUDIO_ALLOWED_TYPES.includes(nextInput2.type)) {
          nextInput2 = { ...nextInput2, type: 'file' };
        }
      }
      return {
        ...prev,
        use_secondary_input: val,
        input1: nextInput1,
        input2: nextInput2
      };
    });
  }, []);

  const sections = [
    { id: 'system', label: 'General', icon: <ShieldIcon size={14} /> },
    { id: 'inputs', label: 'Input', icon: <SourceIcon size={14} /> },
    { id: 'output', label: 'Output', icon: <DestinationIcon size={14} /> },
    { id: 'encoding', label: 'Codecs', icon: <GearIcon size={14} /> },
    { id: 'filters', label: 'Filters', icon: <KnobsIcon size={14} /> },
  ];

  const hasErrors = Object.keys(validationErrors).length > 0;


  return (
    <div className="flex flex-col h-full max-h-[85vh]">
      {hasErrors && (
        <div className="flex-shrink-0 mb-3 p-3 bg-red-500/10 border border-red-500/20 rounded-2xl text-xs text-red-300 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex items-start gap-2.5">
            <span className="text-sm mt-0.5 text-red-400">
              <ShieldIcon size={14} />
            </span>
            <div>
              <strong className="block mb-1 font-bold text-red-200">Existen errores de validación en el formulario:</strong>
              <ul className="list-disc pl-4 space-y-0.5 text-red-400/90 font-medium">
                {Object.entries(validationErrors).map(([key, msg]) => (
                  <li key={key}>{msg}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ── Header: Name + Build ── */}
      <div className="space-y-2 mb-2.5 flex-shrink-0">
        <div className="flex gap-2">
          <div className="flex-[3]">
            <input
              type="text"
              id="process-name"
              name="name"
              className={`w-full bg-white/5 border rounded-lg p-2 outline-none transition-all text-xs font-medium ${
                validationErrors.name
                  ? 'border-red-500/50 focus:border-red-500 bg-red-500/5'
                  : 'border-white/10 focus:border-brand-lime'
              }`}
              placeholder={isTask ? "Task name (e.g. Daily Transcode of Stream)" : "Service name (e.g. Primary Encoder Node-01)"}
              value={config.name}
              onChange={e => setConfig({ ...config, name: e.target.value })}
            />
          </div>
          <div className="w-[140px] flex-shrink-0">
            <input
              type="text"
              id="process-alias"
              name="alias"
              maxLength={12}
              className="w-full bg-white/5 border border-white/10 rounded-lg p-2 focus:border-brand-lime outline-none transition-all text-xs font-medium text-brand-lime placeholder-white/20"
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
        <div className="flex gap-2 items-center">
          {availableBuilds.length > 0 && (
            <select
              id="process-build"
              name="ffmpeg_build_id"
              className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none focus:border-brand-orange transition-all truncate"
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
          <div className="flex items-center gap-3 bg-white/5 rounded-lg px-2.5 py-1.5 border border-white/10 flex-shrink-0">
            <label htmlFor="process-has-video" className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox" id="process-has-video" name="has_video" checked={config.has_video}
                onChange={e => handleHasVideoChange(e.target.checked)}
                className="w-3.5 h-3.5 accent-brand-orange"
              />
              <span className={`text-[10px] font-bold uppercase tracking-wider ${config.has_video ? 'text-brand-orange' : 'text-text-secondary'}`}>
                Video
              </span>
            </label>
            <span className="w-px h-3 bg-white/10" />
            <label htmlFor="process-has-audio" className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox" id="process-has-audio" name="has_audio" checked={config.has_audio}
                onChange={e => handleHasAudioChange(e.target.checked)}
                className="w-3.5 h-3.5 accent-blue-400"
              />
              <span className={`text-[10px] font-bold uppercase tracking-wider ${config.has_audio ? 'text-blue-400' : 'text-text-secondary'}`}>
                Audio
              </span>
            </label>
          </div>
        </div>
      </div>



      {/* ── Section tabs ── */}
      <div className="flex gap-1 mb-2 flex-shrink-0 border-b border-white/5 pb-2">
        {sections.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
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

      {hasNDICodecIncompatibility && (
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-xs text-amber-300 mb-3 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex items-start gap-2.5">
            <span className="text-sm mt-0.5 text-amber-400">
              <ShieldIcon size={14} />
            </span>
            <div>
              <strong>Configuración de códec incompatible:</strong> Has seleccionado salida NDI, pero la codificación de vídeo/audio configurada no es compatible con NDI (requiere vídeo wrapped_avframe y audio PCM 16-bit).
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setConfig(prev => ({
                ...prev,
                video_codec_id: prev.has_video ? 'wrapped_avframe' : prev.video_codec_id,
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
                onChange={handleInput1Change}
                systemCapabilities={systemCapabilities}
                onSyncAlsaAudio={handleSyncAlsaAudio}
                ffmpegBuildId={config.ffmpeg_build_id}
                idPrefix="input1"
              />
            </div>

            {/* Toggle: Use secondary input */}
            {config.has_video && config.has_audio && (
              <div className="flex items-center gap-3 px-2">
                <label htmlFor="process-use-secondary-input" className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    id="process-use-secondary-input"
                    name="use_secondary_input"
                    checked={config.use_secondary_input}
                    onChange={e => handleUseSecondaryInputChange(e.target.checked)}
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
                  onChange={handleInput2Change}
                  systemCapabilities={systemCapabilities}
                  ffmpegBuildId={config.ffmpeg_build_id}
                  idPrefix="input2"
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
                  outputType={config.output.type}
                  onChange={handleVideoCodecChange}
                />
              </div>
            )}
            {config.has_audio && (
              <div className="glass-card p-4 !rounded-2xl">
                <AudioCodecPanel
                  codecId={config.audio_codec_id}
                  params={config.audio_codec_params}
                  buildOptions={selectedBuildOptions}
                  outputType={config.output.type}
                  onChange={handleAudioCodecChange}
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
            limiter={config.filters.limiter}
            volume={config.filters.volume}
            aresample={config.filters.aresample}
            overlays={config.filters.overlays || EMPTY_ARRAY}
            hwaccel={config.input1.hwaccel || 'none'}
            isVram={
              config.input1.hwaccel_output_format !== '' &&
              config.input1.hwaccel_output_format !== 'system' &&
              config.input1.hwaccel_output_format !== undefined
            }
            systemCapabilities={systemCapabilities}
            onChange={handleFiltersChange}
            videoCodecId={config.video_codec_id}
            audioCodecId={config.audio_codec_id}
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
                onChange={handleOutputChange}
                systemCapabilities={systemCapabilities}
                validationErrors={validationErrors}
              />
            </div>
          </div>
        )}

        {/* ═══ SYSTEM & WATCHDOG SECTION ═══ */}
        {activeSection === 'system' && (
          <div className="space-y-4 animate-in fade-in duration-300">
            {/* ── Transcode Flow Diagram in General Section ── */}
            {config.has_video && (
              <ResourcePipelineDiagram
                hwaccel={config.input1.hwaccel || 'none'}
                isVram={
                  config.input1.hwaccel_output_format !== '' &&
                  config.input1.hwaccel_output_format !== 'system' &&
                  config.input1.hwaccel_output_format !== undefined
                }
                codecId={config.video_codec_id}
                audioCodecId={config.audio_codec_id}
                hasCpuFilters={!!(config.filters.overlays && config.filters.overlays.length > 0)}
                inputType={config.input1.type}
                outputType={config.output.type}
                filters={config.filters}
                hasVideo={config.has_video}
                hasAudio={config.has_audio}
              />
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
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
                  onChange={handleLifecycleOrSchedulingChange}
                />
              ) : (
                <LifecycleFormSection
                  auto_start={config.auto_start}
                  watchdog_enabled={config.watchdog_enabled}
                  watchdog_retries={config.watchdog_retries}
                  onChange={handleLifecycleOrSchedulingChange}
                />
              )}

              <AdvancedFlagsFormSection
                inputType={config.input1.type}
                realtime={config.filters.advanced.realtime}
                stream_loop={config.filters.advanced.stream_loop}
                threads={config.filters.advanced.threads}
                probesize={config.filters.advanced.probesize}
                thread_queue_size={config.filters.advanced.thread_queue_size}
                onChange={handleAdvancedFlagsChange}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Sticky footer ── */}
      <div className="flex gap-3 pt-3 mt-2.5 border-t border-white/5 flex-shrink-0">
        <button
          onClick={onCancel}
          className="flex-1 py-2 bg-white/5 border border-white/10 rounded-lg font-bold hover:bg-white/10 transition-all uppercase tracking-widest text-xs"
        >
          Cancel
        </button>
        <button
          onClick={handlePreview}
          disabled={isPreviewing}
          className="flex-1 py-2 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg font-bold hover:bg-blue-500/30 transition-all uppercase tracking-widest text-xs"
        >
          {isPreviewing ? 'Wait...' : 'Preview CLI'}
        </button>
        <button
          onClick={handleSubmit}
          className="flex-1 py-2 bg-brand-lime text-black rounded-lg font-black hover:scale-[1.02] active:scale-[0.98] transition-all uppercase tracking-widest text-xs shadow-xl shadow-brand-lime/20"
        >
          {initialConfig ? 'Save Changes' : (isTask ? 'Create Task' : 'Deploy Service')}
        </button>
        {initialConfig && onSaveAs && (
          <button
            onClick={handleSaveAs}
            className="flex-1 py-2 bg-brand-orange/20 text-brand-orange border border-brand-orange/30 rounded-lg font-bold hover:bg-brand-orange/30 transition-all uppercase tracking-widest text-xs"
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
