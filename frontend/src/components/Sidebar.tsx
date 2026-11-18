import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  DashboardIcon,
  LightningIcon,
  CalendarIcon,
  GearIcon,
  ForgeIcon,
  LogoutIcon,
  SlidersIcon,
} from './Icons';
import {
  canAccessDomain,
  hasAnyProcessAccess,
  hasAnyServiceAccess,
  hasAnyTaskAccess,
  type EdgePermissionsSummary,
} from '../utils/permissions';

interface SidebarProps {
  activeView: string;
  onViewChange: (view: string) => void;
  logoText?: string;
  logoPath?: string;
  accentColor?: string;
  onLogout?: () => void;
  isCloudHubSession?: boolean;
  permissions?: EdgePermissionsSummary | null;
}

const Sidebar: React.FC<SidebarProps> = ({ 
  activeView, 
  onViewChange, 
  logoText = 'FF', 
  logoPath, 
  accentColor = '#FF6B00',
  onLogout,
  isCloudHubSession = false,
  permissions,
}) => {
  const { t } = useTranslation();

  const allItems = [
    {
      id: 'dashboard',
      icon: <DashboardIcon size={20} />,
      label: t('nav.dashboard'),
      allowed: canAccessDomain(permissions, 'dashboard', 'monitor') || hasAnyProcessAccess(permissions, 'monitor'),
    },
    {
      id: 'services',
      icon: <LightningIcon size={20} />,
      label: t('nav.services'),
      allowed: hasAnyServiceAccess(permissions, 'monitor'),
    },
    {
      id: 'batch',
      icon: <CalendarIcon size={20} />,
      label: t('nav.tasks'),
      allowed: hasAnyTaskAccess(permissions, 'monitor'),
    },
    {
      id: 'hardware',
      icon: <SlidersIcon size={20} />,
      label: t('nav.hardware', 'Hardware / I/O'),
      allowed: canAccessDomain(permissions, 'hardware', 'monitor'),
    },
    {
      id: 'settings',
      icon: <GearIcon size={20} />,
      label: t('nav.settings'),
      allowed: canAccessDomain(permissions, 'settings', 'monitor'),
    },
    {
      id: 'tools',
      icon: <ForgeIcon size={20} />,
      label: t('nav.forge', 'Forge'),
      allowed: canAccessDomain(permissions, 'forge', 'monitor'),
    },
  ];
  const items = allItems.filter((item) => item.allowed);

  return (
    <div className="w-20 lg:w-64 h-screen bg-card-bg border-r border-[var(--glass-border)] flex flex-col items-center py-8 transition-colors duration-300">
      <div 
        className="w-12 h-12 rounded-2xl flex items-center justify-center mb-6 shadow-lg cursor-pointer transition-all hover:scale-110 overflow-hidden" 
        style={!logoPath ? { backgroundColor: accentColor, boxShadow: `0 10px 20px ${accentColor}33` } : undefined}
        onClick={() => onViewChange(items.some((i) => i.id === 'dashboard') ? 'dashboard' : (items[0]?.id || 'dashboard'))}
      >
        {logoPath ? (
          <img src={logoPath} alt="Logo" className="w-full h-full object-contain" />
        ) : (
          <span className="text-black font-black text-xl">{logoText}</span>
        )}
      </div>
      
      <div className="flex-1 flex flex-col gap-6 w-full px-4">
        {items.map((item) => (
          <div 
            key={item.id}
            onClick={() => onViewChange(item.id)}
            className={`flex items-center gap-4 p-3 rounded-2xl cursor-pointer transition-all ${activeView === item.id ? 'bg-white/10 text-brand-lime' : 'text-text-secondary hover:bg-white/5'}`}
          >
            <span className="flex items-center justify-center w-6 h-6">{item.icon}</span>
            <span className="hidden lg:block font-medium">{item.label}</span>
          </div>
        ))}
      </div>

      {onLogout && (
        <div className="w-full px-4 mt-auto">
          <div 
            onClick={onLogout}
            className={`flex items-center gap-4 p-3 rounded-2xl cursor-pointer transition-all ${
              isCloudHubSession 
                ? 'text-amber-400 hover:bg-amber-500/10' 
                : 'text-red-400 hover:bg-red-500/10'
            }`}
            title={isCloudHubSession ? t('nav.exitCloudHub', 'Disconnect and return to CloudHub') : t('nav.logout')}
          >
            <span className="flex items-center justify-center w-6 h-6">
              <LogoutIcon size={20} />
            </span>
            <span className="hidden lg:block font-medium">
              {isCloudHubSession ? t('nav.disconnect', 'Disconnect') : t('nav.logout')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default Sidebar;
