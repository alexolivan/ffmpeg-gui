import React from 'react';
import { useTranslation } from 'react-i18next';
import { isActiveService } from '../views/ServicesView';

interface ServicesDashboardCardProps {
  telemetry: any[];
}

export const ServicesDashboardCard: React.FC<ServicesDashboardCardProps> = ({ telemetry }) => {
  const { t } = useTranslation();

  const services = telemetry.filter(p => p.type === 'service' || !p.type);
  const activeCount = services.filter(p => isActiveService(p)).length;
  const inactiveCount = services.length - activeCount;

  // Breakdown by service_type
  const typeCounts = services.reduce((acc: Record<string, { total: number; active: number }>, s: any) => {
    const stype = s.service_type || 'ffmpeg_stream';
    if (!acc[stype]) {
      acc[stype] = { total: 0, active: 0 };
    }
    acc[stype].total += 1;
    if (isActiveService(s)) {
      acc[stype].active += 1;
    }
    return acc;
  }, {});

  const typeLabels: Record<string, { label: string; icon: string; color: string }> = {
    ffmpeg_stream: { label: t('dashboard.serviceTypeFfmpeg', 'FFmpeg Streams'), icon: '📡', color: 'text-brand-lime' },
    mediamtx_hub: { label: t('dashboard.serviceTypeMediamtx', 'MediaMTX Hubs'), icon: '🔀', color: 'text-brand-blue' },
    icecast_server: { label: t('dashboard.serviceTypeIcecast', 'Icecast Audio'), icon: '📻', color: 'text-amber-400' },
    kiosk_browser: { label: t('dashboard.serviceTypeKiosk', 'Web Kiosks'), icon: '🖥️', color: 'text-purple-400' },
    desktop: { label: t('dashboard.serviceTypeDesktop', 'Virtual Desktops'), icon: '💻', color: 'text-cyan-400' },
  };

  return (
    <div className="glass-card p-4 border-brand-lime/10 space-y-3">
      <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2 mb-1">
        <h3 className="text-sm font-black text-[var(--text-primary)] uppercase tracking-wider flex items-center gap-2">
          <span>⚙️</span>
          <span>{t('dashboard.servicesTitle', 'SERVICES')}</span>
        </h3>
        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-brand-lime/10 border border-brand-lime/20 text-brand-lime">
          {activeCount}/{services.length} {t('dashboard.activeCount', 'active')}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-2.5 text-center">
          <div className="text-[9px] uppercase font-bold text-text-secondary mb-0.5">
            {t('dashboard.activeServices', 'Active Services')}
          </div>
          <div className="font-black text-xl text-brand-lime">
            {activeCount}
          </div>
        </div>
        <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-2.5 text-center">
          <div className="text-[9px] uppercase font-bold text-text-secondary mb-0.5">
            {t('dashboard.inactiveServices', 'Inactive Services')}
          </div>
          <div className="font-black text-xl text-text-secondary">
            {inactiveCount}
          </div>
        </div>
      </div>

      {services.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <div className="text-[9px] uppercase font-bold text-text-secondary tracking-wider">
            {t('dashboard.servicesBreakdown', 'Technology Breakdown')}
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            {Object.entries(typeCounts).map(([type, stats]) => {
              const info = typeLabels[type] || {
                label: type,
                icon: '⚙️',
                color: 'text-[var(--text-primary)]',
              };
              return (
                <div
                  key={type}
                  className="flex items-center justify-between px-2.5 py-1.5 bg-[var(--input-bg)]/60 border border-[var(--glass-border)] rounded-lg text-xs"
                >
                  <span className="flex items-center gap-1.5 text-text-secondary font-medium">
                    <span>{info.icon}</span>
                    <span className="text-[11px] text-[var(--text-primary)]">{info.label}</span>
                  </span>
                  <span className="font-mono text-[11px] font-bold">
                    <span className={info.color}>{stats.active}</span>
                    <span className="text-text-secondary opacity-60"> / {stats.total}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
