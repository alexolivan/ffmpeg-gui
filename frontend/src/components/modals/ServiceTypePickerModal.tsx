import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { EngineLogo } from '../common/EngineLogo';

export interface ServiceTypeOption {
  key: string;
  service_type: string;
  name: string;
  category: string;
  description: string;
  badgeKey?: string;
  is_enabled: boolean;
}

interface ServiceTypePickerModalProps {
  API?: string;
  onClose: () => void;
  onSelectServiceType: (serviceType: string) => void;
}

const SERVICE_TYPE_DEFINITIONS: Record<string, { service_type: string; category: string; defaultDesc: string }> = {
  ffmpeg: {
    service_type: 'ffmpeg_stream',
    category: 'TRANSCODER & STREAMING',
    defaultDesc: 'Real-time video/audio transcoding, hardware acceleration (NVENC/VAAPI), ABR, and broadcast streaming pipeline.',
  },
  mediamtx: {
    service_type: 'mediamtx_hub',
    category: 'LIVE MEDIA HUB',
    defaultDesc: 'Multi-protocol live streaming hub supporting RTMP, RTSP, HLS, WebRTC (WHEP), and SRT distribution.',
  },
  icecast2: {
    service_type: 'icecast_server',
    category: 'AUDIO BROADCAST',
    defaultDesc: 'High-performance radio audio broadcasting server for MP3, AAC, and Ogg streams.',
  },
  kiosk_cog: {
    service_type: 'kiosk_browser',
    category: 'DISPLAY KIOSK',
    defaultDesc: 'Wayland/X11 web kiosk display browser for video feeds, overlays, and graphics.',
  },
};

export const ServiceTypePickerModal: React.FC<ServiceTypePickerModalProps> = ({
  API = '',
  onClose,
  onSelectServiceType,
}) => {
  const { t } = useTranslation();
  const [engines, setEngines] = useState<ServiceTypeOption[]>([]);
  const [selectedType, setSelectedType] = useState<string>('ffmpeg_stream');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/settings/software`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: Record<string, any>) => {
        const available: ServiceTypeOption[] = [];

        Object.values(data).forEach((eng: any) => {
          // Exclude internal helpers like decklink_tools
          if (eng.key === 'decklink_tools') return;
          if (!eng.is_enabled && !eng.always_enabled) return;

          const def = SERVICE_TYPE_DEFINITIONS[eng.key];
          if (def) {
            available.push({
              key: eng.key,
              service_type: def.service_type,
              name: eng.name,
              category: def.category,
              description: eng.description || def.defaultDesc,
              is_enabled: eng.is_enabled || eng.always_enabled,
            });
          }
        });

        // Ensure fallback to ffmpeg if none
        if (available.length === 0) {
          available.push({
            key: 'ffmpeg',
            service_type: 'ffmpeg_stream',
            name: 'FFmpeg Stream',
            category: 'TRANSCODER & STREAMING',
            description: SERVICE_TYPE_DEFINITIONS.ffmpeg.defaultDesc,
            is_enabled: true,
          });
        }

        setEngines(available);
        setSelectedType(available[0]?.service_type || 'ffmpeg_stream');
      })
      .catch(() => {
        setEngines([
          {
            key: 'ffmpeg',
            service_type: 'ffmpeg_stream',
            name: 'FFmpeg Stream',
            category: 'TRANSCODER & STREAMING',
            description: SERVICE_TYPE_DEFINITIONS.ffmpeg.defaultDesc,
            is_enabled: true,
          },
        ]);
      })
      .finally(() => setIsLoading(false));
  }, [API]);

  const handleConfirm = () => {
    onSelectServiceType(selectedType);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
      <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl w-full max-w-2xl p-6 shadow-2xl relative flex flex-col gap-5 overflow-hidden text-[var(--text-primary)]">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 w-7 h-7 bg-[var(--input-bg)] rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-border)] transition-all z-10 text-xs cursor-pointer"
        >
          ✕
        </button>

        {/* Header */}
        <div className="border-b border-[var(--glass-border)] pb-3">
          <div className="flex items-center gap-2">
            <span className="text-base">🚀</span>
            <h3 className="text-sm font-black tracking-wide uppercase">
              {t('services.picker.title', 'Create New Service: Select Engine')}
            </h3>
          </div>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            {t(
              'services.picker.subtitle',
              'Choose the underlying software engine architecture to configure for this new service.'
            )}
          </p>
        </div>

        {/* Engine Cards Grid */}
        {isLoading ? (
          <div className="py-12 flex items-center justify-center text-xs text-[var(--text-secondary)]">
            {t('common.loading', 'Loading engines...')}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 max-h-[55vh] overflow-y-auto custom-scrollbar p-0.5">
            {engines.map((eng) => {
              const isSelected = selectedType === eng.service_type;

              return (
                <div
                  key={eng.key}
                  onClick={() => setSelectedType(eng.service_type)}
                  onDoubleClick={() => onSelectServiceType(eng.service_type)}
                  className={`border rounded-xl p-4 flex flex-col justify-between gap-3 cursor-pointer transition-all relative overflow-hidden select-none ${
                    isSelected
                      ? 'bg-brand-lime/10 border-brand-lime shadow-md shadow-brand-lime/10 ring-1 ring-brand-lime/30 scale-[1.01]'
                      : 'bg-[var(--input-bg)] border-[var(--glass-border)] hover:border-brand-lime/40 hover:bg-[var(--bg-card)]'
                  }`}
                >
                  {/* Top: Logo, Name, Badge, and Radio */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {/* Enriched Custom Branding Logo */}
                      <div
                        className={`w-11 h-11 rounded-xl flex items-center justify-center p-1.5 shrink-0 transition-transform ${
                          isSelected
                            ? 'bg-brand-lime/20 border border-brand-lime/40 scale-105'
                            : 'bg-[var(--bg-card)] border border-[var(--glass-border)]'
                        }`}
                      >
                        <EngineLogo softwareType={eng.key} size={30} API={API} />
                      </div>

                      <div className="min-w-0">
                        <span className="text-[9px] font-mono font-bold tracking-wider text-brand-lime block uppercase">
                          {eng.category}
                        </span>
                        <h4 className="text-xs font-black uppercase text-[var(--text-primary)] tracking-wide truncate">
                          {eng.name}
                        </h4>
                      </div>
                    </div>

                    {/* Radio Indicator */}
                    <div className="shrink-0 pt-0.5">
                      <div
                        className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all ${
                          isSelected
                            ? 'border-brand-lime bg-brand-lime text-black'
                            : 'border-[var(--glass-border)] bg-[var(--bg-card)]'
                        }`}
                      >
                        {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-black" />}
                      </div>
                    </div>
                  </div>

                  {/* Functional Description */}
                  <p className="text-[11px] text-[var(--text-secondary)] line-clamp-3 leading-relaxed">
                    {eng.description}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-[var(--glass-border)]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-[var(--input-bg)] border border-[var(--glass-border)] hover:bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all cursor-pointer"
          >
            {t('common.cancel', 'Cancel')}
          </button>

          <button
            type="button"
            disabled={isLoading || !selectedType}
            onClick={handleConfirm}
            className="px-6 py-2 rounded-xl text-xs font-black uppercase tracking-wider bg-brand-lime text-black shadow-lg shadow-brand-lime/20 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer flex items-center gap-2"
          >
            <span>{t('services.picker.continue', 'Continue')}</span>
            <span>→</span>
          </button>
        </div>
      </div>
    </div>
  );
};
