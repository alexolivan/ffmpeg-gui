/**
 * codecRegistry.ts
 * 
 * Static registry of FFmpeg codecs and their configurable parameters.
 * Used by VideoCodecPanel and AudioCodecPanel to render dynamic controls.
 * 
 * The registry is filtered at runtime by getAvailableCodecs() which checks
 * the selected FFmpeg build's build_options to hide HW-accelerated codecs
 * that weren't compiled into the binary.
 */

// ── Types ────────────────────────────────────────────────────────

export interface CodecParamOption {
  value: string;
  label: string;
}

export interface CodecParam {
  key: string;
  label: string;
  type: 'select' | 'number' | 'text' | 'toggle';
  options?: CodecParamOption[];
  default: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  /** When set, this param is only shown if a condition on another param is met */
  showWhen?: { param: string; value: string | string[] };
}

export interface CodecDefinition {
  id: string;
  label: string;
  type: 'video' | 'audio';
  category: 'software' | 'hw_vaapi' | 'hw_qsv' | 'hw_nvenc' | 'passthrough';
  /** build_options key required for this codec to be available */
  requiresBuildOption?: string;
  params: CodecParam[];
}

// ── Video Codecs ─────────────────────────────────────────────────

const PRESETS_X264: CodecParamOption[] = [
  { value: 'ultrafast', label: 'Ultrafast' },
  { value: 'superfast', label: 'Superfast' },
  { value: 'veryfast', label: 'Veryfast' },
  { value: 'faster', label: 'Faster' },
  { value: 'fast', label: 'Fast' },
  { value: 'medium', label: 'Medium' },
  { value: 'slow', label: 'Slow' },
  { value: 'slower', label: 'Slower' },
  { value: 'veryslow', label: 'Veryslow' },
];

const TUNES_X264: CodecParamOption[] = [
  { value: 'none', label: 'None (Default)' },
  { value: 'zerolatency', label: 'Zero Latency (Live)' },
  { value: 'film', label: 'Film' },
  { value: 'animation', label: 'Animation' },
  { value: 'grain', label: 'Grain' },
  { value: 'stillimage', label: 'Still Image' },
  { value: 'fastdecode', label: 'Fast Decode' },
];

const PROFILES_X264: CodecParamOption[] = [
  { value: 'baseline', label: 'Baseline' },
  { value: 'main', label: 'Main' },
  { value: 'high', label: 'High' },
  { value: 'high10', label: 'High 10-bit' },
];

const RATE_CONTROL_MODES: CodecParamOption[] = [
  { value: 'crf', label: 'CRF (Constant Quality)' },
  { value: 'cbr', label: 'CBR (Constant Bitrate)' },
  { value: 'vbr', label: 'VBR (Variable Bitrate)' },
];

const PIXEL_FORMATS: CodecParamOption[] = [
  { value: 'yuv420p', label: 'YUV 4:2:0 (Standard)' },
  { value: 'yuv422p', label: 'YUV 4:2:2' },
  { value: 'yuv444p', label: 'YUV 4:4:4' },
];

