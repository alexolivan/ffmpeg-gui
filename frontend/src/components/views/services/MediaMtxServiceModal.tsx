import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ServerIcon, ClipboardIcon } from '../../Icons';

interface MediaMtxServiceModalProps {
  service: any;
  isOpen: boolean;
  onClose: () => void;
  API: string;
}

export const MediaMtxServiceModal: React.FC<MediaMtxServiceModalProps> = ({
  service,
  isOpen,
  onClose,
  API,
}) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'endpoints' | 'logs'>('endpoints');
  const [logs, setLogs] = useState<string[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const mtxCfg = service?.config?.mediamtx_config || {};
  const host = window.location.hostname || 'localhost';

  // Available protocol endpoints
  const endpoints = [
    {
      key: 'rtmp',
      name: 'RTMP Publish / Play',
      enabled: mtxCfg.rtmp_enabled !== false,
      port: mtxCfg.rtmp_port || 1935,
      url: `rtmp://${host}:${mtxCfg.rtmp_port || 1935}/live/stream1`,
      desc: t('services.mediamtx.rtmpDesc', 'Publish from OBS or FFmpeg, or play via VLC'),
    },
    {
      key: 'rtsp',
      name: 'RTSP Stream',
      enabled: mtxCfg.rtsp_enabled !== false,
      port: mtxCfg.rtsp_port || 8554,
      url: `rtsp://${host}:${mtxCfg.rtsp_port || 8554}/live/stream1`,
      desc: t('services.mediamtx.rtspDesc', 'Low-latency IP cameras and RTSP clients'),
    },
    {
      key: 'hls',
      name: 'HLS Web Playback',
      enabled: mtxCfg.hls_enabled !== false,
      port: mtxCfg.hls_port || 8888,
      url: `http://${host}:${mtxCfg.hls_port || 8888}/live/stream1/index.m3u8`,
      desc: t('services.mediamtx.hlsDesc', 'HTTP Live Streaming for Safari, iOS, and Hls.js'),
    },
    {
      key: 'webrtc',
      name: 'WebRTC (WHEP / WHIP)',
      enabled: !!mtxCfg.webrtc_enabled,
      port: mtxCfg.webrtc_port || 8889,
      url: `http://${host}:${mtxCfg.webrtc_port || 8889}/live/stream1/whep`,
      desc: t('services.mediamtx.webrtcDesc', 'Ultra-low latency browser playback via WHEP'),
    },
    {
      key: 'srt',
      name: 'SRT (Secure Reliable Transport)',
      enabled: !!mtxCfg.srt_enabled,
      port: mtxCfg.srt_port || 8890,
      url: `srt://${host}:${mtxCfg.srt_port || 8890}?streamid=publish:live/stream1`,
      desc: t('services.mediamtx.srtDesc', 'High-resilience contribution over lossy networks'),
    },
  ];

  // Poll logs when modal and logs tab are active
  useEffect(() => {
    if (!isOpen || activeTab !== 'logs' || !service?.id) return;

    let isSubscribed = true;
    const fetchLogs = async () => {
      try {
        const res = await fetch(`${API}/api/processes/${service.id}/logs`);
        if (res.ok && isSubscribed) {
          const data = await res.json();
          if (Array.isArray(data)) {
            setLogs(data.map((l: any) => (typeof l === 'string' ? l : l.message || JSON.stringify(l))));
          }
        }
      } catch (err) {
        console.error(err);
      }
    };

    fetchLogs();
    const interval = setInterval(fetchLogs, 2000);
    return () => {
      isSubscribed = false;
      clearInterval(interval);
    };
  }, [isOpen, activeTab, service?.id, API]);

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const handleCopy = (key: string, url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  if (!isOpen || !service) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--glass-border)] bg-[var(--input-bg)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-lime/10 border border-brand-lime/20 flex items-center justify-center text-brand-lime">
              <ServerIcon size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black tracking-wide text-[var(--text-primary)] uppercase">
                  {service.name}
                </h2>
                <span
                  className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${
                    service.status === 'running'
                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                      : 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30'
                  }`}
                >
                  {service.status}
                </span>
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                MediaMTX Live Streaming Hub (PID: {service.pid || 'N/A'})
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-[var(--bg-card)] border border-[var(--glass-border)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-brand-lime/40 transition-all cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Tab buttons */}
        <div className="flex items-center gap-2 px-6 pt-3 border-b border-[var(--glass-border)]">
          <button
            type="button"
            onClick={() => setActiveTab('endpoints')}
            className={`pb-2.5 px-3 text-xs font-bold uppercase tracking-wider transition-all border-b-2 cursor-pointer ${
              activeTab === 'endpoints'
                ? 'border-brand-lime text-brand-lime'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {t('services.mediamtx.endpointsTab', 'Streaming Endpoints')}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('logs')}
            className={`pb-2.5 px-3 text-xs font-bold uppercase tracking-wider transition-all border-b-2 cursor-pointer ${
              activeTab === 'logs'
                ? 'border-brand-lime text-brand-lime'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {t('services.mediamtx.logsTab', 'Live Logs')}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          {activeTab === 'endpoints' ? (
            <div className="space-y-4">
              <p className="text-xs text-[var(--text-secondary)]">
                {t('services.mediamtx.endpointsExpl', 'Click any URL to copy it directly to your clipboard. Replace stream1 with your custom stream name.')}
              </p>

              <div className="space-y-3">
                {endpoints.map((ep) => (
                  <div
                    key={ep.key}
                    className={`bg-[var(--input-bg)] border rounded-xl p-4 transition-all ${
                      ep.enabled
                        ? 'border-[var(--glass-border)]'
                        : 'border-[var(--glass-border)] opacity-40'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
                          {ep.name}
                        </span>
                        <span className="text-[10px] font-mono bg-[var(--bg-card)] px-1.5 py-0.5 rounded border border-[var(--glass-border)] text-brand-lime">
                          Port {ep.port}
                        </span>
                      </div>
                      {ep.enabled ? (
                        <button
                          type="button"
                          onClick={() => handleCopy(ep.key, ep.url)}
                          className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded bg-brand-lime/10 text-brand-lime border border-brand-lime/20 hover:bg-brand-lime/20 transition-all cursor-pointer"
                        >
                          <ClipboardIcon size={12} />
                          <span>{copiedKey === ep.key ? t('common.copied', 'Copied!') : t('common.copy', 'Copy')}</span>
                        </button>
                      ) : (
                        <span className="text-[10px] text-[var(--text-secondary)]">
                          {t('common.disabled', 'Disabled')}
                        </span>
                      )}
                    </div>

                    <div className="font-mono text-xs text-[var(--text-primary)] bg-[var(--bg-card)] p-2.5 rounded-lg border border-[var(--glass-border)] break-all select-all">
                      {ep.url}
                    </div>
                    <p className="text-[11px] text-[var(--text-secondary)] mt-1.5">{ep.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-96">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-[var(--text-secondary)]">
                  {t('services.mediamtx.logsStreaming', 'Streaming daemon stdout / stderr')}
                </span>
                <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                    className="rounded border-[var(--glass-border)]"
                  />
                  <span>{t('services.mediamtx.autoScroll', 'Auto-scroll')}</span>
                </label>
              </div>

              <div className="flex-1 bg-black/90 rounded-xl p-4 font-mono text-xs text-emerald-400 overflow-y-auto custom-scrollbar border border-white/10 space-y-1">
                {logs.length === 0 ? (
                  <div className="text-zinc-500 italic text-center py-10">
                    {t('services.mediamtx.noLogsYet', 'Waiting for log output...')}
                  </div>
                ) : (
                  logs.map((line, idx) => (
                    <div key={idx} className="leading-relaxed whitespace-pre-wrap break-all">
                      {line}
                    </div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[var(--glass-border)] bg-[var(--input-bg)] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-[var(--bg-card)] border border-[var(--glass-border)] text-[var(--text-primary)] hover:border-brand-lime/40 transition-all cursor-pointer"
          >
            {t('common.close', 'Close')}
          </button>
        </div>
      </div>
    </div>
  );
};
