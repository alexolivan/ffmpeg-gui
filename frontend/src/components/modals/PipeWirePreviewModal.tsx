import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EngineLogo } from '../common/EngineLogo';
import { RefreshIcon } from '../Icons';

interface PipeWirePreviewModalProps {
  selectedProcess: any;
  telemetry: any[];
  actionPending: Record<number, 'starting' | 'stopping' | 'restarting'>;
  logs: any[];
  onClose: () => void;
  onEditProcess: (proc: any) => void;
  onCloneProcess: (proc: any) => void;
  onStartService: (id: number) => void;
  onStopService: (id: number, name?: string) => void;
  onRestartService: (id: number, name: string) => void;
  API: string;
}

interface TelemetryNode {
  id: number;
  name: string;
  nick?: string;
  media_class?: string;
  state?: string;
  description?: string;
  rate?: number;
  channels?: number;
}

interface TelemetryPort {
  id: number;
  node_id: number;
  name: string;
  direction: 'input' | 'output';
  channel?: string;
}

interface TelemetryLink {
  id: number;
  output_node_id: number;
  output_port_id: number;
  input_node_id: number;
  input_port_id: number;
}

interface GraphTelemetryData {
  active: boolean;
  nodes: TelemetryNode[];
  ports: TelemetryPort[];
  links: TelemetryLink[];
  raw_summary: {
    nodes_count: number;
    ports_count: number;
    links_count: number;
  };
  error?: string | null;
}