export const VIDEO_CODECS: CodecDefinition[] = [
  {
    id: 'libx264',
    label: 'H.264 (AVC) — Software',
    type: 'video',
    category: 'software',
    params: [
      {
        key: 'rc_mode', label: 'Rate Control', type: 'select',
        options: RATE_CONTROL_MODES, default: 'crf',
        hint: 'CRF for quality-based, CBR/VBR for bitrate-based encoding',
      },
      {
        key: 'crf', label: 'CRF Value', type: 'number',
        default: 23, min: 0, max: 51, step: 1,
        hint: 'Lower = better quality, higher file size. 18-28 is typical.',
        showWhen: { param: 'rc_mode', value: 'crf' },
      },
      {
        key: 'bitrate', label: 'Bitrate', type: 'text',
        default: '4000k',
        hint: 'Target bitrate (e.g. 4000k, 6M)',
        showWhen: { param: 'rc_mode', value: ['cbr', 'vbr'] },
      },
      {
        key: 'maxrate', label: 'Max Bitrate', type: 'text',
        default: '6000k',
        hint: 'Maximum bitrate for VBR (e.g. 6000k)',
        showWhen: { param: 'rc_mode', value: 'vbr' },
      },
      {
        key: 'bufsize', label: 'Buffer Size', type: 'text',
        default: '8000k',
        hint: 'Rate control buffer (e.g. 8000k)',
        showWhen: { param: 'rc_mode', value: ['cbr', 'vbr'] },
      },
      {
        key: 'preset', label: 'Preset', type: 'select',
        options: PRESETS_X264, default: 'veryfast',
        hint: 'Speed vs compression tradeoff',
      },
      {
        key: 'tune', label: 'Tune', type: 'select',
        options: TUNES_X264, default: 'zerolatency',
      },
      {
        key: 'profile', label: 'Profile', type: 'select',
        options: PROFILES_X264, default: 'high',
      },
      {
        key: 'g', label: 'Keyframe Interval (GOP)', type: 'number',
        default: 50, min: 1, max: 600, step: 1,
        hint: 'Frames between keyframes. Lower = better seeking, higher = better compression.',
      },
      {
        key: 'bf', label: 'B-Frames', type: 'number',
        default: 2, min: 0, max: 16, step: 1,
        hint: 'Number of B-frames. 0 for lowest latency.',
      },
      {
        key: 'pix_fmt', label: 'Pixel Format', type: 'select',
        options: PIXEL_FORMATS, default: 'yuv420p',
        hint: 'Use YUV 4:2:0 for maximum compatibility with Baseline/Main profiles.',
      },
    ],
  },
  {
    id: 'libx265',
    label: 'H.265 (HEVC) — Software',
    type: 'video',
    category: 'software',
    params: [
      {
        key: 'rc_mode', label: 'Rate Control', type: 'select',
        options: RATE_CONTROL_MODES, default: 'crf',
      },
      {
        key: 'crf', label: 'CRF Value', type: 'number',
        default: 28, min: 0, max: 51, step: 1,
        hint: 'Lower = better quality. 22-32 is typical for HEVC.',
        showWhen: { param: 'rc_mode', value: 'crf' },
      },
      {
        key: 'bitrate', label: 'Bitrate', type: 'text',
        default: '3000k',
        showWhen: { param: 'rc_mode', value: ['cbr', 'vbr'] },
      },
      {
        key: 'preset', label: 'Preset', type: 'select',
        options: PRESETS_X264, default: 'medium', // x265 uses same preset names
        hint: 'x265 presets — slower presets are significantly slower than x264',
      },
      {
        key: 'tune', label: 'Tune', type: 'select',
        options: [
          { value: 'none', label: 'None (Default)' },
          { value: 'zerolatency', label: 'Zero Latency (Live)' },
          { value: 'grain', label: 'Grain' },
          { value: 'fastdecode', label: 'Fast Decode' },
        ],
        default: 'none',
      },
      {
        key: 'profile', label: 'Profile', type: 'select',
        options: [
          { value: 'main', label: 'Main (8-bit)' },
          { value: 'main10', label: 'Main 10 (10-bit)' },
          { value: 'main444-8', label: 'Main 4:4:4 8-bit' },
        ],
        default: 'main',
      },
      {
        key: 'g', label: 'Keyframe Interval (GOP)', type: 'number',
        default: 50, min: 1, max: 600, step: 1,
      },
      {
        key: 'pix_fmt', label: 'Pixel Format', type: 'select',
        options: PIXEL_FORMATS, default: 'yuv420p',
        hint: 'Use YUV 4:2:0 for maximum compatibility.',
      },
    ],
  },
  {
    id: 'prores_ks',
    label: 'Apple ProRes',
    type: 'video',
    category: 'software',
    params: [
      {
        key: 'profile', label: 'ProRes Profile', type: 'select',
        options: [
          { value: '0', label: 'Proxy' },
          { value: '1', label: 'LT (Light)' },
          { value: '2', label: 'Standard' },
          { value: '3', label: 'HQ (High Quality)' },
          { value: '4', label: '4444' },
          { value: '5', label: '4444 XQ' },
        ],
        default: '3',
        hint: 'Higher profiles = higher quality and bitrate',
      },
      {
        key: 'vendor', label: 'Vendor Tag', type: 'text',
        default: 'apl0',
        hint: 'FourCC vendor string. Use "apl0" for Apple compatibility.',
      },
    ],
  },
  {
    id: 'dnxhd',
    label: 'Avid DNxHD/DNxHR',
    type: 'video',
    category: 'software',
    params: [
      {
        key: 'profile', label: 'DNx Profile', type: 'select',
        options: [
          { value: 'dnxhd', label: 'DNxHD (HD resolutions)' },
          { value: 'dnxhr_lb', label: 'DNxHR LB (Low Bandwidth)' },
          { value: 'dnxhr_sq', label: 'DNxHR SQ (Standard Quality)' },
          { value: 'dnxhr_hq', label: 'DNxHR HQ (High Quality)' },
          { value: 'dnxhr_hqx', label: 'DNxHR HQX (10-bit HQ)' },
          { value: 'dnxhr_444', label: 'DNxHR 444 (4:4:4)' },
        ],
        default: 'dnxhr_hq',
      },
      {
        key: 'bitrate', label: 'Bitrate', type: 'text',
        default: '185M',
        hint: 'Required for DNxHD. Must match resolution/framerate (e.g. 185M for 1080p25).',
        showWhen: { param: 'profile', value: 'dnxhd' },
      },
    ],
  },
  {
    id: 'rawvideo',
    label: 'Uncompressed 8-bit (rawvideo) [Legacy / Compatibility]',
    type: 'video',
    category: 'software',
    params: [
      {
        key: 'pix_fmt', label: 'Pixel Format', type: 'select',
        options: [
          { value: 'uyvy422', label: 'UYVY 4:2:2 (standard)' },
          { value: 'yuv420p', label: 'YUV 4:2:0' },
          { value: 'rgb24', label: 'RGB 24-bit' },
        ],
        default: 'uyvy422',
      }
    ],
  },
  {
    id: 'v210',
    label: 'Uncompressed 10-bit (v210) [Recommended]',
    type: 'video',
    category: 'software',
    params: [],
  },
  {
    id: 'wrapped_avframe',
    label: 'Wrapped AVFrame (NDI Native) [wrapped_avframe]',
    type: 'video',
    category: 'software',
    params: [],
  },
  // ── HW Accelerated ──
  {
    id: 'h264_vaapi',
    label: 'H.264 — VAAPI (Intel/AMD)',
    type: 'video',
    category: 'hw_vaapi',
    requiresBuildOption: 'vaapi',
    params: [
      {
        key: 'rc_mode', label: 'Rate Control', type: 'select',
        options: [
          { value: 'CQP', label: 'CQP (Constant QP)' },
          { value: 'CBR', label: 'CBR (Constant Bitrate)' },
          { value: 'VBR', label: 'VBR (Variable Bitrate)' },
        ],
        default: 'CQP',
      },
      { key: 'bitrate', label: 'Bitrate', type: 'text', default: '4000k' },
      {
        key: 'qp', label: 'QP Value', type: 'number',
        default: 25, min: 0, max: 52, step: 1,
        showWhen: { param: 'rc_mode', value: 'CQP' },
      },
      {
        key: 'profile', label: 'Profile', type: 'select',
        options: [
          { value: 'constrained_baseline', label: 'Constrained Baseline' },
          { value: 'main', label: 'Main' },
          { value: 'high', label: 'High' },
        ],
        default: 'high',
      },
      {
        key: 'g', label: 'GOP Size', type: 'number',
        default: 50, min: 1, max: 600, step: 1,
      },
    ],
  },
  {
    id: 'hevc_vaapi',
    label: 'H.265 (HEVC) — VAAPI',
    type: 'video',
    category: 'hw_vaapi',
    requiresBuildOption: 'vaapi',
    params: [
      {
        key: 'rc_mode', label: 'Rate Control', type: 'select',
        options: [
          { value: 'CQP', label: 'CQP (Constant QP)' },
          { value: 'CBR', label: 'CBR (Constant Bitrate)' },
          { value: 'VBR', label: 'VBR (Variable Bitrate)' },
        ],
        default: 'CQP',
      },
      { key: 'bitrate', label: 'Bitrate', type: 'text', default: '3000k' },
      {
        key: 'qp', label: 'QP Value', type: 'number',
        default: 25, min: 0, max: 52, step: 1,
        showWhen: { param: 'rc_mode', value: 'CQP' },
      },
      {
        key: 'g', label: 'GOP Size', type: 'number',
        default: 50, min: 1, max: 600, step: 1,
      },
    ],
  },
  {
    id: 'h264_qsv',
    label: 'H.264 — Intel QSV',
    type: 'video',
    category: 'hw_qsv',
    requiresBuildOption: 'qsv',
    params: [
      {
        key: 'preset', label: 'Preset', type: 'select',
        options: [
          { value: 'veryfast', label: 'Very Fast' },
          { value: 'faster', label: 'Faster' },
          { value: 'fast', label: 'Fast' },
          { value: 'medium', label: 'Medium' },
          { value: 'slow', label: 'Slow' },
          { value: 'slower', label: 'Slower' },
          { value: 'veryslow', label: 'Very Slow' },
        ],
        default: 'medium',
      },
      { key: 'bitrate', label: 'Bitrate', type: 'text', default: '4000k' },
      {
        key: 'global_quality', label: 'Global Quality (ICQ)', type: 'number',
        default: 25, min: 1, max: 51, step: 1,
        hint: 'Used in ICQ mode. Lower = better quality.',
      },
      {
        key: 'g', label: 'GOP Size', type: 'number',
        default: 50, min: 1, max: 600, step: 1,
      },
    ],
  },
  {
    id: 'h264_nvenc',
    label: 'H.264 — NVIDIA NVENC',
    type: 'video',
    category: 'hw_nvenc',
    requiresBuildOption: 'nvenc',
    params: [
      {
        key: 'preset', label: 'Preset', type: 'select',
        options: [
          { value: 'p1', label: 'P1 (Fastest)' },
          { value: 'p2', label: 'P2' },
          { value: 'p3', label: 'P3' },
          { value: 'p4', label: 'P4 (Medium)' },
          { value: 'p5', label: 'P5' },
          { value: 'p6', label: 'P6' },
          { value: 'p7', label: 'P7 (Slowest/Best)' },
        ],
        default: 'p4',
      },
      {
        key: 'rc', label: 'Rate Control', type: 'select',
        options: [
          { value: 'constqp', label: 'Constant QP' },
          { value: 'cbr', label: 'CBR' },
          { value: 'vbr', label: 'VBR' },
        ],
        default: 'cbr',
      },
      { key: 'bitrate', label: 'Bitrate', type: 'text', default: '4000k' },
      {
        key: 'cq', label: 'CQ Value', type: 'number',
        default: 23, min: 0, max: 51, step: 1,
        hint: 'Quality level for VBR/Constant QP modes.',
        showWhen: { param: 'rc', value: ['constqp', 'vbr'] },
      },
      {
        key: 'profile', label: 'Profile', type: 'select',
        options: [
          { value: 'baseline', label: 'Baseline' },
          { value: 'main', label: 'Main' },
          { value: 'high', label: 'High' },
        ],
        default: 'high',
      },
      {
        key: 'g', label: 'GOP Size', type: 'number',
        default: 50, min: 1, max: 600, step: 1,
      },
      {
        key: 'bf', label: 'B-Frames', type: 'number',
        default: 2, min: 0, max: 4, step: 1,
      },
    ],
  },
  {
    id: 'hevc_nvenc',
    label: 'H.265 (HEVC) — NVIDIA NVENC',
    type: 'video',
    category: 'hw_nvenc',
    requiresBuildOption: 'nvenc',
    params: [
      {
        key: 'preset', label: 'Preset', type: 'select',
        options: [
          { value: 'p1', label: 'P1 (Fastest)' },
          { value: 'p4', label: 'P4 (Medium)' },
          { value: 'p7', label: 'P7 (Slowest/Best)' },
        ],
        default: 'p4',
      },
      {
        key: 'rc', label: 'Rate Control', type: 'select',
        options: [
          { value: 'constqp', label: 'Constant QP' },
          { value: 'cbr', label: 'CBR' },
          { value: 'vbr', label: 'VBR' },
        ],
        default: 'cbr',
      },
      { key: 'bitrate', label: 'Bitrate', type: 'text', default: '3000k' },
      {
        key: 'g', label: 'GOP Size', type: 'number',
        default: 50, min: 1, max: 600, step: 1,
      },
    ],
  },
  // ── Passthrough ──
  {
    id: 'copy',
    label: 'Copy (Stream Passthrough)',
    type: 'video',
    category: 'passthrough',
    params: [],
  },
];

