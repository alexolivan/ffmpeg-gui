export type CodecRecipeStatus = 'ok' | 'info' | 'warning';

export interface CodecRecipeEvalInput {
  outputType?: string;
  vcodec?: string;
  acodec?: string;
  hasVideo: boolean;
  hasAudio: boolean;
}

const H264_CODECS = new Set(['libx264', 'h264_vaapi', 'h264_qsv', 'h264_nvenc']);
const H265_CODECS = new Set(['libx265', 'hevc_vaapi', 'hevc_nvenc']);
const VPX_CODECS = new Set(['libvpx', 'libvpx-vp9', 'vp8_vaapi', 'vp9_vaapi']);
const RAW_VIDEO_CODECS = new Set(['rawvideo', 'v210', 'wrapped_avframe']);
const EDIT_VIDEO_CODECS = new Set(['prores_ks', 'dnxhd']);

const AAC_CODECS = new Set(['aac', 'libfdk_aac']);
const PCM_CODECS = new Set(['pcm_s16le', 'pcm_s24le']);

/**
 * Pure read-only visual classifier for DestinationPanel's Broadcast Recipe card.
 * Never mutates codecs — only chooses visual status ('ok' | 'info' | 'warning').
 */
export function evaluateCodecRecipeStatus({
  outputType,
  vcodec,
  acodec,
  hasVideo,
  hasAudio,
}: CodecRecipeEvalInput): CodecRecipeStatus {
  if (!outputType || (!vcodec && !acodec)) {
    return 'info';
  }

  const v = vcodec || '';
  const a = acodec || '';

  switch (outputType) {
    case 'udp':
    case 'srt':
    case 'rtsp': {
      const badVideo = hasVideo && Boolean(v) && (RAW_VIDEO_CODECS.has(v) || EDIT_VIDEO_CODECS.has(v) || VPX_CODECS.has(v));
      const badAudio = hasAudio && (a === 'libvorbis' || a === 'flac');
      if (badVideo || badAudio) return 'warning';

      const okVideo = !hasVideo || !v || H264_CODECS.has(v) || H265_CODECS.has(v) || v === 'copy';
      const okAudio =
        !hasAudio ||
        !a ||
        AAC_CODECS.has(a) ||
        PCM_CODECS.has(a) ||
        a === 'libopus' ||
        a === 'mp2' ||
        a === 'libmp3lame' ||
        a === 'copy';
      return okVideo && okAudio ? 'ok' : 'info';
    }

    case 'rtmp': {
      const badVideo = hasVideo && Boolean(v) && !H264_CODECS.has(v) && v !== 'copy';
      const badAudio = hasAudio && Boolean(a) && !AAC_CODECS.has(a) && a !== 'libmp3lame' && a !== 'copy';
      return badVideo || badAudio ? 'warning' : 'ok';
    }

    case 'whip': {
      const badVideo = hasVideo && Boolean(v) && !H264_CODECS.has(v) && !VPX_CODECS.has(v) && v !== 'copy';
      const badAudio = hasAudio && Boolean(a) && a !== 'libopus' && a !== 'copy';
      return badVideo || badAudio ? 'warning' : 'ok';
    }

    case 'hls': {
      const badVideo = hasVideo && Boolean(v) && !H264_CODECS.has(v) && !H265_CODECS.has(v) && v !== 'copy';
      const badAudio =
        hasAudio && Boolean(a) && !AAC_CODECS.has(a) && a !== 'libmp3lame' && a !== 'libopus' && a !== 'copy';
      return badVideo || badAudio ? 'warning' : 'ok';
    }

    case 'ndi': {
      const badVideo = hasVideo && Boolean(v) && v !== 'wrapped_avframe';
      const badAudio = hasAudio && Boolean(a) && a !== 'pcm_s16le' && a !== 'copy';
      return badVideo || badAudio ? 'warning' : 'ok';
    }

    case 'decklink': {
      const badVideo = hasVideo && Boolean(v) && v !== 'rawvideo' && v !== 'v210';
      const badAudio = hasAudio && Boolean(a) && !PCM_CODECS.has(a);
      return badVideo || badAudio ? 'warning' : 'ok';
    }

    case 'icecast': {
      if (hasVideo) return 'warning';
      if (hasAudio && PCM_CODECS.has(a)) return 'warning';
      const okAudio =
        !hasAudio ||
        !a ||
        AAC_CODECS.has(a) ||
        a === 'libmp3lame' ||
        a === 'libopus' ||
        a === 'libvorbis' ||
        a === 'flac' ||
        a === 'copy';
      return okAudio ? 'ok' : 'info';
    }

    case 'alsa':
    case 'pipewire': {
      if (hasVideo) return 'warning';
      const okAudio = !hasAudio || !a || PCM_CODECS.has(a) || a === 'copy';
      return okAudio ? 'ok' : 'info';
    }

    case 'rtp': {
      const badVideo = hasVideo && Boolean(v) && (RAW_VIDEO_CODECS.has(v) || EDIT_VIDEO_CODECS.has(v));
      if (badVideo) return 'warning';
      const okVideo = !hasVideo || !v || H264_CODECS.has(v) || H265_CODECS.has(v) || v === 'copy';
      const okAudio =
        !hasAudio || !a || AAC_CODECS.has(a) || PCM_CODECS.has(a) || a === 'libopus' || a === 'mp2' || a === 'copy';
      return okVideo && okAudio ? 'ok' : 'info';
    }

    case 'file': {
      if (hasVideo && Boolean(v) && RAW_VIDEO_CODECS.has(v)) return 'info';
      return 'ok';
    }

    default:
      return 'info';
  }
}
