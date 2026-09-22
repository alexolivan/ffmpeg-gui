import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from './hooks/useAuth';
import { AuthenticatedDashboard } from './components/AuthenticatedDashboard';

const API = '';

function App() {
  const { t } = useTranslation();

  const {
    authStatus,
    isAuthChecking,
    settings,
    isAuthenticated,
    loginPass,
    setLoginPass,
    isLoginError,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    passwordError,
    setPasswordError,
    passwordSuccess,
    setPasswordSuccess,
    handleUpdateSettings,
    handleLogoUpload,
    handleLogin,
    handleLogout,
  } = useAuth();

  useEffect(() => {
    // 1. Update document title
    const activeNodeName = authStatus?.node_name || settings.lcd_alias || settings.node_name || 'FFMPEG-GUI';
    document.title = activeNodeName;

    // 2. Update favicon
    let link: HTMLLinkElement | null = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    
    const activeLogoPath = authStatus?.logo_path || settings.logo_path;
    if (activeLogoPath) {
      link.href = `${API}${activeLogoPath}`;
    } else {
      const accent = authStatus?.accent_color || settings.accent_color || '#FF6B00';
      const text = (authStatus?.logo_text || settings.logo_text || 'FF').toUpperCase().slice(0, 3);
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
          <rect width="32" height="32" rx="8" fill="${accent}" />
          <text x="50%" y="55%" dominant-baseline="central" text-anchor="middle" fill="#000000" font-family="sans-serif" font-size="12" font-weight="900">
            ${text}
          </text>
        </svg>
      `.trim();
      link.href = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }
  }, [
    authStatus?.node_name,
    authStatus?.logo_path,
    authStatus?.logo_text,
    authStatus?.accent_color,
    settings.lcd_alias,
    settings.node_name,
    settings.logo_path,
    settings.logo_text,
    settings.accent_color,
  ]);

  // ── Render Checking / Loading Screen ────────────────────────────
  if (isAuthChecking) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg-dark)] text-[var(--text-primary)] p-4">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-8 h-8 border-2 border-brand-lime border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-[var(--text-secondary)] font-bold tracking-wider uppercase">
            {t('auth.checkingAuth', 'Verifying security credentials...')}
          </p>
        </div>
      </div>
    );
  }

  // ── Render Auth Screen (Zero Data Leakage) ───────────────────────
  if (!isAuthenticated) {
    const logoUrl = (authStatus?.logo_path || settings.logo_path) ? `${API}${authStatus?.logo_path || settings.logo_path}` : null;
    const accent = authStatus?.accent_color || settings.accent_color || '#FF6B00';
    const nodeName = authStatus?.node_name || settings.node_name || 'FFMPEG-GUI';
    const logoText = authStatus?.logo_text || settings.logo_text || 'FF';

    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg-dark)] text-[var(--text-primary)] p-4 transition-colors duration-300">
        <div 
          className="glass-card w-full max-w-md p-10 animate-in zoom-in duration-500"
          style={{ borderColor: `${accent}4d` }}
        >
          <div 
            className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-2xl overflow-hidden"
            style={!logoUrl ? { backgroundColor: accent, boxShadow: `0 10px 20px ${accent}33` } : undefined}
          >
            {logoUrl ? (
              <img src={logoUrl} alt="Logo" className="w-full h-full object-contain" />
            ) : (
              <span className="text-black font-black text-3xl">{logoText}</span>
            )}
          </div>
          <h1 className="text-2xl font-bold text-center mb-2 uppercase tracking-tighter">{nodeName}</h1>
          <p className="text-text-secondary text-center text-sm mb-10">{t('auth.accessRestricted')}</p>
          
          <div className="space-y-6">
            <input 
              type="password" 
              className={`w-full bg-white/5 border ${isLoginError ? 'border-red-500' : 'border-white/10'} rounded-2xl p-4 text-center text-2xl tracking-[0.5em] outline-none transition-all`}
              value={loginPass}
              onChange={e => setLoginPass(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              autoFocus
            />
            {isLoginError && <p className="text-red-500 text-center text-xs font-bold animate-shake">{t('auth.invalidPassword')}</p>}
            <button 
              onClick={handleLogin}
              className="w-full py-4 text-black font-black rounded-2xl hover:scale-[1.02] transition-all uppercase tracking-widest cursor-pointer"
              style={{ backgroundColor: accent, boxShadow: `0 10px 20px ${accent}33` }}
            >
              {t('auth.unlockNode')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Render Authenticated Dashboard ──────────────────────────────
  return (
    <AuthenticatedDashboard
      settings={settings}
      onUpdateSettings={handleUpdateSettings}
      handleLogoUpload={handleLogoUpload}
      onLogout={handleLogout}
      newPassword={newPassword}
      setNewPassword={setNewPassword}
      confirmPassword={confirmPassword}
      setConfirmPassword={setConfirmPassword}
      passwordError={passwordError}
      setPasswordError={setPasswordError}
      passwordSuccess={passwordSuccess}
      setPasswordSuccess={setPasswordSuccess}
    />
  );
}

export default App;
