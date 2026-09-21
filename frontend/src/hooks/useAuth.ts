import { useState, useEffect } from 'react';

const API = '';

export interface AuthStatus {
  password_required: boolean;
  authenticated: boolean;
  node_name: string;
  logo_path: string | null;
  logo_text: string | null;
  accent_color: string;
  version: string;
}

export function useAuth() {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginPass, setLoginPass] = useState('');
  const [isLoginError, setIsLoginError] = useState(false);

  const [settings, setSettings] = useState({
    node_name: 'FFMPEG-GUI Node',
    logo_text: 'FF',
    logo_path: null as string | null,
    has_gui_password: false,
    gui_password: '',
    accent_color: '#FF6B00',
    lcd_enabled: false,
    lcd_port: '/dev/ttyACM0',
    lcd_model: 'cfa635',
    lcd_alias: 'NODE-01'
  });

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const fetchAuthStatus = async () => {
    try {
      const res = await fetch(`${API}/api/auth/status`);
      if (res.ok) {
        const data: AuthStatus = await res.json();
        setAuthStatus(data);
        setIsAuthenticated(data.authenticated);
      }
    } catch (err) {
      console.error("Error fetching auth status:", err);
    } finally {
      setIsAuthChecking(false);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch(`${API}/settings`);
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
      } else if (res.status === 401) {
        setIsAuthenticated(false);
      }
    } catch (err) {
      console.error("Error fetching settings:", err);
    }
  };

  const handleLogin = async () => {
    try {
      const res = await fetch(`${API}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: loginPass })
      });
      if (res.ok) {
        setIsAuthenticated(true);
        setIsLoginError(false);
        setLoginPass('');
        await fetchAuthStatus();
        await fetchSettings();
      } else {
        setIsLoginError(true);
      }
    } catch (err) {
      console.error("Login failed:", err);
      setIsLoginError(true);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch(`${API}/logout`, { method: 'POST' });
    } catch (err) {
      console.error("Logout failed:", err);
    } finally {
      setIsAuthenticated(false);
      setLoginPass('');
      await fetchAuthStatus();
    }
  };

  const handleUpdateSettings = async (newSettings: any) => {
    try {
      const res = await fetch(`${API}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings)
      });
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        await fetchAuthStatus();
      }
    } catch (err) {
      console.error("Error updating settings:", err);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const res = await fetch(`${API}/settings/logo`, {
        method: 'POST',
        body: formData
      });
      if (res.ok) {
        const data = await res.json();
        setSettings(prev => ({ ...prev, logo_path: data.logo_path }));
        await fetchAuthStatus();
      } else {
        alert("Failed to upload logo");
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchAuthStatus();
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchSettings();
    }
  }, [isAuthenticated]);

  return {
    authStatus,
    isAuthChecking,
    settings,
    setSettings,
    isAuthenticated,
    setIsAuthenticated,
    loginPass,
    setLoginPass,
    isLoginError,
    setIsLoginError,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    passwordError,
    setPasswordError,
    passwordSuccess,
    setPasswordSuccess,
    fetchAuthStatus,
    fetchSettings,
    handleUpdateSettings,
    handleLogoUpload,
    handleLogin,
    handleLogout,
  };
}
