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

export interface RemoteSinkConfig {
  id: string;
  name: string;
  multicast_ip: string;
  rtp_port: number;
  channels: number;
  format: 'S24BE' | 'S16BE';
  rate?: number;
  sap_name?: string;
  origin_ip?: string;
}

export interface NetworkAuditInterface {
  name: string;
  ip: string | null;
  is_up: boolean;
  speed: number;
  ptp_support?: 'hardware' | 'software' | 'none';
  ptp_device?: string | null;
  ptp_hardware_capable: boolean;
  ptp_software_capable?: boolean;
  canonical_base_multicast_prefix?: string;
  active_ptp_master?: {
    detected: boolean;
    source_ip?: string | null;
    is_local: boolean;
  };
}

export interface NetworkAuditData {
  interfaces: NetworkAuditInterface[];
  hostname?: string;
  active_streams?: {
    service_id: number;
    service_name: string;
    sink_id: string;
    sink_name: string;
    multicast_ip: string;
    rtp_port: number;
    sap_name?: string;
  }[];
  host_ptp: {
    ptp4l_installed: boolean;
    ptp4l_bin?: string | null;
    ptp4l_running: boolean;
    active_master_detected?: boolean;
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

  const [remoteSinks, setRemoteSinks] = useState<RemoteSinkConfig[]>(() => {
    const list = pwCfg.remote_sinks || initialConfig?.config?.remote_sinks || initialConfig?.remote_sinks;
    if (Array.isArray(list) && list.length > 0) {
      return list.map((s: any) => ({
        id: String(s.id || 'remote_sink'),
        name: String(s.name || s.id || 'Remote AoIP Sink'),
        multicast_ip: s.multicast_ip || '239.69.11.1',
        rtp_port: Number(s.rtp_port) || 5004,
        channels: Number(s.channels) || 2,
        format: s.format === 'S16BE' ? 'S16BE' : 'S24BE',
        rate: Number(s.rate) || 48000,
        sap_name: s.sap_name || '',
        origin_ip: s.origin_ip || '',
      }));
    }
    return [];
  });

  const [discoveredStreams, setDiscoveredStreams] = useState<any[]>([]);
  const [isLoadingDiscovery, setIsLoadingDiscovery] = useState<boolean>(false);

  // 3. AES67 / Dante Broadcast (Tx) Network Module
  const aesNetCfg = pwCfg.aes67_network || {};
  const [aes67Enabled, setAes67Enabled] = useState<boolean>(Boolean(aesNetCfg.enabled));
  const [selectedInterface, setSelectedInterface] = useState<string>(aesNetCfg.interface || '');
  const [baseMulticastPrefix, setBaseMulticastPrefix] = useState<string>(
    aesNetCfg.base_multicast_prefix || '239.69.1'
  );
  const [hostName, setHostName] = useState<string>('host');
  const [networkAudit, setNetworkAudit] = useState<NetworkAuditData | null>(null);
  const [isLoadingAudit, setIsLoadingAudit] = useState<boolean>(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [reservedNics, setReservedNics] = useState<Record<string, { serviceId: number; serviceName: string }>>({});
  const [sinkValidationFeedback, setSinkValidationFeedback] = useState<Record<number, any>>({});
  const [recalcFeedback, setRecalcFeedback] = useState<string | null>(null);

  // PTP Master Clock State
  const initialPtp = aesNetCfg.ptp || {};
  const [ptpEnabled, setPtpEnabled] = useState<boolean>(Boolean(initialPtp.enabled));
  const [ptpAutoInhibit, setPtpAutoInhibit] = useState<boolean>(
    initialPtp.auto_inhibit !== undefined ? Boolean(initialPtp.auto_inhibit) : true
  );
  const [ptpPriority1, setPtpPriority1] = useState<number>(
    initialPtp.priority1 !== undefined ? Number(initialPtp.priority1) : 128
  );
  const [ptpDomain, setPtpDomain] = useState<number>(
    initialPtp.domain !== undefined ? Number(initialPtp.domain) : 0
  );
  const [ptpProfile, setPtpProfile] = useState<string>(
    initialPtp.profile || 'aes67'
  );

  const cleanSapSuffix = (rawSap: string | undefined, host: string, fallbackId: string): string => {
    if (!rawSap) return fallbackId;
    const trimmed = rawSap.trim();
    if (trimmed.startsWith(`${host} `)) {
      return trimmed.slice(host.length + 1);
    }
    return trimmed;
  };

  // Recalculate canonical base multicast prefix from active NIC and re-seed all virtual sinks
  const handleRecalculateRoutes = () => {
    const activeIface =
      networkAudit?.interfaces?.find((i) => i.name === selectedInterface) ||
      networkAudit?.interfaces?.find((i) => i.is_up && i.ip && !reservedNics[i.name]) ||
      networkAudit?.interfaces?.[0];

    if (!activeIface) return;

    if (activeIface.name !== selectedInterface) {
      setSelectedInterface(activeIface.name);
    }

    let calculatedPrefix = activeIface.canonical_base_multicast_prefix;
    if (!calculatedPrefix && activeIface.ip) {
      const parts = activeIface.ip.split('.');
      if (parts.length === 4) calculatedPrefix = `239.69.${parts[3]}`;
    }
    const cleanPrefix = (calculatedPrefix || baseMulticastPrefix || '239.69.1').trim().replace(/\.$/, '');

    setBaseMulticastPrefix(cleanPrefix);

    setVirtualSinks((prev) =>
      prev.map((sink, idx) => {
        const nextIp = `${cleanPrefix}.${idx + 1}`;
        const nextPort = 5004 + idx * 2;
        const currentSuffix = cleanSapSuffix(sink.sap_name, hostName, sink.id);
        return {
          ...sink,
          multicast_ip: nextIp,
          rtp_port: nextPort,
          sap_name: `${hostName} ${currentSuffix}`.trim(),
        };
      })
    );

    setSinkValidationFeedback({});
    setRecalcFeedback(cleanPrefix);
    setTimeout(() => {
      setRecalcFeedback(null);
    }, 3000);
  };

  // Query existing services to detect NICs already claimed by another PipeWire Hub for AES67
  useEffect(() => {
    fetch(`${API}/processes`)
      .then((r) => (r.ok ? r.json() : []))
      .then((procs) => {
        if (!Array.isArray(procs)) return;
        const currentServiceId = initialConfig?.id;
        const reserved: Record<string, { serviceId: number; serviceName: string }> = {};
        for (const p of procs) {
          if (p.service_type === 'pipewire_hub' && p.id !== currentServiceId) {
            const cfg = p.config?.pipewire_config || p.config || {};
            const aesNet = cfg.aes67_network;
            if (aesNet?.enabled && aesNet?.interface) {
              reserved[aesNet.interface] = {
                serviceId: p.id,
                serviceName: p.alias || p.name || `PipeWire Hub #${p.id}`,
              };
            }
          }
        }
        setReservedNics(reserved);
      })
      .catch(() => {});
  }, [API, initialConfig?.id]);

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
        if (data.hostname) {
          setHostName(data.hostname);
        }

        // Auto-select first active physical NIC if none selected or if selectedInterface does not exist locally
        const ifaceExists = data.interfaces?.some((iface) => iface.name === selectedInterface);
        if ((!selectedInterface || !ifaceExists) && Array.isArray(data.interfaces) && data.interfaces.length > 0) {
          const firstAvailable =
            data.interfaces.find((iface) => iface.is_up && iface.ip && !reservedNics[iface.name]) ||
            data.interfaces.find((iface) => !reservedNics[iface.name]) ||
            data.interfaces[0];
          if (firstAvailable) {
            setSelectedInterface(firstAvailable.name);
            if ((!ifaceExists || !aesNetCfg.base_multicast_prefix) && firstAvailable.canonical_base_multicast_prefix) {
              setBaseMulticastPrefix(firstAvailable.canonical_base_multicast_prefix);
            }
          }
        } else if (selectedInterface && !aesNetCfg.base_multicast_prefix) {
          const currentIface = data.interfaces?.find((i) => i.name === selectedInterface);
          if (currentIface?.canonical_base_multicast_prefix) {
            setBaseMulticastPrefix(currentIface.canonical_base_multicast_prefix);
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
  }, [aes67Enabled, API, reservedNics, selectedInterface, aesNetCfg.base_multicast_prefix]);

  const handleInterfaceChange = (newIface: string) => {
    setSelectedInterface(newIface);
    const target = networkAudit?.interfaces?.find((i) => i.name === newIface);
    if (target?.canonical_base_multicast_prefix) {
      setBaseMulticastPrefix(target.canonical_base_multicast_prefix);
    }
  };

  // Virtual Sink actions
  const handleAddSink = () => {
    const nextIndex = virtualSinks.length + 1;
    const newId = `bus_${nextIndex}`;
    const cleanPrefix = baseMulticastPrefix.trim().replace(/\.$/, '') || '239.69.1';
    const newSink: VirtualSinkConfig = {
      id: newId,
      name: `Aux Mix Bus ${nextIndex}`,
      channels: 2,
      aes67_enabled: false,
      multicast_ip: `${cleanPrefix}.${nextIndex}`,
      rtp_port: 5004,
      sap_name: `${hostName} aes_${newId}`,
    };
    setVirtualSinks([...virtualSinks, newSink]);
  };

  const handleRemoveSink = (index: number) => {
    if (virtualSinks.length <= 1) return;
    setVirtualSinks(virtualSinks.filter((_, i) => i !== index));
  };

  const validateSinkMulticast = (idx: number, ip: string | undefined, port: number | undefined) => {
    if (!API || !ip) return;
    fetch(`${API}/api/pipewire/validate-multicast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: initialConfig?.id,
        sink_id: virtualSinks[idx]?.id,
        multicast_ip: ip.trim(),
        rtp_port: Number(port) || 5004,
      }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setSinkValidationFeedback((prev) => ({ ...prev, [idx]: data }));
        }
      })
      .catch(() => {});
  };

  const internalCollisions = React.useMemo(() => {
    const map: Record<string, number[]> = {};
    virtualSinks.forEach((s, idx) => {
      if (aes67Enabled && s.aes67_enabled && s.multicast_ip) {
        const key = `${s.multicast_ip.trim()}:${s.rtp_port || 5004}`;
        if (!map[key]) map[key] = [];
        map[key].push(idx);
      }
    });
    return Object.entries(map).filter(([_, indices]) => indices.length > 1);
  }, [virtualSinks, aes67Enabled]);

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

  const isNicConflict = aes67Enabled && Boolean(selectedInterface && reservedNics[selectedInterface]);

  // Derived PTP capabilities & detection flags
  const selectedIfaceObj = networkAudit?.interfaces?.find((i) => i.name === selectedInterface);
  const currentNicPtpSupport = selectedIfaceObj?.ptp_support || (selectedIfaceObj?.ptp_hardware_capable ? 'hardware' : (selectedIfaceObj?.ptp_software_capable ? 'software' : 'none'));
  const isPtpInstalled = Boolean(networkAudit?.host_ptp?.ptp4l_installed);
  const canEnableMasterClock = isPtpInstalled && currentNicPtpSupport !== 'none';
  const isPtpMasterDetected = Boolean(selectedIfaceObj?.active_ptp_master?.detected || networkAudit?.host_ptp?.active_master_detected);
  const detectedMasterIp = selectedIfaceObj?.active_ptp_master?.source_ip || 'LAN';
  const isLocalMaster = Boolean(
    selectedIfaceObj?.active_ptp_master?.is_local ||
    (selectedIfaceObj?.ip && detectedMasterIp === selectedIfaceObj.ip)
  );
  const isExternalMasterDetected = isPtpMasterDetected && !isLocalMaster;

  // Auto-seed priority 200 on new service only if an external Grandmaster clock is detected on LAN
  useEffect(() => {
    if (!isEditing && !initialConfig?.id && isExternalMasterDetected && ptpPriority1 === 128) {
      setPtpPriority1(200);
    }
  }, [isExternalMasterDetected, isEditing, initialConfig?.id]);

  // Fetch AoIP stream discovery (SAP announcements) from network
  const fetchAoIpDiscovery = () => {
    setIsLoadingDiscovery(true);
    const token = localStorage.getItem('token') || '';
    fetch(`${API}/api/pipewire/aoip-discovery?service_id=${initialConfig?.id || ''}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.discovered_streams)) {
          setDiscoveredStreams(data.discovered_streams);
        }
      })
      .catch((err) => console.debug('Could not fetch AoIP discovery:', err))
      .finally(() => setIsLoadingDiscovery(false));
  };

  useEffect(() => {
    if (aes67Enabled) {
      fetchAoIpDiscovery();
    }
  }, [aes67Enabled]);

  const handleAddRemoteSink = () => {
    const nextIdx = remoteSinks.length + 1;
    setRemoteSinks((prev) => [
      ...prev,
      {
        id: `remote_sink_${nextIdx}`,
        name: `Remote Audio Stream ${nextIdx}`,
        multicast_ip: '239.69.1.1',
        rtp_port: 5004,
        channels: 2,
        format: 'S24BE',
        rate: Number(sampleRate) || 48000,
      },
    ]);
  };

  const handleRemoteSinkChange = (index: number, field: keyof RemoteSinkConfig, value: any) => {
    setRemoteSinks((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleRemoveRemoteSink = (index: number) => {
    setRemoteSinks((prev) => prev.filter((_, i) => i !== index));
  };

  const handleImportDiscoveredStream = (stream: any) => {
    if (!stream) return;
    const cleanName = stream.session_name || stream.sap_name || stream.name || `Remote ${stream.multicast_ip}`;
    const baseId = cleanName.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'remote_sink';
    let uniqueId = baseId;
    let counter = 1;
    while (remoteSinks.some((rs) => rs.id === uniqueId) || virtualSinks.some((vs) => vs.id === uniqueId)) {
      uniqueId = `${baseId}_${counter}`;
      counter++;
    }

    const newSink: RemoteSinkConfig = {
      id: uniqueId,
      name: cleanName,
      multicast_ip: stream.multicast_ip,
      rtp_port: Number(stream.rtp_port) || 5004,
      channels: Number(stream.channels) || 2,
      format: stream.format === 'S16BE' ? 'S16BE' : 'S24BE',
      rate: Number(stream.sample_rate || stream.rate) || 48000,
      sap_name: cleanName,
      origin_ip: stream.origin_ip || '',
    };
    setRemoteSinks((prev) => [...prev, newSink]);
  };

  // Form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isNicConflict || internalCollisions.length > 0) return;

    // Find selected interface IP for aes67_network payload
    const activeIface = networkAudit?.interfaces?.find((i) => i.name === selectedInterface);
    const selectedIp = activeIface?.ip || aesNetCfg.ip || '0.0.0.0';
    const cleanPrefix = baseMulticastPrefix.trim().replace(/\.$/, '') || '239.69.1';

    const cleanSinks = virtualSinks.map((s, idx) => {
      const suffix = cleanSapSuffix(s.sap_name, hostName, s.id.trim());
      const fullSap = `${hostName} ${suffix}`.trim();
      return {
        id: s.id.trim(),
        name: s.name.trim(),
        channels: Number(s.channels) || 2,
        aes67_enabled: aes67Enabled && Boolean(s.aes67_enabled),
        multicast_ip: s.multicast_ip?.trim() || `${cleanPrefix}.${idx + 1}`,
        rtp_port: Number(s.rtp_port) || 5004,
        sap_name: fullSap,
      };
    });

    const cleanRemoteSinks = remoteSinks.map((rs) => ({
      id: rs.id.trim(),
      name: rs.name.trim(),
      multicast_ip: rs.multicast_ip.trim(),
      rtp_port: Number(rs.rtp_port) || 5004,
      channels: Number(rs.channels) || 2,
      format: rs.format || 'S24BE',
      rate: Number(rs.rate) || Number(sampleRate) || 48000,
      sap_name: rs.sap_name?.trim() || undefined,
      origin_ip: rs.origin_ip?.trim() || undefined,
    }));

    const configPayload = {
      sample_rate: Number(sampleRate),
      quantum: Number(quantum),
      min_quantum: 128,
      max_quantum: 2048,
      virtual_sinks: cleanSinks,
      remote_sinks: cleanRemoteSinks,
      aes67_network: {
        enabled: aes67Enabled,
        interface: aes67Enabled ? selectedInterface : null,
        ip: aes67Enabled ? selectedIp : '0.0.0.0',
        base_multicast_prefix: aes67Enabled ? cleanPrefix : null,
        ptp: aes67Enabled ? {
          enabled: Boolean(ptpEnabled && canEnableMasterClock),
          auto_inhibit: Boolean(ptpAutoInhibit),
          priority1: Math.max(0, Math.min(255, Number(ptpPriority1) || 128)),
          domain: Math.max(0, Math.min(127, Number(ptpDomain) || 0)),
          profile: ptpProfile || 'aes67',
        } : undefined,
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

        {/* ── Section 2: AES67 / Dante Broadcast (Tx) Network Module ── */}
        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-4 shadow-sm space-y-4">
          <div className="border-b border-[var(--glass-border)] pb-2 flex items-center justify-between">
            <div>
              <h4 className="text-xs font-black uppercase tracking-wider text-brand-lime flex items-center gap-2">
                <span>🌐</span>
                {t('services.pipewire.aes67Section', '2. AES67 / Dante Broadcast (Tx) Network Module')}
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
                    onChange={(e) => handleInterfaceChange(e.target.value)}
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-brand-lime transition-colors cursor-pointer"
                  >
                    {networkAudit?.interfaces && networkAudit.interfaces.length > 0 ? (
                      networkAudit.interfaces.map((iface) => {
                        const inUseBy = reservedNics[iface.name];
                        const ptpBadge = (iface.ptp_support === 'hardware' || iface.ptp_hardware_capable)
                          ? `🟢 ${t('services.pipewire.nicPtpHardware', 'PTP HW')}`
                          : (iface.ptp_support === 'software' || iface.ptp_software_capable)
                          ? `⚠️ ${t('services.pipewire.nicPtpSoftware', 'Software Clock')}`
                          : `🔴 ${t('services.pipewire.nicPtpNone', 'No PTP')}`;
                        return (
                          <option key={iface.name} value={iface.name} disabled={Boolean(inUseBy)}>
                            {iface.name} ({iface.ip || 'No IPv4'}) · [{ptpBadge}] {inUseBy ? `— [${t('services.pipewire.nicReservedBy', 'Reserved by: {{name}}', { name: inUseBy.serviceName })}]` : ''}
                          </option>
                        );
                      })
                    ) : (
                      <option value="">{t('services.pipewire.noInterfaces', 'No physical interfaces detected')}</option>
                    )}
                  </select>
                )}
                <span className="text-[10px] text-[var(--text-secondary)] mt-1 block">
                  {t('services.pipewire.nicHelp', 'Select the physical LAN port connected to the Dante/AES67 audio subnet.')}
                </span>

                {/* Selected NIC Capability Badge */}
                {selectedIfaceObj && (
                  <div className="flex items-center gap-2 mt-2 text-[11px]">
                    <span className="text-[var(--text-secondary)] font-mono text-[10px] uppercase font-bold">{selectedIfaceObj.name}:</span>
                    {(selectedIfaceObj.ptp_support === 'hardware' || selectedIfaceObj.ptp_hardware_capable) ? (
                      <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 font-semibold flex items-center gap-1 text-[10px]">
                        <span>🟢</span>
                        <span>{t('services.pipewire.nicPtpHardware', 'PTP HW')} ({selectedIfaceObj.ptp_device || 'SOF_TIMESTAMPING_TX_HARDWARE'})</span>
                      </span>
                    ) : (selectedIfaceObj.ptp_support === 'software' || selectedIfaceObj.ptp_software_capable) ? (
                      <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/30 font-semibold flex items-center gap-1 text-[10px]">
                        <span>⚠️</span>
                        <span>{t('services.pipewire.nicPtpSoftware', 'Software Clock')} (SOF_TIMESTAMPING_TX_SOFTWARE)</span>
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-red-500/10 text-red-500 border border-red-500/30 font-semibold flex items-center gap-1 text-[10px]">
                        <span>🔴</span>
                        <span>{t('services.pipewire.nicPtpNone', 'No PTP')}</span>
                      </span>
                    )}
                  </div>
                )}

                {isNicConflict && (
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs flex items-start gap-2.5 mt-2 animate-in fade-in duration-200">
                    <span className="text-base shrink-0 mt-0.5">⚠️</span>
                    <div>
                      <p className="font-bold">
                        {t('services.pipewire.nicConflictTitle', 'Network Interface In Use')}
                      </p>
                      <p className="text-[11px] text-[var(--text-secondary)] mt-1 leading-relaxed">
                        {t(
                          'services.pipewire.nicConflictDesc',
                          'The interface {{iface}} is already reserved by {{name}} for AES67 broadcast. In a single host, AES67 must be managed from a single Hub to avoid PTP clock and SAP port conflicts. Please add virtual sinks to the existing service or choose another interface.',
                          { iface: selectedInterface, name: reservedNics[selectedInterface].serviceName }
                        )}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Base Multicast Prefix & Host Node Identifier */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1">
                <div>
                  <label className="block text-[11px] font-bold uppercase text-[var(--text-secondary)] mb-1">
                    {t('services.pipewire.baseMulticastPrefix', 'Base Multicast Prefix (AES67 / Dante 239.69.X)')}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      required
                      value={baseMulticastPrefix}
                      onChange={(e) => setBaseMulticastPrefix(e.target.value)}
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-brand-lime transition-colors"
                      placeholder="239.69.1"
                    />
                    <button
                      type="button"
                      onClick={handleRecalculateRoutes}
                      title={t('services.pipewire.recalculatePrefixTitle', 'Recalculate canonical prefix from NIC and re-seed all sink routes')}
                      className="px-3 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--glass-border)] text-xs font-medium hover:border-brand-lime text-[var(--text-secondary)] hover:text-brand-lime whitespace-nowrap cursor-pointer transition-colors shadow-sm flex items-center gap-1.5"
                    >
                      <span>↻</span>
                      <span>{t('services.pipewire.recalc', 'Recalc')}</span>
                    </button>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-[var(--text-secondary)] block">
                      {t('services.pipewire.baseMulticastHelp', 'Canonical 239.69.X range derived from host NIC IP to guarantee zero collisions between nodes.')}
                    </span>
                    {recalcFeedback && (
                      <span className="text-[10px] text-brand-lime font-mono font-bold animate-pulse">
                        ✓ {t('services.pipewire.recalcDone', 'Synchronized ({{prefix}}.X)', { prefix: recalcFeedback })}
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase text-[var(--text-secondary)] mb-1">
                    {t('services.pipewire.nodeHostname', 'Host Node Identifier')}
                  </label>
                  <div className="px-3 py-2 rounded-lg bg-[var(--bg-card)]/60 border border-[var(--glass-border)] text-xs font-mono text-brand-lime font-bold flex items-center gap-2">
                    <span>🖥️</span>
                    <span>{hostName}</span>
                  </div>
                  <span className="text-[10px] text-[var(--text-secondary)] mt-1 block">
                    {t('services.pipewire.hostnameHelp', 'Locked hostname prefix automatically prepended to SAP announcements.')}
                  </span>
                </div>
              </div>

              {/* PTPv2 Master Clock & Synchronization Section */}
              <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--glass-border)] space-y-3.5">
                <div className="flex items-center justify-between">
                  <div>
                    <h5 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-2">
                      <span>⏱️</span>
                      <span>{t('services.pipewire.ptpMasterSection', 'PTPv2 Master Clock & Synchronization')}</span>
                    </h5>
                    <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                      {t('services.pipewire.ptpMasterHelp', 'Synchronize AoIP broadcast streams using precision PTPv2 (IEEE 1588-2008 / AES67).')}
                    </p>
                  </div>

                  {/* Toggle 1: Enable PTP Master Clock */}
                  <label className={`relative inline-flex items-center cursor-pointer ${!canEnableMasterClock ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <input
                      type="checkbox"
                      disabled={!canEnableMasterClock}
                      checked={ptpEnabled && canEnableMasterClock}
                      onChange={(e) => setPtpEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-lime"></div>
                  </label>
                </div>

                {!isPtpInstalled ? (
                  <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-600 dark:text-amber-300 text-[11px] flex items-center gap-2">
                    <span className="text-sm shrink-0">⚠️</span>
                    <span>{t('services.pipewire.ptpNotInstalled', 'ptp4l utility not found on host. Install linuxptp system package to enable PTP Master Clock.')}</span>
                  </div>
                ) : currentNicPtpSupport === 'none' ? (
                  <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/25 text-red-600 dark:text-red-300 text-[11px] flex items-center gap-2">
                    <span className="text-sm shrink-0">🔴</span>
                    <span>{t('services.pipewire.ptpNicNotSupported', 'Selected network interface does not support PTP timestamping.')}</span>
                  </div>
                ) : null}

                {ptpEnabled && canEnableMasterClock && (
                  <div className="space-y-3 pt-2 border-t border-[var(--glass-border)]">
                    {/* Toggle 2: Auto-inhibition (BMCA) */}
                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--input-bg)] border border-[var(--glass-border)]">
                      <div className="pr-4">
                        <label className="text-xs font-semibold text-[var(--text-primary)] block cursor-pointer">
                          {t('services.pipewire.ptpAutoInhibit', 'Auto-inhibit if another Master is detected (BMCA)')}
                        </label>
                        <span className="text-[10px] text-[var(--text-secondary)] block mt-0.5 leading-relaxed">
                          {t('services.pipewire.ptpAutoInhibitHelp', 'Enables Best Master Clock Algorithm negotiation. Prevents clock collisions by yielding if an external Grandmaster is present on the network.')}
                        </span>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer shrink-0">
                        <input
                          type="checkbox"
                          checked={ptpAutoInhibit}
                          onChange={(e) => setPtpAutoInhibit(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-8 h-4 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-brand-lime"></div>
                      </label>
                    </div>

                    {/* Dynamic Master Detection Status Banners */}
                    {!isExternalMasterDetected ? (
                      <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2">
                        <span className="text-sm shrink-0">🟢</span>
                        <span>
                          {isLocalMaster
                            ? t('services.pipewire.ptpStatusLocalMaster', 'This host is currently broadcasting as PTP Master on this interface.')
                            : t('services.pipewire.ptpStatusFree', 'No external PTP clock detected on LAN. This node will act as Grandmaster.')}
                        </span>
                      </div>
                    ) : !ptpAutoInhibit ? (
                      <div className="p-3 rounded-lg bg-red-500/15 border border-red-500/40 text-red-600 dark:text-red-400 text-xs flex items-start gap-2 animate-in fade-in duration-200">
                        <span className="text-base shrink-0">🚨</span>
                        <div>
                          <p className="font-bold">
                            {t(
                              'services.pipewire.ptpStatusDanger',
                              'CLOCK COLLISION RISK: Auto-inhibition is disabled while another Grandmaster ({{ip}}) is broadcasting. This will cause packet jitter and packet loss on AES67/Dante receivers unless domain or priority is isolated.',
                              { ip: detectedMasterIp }
                            )}
                          </p>
                        </div>
                      </div>
                    ) : ptpPriority1 >= 200 ? (
                      <div className="p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-300 text-xs flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm shrink-0">⏱️</span>
                          <span>
                            {t(
                              'services.pipewire.ptpStatusHealthyBackup',
                              'External PTP Grandmaster active on LAN ({{ip}}). This node is configured as secondary/backup clock (Priority {{prio}}).',
                              { ip: detectedMasterIp, prio: ptpPriority1 }
                            )}
                          </span>
                        </div>
                        <span className="shrink-0 px-2 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/30 text-[10px] font-mono font-bold">
                          BMCA Backup
                        </span>
                      </div>
                    ) : (
                      <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                        <div className="flex items-start gap-2">
                          <span className="text-sm shrink-0 mt-0.5">ℹ️</span>
                          <div>
                            <p className="font-semibold leading-snug">
                              {t(
                                'services.pipewire.ptpStatusContending',
                                'External PTP Grandmaster detected on LAN ({{ip}}). Both nodes claim primary priority ({{prio}}). BMCA will negotiate leadership, or you can designate this node as backup.',
                                { ip: detectedMasterIp, prio: ptpPriority1 }
                              )}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPtpPriority1(200)}
                          title={t('services.pipewire.ptpSetBackupTitle', 'Set priority to 200 to ensure this node acts as a non-intrusive backup slave')}
                          className="shrink-0 px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-700 dark:text-amber-300 border border-amber-500/40 text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1.5 self-start sm:self-auto shadow-sm"
                        >
                          <span>🛡️</span>
                          <span>{t('services.pipewire.ptpSetBackupBtn', 'Set Backup Priority (200)')}</span>
                        </button>
                      </div>
                    )}

                    {/* 3 Intercompatibility Parameters */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                      {/* Priority 1 */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)]">
                            {t('services.pipewire.ptpPriority1', 'Priority 1 (BMCA)')}
                          </label>
                          {ptpPriority1 >= 200 && (
                            <span className="text-[9px] font-mono text-emerald-500 font-bold">
                              [Backup]
                            </span>
                          )}
                        </div>
                        <input
                          type="number"
                          min={0}
                          max={255}
                          value={ptpPriority1}
                          onChange={(e) => setPtpPriority1(Math.max(0, Math.min(255, Number(e.target.value) || 0)))}
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-brand-lime"
                        />
                        <span className="text-[9px] text-[var(--text-secondary)] mt-0.5 block leading-tight">
                          {t('services.pipewire.ptpPriority1Help', 'BMCA preference (0-255). 128 is default; 64 for primary, 200 for backup.')}
                        </span>
                      </div>

                      {/* Domain */}
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">
                          {t('services.pipewire.ptpDomain', 'PTP Domain')}
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={127}
                          value={ptpDomain}
                          onChange={(e) => setPtpDomain(Math.max(0, Math.min(127, Number(e.target.value) || 0)))}
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-brand-lime"
                        />
                        <span className="text-[9px] text-[var(--text-secondary)] mt-0.5 block leading-tight">
                          {t('services.pipewire.ptpDomainHelp', 'PTP domain (0-127). Domain 0 is AES67 / Dante default.')}
                        </span>
                      </div>

                      {/* Profile */}
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">
                          {t('services.pipewire.ptpProfile', 'PTP Profile')}
                        </label>
                        <select
                          value={ptpProfile}
                          onChange={(e) => setPtpProfile(e.target.value)}
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-brand-lime cursor-pointer"
                        >
                          <option value="aes67">{t('services.pipewire.ptpProfileAes67', 'AES67 Media (8 sync/s · DSCP 46/34)')}</option>
                          <option value="ieee1588">{t('services.pipewire.ptpProfileIeee1588', 'IEEE 1588 Default (1 sync/s)')}</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Section 3: Virtual Sinks Manager ── */}
        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-4 shadow-sm space-y-4">
          <div className="border-b border-[var(--glass-border)] pb-2 flex items-center justify-between">
            <div>
              <h4 className="text-xs font-black uppercase tracking-wider text-brand-lime flex items-center gap-2">
                <span>🎚️</span>
                {t('services.pipewire.virtualSinksSection', '3. Virtual Sinks Manager')}
              </h4>
              <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                {t('services.pipewire.virtualSinksHelp', 'Virtual audio endpoints available for routing, application capture, and broadcast distribution.')}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {aes67Enabled && (
                <button
                  type="button"
                  onClick={handleRecalculateRoutes}
                  title={t('services.pipewire.recalculatePrefixTitle', 'Recalculate canonical prefix from NIC and re-seed all sink routes')}
                  className="px-2.5 py-1.5 rounded-lg bg-[var(--input-bg)] border border-[var(--glass-border)] hover:border-brand-lime text-xs font-mono font-medium text-[var(--text-secondary)] hover:text-brand-lime transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
                >
                  <span>↻</span>
                  <span>{t('services.pipewire.recalcAllSinks', 'Recalc Sinks')}</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleAddSink}
                className="px-2.5 py-1.5 rounded-lg bg-brand-lime/10 text-brand-lime hover:bg-brand-lime/20 border border-brand-lime/30 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <PlusIcon size={13} />
                {t('services.pipewire.addSink', 'Add Virtual Sink')}
              </button>
            </div>
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
                      <div className="space-y-2 pt-1">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                          <div>
                            <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">
                              {t('services.pipewire.multicastIp', 'Multicast IP')}
                            </label>
                            <input
                              type="text"
                              required
                              value={sink.multicast_ip || `${baseMulticastPrefix.trim().replace(/\.$/, '')}.${idx + 1}`}
                              onChange={(e) => handleSinkChange(idx, 'multicast_ip', e.target.value)}
                              onBlur={() => validateSinkMulticast(idx, sink.multicast_ip, sink.rtp_port)}
                              className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2 py-1 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-brand-lime"
                              placeholder="239.69.1.10"
                            />
                            {sinkValidationFeedback[idx] && (
                              <div className="mt-1">
                                {sinkValidationFeedback[idx].collision ? (
                                  <p className="text-[10px] text-red-500 font-bold leading-tight">
                                    🚫 {sinkValidationFeedback[idx].message}
                                  </p>
                                ) : sinkValidationFeedback[idx].is_reserved ? (
                                  <p className="text-[10px] text-red-400 font-bold leading-tight">
                                    ⚠️ {sinkValidationFeedback[idx].message}
                                  </p>
                                ) : sinkValidationFeedback[idx].advisory_same_ip ? (
                                  <p className="text-[10px] text-amber-500 font-medium leading-tight">
                                    ℹ️ {sinkValidationFeedback[idx].message}
                                  </p>
                                ) : !sinkValidationFeedback[idx].valid ? (
                                  <p className="text-[10px] text-red-400 font-bold leading-tight">
                                    ❌ {sinkValidationFeedback[idx].message}
                                  </p>
                                ) : null}
                              </div>
                            )}
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
                              onBlur={() => validateSinkMulticast(idx, sink.multicast_ip, sink.rtp_port)}
                              className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2 py-1 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-brand-lime"
                              placeholder="5004"
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">
                              {t('services.pipewire.sapName', 'SAP Broadcast Name')}
                            </label>
                            <div className="flex items-center">
                              <span className="px-2.5 py-1 bg-[var(--bg-card)] border border-r-0 border-[var(--glass-border)] rounded-l-lg text-xs font-mono font-bold text-brand-lime flex items-center gap-1 select-none whitespace-nowrap">
                                🖥️ {hostName}
                              </span>
                              <input
                                type="text"
                                required
                                value={cleanSapSuffix(sink.sap_name, hostName, sink.id)}
                                onChange={(e) => handleSinkChange(idx, 'sap_name', `${hostName} ${e.target.value}`.trim())}
                                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-r-lg px-2 py-1 text-xs text-[var(--text-primary)] focus:outline-none focus:border-brand-lime"
                                placeholder={`aes_${sink.id}`}
                              />
                            </div>
                            <div className="text-[10px] font-mono text-[var(--text-secondary)] mt-0.5 truncate">
                              {t('services.pipewire.sdpSessionPreview', 'SDP Session')}: <span className="text-brand-lime font-bold">s={hostName} {cleanSapSuffix(sink.sap_name, hostName, sink.id) || sink.id}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {internalCollisions.length > 0 && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-500 text-xs flex items-start gap-2.5 mt-2 animate-in fade-in duration-200">
              <span className="text-base shrink-0">🚫</span>
              <div>
                <p className="font-bold">
                  {t('services.pipewire.internalCollisionError', 'Duplicate Multicast IP / Port route detected within this Hub. Each AES67 stream must have a unique destination IP.')}
                </p>
                <p className="text-[11px] opacity-80 mt-0.5 font-mono">
                  {internalCollisions.map(([key]) => key).join(', ')}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Section 4: Remote AoIP Sinks (Network Audio Rx) ── */}
        {aes67Enabled && (
          <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-4 shadow-sm space-y-4">
            <div className="border-b border-[var(--glass-border)] pb-2 flex items-center justify-between flex-wrap gap-2">
              <div>
                <h4 className="text-xs font-black uppercase tracking-wider text-purple-400 flex items-center gap-2">
                  <span>📡</span>
                  {t('services.pipewire.remoteSinksSection', '4. Remote AoIP Sinks (Network Audio Rx)')}
                </h4>
                <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                  {t('services.pipewire.remoteSinksHelp', 'Persistent remote RTP/AES67 streams ingested into this Hub from other network nodes.')}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {/* SAP Network Discovery Selector */}
                {(() => {
                  const unconfigured = discoveredStreams.filter(
                    (ds: any) => !ds.is_local && !remoteSinks.some((rs) => rs.multicast_ip === ds.multicast_ip && rs.rtp_port === ds.rtp_port)
                  );
                  return (
                    <div className="flex items-center gap-1.5">
                      <select
                        onChange={(e) => {
                          const val = e.target.value;
                          if (!val) return;
                          const found = unconfigured.find((s) => `${s.multicast_ip}:${s.rtp_port}` === val);
                          if (found) {
                            handleImportDiscoveredStream(found);
                          }
                          e.target.value = '';
                        }}
                        defaultValue=""
                        className="bg-[var(--input-bg)] border border-[var(--glass-border)] hover:border-purple-400 text-xs font-mono text-[var(--text-primary)] rounded-lg px-2 py-1.5 transition-colors cursor-pointer outline-none max-w-[210px] truncate"
                      >
                        <option value="" disabled>
                          📡 {t('services.pipewire.importSapStream', 'Import from Network (SAP)')} ({unconfigured.length})
                        </option>
                        {unconfigured.length === 0 ? (
                          <option value="" disabled>
                            {t('services.pipewire.noDiscoveredStreams', 'No new SAP streams detected on LAN')}
                          </option>
                        ) : (
                          unconfigured.map((ds: any) => (
                            <option key={`${ds.multicast_ip}:${ds.rtp_port}`} value={`${ds.multicast_ip}:${ds.rtp_port}`}>
                              {ds.session_name || ds.sap_name || `${ds.multicast_ip}:${ds.rtp_port}`} ({ds.channels}ch)
                            </option>
                          ))
                        )}
                      </select>

                      <button
                        type="button"
                        onClick={fetchAoIpDiscovery}
                        disabled={isLoadingDiscovery}
                        title={t('services.pipewire.refreshDiscovery', 'Refresh network discovery')}
                        className="p-1.5 rounded-lg bg-[var(--input-bg)] border border-[var(--glass-border)] hover:border-purple-400 text-[var(--text-secondary)] hover:text-purple-400 transition-colors cursor-pointer"
                      >
                        <span className={isLoadingDiscovery ? 'animate-spin inline-block' : ''}>↻</span>
                      </button>
                    </div>
                  );
                })()}

                <button
                  type="button"
                  onClick={handleAddRemoteSink}
                  className="px-2.5 py-1.5 rounded-lg bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 border border-purple-500/30 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <PlusIcon size={13} />
                  {t('services.pipewire.addRemoteSink', 'Add Remote Sink (Manual)')}
                </button>
              </div>
            </div>

            {remoteSinks.length === 0 ? (
              <div className="p-4 rounded-xl bg-[var(--input-bg)]/40 border border-dashed border-[var(--glass-border)] text-center text-xs text-[var(--text-secondary)]">
                <span className="text-xl block mb-1">📻</span>
                <p className="font-semibold text-[var(--text-primary)]">
                  {t('services.pipewire.noRemoteSinksTitle', 'No Remote AoIP Sinks Configured')}
                </p>
                <p className="text-[11px] mt-0.5 max-w-md mx-auto">
                  {t('services.pipewire.noRemoteSinks', 'Add a remote RTP/AES67 stream manually or import one from network SAP announcements to persist audio ingestion on boot.')}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {remoteSinks.map((rs, idx) => (
                  <div
                    key={idx}
                    className="bg-[var(--input-bg)]/60 border border-[var(--glass-border)] rounded-xl p-3.5 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-purple-500/10 text-purple-400 text-[10px] font-mono font-bold flex items-center justify-center border border-purple-500/30">
                          #{idx + 1}
                        </span>
                        <span className="text-xs font-bold text-[var(--text-primary)]">
                          {rs.name || rs.id || `Remote Sink ${idx + 1}`}
                        </span>
                        {rs.sap_name && (
                          <span className="px-2 py-0.5 rounded-full text-[9px] font-mono bg-purple-500/10 text-purple-300 border border-purple-500/30">
                            SAP: {rs.sap_name}
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveRemoteSink(idx)}
                        className="text-[var(--text-secondary)] hover:text-red-400 p-1 rounded-md transition-colors cursor-pointer"
                        title={t('services.pipewire.remoteRemove', 'Remove remote sink')}
                      >
                        <TrashIcon size={14} />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                      <div className="sm:col-span-4">
                        <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">
                          {t('services.pipewire.remoteSinkId', 'Node Identifier (ID)')} <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          pattern="^[a-zA-Z0-9_\-]+$"
                          value={rs.id}
                          onChange={(e) => handleRemoteSinkChange(idx, 'id', e.target.value.replace(/[^a-zA-Z0-9_\-]/g, ''))}
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-brand-lime"
                          placeholder="remote_test1_aes"
                        />
                      </div>

                      <div className="sm:col-span-5">
                        <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">
                          {t('services.pipewire.remoteSinkName', 'Description / Stream Name')} <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={rs.name}
                          onChange={(e) => handleRemoteSinkChange(idx, 'name', e.target.value)}
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-brand-lime"
                          placeholder="Test1 AES67 Stream"
                        />
                      </div>

                      <div className="sm:col-span-3">
                        <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">
                          {t('services.pipewire.remoteChannels', 'Channels')}
                        </label>
                        <select
                          value={rs.channels}
                          onChange={(e) => handleRemoteSinkChange(idx, 'channels', Number(e.target.value))}
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-brand-lime cursor-pointer"
                        >
                          <option value={1}>1 (Mono)</option>
                          <option value={2}>2 (Stereo)</option>
                          <option value={4}>4 (Quad)</option>
                          <option value={6}>6 (5.1 Surround)</option>
                          <option value={8}>8 (Octa / MultiTrack)</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-1">
                      <div className="sm:col-span-5">
                        <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">
                          {t('services.pipewire.remoteMulticastIp', 'Multicast IP (Rx)')} <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={rs.multicast_ip}
                          onChange={(e) => handleRemoteSinkChange(idx, 'multicast_ip', e.target.value.trim())}
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-brand-lime"
                          placeholder="239.69.11.1"
                        />
                      </div>

                      <div className="sm:col-span-3">
                        <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">
                          {t('services.pipewire.remoteRtpPort', 'RTP Port')} <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="number"
                          required
                          min={1024}
                          max={65535}
                          value={rs.rtp_port}
                          onChange={(e) => handleRemoteSinkChange(idx, 'rtp_port', Number(e.target.value))}
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-brand-lime"
                        />
                      </div>

                      <div className="sm:col-span-4">
                        <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">
                          {t('services.pipewire.remoteFormat', 'Audio Format')}
                        </label>
                        <select
                          value={rs.format}
                          onChange={(e) => handleRemoteSinkChange(idx, 'format', e.target.value as any)}
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-brand-lime cursor-pointer"
                        >
                          <option value="S24BE">S24BE (AES67 standard L24)</option>
                          <option value="S16BE">S16BE (Standard L16)</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Section 5: Dedicated Log Storage Volume ── */}
        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-4 shadow-sm space-y-3">
          <div className="border-b border-[var(--glass-border)] pb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-orange-400" />
            <h4 className="text-xs font-black uppercase tracking-wider text-orange-400">
              5. {t('services.pipewire.logStorageTitle', 'Log Storage Volume')}
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

        {/* ── Section 6: Lifecycle, Boot Order & Watchdog ── */}
        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-4 shadow-sm space-y-3">
          <div className="border-b border-[var(--glass-border)] pb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <h4 className="text-xs font-black uppercase tracking-wider text-emerald-400">
              6. {t('services.pipewire.lifecycleTitle', 'Lifecycle, Boot Order & Watchdog')}
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
          disabled={isNicConflict || internalCollisions.length > 0}
          className="px-5 py-2 rounded-xl text-xs font-black uppercase tracking-wider bg-brand-lime text-black hover:opacity-90 transition-all shadow-md cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isEditing
            ? t('common.save', 'Save Changes')
            : t('services.createService', 'Create Service')}
        </button>
      </div>
    </form>
  );
};
