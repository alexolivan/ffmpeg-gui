import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { PlusIcon, RefreshIcon, TrashIcon } from '../../Icons';

interface CachedServiceProtocol {
  srt_enabled?: boolean;
  srt_port?: number;
  rtmp_enabled?: boolean;
  rtmp_port?: number;
  hls_enabled?: boolean;
  hls_port?: number;
  paths?: Array<{ name: string; [key: string]: any }>;
  mounts?: Array<{ mount: string; [key: string]: any }>;
  [key: string]: any;
}

interface CachedService {
  id: number;
  name: string;
  alias?: string;
  service_type: string;
  status: string;
  allow_peer_lease?: boolean;
  protocols?: CachedServiceProtocol;
}

interface RemotePeerNode {
  id: number;
  name: string;
  base_url: string;
  token_id: string;
  status: 'online' | 'offline' | 'error';
  latency_ms: number | null;
  catalog_version: number;
  cached_services_json: CachedService[];
  last_seen: string | null;
  last_error: string | null;
  created_at: string | null;
}

interface RemotePeersCardProps {
  API: string;
}

export const RemotePeersCard: React.FC<RemotePeersCardProps> = ({ API }) => {
  const { t } = useTranslation();

  const [peers, setPeers] = useState<RemotePeerNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Connect Modal state
  const [showModal, setShowModal] = useState(false);
  const [joinToken, setJoinToken] = useState('');
  const [localAlias, setLocalAlias] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // Syncing tracking per peer id
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const fetchPeers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/peers/remote-nodes`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setPeers(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load remote peers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPeers();
  }, [API]);

  const handleOpenModal = () => {
    setShowModal(true);
    setJoinToken('');
    setLocalAlias('');
    setConnectError(null);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setConnectError(null);
  };

  const handleConnectPeer = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnectError(null);

    if (!joinToken.trim()) {
      setConnectError(t('settings.peers.joinTokenRequired', 'Please enter a join token'));
      return;
    }

    setConnecting(true);
    try {
      const res = await fetch(`${API}/api/peers/remote-nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          join_token: joinToken.trim(),
          name: localAlias.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${res.status}`);
      }

      await fetchPeers();
      setShowModal(false);
    } catch (err: any) {
      setConnectError(err.message || 'Failed to connect to remote peer');
    } finally {
      setConnecting(false);
    }
  };

  const handleSyncNode = async (nodeId: number) => {
    setSyncingId(nodeId);
    try {
      const res = await fetch(`${API}/api/peers/remote-nodes/${nodeId}/sync`, {
        method: 'POST',
      });
      if (res.ok) {
        await fetchPeers();
      }
    } catch (err) {
      console.error('Error syncing remote peer:', err);
    } finally {
      setSyncingId(null);
    }
  };

  const handleDeleteNode = async (node: RemotePeerNode) => {
    if (!window.confirm(t('settings.peers.confirmUnlinkPeer', 'Are you sure you want to unlink this remote peer? Discovered services from this peer will no longer be available.'))) {
      return;
    }
    setDeletingId(node.id);
    try {
      const res = await fetch(`${API}/api/peers/remote-nodes/${node.id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        await fetchPeers();
      }
    } catch (err) {
      console.error('Error deleting remote peer:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const renderServicePill = (svc: CachedService) => {
    const isMtx = svc.service_type === 'mediamtx_hub';
    const isIcecast = svc.service_type === 'icecast_server';
    const pathCount = svc.protocols?.paths?.length ?? 0;
    const mountCount = svc.protocols?.mounts?.length ?? 0;

    let summaryText = svc.name;
    if (isMtx) {
      summaryText = `MediaMTX (${t('settings.peers.pathsCount', '{{count}} Paths', { count: pathCount })})`;
    } else if (isIcecast) {
      summaryText = `Icecast2 (${t('settings.peers.mountsCount', '{{count}} Mounts', { count: mountCount })})`;
    }

    return (
      <span
        key={svc.id}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium bg-[var(--input-bg)] border border-[var(--glass-border)] text-[var(--text-primary)]"
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            svc.status === 'running' ? 'bg-emerald-400' : 'bg-text-secondary'
          }`}
        />
        <span className="font-semibold">{svc.name}</span>
        <span className="text-text-secondary font-mono">({summaryText})</span>
      </span>
    );
  };

  return (
    <div className="glass-card p-5 !rounded-2xl space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--glass-border)] pb-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-brand-blue" />
            <h4 className="text-brand-blue font-bold text-xs uppercase tracking-wider flex items-center gap-2">
              🌐 {t('settings.peers.remoteTitle', 'PEERS REMOTOS ENLAZADOS (REMOTE PEERS)')}
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-brand-blue/15 border border-brand-blue/30 text-brand-blue font-bold">
                {peers.length}
              </span>
            </h4>
          </div>
          <p className="text-[11px] text-text-secondary leading-tight">
            {t('settings.peers.remoteSubtitle', 'Auxiliary services hosted on connected remote peers can be leased and used directly in local FFmpeg pipelines.')}
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenModal}
          className="self-start sm:self-center flex items-center gap-1.5 px-3 py-1.5 bg-brand-blue/15 hover:bg-brand-blue/25 text-brand-blue border border-brand-blue/30 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer shrink-0 shadow-sm"
        >
          <PlusIcon size={14} />
          {t('settings.peers.connectRemoteBtn', 'Conectar con Peer Remoto')}
        </button>
      </div>

      {/* Global Error Banner */}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 font-mono">
          {error}
        </div>
      )}

      {/* Peers List */}
      {loading && peers.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-text-secondary text-xs">
          <span className="w-4 h-4 border-2 border-brand-blue border-t-transparent rounded-full animate-spin mr-2" />
          {t('common.loading', 'Loading...')}
        </div>
      ) : peers.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-8 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl text-center space-y-2">
          <div className="text-2xl">🌐</div>
          <p className="text-xs font-bold text-[var(--text-primary)]">
            {t('settings.peers.noRemotePeers', 'No hay peers remotos enlazados')}
          </p>
          <p className="text-[11px] text-text-secondary max-w-md">
            {t('settings.peers.noRemotePeersDesc', 'Link remote peers to discover their auxiliary services (MediaMTX, Icecast) and use them across nodes.')}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {peers.map((peer) => {
            const isSyncing = syncingId === peer.id;
            const isDeleting = deletingId === peer.id;

            return (
              <div
                key={peer.id}
                className="p-4 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl space-y-3 hover:border-[var(--glass-border-hover)] transition-all"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--glass-border)] pb-2.5">
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-[var(--text-primary)]">{peer.name}</span>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${
                            peer.status === 'online'
                              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                              : peer.status === 'error'
                              ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                              : 'bg-red-500/15 border-red-500/30 text-red-400'
                          }`}
                        >
                          {peer.status === 'online' && (
                            <>🟢 {t('settings.peers.statusOnline', 'Online')} · {peer.latency_ms ?? 0}ms</>
                          )}
                          {peer.status === 'error' && (
                            <>⚠️ {t('settings.peers.statusError', 'Error')}</>
                          )}
                          {peer.status === 'offline' && (
                            <>🔴 {t('settings.peers.statusOffline', 'Offline')}</>
                          )}
                        </span>
                      </div>
                      <span className="text-[10px] text-text-secondary font-mono block mt-0.5">
                        {peer.base_url}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    <button
                      type="button"
                      disabled={isSyncing}
                      onClick={() => handleSyncNode(peer.id)}
                      className="px-2.5 py-1 bg-brand-blue/10 hover:bg-brand-blue/20 text-brand-blue border border-brand-blue/30 rounded text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
                    >
                      <RefreshIcon size={12} className={isSyncing ? 'animate-spin' : ''} />
                      {isSyncing ? t('settings.peers.syncing', 'Syncing...') : t('settings.peers.syncBtn', 'Sincronizar')}
                    </button>
                    <button
                      type="button"
                      disabled={isDeleting}
                      onClick={() => handleDeleteNode(peer)}
                      className="px-2.5 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
                    >
                      <TrashIcon size={12} />
                      {t('settings.peers.unlinkBtn', 'Desvincular')}
                    </button>
                  </div>
                </div>

                {/* Discovered Services list */}
                <div className="space-y-1.5">
                  <span className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">
                    {t('settings.peers.servicesDiscovered', 'Servicios Descubiertos:')}
                  </span>
                  {peer.cached_services_json && peer.cached_services_json.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {peer.cached_services_json.map((svc) => renderServicePill(svc))}
                    </div>
                  ) : (
                    <span className="text-[11px] text-text-secondary italic">
                      {t('settings.peers.noServicesDiscovered', 'Sin servicios descubiertos')}
                    </span>
                  )}
                </div>

                {/* Status footer: last seen / last error */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[10px] text-text-secondary pt-1">
                  <span>
                    {t('settings.peers.lastSeen', 'Last Seen')}:{' '}
                    <span className="text-[var(--text-primary)] font-mono">
                      {peer.last_seen ? new Date(peer.last_seen).toLocaleString() : t('settings.peers.neverSeen', 'Nunca')}
                    </span>
                  </span>

                  {peer.last_error && (
                    <span className="text-amber-400 font-mono text-[10px]">
                      ⚠️ {peer.last_error}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Connect Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-300">
          <div className="glass-card w-full max-w-lg p-6 border-[var(--glass-border)] shadow-2xl space-y-4 relative">
            <form onSubmit={handleConnectPeer} className="space-y-4">
              <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-3">
                <h3 className="text-sm font-bold text-[var(--text-primary)] tracking-wide uppercase flex items-center gap-2">
                  🌐 {t('settings.peers.connectModalTitle', 'Conectar con Nodo Peer Remoto')}
                </h3>
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="text-text-secondary hover:text-[var(--text-primary)] text-xs cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">
                  {t('settings.peers.joinTokenLabel', 'Join Token (from remote node)')}
                </label>
                <textarea
                  required
                  rows={4}
                  placeholder={t('settings.peers.joinTokenPlaceholder', 'Paste Join Token (FGPEER-...)')}
                  value={joinToken}
                  onChange={(e) => setJoinToken(e.target.value)}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2.5 text-xs font-mono text-[var(--text-primary)] resize-none outline-none focus:border-brand-blue"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">
                  {t('settings.peers.localAliasLabel', 'Local Alias / Override Name (Optional)')}
                </label>
                <input
                  type="text"
                  placeholder={t('settings.peers.localAliasPlaceholder', 'Leave blank to use remote node hostname')}
                  value={localAlias}
                  onChange={(e) => setLocalAlias(e.target.value)}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-blue text-[var(--text-primary)]"
                />
              </div>

              {connectError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 font-mono">
                  {connectError}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2 border-t border-[var(--glass-border)]">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-4 py-2 bg-[var(--input-bg)] hover:bg-white/5 text-text-secondary hover:text-[var(--text-primary)] border border-[var(--glass-border)] rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer"
                >
                  {t('common.cancel', 'Cancel')}
                </button>
                <button
                  type="submit"
                  disabled={connecting}
                  className="px-4 py-2 bg-brand-blue/15 hover:bg-brand-blue/25 text-brand-blue border border-brand-blue/30 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer disabled:opacity-40 flex items-center gap-2"
                >
                  {connecting ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-brand-blue border-t-transparent rounded-full animate-spin" />
                      <span>{t('settings.peers.connecting', 'Connecting...')}</span>
                    </>
                  ) : (
                    <>
                      <PlusIcon size={14} />
                      <span>{t('settings.peers.connectBtn', 'Conectar Peer')}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
