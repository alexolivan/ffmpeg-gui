import React from 'react';

interface SidebarProps {
  activeView: string;
  onViewChange: (view: string) => void;
  logoText?: string;
  logoPath?: string;
  accentColor?: string;
}

const Sidebar: React.FC<SidebarProps> = ({ activeView, onViewChange, logoText = 'FF', logoPath, accentColor = '#FF6B00' }) => {
  const items = [
    { id: 'dashboard', icon: '🏠', label: 'Dashboard' },
    { id: 'services', icon: '⚡', label: 'Services' },
    { id: 'batch', icon: '📅', label: 'Batch Jobs' },
    { id: 'settings', icon: '⚙️', label: 'Settings' },
    { id: 'tools', icon: '🛠️', label: 'Tools' },
  ];

  return (
    <div className="w-20 lg:w-64 h-screen bg-card-bg border-r border-white/5 flex flex-col items-center py-8 transition-all">
      <div 
        className="w-12 h-12 rounded-2xl flex items-center justify-center mb-12 shadow-lg cursor-pointer transition-all hover:scale-110 overflow-hidden" 
        style={!logoPath ? { backgroundColor: accentColor, boxShadow: `0 10px 20px ${accentColor}33` } : undefined}
        onClick={() => onViewChange('dashboard')}
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
            <span className="text-xl">{item.icon}</span>
            <span className="hidden lg:block font-medium">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Sidebar;