// ── Audio Codecs ─────────────────────────────────────────────────

export const AUDIO_CODECS: CodecDefinition[] = [
  {
    id: 'aac',
    label: 'AAC',
    type: 'audio',
    category: 'software',
    params: [
      {
        key: 'b:a', label: 'Bitrate', type: 'select',
        options: [
          { value: '64k', label: '64 kbps' },
          { value: '96k', label: '96 kbps' },
          { value: '128k', label: '128 kbps' },
          { value: '192k', label: '192 kbps' },
          { value: '256k', label: '256 kbps' },
          { value: '320k', label: '320 kbps' },
        ],
        default: '128k',
      },
      {
        key: 'profile:a', label: 'AAC Profile', type: 'select',
        options: [
          { value: 'aac_low', label: 'AAC-LC (Low Complexity)' },
          { value: 'aac_he', label: 'HE-AAC v1' },
          { value: 'aac_he_v2', label: 'HE-AAC v2' },
        ],
        default: 'aac_low',
      },
      {
        key: 'ac', label: 'Channels', type: 'select',
        options: [
          { value: '1', label: 'Mono' },
          { value: '2', label: 'Stereo' },
          { value: '6', label: '5.1 Surround' },
        ],
        default: '2',
      },
    ],
  },
  {
    id: 'libmp3lame',
    label: 'MP3 (LAME)',
    type: 'audio',
    category: 'software',
    params: [
      {
        key: 'b:a', label: 'Bitrate', type: 'select',
        options: [
          { value: '96k', label: '96 kbps' },
          { value: '128k', label: '128 kbps' },
          { value: '192k', label: '192 kbps' },
          { value: '256k', label: '256 kbps' },
          { value: '320k', label: '320 kbps' },
        ],
        default: '192k',
      },
      {
        key: 'ac', label: 'Channels', type: 'select',
        options: [
          { value: '1', label: 'Mono' },
          { value: '2', label: 'Stereo' },
        ],
        default: '2',
      },
    ],
  },
  {
    id: 'libopus',
    label: 'Opus',
    type: 'audio',
    category: 'software',
    params: [
      {
        key: 'b:a', label: 'Bitrate', type: 'select',
        options: [
          { value: '32k', label: '32 kbps' },
          { value: '64k', label: '64 kbps' },
          { value: '96k', label: '96 kbps' },
          { value: '128k', label: '128 kbps' },
          { value: '192k', label: '192 kbps' },
          { value: '256k', label: '256 kbps' },
          { value: '510k', label: '510 kbps (Max)' },
        ],
        default: '128k',
      },
      {
        key: 'application', label: 'Application', type: 'select',
        options: [
          { value: 'audio', label: 'Audio (General)' },
          { value: 'voip', label: 'VoIP (Speech)' },
          { value: 'lowdelay', label: 'Low Delay' },
        ],
        default: 'audio',
      },
      {
        key: 'vbr', label: 'VBR Mode', type: 'select',
        options: [
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off (CBR)' },
          { value: 'constrained', label: 'Constrained' },
        ],
        default: 'on',
      },
      {
        key: 'ac', label: 'Channels', type: 'select',
        options: [
          { value: '1', label: 'Mono' },
          { value: '2', label: 'Stereo' },
        ],
        default: '2',
      },
    ],
  },
  {
    id: 'pcm_s16le',
    label: 'PCM 16-bit (Uncompressed)',
    type: 'audio',
    category: 'software',
    params: [
      {
        key: 'ar', label: 'Sample Rate', type: 'select',
        options: [
          { value: '44100', label: '44.1 kHz' },
          { value: '48000', label: '48 kHz' },
          { value: '96000', label: '96 kHz' },
        ],
        default: '48000',
      },
      {
        key: 'ac', label: 'Channels', type: 'select',
        options: [
          { value: '1', label: 'Mono' },
          { value: '2', label: 'Stereo' },
        ],
        default: '2',
      },
    ],
  },
  {
    id: 'pcm_s24le',
    label: 'PCM 24-bit (Uncompressed)',
    type: 'audio',
    category: 'software',
    params: [
      {
        key: 'ar', label: 'Sample Rate', type: 'select',
        options: [
          { value: '44100', label: '44.1 kHz' },
          { value: '48000', label: '48 kHz' },
          { value: '96000', label: '96 kHz' },
        ],
        default: '48000',
      },
      {
        key: 'ac', label: 'Channels', type: 'select',
        options: [
          { value: '1', label: 'Mono' },
          { value: '2', label: 'Stereo' },
        ],
        default: '2',
      },
    ],
  },
  {
    id: 'copy',
    label: 'Copy (Audio Passthrough)',
    type: 'audio',
    category: 'passthrough',
    params: [],
  },
];

