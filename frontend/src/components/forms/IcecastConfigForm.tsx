import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PencilIcon,
  TrashIcon,
  PlusIcon,
  ShieldIcon,
  CheckIcon
} from '../Icons';
import { NetworkInterfaceSelector } from '../common/NetworkInterfaceSelector';
import { AliasField } from '../common/AliasField';
import { SearchableSelect } from '../common/SearchableSelect';
import {
  cascadeMountRenameOrRemoval,
  getAvailableFallbackMounts,
  normalizeMountPath,
  shouldDefaultPeerRelayTls,
} from '../../utils/icecastHelpers';

interface IcecastConfigFormProps {
  initialConfig?: any;
  onCancel: () => void;
  onSubmit: (config: any) => Promise<void> | void;
  API?: string;
}

export interface MountpointConfig {
  mount_name: string;
  max_listeners?: number;
  fallback_mount?: string;
  fallback_override?: boolean;
  burst_size?: number;
  source_password?: string;
  relay_enabled?: boolean;
  relay_url?: string;
  relay_on_demand?: boolean;
  relay_username?: string;
  relay_password?: string;
  relay_mode?: 'manual' | 'peer';
  relay_peer_node_id?: number;
  relay_peer_service_id?: number;
  relay_peer_mount?: string;
  relay_peer_tls?: boolean;
}

