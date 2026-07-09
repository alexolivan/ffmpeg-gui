import React, { useState, useEffect } from 'react';
import { ShieldIcon, GearIcon, SlidersIcon } from '../Icons';

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
  const [activeTab, setActiveTab] = useState<'general' | 'lcd' | 'security'>('general');
  const [nodeName, setNodeName] = useState(settings.node_name || '');
  const [logoText, setLogoText] = useState(settings.logo_text || '');
  const [lcdAlias, setLcdAlias] = useState(settings.lcd_alias || 'NODE-01');
  const [guiPort, setGuiPort] = useState(settings.gui_port || 8000);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);

  useEffect(() => {
    setNodeName(settings.node_name || '');
    setLogoText(settings.logo_text || '');
    setLcdAlias(settings.lcd_alias || 'NODE-01');
    setGuiPort(settings.gui_port || 8000);
  }, [settings.node_name, settings.logo_text, settings.lcd_alias, settings.gui_port]);

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
