import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface PeerTelemetryItem {
  id: number;
  name: string;
  base_url: string;
  status: string;
  latency_ms: number | null;
  cached_services_count: number;
  last_seen: string | null;
  last_error: string | null;
}

interface PeerStatusCardProps {
  peers?: PeerTelemetryItem[];
  onRefreshAll?: () => void;
}

export const PeerStatusCard: React.FC<PeerStatusCardProps> = ({ peers = [], onRefreshAll }) => {
  const { t } = useTranslation();
  const [syncingId, setSyncingId] = useState<number | null>(null);

  if (!peers || peers.length === 0) {
    return null;
  }

  const handleSync = async (peerId: number) => {
    setSyncingId(peerId);
    try {
      await fetch(`/api/peers/remote-nodes/${peerId}/sync`, { method: 'POST' });
      if (onRefreshAll) onRefreshAll();
    } catch (e) {
      console.error('Failed to sync remote peer:', e);
    } finally {
      setSyncingId(null);
    }
  };

  const onlineCount = peers.filter(p => p.status === 'online').length;

  return (
    <div className="glass-card p-3.5 border-cyan-500/10 bg-cyan-500/2 space-y-2.5">
      <div className="flex items-center justify-between border-b border-cyan-500/10 pb-1.5 mb-2">
        <h3 className="text-sm font-black uppercase text-[var(--text-primary)] tracking-wider">
          {t('dashboard.peerStatus.title', 'Peer Status')}
        </h3>
        <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-500/30 text-cyan-300">
          {onlineCount}/{peers.length} {t('dashboard.peerStatus.online', 'online')}
        </span>
      </div>

      <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
        {peers.map(peer => {
          const isOnline = peer.status === 'online';
          const isPending = peer.status === 'pending';
          const isSyncing = syncingId === peer.id;

          return (
            <div
              key={peer.id}
              className="py-1.5 px-2.5 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg flex items-center justify-between gap-2.5 hover:border-cyan-500/40 transition-all"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      isOnline
                        ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]'
                        : isPending
                        ? 'bg-amber-400 animate-pulse'
                        : 'bg-rose-500'
                    }`}
                  />
                  <span className="text-xs font-bold text-[var(--text-primary)] truncate" title={peer.name}>
                    {peer.name}
                  </span>
                  <span className="text-[10px] text-[var(--text-secondary)] font-mono truncate max-w-[140px]" title={peer.base_url}>
                    {peer.base_url}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-[var(--text-secondary)]">
                  <span>
                    📦 {peer.cached_services_count}{' '}
                    {t('dashboard.peerStatus.servicesShared', 'services shared')}
                  </span>
                  {peer.last_error && !isOnline && (
                    <span className="text-rose-400 truncate max-w-[180px]" title={peer.last_error}>
                      ⚠️ {peer.last_error}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="text-right">
                  {isOnline ? (
                    <span className="text-xs font-mono font-bold text-brand-lime block">
                      {peer.latency_ms !== null ? `${peer.latency_ms}ms` : 'online'}
                    </span>
                  ) : (
                    <span className="text-xs font-mono font-bold text-rose-400 block uppercase">
                      {peer.status}
                    </span>
                  )}
                  {peer.last_seen && (
                    <span className="text-[8px] text-[var(--text-secondary)] font-mono block">
                      {new Date(peer.last_seen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  disabled={isSyncing}
                  onClick={() => handleSync(peer.id)}
                  title={t('dashboard.peerStatus.syncTooltip', 'Refresh connection & catalog')}
                  className="p-1 rounded bg-[var(--bg-card)] border border-[var(--glass-border)] text-[var(--text-secondary)] hover:text-cyan-300 hover:border-cyan-500/40 transition-colors disabled:opacity-50"
                >
                  <span className={`inline-block text-xs ${isSyncing ? 'animate-spin' : ''}`}>↻</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
