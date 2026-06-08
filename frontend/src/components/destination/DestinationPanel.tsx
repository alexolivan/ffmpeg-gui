import React from 'react';
import { HlsVariantsForm, type HlsVariant } from './HlsVariantsForm';

export interface OutputConfig {
  type: string;
  host?: string;
  port?: string;
  path?: string;
  url?: string;
  mode?: string;
  latency?: number;
  container?: string;
  icecast_mount?: string;
  icecast_password?: string;
  device?: string;
  hls_method?: string;
  hls_time?: number;
  hls_list_size?: number;
  hls_delete_segments?: boolean;
  headers?: string;
  variants?: HlsVariant[];
}

interface DestinationPanelProps {
  config: OutputConfig;
  hasVideo: boolean;
  hasAudio: boolean;
  onChange: (config: OutputConfig) => void;
}

const OUTPUT_TYPES = [
  { value: 'udp', label: 'UDP Multicast (MPEG-TS)', requiresVideo: false },
  { value: 'srt', label: 'SRT Stream', requiresVideo: false },
  { value: 'rtmp', label: 'RTMP / RTMPS Push', requiresVideo: true },
  { value: 'ndi', label: 'NDI Output', requiresVideo: true },
  { value: 'decklink', label: 'Blackmagic Decklink Output', requiresVideo: true },
  { value: 'file', label: 'Local Recording', requiresVideo: false },
  { value: 'icecast', label: 'Icecast2 (Audio Stream)', requiresVideo: false },
  { value: 'rtp', label: 'RTP Stream', requiresVideo: false },
  { value: 'hls', label: 'HLS Live Streaming', requiresVideo: false },
];

const CONTAINERS = [
  { value: 'mp4', label: 'MP4' },
  { value: 'mkv', label: 'MKV (Matroska)' },
  { value: 'mov', label: 'MOV (QuickTime)' },
  { value: 'ts', label: 'MPEG-TS' },
];

