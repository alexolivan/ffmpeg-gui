import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { PlusIcon, TrashIcon } from '../Icons';

export interface VirtualSinkConfig {
  id: string;
  name: string;
  channels: number;
  aes67_enabled: boolean;
  multicast_ip?: string;
  rtp_port?: number;
  sap_name?: string;
}

export interface NetworkAuditInterface {
  name: string;
  ip: string | null;
  is_up: boolean;
  speed: number;
  ptp_hardware_capable: boolean;
}

export interface NetworkAuditData {
  interfaces: NetworkAuditInterface[];
  host_ptp: {
    ptp4l_installed: boolean;
    ptp4l_running: boolean;
  };
}

interface PipeWireConfigFormProps {
  initialConfig?: any;
  onSubmit: (data: any) => void;
  onCancel: () => void;
  isEditing?: boolean;
  API?: string;
}

export const PipeWireConfigForm: React.FC<PipeWireConfigFormProps> = ({
  initialConfig,
  onSubmit,
  onCancel,
  isEditing = false,
  API = '',
}) => {
  const { t } = useTranslation();

  const pwCfg = initialConfig?.config?.pipewire_config || initialConfig?.pipewire_config || initialConfig?.config || {};

  // 1. Identity & Engine
  const [name, setName] = useState<string>(initialConfig?.name || 'PipeWire Master Hub');
  const [alias, setAlias] = useState<string>(initialConfig?.alias || '');
  const [buildId, setBuildId] = useState<number | null>(
    initialConfig?.ffmpeg_build_id ?? initialConfig?.config?.software_build_id ?? initialConfig?.config?.ffmpeg_build_id ?? null
  );
  const [availableBuilds, setAvailableBuilds] = useState<any[]>([]);

  // Sample Rate & Quantum
  const [sampleRate, setSampleRate] = useState<number>(Number(pwCfg.sample_rate) || 48000);
  const [quantum, setQuantum] = useState<number>(Number(pwCfg.quantum) || 1024);

  // Storage & Logging
  const [storages, setStorages] = useState<any[]>([]);
  const [logStorageId, setLogStorageId] = useState<number | null>(
    initialConfig?.log_storage_id ?? initialConfig?.config?.log_storage_id ?? null
  );

  // Lifecycle & Watchdog
  const [autoStart, setAutoStart] = useState<boolean>(
    initialConfig?.auto_start ?? initialConfig?.config?.auto_start ?? false
  );
  const [startupOrder, setStartupOrder] = useState<number>(
    initialConfig?.startup_order ?? initialConfig?.config?.startup_order ?? 1
  );
  const [startupDelay, setStartupDelay] = useState<number>(
    initialConfig?.startup_delay ?? initialConfig?.config?.startup_delay ?? 0
  );
  const [watchdogEnabled, setWatchdogEnabled] = useState<boolean>(
    initialConfig?.watchdog_enabled ?? initialConfig?.config?.watchdog_enabled !== false
  );
  const [watchdogRetries, setWatchdogRetries] = useState<number>(
    initialConfig?.watchdog_retries ?? initialConfig?.config?.watchdog_retries ?? 5
  );

  // Fetch available PipeWire builds from Forge and Storage volumes
  useEffect(() => {
    fetch(`${API}/builds`)
      .then((r) => (r.ok ? r.json() : []))
      .then((builds) => {
        const pwBuilds = builds.filter(
          (b: any) => b.software_type === 'pipewire' && b.status === 'ready'
        );
        setAvailableBuilds(pwBuilds);
        if (!buildId && pwBuilds.length > 0) {
          const def = pwBuilds.find((b: any) => b.is_default);
          if (def) setBuildId(def.id);
        }
      })
      .catch(() => {});

    fetch(`${API}/settings/storages`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data)) {
          setStorages(data);
          const logsList = data.filter((s: any) => s.type === 'logs');
          if (!logStorageId && logsList.length > 0) {
            const defLog = logsList.find((s: any) => s.is_default);
            setLogStorageId(defLog ? defLog.id : logsList[0].id);
          }
        }
      })
      .catch(() => {});
  }, [API]);

  // 2. Virtual Sinks Manager
  const defaultInitialSinks: VirtualSinkConfig[] = [
    {
      id: 'mix_bus',
      name: 'Master Mix Bus',
      channels: 2,
      aes67_enabled: false,
      multicast_ip: '239.69.1.10',
      rtp_port: 5004,
      sap_name: 'PipeWire Master Mix',
    },
  ];

  const [virtualSinks, setVirtualSinks] = useState<VirtualSinkConfig[]>(() => {
    if (Array.isArray(pwCfg.virtual_sinks) && pwCfg.virtual_sinks.length > 0) {
      return pwCfg.virtual_sinks.map((s: any) => ({
        id: String(s.id || 'sink'),
        name: String(s.name || s.id || 'Virtual Sink'),
        channels: Number(s.channels) || 2,
        aes67_enabled: Boolean(s.aes67_enabled),
        multicast_ip: s.multicast_ip || '239.69.1.10',
        rtp_port: Number(s.rtp_port) || 5004,
        sap_name: s.sap_name || `PipeWire ${s.id || 'sink'}`,
      }));
    }
    return defaultInitialSinks;
  });

  // 3. AES67 / Dante Broadcast (Tx) Network Module
  const aesNetCfg = pwCfg.aes67_network || {};
  const [aes67Enabled, setAes67Enabled] = useState<boolean>(Boolean(aesNetCfg.enabled));
  const [selectedInterface, setSelectedInterface] = useState<string>(aesNetCfg.interface || '');
  const [networkAudit, setNetworkAudit] = useState<NetworkAuditData | null>(null);
  const [isLoadingAudit, setIsLoadingAudit] = useState<boolean>(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  // Fetch Network Audit when AES67 is enabled or on mount if already enabled
  useEffect(() => {
    if (!aes67Enabled) return;

    let isMounted = true;
    setIsLoadingAudit(true);
    setAuditError(null);

    fetch(`${API}/api/pipewire/network-audit`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: NetworkAuditData) => {
        if (!isMounted) return;
        setNetworkAudit(data);

        // Auto-select first active physical NIC if none selected
        if (!selectedInterface && Array.isArray(data.interfaces) && data.interfaces.length > 0) {
          const firstUp = data.interfaces.find((iface) => iface.is_up && iface.ip) || data.interfaces[0];
          if (firstUp) {
            setSelectedInterface(firstUp.name);
          }
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setAuditError(err.message || 'Error loading network audit');
      })
      .finally(() => {
        if (isMounted) setIsLoadingAudit(false);
      });

    return () => {
      isMounted = false;
    };
  }, [aes67Enabled, API]);

  // Virtual Sink actions
  const handleAddSink = () => {
    const nextIndex = virtualSinks.length + 1;
    const newId = `bus_${nextIndex}`;
    const newSink: VirtualSinkConfig = {
      id: newId,
      name: `Aux Mix Bus ${nextIndex}`,
      channels: 2,
      aes67_enabled: false,
      multicast_ip: `239.69.1.${10 + nextIndex}`,
      rtp_port: 5004 + (nextIndex * 2),
      sap_name: `PipeWire ${newId}`,
    };
    setVirtualSinks([...virtualSinks, newSink]);
  };

  const handleRemoveSink = (index: number) => {
    if (virtualSinks.length <= 1) return;
    setVirtualSinks(virtualSinks.filter((_, i) => i !== index));
  };

  const handleSinkChange = (index: number, field: keyof VirtualSinkConfig, value: any) => {
    setVirtualSinks((prev) => {
      const updated = [...prev];
      const target = { ...updated[index], [field]: value };

      // Auto-update default SAP name if ID changed and user didn't customize it
      if (field === 'id' && (!target.sap_name || target.sap_name.startsWith('PipeWire '))) {
        target.sap_name = `PipeWire ${value}`;
      }

      updated[index] = target;
      return updated;
    });
  };

  // Form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Find selected interface IP for aes67_network payload
    const activeIface = networkAudit?.interfaces?.find((i) => i.name === selectedInterface);
    const selectedIp = activeIface?.ip || aesNetCfg.ip || '0.0.0.0';

    const cleanSinks = virtualSinks.map((s) => ({
      id: s.id.trim(),
      name: s.name.trim(),
      channels: Number(s.channels) || 2,
      aes67_enabled: aes67Enabled && Boolean(s.aes67_enabled),
      multicast_ip: s.multicast_ip?.trim() || '239.69.1.10',
      rtp_port: Number(s.rtp_port) || 5004,
      sap_name: s.sap_name?.trim() || `PipeWire ${s.id.trim()}`,
    }));

    const configPayload = {
      sample_rate: Number(sampleRate),
      quantum: Number(quantum),
      min_quantum: 128,
      max_quantum: 2048,
      virtual_sinks: cleanSinks,
      aes67_network: {
        enabled: aes67Enabled,
        interface: aes67Enabled ? selectedInterface : null,
        ip: aes67Enabled ? selectedIp : '0.0.0.0',
      },
    };

    onSubmit({
      name: name.trim() || 'PipeWire Master Hub',
      alias: alias.trim() || undefined,
      type: 'service',
      service_type: 'pipewire_hub',
      ffmpeg_build_id: buildId,
      auto_start: autoStart,
      startup_order: Number(startupOrder) || 1,
      startup_delay: Number(startupDelay) || 0,
      watchdog_enabled: watchdogEnabled,
      watchdog_retries: Number(watchdogRetries) || 5,
      log_storage_id: logStorageId ? Number(logStorageId) : null,
      is_shared_with_peers: false,
      allow_peer_lease: false,
      config: {
        auto_start: autoStart,
        startup_order: Number(startupOrder) || 1,
        startup_delay: Number(startupDelay) || 0,
        watchdog_enabled: watchdogEnabled,
        watchdog_retries: Number(watchdogRetries) || 5,
        log_storage_id: logStorageId ? Number(logStorageId) : null,
        software_build_id: buildId,
        ffmpeg_build_id: buildId,
        pipewire_config: configPayload,
      },
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full overflow-hidden text-[var(--text-primary)]">
      {/* Scrollable Form Body */}
      <div className="flex-1 overflow-y-auto space-y-5 p-1 pr-2 custom-scrollbar">
        {/* ── Section 1: General / Service Info ── */}
        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-4 shadow-sm space-y-4">
          <div className="border-b border-[var(--glass-border)] pb-2 flex items-center justify-between">
            <h4 className="text-xs font-black uppercase tracking-wider text-brand-lime flex items-center gap-2">
              <span>🔊</span>
              {t('services.pipewire.generalSection', '1. General / Service Info')}
            </h4>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoStart}
                onChange={(e) => setAutoStart(e.target.checked)}
                className="accent-brand-lime w-4 h-4 cursor-pointer"
              />
              <span className="text-xs font-semibold text-[var(--text-primary)]">
                {t('services.pipewire.autoStart', 'Auto-Start Service')}
              </span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-[11px] font-bold uppercase text-[var(--text-secondary)] mb-1">
                {t('services.pipewire.name', 'Service Name')} <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-xs font-medium text-[var(--text-primary)] focus:outline-none focus:border-brand-lime transition-colors"
                placeholder="PipeWire Master Hub"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase text-[var(--text-secondary)] mb-1">
                {t('services.pipewire.alias', 'Alias / Call-sign')}
              </label>
              <input
                type="text"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-xs font-medium text-[var(--text-primary)] focus:outline-none focus:border-brand-lime transition-colors"
                placeholder="p. ej. Hub-Principal"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase text-[var(--text-secondary)] mb-1">
              {t('services.pipewire.engineBuild', 'PipeWire Software Engine')}
            </label>
            <select
              value={buildId || ''}
              onChange={(e) => setBuildId(e.target.value ? Number(e.target.value) : null)}
              className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-xs font-medium text-[var(--text-primary)] focus:outline-none focus:border-brand-lime transition-colors cursor-pointer"
            >
              <option value="">{t('services.pipewire.systemDefault', 'Host System Binary ($PATH / pipewire)')}</option>
              {availableBuilds.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} (v{b.version_tag || 'custom'}) {b.is_default ? `[${t('common.default', 'Default')}]` : ''}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-[var(--text-secondary)] mt-1">
              {t('services.pipewire.engineHint', 'If you do not select a compiled build from Forge, the panel will use the system PipeWire binary.')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1 border-t border-[var(--glass-border)]">
            <div>
              <label className="block text-[11px] font-bold uppercase text-[var(--text-secondary)] mb-1">
                {t('services.pipewire.sampleRate', 'Sample Rate (Hz)')}
              </label>
              <select
                value={sampleRate}
                onChange={(e) => setSampleRate(Number(e.target.value))}
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-brand-lime transition-colors cursor-pointer"
              >
                <option value={44100}>44100 Hz</option>
                <option value={48000}>48000 Hz ({t('common.default', 'Default')})</option>
                <option value={96000}>96000 Hz (Pro Hi-Res)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase text-[var(--text-secondary)] mb-1">
                {t('services.pipewire.quantum', 'Buffer Quantum (Frames / Latency)')}
              </label>
              <select
                value={quantum}
                onChange={(e) => setQuantum(Number(e.target.value))}
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-brand-lime transition-colors cursor-pointer"
              >
                <option value={128}>128 ({t('services.pipewire.quantumUltraLow', 'Ultra-low / 2.6ms')})</option>
                <option value={256}>256 ({t('services.pipewire.quantumLow', 'Low / 5.3ms')})</option>
                <option value={512}>512 ({t('services.pipewire.quantumMedium', 'Balanced / 10.6ms')})</option>
                <option value={1024}>1024 ({t('services.pipewire.quantumDefault', 'Standard / 21.3ms - Default')})</option>
                <option value={2048}>2048 ({t('services.pipewire.quantumSafe', 'High Buffer / 42.6ms')})</option>
              </select>
            </div>
          </div>
        </div>

        {/* ── Section 2: Virtual Sinks Manager ── */}
        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-4 shadow-sm space-y-4">
          <div className="border-b border-[var(--glass-border)] pb-2 flex items-center justify-between">
            <div>
              <h4 className="text-xs font-black uppercase tracking-wider text-brand-lime flex items-center gap-2">
                <span>🎚️</span>
                {t('services.pipewire.virtualSinksSection', '2. Virtual Sinks Manager')}
              </h4>
              <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                {t('services.pipewire.virtualSinksHelp', 'Virtual audio endpoints available for routing, application capture, and broadcast distribution.')}
              </p>
            </div>

            <button
              type="button"
              onClick={handleAddSink}
              className="px-2.5 py-1.5 rounded-lg bg-brand-lime/10 text-brand-lime hover:bg-brand-lime/20 border border-brand-lime/30 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <PlusIcon size={13} />
              {t('services.pipewire.addSink', 'Add Virtual Sink')}
            </button>
          </div>

          <div className="space-y-3">
            {virtualSinks.map((sink, idx) => (
              <div
                key={idx}
                className="bg-[var(--input-bg)]/60 border border-[var(--glass-border)] rounded-xl p-3.5 space-y-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-brand-lime/10 text-brand-lime text-[10px] font-mono font-bold flex items-center justify-center border border-brand-lime/30">
                      #{idx + 1}
                    </span>
                    <span className="text-xs font-bold text-[var(--text-primary)]">
                      {sink.name || sink.id || `Sink ${idx + 1}`}
                    </span>
                  </div>

                  {virtualSinks.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveSink(idx)}
                      className="text-[var(--text-secondary)] hover:text-red-400 p-1 rounded-md transition-colors cursor-pointer"
                      title={t('services.pipewire.removeSink', 'Remove sink')}
                    >
                      <TrashIcon size={14} />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  <div className="sm:col-span-4">
                    <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">
                      {t('services.pipewire.sinkId', 'Node Identifier (ID)')} <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      pattern="^[a-zA-Z0-9_\-]+$"
                      title={t('services.pipewire.sinkIdPatternError', 'Only letters, numbers, underscores and dashes allowed')}
                      value={sink.id}
                      onChange={(e) => handleSinkChange(idx, 'id', e.target.value.replace(/[^a-zA-Z0-9_\-]/g, ''))}
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-brand-lime transition-colors"
                      placeholder="mix_bus"
                    />
                  </div>

                  <div className="sm:col-span-5">
                    <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">
                      {t('services.pipewire.sinkDescription', 'Human Readable Description')} <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={sink.name}
                      onChange={(e) => handleSinkChange(idx, 'name', e.target.value)}
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-brand-lime transition-colors"
                      placeholder="Master Mix Bus"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">
                      {t('services.pipewire.sinkChannels', 'Audio Channels')}
                    </label>
                    <select
                      value={sink.channels}
                      onChange={(e) => handleSinkChange(idx, 'channels', Number(e.target.value))}
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-brand-lime transition-colors cursor-pointer"
                    >
                      <option value={1}>1 (Mono)</option>
                      <option value={2}>2 (Stereo FL/FR)</option>
                      <option value={4}>4 (Quad FL/FR/RL/RR)</option>
                      <option value={6}>6 (5.1 Surround)</option>
                      <option value={8}>8 (7.1 Surround / Octo)</option>
                    </select>
                  </div>
                </div>

                {/* Per-sink AES67 Transmitter Parameters if Global AES67 enabled */}
                {aes67Enabled && (
                  <div className="mt-2 pt-2 border-t border-[var(--glass-border)] bg-[var(--bg-card)]/40 p-2.5 rounded-lg space-y-2.5">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={sink.aes67_enabled}
                        onChange={(e) => handleSinkChange(idx, 'aes67_enabled', e.target.checked)}
                        className="accent-brand-lime w-3.5 h-3.5 cursor-pointer"
                      />
                      <span className="text-xs font-bold text-brand-lime flex items-center gap-1.5">
                        <span>📻</span>
                        {t('services.pipewire.sinkAes67Enable', 'Broadcast via AES67 / Dante (RTP Multicast)')}
                      </span>
                    </label>

                    {sink.aes67_enabled && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                        <div>
                          <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">
                            {t('services.pipewire.multicastIp', 'Multicast IP')}
                          </label>
                          <input
                            type="text"
                            required
                            value={sink.multicast_ip || '239.69.1.10'}
                            onChange={(e) => handleSinkChange(idx, 'multicast_ip', e.target.value)}
                            className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2 py-1 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-brand-lime"
                            placeholder="239.69.1.10"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">
                            {t('services.pipewire.rtpPort', 'RTP Port')}
                          </label>
                          <input
                            type="number"
                            required
                            min={1024}
                            max={65535}
                            value={sink.rtp_port || 5004}
                            onChange={(e) => handleSinkChange(idx, 'rtp_port', Number(e.target.value))}
                            className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2 py-1 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-brand-lime"
                            placeholder="5004"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">
                            {t('services.pipewire.sapName', 'SAP Broadcast Name')}
                          </label>
                          <input
                            type="text"
                            required
                            value={sink.sap_name || `PipeWire ${sink.id}`}
                            onChange={(e) => handleSinkChange(idx, 'sap_name', e.target.value)}
                            className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] focus:outline-none focus:border-brand-lime"
                            placeholder={`PipeWire ${sink.id}`}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Section 3: AES67 / Dante Broadcast (Tx) Network Module ── */}
        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-4 shadow-sm space-y-4">
          <div className="border-b border-[var(--glass-border)] pb-2 flex items-center justify-between">
            <div>
              <h4 className="text-xs font-black uppercase tracking-wider text-brand-lime flex items-center gap-2">
                <span>🌐</span>
                {t('services.pipewire.aes67Section', '3. AES67 / Dante Broadcast (Tx) Network Module')}
              </h4>
              <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                {t('services.pipewire.aes67Help', 'Stream low-latency uncompressed audio across the LAN to Dante and AES67 receivers with SAP announce.')}
              </p>
            </div>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={aes67Enabled}
                onChange={(e) => setAes67Enabled(e.target.checked)}
                className="accent-brand-lime w-4 h-4 cursor-pointer"
              />
              <span className="text-xs font-bold text-[var(--text-primary)]">
                {t('services.pipewire.enableAes67', 'Enable AES67 Network Tx')}
              </span>
            </label>
          </div>

          {aes67Enabled && (
            <div className="space-y-4 pt-1">
              {/* NIC Selector */}
              <div>
                <label className="block text-[11px] font-bold uppercase text-[var(--text-secondary)] mb-1">
                  {t('services.pipewire.networkInterface', 'Dedicated Audio Network Interface (NIC)')}
                </label>
                {isLoadingAudit ? (
                  <div className="text-xs text-[var(--text-secondary)] py-2">
                    {t('common.loading', 'Loading network audit...')}
                  </div>
                ) : auditError ? (
                  <div className="text-xs text-red-400 py-1">{auditError}</div>
                ) : (
                  <select
                    value={selectedInterface}
                    onChange={(e) => setSelectedInterface(e.target.value)}
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-brand-lime transition-colors cursor-pointer"
                  >
                    {networkAudit?.interfaces && networkAudit.interfaces.length > 0 ? (
                      networkAudit.interfaces.map((iface) => (
                        <option key={iface.name} value={iface.name}>
                          {iface.name} ({iface.ip || 'No IPv4'}) {iface.ptp_hardware_capable ? '· [PTP Hardware]' : ''}
                        </option>
                      ))
                    ) : (
                      <option value="">{t('services.pipewire.noInterfaces', 'No physical interfaces detected')}</option>
                    )}
                  </select>
                )}
                <span className="text-[10px] text-[var(--text-secondary)] mt-1 block">
                  {t('services.pipewire.nicHelp', 'Select the physical LAN port connected to the Dante/AES67 audio subnet.')}
                </span>
              </div>

              {/* Informative Clock Status Banner */}
              {networkAudit && (
                <div>
                  {networkAudit.host_ptp?.ptp4l_running ? (
                    <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2.5">
                      <span className="text-base shrink-0">🟢</span>
                      <div>
                        <p className="font-bold">
                          {t('services.pipewire.ptpSynchronized', 'PTPv2 Synchronized (IEEE 1588-2008 active)')}
                        </p>
                        <p className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80 mt-0.5">
                          {t('services.pipewire.ptpSynchronizedDesc', 'Host ptp4l daemon active providing PTP master/slave clock for precise RTP packet alignment.')}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-300 text-xs flex items-center gap-2.5">
                      <span className="text-base shrink-0">ℹ️</span>
                      <div>
                        <p className="font-bold">
                          {t('services.pipewire.ptpSoftwareClock', 'Software Clock Mode (Active). Compatible with Dante Controller and SAP. For sub-microsecond synchronization in broadcast production, optionally install linuxptp on the host.')}
                        </p>
                        <p className="text-[10px] text-amber-600/80 dark:text-amber-300/80 mt-0.5">
                          {t('services.pipewire.ptpSoftwareClockDesc', 'AES67 streams will timestamp RTP packets using monotonic system clock. Sufficient for most listening and virtual mixers.')}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Section 4: Dedicated Log Storage Volume ── */}
        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-4 shadow-sm space-y-3">
          <div className="border-b border-[var(--glass-border)] pb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-orange-400" />
            <h4 className="text-xs font-black uppercase tracking-wider text-orange-400">
              4. {t('services.pipewire.logStorageTitle', 'Log Storage Volume')}
            </h4>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase text-[var(--text-secondary)] mb-1">
              {t('services.pipewire.logStorage', 'Log Storage Drive')}
            </label>
            <select
              value={logStorageId || ''}
              onChange={(e) => setLogStorageId(e.target.value ? Number(e.target.value) : null)}
              className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-brand-lime transition-colors cursor-pointer"
            >
              <option value="">{t('common.default', 'Default (Host / data/logs)')}</option>
              {storages.filter((s: any) => s.type === 'logs').map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.path}) {s.is_default ? `[${t('common.default', 'Default')}]` : ''}
                </option>
              ))}
            </select>
            <span className="text-[10px] text-[var(--text-secondary)] mt-1 block">
              {t('services.pipewire.logStorageDesc', 'Stores PipeWire process logs and stdout/stderr with automated log rotation.')}
            </span>
          </div>
        </div>

        {/* ── Section 5: Lifecycle, Boot Order & Watchdog ── */}
        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-4 shadow-sm space-y-3">
          <div className="border-b border-[var(--glass-border)] pb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <h4 className="text-xs font-black uppercase tracking-wider text-emerald-400">
              5. {t('services.pipewire.lifecycleTitle', 'Lifecycle, Boot Order & Watchdog')}
            </h4>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-6 flex-wrap">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoStart}
                  onChange={(e) => setAutoStart(e.target.checked)}
                  className="accent-brand-lime w-4 h-4 cursor-pointer"
                />
                <span className="font-bold uppercase tracking-wide text-xs">
                  {t('services.autoStart', 'Auto-start on Boot')}
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={watchdogEnabled}
                  onChange={(e) => setWatchdogEnabled(e.target.checked)}
                  className="accent-brand-lime w-4 h-4 cursor-pointer"
                />
                <span className="font-bold uppercase tracking-wide text-xs">
                  {t('services.watchdog', 'Watchdog Restart')}
                </span>
              </label>
            </div>

            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-1.5">
                <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] shrink-0">
                  {t('services.startupOrder', 'Order')}:
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={startupOrder}
                  onChange={(e) => setStartupOrder(Number(e.target.value))}
                  className="w-14 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded px-2 py-1 text-xs text-center font-mono focus:border-brand-lime outline-none"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] shrink-0">
                  {t('services.startupDelay', 'Delay (s)')}:
                </label>
                <input
                  type="number"
                  min={0}
                  max={300}
                  value={startupDelay}
                  onChange={(e) => setStartupDelay(Number(e.target.value))}
                  className="w-14 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded px-2 py-1 text-xs text-center font-mono focus:border-brand-lime outline-none"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] shrink-0">
                  {t('common.retries', 'Reintentos')}:
                </label>
                <input
                  type="number"
                  min={-1}
                  max={50}
                  value={watchdogRetries}
                  onChange={(e) => setWatchdogRetries(Number(e.target.value))}
                  className="w-14 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded px-2 py-1 text-xs text-center font-mono focus:border-brand-lime outline-none"
                  title="-1 para reintentos infinitos"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Action Buttons */}
      <div className="pt-4 border-t border-[var(--glass-border)] flex items-center justify-end gap-3 shrink-0">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-xl text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-white/5 hover:bg-white/10 transition-all cursor-pointer"
        >
          {t('common.cancel', 'Cancel')}
        </button>
        <button
          type="submit"
          className="px-5 py-2 rounded-xl text-xs font-black uppercase tracking-wider bg-brand-lime text-black hover:opacity-90 transition-all shadow-md cursor-pointer disabled:opacity-50"
        >
          {isEditing
            ? t('common.save', 'Save Changes')
            : t('services.createService', 'Create Service')}
        </button>
      </div>
    </form>
  );
};
