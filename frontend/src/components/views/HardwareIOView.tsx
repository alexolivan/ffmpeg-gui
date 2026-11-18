import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlsaAudioSettingsCard } from './settings/AlsaAudioSettingsCard';
import { DecklinkSettingsCard } from './settings/DecklinkSettingsCard';
import { MagewellSettingsCard } from './settings/MagewellSettingsCard';

interface HardwareIOViewProps {
  capabilities?: any;
  API: string;
  hardwareLevel?: string;
  onNavigateToForge?: () => void;
}

export const HardwareIOView: React.FC<HardwareIOViewProps> = ({
  capabilities,
  API,
  hardwareLevel = 'admin',
  onNavigateToForge,
}) => {
  const { t } = useTranslation();

  const hasAlsaHardware = capabilities ? !!capabilities?.alsa?.available : true;
  const hasDecklinkHardware = capabilities ? !!capabilities?.decklink?.available : true;
  const hasMagewellHardware = capabilities
    ? (!!capabilities?.magewell?.available ||
        capabilities?.magewell?.status === 'SETUP_REQUIRED' ||
        capabilities?.magewell?.status === 'READY')
    : true;

  const availableTabs: Array<'alsa' | 'decklink' | 'magewell'> = [];
  if (hasAlsaHardware) availableTabs.push('alsa');
  if (hasDecklinkHardware) availableTabs.push('decklink');
  if (hasMagewellHardware) availableTabs.push('magewell');

  const [activeTab, setActiveTab] = useState<'alsa' | 'decklink' | 'magewell'>(
    availableTabs[0] || 'alsa'
  );

  useEffect(() => {
    if (availableTabs.length > 0 && !availableTabs.includes(activeTab)) {
      setActiveTab(availableTabs[0]);
    }
  }, [hasAlsaHardware, hasDecklinkHardware, hasMagewellHardware, activeTab]);

  const canOperate = hardwareLevel !== 'monitor' && hardwareLevel !== 'none';
  const canManage = hardwareLevel === 'manage' || hardwareLevel === 'admin';
  const isRestrictedBadge = hardwareLevel === 'monitor' || hardwareLevel === 'operate';

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-2xl font-black tracking-tight text-[var(--text-primary)]">
              {t('hardware.title', 'Hardware & Signal I/O')}
            </h2>
            {isRestrictedBadge && (
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider border ${
                  hardwareLevel === 'monitor'
                    ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                    : 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30'
                }`}
              >
                {hardwareLevel === 'monitor'
                  ? t('authz.levelMonitor', 'MONITOR')
                  : t('authz.levelOperate', 'OPERATE')}
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            {t('hardware.subtitle', 'Manage audio interfaces, SDI/HDMI capture cards, and live signal routing.')}
          </p>
        </div>
      </div>

      {/* Hardware Navigation Sub-Tabs */}
      {availableTabs.length === 0 ? (
        <div className="bg-[var(--bg-card)] border border-dashed border-[var(--glass-border)] rounded-2xl p-10 text-center text-xs text-[var(--text-secondary)]">
          {t('hardware.noHardwareDetected', 'No configurable ALSA, DeckLink, or Magewell I/O hardware detected on this appliance.')}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1.5 border-b border-[var(--glass-border)] pb-3 overflow-x-auto custom-scrollbar">
            {hasAlsaHardware && (
              <button
                type="button"
                onClick={() => setActiveTab('alsa')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'alsa'
                    ? 'bg-brand-lime/15 text-brand-lime border border-brand-lime/30 shadow-sm'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--input-bg)] hover:text-[var(--text-primary)] border border-transparent'
                }`}
              >
                <span className="text-sm">🔊</span>
                {t('settings.tabs.alsa', 'ALSA AUDIO')}
              </button>
            )}
            {hasDecklinkHardware && (
              <button
                type="button"
                onClick={() => setActiveTab('decklink')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'decklink'
                    ? 'bg-brand-lime/15 text-brand-lime border border-brand-lime/30 shadow-sm'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--input-bg)] hover:text-[var(--text-primary)] border border-transparent'
                }`}
              >
                <span className="text-sm">🎛️</span>
                {t('settings.tabs.decklink', 'DECKLINK')}
              </button>
            )}
            {hasMagewellHardware && (
              <button
                type="button"
                onClick={() => setActiveTab('magewell')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'magewell'
                    ? 'bg-brand-lime/15 text-brand-lime border border-brand-lime/30 shadow-sm'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--input-bg)] hover:text-[var(--text-primary)] border border-transparent'
                }`}
              >
                <span className="text-sm">📟</span>
                {t('settings.tabs.magewell', 'MAGEWELL')}
              </button>
            )}
          </div>

          <div>
            {activeTab === 'alsa' && hasAlsaHardware && (
              <AlsaAudioSettingsCard canOperate={canOperate} canManage={canManage} />
            )}
            {activeTab === 'decklink' && hasDecklinkHardware && (
              <DecklinkSettingsCard
                API={API}
                canManage={canManage}
                onNavigateToForge={onNavigateToForge}
              />
            )}
            {activeTab === 'magewell' && hasMagewellHardware && (
              <MagewellSettingsCard API={API} canManage={canManage} />
            )}
          </div>
        </>
      )}
    </div>
  );
};
