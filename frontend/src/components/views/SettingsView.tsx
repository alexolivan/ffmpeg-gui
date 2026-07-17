import React, { useState, useEffect } from 'react';
import { ShieldIcon, GearIcon, SlidersIcon, ServerIcon, PencilIcon, TrashIcon } from '../Icons';

const STORAGE_TYPES = ['build', 'media', 'hls', 'logs', 'sdk', 'preview'] as const;

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
  const [activeTab, setActiveTab] = useState<'general' | 'lcd' | 'storage' | 'security'>('general');

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
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);

  useEffect(() => {
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
  }, [
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
    settings.logging_retention_days
  ]);

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

  // Auto-scan on component mount
  useEffect(() => {
    handleProbe();
  }, []);

  const hasChanges = 
    nodeName !== (settings.node_name || '') || 
    logoText !== (settings.logo_text || '') ||
    lcdAlias !== (settings.lcd_alias || 'NODE-01') ||
    Number(guiPort) !== Number(settings.gui_port || 8000) ||
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
    newPassword !== '' ||
    confirmPassword !== '';

  const handleSaveAll = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    setPasswordError('');
    setPasswordSuccess('');

    if (newPassword || confirmPassword) {
      if (newPassword !== confirmPassword) {
        setPasswordError('Las contraseñas no coinciden');
        setIsSaving(false);
        return;
      }
    }

    try {
      const payload: any = {
        ...settings,
        node_name: nodeName,
        logo_text: logoText,
        lcd_alias: lcdAlias,
        gui_port: Number(guiPort),
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
      };

      if (newPassword !== '') {
        payload.gui_password = newPassword;
      }

      await onUpdateSettings(payload);
      
      setSaveSuccess(true);
      if (newPassword !== '') {
        setPasswordSuccess('Contraseña actualizada con éxito');
      }
      
      setNewPassword('');
      setConfirmPassword('');
      
      setTimeout(() => {
        setSaveSuccess(false);
        setPasswordSuccess('');
      }, 3000);
    } catch (err) {
      console.error(err);
      setPasswordError('Error al guardar la configuración');
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
      alert("Failed to trigger panel restart.");
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
          <h1 className="text-2xl font-black tracking-tight text-white mb-0.5 uppercase">Settings</h1>
          <p className="text-xs text-text-secondary">Node identity, security and hardware branding configuration</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Status Indicator */}
          <div className="text-[10px] text-text-secondary font-medium">
            {saveSuccess ? (
              <span className="text-brand-lime font-bold animate-pulse">✓ Settings saved.</span>
            ) : passwordError ? (
              <span className="text-red-500 font-bold">⚠️ Check Security errors.</span>
            ) : hasChanges ? (
              <span className="text-brand-orange font-bold">● Unsaved changes.</span>
            ) : (
              <span className="opacity-40">Up to date.</span>
            )}
          </div>
          <button
            onClick={() => setShowRestartConfirm(true)}
            className="border border-red-500/30 text-red-400 bg-red-500/10 hover:bg-red-500/20 active:scale-95 pill-button font-black text-xs py-2 px-4 transition-all uppercase tracking-widest cursor-pointer"
          >
            Restart Panel
          </button>
          <button
            onClick={handleSaveAll}
            disabled={isSaving || !hasChanges}
            className={`pill-button font-black text-xs py-2.5 px-6 transition-all uppercase tracking-widest ${
              hasChanges && !isSaving
                ? 'bg-brand-lime text-black hover:scale-[1.02] active:scale-[0.98] cursor-pointer shadow-lg shadow-brand-lime/20'
                : 'bg-white/5 text-white/40 cursor-not-allowed border border-white/5'
            }`}
          >
            {isSaving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </header>

      {/* Tabs selector */}
      <div className="flex gap-1 mb-3 shrink-0 border-b border-white/5 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('general')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
            activeTab === 'general'
              ? 'bg-white/10 text-white'
              : 'text-text-secondary hover:bg-white/5 hover:text-white/70'
          }`}
        >
          <GearIcon size={14} />
          General
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('lcd')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
            activeTab === 'lcd'
              ? 'bg-white/10 text-white'
              : 'text-text-secondary hover:bg-white/5 hover:text-white/70'
          }`}
        >
          <SlidersIcon size={14} />
          LCD Display
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('storage')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
            activeTab === 'storage'
              ? 'bg-white/10 text-white'
              : 'text-text-secondary hover:bg-white/5 hover:text-white/70'
          }`}
        >
          <ServerIcon size={14} />
          Storage
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('security')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
            activeTab === 'security'
              ? 'bg-white/10 text-white'
              : 'text-text-secondary hover:bg-white/5 hover:text-white/70'
          }`}
        >
          <ShieldIcon size={14} />
          Security
        </button>
      </div>

      {/* Tab content wrapper (Scrollable area) */}
      <div className="flex-1 overflow-y-auto pr-2 min-h-0 custom-scrollbar space-y-3 pb-4">
        {settings.restart_required && (
          <div className="bg-brand-orange/10 border border-brand-orange/30 text-brand-orange rounded-xl p-3.5 text-xs flex items-center gap-3 animate-in fade-in duration-300">
            <span className="text-lg">⚠️</span>
            <div className="flex-1">
              <span className="font-bold uppercase tracking-wider block mb-0.5 text-[10px]">Restart Required</span>
              <span>A restart is required to apply the new GUI Port configuration. Click the 'Restart Panel' button to apply.</span>
            </div>
          </div>
        )}
        
        {/* TAB 1: General */}
        {activeTab === 'general' && (
          <>
            <div className="glass-card p-4 !rounded-2xl space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center gap-1.5 border-b border-white/5 pb-2 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-lime" />
                <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider">Branding & Node Identity</h4>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">Station Name</label>
                    <input 
                      type="text" 
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all"
                      value={nodeName}
                      onChange={e => setNodeName(e.target.value)}
                      placeholder="e.g. Primary Transcode Node"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">Logo Abbreviation</label>
                    <input 
                      type="text" 
                      maxLength={3}
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all uppercase font-bold tracking-widest text-brand-lime"
                      value={logoText}
                      onChange={e => setLogoText(e.target.value.toUpperCase())}
                      placeholder="e.g. FFG"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">LCD / Node Alias</label>
                    <input 
                      type="text" 
                      maxLength={12}
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all font-mono"
                      value={lcdAlias}
                      onChange={e => {
                        const val = e.target.value.replace(/[^a-zA-Z0-9\s-_]/g, '').slice(0, 12);
                        setLcdAlias(val);
                      }}
                      placeholder="e.g. NODE-01"
                    />
                  </div>
                </div>

                <div className="flex flex-col items-center justify-center border-2 border-dashed border-white/10 rounded-xl p-4 hover:border-brand-lime transition-all relative group cursor-pointer h-full min-h-[140px] bg-white/[0.01]">
                  <label className="absolute inset-0 cursor-pointer flex flex-col items-center justify-center w-full h-full z-10">
                    <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                  </label>
                  {settings.logo_path ? (
                    <div className="relative w-20 h-20 flex items-center justify-center">
                      <img src={`${API}${settings.logo_path}`} alt="Custom Logo" className="max-w-full max-h-full object-contain" />
                    </div>
                  ) : (
                    <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform">
                      <span className="text-white font-black text-lg uppercase tracking-wider">{logoText || 'FF'}</span>
                    </div>
                  )}
                  <div className="text-[9px] uppercase font-bold text-text-secondary mt-2.5 text-center tracking-wider">
                    {settings.logo_path ? 'Click to change logo' : 'Upload custom logo'}
                  </div>
                </div>
              </div>
            </div>

            {/* Card 2: Network Settings */}
            <div className="glass-card p-4 !rounded-2xl space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center gap-1.5 border-b border-white/5 pb-2 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-lime" />
                <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider">Network Settings</h4>
              </div>
              
              <div className="max-w-xs space-y-1">
                <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">GUI Listen Port</label>
                <input 
                  type="number" 
                  min={1}
                  max={65535}
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all font-mono"
                  value={guiPort}
                  onChange={e => setGuiPort(Number(e.target.value))}
                />
                <p className="text-[9px] text-text-secondary leading-tight italic mt-1">
                  The network port on which this dashboard listens for connection requests.
                </p>
              </div>
            </div>

            {/* Card 3: Logging Configuration */}
            <div className="glass-card p-4 !rounded-2xl space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center gap-1.5 border-b border-white/5 pb-2 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-lime" />
                <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider">LOGGING CONFIGURATION</h4>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">Mode</label>
                    <select
                      value={loggingMode}
                      onChange={e => setLoggingMode(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all text-white"
                    >
                      <option value="journalctl" className="bg-black text-white">journalctl (journald console)</option>
                      <option value="file" className="bg-black text-white">file (log file only)</option>
                      <option value="both" className="bg-black text-white">both (console + log file)</option>
                    </select>
                  </div>

                  {(loggingMode === 'file' || loggingMode === 'both') && (
                    <>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">Log Storage</label>
                        <select
                          value={loggingStorageId}
                          onChange={e => setLoggingStorageId(e.target.value === '' ? '' : Number(e.target.value))}
                          className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all text-white"
                        >
                          <option value="" className="bg-black text-white">Select a Log Storage...</option>
                          {storages.filter(s => s.type === 'logs').map(s => (
                            <option key={s.id} value={s.id} className="bg-black text-white">
                              {s.name} ({s.path})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">Relative Path</label>
                        <input
                          type="text"
                          className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all text-white font-mono"
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
                    <div className="flex items-center justify-between p-2.5 bg-white/5 rounded-xl border border-white/5">
                      <div>
                        <h4 className="text-xs font-bold text-white">Enable Rotation</h4>
                        <p className="text-[9px] text-text-secondary leading-snug">Limit file size and retain archives</p>
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
                          <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">Max Bytes</label>
                          <input
                            type="number"
                            min={0}
                            className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all text-white font-mono"
                            value={loggingRotationMaxBytes}
                            onChange={e => setLoggingRotationMaxBytes(Number(e.target.value))}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">Backup Count</label>
                          <input
                            type="number"
                            min={0}
                            className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all text-white font-mono"
                            value={loggingRotationBackupCount}
                            onChange={e => setLoggingRotationBackupCount(Number(e.target.value))}
                          />
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between p-2.5 bg-white/5 rounded-xl border border-white/5">
                      <div>
                        <h4 className="text-xs font-bold text-white">Enable Compression</h4>
                        <p className="text-[9px] text-text-secondary leading-snug">Compress backup logs (.gz)</p>
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
                      <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">Retention Days</label>
                      <input
                        type="number"
                        min={0}
                        className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all text-white font-mono"
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
              <div className="flex items-center gap-1.5 border-b border-white/5 pb-2 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-lime" />
                <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider">LCD display & Serial Driver</h4>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-2.5 bg-white/5 rounded-xl border border-white/5">
                    <div>
                      <h4 className="text-xs font-bold text-white">Enable LCD Display</h4>
                      <p className="text-[9px] text-text-secondary leading-snug">Control status via hardware panel</p>
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
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">LCD Model</label>
                    <select
                      value={lcdModel}
                      onChange={e => setLcdModel(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all text-white"
                    >
                      <option value="cfa635" className="bg-black text-white">Crystalfontz CFA-635 / CFA-735</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">Serial Port</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="e.g. /dev/ttyACM0"
                        className="flex-1 bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all text-white font-mono"
                        value={lcdPort}
                        onChange={e => setLcdPort(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={handleProbe}
                        disabled={isProbing}
                        className="px-3 bg-white/10 border border-white/10 rounded-lg hover:bg-white/20 font-bold text-[10px] uppercase tracking-wider transition-all text-white cursor-pointer"
                      >
                        {isProbing ? 'Scanning...' : 'Scan'}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="bg-white/5 border border-white/10 rounded-xl p-3 flex flex-col justify-between min-h-[140px]">
                  <div>
                    <h4 className="text-[9px] font-bold uppercase tracking-wider mb-1.5 text-text-secondary">Auto-Detected Serial Ports</h4>
                    {probeResults.length === 0 && (!settings.lcd_enabled || !settings.lcd_port) ? (
                      <p className="text-[10px] text-text-secondary italic leading-normal">No active serial displays detected. Click "Scan" to probe COM ports.</p>
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
                              <div className="text-[8px] text-text-secondary leading-none mt-0.5">Configured Port (Active)</div>
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
                    Make sure the service user is in the Dialout group to permit raw serial operations.
                  </p>
                </div>
              </div>

              {/* Backlight / LEDs */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-white/5">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">Active Brightness ({lcdBrightness}%)</label>
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
                  <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">Dimmed Brightness ({lcdDimBrightness}%)</label>
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
                  <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">Dim Timeout (sec)</label>
                  <input
                    type="number"
                    min="5"
                    max="3600"
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 text-xs outline-none focus:border-brand-lime transition-all text-white font-mono"
                    value={lcdDimTimeout}
                    onChange={e => setLcdDimTimeout(Number(e.target.value))}
                  />
                </div>
              </div>
            </div>

            <div className="glass-card p-4 !rounded-2xl space-y-3">
              <div className="flex items-center gap-1.5 border-b border-white/5 pb-2 mb-1">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-orange" />
                <h4 className="text-brand-orange font-bold text-xs uppercase tracking-wider">Status LED Profiles</h4>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block">LED 0 (Top)</label>
                  <select
                    value={lcdLed0Profile}
                    onChange={e => setLcdLed0Profile(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 focus:border-brand-lime outline-none text-white text-xs"
                  >
                    <option value="heartbeat" className="bg-black text-white">Heartbeat (Blink)</option>
                    <option value="streams" className="bg-black text-white">Streams Status</option>
                    <option value="tasks" className="bg-black text-white">Task Events</option>
                    <option value="alert" className="bg-black text-white">CPU Alert</option>
                    <option value="disabled" className="bg-black text-white">Disabled</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block">LED 1</label>
                  <select
                    value={lcdLed1Profile}
                    onChange={e => setLcdLed1Profile(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 focus:border-brand-lime outline-none text-white text-xs"
                  >
                    <option value="heartbeat" className="bg-black text-white">Heartbeat (Blink)</option>
                    <option value="streams" className="bg-black text-white">Streams Status</option>
                    <option value="tasks" className="bg-black text-white">Task Events</option>
                    <option value="alert" className="bg-black text-white">CPU Alert</option>
                    <option value="disabled" className="bg-black text-white">Disabled</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block">LED 2</label>
                  <select
                    value={lcdLed2Profile}
                    onChange={e => setLcdLed2Profile(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 focus:border-brand-lime outline-none text-white text-xs"
                  >
                    <option value="heartbeat" className="bg-black text-white">Heartbeat (Blink)</option>
                    <option value="streams" className="bg-black text-white">Streams Status</option>
                    <option value="tasks" className="bg-black text-white">Task Events</option>
                    <option value="alert" className="bg-black text-white">CPU Alert</option>
                    <option value="disabled" className="bg-black text-white">Disabled</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block">LED 3 (Bottom)</label>
                  <select
                    value={lcdLed3Profile}
                    onChange={e => setLcdLed3Profile(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-1.5 focus:border-brand-lime outline-none text-white text-xs"
                  >
                    <option value="heartbeat" className="bg-black text-white">Heartbeat (Blink)</option>
                    <option value="streams" className="bg-black text-white">Streams Status</option>
                    <option value="tasks" className="bg-black text-white">Task Events</option>
                    <option value="alert" className="bg-black text-white">CPU Alert</option>
                    <option value="disabled" className="bg-black text-white">Disabled</option>
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
                <div className="flex items-center gap-1.5 border-b border-white/5 pb-2 mb-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-lime" />
                  <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider">Add Storage Drive</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">Storage Name</label>
                    <input
                      type="text"
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all text-white"
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      placeholder="e.g. Fast SSD Media Storage"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">Storage Type</label>
                    <select
                      value={newType}
                      onChange={e => setNewType(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all text-white"
                    >
                      <option value="build" className="bg-black text-white">build (FFmpeg Build Cache)</option>
                      <option value="media" className="bg-black text-white">media (Input Videos/Music)</option>
                      <option value="hls" className="bg-black text-white">hls (HLS Output Segments)</option>
                      <option value="logs" className="bg-black text-white">logs (FFmpeg/System Logs)</option>
                      <option value="sdk" className="bg-black text-white">sdk (DeckLink/NDI SDKs)</option>
                      <option value="preview" className="bg-black text-white">preview (Snapshot Thumbnails)</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">Absolute Directory Path</label>
                    <input
                      type="text"
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all font-mono text-white"
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
                    {isAddingValidating ? 'Validating...' : 'Validate Path'}
                  </button>
                  <button
                    type="button"
                    disabled={isAdding || !newName.trim() || !newPath.trim()}
                    onClick={handleAddStorage}
                    className={`px-5 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition-all ${
                      newName.trim() && newPath.trim() && !isAdding
                        ? 'bg-brand-lime text-black hover:scale-[1.02] active:scale-[0.98] cursor-pointer'
                        : 'bg-white/5 text-white/40 cursor-not-allowed border border-white/5'
                    }`}
                  >
                    {isAdding ? 'Saving...' : 'Save Storage'}
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
                        <div className="flex items-center justify-between border-b border-white/5 pb-2">
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-brand-orange" />
                            <h4 className="text-white font-bold text-xs uppercase tracking-wider">{type} STorage Drives</h4>
                          </div>
                          <span className="text-[10px] font-mono text-text-secondary bg-white/5 px-2 py-0.5 rounded">
                            {typeStorages.length} configured
                          </span>
                        </div>

                        {typeStorages.length === 0 ? (
                          <div className="py-4 text-center text-xs text-text-secondary italic">
                            No storage drives registered for this category.
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
                                          <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block">Storage Name</label>
                                          <input
                                            type="text"
                                            className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all text-white"
                                            value={editName}
                                            onChange={e => setEditName(e.target.value)}
                                          />
                                        </div>
                                        <div className="space-y-1">
                                          <label className="text-[9px] uppercase font-bold text-text-secondary tracking-wider block">Directory Path</label>
                                          <input
                                            type="text"
                                            className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none focus:border-brand-lime transition-all font-mono text-white"
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
                                          className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/5 rounded-lg font-bold text-[10px] uppercase tracking-wider transition-all text-white cursor-pointer"
                                        >
                                          {isEditValidating ? 'Validating...' : 'Validate Path'}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setEditingId(null)}
                                          className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/5 rounded-lg font-bold text-[10px] uppercase tracking-wider transition-all text-text-secondary cursor-pointer"
                                        >
                                          Cancel
                                        </button>
                                        <button
                                          type="button"
                                          disabled={isSavingEdit}
                                          onClick={() => handleSaveEdit(s.id)}
                                          className="px-4 py-1.5 bg-brand-lime text-black rounded-lg font-bold text-[10px] uppercase tracking-wider transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                                        >
                                          {isSavingEdit ? 'Saving...' : 'Save'}
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    /* Standard Display Mode */
                                    <div className="space-y-2.5">
                                      <div className="flex items-start justify-between">
                                        <div className="space-y-1 pr-4 min-w-0 flex-1">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-bold text-sm text-white truncate max-w-[240px]" title={s.name}>
                                              {s.name}
                                            </span>
                                            <span className="text-[9px] font-black uppercase bg-brand-orange/20 text-brand-orange px-2 py-0.5 rounded tracking-wider">
                                              {s.type}
                                            </span>
                                            {s.is_default && (
                                              <span className="text-[9px] font-black uppercase bg-brand-lime text-black px-1.5 py-0.5 rounded tracking-widest">
                                                DEFAULT
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
                                            className={`p-1.5 rounded bg-white/5 border border-white/5 hover:bg-white/10 transition-all text-white cursor-pointer ${
                                              s.is_default ? 'opacity-30 cursor-not-allowed' : ''
                                            }`}
                                            title={s.is_default ? 'Cannot edit default storage' : 'Edit Storage'}
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
                                            title={s.is_default ? 'Cannot delete default storage' : 'Delete Storage'}
                                          >
                                            <TrashIcon size={12} />
                                          </button>
                                        </div>
                                      </div>

                                      {/* Space Utilization Details */}
                                      <div className="space-y-1">
                                        <div className="flex justify-between items-center text-[10px] font-bold text-text-secondary">
                                          <span>Space Utilization</span>
                                          <span className="font-mono text-white">
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

        {/* TAB 3: Security & Access */}
        {activeTab === 'security' && (
          <div className="glass-card p-4 !rounded-2xl space-y-4 animate-in fade-in duration-300">
            <div className="flex items-center gap-1.5 border-b border-white/5 pb-2 mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              <h4 className="text-red-400 font-bold text-xs uppercase tracking-wider">Security & Access</h4>
            </div>

            <div className="max-w-md space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">New Password</label>
                <input 
                  type="password" 
                  placeholder="Leave empty to remove password"
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none focus:border-red-500 transition-all"
                  value={newPassword}
                  onChange={e => { setNewPassword(e.target.value); setPasswordError(''); setPasswordSuccess('') }}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">Confirm Password</label>
                <input 
                  type="password" 
                  placeholder="Confirm new password"
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none focus:border-red-500 transition-all"
                  value={confirmPassword}
                  onChange={e => { setConfirmPassword(e.target.value); setPasswordError(''); setPasswordSuccess('') }}
                />
              </div>
              
              {passwordError && <p className="text-[10px] text-red-500 font-bold mt-1">{passwordError}</p>}
              {passwordSuccess && <p className="text-[10px] text-brand-lime font-bold mt-1">{passwordSuccess}</p>}
              
              <p className="text-[9px] text-text-secondary leading-tight italic">
                Protect your FFmpeg node dashboard from unauthorized stream modifications or command execution.
              </p>
            </div>
          </div>
        )}
      </div>

      {showRestartConfirm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-300">
          <div className="glass-card w-full max-w-md p-6 border-red-500/20 shadow-2xl space-y-4 relative">
            <h3 className="text-base font-bold text-red-400 tracking-wide uppercase flex items-center gap-2">
              ⚠️ Confirm Restart
            </h3>
            <p className="text-xs text-text-secondary leading-relaxed">
              Are you sure you want to restart the panel? This will temporarily interrupt connectivity to the GUI. If you changed the port, you will be redirected to the new port address.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowRestartConfirm(false)}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer border border-white/5"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRestart}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer shadow-lg shadow-red-600/20"
              >
                Confirm Restart
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
              <h3 className="text-base font-bold text-white uppercase tracking-wider">Restarting panel...</h3>
              <p className="text-xs text-text-secondary mt-1">
                Reconnecting to port <span className="font-mono text-brand-lime font-bold">{settings.gui_port || 8000}</span>...
              </p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
