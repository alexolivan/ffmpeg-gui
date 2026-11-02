import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

export interface AuditEntry {
  id: number;
  timestamp: string;
  channel: string;
  username: string;
  ip_address: string;
  action: string;
  target_type: string;
  target_id: string;
  target_name: string;
  changes: string;
  details: string;
}

interface AuditLogCardProps {
  API: string;
}

export const AuditLogCard: React.FC<AuditLogCardProps> = ({ API }) => {
  const { t } = useTranslation();

  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [page, setPage] = useState<number>(0);
  const pageSize = 25;

  const [actionFilter, setActionFilter] = useState<string>('all');
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('limit', String(pageSize));
      params.append('offset', String(page * pageSize));

      if (actionFilter !== 'all') {
        params.append('action', actionFilter);
      }
      if (channelFilter !== 'all') {
        params.append('channel', channelFilter);
      }
      if (searchQuery.trim()) {
        params.append('search', searchQuery.trim());
      }

      const res = await fetch(`${API}/api/audit-logs?${params.toString()}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
        setTotal(data.total || 0);
      }
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
    } finally {
      setIsLoading(false);
    }
  }, [API, page, actionFilter, channelFilter, searchQuery]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    fetchLogs();
  };

  const formatTimestamp = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch {
      return iso;
    }
  };

  const getActionBadgeColor = (action: string) => {
    const act = action.toUpperCase();
    if (act.includes('DELETE') || act.includes('STOP') || act.includes('UNLINK')) {
      return 'bg-red-500/15 text-red-400 border-red-500/30';
    }
    if (act.includes('CREATE') || act.includes('START') || act.includes('ENROLL')) {
      return 'bg-brand-lime/15 text-brand-lime border-brand-lime/30';
    }
    if (act.includes('UPDATE') || act.includes('RESTART')) {
      return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    }
    return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
  };

  const getChannelBadge = (channel: string) => {
    const ch = (channel || 'local_gui').toLowerCase();
    if (ch === 'cloudhub') {
      return (
        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/30 inline-flex items-center gap-1">
          ☁️ CloudHub
        </span>
      );
    }
    if (ch === 'local_gui') {
      return (
        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/30 inline-flex items-center gap-1">
          🖥️ Local GUI
        </span>
      );
    }
    return (
      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-500/10 text-zinc-400 border border-zinc-500/30 inline-flex items-center gap-1">
        ⌨️ {ch.toUpperCase()}
      </span>
    );
  };

  const maxPages = Math.ceil(total / pageSize);

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-6 space-y-6 shadow-[var(--card-shadow)]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
            <span>🛡️</span>
            <span>{t('settings.audit.title', 'Operational Audit Log')}</span>
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            {t('settings.audit.subtitle', 'Immutable history of human-initiated changes, operations, and configuration edits.')}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <a
            href={`${API}/api/audit-logs/download`}
            target="_blank"
            rel="noreferrer"
            download="audit.log"
            className="px-3 py-1.5 bg-[var(--input-bg)] hover:bg-[var(--glass-border)] text-[var(--text-primary)] border border-[var(--glass-border)] rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5"
            title={t('settings.audit.download_tooltip', 'Download raw audit.log from disk')}
          >
            <span>📥</span>
            <span>{t('settings.audit.download', 'Download audit.log')}</span>
          </a>

          <button
            type="button"
            onClick={fetchLogs}
            className="px-3 py-1.5 bg-[var(--input-bg)] hover:bg-[var(--glass-border)] text-[var(--text-primary)] border border-[var(--glass-border)] rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <span>↻</span>
            <span>{t('common.refresh', 'Refresh')}</span>
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <form onSubmit={handleSearchSubmit} className="flex flex-wrap items-center gap-3">
        <select
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            setPage(0);
          }}
          className="px-3 py-1.5 bg-[var(--input-bg)] text-[var(--text-primary)] border border-[var(--glass-border)] rounded-lg text-xs focus:outline-none focus:border-brand-lime"
        >
          <option value="all">{t('settings.audit.all_actions', 'All Actions')}</option>
          <option value="SERVICE_START">SERVICE_START</option>
          <option value="SERVICE_STOP">SERVICE_STOP</option>
          <option value="SERVICE_RESTART">SERVICE_RESTART</option>
          <option value="SERVICE_CREATE">SERVICE_CREATE</option>
          <option value="SERVICE_UPDATE">SERVICE_UPDATE</option>
          <option value="SERVICE_DELETE">SERVICE_DELETE</option>
          <option value="TASK_CREATE">TASK_CREATE</option>
          <option value="TASK_UPDATE">TASK_UPDATE</option>
          <option value="TASK_DELETE">TASK_DELETE</option>
          <option value="SETTINGS_UPDATE">SETTINGS_UPDATE</option>
          <option value="CLOUDHUB_ENROLL">CLOUDHUB_ENROLL</option>
          <option value="CLOUDHUB_UNLINK">CLOUDHUB_UNLINK</option>
        </select>

        <select
          value={channelFilter}
          onChange={(e) => {
            setChannelFilter(e.target.value);
            setPage(0);
          }}
          className="px-3 py-1.5 bg-[var(--input-bg)] text-[var(--text-primary)] border border-[var(--glass-border)] rounded-lg text-xs focus:outline-none focus:border-brand-lime"
        >
          <option value="all">{t('settings.audit.all_channels', 'All Channels')}</option>
          <option value="local_gui">Local GUI</option>
          <option value="cloudhub">CloudHub</option>
          <option value="local_cli">CLI</option>
        </select>

        <div className="flex-1 min-w-[200px] flex items-center gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('settings.audit.search_placeholder', 'Search target name, user, details...')}
            className="flex-1 px-3 py-1.5 bg-[var(--input-bg)] text-[var(--text-primary)] border border-[var(--glass-border)] rounded-lg text-xs placeholder-[var(--text-secondary)] focus:outline-none focus:border-brand-lime"
          />
          <button
            type="submit"
            className="px-3 py-1.5 bg-brand-lime/15 hover:bg-brand-lime/25 text-brand-lime border border-brand-lime/30 rounded-lg text-xs font-bold transition-all cursor-pointer"
          >
            {t('common.search', 'Search')}
          </button>
        </div>
      </form>

      {/* Table */}
      <div className="border border-[var(--glass-border)] rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="text-center py-12 text-xs text-[var(--text-secondary)]">
            {t('common.loading', 'Loading audit records...')}
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-12 text-xs text-[var(--text-secondary)]">
            {t('settings.audit.no_records', 'No audit entries match the current filter.')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--input-bg)] text-[var(--text-secondary)] border-b border-[var(--glass-border)] uppercase tracking-wider font-mono text-[10px]">
                <tr>
                  <th className="px-4 py-3">{t('settings.audit.col_time', 'Timestamp')}</th>
                  <th className="px-4 py-3">{t('settings.audit.col_channel', 'Channel')}</th>
                  <th className="px-4 py-3">{t('settings.audit.col_user', 'User')}</th>
                  <th className="px-4 py-3">{t('settings.audit.col_action', 'Action')}</th>
                  <th className="px-4 py-3">{t('settings.audit.col_target', 'Target')}</th>
                  <th className="px-4 py-3">{t('settings.audit.col_ip', 'IP / Tunnel')}</th>
                  <th className="px-4 py-3">{t('settings.audit.col_changes', 'Details & Semantic Diffs')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--glass-border)] text-[var(--text-primary)]">
                {logs.map((entry) => {
                  const isExpanded = expandedId === entry.id;
                  const hasDetails = Boolean(entry.changes || entry.details);
                  return (
                    <tr
                      key={entry.id}
                      onClick={() => hasDetails && setExpandedId(isExpanded ? null : entry.id)}
                      className={`hover:bg-[var(--input-bg)]/40 transition-colors ${hasDetails ? 'cursor-pointer' : ''}`}
                    >
                      <td className="px-4 py-3 font-mono text-[11px] text-[var(--text-secondary)] whitespace-nowrap">
                        {formatTimestamp(entry.timestamp)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {getChannelBadge(entry.channel)}
                      </td>
                      <td className="px-4 py-3 font-medium whitespace-nowrap">
                        {entry.username}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${getActionBadgeColor(
                            entry.action
                          )}`}
                        >
                          {entry.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-mono text-[11px] font-semibold text-[var(--text-primary)]">
                          {entry.target_name || `${entry.target_type} #${entry.target_id}`}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-[var(--text-secondary)] whitespace-nowrap">
                        {entry.ip_address || '—'}
                      </td>
                      <td className="px-4 py-3 text-[var(--text-secondary)] max-w-sm">
                        <div className={isExpanded ? '' : 'truncate'} title={entry.changes || entry.details || ''}>
                          {entry.changes || entry.details || '—'}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination Footer */}
      {total > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-[var(--text-secondary)]">
          <div>
            {t('settings.audit.pagination_summary', 'Showing {{start}}-{{end}} of {{total}} events', {
              start: page * pageSize + 1,
              end: Math.min((page + 1) * pageSize, total),
              total,
            })}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="px-3 py-1 bg-[var(--input-bg)] text-[var(--text-primary)] border border-[var(--glass-border)] rounded-lg text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--glass-border)] transition-colors"
            >
              {t('common.prev', 'Previous')}
            </button>
            <span className="font-mono text-[11px]">
              {page + 1} / {Math.max(1, maxPages)}
            </span>
            <button
              type="button"
              disabled={page + 1 >= maxPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1 bg-[var(--input-bg)] text-[var(--text-primary)] border border-[var(--glass-border)] rounded-lg text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--glass-border)] transition-colors"
            >
              {t('common.next', 'Next')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
