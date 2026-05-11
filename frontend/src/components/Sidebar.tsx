import React from 'react';

interface SidebarProps {
  activeView: string;
  onViewChange: (view: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeView, onViewChange }) => {
  const items = [
    { id: 'dashboard', icon: '🏠', label: 'Dashboard' },
    { id: 'batch', icon: '📅', label: 'Batch Jobs' },
    { id: 'settings', icon: '⚙️', label: 'Settings' },
    { id: 'tools', icon: '🛠️', label: 'Tools' },
  ];

  return (
    <div className="w-20 lg:w-64 h-screen bg-card-bg border-r border-white/5 flex flex-col items-center py-8 transition-all">
      <div className="w-12 h-12 bg-brand-lime rounded-2xl flex items-center justify-center mb-12 shadow-lg shadow-brand-lime/20 cursor-pointer" onClick={() => onViewChange('dashboard')}>
        <span className="text-black font-bold text-xl">FF</span>
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

      <div className="mt-auto">
        <div 
          className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center text-2xl cursor-pointer hover:bg-white/10 transition-colors"
          onClick={() => onViewChange('settings')}
        >
          ⚙️
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
