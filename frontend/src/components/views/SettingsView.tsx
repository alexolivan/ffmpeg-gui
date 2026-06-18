import React, { useState, useEffect } from 'react';
import { ShieldIcon } from '../Icons';

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
  const [nodeName, setNodeName] = useState(settings.node_name || '');
  const [logoText, setLogoText] = useState(settings.logo_text || '');
  const [lcdAlias, setLcdAlias] = useState(settings.lcd_alias || 'NODE-01');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    setNodeName(settings.node_name || '');
    setLogoText(settings.logo_text || '');
    setLcdAlias(settings.lcd_alias || 'NODE-01');
  }, [settings.node_name, settings.logo_text, settings.lcd_alias]);

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
  const [isSavingLcd, setIsSavingLcd] = useState(false);
  const [saveLcdSuccess, setSaveLcdSuccess] = useState(false);

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

  // Auto-scan on component mount
  useEffect(() => {
    handleProbe();
  }, []);

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

  const handleSaveLcd = async () => {
    setIsSavingLcd(true);
    setSaveLcdSuccess(false);
    try {
      await onUpdateSettings({
        ...settings,
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
      });
      setSaveLcdSuccess(true);
      setTimeout(() => setSaveLcdSuccess(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSavingLcd(false);
    }
  };

  const hasLcdChanges = 
    lcdEnabled !== (settings.lcd_enabled || false) || 
    lcdPort !== (settings.lcd_port || '/dev/ttyACM0') || 
    lcdModel !== (settings.lcd_model || 'cfa635') ||
    lcdBrightness !== (settings.lcd_brightness !== undefined && settings.lcd_brightness !== null ? settings.lcd_brightness : 100) ||
    lcdDimBrightness !== (settings.lcd_dim_brightness !== undefined && settings.lcd_dim_brightness !== null ? settings.lcd_dim_brightness : 20) ||
    lcdDimTimeout !== (settings.lcd_dim_timeout !== undefined && settings.lcd_dim_timeout !== null ? settings.lcd_dim_timeout : 30) ||
    lcdLed0Profile !== (settings.lcd_led0_profile || 'heartbeat') ||
    lcdLed1Profile !== (settings.lcd_led1_profile || 'streams') ||
    lcdLed2Profile !== (settings.lcd_led2_profile || 'tasks') ||
    lcdLed3Profile !== (settings.lcd_led3_profile || 'alert');

  const handleSaveIdentity = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      await onUpdateSettings({
        ...settings,
        node_name: nodeName,
        logo_text: logoText,
        lcd_alias: lcdAlias,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const hasIdentityChanges = 
    nodeName !== (settings.node_name || '') || 
    logoText !== (settings.logo_text || '') ||
    lcdAlias !== (settings.lcd_alias || 'NODE-01');

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl">
      <header className="mb-12">
        <h1 className="text-4xl font-bold mb-2">SETTINGS</h1>
        <p className="text-text-secondary">Node identity, security and branding</p>
      </header>

      <div className="space-y-8">
        {/* Identity Section */}
        <div className="glass-card p-8 border-brand-lime/10">
          <h3 className="text-xl font-bold mb-8 flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-brand-lime/10 flex items-center justify-center text-brand-lime text-xs font-black">ID</span>
            NODE IDENTITY
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-black text-text-secondary tracking-widest">Station Name</label>
                <input 
                  type="text" 
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-lime outline-none transition-all"
                  value={nodeName}
                  onChange={e => setNodeName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-black text-text-secondary tracking-widest">Logo Abbreviation</label>
                <input 
                  type="text" 
                  maxLength={3}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-lime outline-none transition-all uppercase"
                  value={logoText}
                  onChange={e => setLogoText(e.target.value.toUpperCase())}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-black text-text-secondary tracking-widest">LCD / Node Alias</label>
                <input 
                  type="text" 
                  maxLength={12}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-lime outline-none transition-all"
                  value={lcdAlias}
                  onChange={e => {
                    const val = e.target.value.replace(/[^a-zA-Z0-9\s-_]/g, '').slice(0, 12);
                    setLcdAlias(val);
                  }}
                  placeholder="e.g. NODE-01"
                />
              </div>
            </div>

            <div className="space-y-2 flex flex-col items-center justify-center border-2 border-dashed border-white/10 rounded-2xl p-4 hover:border-brand-lime transition-all relative group cursor-pointer">
              <label className="absolute inset-0 cursor-pointer flex flex-col items-center justify-center w-full h-full z-10">
                <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
              </label>
              {settings.logo_path ? (
                <div className="relative w-24 h-24 flex items-center justify-center">
                  <img src={`${API}${settings.logo_path}`} alt="Custom Logo" className="max-w-full max-h-full object-contain" />
                </div>
              ) : (
                <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mb-2 shadow-lg group-hover:scale-110 transition-transform">
                  <span className="text-white font-black text-2xl uppercase">{logoText || 'FF'}</span>
                </div>
              )}
              <div className="text-[10px] uppercase font-bold text-text-secondary mt-2 text-center">
                {settings.logo_path ? 'Click to change logo' : 'Upload custom logo'}
              </div>
            </div>

            <div className="md:col-span-2 flex justify-end pt-4 border-t border-white/5">
              <button
                onClick={handleSaveIdentity}
                disabled={isSaving || !hasIdentityChanges}
                className={`pill-button font-black text-xs py-2.5 px-6 transition-all ${
                  hasIdentityChanges
                    ? 'bg-brand-lime text-black hover:scale-[1.02] shadow-lg shadow-brand-lime/20'
                    : 'bg-white/5 text-white/40 cursor-not-allowed border border-white/5'
                }`}
              >
                {isSaving ? 'SAVING...' : saveSuccess ? '✓ SAVED' : 'SAVE IDENTITY'}
              </button>
            </div>
          </div>
        </div>

        {/* LCD Integration Section */}
        <div className="glass-card p-8 border-brand-lime/10">
          <h3 className="text-xl font-bold mb-8 flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-brand-lime/10 flex items-center justify-center text-brand-lime text-xs font-black">LCD</span>
            LCD CONTROL PANEL
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/5">
                <div>
                  <h4 className="text-sm font-bold text-white">Enable LCD display</h4>
                  <p className="text-[10px] text-text-secondary">Control FFMPEG-GUI via hardware screen</p>
                </div>
                <button
                  onClick={() => setLcdEnabled(!lcdEnabled)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    lcdEnabled ? 'bg-brand-lime' : 'bg-white/10'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-black transition-transform ${
                      lcdEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] uppercase font-black text-text-secondary tracking-widest">LCD Model</label>
                <select
                  value={lcdModel}
                  onChange={e => setLcdModel(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-lime outline-none transition-all text-white"
                >
                  <option value="cfa635" className="bg-black text-white">Crystalfontz CFA-635 / CFA-735</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] uppercase font-black text-text-secondary tracking-widest">Serial Port</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="/dev/ttyACM0"
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl p-3 focus:border-brand-lime outline-none transition-all text-white"
                    value={lcdPort}
                    onChange={e => setLcdPort(e.target.value)}
                  />
                  <button
                    onClick={handleProbe}
                    disabled={isProbing}
                    className="px-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 font-bold text-xs uppercase tracking-widest transition-all text-white"
                  >
                    {isProbing ? 'Scanning...' : 'Scan'}
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 h-full flex flex-col justify-between">
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider mb-2 text-white">Auto-Detected Devices</h4>
                  {probeResults.length === 0 && (!settings.lcd_enabled || !settings.lcd_port) ? (
                    <p className="text-[10px] text-text-secondary italic">No LCD devices detected. Click "Scan" to probe active COM ports.</p>
                  ) : (
                    <div className="space-y-2">
                      {settings.lcd_enabled && settings.lcd_port && !probeResults.some(p => p.port === settings.lcd_port) && (
                        <div
                          onClick={() => setLcdPort(settings.lcd_port)}
                          className={`p-3 border rounded-xl flex items-center justify-between cursor-pointer transition-all ${
                            lcdPort === settings.lcd_port
                              ? 'bg-brand-lime/20 border-brand-lime/40'
                              : 'bg-white/5 border-white/10 hover:bg-white/10'
                          }`}
                        >
                          <div>
                            <div className="text-xs font-bold text-brand-lime">{settings.lcd_port}</div>
                            <div className="text-[9px] text-text-secondary">Configured Device (Active)</div>
                          </div>
                          <span className="text-[9px] font-black uppercase bg-brand-lime text-black px-2 py-0.5 rounded">
                            {settings.lcd_model || 'cfa635'}
                          </span>
                        </div>
                      )}

                      {probeResults.map((p: any, idx: number) => (
                        <div
                          key={idx}
                          onClick={() => setLcdPort(p.port)}
                          className={`p-3 border rounded-xl flex items-center justify-between cursor-pointer transition-all ${
                            lcdPort === p.port
                              ? 'bg-brand-lime/20 border-brand-lime/40'
                              : 'bg-white/5 border-white/10 hover:bg-white/10'
                          }`}
                        >
                          <div>
                            <div className="text-xs font-bold text-brand-lime">{p.port}</div>
                            <div className="text-[9px] text-text-secondary">{p.description}</div>
                          </div>
                          <span className="text-[9px] font-black uppercase bg-brand-lime text-black px-2 py-0.5 rounded">
                            {p.driver}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                
                <p className="text-[9px] text-text-secondary italic mt-4">
                  Note: The driver communicates using 115200 baud. Make sure the user running the ffmpeg-gui service has read/write permissions for the selected serial port (e.g. dialout group).
                </p>
              </div>
            </div>

            {/* Backlight Settings */}
            <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-6 pt-6 border-t border-white/5">
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-black text-text-secondary tracking-widest">Active Brightness ({lcdBrightness}%)</label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-brand-lime"
                  value={lcdBrightness}
                  onChange={e => setLcdBrightness(Number(e.target.value))}
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] uppercase font-black text-text-secondary tracking-widest">Dimmed Brightness ({lcdDimBrightness}%)</label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-brand-lime"
                  value={lcdDimBrightness}
                  onChange={e => setLcdDimBrightness(Number(e.target.value))}
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] uppercase font-black text-text-secondary tracking-widest">Dim Timeout (seconds)</label>
                <input
                  type="number"
                  min="5"
                  max="3600"
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 focus:border-brand-lime outline-none transition-all text-white text-xs"
                  value={lcdDimTimeout}
                  onChange={e => setLcdDimTimeout(Number(e.target.value))}
                />
              </div>
            </div>

            {/* LED Profiles */}
            <div className="md:col-span-2 space-y-4 pt-6 border-t border-white/5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-white">Status LED Profiles</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <label className="text-[9px] uppercase font-black text-text-secondary tracking-widest">LED 0 (Top)</label>
                  <select
                    value={lcdLed0Profile}
                    onChange={e => setLcdLed0Profile(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 focus:border-brand-lime outline-none transition-all text-white text-xs"
                  >
                    <option value="heartbeat" className="bg-black text-white">Heartbeat (Green blink)</option>
                    <option value="streams" className="bg-black text-white">Streams / Services</option>
                    <option value="tasks" className="bg-black text-white">Tasks (Last 24h)</option>
                    <option value="alert" className="bg-black text-white">Alert (CPU/RAM)</option>
                    <option value="disabled" className="bg-black text-white">Disabled</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[9px] uppercase font-black text-text-secondary tracking-widest">LED 1</label>
                  <select
                    value={lcdLed1Profile}
                    onChange={e => setLcdLed1Profile(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 focus:border-brand-lime outline-none transition-all text-white text-xs"
                  >
                    <option value="heartbeat" className="bg-black text-white">Heartbeat (Green blink)</option>
                    <option value="streams" className="bg-black text-white">Streams / Services</option>
                    <option value="tasks" className="bg-black text-white">Tasks (Last 24h)</option>
                    <option value="alert" className="bg-black text-white">Alert (CPU/RAM)</option>
                    <option value="disabled" className="bg-black text-white">Disabled</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[9px] uppercase font-black text-text-secondary tracking-widest">LED 2</label>
                  <select
                    value={lcdLed2Profile}
                    onChange={e => setLcdLed2Profile(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 focus:border-brand-lime outline-none transition-all text-white text-xs"
                  >
                    <option value="heartbeat" className="bg-black text-white">Heartbeat (Green blink)</option>
                    <option value="streams" className="bg-black text-white">Streams / Services</option>
                    <option value="tasks" className="bg-black text-white">Tasks (Last 24h)</option>
                    <option value="alert" className="bg-black text-white">Alert (CPU/RAM)</option>
                    <option value="disabled" className="bg-black text-white">Disabled</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[9px] uppercase font-black text-text-secondary tracking-widest">LED 3 (Bottom)</label>
                  <select
                    value={lcdLed3Profile}
                    onChange={e => setLcdLed3Profile(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 focus:border-brand-lime outline-none transition-all text-white text-xs"
                  >
                    <option value="heartbeat" className="bg-black text-white">Heartbeat (Green blink)</option>
                    <option value="streams" className="bg-black text-white">Streams / Services</option>
                    <option value="tasks" className="bg-black text-white">Tasks (Last 24h)</option>
                    <option value="alert" className="bg-black text-white">Alert (CPU/RAM)</option>
                    <option value="disabled" className="bg-black text-white">Disabled</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="md:col-span-2 flex justify-end pt-4 border-t border-white/5">
              <button
                onClick={handleSaveLcd}
                disabled={isSavingLcd || !hasLcdChanges}
                className={`pill-button font-black text-xs py-2.5 px-6 transition-all ${
                  hasLcdChanges
                    ? 'bg-brand-lime text-black hover:scale-[1.02] shadow-lg shadow-brand-lime/20'
                    : 'bg-white/5 text-white/40 cursor-not-allowed border border-white/5'
                }`}
              >
                {isSavingLcd ? 'SAVING...' : saveLcdSuccess ? '✓ SAVED' : 'SAVE LCD CONFIG'}
              </button>
            </div>
          </div>
        </div>

        {/* Security Section */}
        <div className="glass-card p-8 border-red-500/10">
          <h3 className="text-xl font-bold mb-8 flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center text-red-500">
              <ShieldIcon size={16} />
            </span>
            SECURITY & ACCESS
          </h3>
          <div className="max-w-md space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] uppercase font-black text-text-secondary tracking-widest">New Password</label>
              <input 
                type="password" 
                placeholder="Leave empty to remove password"
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-red-500 outline-none transition-all"
                value={newPassword}
                onChange={e => { setNewPassword(e.target.value); setPasswordError(''); setPasswordSuccess('') }}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] uppercase font-black text-text-secondary tracking-widest">Confirm Password</label>
              <input 
                type="password" 
                placeholder="Confirm new password"
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:border-red-500 outline-none transition-all"
                value={confirmPassword}
                onChange={e => { setConfirmPassword(e.target.value); setPasswordError(''); setPasswordSuccess('') }}
              />
            </div>
            
            {passwordError && <p className="text-[10px] text-red-500 font-bold">{passwordError}</p>}
            {passwordSuccess && <p className="text-[10px] text-brand-lime font-bold">{passwordSuccess}</p>}

            <button 
              onClick={() => {
                if (newPassword !== confirmPassword) {
                  setPasswordError('Passwords do not match');
                  return;
                }
                onUpdateSettings({...settings, gui_password: newPassword});
                setPasswordSuccess('Password updated successfully');
                setNewPassword('');
                setConfirmPassword('');
              }}
              className="pill-button bg-red-500/20 text-red-400 text-xs py-2.5 w-full mt-2 hover:bg-red-500/30">
              UPDATE PASSWORD
            </button>

            <p className="text-[10px] text-text-secondary italic mt-4">
              Protect your FFmpeg node from unauthorized command execution.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
