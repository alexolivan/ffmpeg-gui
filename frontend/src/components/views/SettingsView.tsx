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
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    setNodeName(settings.node_name || '');
    setLogoText(settings.logo_text || '');
  }, [settings.node_name, settings.logo_text]);

  const handleSaveIdentity = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      await onUpdateSettings({
        ...settings,
        node_name: nodeName,
        logo_text: logoText,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const hasIdentityChanges = nodeName !== (settings.node_name || '') || logoText !== (settings.logo_text || '');

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
