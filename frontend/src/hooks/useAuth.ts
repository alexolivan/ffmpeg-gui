import { useState, useEffect } from 'react';

const API = '';

export function useAuth() {
  const [settings, setSettings] = useState({
    node_name: 'FFMPEG-GUI Node',
    logo_text: 'FF',
    logo_path: null as string | null,
    gui_password: '',
    accent_color: '#FF6B00',
    lcd_enabled: false,
    lcd_port: '/dev/ttyACM0',
    lcd_model: 'cfa635',
    lcd_alias: 'NODE-01'
  });
  const [isAuthenticated, setIsAuthenticated] = useState(true);
  const [loginPass, setLoginPass] = useState('');
  const [isLoginError, setIsLoginError] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const fetchSettings = async () => {
    try {
      const res = await fetch(`${API}/settings`);
      const data = await res.json();
      setSettings(data);
      if (data.gui_password) {
        setIsAuthenticated(false);
      }
    } catch (err) {
      console.error("Error fetching settings:", err);
    }
  };

  const handleUpdateSettings = async (newSettings: any) => {
    try {
      const res = await fetch(`${API}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings)
      });
      const data = await res.json();
      setSettings(data);
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
      } else {
        alert("Failed to upload logo");
      }
    } catch (err) {
      console.error(err);
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
      } else {
        setIsLoginError(true);
      }
    } catch (err) {
      console.error("Login failed:", err);
      setIsLoginError(true);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  return {
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
    fetchSettings,
    handleUpdateSettings,
    handleLogoUpload,
    handleLogin,
  };
}
