import React, { useState, useEffect } from 'react';
import { FfmpegLogoIcon, ServerIcon } from '../Icons';

interface EngineLogoProps {
  softwareType?: string;
  size?: number;
  className?: string;
  API?: string;
}

export const EngineLogo: React.FC<EngineLogoProps> = ({
  softwareType = 'ffmpeg',
  size = 16,
  className = '',
  API = '',
}) => {
  const [hasError, setHasError] = useState(false);
  const [timestamp, setTimestamp] = useState(() => Date.now());

  useEffect(() => {
    const handleIconUpdate = () => {
      setHasError(false);
      setTimestamp(Date.now());
    };
    window.addEventListener('engine_icons_updated', handleIconUpdate);
    return () => window.removeEventListener('engine_icons_updated', handleIconUpdate);
  }, []);

  // Normalize softwareType
  let normalizedType = (softwareType || 'ffmpeg').toLowerCase();
  if (normalizedType.includes('ffmpeg') || normalizedType === 'ffmpeg_stream') {
    normalizedType = 'ffmpeg';
  } else if (normalizedType.includes('mediamtx') || normalizedType === 'mediamtx_hub') {
    normalizedType = 'mediamtx';
  } else if (normalizedType.includes('icecast') || normalizedType === 'icecast_server') {
    normalizedType = 'icecast2';
  } else if (normalizedType.includes('kiosk') || normalizedType.includes('cog') || normalizedType === 'kiosk_browser') {
    normalizedType = 'kiosk_cog';
  }

  const iconUrl = `${API}/api/settings/software/${normalizedType}/icon?t=${timestamp}`;

  if (!hasError) {
    return (
      <img
        key={`${normalizedType}-${timestamp}`}
        src={iconUrl}
        alt={normalizedType}
        style={{ width: size, height: size }}
        className={`object-contain inline-block shrink-0 ${className}`}
        onError={() => setHasError(true)}
      />
    );
  }

  if (normalizedType === 'ffmpeg') {
    return <FfmpegLogoIcon size={size} className={className} />;
  }

  return <ServerIcon size={size} className={className} />;
};
