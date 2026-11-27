import { describe, it, expect } from 'vitest';
import { evaluateCodecRecipeStatus } from '../codecRecipeEvaluator';

describe('codecRecipeEvaluator', () => {
  it('returns info gracefully when codecConfig is absent', () => {
    expect(
      evaluateCodecRecipeStatus({ outputType: 'srt', hasVideo: true, hasAudio: true })
    ).toBe('info');
  });

  it('returns ok when video and audio codecs match destination requirements', () => {
    expect(
      evaluateCodecRecipeStatus({
        outputType: 'srt',
        vcodec: 'h264_vaapi',
        acodec: 'aac',
        hasVideo: true,
        hasAudio: true,
      })
    ).toBe('ok');

    expect(
      evaluateCodecRecipeStatus({
        outputType: 'rtmp',
        vcodec: 'libx264',
        acodec: 'aac',
        hasVideo: true,
        hasAudio: true,
      })
    ).toBe('ok');

    expect(
      evaluateCodecRecipeStatus({
        outputType: 'icecast',
        acodec: 'libmp3lame',
        hasVideo: false,
        hasAudio: true,
      })
    ).toBe('ok');

    expect(
      evaluateCodecRecipeStatus({
        outputType: 'ndi',
        vcodec: 'wrapped_avframe',
        acodec: 'pcm_s16le',
        hasVideo: true,
        hasAudio: true,
      })
    ).toBe('ok');

    expect(
      evaluateCodecRecipeStatus({
        outputType: 'decklink',
        vcodec: 'rawvideo',
        acodec: 'pcm_s16le',
        hasVideo: true,
        hasAudio: true,
      })
    ).toBe('ok');
  });

  it('returns warning for incompatible destination codec combinations', () => {
    expect(
      evaluateCodecRecipeStatus({
        outputType: 'rtmp',
        vcodec: 'hevc_nvenc',
        acodec: 'libopus',
        hasVideo: true,
        hasAudio: true,
      })
    ).toBe('warning');

    expect(
      evaluateCodecRecipeStatus({
        outputType: 'whip',
        vcodec: 'libx264',
        acodec: 'aac',
        hasVideo: true,
        hasAudio: true,
      })
    ).toBe('warning');

    expect(
      evaluateCodecRecipeStatus({
        outputType: 'decklink',
        vcodec: 'libx264',
        acodec: 'pcm_s16le',
        hasVideo: true,
        hasAudio: true,
      })
    ).toBe('warning');

    expect(
      evaluateCodecRecipeStatus({
        outputType: 'icecast',
        acodec: 'pcm_s16le',
        hasVideo: false,
        hasAudio: true,
      })
    ).toBe('warning');
  });

  it('returns info for suboptimal or auto-converted combinations', () => {
    expect(
      evaluateCodecRecipeStatus({
        outputType: 'alsa',
        acodec: 'aac',
        hasVideo: false,
        hasAudio: true,
      })
    ).toBe('info');

    expect(
      evaluateCodecRecipeStatus({
        outputType: 'file',
        vcodec: 'rawvideo',
        acodec: 'pcm_s16le',
        hasVideo: true,
        hasAudio: true,
      })
    ).toBe('info');
  });
});
