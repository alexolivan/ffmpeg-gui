import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n/i18n';
import { ShieldIcon, GearIcon, SlidersIcon, ServerIcon, PencilIcon, TrashIcon, ExportIcon } from '../Icons';
import { AlsaAudioSettingsCard } from './settings/AlsaAudioSettingsCard';
import { BackupRestoreCard } from './settings/BackupRestoreCard';

const STORAGE_TYPES = ['build', 'media', 'hls', 'logs', 'sdk', 'preview'] as const;

const THEME_OPTIONS = [
  {
    key: 'studio-dark',
    nameKey: 'settings.theme.studioDark',
    defaultName: 'Studio Dark',
    mode: 'dark',
    bg: '#050505',
    accent1: '#d4ff5b',
    accent2: '#ff9500',
  },
  {
    key: 'cyberpunk',
    nameKey: 'settings.theme.cyberpunk',
    defaultName: 'Cyberpunk Neon',
    mode: 'dark',
    bg: '#090614',
    accent1: '#00f0ff',
    accent2: '#ff007f',
  },
  {
    key: 'nordic-frost',
    nameKey: 'settings.theme.nordicFrost',
    defaultName: 'Nordic Frost',
    mode: 'dark',
    bg: '#06111e',
    accent1: '#38bdf8',
    accent2: '#6366f1',
  },
  {
    key: 'broadcast-light',
    nameKey: 'settings.theme.broadcastLight',
    defaultName: 'Broadcast Light',
    mode: 'light',
    bg: '#e2e8f0',
    accent1: '#16a34a',
    accent2: '#ea580c',
  },
  {
    key: 'warm-paper',
    nameKey: 'settings.theme.warmPaper',
    defaultName: 'Warm Paper',
    mode: 'light',
    bg: '#eee8d5',
    accent1: '#059669',
    accent2: '#d97706',
  },
] as const;

const formatGB = (bytes: number): string => {
  if (!bytes) return '0 GB';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1000) {
    return `${(gb / 1024).toFixed(2)} TB`;
  }
  return `${gb.toFixed(2)} GB`;
};

const getProgressBarColorClass = (percent: number): string => {
  if (percent < 75) return 'bg-brand-lime';
  if (percent <= 90) return 'bg-brand-orange';
  return 'bg-red-500';
};