// ── Utility: Filter codecs by build capabilities ─────────────────

/**
 * Maps build_options keys to the codec categories they unlock.
 * A codec with requiresBuildOption is hidden unless the build has that option enabled.
 */
export interface SystemCapabilities {
  vaapi: { available: boolean; details: string };
  nvenc: { available: boolean; details: string };
  v4l2: { available: boolean; details: string };
  alsa: { available: boolean; details: string };
  decklink: { available: boolean; details: string };
  avahi: { available: boolean; details: string };
  ffmpeg?: {
    filters: string[];
    decoders: string[];
    encoders: string[];
  };
}

export function getAvailableVideoCodecs(
  buildOptions?: Record<string, boolean>,
  systemCapabilities?: SystemCapabilities
): CodecDefinition[] {
  let codecs = VIDEO_CODECS;
  if (!buildOptions) {
    // No build selected — show only SW + passthrough
    codecs = VIDEO_CODECS.filter(c => !c.requiresBuildOption);
  } else {
    codecs = VIDEO_CODECS.filter(c => {
      if (!c.requiresBuildOption) return true;
      return buildOptions[c.requiresBuildOption] === true;
    });
  }

  // Filter out hardware codecs if the host hardware is not present
  if (systemCapabilities) {
    codecs = codecs.filter(c => {
      if (c.category === 'hw_nvenc' && !systemCapabilities.nvenc?.available) {
        return false;
      }
      if ((c.category === 'hw_vaapi' || c.category === 'hw_qsv') && !systemCapabilities.vaapi?.available) {
        return false;
      }
      return true;
    });
  }

  return codecs;
}

export function getAvailableAudioCodecs(_buildOptions?: Record<string, boolean>): CodecDefinition[] {
  // All audio codecs are software-based, no HW filtering needed
  return AUDIO_CODECS;
}

/**
 * Build the default params object for a codec definition.
 */
export function getDefaultParams(codec: CodecDefinition): Record<string, string | number | boolean> {
  const defaults: Record<string, string | number | boolean> = {};
  for (const param of codec.params) {
    defaults[param.key] = param.default;
  }
  return defaults;
}

/**
 * Check if a param should be visible given the current param values.
 */
export function isParamVisible(
  param: CodecParam,
  currentValues: Record<string, string | number | boolean>,
): boolean {
  if (!param.showWhen) return true;
  const { param: depKey, value: depVal } = param.showWhen;
  const current = currentValues[depKey];
  if (Array.isArray(depVal)) {
    return depVal.includes(String(current));
  }
  return String(current) === String(depVal);
}