const DestinationPanel: React.FC<DestinationPanelProps> = ({
  config,
  hasVideo,
  hasAudio,
  onChange,
}) => {
  const availableTypes = OUTPUT_TYPES.filter(t => {
    if (t.requiresVideo && !hasVideo) return false;
    if (t.value === 'icecast' && (!hasAudio || hasVideo)) return false;
    return true;
  });

  const update = (patch: Partial<OutputConfig>) => {
    onChange({ ...config, ...patch });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
        <h4 className="text-purple-400 font-bold text-xs uppercase tracking-wider">Destination</h4>
      </div>

      <select
        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm outline-none focus:border-purple-400 transition-all"
        value={config.type}
        onChange={e => update({
          type: e.target.value,
          host: '', port: '', path: '', url: '',
          mode: 'caller', latency: 200,
          container: 'mp4', icecast_mount: '', icecast_password: '',
          hls_method: 'local', hls_time: 2, hls_list_size: 5, hls_delete_segments: true, headers: '',
        })}
      >
        {availableTypes.map(t => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>

      {/* ── Type-specific fields ── */}

      {(config.type === 'udp' || config.type === 'rtp') && (
        <div className="grid grid-cols-2 gap-3">
          <input
            type="text" placeholder="Host / Multicast"
            className="bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
            value={config.host || ''} onChange={e => update({ host: e.target.value })}
          />
          <input
            type="text" placeholder="Port"
            className="bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
            value={config.port || ''} onChange={e => update({ port: e.target.value })}
          />
        </div>
      )}

      {config.type === 'srt' && (
        <div className="grid grid-cols-2 gap-3">
          <input
            type="text" placeholder="Host"
            className="bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
            value={config.host || ''} onChange={e => update({ host: e.target.value })}
          />
          <input
            type="text" placeholder="Port"
            className="bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
            value={config.port || ''} onChange={e => update({ port: e.target.value })}
          />
          <select
            className="bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
            value={config.mode || 'caller'} onChange={e => update({ mode: e.target.value })}
          >
            <option value="caller">Caller (Client)</option>
            <option value="listener">Listener (Server)</option>
          </select>
          <div>
            <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">Latency (ms)</label>
            <input
              type="number" placeholder="200" min={20} max={8000}
              className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono"
              value={config.latency || 200}
              onChange={e => update({ latency: Number(e.target.value) })}
            />
          </div>
        </div>
      )}

      {config.type === 'rtmp' && (
        <input
          type="text"
          placeholder="RTMP URL (rtmp://server/live/key)"
          className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
          value={config.url || ''} onChange={e => update({ url: e.target.value })}
        />
      )}

      {config.type === 'ndi' && (
        <input
          type="text"
          placeholder="NDI Output Name (e.g. MY-ENCODER)"
          className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
          value={config.path || ''} onChange={e => update({ path: e.target.value })}
        />
      )}

      {config.type === 'decklink' && (
        <input
          type="text"
          placeholder="Device name (e.g. DeckLink Mini Monitor)"
          className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
          value={config.device || ''} onChange={e => update({ device: e.target.value })}
        />
      )}

      {config.type === 'file' && (
        <div className="grid grid-cols-3 gap-3">
          <input
            type="text"
            placeholder="Output file path"
            className="col-span-2 bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
            value={config.path || ''} onChange={e => update({ path: e.target.value })}
          />
          <select
            className="bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
            value={config.container || 'mp4'}
            onChange={e => update({ container: e.target.value })}
          >
            {CONTAINERS.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
      )}

      {config.type === 'icecast' && (
        <div className="grid grid-cols-2 gap-3">
          <input
            type="text" placeholder="Icecast Host"
            className="bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
            value={config.host || ''} onChange={e => update({ host: e.target.value })}
          />
          <input
            type="text" placeholder="Port (default: 8000)"
            className="bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
            value={config.port || ''} onChange={e => update({ port: e.target.value })}
          />
          <input
            type="text" placeholder="Mount point (e.g. /live)"
            className="bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
            value={config.icecast_mount || ''} onChange={e => update({ icecast_mount: e.target.value })}
          />
          <input
            type="password" placeholder="Source password"
            className="bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
            value={config.icecast_password || ''} onChange={e => update({ icecast_password: e.target.value })}
          />
        </div>
      )}

      {config.type === 'hls' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">HLS Ingest Method</label>
              <select
                className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
                value={config.hls_method || 'local'}
                onChange={e => update({ hls_method: e.target.value })}
              >
                <option value="local">Local Directory (.m3u8 + .ts)</option>
                <option value="PUT">HTTP PUT Upload</option>
                <option value="POST">HTTP POST Upload</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">Segment (s)</label>
                <input
                  type="number" min={1} max={60}
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono"
                  value={config.hls_time ?? 2}
                  onChange={e => update({ hls_time: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">List Size</label>
                <input
                  type="number" min={2} max={100}
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono"
                  value={config.hls_list_size ?? 5}
                  onChange={e => update({ hls_list_size: Number(e.target.value) })}
                />
              </div>
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">
              {config.hls_method === 'local' ? 'Output Playlist File Path' : 'Remote Ingest URL'}
            </label>
            <input
              type="text"
              placeholder={config.hls_method === 'local' ? 'e.g. /var/www/html/live/stream.m3u8' : 'e.g. http://ingest.server/live/stream.m3u8'}
              className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none"
              value={config.path || ''}
              onChange={e => update({ path: e.target.value })}
            />
          </div>

          {config.hls_method === 'local' && (
            <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/5">
              <input
                type="checkbox" id="hls-delete-chk"
                className="w-4 h-4 accent-purple-400"
                checked={config.hls_delete_segments ?? true}
                onChange={e => update({ hls_delete_segments: e.target.checked })}
              />
              <label htmlFor="hls-delete-chk" className="text-sm font-medium cursor-pointer">
                Delete Expired Segments (keep playlist clean)
              </label>
            </div>
          )}

          {(config.hls_method === 'PUT' || config.hls_method === 'POST') && (
            <div>
              <label className="text-[10px] uppercase text-text-secondary font-bold block mb-1">Custom HTTP Headers (Optional)</label>
              <textarea
                placeholder="e.g. Authorization: Bearer token123&#10;X-Custom-Header: value"
                rows={2}
                className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm outline-none font-mono resize-none"
                value={config.headers || ''}
                onChange={e => update({ headers: e.target.value })}
              />
            </div>
          )}

          <HlsVariantsForm
            variants={config.variants || []}
            onChange={variants => update({ variants })}
          />
        </div>
      )}
    </div>
  );
};

export default DestinationPanel;