interface SettingsViewProps {
  settings: any;
  onUpdateSettings: (newSettings: any) => Promise<void>;
  handleLogoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  newPassword: string;
  setNewPassword: (val: string) => void;
  confirmPassword: string;
  setConfirmPassword: (val: string) => void;
  passwordError: string;
  setPasswordError: (val: string) => void;
  passwordSuccess: string;
  setPasswordSuccess: (val: string) => void;
  API: string;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onUpdateSettings,
  handleLogoUpload,
  newPassword,
  setNewPassword,
  confirmPassword,
  setConfirmPassword,
  passwordError,
  setPasswordError,
  passwordSuccess,
  setPasswordSuccess,
  API,
}) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'general' | 'lcd' | 'storage' | 'security' | 'alsa' | 'backup'>('general');

  const [storages, setStorages] = useState<any[]>([]);
  const [isLoadingStorages, setIsLoadingStorages] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('media');
  const [newPath, setNewPath] = useState('');
  const [addValidationError, setAddValidationError] = useState('');
  const [addValidationSuccess, setAddValidationSuccess] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isAddingValidating, setIsAddingValidating] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editPath, setEditPath] = useState('');
  const [editValidationError, setEditValidationError] = useState('');
  const [editValidationSuccess, setEditValidationSuccess] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isEditValidating, setIsEditValidating] = useState(false);

  // SSL & Network States
  const [bindAddress, setBindAddress] = useState(settings?.bind_address || '0.0.0.0');
  const [httpsPort, setHttpsPort] = useState(settings?.https_port || 8443);
  const [sslEnabled, setSslEnabled] = useState(!!settings?.ssl_enabled);
  const [forceHttpsRedirect, setForceHttpsRedirect] = useState(!!settings?.force_https_redirect);
  const [sslMode, setSslMode] = useState(settings?.ssl_mode || 'disabled');
  const [sslDomain, setSslDomain] = useState(settings?.ssl_domain || '');
  const [sslEmail, setSslEmail] = useState(settings?.ssl_email || '');
  const [sslChallengeType, setSslChallengeType] = useState(settings?.ssl_challenge_type || 'http-01');

  const [sslStatus, setSslStatus] = useState<any>(null);
  const [isUploadingSsl, setIsUploadingSsl] = useState(false);
  const [sslUploadError, setSslUploadError] = useState('');
  const [sslUploadSuccess, setSslUploadSuccess] = useState('');
  const [certFile, setCertFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [isRenewingSsl, setIsRenewingSsl] = useState(false);
  const [sslRenewMessage, setSslRenewMessage] = useState('');

  // Email Notification States
  const [notifEnabled, setNotifEnabled] = useState(!!settings?.notif_enabled);
  const [smtpHost, setSmtpHost] = useState(settings?.smtp_host || '');
  const [smtpPort, setSmtpPort] = useState(settings?.smtp_port || 587);
  const [smtpEncryption, setSmtpEncryption] = useState(settings?.smtp_encryption || 'tls');
  const [smtpUser, setSmtpUser] = useState(settings?.smtp_user || '');
  const [smtpPassword, setSmtpPassword] = useState(settings?.smtp_password || '');
  const [senderEmail, setSenderEmail] = useState(settings?.sender_email || '');
  const [recipientEmail, setRecipientEmail] = useState(settings?.recipient_email || '');
  const [notifyServiceFailures, setNotifyServiceFailures] = useState(settings?.notify_service_failures !== undefined ? !!settings?.notify_service_failures : true);
  const [notifyBuildResults, setNotifyBuildResults] = useState(settings?.notify_build_results !== undefined ? !!settings?.notify_build_results : true);
  const [notifyTaskFailures, setNotifyTaskFailures] = useState(settings?.notify_task_failures !== undefined ? !!settings?.notify_task_failures : true);
  const [notifySslAlerts, setNotifySslAlerts] = useState(settings?.notify_ssl_alerts !== undefined ? !!settings?.notify_ssl_alerts : true);
  const [notifyStorageAlerts, setNotifyStorageAlerts] = useState(settings?.notify_storage_alerts !== undefined ? !!settings?.notify_storage_alerts : true);

  const [isTestingNotif, setIsTestingNotif] = useState(false);
  const [notifTestMessage, setNotifTestMessage] = useState('');
  const [notifTestSuccess, setNotifTestSuccess] = useState(false);
  const [showNotifPassword, setShowNotifPassword] = useState(false);

  // Watchdog & Startup Settings States
  const [startupGraceDelay, setStartupGraceDelay] = useState(settings?.watchdog?.startup_grace_delay ?? 10);
  const [networkWaitTimeout, setNetworkWaitTimeout] = useState(settings?.watchdog?.network_wait_timeout ?? 60);
  const [watchdogMaxBackoff, setWatchdogMaxBackoff] = useState(settings?.watchdog?.watchdog_max_backoff ?? 30);

  useEffect(() => {
    setBindAddress(settings?.bind_address || '0.0.0.0');
    setGuiPort(settings?.gui_port || settings?.http_port || 8000);
    setHttpsPort(settings?.https_port || 8443);
    setSslEnabled(!!settings?.ssl_enabled);
    setForceHttpsRedirect(!!settings?.force_https_redirect);
    setSslMode(settings?.ssl_mode || 'disabled');
    setSslDomain(settings?.ssl_domain || '');
    setSslEmail(settings?.ssl_email || '');
    setSslChallengeType(settings?.ssl_challenge_type || 'http-01');
    const notif = settings?.notifications;
    setNotifEnabled(!!notif?.enabled);
    setSmtpHost(notif?.smtp_host || '');
    setSmtpPort(notif?.smtp_port || 587);
    setSmtpEncryption(notif?.smtp_encryption || 'tls');
    setSmtpUser(notif?.smtp_user || '');
    setSmtpPassword(notif?.smtp_password || '');
    setSenderEmail(notif?.sender_email || '');
    setRecipientEmail(notif?.recipient_email || '');
    setNotifyServiceFailures(notif?.notify_service_failures !== undefined ? !!notif?.notify_service_failures : true);
    setNotifyBuildResults(notif?.notify_build_results !== undefined ? !!notif?.notify_build_results : true);
    setNotifyTaskFailures(notif?.notify_task_failures !== undefined ? !!notif?.notify_task_failures : true);
    setNotifySslAlerts(notif?.notify_ssl_alerts !== undefined ? !!notif?.notify_ssl_alerts : true);
    setNotifyStorageAlerts(notif?.notify_storage_alerts !== undefined ? !!notif?.notify_storage_alerts : true);
    const wd = settings?.watchdog;
    setStartupGraceDelay(wd?.startup_grace_delay ?? 10);
    setNetworkWaitTimeout(wd?.network_wait_timeout ?? 60);
    setWatchdogMaxBackoff(wd?.watchdog_max_backoff ?? 30);
  }, [
    settings?.bind_address,
    settings?.gui_port,
    settings?.http_port,
    settings?.https_port,
    settings?.ssl_enabled,
    settings?.force_https_redirect,
    settings?.ssl_mode,
    settings?.ssl_domain,
    settings?.ssl_email,
    settings?.ssl_challenge_type,
    settings?.notifications?.enabled,
    settings?.notifications?.smtp_host,
    settings?.notifications?.smtp_port,
    settings?.notifications?.smtp_encryption,
    settings?.notifications?.smtp_user,
    settings?.notifications?.smtp_password,
    settings?.notifications?.sender_email,
    settings?.notifications?.recipient_email,
    settings?.notifications?.notify_service_failures,
    settings?.notifications?.notify_build_results,
    settings?.notifications?.notify_task_failures,
    settings?.notifications?.notify_ssl_alerts,
    settings?.notifications?.notify_storage_alerts,
    settings?.watchdog?.startup_grace_delay,
    settings?.watchdog?.network_wait_timeout,
    settings?.watchdog?.watchdog_max_backoff,
  ]);

  const fetchSslStatus = async () => {
    try {
      const res = await fetch(`${API}/api/settings/ssl/status`);
      if (res.ok) {
        const data = await res.json();
        setSslStatus(data);
      }
    } catch (err) {
      console.error('Error fetching SSL status:', err);
    }
  };

  const handleUploadCustomSsl = async () => {
    if (!certFile || !keyFile) {
      setSslUploadError('Please select both certificate file (.pem/.crt) and private key file (.key)');
      return;
    }
    setIsUploadingSsl(true);
    setSslUploadError('');
    setSslUploadSuccess('');
    try {
      const formData = new FormData();
      formData.append('cert_file', certFile);
      formData.append('key_file', keyFile);

      const res = await fetch(`${API}/api/settings/ssl/upload-custom`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        setSslUploadSuccess('✓ Custom SSL Certificate & Private Key validated and saved successfully.');
        setSslStatus(data.status);
        setCertFile(null);
        setKeyFile(null);
      } else {
        setSslUploadError(`⚠️ ${data.detail || 'Validation failed'}`);
      }
    } catch (err) {
      setSslUploadError('⚠️ Failed to upload custom SSL files');
    } finally {
      setIsUploadingSsl(false);
    }
  };

  const handleRenewSsl = async () => {
    const domainToRenew = sslDomain || settings?.ssl_domain || '';
    const emailToRenew = sslEmail || settings?.ssl_email || '';

    if (!domainToRenew || domainToRenew === 'localhost') {
      setSslRenewMessage('⚠️ Please enter a valid public Domain Name (FQDN) above first.');
      return;
    }
    if (!emailToRenew) {
      setSslRenewMessage('⚠️ Please enter an ACME Contact Email above first.');
      return;
    }

    setIsRenewingSsl(true);
    setSslRenewMessage('');
    try {
      const res = await fetch(`${API}/api/settings/ssl/renew`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: domainToRenew,
          email: emailToRenew,
          challenge_type: sslChallengeType || settings?.ssl_challenge_type || 'http-01'
        })
      });
      const data = await res.json();
      if (res.ok) {
        setSslRenewMessage(`✓ ${data.message || 'Certificate renewed successfully.'}`);
        setSslStatus(data.status);
      } else {
        setSslRenewMessage(`⚠️ ${data.detail || 'Renewal failed'}`);
      }
    } catch (err) {
      setSslRenewMessage('⚠️ Renewal request failed');
    } finally {
      setIsRenewingSsl(false);
    }
  };

  const handleTestEmail = async () => {
    setIsTestingNotif(true);
    setNotifTestMessage('');
    setNotifTestSuccess(false);
    try {
      const res = await fetch(`${API}/api/notifications/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          smtp_host: smtpHost,
          smtp_port: Number(smtpPort),
          smtp_encryption: smtpEncryption,
          smtp_user: smtpUser,
          smtp_password: smtpPassword,
          sender_email: senderEmail,
          recipient_email: recipientEmail,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setNotifTestSuccess(true);
        setNotifTestMessage(`✓ ${data.message || 'Test email sent successfully.'}`);
      } else {
        setNotifTestSuccess(false);
        setNotifTestMessage(`⚠️ ${data.detail || 'Failed to send test email.'}`);
      }
    } catch (err) {
      setNotifTestSuccess(false);
      setNotifTestMessage('⚠️ Error connecting to backend notification endpoint.');
    } finally {
      setIsTestingNotif(false);
    }
  };

  const fetchStorages = async () => {
    setIsLoadingStorages(true);
    try {
      const res = await fetch(`${API}/settings/storages`);
      if (res.ok) {
        const data = await res.json();
        setStorages(data || []);
      }
    } catch (err) {
      console.error('Error fetching storages:', err);
    } finally {
      setIsLoadingStorages(false);
    }
  };

  useEffect(() => {
    fetchStorages();
    fetchSslStatus();
  }, [API]);

  const handleValidatePath = async (path: string, isEdit: boolean) => {
    if (isEdit) {
      setIsEditValidating(true);
      setEditValidationError('');
      setEditValidationSuccess('');
    } else {
      setIsAddingValidating(true);
      setAddValidationError('');
      setAddValidationSuccess('');
    }

    try {
      const res = await fetch(`${API}/settings/storages/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      const data = await res.json();
      if (res.ok) {
        if (isEdit) {
          setEditValidationSuccess('✓ Path is valid and writeable');
        } else {
          setAddValidationSuccess('✓ Path is valid and writeable');
        }
      } else {
        const errMsg = data.detail || 'Validation failed';
        if (isEdit) {
          setEditValidationError(`⚠️ ${errMsg}`);
        } else {
          setAddValidationError(`⚠️ ${errMsg}`);
        }
      }
    } catch (err) {
      console.error(err);
      if (isEdit) {
        setEditValidationError('⚠️ Failed to contact validation server');
      } else {
        setAddValidationError('⚠️ Failed to contact validation server');
      }
    } finally {
      if (isEdit) {
        setIsEditValidating(false);
      } else {
        setIsAddingValidating(false);
      }
    }
  };

  const handleDeleteStorage = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this storage configuration?')) {
      return;
    }
    try {
      const res = await fetch(`${API}/settings/storages/${id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok) {
        alert('Storage configuration deleted successfully.');
        fetchStorages();
      } else {
        alert(`Failed to delete storage: ${data.detail || 'Unknown error'}`);
      }
    } catch (err) {
      console.error(err);
      alert('An error occurred while deleting storage.');
    }
  };

  const handleSaveEdit = async (id: number) => {
    if (!editName.trim() || !editPath.trim()) {
      setEditValidationError('⚠️ Name and Path are required');
      return;
    }
    setIsSavingEdit(true);
    setEditValidationError('');
    setEditValidationSuccess('');
    try {
      const res = await fetch(`${API}/settings/storages/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, path: editPath }),
      });
      const data = await res.json();
      if (res.ok) {
        setEditingId(null);
        fetchStorages();
      } else {
        setEditValidationError(`⚠️ ${data.detail || 'Failed to update storage'}`);
      }
    } catch (err) {
      console.error(err);
      setEditValidationError('⚠️ Error updating storage');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleAddStorage = async () => {
    if (!newName.trim() || !newPath.trim()) {
      setAddValidationError('⚠️ Name and Path are required');
      return;
    }
    setIsAdding(true);
    setAddValidationError('');
    setAddValidationSuccess('');
    try {
      const res = await fetch(`${API}/settings/storages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, type: newType, path: newPath }),
      });
      const data = await res.json();
      if (res.ok) {
        setNewName('');
        setNewPath('');
        fetchStorages();
      } else {
        setAddValidationError(`⚠️ ${data.detail || 'Failed to add storage'}`);
      }
    } catch (err) {
      console.error(err);
      setAddValidationError('⚠️ Error adding storage');
    } finally {
      setIsAdding(false);
    }
  };

  const [theme, setTheme] = useState<string>(settings?.theme || localStorage.getItem('app_theme') || 'studio-dark');
  const [language, setLanguage] = useState(settings.language || 'en');
  const [nodeName, setNodeName] = useState(settings.node_name || '');
  const [logoText, setLogoText] = useState(settings.logo_text || '');
  const [lcdAlias, setLcdAlias] = useState(settings.lcd_alias || 'NODE-01');
  const [guiPort, setGuiPort] = useState(settings.gui_port || 8000);
  const [loggingMode, setLoggingMode] = useState(settings.logging_mode || 'journalctl');
  const [loggingStorageId, setLoggingStorageId] = useState<number | ''>(settings.logging_storage_id !== undefined && settings.logging_storage_id !== null ? settings.logging_storage_id : '');
  const [loggingRelativePath, setLoggingRelativePath] = useState(settings.logging_relative_path || 'ffmpeg-gui.log');
  const [loggingRotationEnabled, setLoggingRotationEnabled] = useState<boolean>(settings.logging_rotation_enabled || false);
  const [loggingRotationMaxBytes, setLoggingRotationMaxBytes] = useState<number>(settings.logging_rotation_max_bytes || 10485760);
  const [loggingRotationBackupCount, setLoggingRotationBackupCount] = useState<number>(settings.logging_rotation_backup_count || 5);
  const [loggingCompressionEnabled, setLoggingCompressionEnabled] = useState<boolean>(settings.logging_compression_enabled || false);
  const [loggingRetentionDays, setLoggingRetentionDays] = useState<number>(settings.logging_retention_days || 7);
  const [loggingTimestampTz, setLoggingTimestampTz] = useState<string>(settings.logging_timestamp_tz || 'utc');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);

  useEffect(() => {
    if (settings.theme) {
      setTheme(settings.theme);
    }
    setLanguage(settings.language || 'en');
    setNodeName(settings.node_name || '');
    setLogoText(settings.logo_text || '');
    setLcdAlias(settings.lcd_alias || 'NODE-01');
    setGuiPort(settings.gui_port || 8000);
    setLoggingMode(settings.logging_mode || 'journalctl');
    setLoggingStorageId(settings.logging_storage_id !== undefined && settings.logging_storage_id !== null ? settings.logging_storage_id : '');
    setLoggingRelativePath(settings.logging_relative_path || 'ffmpeg-gui.log');
    setLoggingRotationEnabled(settings.logging_rotation_enabled || false);
    setLoggingRotationMaxBytes(settings.logging_rotation_max_bytes || 10485760);
    setLoggingRotationBackupCount(settings.logging_rotation_backup_count || 5);
    setLoggingCompressionEnabled(settings.logging_compression_enabled || false);
    setLoggingRetentionDays(settings.logging_retention_days || 7);
    setLoggingTimestampTz(settings.logging_timestamp_tz || 'utc');
  }, [
    settings.theme,
    settings.language,
    settings.node_name,
    settings.logo_text,
    settings.lcd_alias,
    settings.gui_port,
    settings.logging_mode,
    settings.logging_storage_id,
    settings.logging_relative_path,
    settings.logging_rotation_enabled,
    settings.logging_rotation_max_bytes,
    settings.logging_rotation_backup_count,
    settings.logging_compression_enabled,
    settings.logging_retention_days,
    settings.logging_timestamp_tz
  ]);

  const handleSelectTheme = (themeKey: string) => {
    setTheme(themeKey);
    document.documentElement.setAttribute('data-theme', themeKey);
    localStorage.setItem('app_theme', themeKey);
  };

  const [lcdEnabled, setLcdEnabled] = useState(settings.lcd_enabled || false);
  const [lcdPort, setLcdPort] = useState(settings.lcd_port || '/dev/ttyACM0');
  const [lcdModel, setLcdModel] = useState(settings.lcd_model || 'cfa635');
  const [lcdBrightness, setLcdBrightness] = useState(settings.lcd_brightness !== undefined && settings.lcd_brightness !== null ? settings.lcd_brightness : 100);
  const [lcdDimBrightness, setLcdDimBrightness] = useState(settings.lcd_dim_brightness !== undefined && settings.lcd_dim_brightness !== null ? settings.lcd_dim_brightness : 20);
  const [lcdDimTimeout, setLcdDimTimeout] = useState(settings.lcd_dim_timeout !== undefined && settings.lcd_dim_timeout !== null ? settings.lcd_dim_timeout : 30);
  const [lcdLed0Profile, setLcdLed0Profile] = useState(settings.lcd_led0_profile || 'heartbeat');
  const [lcdLed1Profile, setLcdLed1Profile] = useState(settings.lcd_led1_profile || 'streams');
  const [lcdLed2Profile, setLcdLed2Profile] = useState(settings.lcd_led2_profile || 'tasks');
  const [lcdLed3Profile, setLcdLed3Profile] = useState(settings.lcd_led3_profile || 'alert');

  const [isProbing, setIsProbing] = useState(false);
  const [probeResults, setProbeResults] = useState<any[]>([]);

  useEffect(() => {
    setLcdEnabled(settings.lcd_enabled || false);
    setLcdPort(settings.lcd_port || '/dev/ttyACM0');
    setLcdModel(settings.lcd_model || 'cfa635');
    setLcdBrightness(settings.lcd_brightness !== undefined && settings.lcd_brightness !== null ? settings.lcd_brightness : 100);
    setLcdDimBrightness(settings.lcd_dim_brightness !== undefined && settings.lcd_dim_brightness !== null ? settings.lcd_dim_brightness : 20);
    setLcdDimTimeout(settings.lcd_dim_timeout !== undefined && settings.lcd_dim_timeout !== null ? settings.lcd_dim_timeout : 30);
    setLcdLed0Profile(settings.lcd_led0_profile || 'heartbeat');
    setLcdLed1Profile(settings.lcd_led1_profile || 'streams');
    setLcdLed2Profile(settings.lcd_led2_profile || 'tasks');
    setLcdLed3Profile(settings.lcd_led3_profile || 'alert');
  }, [
    settings.lcd_enabled,
    settings.lcd_port,
    settings.lcd_model,
    settings.lcd_brightness,
    settings.lcd_dim_brightness,
    settings.lcd_dim_timeout,
    settings.lcd_led0_profile,
    settings.lcd_led1_profile,
    settings.lcd_led2_profile,
    settings.lcd_led3_profile
  ]);

  const handleProbe = async () => {
    setIsProbing(true);
    setProbeResults([]);
    try {
      const res = await fetch(`${API}/settings/lcd/probe`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setProbeResults(data.ports || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsProbing(false);
    }
  };

  // Auto-scan on component mount & reset password fields
  useEffect(() => {
    handleProbe();
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
    setPasswordSuccess('');
  }, []);

  const hasChanges = 
    theme !== (settings.theme || 'studio-dark') ||
    language !== (settings.language || 'en') ||
    nodeName !== (settings.node_name || '') || 
    logoText !== (settings.logo_text || '') ||
    lcdAlias !== (settings.lcd_alias || 'NODE-01') ||
    bindAddress !== (settings.bind_address || '0.0.0.0') ||
    Number(guiPort) !== Number(settings.gui_port || settings.http_port || 8000) ||
    Number(httpsPort) !== Number(settings.https_port || 8443) ||
    sslEnabled !== !!settings.ssl_enabled ||
    forceHttpsRedirect !== !!settings.force_https_redirect ||
    sslMode !== (settings.ssl_mode || 'disabled') ||
    sslDomain !== (settings.ssl_domain || '') ||
    sslEmail !== (settings.ssl_email || '') ||
    sslChallengeType !== (settings.ssl_challenge_type || 'http-01') ||
    lcdEnabled !== (settings.lcd_enabled || false) ||
    lcdPort !== (settings.lcd_port || '/dev/ttyACM0') ||
    lcdModel !== (settings.lcd_model || 'cfa635') ||
    Number(lcdBrightness) !== (settings.lcd_brightness !== undefined && settings.lcd_brightness !== null ? Number(settings.lcd_brightness) : 100) ||
    Number(lcdDimBrightness) !== (settings.lcd_dim_brightness !== undefined && settings.lcd_dim_brightness !== null ? Number(settings.lcd_dim_brightness) : 20) ||
    Number(lcdDimTimeout) !== (settings.lcd_dim_timeout !== undefined && settings.lcd_dim_timeout !== null ? Number(settings.lcd_dim_timeout) : 30) ||
    lcdLed0Profile !== (settings.lcd_led0_profile || 'heartbeat') ||
    lcdLed1Profile !== (settings.lcd_led1_profile || 'streams') ||
    lcdLed2Profile !== (settings.lcd_led2_profile || 'tasks') ||
    lcdLed3Profile !== (settings.lcd_led3_profile || 'alert') ||
    loggingMode !== (settings.logging_mode || 'journalctl') ||
    loggingStorageId !== (settings.logging_storage_id !== undefined && settings.logging_storage_id !== null ? settings.logging_storage_id : '') ||
    loggingRelativePath !== (settings.logging_relative_path || 'ffmpeg-gui.log') ||
    loggingRotationEnabled !== (settings.logging_rotation_enabled || false) ||
    Number(loggingRotationMaxBytes) !== Number(settings.logging_rotation_max_bytes || 10485760) ||
    Number(loggingRotationBackupCount) !== Number(settings.logging_rotation_backup_count || 5) ||
    loggingCompressionEnabled !== (settings.logging_compression_enabled || false) ||
    Number(loggingRetentionDays) !== Number(settings.logging_retention_days || 7) ||
    loggingTimestampTz !== (settings.logging_timestamp_tz || 'utc') ||
    notifEnabled !== !!settings?.notifications?.enabled ||
    smtpHost !== (settings?.notifications?.smtp_host || '') ||
    Number(smtpPort) !== Number(settings?.notifications?.smtp_port || 587) ||
    smtpEncryption !== (settings?.notifications?.smtp_encryption || 'tls') ||
    smtpUser !== (settings?.notifications?.smtp_user || '') ||
    smtpPassword !== (settings?.notifications?.smtp_password || '') ||
    senderEmail !== (settings?.notifications?.sender_email || '') ||
    recipientEmail !== (settings?.notifications?.recipient_email || '') ||
    notifyServiceFailures !== (settings?.notifications?.notify_service_failures !== undefined ? !!settings?.notifications?.notify_service_failures : true) ||
    notifyBuildResults !== (settings?.notifications?.notify_build_results !== undefined ? !!settings?.notifications?.notify_build_results : true) ||
    notifyTaskFailures !== (settings?.notifications?.notify_task_failures !== undefined ? !!settings?.notifications?.notify_task_failures : true) ||
    notifySslAlerts !== (settings?.notifications?.notify_ssl_alerts !== undefined ? !!settings?.notifications?.notify_ssl_alerts : true) ||
    notifyStorageAlerts !== (settings?.notifications?.notify_storage_alerts !== undefined ? !!settings?.notifications?.notify_storage_alerts : true) ||
    Number(startupGraceDelay) !== Number(settings?.watchdog?.startup_grace_delay ?? 10) ||
    Number(networkWaitTimeout) !== Number(settings?.watchdog?.network_wait_timeout ?? 60) ||
    Number(watchdogMaxBackoff) !== Number(settings?.watchdog?.watchdog_max_backoff ?? 30) ||
    newPassword !== '' ||
    confirmPassword !== '';

  const handleSaveAll = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    setPasswordError('');
    setPasswordSuccess('');

    if (newPassword !== '' || confirmPassword !== '') {
      if (newPassword !== confirmPassword) {
        setPasswordError(t('settings.security.passwordMismatch', 'Passwords do not match'));
        setIsSaving(false);
        return;
      }
    }

    try {
      const payload: any = {
        ...settings,
        theme,
        language,
        node_name: nodeName,
        logo_text: logoText,
        lcd_alias: lcdAlias,
        bind_address: bindAddress,
        gui_port: Number(guiPort),
        http_port: Number(guiPort),
        https_port: Number(httpsPort),
        ssl_enabled: sslEnabled,
        force_https_redirect: forceHttpsRedirect,
        ssl_mode: sslMode,
        ssl_domain: sslDomain,
        ssl_email: sslEmail,
        ssl_challenge_type: sslChallengeType,
        lcd_enabled: lcdEnabled,
        lcd_port: lcdPort,
        lcd_model: lcdModel,
        lcd_brightness: Number(lcdBrightness),
        lcd_dim_brightness: Number(lcdDimBrightness),
        lcd_dim_timeout: Number(lcdDimTimeout),
        lcd_led0_profile: lcdLed0Profile,
        lcd_led1_profile: lcdLed1Profile,
        lcd_led2_profile: lcdLed2Profile,
        lcd_led3_profile: lcdLed3Profile,
        logging_mode: loggingMode,
        logging_storage_id: loggingStorageId === '' ? null : Number(loggingStorageId),
        logging_relative_path: loggingRelativePath,
        logging_rotation_enabled: loggingRotationEnabled,
        logging_rotation_max_bytes: Number(loggingRotationMaxBytes),
        logging_rotation_backup_count: Number(loggingRotationBackupCount),
        logging_compression_enabled: loggingCompressionEnabled,
        logging_retention_days: Number(loggingRetentionDays),
        logging_timestamp_tz: loggingTimestampTz,
        notifications: {
          enabled: notifEnabled,
          smtp_host: smtpHost,
          smtp_port: Number(smtpPort),
          smtp_encryption: smtpEncryption,
          smtp_user: smtpUser,
          smtp_password: smtpPassword,
          sender_email: senderEmail,
          recipient_email: recipientEmail,
          notify_service_failures: notifyServiceFailures,
          notify_build_results: notifyBuildResults,
          notify_task_failures: notifyTaskFailures,
          notify_ssl_alerts: notifySslAlerts,
          notify_storage_alerts: notifyStorageAlerts,
        },
        watchdog: {
          startup_grace_delay: Number(startupGraceDelay),
          network_wait_timeout: Number(networkWaitTimeout),
          watchdog_max_backoff: Number(watchdogMaxBackoff),
        },
      };

      if (newPassword !== '') {
        payload.gui_password = newPassword;
      }

      await onUpdateSettings(payload);
      i18n.changeLanguage(language);
      localStorage.setItem('app_lang', language);
      
      setSaveSuccess(true);
      if (newPassword !== '') {
        setPasswordSuccess(t('settings.security.passwordUpdatedSuccess', 'Password updated successfully'));
      }
      
      setNewPassword('');
      setConfirmPassword('');
      
      setTimeout(() => {
        setSaveSuccess(false);
        setPasswordSuccess('');
      }, 3000);
    } catch (err) {
      console.error(err);
      setPasswordError(t('settings.security.saveSettingsError', 'Error saving settings'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmRestart = async () => {
    setShowRestartConfirm(false);
    setIsRestarting(true);
    try {
      await fetch(`${API}/settings/restart`, { method: 'POST' });
      // Start polling the new port after 3 seconds
      setTimeout(pollNewPort, 3000);
    } catch (err) {
      console.error(err);
      setIsRestarting(false);
      alert(t('settings.restart.failedTrigger', 'Failed to trigger panel restart.'));
    }
  };
  
  const pollNewPort = () => {
    const targetPort = settings.gui_port || 8000;
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    const url = `${protocol}//${hostname}:${targetPort}/settings`;
    
    const interval = setInterval(async () => {
      try {
        const res = await fetch(url);
        if (res.ok) {
          clearInterval(interval);
          // Redirect browser to the new port address
          window.location.href = `${protocol}//${hostname}:${targetPort}/`;
        }
      } catch {
        // Keep polling
      }
    }, 1500);
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl flex flex-col h-[82vh]">
      {/* Header */}
      <header className="flex justify-between items-center mb-6 shrink-0">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-[var(--text-primary)] mb-0.5 uppercase">{t('settings.title', 'Settings')}</h1>
          <p className="text-xs text-text-secondary">{t('settings.subtitle', 'Node identity, security, storage and language configuration')}</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Status Indicator */}
          <div className="text-[10px] text-text-secondary font-medium">
            {saveSuccess ? (
              <span className="text-brand-lime font-bold animate-pulse">✓ {t('settings.settingsSaved', 'Settings saved.')}</span>
            ) : passwordError ? (
              <span className="text-red-500 font-bold">⚠️ {t('settings.securityErrors', 'Check Security errors.')}</span>
            ) : hasChanges ? (
              <span className="text-brand-orange font-bold">● {t('settings.unsavedChanges', 'Unsaved changes.')}</span>
            ) : (
              <span className="opacity-40">{t('settings.upToDate', 'Up to date.')}</span>
            )}
          </div>
          <button
            onClick={() => setShowRestartConfirm(true)}
            className="border border-red-500/30 text-red-400 bg-red-500/10 hover:bg-red-500/20 active:scale-95 pill-button font-black text-xs py-2 px-4 transition-all uppercase tracking-widest cursor-pointer"
          >
            {t('settings.restartPanel', 'Restart Panel')}
          </button>
          <button
            onClick={handleSaveAll}
            disabled={isSaving || !hasChanges}
            className={`pill-button font-black text-xs py-2.5 px-6 transition-all uppercase tracking-widest ${
              hasChanges && !isSaving
                ? 'bg-brand-lime text-black hover:scale-[1.02] active:scale-[0.98] cursor-pointer shadow-lg shadow-brand-lime/20'
                : 'bg-[var(--input-bg)] text-text-secondary opacity-40 cursor-not-allowed border border-[var(--glass-border)]'
            }`}
          >
            {isSaving ? t('common.saving', 'Saving...') : t('common.save', 'Save Settings')}
          </button>
        </div>
      </header>

      {/* Tabs selector */}
      <div className="flex items-center gap-1.5 mb-3 shrink-0 border-b border-[var(--glass-border)] pb-2 overflow-x-auto custom-scrollbar flex-nowrap min-w-0">
        <button
          type="button"
          onClick={() => setActiveTab('general')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap shrink-0 ${
            activeTab === 'general'
              ? 'bg-brand-lime/15 text-brand-lime border border-brand-lime/30 shadow-sm'
              : 'text-text-secondary hover:bg-[var(--input-bg)] hover:text-[var(--text-primary)] border border-transparent'
          }`}
        >
          <GearIcon size={14} />
          {t('settings.tabs.general', 'General')}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('lcd')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap shrink-0 ${
            activeTab === 'lcd'
              ? 'bg-brand-lime/15 text-brand-lime border border-brand-lime/30 shadow-sm'
              : 'text-text-secondary hover:bg-[var(--input-bg)] hover:text-[var(--text-primary)] border border-transparent'
          }`}
        >
          <SlidersIcon size={14} />
          {t('settings.tabs.lcd', 'LCD Display')}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('storage')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap shrink-0 ${
            activeTab === 'storage'
              ? 'bg-brand-lime/15 text-brand-lime border border-brand-lime/30 shadow-sm'
              : 'text-text-secondary hover:bg-[var(--input-bg)] hover:text-[var(--text-primary)] border border-transparent'
          }`}
        >
          <ServerIcon size={14} />
          {t('settings.tabs.storage', 'Storage')}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('security')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap shrink-0 ${
            activeTab === 'security'
              ? 'bg-brand-lime/15 text-brand-lime border border-brand-lime/30 shadow-sm'
              : 'text-text-secondary hover:bg-[var(--input-bg)] hover:text-[var(--text-primary)] border border-transparent'
          }`}
        >
          <ShieldIcon size={14} />
          {t('settings.tabs.security', 'Security')}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('alsa')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap shrink-0 ${
            activeTab === 'alsa'
              ? 'bg-brand-lime/15 text-brand-lime border border-brand-lime/30 shadow-sm'
              : 'text-text-secondary hover:bg-[var(--input-bg)] hover:text-[var(--text-primary)] border border-transparent'
          }`}
        >
          <span className="text-sm">🔊</span>
          {t('settings.tabs.alsa', 'ALSA AUDIO')}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('backup')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap shrink-0 ${
            activeTab === 'backup'
              ? 'bg-brand-lime/15 text-brand-lime border border-brand-lime/30 shadow-sm'
              : 'text-text-secondary hover:bg-[var(--input-bg)] hover:text-[var(--text-primary)] border border-transparent'
          }`}
        >
          <ExportIcon size={14} />
          {t('settings.tabs.backup', 'BACKUP & RESTORE')}
        </button>
      </div>

      {/* Tab content wrapper (Scrollable area) */}
      <div className="flex-1 overflow-y-auto p-5 md:p-6 min-h-0 custom-scrollbar space-y-5">
        {settings.restart_required && (
          <div className="bg-brand-orange/10 border border-brand-orange/30 text-brand-orange rounded-xl p-3.5 text-xs flex items-center gap-3 animate-in fade-in duration-300">
            <span className="text-lg">⚠️</span>
            <div className="flex-1">
              <span className="font-bold uppercase tracking-wider block mb-0.5 text-[10px]">
                {t('settings.restart.title', 'Restart Required')}
              </span>
              <span>
                {settings.restart_reasons?.includes('port') && settings.restart_reasons?.includes('logging')
                  ? t('settings.restart.reason_both', 'A restart is required to apply the new GUI Port and Logging configurations. Click the "Restart Panel" button to apply.')
                  : settings.restart_reasons?.includes('logging')
                  ? t('settings.restart.reason_logging', 'A restart is required to apply the new Logging configuration. Click the "Restart Panel" button to apply.')
                  : t('settings.restart.reason_port', 'A restart is required to apply the new GUI Port configuration. Click the "Restart Panel" button to apply.')}
              </span>
            </div>
          </div>
        )}
        
        {/* TAB 1: General */}
        {activeTab === 'general' && (
          <>
            {/* TAB 1: General -> Interface Language Card */}
            <div className="glass-card p-4 !rounded-2xl space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center gap-1.5 border-b border-[var(--glass-border)] pb-2 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                <h4 className="text-cyan-400 font-bold text-xs uppercase tracking-wider">
                  {t('settings.language.title', 'Interface Language')}
                </h4>
              </div>

              <div className="space-y-3">
                <p className="text-xs text-text-secondary">
                  {t('settings.language.description', 'Select the display language for the application user interface.')}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {[
                    { code: 'en', label: 'English (US)', badge: 'EN 🇺🇸' },
                    { code: 'es', label: 'Español (ES)', badge: 'ES 🇪🇸' },
                    { code: 'ca', label: 'Català (CA)', badge: 'CA 🏴' },
                  ].map((item) => (
                    <button
                      key={item.code}
                      type="button"
                      onClick={() => setLanguage(item.code)}
                      className={`p-3 rounded-xl border flex items-center justify-between transition-all cursor-pointer ${
                        language === item.code
                          ? 'border-brand-lime bg-brand-lime/10 text-[var(--text-primary)] font-bold shadow-md'
                          : 'border-[var(--glass-border)] bg-[var(--input-bg)] text-text-secondary hover:border-brand-lime/40 hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <span className="text-xs">{item.label}</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--bg-dark)] border border-[var(--glass-border)] text-cyan-400 font-bold">
                        {item.badge}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* TAB 1: General -> Interface Theme Card */}
            <div className="glass-card p-4 !rounded-2xl space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center gap-1.5 border-b border-[var(--glass-border)] pb-2 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-lime" />
                <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider">
                  {t('settings.theme.title', 'INTERFACE THEME')}
                </h4>
              </div>

              <div className="space-y-3">
                <p className="text-xs text-text-secondary">
                  {t('settings.theme.description', 'Select visual theme for the user interface.')}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                  {THEME_OPTIONS.map((item) => {
                    const isSelected = theme === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => handleSelectTheme(item.key)}
                        className={`p-3 rounded-xl border flex flex-col justify-between transition-all cursor-pointer text-left relative overflow-hidden ${
                          isSelected
                            ? 'border-brand-lime bg-brand-lime/10 shadow-md ring-1 ring-brand-lime/50'
                            : 'border-[var(--glass-border)] bg-[var(--input-bg)] hover:border-brand-lime/40'
                        }`}
                      >
                        {isSelected && (
                          <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-brand-lime text-black flex items-center justify-center text-[10px] font-bold">
                            ✓
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-2 mb-2 pr-5">
                          <span className="text-xs font-bold text-[var(--text-primary)] truncate">
                            {t(item.nameKey, item.defaultName)}
                          </span>
                          <span className="text-xs shrink-0" title={item.mode}>
                            {item.mode === 'dark' ? '🌙' : '☀️'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-2">
                          <span
                            className="w-4 h-4 rounded-full border border-white/20 shadow-sm"
                            style={{ backgroundColor: item.bg }}
                            title={`BG: ${item.bg}`}
                          />
                          <span
                            className="w-4 h-4 rounded-full border border-white/20 shadow-sm"
                            style={{ backgroundColor: item.accent1 }}
                            title={`Accent 1: ${item.accent1}`}
                          />
                          <span
                            className="w-4 h-4 rounded-full border border-white/20 shadow-sm"
                            style={{ backgroundColor: item.accent2 }}
                            title={`Accent 2: ${item.accent2}`}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* TAB 1: General -> Watchdog & Startup Settings Card */}
            <div className="glass-card p-4 !rounded-2xl space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center gap-1.5 border-b border-[var(--glass-border)] pb-2 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <h4 className="text-amber-400 font-bold text-xs uppercase tracking-wider">
                  {t('settings.watchdog.title', 'WATCHDOG & STARTUP TIMING')}
                </h4>
              </div>

              <p className="text-xs text-text-secondary">
                {t('settings.watchdog.description', 'Configure system boot grace delays, network pre-flight timeout checks, and watchdog exponential backoff limits.')}
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">
                    {t('settings.watchdog.startupGraceDelay', 'Startup Grace Delay (sec)')}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={300}
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] text-[var(--text-primary)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime font-mono"
                    value={startupGraceDelay}
                    onChange={(e) => setStartupGraceDelay(parseInt(e.target.value, 10) || 0)}
                  />
                  <span className="text-[9px] text-text-secondary/70 block">
                    {t('settings.watchdog.startupGraceDelayHelp', 'Delay before auto-starting services on system boot')}
                  </span>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">
                    {t('settings.watchdog.networkWaitTimeout', 'Network Wait Timeout (sec)')}
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={600}
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] text-[var(--text-primary)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime font-mono"
                    value={networkWaitTimeout}
                    onChange={(e) => setNetworkWaitTimeout(parseInt(e.target.value, 10) || 5)}
                  />
                  <span className="text-[9px] text-text-secondary/70 block">
                    {t('settings.watchdog.networkWaitTimeoutHelp', 'Max time to wait for network/DNS route on boot')}
                  </span>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">
                    {t('settings.watchdog.watchdogMaxBackoff', 'Watchdog Max Backoff (sec)')}
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={600}
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] text-[var(--text-primary)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime font-mono"
                    value={watchdogMaxBackoff}
                    onChange={(e) => setWatchdogMaxBackoff(parseInt(e.target.value, 10) || 5)}
                  />
                  <span className="text-[9px] text-text-secondary/70 block">
                    {t('settings.watchdog.watchdogMaxBackoffHelp', 'Upper cap for exponential backoff retry interval')}
                  </span>
                </div>
              </div>
            </div>

            <div className="glass-card p-4 !rounded-2xl space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center gap-1.5 border-b border-[var(--glass-border)] pb-2 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-lime" />
                <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider">{t('settings.branding.title', 'Branding & Node Identity')}</h4>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.branding.stationName', 'Station Name')}</label>
                    <input 
                      type="text" 
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] text-[var(--text-primary)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all"
                      value={nodeName}
                      onChange={e => setNodeName(e.target.value)}
                      placeholder="e.g. Primary Transcode Node"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.branding.logoAbbr', 'Logo Abbreviation')}</label>
                    <input 
                      type="text" 
                      maxLength={3}
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all uppercase font-bold tracking-widest text-brand-lime"
                      value={logoText}
                      onChange={e => setLogoText(e.target.value.toUpperCase())}
                      placeholder="e.g. FFG"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.branding.nodeAlias', 'LCD / Node Alias')}</label>
                    <input 
                      type="text" 
                      maxLength={12}
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] text-[var(--text-primary)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all font-mono"
                      value={lcdAlias}
                      onChange={e => {
                        const val = e.target.value.replace(/[^a-zA-Z0-9\s-_]/g, '').slice(0, 12);
                        setLcdAlias(val);
                      }}
                      placeholder="e.g. NODE-01"
                    />
                  </div>
                </div>

                <div className="flex flex-col items-center justify-center border-2 border-dashed border-[var(--glass-border)] rounded-xl p-4 hover:border-brand-lime transition-all relative group cursor-pointer h-full min-h-[140px] bg-[var(--input-bg)]">
                  <label className="absolute inset-0 cursor-pointer flex flex-col items-center justify-center w-full h-full z-10">
                    <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                  </label>
                  {settings.logo_path ? (
                    <div className="relative w-20 h-20 flex items-center justify-center">
                      <img src={`${API}${settings.logo_path}`} alt="Custom Logo" className="max-w-full max-h-full object-contain" />
                    </div>
                  ) : (
                    <div className="w-12 h-12 bg-brand-lime/10 border border-brand-lime/30 rounded-xl flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform">
                      <span className="text-brand-lime font-black text-lg uppercase tracking-wider">{logoText || 'FF'}</span>
                    </div>
                  )}
                  <div className="text-[9px] uppercase font-bold text-text-secondary mt-2.5 text-center tracking-wider">
                    {settings.logo_path ? t('settings.branding.logoChange', 'Click to change logo') : t('settings.branding.logoUpload', 'Upload custom logo')}
                  </div>
                </div>
              </div>
            </div>



            {/* Card 3: Logging Configuration */}
            <div className="glass-card p-4 !rounded-2xl space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center gap-1.5 border-b border-[var(--glass-border)] pb-2 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-lime" />
                <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider">{t('settings.logging.title', 'LOGGING CONFIGURATION')}</h4>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.logging.mode', 'Mode')}</label>
                    <select
                      value={loggingMode}
                      onChange={e => setLoggingMode(e.target.value)}
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all text-[var(--text-primary)]"
                    >
                      <option value="journalctl" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">journalctl (journald console)</option>
                      <option value="file" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">file (log file only)</option>
                      <option value="both" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">both (console + log file)</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.logging.timestampTz', 'Log Timestamp Format')}</label>
                    <select
                      value={loggingTimestampTz}
                      onChange={e => setLoggingTimestampTz(e.target.value)}
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all text-[var(--text-primary)]"
                    >
                      <option value="utc" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('settings.logging.timestampTzUtc', 'UTC (Universal Coordinated Time - Standard)')}</option>
                      <option value="local" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('settings.logging.timestampTzLocal', 'Local Machine Timezone (Offset)')}</option>
                    </select>
                  </div>

                  {(loggingMode === 'file' || loggingMode === 'both') && (
                    <>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.logging.storage', 'Log Storage')}</label>
                        <select
                          value={loggingStorageId}
                          onChange={e => setLoggingStorageId(e.target.value === '' ? '' : Number(e.target.value))}
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all text-[var(--text-primary)]"
                        >
                          <option value="" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('settings.logging.selectStorage', 'Select a Log Storage...')}</option>
                          {storages.filter(s => s.type === 'logs').map(s => (
                            <option key={s.id} value={s.id} className="bg-[var(--bg-dark)] text-[var(--text-primary)]">
                              {s.name} ({s.path})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.logging.relativePath', 'Relative Path')}</label>
                        <input
                          type="text"
                          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all text-[var(--text-primary)] font-mono"
                          value={loggingRelativePath}
                          onChange={e => setLoggingRelativePath(e.target.value)}
                          placeholder="e.g. ffmpeg-gui.log"
                        />
                      </div>
                    </>
                  )}
                </div>

                {(loggingMode === 'file' || loggingMode === 'both') && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-2.5 bg-[var(--input-bg)] rounded-xl border border-[var(--glass-border)]">
                      <div>
                        <h4 className="text-xs font-bold text-[var(--text-primary)]">{t('settings.logging.enableRotation', 'Enable Rotation')}</h4>
                        <p className="text-[9px] text-text-secondary leading-snug">{t('settings.logging.rotationDesc', 'Limit file size and retain archives')}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setLoggingRotationEnabled(!loggingRotationEnabled)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          loggingRotationEnabled ? 'bg-brand-lime' : 'bg-white/10'
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-black transition-transform ${
                            loggingRotationEnabled ? 'translate-x-4' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    {loggingRotationEnabled && (
                      <div className="grid grid-cols-2 gap-3 pl-1">
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.logging.maxBytes', 'Max Bytes')}</label>
                          <input
                            type="number"
                            min={0}
                            className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all text-[var(--text-primary)] font-mono"
                            value={loggingRotationMaxBytes}
                            onChange={e => setLoggingRotationMaxBytes(Number(e.target.value))}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.logging.backupCount', 'Backup Count')}</label>
                          <input
                            type="number"
                            min={0}
                            className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all text-[var(--text-primary)] font-mono"
                            value={loggingRotationBackupCount}
                            onChange={e => setLoggingRotationBackupCount(Number(e.target.value))}
                          />
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between p-2.5 bg-[var(--input-bg)] rounded-xl border border-[var(--glass-border)]">
                      <div>
                        <h4 className="text-xs font-bold text-[var(--text-primary)]">{t('settings.logging.enableCompression', 'Enable Compression')}</h4>
                        <p className="text-[9px] text-text-secondary leading-snug">{t('settings.logging.compressionDesc', 'Compress backup logs (.gz)')}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setLoggingCompressionEnabled(!loggingCompressionEnabled)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          loggingCompressionEnabled ? 'bg-brand-lime' : 'bg-white/10'
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-black transition-transform ${
                            loggingCompressionEnabled ? 'translate-x-4' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.logging.retentionDays', 'Retention Days')}</label>
                      <input
                        type="number"
                        min={0}
                        className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all text-[var(--text-primary)] font-mono"
                        value={loggingRetentionDays}
                        onChange={e => setLoggingRetentionDays(Number(e.target.value))}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* TAB 2: LCD Integration */}
        {activeTab === 'lcd' && (
          <div className="space-y-3 animate-in fade-in duration-300">
            <div className="glass-card p-4 !rounded-2xl space-y-4">
              <div className="flex items-center gap-1.5 border-b border-[var(--glass-border)] pb-2 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-lime" />
                <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider">{t('settings.lcd.title', 'LCD display & Serial Driver')}</h4>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-2.5 bg-[var(--input-bg)] rounded-xl border border-[var(--glass-border)]">
                    <div>
                      <h4 className="text-xs font-bold text-[var(--text-primary)]">{t('settings.lcd.enable', 'Enable LCD Display')}</h4>
                      <p className="text-[9px] text-text-secondary leading-snug">{t('settings.lcd.enableDesc', 'Control status via hardware panel')}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setLcdEnabled(!lcdEnabled)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        lcdEnabled ? 'bg-brand-lime' : 'bg-white/10'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-black transition-transform ${
                          lcdEnabled ? 'translate-x-4' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.lcd.model', 'LCD Model')}</label>
                    <select
                      value={lcdModel}
                      onChange={e => setLcdModel(e.target.value)}
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all text-[var(--text-primary)]"
                    >
                      <option value="cfa635" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">Crystalfontz CFA-635 / CFA-735</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.lcd.serialPort', 'Serial Port')}</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="e.g. /dev/ttyACM0"
                        className="flex-1 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all text-[var(--text-primary)] font-mono"
                        value={lcdPort}
                        onChange={e => setLcdPort(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={handleProbe}
                        disabled={isProbing}
                        className="px-3 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg hover:border-brand-lime/40 font-bold text-[10px] uppercase tracking-wider transition-all text-[var(--text-primary)] cursor-pointer"
                      >
                        {isProbing ? t('common.scanning', 'Scanning...') : t('common.scan', 'Scan')}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="bg-white/5 border border-white/10 rounded-xl p-3 flex flex-col justify-between min-h-[140px]">
                  <div>
                    <h4 className="text-[9px] font-bold uppercase tracking-wider mb-1.5 text-text-secondary">{t('settings.lcd.detectedPorts', 'Auto-Detected Serial Ports')}</h4>
                    {probeResults.length === 0 && (!settings.lcd_enabled || !settings.lcd_port) ? (
                      <p className="text-[10px] text-text-secondary italic leading-normal">{t('settings.lcd.noPortsDetected', 'No active serial displays detected. Click "Scan" to probe COM ports.')}</p>
                    ) : (
                      <div className="space-y-1.5 max-h-[100px] overflow-y-auto pr-1 custom-scrollbar">
                        {settings.lcd_enabled && settings.lcd_port && !probeResults.some(p => p.port === settings.lcd_port) && (
                          <div
                            onClick={() => setLcdPort(settings.lcd_port)}
                            className={`p-2 border rounded-lg flex items-center justify-between cursor-pointer transition-all ${
                              lcdPort === settings.lcd_port
                                ? 'bg-brand-lime/20 border-brand-lime/40'
                                : 'bg-white/5 border-white/10 hover:bg-white/10'
                            }`}
                          >
                            <div>
                              <div className="text-[11px] font-bold text-brand-lime font-mono">{settings.lcd_port}</div>
                              <div className="text-[8px] text-text-secondary leading-none mt-0.5">{t('settings.lcd.configuredActive', 'Configured Port (Active)')}</div>
                            </div>
                            <span className="text-[8px] font-black uppercase bg-brand-lime text-black px-1.5 py-0.5 rounded leading-none">
                              {settings.lcd_model || 'cfa635'}
                            </span>
                          </div>
                        )}

                        {probeResults.map((p: any, idx: number) => (
                          <div
                            key={idx}
                            onClick={() => setLcdPort(p.port)}
                            className={`p-2 border rounded-lg flex items-center justify-between cursor-pointer transition-all ${
                              lcdPort === p.port
                                ? 'bg-brand-lime/20 border-brand-lime/40'
                                : 'bg-white/5 border-white/10 hover:bg-white/10'
                            }`}
                          >
                            <div>
                              <div className="text-[11px] font-bold text-brand-lime font-mono">{p.port}</div>
                              <div className="text-[8px] text-text-secondary leading-none mt-0.5">{p.description}</div>
                            </div>
                            <span className="text-[8px] font-black uppercase bg-brand-lime text-black px-1.5 py-0.5 rounded leading-none">
                              {p.driver}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  
                  <p className="text-[8px] text-text-secondary leading-tight italic mt-2">
                    {t('settings.lcd.dialoutPermissionHint', 'Make sure the service user is in the Dialout group to permit raw serial operations.')}
                  </p>
                </div>
              </div>

              {/* Backlight / LEDs */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-white/5">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.lcd.activeBrightness', 'Active Brightness ({{brightness}}%)', { brightness: lcdBrightness })}</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-brand-lime"
                    value={lcdBrightness}
                    onChange={e => setLcdBrightness(Number(e.target.value))}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.lcd.dimmedBrightness', 'Dimmed Brightness ({{brightness}}%)', { brightness: lcdDimBrightness })}</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-brand-lime"
                    value={lcdDimBrightness}
                    onChange={e => setLcdDimBrightness(Number(e.target.value))}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.lcd.dimTimeout', 'Dim Timeout (sec)')}</label>
                  <input
                    type="number"
                    min="5"
                    max="3600"
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 text-xs outline-none focus:border-brand-lime transition-all text-[var(--text-primary)] font-mono"
                    value={lcdDimTimeout}
                    onChange={e => setLcdDimTimeout(Number(e.target.value))}
                  />
                </div>
              </div>
            </div>

            <div className="glass-card p-4 !rounded-2xl space-y-3">
              <div className="flex items-center gap-1.5 border-b border-[var(--glass-border)] pb-2 mb-1">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-orange" />
                <h4 className="text-brand-orange font-bold text-xs uppercase tracking-wider">{t('settings.lcd.ledProfiles', 'Status LED Profiles')}</h4>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.lcd.led0', 'LED 0 (Top)')}</label>
                  <select
                    value={lcdLed0Profile}
                    onChange={e => setLcdLed0Profile(e.target.value)}
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 focus:border-brand-lime outline-none text-[var(--text-primary)] text-xs"
                  >
                    <option value="heartbeat" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('settings.lcd.ledOption.heartbeat', 'Heartbeat (Blink)')}</option>
                    <option value="services" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('settings.lcd.ledOption.services', 'Services Status')}</option>
                    <option value="tasks" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('settings.lcd.ledOption.tasks', 'Task Events')}</option>
                    <option value="resources" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('settings.lcd.ledOption.resources', 'Resources Alert (CPU/RAM)')}</option>
                    <option value="recording" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('settings.lcd.ledOption.recording', 'Recording (REC Pilot)')}</option>
                    <option value="storage" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('settings.lcd.ledOption.storage', 'Storage Alert')}</option>
                    <option value="disabled" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('common.disabled', 'Disabled')}</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.lcd.led1', 'LED 1')}</label>
                  <select
                    value={lcdLed1Profile}
                    onChange={e => setLcdLed1Profile(e.target.value)}
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 focus:border-brand-lime outline-none text-[var(--text-primary)] text-xs"
                  >
                    <option value="heartbeat" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('settings.lcd.ledOption.heartbeat', 'Heartbeat (Blink)')}</option>
                    <option value="services" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('settings.lcd.ledOption.services', 'Services Status')}</option>
                    <option value="tasks" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('settings.lcd.ledOption.tasks', 'Task Events')}</option>
                    <option value="resources" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('settings.lcd.ledOption.resources', 'Resources Alert (CPU/RAM)')}</option>
                    <option value="recording" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('settings.lcd.ledOption.recording', 'Recording (REC Pilot)')}</option>
                    <option value="storage" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('settings.lcd.ledOption.storage', 'Storage Alert')}</option>
                    <option value="disabled" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('common.disabled', 'Disabled')}</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.lcd.led2', 'LED 2')}</label>
                  <select
                    value={lcdLed2Profile}
                    onChange={e => setLcdLed2Profile(e.target.value)}
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 focus:border-brand-lime outline-none text-[var(--text-primary)] text-xs"
                  >
                    <option value="heartbeat" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('settings.lcd.ledOption.heartbeat', 'Heartbeat (Blink)')}</option>
                    <option value="services" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('settings.lcd.ledOption.services', 'Services Status')}</option>
                    <option value="tasks" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('settings.lcd.ledOption.tasks', 'Task Events')}</option>
                    <option value="resources" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('settings.lcd.ledOption.resources', 'Resources Alert (CPU/RAM)')}</option>
                    <option value="recording" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('settings.lcd.ledOption.recording', 'Recording (REC Pilot)')}</option>
                    <option value="storage" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('settings.lcd.ledOption.storage', 'Storage Alert')}</option>
                    <option value="disabled" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('common.disabled', 'Disabled')}</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.lcd.led3', 'LED 3 (Bottom)')}</label>
                  <select
                    value={lcdLed3Profile}
                    onChange={e => setLcdLed3Profile(e.target.value)}
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-1.5 focus:border-brand-lime outline-none text-[var(--text-primary)] text-xs"
                  >
                    <option value="heartbeat" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('settings.lcd.ledOption.heartbeat', 'Heartbeat (Blink)')}</option>
                    <option value="services" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('settings.lcd.ledOption.services', 'Services Status')}</option>
                    <option value="tasks" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('settings.lcd.ledOption.tasks', 'Task Events')}</option>
                    <option value="resources" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('settings.lcd.ledOption.resources', 'Resources Alert (CPU/RAM)')}</option>
                    <option value="recording" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('settings.lcd.ledOption.recording', 'Recording (REC Pilot)')}</option>
                    <option value="storage" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('settings.lcd.ledOption.storage', 'Storage Alert')}</option>
                    <option value="disabled" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">{t('common.disabled', 'Disabled')}</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: Storage Drives */}
        {activeTab === 'storage' && (() => {
          const storagesByType = STORAGE_TYPES.reduce((acc, type) => {
            acc[type] = storages.filter(s => s.type === type);
            return acc;
          }, {} as Record<string, any[]>);
          return (
            <div className="space-y-4 animate-in fade-in duration-300">
              {/* Add Storage Form */}
              <div className="glass-card p-4 !rounded-2xl space-y-4">
                <div className="flex items-center gap-1.5 border-b border-[var(--glass-border)] pb-2 mb-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-lime" />
                  <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider">{t('settings.storage.addTitle', 'Add Storage Drive')}</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.storage.name', 'Storage Name')}</label>
                    <input
                      type="text"
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all text-[var(--text-primary)]"
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      placeholder="e.g. Fast SSD Media Storage"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.storage.type', 'Storage Type')}</label>
                    <select
                      value={newType}
                      onChange={e => setNewType(e.target.value)}
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all text-[var(--text-primary)]"
                    >
                      <option value="build" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">build (FFmpeg Build Cache)</option>
                      <option value="media" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">media (Input Videos/Music)</option>
                      <option value="hls" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">hls (HLS Output Segments)</option>
                      <option value="logs" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">logs (FFmpeg/System Logs)</option>
                      <option value="sdk" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">sdk (DeckLink/NDI SDKs)</option>
                      <option value="preview" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">preview (Snapshot Thumbnails)</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.storage.path', 'Absolute Directory Path')}</label>
                    <input
                      type="text"
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all font-mono text-[var(--text-primary)]"
                      value={newPath}
                      onChange={e => setNewPath(e.target.value)}
                      placeholder="e.g. /mnt/storage/media"
                    />
                  </div>
                </div>

                {addValidationError && (
                  <p className="text-[10px] text-red-500 font-bold mt-1">{addValidationError}</p>
                )}
                {addValidationSuccess && (
                  <p className="text-[10px] text-brand-lime font-bold mt-1">{addValidationSuccess}</p>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    disabled={isAddingValidating || !newPath.trim()}
                    onClick={() => handleValidatePath(newPath, false)}
                    className={`px-4 py-2 bg-white/10 border border-white/10 rounded-lg hover:bg-white/20 font-bold text-xs uppercase tracking-wider transition-all text-white cursor-pointer ${
                      (!newPath.trim() || isAddingValidating) ? 'opacity-40 cursor-not-allowed' : ''
                    }`}
                  >
                    {isAddingValidating ? t('settings.storage.validating', 'Validating...') : t('settings.storage.validatePath', 'Validate Path')}
                  </button>
                  <button
                    type="button"
                    disabled={isAdding || !newName.trim() || !newPath.trim()}
                    onClick={handleAddStorage}
                    className={`px-5 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition-all ${
                      newName.trim() && newPath.trim() && !isAdding
                        ? 'bg-brand-lime text-black hover:scale-[1.02] active:scale-[0.98] cursor-pointer'
                        : 'bg-[var(--input-bg)] text-text-secondary opacity-40 cursor-not-allowed border border-[var(--glass-border)]'
                    }`}
                  >
                    {isAdding ? t('common.saving', 'Saving...') : t('settings.storage.saveStorage', 'Save Storage')}
                  </button>
                </div>
              </div>

              {/* List of Configured Storages */}
              <div className="space-y-4">
                {isLoadingStorages ? (
                  <div className="flex justify-center items-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-lime" />
                  </div>
                ) : (
                  STORAGE_TYPES.map(type => {
                    const typeStorages = storagesByType[type] || [];
                    return (
                      <div key={type} className="glass-card p-4 !rounded-2xl space-y-3">
                        <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2">
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-brand-orange" />
                            <h4 className="text-[var(--text-primary)] font-bold text-xs uppercase tracking-wider">{t('settings.storage.typeDrives', '{{type}} Storage Drives', { type: type.toUpperCase() })}</h4>
                          </div>
                          <span className="text-[10px] font-mono text-text-secondary bg-white/5 px-2 py-0.5 rounded">
                            {t('settings.storage.configuredCount', '{{count}} configured', { count: typeStorages.length })}
                          </span>
                        </div>

                        {typeStorages.length === 0 ? (
                          <div className="py-4 text-center text-xs text-text-secondary italic">
                            {t('settings.storage.noDrives', 'No storage drives registered for this category.')}
                          </div>
                        ) : (
                          <div className="space-y-3 divide-y divide-white/5">
                            {typeStorages.map((s, idx) => {
                              const isEditing = editingId === s.id;
                              const usedPercent = s.percent !== undefined ? s.percent : 0;
                              const barColorClass = getProgressBarColorClass(usedPercent);

                              return (
                                <div key={s.id} className={`pt-3 ${idx === 0 ? '!pt-0' : ''}`}>
                                  {isEditing ? (
                                    /* Inline Edit Mode */
                                    <div className="space-y-3">
                                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div className="space-y-1">
                                          <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.storage.name', 'Storage Name')}</label>
                                          <input
                                            type="text"
                                            className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all text-[var(--text-primary)]"
                                            value={editName}
                                            onChange={e => setEditName(e.target.value)}
                                          />
                                        </div>
                                        <div className="space-y-1">
                                          <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.storage.path', 'Absolute Directory Path')}</label>
                                          <input
                                            type="text"
                                            className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all font-mono text-[var(--text-primary)]"
                                            value={editPath}
                                            onChange={e => setEditPath(e.target.value)}
                                          />
                                        </div>
                                      </div>

                                      {editValidationError && (
                                        <p className="text-[10px] text-red-500 font-bold mt-1">{editValidationError}</p>
                                      )}
                                      {editValidationSuccess && (
                                        <p className="text-[10px] text-brand-lime font-bold mt-1">{editValidationSuccess}</p>
                                      )}

                                      <div className="flex justify-end gap-2 pt-1">
                                        <button
                                          type="button"
                                          disabled={isEditValidating || !editPath.trim()}
                                          onClick={() => handleValidatePath(editPath, true)}
                                          className="px-3 py-1.5 bg-[var(--input-bg)] hover:border-brand-lime/40 border border-[var(--glass-border)] rounded-lg font-bold text-[10px] uppercase tracking-wider transition-all text-[var(--text-primary)] cursor-pointer"
                                        >
                                          {isEditValidating ? t('settings.storage.validating', 'Validating...') : t('settings.storage.validatePath', 'Validate Path')}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setEditingId(null)}
                                          className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/5 rounded-lg font-bold text-[10px] uppercase tracking-wider transition-all text-text-secondary cursor-pointer"
                                        >
                                          {t('common.cancel', 'Cancel')}
                                        </button>
                                        <button
                                          type="button"
                                          disabled={isSavingEdit}
                                          onClick={() => handleSaveEdit(s.id)}
                                          className="px-4 py-1.5 bg-brand-lime text-black rounded-lg font-bold text-[10px] uppercase tracking-wider transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                                        >
                                          {isSavingEdit ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    /* Standard Display Mode */
                                    <div className="space-y-2.5">
                                      <div className="flex items-start justify-between">
                                        <div className="space-y-1 pr-4 min-w-0 flex-1">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-bold text-sm text-[var(--text-primary)] truncate max-w-[240px]" title={s.name}>
                                              {s.name}
                                            </span>
                                            <span className="text-[9px] font-black uppercase bg-brand-orange/20 text-brand-orange px-2 py-0.5 rounded tracking-wider">
                                              {s.type}
                                            </span>
                                            {s.is_default && (
                                              <span className="text-[9px] font-black uppercase bg-brand-lime text-black px-1.5 py-0.5 rounded tracking-widest">
                                                {t('common.default', 'DEFAULT')}
                                              </span>
                                            )}
                                          </div>
                                          <div className="text-xs font-mono text-text-secondary truncate block" title={s.path}>
                                            {s.path}
                                          </div>
                                        </div>

                                        <div className="flex gap-2 shrink-0">
                                          <button
                                            type="button"
                                            disabled={s.is_default}
                                            onClick={() => {
                                              setEditingId(s.id);
                                              setEditName(s.name);
                                              setEditPath(s.path);
                                              setEditValidationError('');
                                              setEditValidationSuccess('');
                                            }}
                                            className={`p-1.5 rounded bg-[var(--input-bg)] border border-[var(--glass-border)] hover:border-brand-lime/40 transition-all text-[var(--text-primary)] cursor-pointer ${
                                              s.is_default ? 'opacity-30 cursor-not-allowed' : ''
                                            }`}
                                            title={s.is_default ? t('settings.storage.cannotEditDefault', 'Cannot edit default storage') : t('settings.storage.editStorage', 'Edit Storage')}
                                          >
                                            <PencilIcon size={12} />
                                          </button>
                                          <button
                                            type="button"
                                            disabled={s.is_default}
                                            onClick={() => handleDeleteStorage(s.id)}
                                            className={`p-1.5 rounded bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-all text-red-400 cursor-pointer ${
                                              s.is_default ? 'opacity-30 cursor-not-allowed' : ''
                                            }`}
                                            title={s.is_default ? t('settings.storage.cannotDeleteDefault', 'Cannot delete default storage') : t('settings.storage.deleteStorage', 'Delete Storage')}
                                          >
                                            <TrashIcon size={12} />
                                          </button>
                                        </div>
                                      </div>

                                      {/* Space Utilization Details */}
                                      <div className="space-y-1">
                                        <div className="flex justify-between items-center text-[10px] font-bold text-text-secondary">
                                          <span>{t('settings.storage.utilization', 'Space Utilization')}</span>
                                          <span className="font-mono text-[var(--text-primary)]">
                                            {formatGB(s.used)} / {formatGB(s.total)} ({usedPercent}%)
                                          </span>
                                        </div>
                                        <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden border border-white/5">
                                          <div
                                            className={`h-full rounded-full transition-all duration-500 ${barColorClass}`}
                                            style={{ width: `${Math.min(usedPercent, 100)}%` }}
                                          />
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })()}

        {/* TAB 3: Network & Security */}
        {activeTab === 'security' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* CARD 1: ACCESS PASSWORD */}
            <div className="glass-card p-5 !rounded-2xl space-y-4">
              <div className="flex items-center gap-2 border-b border-[var(--glass-border)] pb-2 mb-2">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                <h4 className="text-red-400 font-bold text-xs uppercase tracking-wider">🔑 {t('settings.security.passwordTitle', 'ACCESS PASSWORD')}</h4>
              </div>

              <div className="max-w-md space-y-3">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.security.newPassword', 'New Password')}</label>
                  <input 
                    type="password" 
                    autoComplete="new-password"
                    placeholder={t('settings.security.newPasswordPlaceholder', 'Leave empty to remove password')}
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-red-500 text-[var(--text-primary)] transition-all"
                    value={newPassword}
                    onChange={e => { setNewPassword(e.target.value); setPasswordError(''); setPasswordSuccess('') }}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.security.confirmPassword', 'Confirm Password')}</label>
                  <input 
                    type="password" 
                    autoComplete="new-password"
                    placeholder={t('settings.security.confirmPasswordPlaceholder', 'Confirm new password')}
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-red-500 text-[var(--text-primary)] transition-all"
                    value={confirmPassword}
                    onChange={e => { setConfirmPassword(e.target.value); setPasswordError(''); setPasswordSuccess('') }}
                  />
                </div>
                
                {passwordError && <p className="text-[10px] text-red-500 font-bold mt-1">{passwordError}</p>}
                {passwordSuccess && <p className="text-[10px] text-brand-lime font-bold mt-1">{passwordSuccess}</p>}
                
                <p className="text-[9px] text-text-secondary leading-tight italic">
                  {t('settings.security.description', 'Protect your FFmpeg node dashboard from unauthorized stream modifications or command execution.')}
                </p>
              </div>
            </div>

            {/* CARD 2: LISTEN PORTS & NETWORK INTERFACES */}
            <div className="glass-card p-5 !rounded-2xl space-y-4">
              <div className="flex items-center gap-2 border-b border-[var(--glass-border)] pb-2 mb-2">
                <span className="w-2 h-2 rounded-full bg-brand-blue" />
                <h4 className="text-brand-blue font-bold text-xs uppercase tracking-wider">🌐 {t('settings.network.cardTitle', 'LISTEN PORTS & NETWORK INTERFACES')}</h4>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.network.listenInterfaces', 'Listen IP Interface')}</label>
                  <select
                    value={bindAddress}
                    onChange={e => setBindAddress(e.target.value)}
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-blue text-[var(--text-primary)] font-mono cursor-pointer"
                  >
                    <option value="0.0.0.0">0.0.0.0 (All Network Interfaces)</option>
                    <option value="127.0.0.1">127.0.0.1 (Localhost / VPN Tunnel Only)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.network.httpPort', 'HTTP Listen Port (GUI)')}</label>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={guiPort}
                    onChange={e => setGuiPort(parseInt(e.target.value) || 8080)}
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-blue text-[var(--text-primary)] font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.network.httpsPort', 'HTTPS Listen Port')}</label>
                  <input
                    type="number"
                    value={httpsPort}
                    onChange={e => setHttpsPort(parseInt(e.target.value) || 8443)}
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-blue text-[var(--text-primary)] font-mono"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-[var(--glass-border)] space-y-3">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="ssl_enabled_checkbox"
                    disabled={!sslStatus?.valid}
                    checked={sslEnabled}
                    onChange={e => setSslEnabled(e.target.checked)}
                    className="w-4 h-4 rounded accent-brand-lime cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  />
                  <label htmlFor="ssl_enabled_checkbox" className={`text-xs font-bold ${!sslStatus?.valid ? 'opacity-40 cursor-not-allowed text-text-secondary' : 'text-[var(--text-primary)] cursor-pointer'}`}>
                    {t('settings.network.enableHttps', 'Enable HTTPS Encryption')}
                  </label>
                </div>

                {!sslStatus?.valid && (
                  <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-[10px] text-amber-400 font-mono flex items-center gap-2">
                    <span>⚠️</span>
                    <span>{t('settings.network.httpsDisabledCertTooltip', 'HTTPS cannot be enabled until a valid SSL certificate and keypair are loaded.')}</span>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="force_https_redirect_checkbox"
                    disabled={!sslEnabled || !sslStatus?.valid}
                    checked={forceHttpsRedirect}
                    onChange={e => setForceHttpsRedirect(e.target.checked)}
                    className="w-4 h-4 rounded accent-brand-lime cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  />
                  <label htmlFor="force_https_redirect_checkbox" className={`text-xs font-bold ${(!sslEnabled || !sslStatus?.valid) ? 'opacity-40 cursor-not-allowed text-text-secondary' : 'text-[var(--text-primary)] cursor-pointer'}`}>
                    {t('settings.network.forceHttpsRedirect', 'Automatically Redirect HTTP -> HTTPS')}
                  </label>
                </div>
              </div>
            </div>

            {/* CARD 3: SSL / TLS CERTIFICATES */}
            <div className="glass-card p-5 !rounded-2xl space-y-5">
              <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-3">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-brand-lime" />
                  <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider">📜 {t('settings.ssl.title', 'SSL / TLS CERTIFICATE MANAGEMENT')}</h4>
                </div>

                {/* Status Badge */}
                {sslStatus && (
                  <div className={`px-3 py-1 rounded-lg border text-xs font-mono font-bold flex items-center gap-2 ${
                    sslStatus.status === 'valid' ? 'bg-brand-lime/15 border-brand-lime/30 text-brand-lime' :
                    sslStatus.status === 'warning' ? 'bg-amber-500/15 border-amber-500/30 text-amber-400' :
                    sslStatus.status === 'critical' || sslStatus.status === 'expired' ? 'bg-red-500/15 border-red-500/30 text-red-400 animate-pulse' :
                    'bg-[var(--input-bg)] border-[var(--glass-border)] text-text-secondary'
                  }`}>
                    <span>{sslStatus.status === 'valid' ? '🟢' : sslStatus.status === 'warning' ? '🟡' : '🔴'}</span>
                    <span className="uppercase">
                      {sslStatus.status === 'valid' ? t('settings.ssl.statusValid', 'Valid Certificate') :
                       sslStatus.status === 'warning' ? t('settings.ssl.statusWarning', 'Expiring Soon') :
                       sslStatus.status === 'critical' ? t('settings.ssl.statusCritical', 'Critical Expiration') :
                       sslStatus.status === 'expired' ? t('settings.ssl.statusExpired', 'Expired Certificate') :
                       t('settings.ssl.statusMissing', 'No Active Certificate')}
                    </span>
                    {sslStatus.valid && (
                      <span className="opacity-80">({sslStatus.days_remaining}d remaining)</span>
                    )}
                  </div>
                )}
              </div>

              {/* Mode Selector */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.ssl.mode', 'Certificate Source Mode')}</label>
                  <select
                    value={sslMode}
                    onChange={e => setSslMode(e.target.value)}
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime text-[var(--text-primary)] font-mono cursor-pointer"
                  >
                    <option value="disabled">{t('settings.ssl.disabled', 'Disabled / Local Fallback')}</option>
                    <option value="acme">{t('settings.ssl.acme', "Let's Encrypt (ACME Auto-Renewal)")}</option>
                    <option value="custom">{t('settings.ssl.custom', 'Custom Certificate Upload')}</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.ssl.domain', 'Domain Name (FQDN / SNI)')}</label>
                  <input
                    type="text"
                    placeholder="stream.vps-server.net"
                    value={sslDomain}
                    onChange={e => setSslDomain(e.target.value)}
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime text-[var(--text-primary)] font-mono"
                  />
                </div>
              </div>

              {/* ACME Configuration Panel */}
              {(sslMode === 'acme' || !sslMode) && (
                <div className="p-4 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl space-y-4">
                  <h5 className="text-xs font-bold uppercase tracking-wider text-brand-lime flex items-center gap-2">
                    <span>🔒</span> Let's Encrypt ACME Configuration
                  </h5>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.ssl.email', 'ACME Contact Email')}</label>
                      <input
                        type="email"
                        placeholder="admin@vps-server.net"
                        value={sslEmail}
                        onChange={e => setSslEmail(e.target.value)}
                        className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime text-[var(--text-primary)] font-mono"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.ssl.challenge', 'Validation Challenge')}</label>
                      <select
                        value={sslChallengeType}
                        onChange={e => setSslChallengeType(e.target.value)}
                        className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime text-[var(--text-primary)] font-mono cursor-pointer"
                      >
                        <option value="http-01">HTTP-01 Challenge (Requires TCP Port 80)</option>
                        <option value="dns-01">DNS-01 Challenge (API Token)</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-3 pt-2">
                    <div className="flex items-center justify-between">
                      <button
                        onClick={handleRenewSsl}
                        disabled={isRenewingSsl}
                        className="px-4 py-2 bg-brand-lime/15 hover:bg-brand-lime/25 text-brand-lime border border-brand-lime/30 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-2"
                      >
                        <span>🔄</span>
                        <span>{isRenewingSsl ? 'Renewing...' : t('settings.ssl.renewNow', 'Renew Certificate Now')}</span>
                      </button>
                    </div>

                    {sslRenewMessage && (
                      <div className={`p-3.5 rounded-xl border text-xs font-mono flex items-start gap-2.5 animate-in fade-in duration-300 ${
                        sslRenewMessage.startsWith('✓')
                          ? 'bg-brand-lime/10 border-brand-lime/30 text-brand-lime'
                          : 'bg-red-500/10 border-red-500/30 text-red-400'
                      }`}>
                        <span className="text-sm shrink-0">{sslRenewMessage.startsWith('✓') ? '✓' : '⚠️'}</span>
                        <div className="leading-relaxed break-words flex-1">
                          {sslRenewMessage.replace(/^[✓⚠️]\s*/, '')}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Custom Upload Drawer */}
              {(sslMode === 'custom' || sslMode === 'disabled') && (
                <div className="p-4 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl space-y-4">
                  <h5 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-2">
                    <span>📤</span> {t('settings.ssl.uploadTitle', 'Upload Custom Certificate & Private Key')}
                  </h5>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.ssl.certFile', 'Fullchain Certificate (.crt / .pem)')}</label>
                      <input
                        type="file"
                        accept=".pem,.crt,.cer"
                        onChange={e => setCertFile(e.target.files?.[0] || null)}
                        className="w-full text-xs font-mono text-[var(--text-primary)] bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg p-2 cursor-pointer"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">{t('settings.ssl.keyFile', 'Private Key (.key / privkey.pem)')}</label>
                      <input
                        type="file"
                        accept=".key,.pem"
                        onChange={e => setKeyFile(e.target.files?.[0] || null)}
                        className="w-full text-xs font-mono text-[var(--text-primary)] bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg p-2 cursor-pointer"
                      />
                    </div>
                  </div>

                  {sslUploadError && <p className="text-xs font-mono font-bold text-red-500">{sslUploadError}</p>}
                  {sslUploadSuccess && <p className="text-xs font-mono font-bold text-brand-lime">{sslUploadSuccess}</p>}

                  <div className="flex justify-end pt-2">
                    <button
                      onClick={handleUploadCustomSsl}
                      disabled={isUploadingSsl || !certFile || !keyFile}
                      className="px-4 py-2 bg-brand-blue/15 hover:bg-brand-blue/25 text-brand-blue border border-brand-blue/30 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      <span>📤</span>
                      <span>{isUploadingSsl ? 'Validating & Saving...' : t('settings.ssl.uploadBtn', 'Upload & Validate Keypair')}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* CARD 5: EMAIL NOTIFICATIONS & ALERTING */}
            <div className="glass-card p-5 !rounded-2xl space-y-5">
              <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-3">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-brand-lime" />
                  <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider">
                    📧 {t('settings.notifications.title', 'EMAIL NOTIFICATIONS & ALERTING')}
                  </h4>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[var(--text-primary)]">
                    {t('settings.notifications.enableMaster', 'Enable Email Notifications System')}
                  </span>
                  <button
                    type="button"
                    onClick={() => setNotifEnabled(!notifEnabled)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${
                      notifEnabled ? 'bg-brand-lime' : 'bg-white/10'
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-black transition-transform ${
                        notifEnabled ? 'translate-x-4' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>

              <div className={`space-y-5 transition-all ${!notifEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">
                      {t('settings.notifications.smtpHost', 'SMTP Server Host / Address')}
                    </label>
                    <input
                      type="text"
                      placeholder="smtp.example.com"
                      value={smtpHost}
                      onChange={e => setSmtpHost(e.target.value)}
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime text-[var(--text-primary)] font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">
                      {t('settings.notifications.smtpPort', 'SMTP Port')}
                    </label>
                    <input
                      type="number"
                      placeholder="587"
                      value={smtpPort}
                      onChange={e => setSmtpPort(parseInt(e.target.value) || 587)}
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime text-[var(--text-primary)] font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">
                      {t('settings.notifications.smtpEncryption', 'Encryption Protocol')}
                    </label>
                    <select
                      value={smtpEncryption}
                      onChange={e => setSmtpEncryption(e.target.value)}
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime text-[var(--text-primary)] font-mono cursor-pointer"
                    >
                      <option value="tls" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">STARTTLS (Port 587 / 25)</option>
                      <option value="ssl" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">SSL / TLS (Port 465)</option>
                      <option value="none" className="bg-[var(--bg-dark)] text-[var(--text-primary)]">None / Plain Text (Port 25)</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">
                      {t('settings.notifications.smtpUser', 'SMTP Username / Auth Account')}
                    </label>
                    <input
                      type="text"
                      placeholder="notifications@example.com"
                      value={smtpUser}
                      onChange={e => setSmtpUser(e.target.value)}
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime text-[var(--text-primary)] font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">
                      {t('settings.notifications.smtpPassword', 'SMTP Password / App Secret')}
                    </label>
                    <div className="relative">
                      <input
                        type={showNotifPassword ? 'text' : 'password'}
                        placeholder="••••••••••••"
                        value={smtpPassword}
                        onChange={e => setSmtpPassword(e.target.value)}
                        className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 pr-8 text-xs outline-none focus:border-brand-lime text-[var(--text-primary)] font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNotifPassword(!showNotifPassword)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-[var(--text-primary)] text-xs cursor-pointer"
                        title={showNotifPassword ? 'Hide password' : 'Show password'}
                      >
                        {showNotifPassword ? '🙈' : '👁️'}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">
                      {t('settings.notifications.senderEmail', 'Sender Address (FROM Email)')}
                    </label>
                    <input
                      type="email"
                      placeholder="ffmpeg-alerts@example.com"
                      value={senderEmail}
                      onChange={e => setSenderEmail(e.target.value)}
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime text-[var(--text-primary)] font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">
                      {t('settings.notifications.recipientEmail', 'Recipient Address (TO Email)')}
                    </label>
                    <input
                      type="email"
                      placeholder="noc-team@example.com"
                      value={recipientEmail}
                      onChange={e => setRecipientEmail(e.target.value)}
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime text-[var(--text-primary)] font-mono"
                    />
                  </div>
                </div>

                <div className="pt-3 border-t border-[var(--glass-border)] space-y-3">
                  <h5 className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">
                    {t('settings.notifications.eventTogglesTitle', 'AUTOMATED ALERT TRIGGERS & NOTIFICATION EVENTS')}
                  </h5>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="flex items-center justify-between p-2.5 bg-[var(--input-bg)] rounded-xl border border-[var(--glass-border)]">
                      <span className="text-xs font-bold text-[var(--text-primary)]">
                        {t('settings.notifications.notifyServiceFailures', 'Service Failures (Crashes & Unexpected Restarts)')}
                      </span>
                      <button
                        type="button"
                        onClick={() => setNotifyServiceFailures(!notifyServiceFailures)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${
                          notifyServiceFailures ? 'bg-brand-lime' : 'bg-white/10'
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-black transition-transform ${
                            notifyServiceFailures ? 'translate-x-4' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    <div className="flex items-center justify-between p-2.5 bg-[var(--input-bg)] rounded-xl border border-[var(--glass-border)]">
                      <span className="text-xs font-bold text-[var(--text-primary)]">
                        {t('settings.notifications.notifyBuildResults', 'Build Results (FFmpeg Compilation Ready / Failed)')}
                      </span>
                      <button
                        type="button"
                        onClick={() => setNotifyBuildResults(!notifyBuildResults)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${
                          notifyBuildResults ? 'bg-brand-lime' : 'bg-white/10'
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-black transition-transform ${
                            notifyBuildResults ? 'translate-x-4' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    <div className="flex items-center justify-between p-2.5 bg-[var(--input-bg)] rounded-xl border border-[var(--glass-border)]">
                      <span className="text-xs font-bold text-[var(--text-primary)]">
                        {t('settings.notifications.notifyTaskFailures', 'Task Failures (Scheduled Job Errors)')}
                      </span>
                      <button
                        type="button"
                        onClick={() => setNotifyTaskFailures(!notifyTaskFailures)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${
                          notifyTaskFailures ? 'bg-brand-lime' : 'bg-white/10'
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-black transition-transform ${
                            notifyTaskFailures ? 'translate-x-4' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    <div className="flex items-center justify-between p-2.5 bg-[var(--input-bg)] rounded-xl border border-[var(--glass-border)]">
                      <span className="text-xs font-bold text-[var(--text-primary)]">
                        {t('settings.notifications.notifySslAlerts', 'SSL Alerts (Expiration Warnings & Renewals)')}
                      </span>
                      <button
                        type="button"
                        onClick={() => setNotifySslAlerts(!notifySslAlerts)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${
                          notifySslAlerts ? 'bg-brand-lime' : 'bg-white/10'
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-black transition-transform ${
                            notifySslAlerts ? 'translate-x-4' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    <div className="flex items-center justify-between p-2.5 bg-[var(--input-bg)] rounded-xl border border-[var(--glass-border)]">
                      <span className="text-xs font-bold text-[var(--text-primary)]">
                        {t('settings.notifications.notifyStorageAlerts', 'Storage Alerts (Low Disk Space Threshold Warnings)')}
                      </span>
                      <button
                        type="button"
                        onClick={() => setNotifyStorageAlerts(!notifyStorageAlerts)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${
                          notifyStorageAlerts ? 'bg-brand-lime' : 'bg-white/10'
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-black transition-transform ${
                            notifyStorageAlerts ? 'translate-x-4' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={handleTestEmail}
                      disabled={isTestingNotif || !smtpHost || !recipientEmail}
                      className="px-4 py-2 bg-brand-lime/15 hover:bg-brand-lime/25 text-brand-lime border border-brand-lime/30 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {isTestingNotif ? (
                        <>
                          <span className="w-3.5 h-3.5 border-2 border-brand-lime border-t-transparent rounded-full animate-spin" />
                          <span>{t('settings.notifications.testing', 'Testing Connection...')}</span>
                        </>
                      ) : (
                        <>
                          <span>📨</span>
                          <span>{t('settings.notifications.testButton', 'TEST SMTP CONNECTION')}</span>
                        </>
                      )}
                    </button>
                  </div>

                  {notifTestMessage && (
                    <div className={`p-3.5 rounded-xl border text-xs font-mono flex items-start gap-2.5 animate-in fade-in duration-300 ${
                      notifTestSuccess
                        ? 'bg-brand-lime/10 border-brand-lime/30 text-brand-lime'
                        : 'bg-red-500/10 border-red-500/30 text-red-400'
                    }`}>
                      <span className="text-sm shrink-0">{notifTestSuccess ? '✓' : '⚠️'}</span>
                      <div className="leading-relaxed break-words flex-1">
                        {notifTestMessage.replace(/^[✓⚠️]\s*/, '')}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: ALSA Audio */}
        {activeTab === 'alsa' && <AlsaAudioSettingsCard />}

        {/* TAB 6: Backup & Restore */}
        {activeTab === 'backup' && <BackupRestoreCard API={API} />}
      </div>

      {showRestartConfirm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-300">
          <div className="glass-card w-full max-w-md p-6 border-red-500/20 shadow-2xl space-y-4 relative">
            <h3 className="text-base font-bold text-red-400 tracking-wide uppercase flex items-center gap-2">
              ⚠️ {t('settings.restart.confirmTitle', 'Confirm Restart')}
            </h3>
            <p className="text-xs text-text-secondary leading-relaxed">
              {t('settings.restart.confirmDesc', 'Are you sure you want to restart the panel? This will temporarily interrupt connectivity to the GUI. If you changed the port, you will be redirected to the new port address.')}
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowRestartConfirm(false)}
                className="px-4 py-2 bg-white/5 hover:bg-brand-lime/15 text-brand-lime border border-brand-lime/30 shadow-sm rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer border border-white/5"
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                onClick={handleConfirmRestart}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer shadow-lg shadow-red-600/20"
              >
                {t('settings.restart.confirmBtn', 'Confirm Restart')}
              </button>
            </div>
          </div>
        </div>
      )}

      {isRestarting && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4 z-[60] animate-in fade-in duration-300">
          <div className="flex flex-col items-center space-y-4 text-center">
            <div className="relative w-12 h-12">
              <div className="absolute inset-0 rounded-full border-4 border-brand-lime/20"></div>
              <div className="absolute inset-0 rounded-full border-4 border-brand-lime border-t-transparent animate-spin"></div>
            </div>
            <div>
              <h3 className="text-base font-bold text-white uppercase tracking-wider">{t('settings.restart.restartingTitle', 'Restarting panel...')}</h3>
              <p className="text-xs text-text-secondary mt-1">
                {t('settings.restart.reconnectingPort', 'Reconnecting to port')} <span className="font-mono text-brand-lime font-bold">{settings.gui_port || 8000}</span>...
              </p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
