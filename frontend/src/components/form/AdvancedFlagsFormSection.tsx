import React from 'react';
import { useTranslation } from 'react-i18next';

interface AdvancedFlagsFormSectionProps {
  inputType: string;
  outputType?: string;
  realtime: boolean | null;
  stream_loop: number | null;
  threads: number;
  probesize: string;
  thread_queue_size: number;
  enable_preview?: boolean | null;
  flush_packets?: boolean | null;
  inputThreadQueueUnsupported?: boolean;
  onChange: (updates: {
    realtime?: boolean | null;
    stream_loop?: number | null;
    threads?: number;
    probesize?: string;
    thread_queue_size?: number;
    enable_preview?: boolean | null;
    flush_packets?: boolean | null;
  }) => void;
}

export const AdvancedFlagsFormSection: React.FC<AdvancedFlagsFormSectionProps> = ({
  inputType,
  outputType,
  realtime,
  stream_loop,
  threads,
  probesize,
  thread_queue_size,
  enable_preview,
  flush_packets,
  inputThreadQueueUnsupported = false,
  onChange,
}) => {
  const { t } = useTranslation();
  return (
    <div className="glass-card p-2.5 !rounded-lg space-y-2">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-brand-orange" />
        <h4 className="text-brand-orange font-bold text-xs uppercase tracking-wider">Advanced FFmpeg Flags</h4>
        <span className="text-[9px] text-white/20 italic ml-auto font-medium">Speed control & resource limits</span>
      </div>

      {/* Realtime (-re) */}
      {(() => {
        const isSelfPacedInput = ['file', 'lavfi_video', 'lavfi_audio'].includes(inputType);
        const showLiveRealtimeWarning = realtime === true && !isSelfPacedInput;
        return (
          <div className="p-2 bg-[var(--input-bg)] rounded-lg border border-[var(--glass-border)] space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-semibold text-[var(--text-primary)]">
                  {t('filters.advanced.realtimeTitle', 'Control de Velocidad en Tiempo Real')}{' '}
                  <code className="text-[9px] text-brand-orange bg-[var(--bg-card)] px-1.5 py-0.5 rounded ml-1 border border-[var(--glass-border)]">-re</code>
                </span>
                <span className="text-[10px] text-[var(--text-secondary)] leading-snug">
                  {t('filters.advanced.realtimeDesc', 'Limita la lectura al framerate nativo. Déjalo en Auto (ON solo en file/lavfi; nunca activar en fuentes en vivo).')}
                  {realtime === null && (
                    <span className="text-brand-lime ml-1">
                      (auto: {isSelfPacedInput ? 'ON' : 'OFF'})
                    </span>
                  )}
                </span>
              </div>
              <select
                className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg px-2 py-1 text-xs outline-none w-24 text-center text-[var(--text-primary)] shrink-0"
                value={realtime === null ? 'auto' : realtime ? 'on' : 'off'}
                onChange={e => {
                  const val = e.target.value;
                  onChange({ realtime: val === 'auto' ? null : val === 'on' });
                }}
              >
                <option value="auto">{t('filters.advanced.realtimeAuto', 'Auto')}</option>
                <option value="on">{t('filters.advanced.realtimeOn', 'Always ON')}</option>
                <option value="off">{t('filters.advanced.realtimeOff', 'Always OFF')}</option>
              </select>
            </div>
            {showLiveRealtimeWarning && (
              <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-brand-orange/10 border border-brand-orange/30 text-[10px] text-brand-orange">
                <span className="leading-snug">
                  ⚠️ {t('filters.advanced.realtimeLiveWarning', 'Activado manualmente sobre una fuente en vivo (NDI/SRT/DeckLink/ALSA). Limitar lectura con -re sobre relojes externos puede provocar pérdida de frames o desincronización.')}
                </span>
                <button
                  type="button"
                  onClick={() => onChange({ realtime: null })}
                  className="px-2 py-1 rounded bg-brand-orange/20 hover:bg-brand-orange/30 border border-brand-orange/40 font-bold uppercase tracking-wider shrink-0 cursor-pointer"
                >
                  {t('filters.advanced.realtimeResetAuto', 'Pasar a Auto')}
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* Video Preview MJPEG Toggle */}
      <div className="flex items-center justify-between p-2 bg-white/5 rounded-lg border border-white/5">
        <div className="flex flex-col gap-0.5 pr-2">
          <span className="text-xs font-semibold text-white">
            {t('filters.advanced.enablePreview', 'Monitor de Previsualización')} <code className="text-[9px] text-brand-orange bg-white/5 px-1.5 py-0.5 rounded ml-1">MJPEG</code>
          </span>
          <span className="text-[10px] text-[var(--text-secondary)] leading-snug">
            {t('filters.advanced.enablePreviewDesc', 'Genera miniaturas periódicas en memoria/disco para la GUI. Desactívalo en CPUs ajustadas o flujos en vivo exigentes para evitar caídas de velocidad (xruns en ALSA).')}
            {(enable_preview === null || enable_preview === undefined) && (
              <span className="text-brand-lime ml-1">
                (auto: {outputType === 'hls' ? 'OFF (HLS Web Native)' : 'ON'})
              </span>
            )}
          </span>
        </div>
        <select
          className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs outline-none w-24 text-center text-[var(--text-primary)]"
          value={enable_preview === null || enable_preview === undefined ? 'auto' : enable_preview ? 'on' : 'off'}
          onChange={e => {
            const val = e.target.value;
            onChange({ enable_preview: val === 'auto' ? null : val === 'on' });
          }}
        >
          <option value="auto">Auto</option>
          <option value="on">{t('common.enabled', 'ON')}</option>
          <option value="off">{t('common.disabled', 'OFF')}</option>
        </select>
      </div>

      {/* Flush AVIO Packets (-flush_packets 1) */}
      <div className="flex items-center justify-between p-2 bg-white/5 rounded-lg border border-white/5">
        <div className="flex flex-col gap-0.5 pr-3">
          <span className="text-xs font-semibold text-[var(--text-primary)]">
            {t('filters.advanced.flushPackets', 'Flush AVIO Packets')} <code className="text-[9px] text-brand-orange bg-white/5 px-1.5 py-0.5 rounded ml-1">-flush_packets 1</code>
          </span>
          <span className="text-[10px] text-[var(--text-secondary)] leading-snug">
            {t('filters.advanced.flushPacketsDesc', 'Flushes each encoded packet immediately (-flush_packets 1) without RAM batching, preventing TCP burst stalls in low-bitrate live audio streams (Icecast/SRT/RTMP).')}
            {(flush_packets === null || flush_packets === undefined) && (
              <span className="text-brand-lime ml-1">
                (auto: {outputType === 'icecast' ? 'ON (Icecast)' : 'OFF'})
              </span>
            )}
          </span>
        </div>
        <select
          className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs outline-none w-24 text-center text-[var(--text-primary)]"
          value={flush_packets === null || flush_packets === undefined ? 'auto' : flush_packets ? 'on' : 'off'}
          onChange={e => {
            const val = e.target.value;
            onChange({ flush_packets: val === 'auto' ? null : val === 'on' });
          }}
        >
          <option value="auto">Auto</option>
          <option value="on">{t('common.enabled', 'ON')}</option>
          <option value="off">{t('common.disabled', 'OFF')}</option>
        </select>
      </div>

      {/* Stream Loop — only for file inputs */}
      {inputType === 'file' && (
        <div className="flex items-center justify-between p-2 bg-white/5 rounded-lg border border-white/5 animate-in fade-in duration-200">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-semibold text-white">
              Input Loop <code className="text-[9px] text-brand-orange bg-white/5 px-1.5 py-0.5 rounded ml-1">-stream_loop</code>
            </span>
            <span className="text-[10px] text-text-secondary">Repeat file input. -1 = infinite, 0 = off.</span>
          </div>
          <input
            type="number" min="-1" max="9999"
            className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs outline-none w-20 text-center font-mono focus:border-brand-orange"
            value={stream_loop ?? 0}
            onChange={e => onChange({
              stream_loop: e.target.value === '' ? null : parseInt(e.target.value),
            })}
          />
        </div>
      )}

      {/* Resource Allocation Grid */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block mb-0.5">
            Threads <code className="text-[9px] text-brand-orange bg-white/5 px-1 rounded">-threads</code>
          </label>
          <input
            type="number" min="0" max="128" placeholder="0 = auto"
            className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono focus:border-brand-orange"
            value={threads || ''}
            onChange={e => onChange({
              threads: parseInt(e.target.value) || 0,
            })}
          />
        </div>
        <div>
          <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block mb-0.5">
            Queue Size <code className="text-[9px] text-brand-orange bg-white/5 px-1 rounded">-thread_queue_size</code>
          </label>
          <input
            type="number" min="0" max="65536" placeholder="0 = default"
            className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono focus:border-brand-orange"
            value={thread_queue_size || ''}
            onChange={e => onChange({
              thread_queue_size: parseInt(e.target.value) || 0,
            })}
          />
          {inputThreadQueueUnsupported && thread_queue_size > 0 && (
            <p className="text-[10px] text-brand-orange mt-1 leading-snug">
              {t('filters.advanced.threadQueueFfmpeg9Note')}
            </p>
          )}
        </div>
      </div>

      {/* Probesize row */}
      <div>
        <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block mb-0.5">
          Probe Size <code className="text-[9px] text-brand-orange bg-white/5 px-1 rounded">-probesize</code>
        </label>
        <input
          type="text" placeholder="e.g. 5M, 20M"
          className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none font-mono focus:border-brand-orange"
          value={probesize}
          onChange={e => onChange({
            probesize: e.target.value,
          })}
        />
      </div>
    </div>
  );
};

export default React.memo(AdvancedFlagsFormSection);
