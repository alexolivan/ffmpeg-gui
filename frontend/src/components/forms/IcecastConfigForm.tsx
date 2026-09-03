import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PencilIcon,
  TrashIcon,
  PlusIcon,
  ShieldIcon,
  CheckIcon
} from '../Icons';

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
    source_password: ''
  });

  const [hasCertificates, setHasCertificates] = useState(false);
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
    fetch(`${API}/api/settings/ssl`)
      .then((r) => (r.ok ? r.json() : null))
      .then((sslData) => {
        if (sslData && (sslData.has_certificate || sslData.ssl_enabled)) {
          setHasCertificates(true);
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
    setMountForm({
      mount_name: '',
      max_listeners: undefined,
      fallback_mount: '',
      fallback_override: true,
      burst_size: 65536,
      source_password: ''
    });
    setMountModalOpen(true);
  };

  const handleOpenEditMount = (index: number) => {
    setEditingMountIndex(index);
    setMountForm({ ...mounts[index] });
    setMountModalOpen(true);
  };

  const handleSaveMount = () => {
    let cleanName = mountForm.mount_name.trim();
    if (!cleanName) return;
    if (!cleanName.startsWith('/')) cleanName = '/' + cleanName;

    const updated = {
      ...mountForm,
      mount_name: cleanName,
      fallback_mount: mountForm.fallback_mount?.trim() ? (
        mountForm.fallback_mount.trim().startsWith('/') ? mountForm.fallback_mount.trim() : '/' + mountForm.fallback_mount.trim()
      ) : undefined
    };

    if (editingMountIndex !== null) {
      const next = [...mounts];
      next[editingMountIndex] = updated;
      setMounts(next);
    } else {
      setMounts([...mounts, updated]);
    }
    setMountModalOpen(false);
  };

  const handleDeleteMount = (index: number) => {
    setMounts(mounts.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      config: {
        auto_start: autoStart,
        startup_order: Number(startupOrder) || 1,
        startup_delay: Number(startupDelay) || 0,
        watchdog_enabled: watchdogEnabled,
        watchdog_retries: Number(watchdogRetries) || 5,
        log_storage_id: logStorageId ? Number(logStorageId) : null,
        icecast_config: {
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

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                {t('services.icecast.alias', 'Alias / Indicativo')}
              </label>
              <input
                type="text"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-brand-lime"
                placeholder="p. ej. RadioDirecto"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
              {t('services.icecast.engineBuild', 'Motor Software Icecast')}
            </label>
            <select
              value={buildId || ''}
              onChange={(e) => setBuildId(e.target.value ? Number(e.target.value) : null)}
              className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-brand-lime"
            >
              <option value="">{t('services.icecast.systemDefault', 'Binario del Sistema Host ($PATH / icecast2)')}</option>
              {availableBuilds.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} (v{b.version_tag || 'custom'}) {b.is_default ? `[${t('common.default', 'Default')}]` : ''}
                </option>
              ))}
            </select>
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
                        {m.mount_name}
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
            <select
              value={logStorageId || ''}
              onChange={(e) => setLogStorageId(e.target.value ? Number(e.target.value) : null)}
              className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs focus:border-brand-lime outline-none"
            >
              <option value="">{t('common.default', 'Por Defecto (Volumen de Logs del Sistema)')}</option>
              {logStorages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.path}) {s.is_default ? `[${t('common.default', 'Default')}]` : ''}
                </option>
              ))}
            </select>
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
          disabled={isSubmitting}
          className="px-4 py-1.5 bg-brand-lime text-black rounded-lg text-xs font-bold uppercase tracking-wider hover:brightness-110 active:scale-95 transition-all shadow-md flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
        >
          <CheckIcon size={14} />
          <span>{initialConfig ? t('common.saveChanges', 'Guardar Cambios') : t('services.createService', 'Crear Servidor')}</span>
        </button>
      </div>

      {/* ── Inline Mountpoint Modal ── */}
      {mountModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl w-full max-w-md p-4 space-y-3 shadow-2xl">
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
                onChange={(e) => setMountForm({ ...mountForm, mount_name: e.target.value })}
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

            <div>
              <label className="block text-[11px] font-semibold uppercase text-[var(--text-secondary)] mb-1">
                {t('services.icecast.fallbackMount', 'Montaje Fallback (Respaldo en Caída)')}
              </label>
              <input
                type="text"
                value={mountForm.fallback_mount || ''}
                onChange={(e) => setMountForm({ ...mountForm, fallback_mount: e.target.value })}
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:border-brand-lime"
                placeholder="/backup.mp3"
              />
            </div>

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
                disabled={!mountForm.mount_name.trim()}
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
