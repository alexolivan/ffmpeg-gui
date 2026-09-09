import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { useTranslation } from 'react-i18next';

interface HlsPlayerProps {
  src: string;
  autoPlay?: boolean;
  muted?: boolean;
  controls?: boolean;
  className?: string;
}

export const HlsPlayer: React.FC<HlsPlayerProps> = ({
  src,
  autoPlay = true,
  muted = true,
  controls = true,
  className = '',
}) => {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    setError(null);
    setLoading(true);

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
        manifestLoadingMaxRetry: 15,
        manifestLoadingRetryDelay: 1000,
      });
      hlsRef.current = hls;

      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false);
        if (autoPlay) {
          video.play().catch(() => {
            video.muted = true;
            video.play().catch(e => console.warn('HLS autoplay blocked:', e));
          });
        }
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              setError(data.details || 'Error playing HLS stream');
              hls.destroy();
              break;
          }
        }
      });

      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      const onLoaded = () => {
        setLoading(false);
        if (autoPlay) video.play().catch(console.warn);
      };
      const onError = () => {
        setError('Native HLS playback failed');
      };
      video.addEventListener('loadedmetadata', onLoaded);
      video.addEventListener('error', onError);
      return () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
      };
    } else {
      setError(t('modals.preview.hlsNotSupported', 'Tu navegador no soporta MediaSource Extensions ni HLS.'));
    }
  }, [src, autoPlay, t]);

  return (
    <div className={`relative aspect-video bg-black rounded-xl overflow-hidden border border-white/5 flex items-center justify-center shadow-2xl ${className}`}>
      {loading && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 z-10 gap-2">
          <div className="w-8 h-8 border-2 border-brand-lime border-t-transparent rounded-full animate-spin" />
          <span className="text-[10px] uppercase font-mono tracking-wider text-[var(--text-secondary)]">
            {t('modals.preview.bufferingHls', 'Conectando con el flujo HLS...')}
          </span>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10 p-4 text-center">
          <span className="text-2xl mb-1">⚠️</span>
          <span className="text-xs text-red-300 font-semibold">{error}</span>
          <button
            type="button"
            onClick={() => {
              if (hlsRef.current) {
                setError(null);
                setLoading(true);
                hlsRef.current.loadSource(src);
                hlsRef.current.startLoad();
              }
            }}
            className="mt-2.5 px-3 py-1 bg-white/10 hover:bg-white/20 rounded text-[10px] uppercase font-bold text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            {t('common.retry', 'Reintentar')}
          </button>
        </div>
      )}
      <video
        ref={videoRef}
        controls={controls}
        muted={muted}
        playsInline
        className="w-full h-full object-contain"
      />
      <div className="absolute top-2.5 left-2.5 px-2 py-0.5 bg-brand-lime text-black text-[8px] font-black rounded tracking-wider uppercase animate-pulse pointer-events-none z-20">
        HLS LIVE
      </div>
    </div>
  );
};
