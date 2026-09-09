import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { PlusIcon, ClipboardIcon, CheckIcon, TrashIcon } from '../../Icons';

interface InboundKey {
  id: number;
  alias: string;
  token_id: string;
  allowed_services: number[] | null;
  status: 'active' | 'suspended' | 'revoked';
  created_at: string | null;
  last_used_at: string | null;
}

interface CandidateEndpoint {
  interface: string;
  ip: string;
  url: string;
}

interface CandidateResponse {
  node_name: string;
  port: number;
  scheme: string;
  candidates: CandidateEndpoint[];
}

interface InboundKeysCardProps {
  API: string;
}

export const InboundKeysCard: React.FC<InboundKeysCardProps> = ({ API }) => {
  const { t } = useTranslation();

  const [keys, setKeys] = useState<InboundKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [modalStep, setModalStep] = useState<1 | 2>(1);
  const [alias, setAlias] = useState('');
  const [candidateOptions, setCandidateOptions] = useState<CandidateEndpoint[]>([]);
  const [selectedEndpointMode, setSelectedEndpointMode] = useState<string>('');
  const [customEndpoint, setCustomEndpoint] = useState('');
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generatedJoinToken, setGeneratedJoinToken] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);

  const fetchKeys = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/peers/inbound-keys`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setKeys(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load inbound keys');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKeys();
  }, [API]);

  const handleOpenModal = async () => {
    setShowModal(true);
    setModalStep(1);
    setAlias('');
    setCustomEndpoint('');
    setGenerateError(null);
    setGeneratedJoinToken('');
    setCopied(false);
    setLoadingCandidates(true);

    try {
      const res = await fetch(`${API}/api/peers/candidate-endpoints`);
      if (res.ok) {
        const data: CandidateResponse = await res.json();
        setCandidateOptions(data.candidates || []);
        if (data.candidates && data.candidates.length > 0) {
          setSelectedEndpointMode(data.candidates[0].url);
        } else {
          setSelectedEndpointMode('custom');
        }
      } else {
        setSelectedEndpointMode('custom');
      }
    } catch {
      setSelectedEndpointMode('custom');
    } finally {
      setLoadingCandidates(false);
    }
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setModalStep(1);
    setGeneratedJoinToken('');
    fetchKeys();
  };

  const handleGenerateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenerateError(null);

    const finalEndpoint = selectedEndpointMode === 'custom' ? customEndpoint.trim() : selectedEndpointMode.trim();
    if (!alias.trim()) {
      setGenerateError(t('settings.peers.aliasRequired', 'Please enter an alias'));
      return;
    }
    if (!finalEndpoint) {
      setGenerateError(t('settings.peers.endpointRequired', 'Please select or enter an endpoint'));
      return;
    }

    setGenerating(true);
    try {
      const res = await fetch(`${API}/api/peers/inbound-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alias: alias.trim(),
          endpoint: finalEndpoint,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setGeneratedJoinToken(data.join_token);
      setModalStep(2);
      fetchKeys();
    } catch (err: any) {
      setGenerateError(err.message || 'Failed to generate pairing key');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyToken = () => {
    if (!generatedJoinToken) return;
    navigator.clipboard.writeText(generatedJoinToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleToggleStatus = async (keyItem: InboundKey) => {
    const nextStatus = keyItem.status === 'active' ? 'suspended' : 'active';
    setActionLoadingId(keyItem.id);
    try {
      const res = await fetch(`${API}/api/peers/inbound-keys/${keyItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.ok) {
        await fetchKeys();
      }
    } catch (err) {
      console.error('Error toggling key status:', err);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDeleteKey = async (keyItem: InboundKey) => {
    if (!window.confirm(t('settings.peers.confirmRevokeKey', 'Are you sure you want to revoke this pairing key? The remote peer node will immediately lose auxiliary access.'))) {
      return;
    }
    setActionLoadingId(keyItem.id);
    try {
      const res = await fetch(`${API}/api/peers/inbound-keys/${keyItem.id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        await fetchKeys();
      }
    } catch (err) {
      console.error('Error deleting key:', err);
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <div className="glass-card p-5 !rounded-2xl space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--glass-border)] pb-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-brand-lime" />
            <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider flex items-center gap-2">
              🔑 {t('settings.peers.inboundTitle', 'CLAVES DE ENLACE PARA PEERS (INBOUND KEYS)')}
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-brand-lime/15 border border-brand-lime/30 text-brand-lime font-bold">
                {keys.length}
              </span>
            </h4>
          </div>
          <p className="text-[11px] text-text-secondary leading-tight">
            {t('settings.peers.inboundSubtitle', 'Pairing keys authorize remote ffmpeg-gui nodes to discover and lease auxiliary media services shared on this server.')}
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenModal}
          className="self-start sm:self-center flex items-center gap-1.5 px-3 py-1.5 bg-brand-lime/15 hover:bg-brand-lime/25 text-brand-lime border border-brand-lime/30 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer shrink-0 shadow-sm"
        >
          <PlusIcon size={14} />
          {t('settings.peers.generateKeyBtn', 'Generar Clave de Enlace')}
        </button>
      </div>

      {/* Error alert */}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 font-mono">
          {error}
        </div>
      )}

      {/* Keys List / Table */}
      {loading && keys.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-text-secondary text-xs">
          <span className="w-4 h-4 border-2 border-brand-lime border-t-transparent rounded-full animate-spin mr-2" />
          {t('common.loading', 'Loading...')}
        </div>
      ) : keys.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-8 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl text-center space-y-2">
          <div className="text-2xl">🔑</div>
          <p className="text-xs font-bold text-[var(--text-primary)]">
            {t('settings.peers.noInboundKeys', 'No pairing keys issued yet')}
          </p>
          <p className="text-[11px] text-text-secondary max-w-md">
            {t('settings.peers.noInboundKeysDesc', 'Generate a pairing key to allow external ffmpeg-gui nodes to connect and discover shared services.')}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[var(--glass-border)] text-[10px] uppercase font-bold text-text-secondary tracking-wider">
                <th className="pb-2.5 px-2">{t('settings.peers.tableAlias', 'Alias / Remote Node')}</th>
                <th className="pb-2.5 px-2">{t('settings.peers.tableTokenId', 'Token ID')}</th>
                <th className="pb-2.5 px-2">{t('settings.peers.tableStatus', 'Status')}</th>
                <th className="pb-2.5 px-2">{t('settings.peers.tableCreatedAt', 'Created At')}</th>
                <th className="pb-2.5 px-2">{t('settings.peers.tableLastUsedAt', 'Last Used')}</th>
                <th className="pb-2.5 px-2 text-right">{t('settings.peers.tableActions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--glass-border)]">
              {keys.map((k) => {
                const isItemLoading = actionLoadingId === k.id;
                return (
                  <tr key={k.id} className="hover:bg-[var(--input-bg)]/50 transition-colors">
                    <td className="py-2.5 px-2 font-bold text-[var(--text-primary)]">
                      {k.alias}
                    </td>
                    <td className="py-2.5 px-2 font-mono text-[11px] text-text-secondary">
                      {k.token_id}
                    </td>
                    <td className="py-2.5 px-2">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${
                          k.status === 'active'
                            ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                            : 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                        }`}
                      >
                        {k.status === 'active'
                          ? t('settings.peers.statusActive', 'Activo')
                          : t('settings.peers.statusSuspended', 'Suspendido')}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-text-secondary text-[11px]">
                      {k.created_at ? new Date(k.created_at).toLocaleString() : '-'}
                    </td>
                    <td className="py-2.5 px-2 text-text-secondary text-[11px]">
                      {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : t('settings.peers.neverUsed', 'Nunca')}
                    </td>
                    <td className="py-2.5 px-2 text-right space-x-1.5 whitespace-nowrap">
                      <button
                        type="button"
                        disabled={isItemLoading}
                        onClick={() => handleToggleStatus(k)}
                        className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer border ${
                          k.status === 'active'
                            ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border-amber-500/30'
                            : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                        } disabled:opacity-50`}
                      >
                        {k.status === 'active'
                          ? `⏸️ ${t('settings.peers.suspendBtn', 'Suspender')}`
                          : `▶️ ${t('settings.peers.reactivateBtn', 'Reactivar')}`}
                      </button>
                      <button
                        type="button"
                        disabled={isItemLoading}
                        onClick={() => handleDeleteKey(k)}
                        className="px-2 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer disabled:opacity-50 inline-flex items-center gap-1"
                      >
                        <TrashIcon size={12} />
                        {t('settings.peers.revokeBtn', 'Revocar')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-300">
          <div className="glass-card w-full max-w-lg p-6 border-[var(--glass-border)] shadow-2xl space-y-4 relative">
            {modalStep === 1 ? (
              <form onSubmit={handleGenerateKey} className="space-y-4">
                <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-3">
                  <h3 className="text-sm font-bold text-[var(--text-primary)] tracking-wide uppercase flex items-center gap-2">
                    🔑 {t('settings.peers.generateKeyBtn', 'Generar Clave de Enlace')}
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
                    {t('settings.peers.aliasLabel', 'Remote Node Alias / Label')}
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={t('settings.peers.aliasPlaceholder', 'e.g. VPS1 Ingest Node')}
                    value={alias}
                    onChange={(e) => setAlias(e.target.value)}
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime text-[var(--text-primary)]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">
                    {t('settings.peers.endpointSelectLabel', 'Candidate Endpoint Address')}
                  </label>
                  {loadingCandidates ? (
                    <div className="text-xs text-text-secondary flex items-center gap-2 p-2">
                      <span className="w-3.5 h-3.5 border-2 border-brand-lime border-t-transparent rounded-full animate-spin" />
                      {t('common.loading', 'Loading...')}
                    </div>
                  ) : (
                    <select
                      value={selectedEndpointMode}
                      onChange={(e) => setSelectedEndpointMode(e.target.value)}
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime text-[var(--text-primary)] font-mono cursor-pointer"
                    >
                      {candidateOptions.map((cand, idx) => (
                        <option key={idx} value={cand.url} className="bg-[var(--bg-card)] text-[var(--text-primary)]">
                          {cand.url} ({cand.interface} - {cand.ip})
                        </option>
                      ))}
                      <option value="custom" className="bg-[var(--bg-card)] text-[var(--text-primary)]">
                        {t('settings.peers.endpointCustom', 'Custom Endpoint URL...')}
                      </option>
                    </select>
                  )}
                </div>

                {selectedEndpointMode === 'custom' && (
                  <div className="space-y-1 animate-in fade-in">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">
                      {t('settings.peers.customEndpointLabel', 'Custom Base URL / Endpoint')}
                    </label>
                    <input
                      type="url"
                      required
                      placeholder={t('settings.peers.customEndpointPlaceholder', 'https://node.example.com:8443')}
                      value={customEndpoint}
                      onChange={(e) => setCustomEndpoint(e.target.value)}
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime text-[var(--text-primary)] font-mono"
                    />
                  </div>
                )}

                {generateError && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 font-mono">
                    {generateError}
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
                    disabled={generating}
                    className="px-4 py-2 bg-brand-lime/15 hover:bg-brand-lime/25 text-brand-lime border border-brand-lime/30 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer disabled:opacity-40 flex items-center gap-2"
                  >
                    {generating ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-brand-lime border-t-transparent rounded-full animate-spin" />
                        <span>{t('settings.peers.generatingKey', 'Generating Key...')}</span>
                      </>
                    ) : (
                      <>
                        <PlusIcon size={14} />
                        <span>{t('settings.peers.submitGenerateKey', 'Generar Clave de Enlace')}</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4 animate-in fade-in">
                <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-3">
                  <h3 className="text-sm font-bold text-brand-lime tracking-wide uppercase flex items-center gap-2">
                    ✓ {t('settings.peers.tokenGeneratedTitle', 'Pairing Join Token Generated')}
                  </h3>
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="text-text-secondary hover:text-[var(--text-primary)] text-xs cursor-pointer"
                  >
                    ✕
                  </button>
                </div>

                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-400 leading-relaxed flex items-start gap-2.5">
                  <span className="text-base shrink-0">⚠️</span>
                  <div>{t('settings.peers.tokenSecretWarning', 'IMPORTANT: This token contains the pre-shared AES-256-GCM secret key. It will not be shown again. Securely transfer it to the remote node administrator.')}</div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">
                      Join Token
                    </label>
                    <button
                      type="button"
                      onClick={handleCopyToken}
                      className="text-xs text-brand-lime hover:underline font-bold flex items-center gap-1 cursor-pointer"
                    >
                      {copied ? (
                        <>
                          <CheckIcon size={12} />
                          <span>{t('settings.peers.tokenCopied', 'Copied!')}</span>
                        </>
                      ) : (
                        <>
                          <ClipboardIcon size={12} />
                          <span>{t('settings.peers.copyToken', 'Copiar Token')}</span>
                        </>
                      )}
                    </button>
                  </div>
                  <div className="relative">
                    <textarea
                      readOnly
                      rows={5}
                      value={generatedJoinToken}
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2.5 text-xs font-mono text-[var(--text-primary)] resize-none outline-none select-all"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-2 border-t border-[var(--glass-border)]">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="px-5 py-2 bg-brand-lime/15 hover:bg-brand-lime/25 text-brand-lime border border-brand-lime/30 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer"
                  >
                    {t('common.close', 'Cerrar')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
