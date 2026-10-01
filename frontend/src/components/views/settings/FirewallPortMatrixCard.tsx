import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export interface PortMatrixEntry {
  port: number;
  proto: 'tcp' | 'udp';
  service_id?: number | null;
  service_name: string;
  service_type: string;
  category: 'core' | 'auxiliary' | 'pipeline';
  description: string;
  bind_address: string;
  status: 'running' | 'stopped';
  is_socket_open: boolean;
  requires_inbound_firewall: boolean;
}

export interface FirewallRules {
  ufw: string[];
  iptables: string[];
}

interface ServiceGroup {
  id: string;
  name: string;
  type: string;
  category: 'core' | 'auxiliary' | 'pipeline';
  bind_address: string;
  status: 'running' | 'stopped';
  listeningCount: number;
  totalCount: number;
  portsSummary: string;
  entries: PortMatrixEntry[];
}

interface FirewallPortMatrixCardProps {
  API?: string;
}

export const FirewallPortMatrixCard: React.FC<FirewallPortMatrixCardProps> = ({ API = '' }) => {
  const { t } = useTranslation();
  const [matrix, setMatrix] = useState<PortMatrixEntry[]>([]);
  const [rules, setRules] = useState<FirewallRules>({ ufw: [], iptables: [] });
  const [loading, setLoading] = useState(false);
  const [copiedType, setCopiedType] = useState<'ufw' | 'iptables' | null>(null);
  const [showScriptDrawer, setShowScriptDrawer] = useState(false);
  const [activeTab, setActiveTab] = useState<'ufw' | 'iptables'>('ufw');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const fetchPortMatrix = () => {
    setLoading(true);
    fetch(`${API}/api/system/network/port-matrix`)
      .then((res) => (res.ok ? res.json() : { matrix: [], firewall_rules: { ufw: [], iptables: [] } }))
      .then((data) => {
        if (Array.isArray(data.matrix)) setMatrix(data.matrix);
        if (data.firewall_rules) setRules(data.firewall_rules);
      })
      .catch((err) => console.error('Failed to load port matrix:', err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchPortMatrix();
  }, [API]);

  // Group matrix entries by service/daemon
  const serviceGroups = useMemo<ServiceGroup[]>(() => {
    const groupsMap = new Map<string, ServiceGroup>();

    matrix.forEach((item) => {
      const key = `${item.service_type || 'service'}-${item.service_id ?? item.service_name}`;
      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          id: key,
          name: item.service_name,
          type: item.service_type,
          category: item.category,
          bind_address: item.bind_address,
          status: item.status,
          listeningCount: 0,
          totalCount: 0,
          portsSummary: '',
          entries: [],
        });
      }
      const group = groupsMap.get(key)!;
      group.entries.push(item);
      group.totalCount += 1;
      if (item.is_socket_open) group.listeningCount += 1;
      if (item.status === 'running') group.status = 'running';
    });

    return Array.from(groupsMap.values()).map((g) => {
      const ports = Array.from(new Set(g.entries.map((e) => `${e.port}/${e.proto.toUpperCase()}`))).join(', ');
      return { ...g, portsSummary: ports };
    });
  }, [matrix]);

  const toggleGroup = (id: string) => {
    setExpandedGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const allExpanded = serviceGroups.length > 0 && serviceGroups.every((g) => expandedGroups[g.id]);

  const toggleAllGroups = () => {
    const nextState = !allExpanded;
    const next: Record<string, boolean> = {};
    serviceGroups.forEach((g) => {
      next[g.id] = nextState;
    });
    setExpandedGroups(next);
  };

  const handleCopy = (type: 'ufw' | 'iptables') => {
    const lines = type === 'ufw' ? rules.ufw : rules.iptables;
    const header =
      type === 'ufw'
        ? '#!/bin/bash\n# FFMPEG-GUI UFW Firewall Rules\n'
        : '#!/bin/bash\n# FFMPEG-GUI iptables Firewall Rules\n';
    const content = header + lines.join('\n') + '\n';
    navigator.clipboard.writeText(content).then(() => {
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 2500);
    });
  };

  const getServiceIcon = (type: string, category: string) => {
    if (category === 'core' || type === 'core') return '🌐';
    if (type === 'mediamtx') return '⚡';
    if (type === 'icecast') return '📻';
    if (type === 'vnc' || type === 'desktop') return '🖥️';
    return '🔌';
  };

  const openSocketsCount = matrix.filter((e) => e.is_socket_open).length;

  return (
    <div className="glass-card p-4 space-y-4 border-[var(--glass-border)] bg-[var(--bg-card)]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--glass-border)] pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base">🛡️</span>
            <h4 className="text-xs font-black uppercase tracking-wider text-[var(--text-primary)]">
              {t('settings.network.firewall.title', 'FIREWALL & ACTIVE PORT MATRIX')}
            </h4>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold">
              {openSocketsCount} / {matrix.length} {t('settings.network.firewall.activeSockets', 'listening')}
            </span>
          </div>
          <p className="text-[11px] text-text-secondary mt-0.5">
            {t(
              'settings.network.firewall.subtitle',
              'Real-time inspection of open network ports, daemon bindings, and 1-click firewall rule generators.'
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={fetchPortMatrix}
            disabled={loading}
            className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-[var(--input-bg)] border border-[var(--glass-border)] text-[var(--text-primary)] hover:border-brand-lime transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title={t('common.refresh', 'Refresh')}
          >
            <span className={loading ? 'animate-spin' : ''}>↻</span>
            <span className="hidden sm:inline">{t('common.refresh', 'Refresh')}</span>
          </button>

          {serviceGroups.length > 0 && (
            <button
              type="button"
              onClick={toggleAllGroups}
              className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-[var(--input-bg)] border border-[var(--glass-border)] text-text-secondary hover:text-[var(--text-primary)] transition-all flex items-center gap-1 cursor-pointer"
            >
              <span>{allExpanded ? '⊟' : '⊞'}</span>
              <span className="hidden sm:inline">
                {allExpanded
                  ? t('settings.network.firewall.collapseAll', 'Collapse All')
                  : t('settings.network.firewall.expandAll', 'Expand All')}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={() => handleCopy('ufw')}
            className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 transition-all flex items-center gap-1 cursor-pointer"
          >
            <span>{copiedType === 'ufw' ? '✓' : '📋'}</span>
            <span>{copiedType === 'ufw' ? t('common.copied', 'Copied!') : 'UFW'}</span>
          </button>

          <button
            type="button"
            onClick={() => handleCopy('iptables')}
            className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-brand-orange/10 hover:bg-brand-orange/20 text-brand-orange border border-brand-orange/30 transition-all flex items-center gap-1 cursor-pointer"
          >
            <span>{copiedType === 'iptables' ? '✓' : '📋'}</span>
            <span>{copiedType === 'iptables' ? t('common.copied', 'Copied!') : 'iptables'}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowScriptDrawer(!showScriptDrawer)}
            className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-[var(--input-bg)] border border-[var(--glass-border)] text-text-secondary hover:text-[var(--text-primary)] transition-all flex items-center gap-1 cursor-pointer"
          >
            <span>{showScriptDrawer ? '▲' : '▼'}</span>
            <span className="hidden sm:inline">{t('settings.network.firewall.viewRules', 'Rules')}</span>
          </button>
        </div>
      </div>

      {/* Script Drawer */}
      {showScriptDrawer && (
        <div className="p-3 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl space-y-2">
          <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('ufw')}
                className={`text-[10px] font-bold uppercase px-2.5 py-1 rounded transition-all cursor-pointer ${
                  activeTab === 'ufw'
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                    : 'text-text-secondary hover:text-[var(--text-primary)]'
                }`}
              >
                UFW ({rules.ufw.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('iptables')}
                className={`text-[10px] font-bold uppercase px-2.5 py-1 rounded transition-all cursor-pointer ${
                  activeTab === 'iptables'
                    ? 'bg-brand-orange/20 text-brand-orange border border-brand-orange/40'
                    : 'text-text-secondary hover:text-[var(--text-primary)]'
                }`}
              >
                iptables ({rules.iptables.length})
              </button>
            </div>

            <button
              type="button"
              onClick={() => handleCopy(activeTab)}
              className="text-[10px] font-mono font-bold text-text-secondary hover:text-brand-lime transition-colors cursor-pointer"
            >
              {copiedType === activeTab
                ? `✓ ${t('common.copied', 'Copied!')}`
                : `📋 ${t('settings.network.firewall.copySnippet', 'Copy snippet')}`}
            </button>
          </div>

          <pre className="text-[10px] font-mono text-[var(--text-primary)] p-2.5 bg-black/40 rounded-lg overflow-x-auto max-h-48 border border-[var(--glass-border)] selection:bg-brand-lime/30">
            {activeTab === 'ufw'
              ? rules.ufw.join('\n') || '# No external UFW rules required (all services bound to localhost)'
              : rules.iptables.join('\n') || '# No external iptables rules required'}
          </pre>
        </div>
      )}

      {/* Accordion Grouped Services List */}
      <div className="space-y-2">
        {serviceGroups.map((group) => {
          const isExpanded = Boolean(expandedGroups[group.id]);
          const icon = getServiceIcon(group.type, group.category);

          return (
            <div
              key={group.id}
              className="border border-[var(--glass-border)] rounded-xl overflow-hidden bg-[var(--input-bg)]/40 transition-all"
            >
              {/* Collapsed/Header Row */}
              <div
                onClick={() => toggleGroup(group.id)}
                className="p-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-white/3 select-none transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-base shrink-0">{icon}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-xs text-[var(--text-primary)]">
                        {group.name}
                      </span>
                      {group.category === 'core' && (
                        <span className="text-[8px] font-black uppercase px-1.5 py-0.2 rounded bg-purple-500/15 border border-purple-500/30 text-purple-300">
                          CORE
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] font-mono text-text-secondary block truncate mt-0.5">
                      {group.portsSummary}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  {group.listeningCount > 0 ? (
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span>
                        {group.listeningCount} / {group.totalCount} {t('settings.network.firewall.activeSockets', 'listening')}
                      </span>
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-gray-500/10 border border-gray-500/20 text-text-secondary flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
                      <span>{t('settings.network.firewall.socketStopped', 'Stopped')}</span>
                    </span>
                  )}

                  <span className="text-xs text-text-secondary hover:text-[var(--text-primary)] transition-colors px-1">
                    {isExpanded ? '▲' : '▼'}
                  </span>
                </div>
              </div>

              {/* Expanded Detail Table */}
              {isExpanded && (
                <div className="border-t border-[var(--glass-border)] bg-black/20 p-2 overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-[var(--glass-border)] text-text-secondary text-[10px] uppercase tracking-wider font-bold">
                        <th className="py-2 px-2.5">{t('settings.network.firewall.colPortProto', 'Port / Proto')}</th>
                        <th className="py-2 px-2.5">{t('common.description', 'Description')}</th>
                        <th className="py-2 px-2.5">{t('settings.network.firewall.colListenAddress', 'Listen Interface')}</th>
                        <th className="py-2 px-2.5">{t('settings.network.firewall.colSocket', 'Live Socket')}</th>
                        <th className="py-2 px-2.5">{t('settings.network.firewall.colFirewall', 'Inbound Policy')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--glass-border)]">
                      {group.entries.map((item, idx) => (
                        <tr key={`${item.port}-${item.proto}-${idx}`} className="hover:bg-white/2 transition-colors">
                          {/* Port / Proto */}
                          <td className="py-2 px-2.5 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-bold text-xs text-[var(--text-primary)]">
                                {item.port}
                              </span>
                              <span
                                className={`text-[9px] font-mono font-black uppercase px-1.5 py-0.2 rounded ${
                                  item.proto === 'tcp'
                                    ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                                    : 'bg-brand-orange/10 text-brand-orange border border-brand-orange/30'
                                }`}
                              >
                                {item.proto.toUpperCase()}
                              </span>
                            </div>
                          </td>

                          {/* Description */}
                          <td className="py-2 px-2.5">
                            <span className="text-[11px] text-[var(--text-primary)]">
                              {item.description}
                            </span>
                          </td>

                          {/* Listen Address */}
                          <td className="py-2 px-2.5 whitespace-nowrap">
                            <span className="font-mono text-[11px] text-text-secondary">
                              {item.bind_address === '0.0.0.0' ? (
                                <span className="text-emerald-400">0.0.0.0 (All)</span>
                              ) : item.bind_address === '127.0.0.1' ? (
                                <span className="text-purple-400">127.0.0.1 (Local)</span>
                              ) : (
                                <span className="text-brand-lime">{item.bind_address}</span>
                              )}
                            </span>
                          </td>

                          {/* Live Socket */}
                          <td className="py-2 px-2.5 whitespace-nowrap">
                            {item.is_socket_open ? (
                              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center gap-1 w-fit">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                <span>{t('settings.network.firewall.socketListening', 'Listening')}</span>
                              </span>
                            ) : item.status === 'running' ? (
                              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center gap-1 w-fit">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                <span>{t('settings.network.firewall.socketStarting', 'Starting')}</span>
                              </span>
                            ) : (
                              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-gray-500/10 border border-gray-500/20 text-text-secondary flex items-center gap-1 w-fit">
                                <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
                                <span>{t('settings.network.firewall.socketStopped', 'Stopped')}</span>
                              </span>
                            )}
                          </td>

                          {/* Inbound Policy */}
                          <td className="py-2 px-2.5 whitespace-nowrap">
                            {item.requires_inbound_firewall ? (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
                                {t('settings.network.firewall.inboundPublic', 'Inbound WAN/LAN')}
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-gray-500/10 border border-gray-500/20 text-text-secondary">
                                {t('settings.network.firewall.internalOnly', 'Internal Loopback')}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