export const IcecastConfigForm: React.FC<IcecastConfigFormProps> = ({
  initialConfig,
  onCancel,
  onSubmit,
  API = '',
}) => {
  const { t } = useTranslation();

  const iceCfg = initialConfig?.config?.icecast_config || initialConfig?.icecast_config || {};

  const [name, setName] = useState(initialConfig?.name || 'Icecast Server');
  const [alias, setAlias] = useState(initialConfig?.alias || '');
  const [buildId, setBuildId] = useState<number | null>(initialConfig?.ffmpeg_build_id || null);
  const [availableBuilds, setAvailableBuilds] = useState<any[]>([]);

  // Network Bind Interface
  const [bindAddress, setBindAddress] = useState<string>(iceCfg.bind_address || '0.0.0.0');

  // Ports & Protocol
  const [httpEnabled, setHttpEnabled] = useState(iceCfg.http_enabled !== false);
  const [port, setPort] = useState(iceCfg.port || 7000);
  const [sslEnabled, setSslEnabled] = useState(iceCfg.ssl_enabled === true);
  const [sslPort, setSslPort] = useState(iceCfg.ssl_port || 7443);

  // Authentication
  const [sourcePassword, setSourcePassword] = useState(iceCfg.source_password || 'hackme');
  const [adminUser, setAdminUser] = useState(iceCfg.admin_user || 'admin');
  const [adminPassword, setAdminPassword] = useState(iceCfg.admin_password || 'hackme');
  const [relayPassword, setRelayPassword] = useState(iceCfg.relay_password || 'hackme');
  const [showPasswords, setShowPasswords] = useState(false);

  // Server Metadata & Limits
  const [hostname, setHostname] = useState(iceCfg.hostname || window.location.hostname || '127.0.0.1');
  const [location, setLocation] = useState(iceCfg.location || 'Local Broadcast Studio');
  const [adminEmail, setAdminEmail] = useState(iceCfg.admin_email || 'admin@localhost');
  const [clientsLimit, setClientsLimit] = useState(iceCfg.clients_limit || 100);
  const [sourcesLimit, setSourcesLimit] = useState(iceCfg.sources_limit || 10);
  const [burstSize, setBurstSize] = useState(iceCfg.burst_size || 65536);

  // Peer Federation & Sharing
  const [isSharedWithPeers, setIsSharedWithPeers] = useState<boolean>(Boolean(initialConfig?.is_shared_with_peers));
  const [allowPeerLease, setAllowPeerLease] = useState<boolean>(Boolean(initialConfig?.allow_peer_lease));

  // Mountpoints
  const [mounts, setMounts] = useState<MountpointConfig[]>(
    Array.isArray(iceCfg.mounts) ? iceCfg.mounts : [
      { mount_name: '/live.mp3', max_listeners: 100, burst_size: 65536 }
    ]
  );
  const [editingMountIndex, setEditingMountIndex] = useState<number | null>(null);
  const [mountModalOpen, setMountModalOpen] = useState(false);
  const [mountForm, setMountForm] = useState<MountpointConfig>({
    mount_name: '',
    max_listeners: undefined,
    fallback_mount: '',
    fallback_override: true,
    burst_size: 65536,
    source_password: '',
    relay_enabled: false,
    relay_url: '',
    relay_on_demand: false,
    relay_username: '',
    relay_password: '',
    relay_mode: 'manual',
    relay_peer_node_id: undefined,
    relay_peer_service_id: undefined,
    relay_peer_mount: '',
    relay_peer_tls: false,
  });
  const [remotePeers, setRemotePeers] = useState<any[]>([]);
  const [showRelayPassword, setShowRelayPassword] = useState(false);

  const [hasCertificates, setHasCertificates] = useState(false);
  const [sslDomain, setSslDomain] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Storage & Lifecycle
  const [storages, setStorages] = useState<any[]>([]);
  const [logStorageId, setLogStorageId] = useState<number | null>(
    initialConfig?.log_storage_id ?? initialConfig?.config?.log_storage_id ?? null
  );
  const [autoStart, setAutoStart] = useState(
    initialConfig?.auto_start ?? initialConfig?.config?.auto_start ?? false
  );
  const [startupOrder, setStartupOrder] = useState(
    initialConfig?.startup_order ?? initialConfig?.config?.startup_order ?? 1
  );
  const [startupDelay, setStartupDelay] = useState(
    initialConfig?.startup_delay ?? initialConfig?.config?.startup_delay ?? 0
  );
  const [watchdogEnabled, setWatchdogEnabled] = useState(
    initialConfig?.watchdog_enabled ?? initialConfig?.config?.watchdog_enabled !== false
  );
  const [watchdogRetries, setWatchdogRetries] = useState(
    initialConfig?.watchdog_retries ?? initialConfig?.config?.watchdog_retries ?? 5
  );

  // Fetch available Icecast builds, next available ports, and storage volumes
  useEffect(() => {
    fetch(`${API}/builds`)
      .then((r) => (r.ok ? r.json() : []))
      .then((builds) => {
        const iceBuilds = builds.filter(
          (b: any) => b.software_type === 'icecast2' && b.status === 'ready'
        );
        setAvailableBuilds(iceBuilds);
        if (!buildId && iceBuilds.length > 0) {
          const def = iceBuilds.find((b: any) => b.is_default);
          setBuildId(def ? def.id : iceBuilds[0].id);
        }
      })
      .catch(() => {});

    // Check system certificates for SSL badge
    fetch(`${API}/api/settings/ssl/status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && (data.valid || data.status === 'valid' || (typeof data.days_remaining === 'number' && data.days_remaining > 0))) {
          setHasCertificates(true);
          if (data.domain) {
            setSslDomain(data.domain);
          }
        }
      })
      .catch(() => {});

    // Fetch storage volumes for dedicated log storage selection
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

    // Fetch federated peers catalog for quick mountpoint relay selection
    fetch(`${API}/api/peers/remote-nodes`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (Array.isArray(data)) {
          setRemotePeers(data);
        }
      })
      .catch(() => {});

    // Auto-suggest conflict-free ports if creating a new service
    if (!initialConfig) {
      fetch(`${API}/api/services/icecast/next-available-ports`)
        .then((r) => (r.ok ? r.json() : null))
        .then((ports) => {
          if (ports) {
            if (ports.port) setPort(ports.port);
            if (ports.ssl_port) setSslPort(ports.ssl_port);
          }
        })
        .catch(() => {});
    }
  }, [API, initialConfig]);

  const handleOpenAddMount = () => {
    setEditingMountIndex(null);
    setShowRelayPassword(false);
    setMountForm({
      mount_name: '',
      max_listeners: undefined,
      fallback_mount: '',
      fallback_override: true,
      burst_size: 65536,
      source_password: '',
      relay_enabled: false,
      relay_url: '',
      relay_on_demand: false,
      relay_username: '',
      relay_password: '',
      relay_mode: 'manual',
      relay_peer_node_id: undefined,
      relay_peer_service_id: undefined,
      relay_peer_mount: '',
      relay_peer_tls: false,
    });
    setMountModalOpen(true);
  };

  const handleOpenEditMount = (index: number) => {
    setEditingMountIndex(index);
    setShowRelayPassword(false);
    setMountForm({
      relay_enabled: false,
      relay_url: '',
      relay_on_demand: false,
      relay_username: '',
      relay_password: '',
      relay_mode: 'manual',
      relay_peer_node_id: undefined,
      relay_peer_service_id: undefined,
      relay_peer_mount: '',
      relay_peer_tls: false,
      ...mounts[index],
    });
    setMountModalOpen(true);
  };

  const peersWithIcecast = remotePeers
    .map((peer: any) => {
      const services = (peer.cached_services || peer.cached_services_json || []).filter(
        (s: any) => s.service_type === 'icecast_server'
      );
      return { peer, services };
    })
    .filter((entry: any) => entry.services.length > 0);

  const buildPeerRelayUrl = (peer: any, svc: any, mountName: string, useTls: boolean): string => {
    let host = '127.0.0.1';
    try {
      host = new URL(peer.base_url).hostname;
    } catch {
      host = String(peer?.base_url || '127.0.0.1').replace(/https?:\/\//, '').split(':')[0].split('/')[0] || '127.0.0.1';
    }
    const protos = svc?.protocols || {};
    const port = useTls ? (protos.ssl_port || 8443) : (protos.port || 8000);
    const scheme = useTls ? 'https' : 'http';
    const rawMount = (mountName || '/live.mp3').trim();
    const cleanMount = rawMount.startsWith('/') ? rawMount : `/${rawMount}`;
    return `${scheme}://${host}:${port}${cleanMount}`;
  };

  const handleSaveMount = () => {
    const cleanName = normalizeMountPath(mountForm.mount_name);
    if (!cleanName) return;
    if (mountForm.relay_enabled && !mountForm.relay_url?.trim()) return;

    const normFallback = normalizeMountPath(mountForm.fallback_mount);
    const cleanFallback = normFallback && normFallback !== cleanName ? normFallback : undefined;
    const relayEnabled = Boolean(mountForm.relay_enabled);
    const isPeerMode = relayEnabled && mountForm.relay_mode === 'peer';
    const updated: MountpointConfig = {
      ...mountForm,
      mount_name: cleanName,
      fallback_mount: cleanFallback,
      fallback_override: cleanFallback ? (mountForm.fallback_override !== false) : true,
      relay_enabled: relayEnabled,
      relay_url: relayEnabled ? (mountForm.relay_url || '').trim() : '',
      relay_on_demand: relayEnabled ? Boolean(mountForm.relay_on_demand) : false,
      relay_username: relayEnabled ? (mountForm.relay_username || '').trim() : '',
      relay_password: relayEnabled ? (mountForm.relay_password || '').trim() : '',
      relay_mode: isPeerMode ? 'peer' : 'manual',
      relay_peer_node_id: isPeerMode ? mountForm.relay_peer_node_id : undefined,
      relay_peer_service_id: isPeerMode ? mountForm.relay_peer_service_id : undefined,
      relay_peer_mount: isPeerMode ? mountForm.relay_peer_mount : undefined,
      relay_peer_tls: isPeerMode ? Boolean(mountForm.relay_peer_tls) : undefined,
    };

    if (editingMountIndex !== null) {
      const prevName = normalizeMountPath(mounts[editingMountIndex]?.mount_name);
      const next = [...mounts];
      next[editingMountIndex] = updated;
      setMounts(
        prevName && prevName !== cleanName
          ? cascadeMountRenameOrRemoval(next, prevName, cleanName)
          : next
      );
    } else {
      setMounts([...mounts, updated]);
    }
    setMountModalOpen(false);
  };

  const handleDeleteMount = (index: number) => {
    const deletedName = normalizeMountPath(mounts[index]?.mount_name);
    const remaining = mounts.filter((_, i) => i !== index);
    setMounts(deletedName ? cascadeMountRenameOrRemoval(remaining, deletedName) : remaining);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (alias && alias.trim()) {
      if (alias.trim().length > 12) {
        alert(t('common.aliasTooLong', 'Alias cannot exceed 12 characters'));
        return;
      }
      if (!/^[a-zA-Z0-9\s-_]+$/.test(alias.trim())) {
        alert(t('common.aliasInvalidChars', 'Only letters, numbers, spaces, hyphens (-), and underscores (_) allowed'));
        return;
      }
    }
    setIsSubmitting(true);

    const payload = {
      name: name.trim(),
      alias: alias.trim() || undefined,
      type: 'service',
      service_type: 'icecast_server',
      ffmpeg_build_id: buildId,
      auto_start: autoStart,
      startup_order: Number(startupOrder) || 1,
      startup_delay: Number(startupDelay) || 0,
      watchdog_enabled: watchdogEnabled,
      watchdog_retries: Number(watchdogRetries) || 5,
      log_storage_id: logStorageId ? Number(logStorageId) : null,
      is_shared_with_peers: isSharedWithPeers,
      allow_peer_lease: allowPeerLease,
      config: {
        auto_start: autoStart,
        startup_order: Number(startupOrder) || 1,
        startup_delay: Number(startupDelay) || 0,
        watchdog_enabled: watchdogEnabled,
        watchdog_retries: Number(watchdogRetries) || 5,
        log_storage_id: logStorageId ? Number(logStorageId) : null,
        icecast_config: {
          bind_address: bindAddress,
          port: Number(port),
          http_enabled: httpEnabled,
          ssl_enabled: sslEnabled,
          ssl_port: Number(sslPort),
          source_password: sourcePassword,
          admin_user: adminUser,
          admin_password: adminPassword,
          relay_password: relayPassword,
          hostname,
          location,
          admin_email: adminEmail,
          clients_limit: Number(clientsLimit),
          sources_limit: Number(sourcesLimit),
          burst_size: Number(burstSize),
          mounts
        }
      }
    };

    try {
      await onSubmit(payload);
    } finally {
      setIsSubmitting(false);
    }
  };

  const logStorages = storages.filter((s) => s.type === 'logs');

  return (
    <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col overflow-hidden text-xs text-[var(--text-primary)]">
      {/* ── Scrollable Body with custom scrollbar ── */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-1.5 custom-scrollbar">
        {/* ── Section 1: Identity & Engine ── */}
        <div className="bg-[var(--input-bg)]/35 p-3 rounded-xl border border-[var(--glass-border)] space-y-2.5">
          <div className="flex items-center gap-2 border-b border-[var(--glass-border)] pb-1.5">
            <span className="w-2 h-2 rounded-full bg-brand-lime" />
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-brand-lime">
              1. {t('services.icecast.identityTitle', 'Identidad del Servidor Icecast')}
            </h4>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                {t('services.icecast.serviceName', 'Nombre del Servicio')} *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-brand-lime"
                placeholder="p. ej. Servidor Radio FM"
              />
            </div>

            <AliasField
              value={alias}
              onChange={setAlias}
              label={t('services.icecast.alias', 'Alias / Indicativo')}
              placeholder="e.g. RADIO-LIVE"
              helperText={t('services.icecast.aliasHelp', 'Short identifier for LCD panel and compact badges (max 12 chars)')}
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
              {t('services.icecast.engineBuild', 'Motor Software Icecast')}
            </label>
            <SearchableSelect
              accent="lime"
              wrapLabels
              maxDropdownWidth={420}
              value={buildId ? String(buildId) : ''}
              onChange={(val) => setBuildId(val ? Number(val) : null)}
              buttonClassName="px-2.5 py-1.5"
              options={[
                { value: '', label: t('services.icecast.systemDefault', 'Binario del Sistema Host ($PATH / icecast2)') },
                ...availableBuilds.map((b) => ({
                  value: String(b.id),
                  label: `${b.name} (v${b.version_tag || 'custom'})${b.is_default ? ` [${t('common.default', 'Default')}]` : ''}`,
                })),
              ]}
            />
            <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">
              {t('services.icecast.engineHint', 'Si no seleccionas un build de la Forja, el panel utilizará automáticamente el binario instalado en el sistema.')}
            </p>
          </div>
        </div>

        {/* ── Section 2: Network Ports & TLS/SSL ── */}
        <div className="bg-[var(--input-bg)]/35 p-3 rounded-xl border border-[var(--glass-border)] space-y-2.5">
          <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-1.5">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan-400" />
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-cyan-400">
                2. {t('services.icecast.networkTitle', 'Red y Puertos de Escucha (TCP 7XXX)')}
              </h4>
            </div>

            <label className="flex items-center gap-1.5 cursor-pointer">
              <span className="text-[11px] text-[var(--text-secondary)] font-semibold uppercase">
                {t('services.icecast.enableSsl', 'Habilitar TLS / SSL')}
              </span>
              <input
                type="checkbox"
                checked={sslEnabled}
                onChange={(e) => setSslEnabled(e.target.checked)}
                className="accent-brand-lime w-3.5 h-3.5 cursor-pointer"
              />
            </label>
          </div>

          <div className="p-3 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg">
            <NetworkInterfaceSelector
              value={bindAddress}
              onChange={setBindAddress}
              label={t('services.icecast.listenInterface', 'Server Network Listen Interface')}
              API={API}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <div className={`p-2.5 rounded-lg border ${httpEnabled ? 'border-[var(--glass-border)] bg-[var(--input-bg)]' : 'border-dashed border-[var(--glass-border)]/50 opacity-60'}`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold uppercase text-[var(--text-primary)]">
                  {t('services.icecast.httpPortLabel', 'Puerto HTTP (Plano / Legacy)')}
                </span>
                <label className="flex items-center gap-1 cursor-pointer text-[10px]">
                  <input
                    type="checkbox"
                    checked={httpEnabled}
                    onChange={(e) => setHttpEnabled(e.target.checked)}
                    className="accent-brand-lime w-3 h-3"
                  />
                  <span className="text-[var(--text-secondary)]">{t('common.enabled', 'Activo')}</span>
                </label>
              </div>
              <input
                type="number"
                disabled={!httpEnabled}
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1 text-xs font-mono focus:outline-none focus:border-brand-lime"
                placeholder="7000"
              />
            </div>

            <div className={`p-2.5 rounded-lg border ${sslEnabled ? 'border-brand-lime/40 bg-brand-lime/5' : 'border-dashed border-[var(--glass-border)]/50 opacity-60'}`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold uppercase text-[var(--text-primary)] flex items-center gap-1">
                  <ShieldIcon size={12} className="text-brand-lime" />
                  {t('services.icecast.sslPortLabel', 'Puerto HTTPS / TLS (Seguro)')}
                </span>
                <span className="text-[10px] text-brand-lime font-mono">
                  {hasCertificates ? '✓ Cert Detectado' : 'Requiere SSL'}
                </span>
              </div>
              <input
                type="number"
                disabled={!sslEnabled}
                value={sslPort}
                onChange={(e) => setSslPort(Number(e.target.value))}
                className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1 text-xs font-mono focus:outline-none focus:border-brand-lime"
                placeholder="7443"
              />
            </div>
          </div>

          {sslEnabled && hasCertificates && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[11px] p-2 rounded-lg flex items-center gap-2">
              <ShieldIcon size={14} className="text-emerald-400 shrink-0" />
              <span>
                {t('services.icecast.certDetectedValid', 'Certificado SSL del sistema detectado y activo')}{sslDomain ? ` (${sslDomain})` : ''}. {t('services.icecast.bundleAutoReady', 'El servidor generará automáticamente el bundle PEM concatenado al iniciar el servicio.')}
              </span>
            </div>
          )}

          {sslEnabled && !hasCertificates && (
            <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] p-2 rounded-lg flex items-center gap-2">
              <span>⚠️</span>
              <span>{t('services.icecast.noCertWarning', 'Aviso: No se detectó un certificado SSL en Ajustes → Certificados. El servidor generará un bundle una vez que configures tus certificados SSL en el panel.')}</span>
            </div>
          )}
        </div>

        {/* ── Section 3: Credentials & Access Control ── */}
        <div className="bg-[var(--input-bg)]/35 p-3 rounded-xl border border-[var(--glass-border)] space-y-2.5">
          <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-1.5">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
                3. {t('services.icecast.securityTitle', 'Seguridad y Contraseñas de Emisión')}
              </h4>
            </div>

            <button
              type="button"
              onClick={() => setShowPasswords(!showPasswords)}
              className="text-[11px] text-[var(--text-secondary)] hover:text-brand-lime transition-colors cursor-pointer"
            >
              {showPasswords ? t('common.hide', 'Ocultar contraseñas') : t('common.show', 'Mostrar contraseñas')}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                {t('services.icecast.sourcePassword', 'Source Password')} *
              </label>
              <input
                type={showPasswords ? 'text' : 'password'}
                required
                value={sourcePassword}
                onChange={(e) => setSourcePassword(e.target.value)}
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:border-brand-lime"
                placeholder="hackme"
              />
              <span className="text-[10px] text-[var(--text-secondary)] leading-tight block mt-0.5">
                {t('services.icecast.sourcePassHelp', 'Para inyección desde FFmpeg, Butt, Mixxx.')}
              </span>
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                {t('services.icecast.relayPassword', 'Relay Password')}
              </label>
              <input
                type={showPasswords ? 'text' : 'password'}
                value={relayPassword}
                onChange={(e) => setRelayPassword(e.target.value)}
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:border-brand-lime"
                placeholder="hackme"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                {t('services.icecast.adminUser', 'Admin Web User')}
              </label>
              <input
                type="text"
                required
                value={adminUser}
                onChange={(e) => setAdminUser(e.target.value)}
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-brand-lime"
                placeholder="admin"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                {t('services.icecast.adminPassword', 'Admin Web Password')} *
              </label>
              <input
                type={showPasswords ? 'text' : 'password'}
                required
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:border-brand-lime"
                placeholder="hackme"
              />
            </div>
          </div>
        </div>

        {/* ── Section 4: Mountpoints CRUD ── */}
        <div className="bg-[var(--input-bg)]/35 p-3 rounded-xl border border-[var(--glass-border)] space-y-2.5">
          <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-1.5">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-purple-400" />
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-purple-400">
                4. {t('services.icecast.mountsTitle', 'Puntos de Montaje (Mountpoints)')}
              </h4>
            </div>

            <button
              type="button"
              onClick={handleOpenAddMount}
              className="flex items-center gap-1 px-2.5 py-1 bg-brand-lime/10 border border-brand-lime/30 text-brand-lime rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-brand-lime/20 transition-colors cursor-pointer"
            >
              <PlusIcon size={12} />
              <span>{t('services.icecast.addMount', 'Añadir Montaje')}</span>
            </button>
          </div>

          {mounts.length === 0 ? (
            <div className="text-center py-4 text-[var(--text-secondary)] text-[11px] border border-dashed border-[var(--glass-border)] rounded-lg">
              {t('services.icecast.noMounts', 'No hay puntos de montaje estáticos. Los emisores podrán crear montajes al vuelo con la contraseña de source.')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[var(--glass-border)] text-[11px] text-[var(--text-secondary)] uppercase">
                    <th className="py-1.5 px-2.5 font-semibold">{t('services.icecast.mountNameCol', 'Punto de Montaje')}</th>
                    <th className="py-1.5 px-2.5 font-semibold">{t('services.icecast.maxListenersCol', 'Max Oyentes')}</th>
                    <th className="py-1.5 px-2.5 font-semibold">{t('services.icecast.fallbackCol', 'Fallback de Respaldo')}</th>
                    <th className="py-1.5 px-2.5 font-semibold">{t('services.icecast.burstCol', 'Burst (Búfer)')}</th>
                    <th className="py-1.5 px-2.5 text-right font-semibold">{t('common.actions', 'Acciones')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--glass-border)]">
                  {mounts.map((m, idx) => (
                    <tr key={idx} className="hover:bg-[var(--bg-card)]/50 transition-colors text-xs">
                      <td className="py-1.5 px-2.5 font-mono font-bold text-brand-lime">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span>{m.mount_name}</span>
                          {m.relay_enabled && m.relay_url && (
                            <>
                              <span
                                className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 font-sans font-bold"
                                title={m.relay_url}
                              >
                                {m.relay_mode === 'peer' ? 'PEER RELAY' : 'RELAY'}
                              </span>
                              {(m.relay_password || m.relay_username) && (
                                <span
                                  className="text-[10px]"
                                  title={t('services.icecast.relayAuthTitle', 'Autenticación Remota (Opcional)')}
                                >
                                  🔒
                                </span>
                              )}
                            </>
                          )}
                        </div>
                        {m.relay_enabled && m.relay_url && (
                          <div className="text-[10px] font-normal text-[var(--text-secondary)] truncate max-w-[220px]" title={m.relay_url}>
                            ← {m.relay_url}
                          </div>
                        )}
                      </td>
                      <td className="py-1.5 px-2.5 text-[var(--text-secondary)]">
                        {m.max_listeners ? `${m.max_listeners} oyentes` : 'Ilimitado'}
                      </td>
                      <td className="py-1.5 px-2.5 text-[var(--text-secondary)] font-mono">
                        {m.fallback_mount ? (
                          <span className="text-amber-300">↳ {m.fallback_mount}</span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="py-1.5 px-2.5 text-[var(--text-secondary)]">
                        {m.burst_size ? `${Math.round(m.burst_size / 1024)} KB` : '-'}
                      </td>
                      <td className="py-1.5 px-2.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenEditMount(idx)}
                            className="text-[var(--text-secondary)] hover:text-brand-lime p-1 cursor-pointer"
                            title="Editar"
                          >
                            <PencilIcon size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteMount(idx)}
                            className="text-[var(--text-secondary)] hover:text-red-400 p-1 cursor-pointer"
                            title="Eliminar"
                          >
                            <TrashIcon size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Section 5: Station Metadata ── */}
        <div className="bg-[var(--input-bg)]/35 p-3 rounded-xl border border-[var(--glass-border)] space-y-2.5">
          <div className="flex items-center gap-2 border-b border-[var(--glass-border)] pb-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-400" />
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-blue-400">
              5. {t('services.icecast.metaTitle', 'Metadatos de Estación y Límites Globales')}
            </h4>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                {t('services.icecast.hostname', 'Hostname')}
              </label>
              <input
                type="text"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-brand-lime"
                placeholder="127.0.0.1"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                {t('services.icecast.location', 'Ubicación')}
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-brand-lime"
                placeholder="Estudio Central"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                {t('services.icecast.adminEmail', 'Email de Contacto')}
              </label>
              <input
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-brand-lime"
                placeholder="contacto@estacion.com"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-1">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                {t('services.icecast.clientsLimit', 'Límite Máximo de Oyentes')}
              </label>
              <input
                type="number"
                value={clientsLimit}
                onChange={(e) => setClientsLimit(Number(e.target.value))}
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-brand-lime"
                placeholder="100"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                {t('services.icecast.sourcesLimit', 'Límite Canales Emisores')}
              </label>
              <input
                type="number"
                value={sourcesLimit}
                onChange={(e) => setSourcesLimit(Number(e.target.value))}
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-brand-lime"
                placeholder="10"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                {t('services.icecast.burstSize', 'Búfer de Arranque (Bytes)')}
              </label>
              <input
                type="number"
                value={burstSize}
                onChange={(e) => setBurstSize(Number(e.target.value))}
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-brand-lime"
                placeholder="65536"
              />
            </div>
          </div>
        </div>

        {/* ── Section 6: Dedicated Log Storage Volume ── */}
        <div className="bg-[var(--input-bg)]/35 p-3 rounded-xl border border-[var(--glass-border)] space-y-2.5">
          <div className="flex items-center gap-2 border-b border-[var(--glass-border)] pb-1.5">
            <span className="w-2 h-2 rounded-full bg-orange-400" />
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-orange-400">
              6. {t('services.icecast.logStorageTitle', 'Almacenamiento de Registros (Logs)')}
            </h4>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
              {t('services.icecast.logStorage', 'Volumen de Almacenamiento de Logs')}
            </label>
            <SearchableSelect
              accent="lime"
              wrapLabels
              maxDropdownWidth={420}
              value={logStorageId ? String(logStorageId) : ''}
              onChange={(val) => setLogStorageId(val ? Number(val) : null)}
              buttonClassName="px-2.5 py-1.5"
              options={[
                { value: '', label: t('common.default', 'Por Defecto (Volumen de Logs del Sistema)') },
                ...logStorages.map((s) => ({
                  value: String(s.id),
                  label: `${s.name} (${s.path})${s.is_default ? ` [${t('common.default', 'Default')}]` : ''}`,
                })),
              ]}
            />
            <span className="text-[10px] text-[var(--text-secondary)] mt-1 block">
              {t('services.icecast.logStorageDesc', 'Almacena los ficheros access.log, error.log y stdout/stderr de Icecast con rotación automática.')}
            </span>
          </div>
        </div>

        {/* ── Section 7: Lifecycle & Autostart ── */}
        <div className="bg-[var(--input-bg)]/35 p-3 rounded-xl border border-[var(--glass-border)] space-y-2.5">
          <div className="flex items-center gap-2 border-b border-[var(--glass-border)] pb-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
              7. {t('services.icecast.lifecycleTitle', 'Ciclo de Vida y Auto-Arranque')}
            </h4>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-5 flex-wrap">
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

            <div className="flex items-center gap-3 flex-wrap">
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
                  className="w-14 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded px-2 py-1 text-xs text-center font-mono focus:border-brand-lime outline-none"
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
                  className="w-14 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded px-2 py-1 text-xs text-center font-mono focus:border-brand-lime outline-none"
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
                  className="w-14 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded px-2 py-1 text-xs text-center font-mono focus:border-brand-lime outline-none"
                  title="-1 para reintentos infinitos"
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── Section 8: Peer Federation & Remote Sharing ── */}
        <div className="bg-[var(--input-bg)]/35 p-3 rounded-xl border border-[var(--glass-border)] space-y-2.5">
          <div className="flex items-center gap-2 border-b border-[var(--glass-border)] pb-1.5">
            <span className="w-2 h-2 rounded-full bg-cyan-400" />
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-cyan-400">
              8. {t('services.federation.title', 'Federación y Compartición con Peers')}
            </h4>
          </div>

          <div className="space-y-3 text-xs">
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isSharedWithPeers}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setIsSharedWithPeers(checked);
                  if (!checked) {
                    setAllowPeerLease(false);
                  }
                }}
                className="mt-0.5 rounded text-cyan-400 cursor-pointer"
              />
              <div>
                <span className="font-bold uppercase tracking-wide text-xs block text-[var(--text-primary)]">
                  {t('services.federation.shareWithPeers', 'Compartir con Peers Remotos')}
                </span>
                <span className="text-[11px] text-[var(--text-secondary)]">
                  {t('services.federation.shareWithPeersHelp', 'Expone este servidor Icecast en el catálogo federado para que peers autorizados puedan descubrirlo y emitir hacia sus puntos de montaje.')}
                </span>
              </div>
            </label>

            <label
              className={`flex items-start gap-2.5 select-none transition-opacity ${
                !isSharedWithPeers ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
              }`}
            >
              <input
                type="checkbox"
                disabled={!isSharedWithPeers}
                checked={isSharedWithPeers && allowPeerLease}
                onChange={(e) => setAllowPeerLease(e.target.checked)}
                className="mt-0.5 rounded text-cyan-400 disabled:cursor-not-allowed"
              />
              <div>
                <span className="font-bold uppercase tracking-wide text-xs block text-[var(--text-primary)]">
                  {t('services.federation.allowPeerLease', 'Permitir Arrendamiento Remoto (Auto-arranque y Keep-alive)')}
                </span>
                <span className="text-[11px] text-[var(--text-secondary)]">
                  {t('services.federation.allowPeerLeaseHelp', 'Permite que procesos en peers remotos arranquen y mantengan activo este servidor Icecast automáticamente al emitir.')}
                </span>
              </div>
            </label>
          </div>
        </div>
      </div>

      {/* ── Fixed/Sticky Action Footer ── */}
      <div className="flex-shrink-0 flex items-center justify-end gap-2.5 pt-3 mt-1 border-t border-[var(--glass-border)] bg-[var(--bg-card)]/50">
        <button
          type="button"
          onClick={onCancel}
          className="px-3.5 py-1.5 rounded-lg border border-[var(--glass-border)] text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)] transition-colors cursor-pointer"
        >
          {t('common.cancel', 'Cancelar')}
        </button>

        <button
          type="submit"
          disabled={
            isSubmitting ||
            Boolean(alias && alias.trim() && (alias.trim().length > 12 || !/^[a-zA-Z0-9\s-_]+$/.test(alias.trim())))
          }
          className="px-4 py-1.5 bg-brand-lime text-black rounded-lg text-xs font-bold uppercase tracking-wider hover:brightness-110 active:scale-95 transition-all shadow-md flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
        >
          <CheckIcon size={14} />
          <span>{initialConfig ? t('common.saveChanges', 'Guardar Cambios') : t('services.createService', 'Crear Servidor')}</span>
        </button>
      </div>

      {/* ── Inline Mountpoint Modal ── */}
      {mountModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto custom-scrollbar p-4 space-y-3 shadow-2xl">
            <h4 className="text-xs font-bold uppercase text-brand-lime tracking-wide">
              {editingMountIndex !== null ? t('services.icecast.editMount', 'Editar Punto de Montaje') : t('services.icecast.addMount', 'Añadir Punto de Montaje')}
            </h4>

            <div>
              <label className="block text-[11px] font-semibold uppercase text-[var(--text-secondary)] mb-1">
                {t('services.icecast.mountName', 'Nombre de Montaje')} *
              </label>
              <input
                type="text"
                required
                value={mountForm.mount_name}
                onChange={(e) => {
                  const nextMount = e.target.value;
                  const normNext = normalizeMountPath(nextMount);
                  const normFb = normalizeMountPath(mountForm.fallback_mount);
                  setMountForm({
                    ...mountForm,
                    mount_name: nextMount,
                    fallback_mount: normNext && normFb === normNext ? '' : mountForm.fallback_mount,
                  });
                }}
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:border-brand-lime"
                placeholder="/live.mp3"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-semibold uppercase text-[var(--text-secondary)] mb-1">
                  {t('services.icecast.maxListeners', 'Max Oyentes')}
                </label>
                <input
                  type="number"
                  value={mountForm.max_listeners || ''}
                  onChange={(e) => setMountForm({ ...mountForm, max_listeners: e.target.value ? Number(e.target.value) : undefined })}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-brand-lime"
                  placeholder="Ilimitado"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase text-[var(--text-secondary)] mb-1">
                  {t('services.icecast.burstSizeShort', 'Burst Búfer')}
                </label>
                <input
                  type="number"
                  value={mountForm.burst_size || ''}
                  onChange={(e) => setMountForm({ ...mountForm, burst_size: e.target.value ? Number(e.target.value) : undefined })}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-brand-lime"
                  placeholder="65536"
                />
              </div>
            </div>

            {(() => {
              const fallbackCandidates = getAvailableFallbackMounts(mounts, editingMountIndex, mountForm.mount_name);
              const normSelf = normalizeMountPath(mountForm.mount_name);
              const normCurrentFb = normalizeMountPath(mountForm.fallback_mount);
              const validCurrentFb = normCurrentFb && normCurrentFb !== normSelf ? normCurrentFb : '';
              const showLegacyFb = Boolean(
                validCurrentFb && !fallbackCandidates.some((m) => m.mount_name === validCurrentFb)
              );

              if (fallbackCandidates.length === 0 && !showLegacyFb) {
                return null;
              }

              const fallbackOptions = [
                { value: '', label: t('services.icecast.fallbackNone', 'Sin fallback (Ninguno)') },
                ...fallbackCandidates.map((m) => ({
                  value: m.mount_name,
                  label: m.relay_enabled ? `${m.mount_name} (Relay)` : m.mount_name,
                })),
                ...(showLegacyFb
                  ? [{ value: validCurrentFb, label: `${validCurrentFb} (${t('services.icecast.fallbackLegacy', 'Personalizado')})` }]
                  : []),
              ];

              return (
                <div className="space-y-2">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase text-[var(--text-secondary)] mb-1">
                      {t('services.icecast.fallbackMount', 'Montaje Fallback (Respaldo en Caída)')}
                    </label>
                    <SearchableSelect
                      value={validCurrentFb}
                      onChange={(val) => setMountForm({ ...mountForm, fallback_mount: val })}
                      options={fallbackOptions}
                      accent="lime"
                      buttonClassName="!px-2.5 !py-1.5 !text-xs font-mono"
                    />
                  </div>

                  {Boolean(validCurrentFb) && (
                    <div className="flex items-center gap-2 pt-0.5">
                      <input
                        type="checkbox"
                        id="fallback_override"
                        checked={mountForm.fallback_override !== false}
                        onChange={(e) => setMountForm({ ...mountForm, fallback_override: e.target.checked })}
                        className="accent-brand-lime w-3.5 h-3.5"
                      />
                      <label htmlFor="fallback_override" className="text-[11px] text-[var(--text-secondary)] cursor-pointer">
                        {t('services.icecast.fallbackOverride', 'Reconectar automáticamente al montaje principal al recuperarse')}
                      </label>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Remote Icecast2 Relay Pull */}
            <div className="p-2.5 rounded-lg bg-[var(--input-bg)]/60 border border-[var(--glass-border)] space-y-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  id="relay_enabled"
                  checked={Boolean(mountForm.relay_enabled)}
                  onChange={(e) => setMountForm({ ...mountForm, relay_enabled: e.target.checked })}
                  className="accent-cyan-400 w-3.5 h-3.5"
                />
                <span className="text-[11px] font-bold uppercase tracking-wide text-cyan-400">
                  {t('services.icecast.relayEnabled', 'Alimentar desde Relay Remoto')}
                </span>
              </label>

              {mountForm.relay_enabled && (() => {
                const selectedPeerEntry =
                  peersWithIcecast.find((e: any) => e.peer.id === mountForm.relay_peer_node_id) || peersWithIcecast[0];
                const peerServices = selectedPeerEntry?.services || [];
                const selectedPeerSvc =
                  peerServices.find((s: any) => s.id === mountForm.relay_peer_service_id) || peerServices[0];
                const peerProtos = selectedPeerSvc?.protocols || {};
                const peerMounts: any[] = Array.isArray(peerProtos.mounts) ? peerProtos.mounts : [];
                const peerMountNames = peerMounts.map((pm: any) => (typeof pm === 'string' ? pm : pm.mount_name)).filter(Boolean);
                const usePeerMode = mountForm.relay_mode === 'peer' && peersWithIcecast.length > 0;
                const peerHasSsl = Boolean(peerProtos.ssl_enabled);
                const tlsRequired = peerProtos.http_enabled === false && peerHasSsl;
                const effectiveTls = tlsRequired || Boolean(mountForm.relay_peer_tls && peerHasSsl);

                const applyPeerSelection = (peerObj: any, svcObj: any, mountStr: string, tlsFlag: boolean) => {
                  const prot = svcObj?.protocols || {};
                  const validTls = (prot.http_enabled === false && Boolean(prot.ssl_enabled)) || Boolean(tlsFlag && prot.ssl_enabled);
                  const nextUrl = buildPeerRelayUrl(peerObj, svcObj, mountStr, validTls);
                  setMountForm((prev) => ({
                    ...prev,
                    relay_mode: 'peer',
                    relay_peer_node_id: peerObj.id,
                    relay_peer_service_id: svcObj.id,
                    relay_peer_mount: mountStr,
                    relay_peer_tls: validTls,
                    relay_url: nextUrl,
                  }));
                };

                return (
                  <div className="space-y-2.5 pt-1">
                    {/* Source Mode Switcher: Manual URL vs Federated Peer */}
                    <div className="flex bg-[var(--input-bg)] p-0.5 rounded-lg border border-[var(--glass-border)] text-[11px]">
                      <button
                        type="button"
                        onClick={() => setMountForm({ ...mountForm, relay_mode: 'manual' })}
                        className={`flex-1 py-1 px-2 rounded-md font-bold transition-all cursor-pointer ${
                          !usePeerMode
                            ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 shadow-sm'
                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        {t('services.icecast.relayModeManual', 'URL Manual')}
                      </button>
                      <button
                        type="button"
                        disabled={peersWithIcecast.length === 0}
                        onClick={() => {
                          if (!selectedPeerEntry || !selectedPeerSvc) return;
                          const mName = mountForm.relay_peer_mount || peerMountNames[0] || mountForm.mount_name || '/live.mp3';
                          applyPeerSelection(
                            selectedPeerEntry.peer,
                            selectedPeerSvc,
                            mName,
                            mountForm.relay_peer_node_id ? Boolean(mountForm.relay_peer_tls) : shouldDefaultPeerRelayTls(peerProtos)
                          );
                        }}
                        className={`flex-1 py-1 px-2 rounded-md font-bold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                          usePeerMode
                            ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 shadow-sm'
                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        {t('services.icecast.relayModePeer', 'Peer Federado')}
                        {peersWithIcecast.length === 0 ? ` (${t('services.icecast.relayNoPeers', 'Sin peers')})` : ''}
                      </button>
                    </div>

                    {usePeerMode && selectedPeerEntry && selectedPeerSvc ? (
                      <div className="space-y-2 bg-[var(--bg-card)]/60 p-2 rounded-lg border border-[var(--glass-border)]">
                        <div>
                          <label className="block text-[10px] font-semibold uppercase text-[var(--text-secondary)] mb-1">
                            {t('services.icecast.relayPeerNode', 'Nodo Peer Federado')}
                          </label>
                          <SearchableSelect
                            value={String(selectedPeerEntry.peer.id)}
                            onChange={(val) => {
                              const nextEntry = peersWithIcecast.find((e: any) => String(e.peer.id) === val);
                              if (!nextEntry || !nextEntry.services.length) return;
                              const nextSvc = nextEntry.services[0];
                              const nextProt = nextSvc.protocols || {};
                              const nextMounts = (Array.isArray(nextProt.mounts) ? nextProt.mounts : [])
                                .map((pm: any) => (typeof pm === 'string' ? pm : pm.mount_name))
                                .filter(Boolean);
                              applyPeerSelection(
                                nextEntry.peer,
                                nextSvc,
                                nextMounts[0] || '/live.mp3',
                                shouldDefaultPeerRelayTls(nextProt)
                              );
                            }}
                            options={peersWithIcecast.map((e: any) => ({
                              value: String(e.peer.id),
                              label: `${e.peer.name} (${e.peer.status === 'online' ? `${e.peer.latency_ms || 0}ms` : 'offline'})`,
                            }))}
                            accent="lime"
                            buttonClassName="!px-2 !py-1 !text-xs"
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] font-semibold uppercase text-[var(--text-secondary)] mb-1">
                              {t('services.icecast.relayPeerService', 'Servidor Icecast Remoto')}
                            </label>
                            <SearchableSelect
                              value={String(selectedPeerSvc.id)}
                              onChange={(val) => {
                                const nextSvc = peerServices.find((s: any) => String(s.id) === val);
                                if (!nextSvc) return;
                                const nextProt = nextSvc.protocols || {};
                                const nextMounts = (Array.isArray(nextProt.mounts) ? nextProt.mounts : [])
                                  .map((pm: any) => (typeof pm === 'string' ? pm : pm.mount_name))
                                  .filter(Boolean);
                                applyPeerSelection(
                                  selectedPeerEntry.peer,
                                  nextSvc,
                                  nextMounts[0] || '/live.mp3',
                                  shouldDefaultPeerRelayTls(nextProt)
                                );
                              }}
                              options={peerServices.map((s: any) => ({
                                value: String(s.id),
                                label: `${s.name}${s.alias ? ` [${s.alias}]` : ''}`,
                              }))}
                              accent="lime"
                              buttonClassName="!px-2 !py-1 !text-xs"
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] font-semibold uppercase text-[var(--text-secondary)] mb-1">
                              {t('services.icecast.relayPeerMount', 'Mountpoint Remoto')}
                            </label>
                            {peerMountNames.length > 0 ? (
                              <SearchableSelect
                                value={peerMountNames.includes(mountForm.relay_peer_mount || '') ? (mountForm.relay_peer_mount || '') : '__custom__'}
                                onChange={(val) => {
                                  if (val === '__custom__') {
                                    setMountForm({ ...mountForm, relay_peer_mount: '', relay_url: '' });
                                    return;
                                  }
                                  applyPeerSelection(selectedPeerEntry.peer, selectedPeerSvc, val, effectiveTls);
                                }}
                                options={[
                                  ...peerMounts
                                    .filter((pm: any) => (typeof pm === 'string' ? pm : pm.mount_name))
                                    .map((pm: any) => {
                                      const mName = typeof pm === 'string' ? pm : pm.mount_name;
                                      const isRel = typeof pm === 'object' && Boolean(pm.relay_enabled);
                                      return {
                                        value: mName,
                                        label: isRel ? `${mName} (Relay)` : mName,
                                      };
                                    }),
                                  { value: '__custom__', label: t('common.customPath', 'Custom mountpoint...') },
                                ]}
                                accent="lime"
                                buttonClassName="!px-2 !py-1 !text-xs"
                              />
                            ) : (
                              <input
                                type="text"
                                value={mountForm.relay_peer_mount || ''}
                                onChange={(e) => applyPeerSelection(selectedPeerEntry.peer, selectedPeerSvc, e.target.value, effectiveTls)}
                                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2 py-1 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-cyan-400"
                                placeholder="/live.mp3"
                              />
                            )}
                          </div>
                        </div>

                        {peerMountNames.length > 0 && !peerMountNames.includes(mountForm.relay_peer_mount || '') && (
                          <input
                            type="text"
                            value={mountForm.relay_peer_mount || ''}
                            onChange={(e) => applyPeerSelection(selectedPeerEntry.peer, selectedPeerSvc, e.target.value, effectiveTls)}
                            className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-cyan-400"
                            placeholder="/custom_mount.mp3"
                          />
                        )}

                        {peerHasSsl && (
                          <label className={`flex items-center gap-2 select-none ${tlsRequired ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'}`}>
                            <input
                              type="checkbox"
                              checked={effectiveTls}
                              disabled={tlsRequired}
                              onChange={(e) =>
                                applyPeerSelection(
                                  selectedPeerEntry.peer,
                                  selectedPeerSvc,
                                  mountForm.relay_peer_mount || peerMountNames[0] || '/live.mp3',
                                  e.target.checked
                                )
                              }
                              className="accent-cyan-400 w-3.5 h-3.5 disabled:cursor-not-allowed"
                            />
                            <span className="text-[11px] text-[var(--text-secondary)]">
                              {t('services.icecast.relayPeerUseTls', 'Conectar por HTTPS (TLS)')}
                              {tlsRequired && ` ${t('services.icecast.relayPeerTlsRequired', '(HTTP deshabilitado en el peer)')}`}
                            </span>
                          </label>
                        )}

                        <div className="text-[10px] font-mono text-cyan-400 bg-[var(--input-bg)] px-2 py-1 rounded border border-[var(--glass-border)] truncate" title={mountForm.relay_url}>
                          → {mountForm.relay_url || '-'}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <label className="block text-[10px] font-semibold uppercase text-[var(--text-secondary)] mb-1">
                          {t('services.icecast.relayUrl', 'URL del Stream Icecast Remoto')} *
                        </label>
                        <input
                          type="text"
                          required
                          value={mountForm.relay_url || ''}
                          onChange={(e) => setMountForm({ ...mountForm, relay_url: e.target.value, relay_mode: 'manual' })}
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-cyan-400"
                          placeholder="https://origin.example.com:8000/stream.mp3"
                        />
                      </div>
                    )}

                    {/* Optional Upstream Auth */}
                    <div className="bg-[var(--bg-card)]/60 p-2 rounded-lg border border-[var(--glass-border)] space-y-1.5">
                      <span className="block text-[10px] font-semibold uppercase text-[var(--text-secondary)]">
                        {t('services.icecast.relayAuthTitle', 'Autenticación Remota (Opcional)')}
                      </span>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[9px] font-semibold uppercase text-[var(--text-secondary)] mb-0.5">
                            {t('services.icecast.relayUsernameField', 'Usuario (Opcional)')}
                          </label>
                          <input
                            type="text"
                            value={mountForm.relay_username || ''}
                            onChange={(e) => setMountForm({ ...mountForm, relay_username: e.target.value })}
                            className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2 py-1 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-cyan-400"
                            placeholder={t('services.icecast.relayUsernamePlaceholder', 'relay (por defecto)')}
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-semibold uppercase text-[var(--text-secondary)] mb-0.5">
                            {t('services.icecast.relayPasswordField', 'Contraseña (Opcional)')}
                          </label>
                          <div className="relative">
                            <input
                              type={showRelayPassword ? 'text' : 'password'}
                              value={mountForm.relay_password || ''}
                              onChange={(e) => setMountForm({ ...mountForm, relay_password: e.target.value })}
                              className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg pl-2 pr-7 py-1 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-cyan-400"
                              placeholder="••••••••"
                            />
                            <button
                              type="button"
                              onClick={() => setShowRelayPassword((prev) => !prev)}
                              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                              tabIndex={-1}
                            >
                              {showRelayPassword ? '🙈' : '👁'}
                            </button>
                          </div>
                        </div>
                      </div>
                      <p className="text-[9.5px] text-[var(--text-secondary)] leading-snug">
                        {t('services.icecast.relayAuthHelp', 'Dejar vacío para montajes públicos o nodos federados estándar. Si solo pones contraseña, Icecast2 usa automáticamente el usuario \'relay\'.')}
                      </p>
                    </div>

                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={Boolean(mountForm.relay_on_demand)}
                        onChange={(e) => setMountForm({ ...mountForm, relay_on_demand: e.target.checked })}
                        className="accent-cyan-400 w-3.5 h-3.5"
                      />
                      <span className="text-[11px] text-[var(--text-secondary)]">
                        {t('services.icecast.relayOnDemand', 'Relay bajo demanda (conectar solo cuando haya oyentes activos)')}
                      </span>
                    </label>
                    <p className="text-[10px] text-[var(--text-secondary)] leading-snug">
                      {t('services.icecast.relayDisabledHint', 'Alimentado por relay remoto — no estará disponible como destino para procesos FFmpeg locales (sigue disponible como origen).')}
                    </p>
                  </div>
                );
              })()}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2.5 border-t border-[var(--glass-border)]">
              <button
                type="button"
                onClick={() => setMountModalOpen(false)}
                className="px-3 py-1 rounded-lg border border-[var(--glass-border)] text-xs uppercase font-bold text-[var(--text-secondary)]"
              >
                {t('common.cancel', 'Cancelar')}
              </button>
              <button
                type="button"
                onClick={handleSaveMount}
                disabled={!mountForm.mount_name.trim() || (Boolean(mountForm.relay_enabled) && !mountForm.relay_url?.trim())}
                className="px-3.5 py-1 bg-brand-lime text-black rounded-lg text-xs uppercase font-bold disabled:opacity-50"
              >
                {t('common.save', 'Guardar')}
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
};