export const PipeWirePreviewModal: React.FC<PipeWirePreviewModalProps> = ({
  selectedProcess,
  telemetry,
  actionPending,
  onClose,
  onEditProcess,
  onStartService,
  onStopService,
  onRestartService,
  API,
}) => {
  const { t } = useTranslation();
  const currentProcess = telemetry.find((p) => p.id === selectedProcess.id) || selectedProcess;
  const isRunning = currentProcess.status === 'running';
  const isPending = !!actionPending[currentProcess.id];

  const [graphData, setGraphData] = useState<GraphTelemetryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [activeTab, setActiveTab] = useState<'nodes' | 'links' | 'raw'>('nodes');

  const fetchGraphTelemetry = async () => {
    if (!isRunning) return;
    try {
      setLoading(true);
      const res = await fetch(`${API}/api/services/${currentProcess.id}/pipewire/nodes`);
      if (res.ok) {
        const data = await res.json();
        setGraphData(data);
      }
    } catch {
      // ignore network errors on polling
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGraphTelemetry();
    if (!autoRefresh || !isRunning) return;
    const interval = setInterval(fetchGraphTelemetry, 3000);
    return () => clearInterval(interval);
  }, [currentProcess.id, isRunning, autoRefresh]);

  const pwConfig = currentProcess.config?.pipewire_config || currentProcess.config || {};
  const virtualSinks = Array.isArray(pwConfig.virtual_sinks) ? pwConfig.virtual_sinks : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-5xl max-h-[92vh] flex flex-col rounded-2xl bg-[var(--bg-card)] border border-[var(--glass-border)] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-[var(--glass-border)] bg-black/20">
          <div className="flex items-center gap-3 min-w-0">
            <EngineLogo softwareType="pipewire" size={28} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg font-black text-[var(--text-primary)] truncate">{currentProcess.name}</h3>
                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-400 border border-purple-500/30">
                  {t('services.pipewire.service_name', 'PipeWire Audio Hub')}
                </span>
                {isRunning ? (
                  <span className="text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded font-bold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    {t('common.running', 'RUNNING')}
                  </span>
                ) : (
                  <span className="text-[9px] bg-zinc-500/20 text-zinc-400 border border-zinc-500/30 px-2 py-0.5 rounded font-bold">
                    {t('common.offline', 'OFFLINE')}
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5 font-mono">
                Socket: /tmp/ffmpeg-gui/pipewire-{currentProcess.id}/pulse.sock
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isRunning && (
              <button
                onClick={() => onRestartService(currentProcess.id, currentProcess.name)}
                disabled={isPending}
                className="pill-button bg-white/5 hover:bg-white/10 text-xs py-1.5 px-3 border border-white/10 text-emerald-400 flex items-center gap-1.5"
                title={t('services.restartService', 'Restart Service')}
              >
                <RefreshIcon size={13} />
                <span className="hidden sm:inline">{t('common.restart', 'Restart')}</span>
              </button>
            )}
            {isRunning ? (
              <button
                onClick={() => onStopService(currentProcess.id, currentProcess.name)}
                disabled={isPending}
                className="pill-button bg-red-500/15 hover:bg-red-500/25 text-xs py-1.5 px-3 border border-red-500/30 text-red-400 font-bold"
              >
                {t('common.stop', 'Stop')}
              </button>
            ) : (
              <button
                onClick={() => onStartService(currentProcess.id)}
                disabled={isPending}
                className="pill-button bg-brand-lime hover:bg-brand-lime/90 text-xs py-1.5 px-3 text-black font-bold shadow-lg shadow-brand-lime/10"
              >
                {t('common.start', 'Start')}
              </button>
            )}
            <button
              onClick={() => onEditProcess(currentProcess)}
              className="pill-button bg-white/5 hover:bg-white/10 text-xs py-1.5 px-3 border border-white/10 text-[var(--text-primary)]"
            >
              {t('common.edit', 'Edit')}
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm border border-white/10 transition-colors ml-1"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-5 flex-1 overflow-y-auto space-y-4">
          {/* Summary Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-white/2 border border-[var(--glass-border)]">
              <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] block">
                {t('services.pipewire.virtualSinksTitle', 'Configured Sinks')}
              </span>
              <span className="text-xl font-black text-purple-400">{virtualSinks.length}</span>
            </div>
            <div className="p-3 rounded-xl bg-white/2 border border-[var(--glass-border)]">
              <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] block">
                {t('services.pipewire.liveNodes', 'Live Graph Nodes')}
              </span>
              <span className="text-xl font-black text-brand-lime">{graphData?.raw_summary?.nodes_count ?? '-'}</span>
            </div>
            <div className="p-3 rounded-xl bg-white/2 border border-[var(--glass-border)]">
              <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] block">
                {t('services.pipewire.livePorts', 'Active Ports')}
              </span>
              <span className="text-xl font-black text-cyan-400">{graphData?.raw_summary?.ports_count ?? '-'}</span>
            </div>
            <div className="p-3 rounded-xl bg-white/2 border border-[var(--glass-border)]">
              <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] block">
                {t('services.pipewire.liveLinks', 'Graph Links')}
              </span>
              <span className="text-xl font-black text-emerald-400">{graphData?.raw_summary?.links_count ?? '-'}</span>
            </div>
          </div>

          {/* Offline Notice if Stopped */}
          {!isRunning && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-300 text-xs flex items-center justify-between">
              <span>
                {t(
                  'services.pipewire.startToInspect',
                  'Start this PipeWire service to inspect live audio graph nodes, streams, and virtual sinks.'
                )}
              </span>
              <button
                onClick={() => onStartService(currentProcess.id)}
                className="px-3 py-1 rounded-lg bg-brand-lime text-black font-bold text-xs"
              >
                {t('common.start', 'Start')}
              </button>
            </div>
          )}

          {/* Navigation Tabs Bar */}
          <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2 flex-wrap gap-2">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setActiveTab('nodes')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'nodes'
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5'
                }`}
              >
                {t('services.pipewire.nodesTab', 'Audio Nodes')} ({graphData?.nodes?.length || 0})
              </button>
              <button
                onClick={() => setActiveTab('links')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'links'
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5'
                }`}
              >
                {t('services.pipewire.linksTab', 'Links & Routes')} ({graphData?.links?.length || 0})
              </button>
              <button
                onClick={() => setActiveTab('raw')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'raw'
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5'
                }`}
              >
                {t('services.pipewire.rawTab', 'Raw Telemetry')}
              </button>
            </div>

            <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="rounded border-[var(--glass-border)] text-brand-lime"
                />
                <span>{t('common.autoRefresh', 'Auto-refresh (3s)')}</span>
              </label>
              <button
                onClick={fetchGraphTelemetry}
                disabled={loading || !isRunning}
                className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 text-[var(--text-primary)] disabled:opacity-30"
                title={t('common.refresh', 'Refresh')}
              >
                <RefreshIcon size={12} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          {/* Active Tab Contents */}
          {activeTab === 'nodes' && (
            <div className="space-y-2">
              {graphData?.nodes && graphData.nodes.length > 0 ? (
                <div className="overflow-x-auto rounded-xl border border-[var(--glass-border)]">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-black/30 border-b border-[var(--glass-border)] text-[10px] uppercase text-[var(--text-secondary)]">
                      <tr>
                        <th className="p-2.5">ID</th>
                        <th className="p-2.5">Name</th>
                        <th className="p-2.5">Media Class</th>
                        <th className="p-2.5">State</th>
                        <th className="p-2.5">Format</th>
                        <th className="p-2.5">Description</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--glass-border)]">
                      {graphData.nodes.map((node) => (
                        <tr key={node.id} className="hover:bg-white/2 transition-colors">
                          <td className="p-2.5 text-zinc-500">#{node.id}</td>
                          <td className="p-2.5 font-bold text-[var(--text-primary)]">{node.name}</td>
                          <td className="p-2.5">
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/10 text-purple-300 border border-purple-500/20">
                              {node.media_class || 'Node'}
                            </span>
                          </td>
                          <td className="p-2.5">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                node.state === 'running'
                                  ? 'bg-emerald-500/15 text-emerald-400'
                                  : node.state === 'idle'
                                  ? 'bg-blue-500/15 text-blue-400'
                                  : 'bg-zinc-500/15 text-zinc-400'
                              }`}
                            >
                              {node.state || 'suspended'}
                            </span>
                          </td>
                          <td className="p-2.5 text-zinc-400">
                            {node.channels ? `${node.channels}ch` : '-'}
                            {node.rate ? ` · ${node.rate}Hz` : ''}
                          </td>
                          <td className="p-2.5 text-[var(--text-secondary)] truncate max-w-xs">
                            {node.description || node.nick || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-8 text-center text-xs text-[var(--text-secondary)] border border-dashed border-white/10 rounded-xl">
                  {isRunning
                    ? t('services.pipewire.noNodesDetected', 'No active nodes detected in PipeWire graph.')
                    : t('services.pipewire.serviceStopped', 'PipeWire service is currently stopped.')}
                </div>
              )}
            </div>
          )}

          {activeTab === 'links' && (
            <div className="space-y-2">
              {graphData?.links && graphData.links.length > 0 ? (
                <div className="overflow-x-auto rounded-xl border border-[var(--glass-border)]">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-black/30 border-b border-[var(--glass-border)] text-[10px] uppercase text-[var(--text-secondary)]">
                      <tr>
                        <th className="p-2.5">Link ID</th>
                        <th className="p-2.5">Output (Source)</th>
                        <th className="p-2.5 text-center">Direction</th>
                        <th className="p-2.5">Input (Target)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--glass-border)]">
                      {graphData.links.map((link) => (
                        <tr key={link.id} className="hover:bg-white/2 transition-colors">
                          <td className="p-2.5 text-zinc-500">#{link.id}</td>
                          <td className="p-2.5 text-[var(--text-primary)] font-bold">
                            Node #{link.output_node_id} (Port #{link.output_port_id})
                          </td>
                          <td className="p-2.5 text-center text-brand-lime font-bold">→</td>
                          <td className="p-2.5 text-[var(--text-primary)] font-bold">
                            Node #{link.input_node_id} (Port #{link.input_port_id})
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-8 text-center text-xs text-[var(--text-secondary)] border border-dashed border-white/10 rounded-xl">
                  {t('services.pipewire.noLinksDetected', 'No active routing links detected in graph.')}
                </div>
              )}
            </div>
          )}

          {activeTab === 'raw' && (
            <pre className="p-4 rounded-xl bg-black/50 border border-[var(--glass-border)] text-[11px] font-mono text-[var(--text-secondary)] overflow-x-auto max-h-96">
              {JSON.stringify(graphData || { active: isRunning }, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};
