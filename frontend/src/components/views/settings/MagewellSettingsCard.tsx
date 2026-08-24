import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export interface MagewellAudioChannel {
  pair: string;
  status: string;
}

export interface MagewellChannel {
  channel_id: number;
  device_path: string;
  alsa_device: string;
  device_name: string;
  product_name: string;
  firmware_version?: string;
  hardware_version?: string;
  driver_version?: string;
  board_id: number;
  bus_address?: string;
  pcie_speed?: string;
  pcie_width?: string;
  pcie_info?: string;
  temperature?: string;
  video_input?: string;
  audio_input?: string;
  signal_locked: boolean;
  detected_mode: string;
  aspect?: string;
  color_space?: string;
  quantization?: string;
  audio_format?: string;
  audio_channels?: MagewellAudioChannel[];
  active_services?: string[];
}

export interface MagewellCard {
  board_id: number;
  product_name: string;
  serial_number: string;
  firmware_version: string;
  hardware_version: string;
  driver_version: string;
  num_channels: number;
  channels: MagewellChannel[];
}

export interface MagewellPcieDevice {
  slot: string;
  description: string;
  is_magewell: boolean;
}

export interface MagewellSystemStatus {
  driver_installed: boolean;
  driver_version: string | null;
  utilities_available: boolean;
  pcie_hardware_detected: boolean;
  pcie_devices: MagewellPcieDevice[];
  status: 'READY' | 'SETUP_REQUIRED' | 'UTILITIES_MISSING' | 'NO_DEVICES';
  total_channels: number;
  cards: MagewellCard[];
}

export const MagewellSettingsCard: React.FC<{ API?: string }> = ({ API = '' }) => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<MagewellSystemStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedCardIdx, setSelectedCardIdx] = useState<number>(0);
  const [selectedChannelIdx, setSelectedChannelIdx] = useState<number>(0);

  // Configuration Modal state
  const [configuringChannel, setConfiguringChannel] = useState<MagewellChannel | null>(null);
  const [configVideoInput, setConfigVideoInput] = useState<string>('auto');
  const [configAudioInput, setConfigAudioInput] = useState<string>('auto');
  const [configLowLatency, setConfigLowLatency] = useState<boolean>(false);
  const [configDeinterlace, setConfigDeinterlace] = useState<string>('blend');
  const [configLedMode, setConfigLedMode] = useState<string>('auto');
  const [isSavingConfig, setIsSavingConfig] = useState<boolean>(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configSuccess, setConfigSuccess] = useState<string | null>(null);

  // Manual Refresh ACK state
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [refreshSuccess, setRefreshSuccess] = useState<boolean>(false);

  const isMountedRef = useRef<boolean>(true);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/settings/magewell/status`);
      if (res.ok) {
        const data = await res.json();
        if (isMountedRef.current) {
          setStatus(data);
          setErrorMsg(null);
        }
      } else {
        const err = await res.json().catch(() => ({}));
        if (isMountedRef.current) {
          setErrorMsg(err.detail || 'Error loading Magewell status');
        }
      }
    } catch (e: any) {
      if (isMountedRef.current) {
        setErrorMsg(e.message || 'Network error connecting to backend');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [API]);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    setRefreshSuccess(false);
    await fetchStatus();
    if (isMountedRef.current) {
      setIsRefreshing(false);
      setRefreshSuccess(true);
      setTimeout(() => {
        if (isMountedRef.current) setRefreshSuccess(false);
      }, 1000);
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    fetchStatus();

    // Live telemetry polling (every 3 seconds, paused during modal interaction)
    const interval = setInterval(() => {
      if (!configuringChannel) {
        fetchStatus();
      }
    }, 3000);

    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchStatus, configuringChannel]);

  const handleCloseConfig = () => {
    setConfiguringChannel(null);
    setConfigError(null);
    setConfigSuccess(null);
  };

  const handleOpenConfig = (channel: MagewellChannel) => {
    setConfiguringChannel(channel);
    setConfigVideoInput(channel.video_input ? channel.video_input.toLowerCase() : 'auto');
    setConfigAudioInput(channel.audio_input ? channel.audio_input.toLowerCase() : 'auto');
    setConfigLowLatency(false);
    setConfigDeinterlace('blend');
    setConfigLedMode('auto');
    setConfigError(null);
    setConfigSuccess(null);
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configuringChannel) return;

    setIsSavingConfig(true);
    setConfigError(null);
    setConfigSuccess(null);

    try {
      const payload: any = {
        video_input: configVideoInput,
        audio_input: configAudioInput,
        low_latency: configLowLatency,
        deinterlace: configDeinterlace,
        led_mode: configLedMode,
      };

      // Convert device path /dev/video0 -> dev-video0 for clean URL encoding
      const targetParam = configuringChannel.device_path.replace(/^\//, '').replace(/\//g, '-');
      const res = await fetch(`${API}/api/settings/magewell/${targetParam}/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok) {
        setConfigSuccess(t('settings.magewell.configAppliedSuccess', 'Configuration applied successfully'));
        await fetchStatus();
        setTimeout(() => {
          if (isMountedRef.current) handleCloseConfig();
        }, 400);
      } else {
        setConfigError(data.detail || data.error || 'Failed to apply configuration');
      }
    } catch (err: any) {
      setConfigError(err.message || 'Network error applying configuration');
    } finally {
      if (isMountedRef.current) setIsSavingConfig(false);
    }
  };

  const currentCard = useMemo(() => {
    if (!status?.cards || status.cards.length === 0) return null;
    return status.cards[selectedCardIdx] || status.cards[0];
  }, [status, selectedCardIdx]);

  const activeChannel = useMemo(() => {
    if (!currentCard || !currentCard.channels || currentCard.channels.length === 0) return null;
    return currentCard.channels[selectedChannelIdx] || currentCard.channels[0];
  }, [currentCard, selectedChannelIdx]);

  if (loading) {
    return (
      <div className="glass-card p-6 border-[var(--glass-border)] text-center animate-pulse">
        <p className="text-sm text-text-secondary">{t('common.loading', 'Loading hardware status...')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── CARD 1: MAGEWELL ECOSYSTEM & DIAGNOSTICS ──────────────────────── */}
      <div className="glass-card p-6 border-[var(--glass-border)] relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[var(--glass-border)] pb-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-cyan/10 border border-brand-cyan/30 flex items-center justify-center text-brand-cyan text-xl shadow-inner">
              📟
            </div>
            <div>
              <h2 className="text-base font-black uppercase text-[var(--text-primary)] tracking-wider flex items-center gap-2">
                <span>{t('settings.magewell.title', 'MAGEWELL PRO & ECO CAPTURE CONTROL')}</span>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-brand-cyan/15 text-brand-cyan border border-brand-cyan/30">
                  {status?.status || 'NO_DEVICES'}
                </span>
              </h2>
              <p className="text-xs text-text-secondary">
                {t('settings.magewell.subtitle', 'Kernel mwcap driver status, live FPGA temperature, signal analysis, and hardware routing')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              refreshSuccess
                ? 'bg-brand-lime/15 border-brand-lime/40 text-brand-lime'
                : 'bg-[var(--input-bg)] border-[var(--glass-border)] text-text-secondary hover:text-[var(--text-primary)] hover:border-brand-cyan/40'
            }`}
          >
            <span className={isRefreshing ? 'animate-spin' : ''}>🔄</span>
            {refreshSuccess
              ? t('common.refreshed', 'Refreshed!')
              : isRefreshing
              ? t('common.refreshing', 'Refreshing...')
              : t('common.refresh', 'Refresh Status')}
          </button>
        </div>

        {errorMsg && (
          <div className="mb-5 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
            <span>⚠️</span> {errorMsg}
          </div>
        )}

        {/* Diagnostic Meta Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-4">
          <div className="p-3 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)]">
            <span className="text-[10px] text-text-secondary font-mono uppercase block mb-1">
              {t('settings.magewell.kernelDriver', 'Kernel Driver (mwcap)')}:
            </span>
            <span className={`font-bold font-mono ${status?.driver_installed ? 'text-brand-lime' : 'text-red-400'}`}>
              {status?.driver_installed ? `mwcap ${status.driver_version ? `v${status.driver_version}` : '(Active)'}` : t('settings.magewell.driverNotLoaded', 'mwcap not loaded')}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)]">
            <span className="text-[10px] text-text-secondary font-mono uppercase block mb-1">
              {t('settings.magewell.utilitiesTools', 'Official CLI Tools')}:
            </span>
            <span className={`font-bold font-mono ${status?.utilities_available ? 'text-brand-cyan' : 'text-amber-400'}`}>
              {status?.utilities_available ? 'mwcap-info & mwcap-control' : t('settings.magewell.utilitiesMissing', 'Not in PATH')}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)]">
            <span className="text-[10px] text-text-secondary font-mono uppercase block mb-1">
              {t('settings.magewell.pcieAudit', 'PCIe Hardware Audit')}:
            </span>
            <span className={`font-bold font-mono ${status?.pcie_hardware_detected ? 'text-brand-lime' : 'text-text-secondary'}`}>
              {status?.pcie_hardware_detected ? `${status.pcie_devices?.length || 1} Device(s) on Bus` : t('settings.magewell.noPcieFound', 'No PCIe Device')}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)]">
            <span className="text-[10px] text-text-secondary font-mono uppercase block mb-1">
              {t('settings.magewell.detectedChannels', 'Active Channels')}:
            </span>
            <span className="font-bold font-mono text-[var(--text-primary)]">
              {status?.total_channels || 0} {t('settings.magewell.channelsCount', 'channel(s)')}
            </span>
          </div>
        </div>

        {/* SETUP_REQUIRED Alert Banner */}
        {status?.status === 'SETUP_REQUIRED' && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 space-y-2">
            <div className="flex items-center gap-2 font-bold text-sm">
              <span>⚠️</span> {t('settings.magewell.setupRequiredTitle', 'Magewell PCIe Hardware Detected (Driver Required)')}
            </div>
            <p className="text-[11px] leading-relaxed text-amber-200/90">
              {t('settings.magewell.setupRequiredDesc', 'A Magewell capture card was detected on the PCIe bus, but the mwcap kernel driver is not loaded. Download and run the official Magewell Linux driver package (./install.sh).')}
            </p>
            {status?.pcie_devices && status.pcie_devices.length > 0 && (
              <div className="pt-2 border-t border-amber-500/20 font-mono text-[10px] space-y-0.5">
                {status.pcie_devices.map((d, i) => (
                  <div key={i}>• {d.slot} — {d.description}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── CARD 2: PHYSICAL CARDS & LIVE TELEMETRY CAROUSEL ──────────────── */}
      {(!status?.cards || status.cards.length === 0) ? (
        <div className="glass-card p-8 border-[var(--glass-border)] text-center space-y-2">
          <div className="text-3xl">📟</div>
          <h3 className="text-sm font-bold uppercase text-[var(--text-primary)]">
            {t('settings.magewell.noDevicesFound', 'No Magewell Capture Cards Detected')}
          </h3>
          <p className="text-xs text-text-secondary max-w-md mx-auto">
            {t('settings.magewell.noDevicesFoundDesc', 'Make sure your PCIe or USB Magewell card is connected and that the mwcap driver is installed and loaded.')}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Card Selector Dropdown */}
          <div className="glass-card p-4 border-[var(--glass-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <label htmlFor="magewell-card-select" className="text-xs font-mono font-bold text-text-secondary uppercase">
                {t('settings.magewell.selectCard', 'Physical Card:')}
              </label>
              <select
                id="magewell-card-select"
                aria-label={t('settings.magewell.selectCard', 'Physical Card:')}
                value={selectedCardIdx}
                onChange={(e) => {
                  setSelectedCardIdx(Number(e.target.value));
                  setSelectedChannelIdx(0);
                }}
                className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-1.5 text-xs font-mono font-bold text-[var(--text-primary)] focus:outline-none focus:border-brand-cyan transition-all"
              >
                {status.cards.map((card, idx) => (
                  <option key={idx} value={idx}>
                    [{card.board_id}] {card.product_name} {card.serial_number ? `(S/N: ${card.serial_number})` : ''} — {card.num_channels} {t('settings.magewell.channelUnit', 'ch')}
                  </option>
                ))}
              </select>
            </div>

            {currentCard && (
              <div className="flex items-center gap-3 text-[11px] font-mono text-text-secondary">
                {currentCard.firmware_version && (
                  <span>FW: <strong className="text-[var(--text-primary)]">{currentCard.firmware_version}</strong></span>
                )}
                {currentCard.hardware_version && (
                  <span>HW: <strong className="text-[var(--text-primary)]">{currentCard.hardware_version}</strong></span>
                )}
              </div>
            )}
          </div>

          {/* Channels Carousel & Telemetry View */}
          {currentCard && activeChannel && (
            <div className="glass-card p-5 border-[var(--glass-border)] space-y-4">
              {/* Carousel Header / Navigation if multi-channel */}
              <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-3">
                <div className="flex items-center gap-2">
                  {currentCard.num_channels > 1 && (
                    <div className="flex items-center gap-1 bg-[var(--input-bg)] p-1 rounded-lg border border-[var(--glass-border)]">
                      <button
                        type="button"
                        onClick={() => setSelectedChannelIdx((prev) => (prev > 0 ? prev - 1 : currentCard.num_channels - 1))}
                        className="px-2 py-0.5 rounded text-xs text-text-secondary hover:text-[var(--text-primary)] hover:bg-white/5 transition-all cursor-pointer"
                        title={t('settings.magewell.prevChannel', 'Previous Channel')}
                      >
                        ◀
                      </button>
                      {currentCard.channels.map((ch, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setSelectedChannelIdx(idx)}
                          className={`px-2.5 py-0.5 rounded text-xs font-mono font-bold transition-all cursor-pointer ${
                            selectedChannelIdx === idx
                              ? 'bg-brand-cyan/20 text-brand-cyan border border-brand-cyan/40 shadow-sm'
                              : 'text-text-secondary hover:text-[var(--text-primary)]'
                          }`}
                        >
                          Ch #{ch.channel_id + 1}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setSelectedChannelIdx((prev) => (prev < currentCard.num_channels - 1 ? prev + 1 : 0))}
                        className="px-2 py-0.5 rounded text-xs text-text-secondary hover:text-[var(--text-primary)] hover:bg-white/5 transition-all cursor-pointer"
                        title={t('settings.magewell.nextChannel', 'Next Channel')}
                      >
                        ▶
                      </button>
                    </div>
                  )}

                  <span className="text-xs font-mono font-bold text-[var(--text-primary)]">
                    {t('settings.magewell.channelCounter', 'Channel {{current}} of {{total}}', {
                      current: activeChannel.channel_id + 1,
                      total: currentCard.num_channels,
                    })}
                  </span>
                  <span className="text-xs font-mono text-text-secondary">
                    ({activeChannel.device_path} ⇄ {activeChannel.alsa_device})
                  </span>
                </div>

                {/* Configure Button */}
                <button
                  type="button"
                  onClick={() => handleOpenConfig(activeChannel)}
                  className="px-3 py-1.5 rounded-lg bg-brand-cyan/10 border border-brand-cyan/30 text-brand-cyan hover:bg-brand-cyan/20 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                  title={t('settings.magewell.configurePort', 'Configure Channel')}
                >
                  <span>⚙️</span>
                  <span>{t('settings.magewell.configurePort', 'Configure Channel')}</span>
                </button>
              </div>

              {/* Main Telemetry & Signal Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Column 1: Live Signal & Video Input */}
                <div className="p-4 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase text-text-secondary">
                      {t('settings.magewell.signalStatus', 'Signal State')}
                    </span>
                    <span
                      className={`text-[10px] font-mono font-black px-2 py-0.5 rounded border uppercase flex items-center gap-1 ${
                        activeChannel.signal_locked
                          ? 'bg-brand-lime/15 border-brand-lime/40 text-brand-lime shadow-[0_0_8px_rgba(212,255,91,0.2)]'
                          : 'bg-white/5 border-[var(--glass-border)] text-text-secondary'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${activeChannel.signal_locked ? 'bg-brand-lime animate-pulse' : 'bg-text-secondary'}`} />
                      {activeChannel.signal_locked ? t('settings.magewell.signalLocked', 'LOCKED') : t('settings.magewell.noSignal', 'NO SIGNAL')}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-text-secondary font-mono block mb-0.5">
                      {t('settings.magewell.detectedMode', 'Detected Mode / Standard')}:
                    </span>
                    <span className="text-sm font-black font-mono text-[var(--text-primary)]">
                      {activeChannel.detected_mode || 'No Signal'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-[var(--glass-border)]">
                    <div>
                      <span className="text-[10px] text-text-secondary font-mono block">Video Input:</span>
                      <strong className="font-mono text-brand-cyan">{activeChannel.video_input || 'Auto'}</strong>
                    </div>
                    <div>
                      <span className="text-[10px] text-text-secondary font-mono block">Color Space:</span>
                      <strong className="font-mono text-[var(--text-primary)]">{activeChannel.color_space || 'N/A'}</strong>
                    </div>
                  </div>
                </div>

                {/* Column 2: Audio Telemetry & Channel Pairs */}
                <div className="p-4 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase text-text-secondary">
                      {t('settings.magewell.audioTelemetry', 'Embedded Audio')}
                    </span>
                    <span className="text-[10px] font-mono font-bold text-brand-cyan px-2 py-0.5 rounded bg-brand-cyan/10 border border-brand-cyan/30">
                      {activeChannel.alsa_device || 'ALSA Card'}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-text-secondary font-mono block mb-0.5">
                      {t('settings.magewell.audioFormat', 'Audio Format')}:
                    </span>
                    <span className="text-xs font-bold font-mono text-[var(--text-primary)]">
                      {activeChannel.audio_format || '48000 Hz, 24-bit LPCM'}
                    </span>
                  </div>

                  {/* 8-Channel Status Grid */}
                  <div className="pt-2 border-t border-[var(--glass-border)]">
                    <span className="text-[10px] text-text-secondary font-mono block mb-1.5">
                      {t('settings.magewell.audioChannels', 'Audio Channel Pairs')}:
                    </span>
                    <div className="grid grid-cols-2 gap-1 text-[10px] font-mono">
                      {['1 & 2', '3 & 4', '5 & 6', '7 & 8'].map((pairName, idx) => {
                        const pairMatch = activeChannel.audio_channels?.find((p) => p.pair.includes(pairName));
                        const isValid = activeChannel.signal_locked && (!pairMatch || pairMatch.status.toLowerCase() === 'valid');
                        return (
                          <div
                            key={idx}
                            className={`px-2 py-1 rounded flex items-center justify-between border ${
                              isValid
                                ? 'bg-brand-lime/10 border-brand-lime/30 text-brand-lime'
                                : 'bg-white/5 border-[var(--glass-border)] text-text-secondary'
                            }`}
                          >
                            <span>Ch {pairName}</span>
                            <span className="font-bold">{isValid ? '✓' : '—'}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Column 3: Hardware Health & Active Processes */}
                <div className="p-4 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase text-text-secondary">
                      {t('settings.magewell.hardwareHealth', 'Hardware Health')}
                    </span>
                    {activeChannel.temperature && (
                      <span className="text-[11px] font-mono font-black text-brand-orange px-2 py-0.5 rounded bg-brand-orange/10 border border-brand-orange/30">
                        🌡️ {activeChannel.temperature}
                      </span>
                    )}
                  </div>

                  {activeChannel.bus_address && (
                    <div>
                      <span className="text-[10px] text-text-secondary font-mono block mb-0.5">PCIe Bus:</span>
                      <span className="text-xs font-mono text-[var(--text-primary)]">
                        {activeChannel.bus_address} ({activeChannel.pcie_speed || 'gen 2'} {activeChannel.pcie_width || 'x1'})
                      </span>
                    </div>
                  )}

                  {/* Active Services Mapping */}
                  <div className="pt-2 border-t border-[var(--glass-border)]">
                    <span className="text-[10px] text-text-secondary font-mono block mb-1">
                      {t('settings.magewell.activeServices', 'Assigned FFmpeg Services')}:
                    </span>
                    {activeChannel.active_services && activeChannel.active_services.length > 0 ? (
                      <div className="space-y-1">
                        {activeChannel.active_services.map((srv, idx) => (
                          <div
                            key={idx}
                            className="p-1.5 rounded bg-brand-lime/10 border border-brand-lime/30 text-brand-lime font-mono text-[10px] font-bold flex items-center gap-1.5"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-brand-lime animate-pulse" />
                            <span className="truncate">{srv}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[10px] font-mono text-text-secondary italic">
                        {t('settings.magewell.noActiveServices', 'No active FFmpeg services currently bound')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── CARD 3: HARDWARE CONFIGURATION MODAL (mwcap-control) ─────────── */}
      {configuringChannel && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 relative">
            <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">⚙️</span>
                <div>
                  <h3 className="text-sm font-black uppercase text-[var(--text-primary)]">
                    {t('settings.magewell.configureModalTitle', 'Configure Magewell Channel')}
                  </h3>
                  <p className="text-xs text-text-secondary font-mono">
                    {configuringChannel.device_name || configuringChannel.device_path}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseConfig}
                className="text-text-secondary hover:text-[var(--text-primary)] text-lg cursor-pointer transition-all"
              >
                ✕
              </button>
            </div>

            {configError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
                <span>⚠️</span> {configError}
              </div>
            )}

            {configSuccess && (
              <div className="p-3 rounded-xl bg-brand-lime/10 border border-brand-lime/30 text-brand-lime text-xs flex items-center gap-2">
                <span>✓</span> {configSuccess}
              </div>
            )}

            <form onSubmit={handleSaveConfig} className="space-y-4">
              {/* Video Input Source */}
              <div>
                <label className="text-xs font-mono font-bold text-text-secondary uppercase block mb-1">
                  {t('settings.magewell.videoInputLabel', 'Video Input Connector Source:')}
                </label>
                <select
                  value={configVideoInput}
                  onChange={(e) => setConfigVideoInput(e.target.value)}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs font-mono font-bold text-[var(--text-primary)] focus:outline-none focus:border-brand-cyan"
                >
                  <option value="auto">Auto / Default Detection</option>
                  <option value="sdi">SDI (BNC)</option>
                  <option value="hdmi">HDMI</option>
                  <option value="dvi">DVI</option>
                  <option value="vga">VGA</option>
                  <option value="component">Component (YPbPr)</option>
                  <option value="cvbs">CVBS (Composite)</option>
                </select>
              </div>

              {/* Audio Input Source */}
              <div>
                <label className="text-xs font-mono font-bold text-text-secondary uppercase block mb-1">
                  {t('settings.magewell.audioInputLabel', 'Audio Input Source:')}
                </label>
                <select
                  value={configAudioInput}
                  onChange={(e) => setConfigAudioInput(e.target.value)}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs font-mono font-bold text-[var(--text-primary)] focus:outline-none focus:border-brand-cyan"
                >
                  <option value="auto">Auto / Embedded HDMI/SDI Audio</option>
                  <option value="sdi">SDI Embedded Audio</option>
                  <option value="hdmi">HDMI Embedded Audio</option>
                  <option value="line_in">Line In (Analog 3.5mm)</option>
                  <option value="mic_in">Mic In</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Deinterlace Mode */}
                <div>
                  <label className="text-xs font-mono font-bold text-text-secondary uppercase block mb-1">
                    {t('settings.magewell.deinterlaceLabel', 'Hardware Deinterlace:')}
                  </label>
                  <select
                    value={configDeinterlace}
                    onChange={(e) => setConfigDeinterlace(e.target.value)}
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs font-mono font-bold text-[var(--text-primary)] focus:outline-none focus:border-brand-cyan"
                  >
                    <option value="blend">Blend (Default)</option>
                    <option value="weave">Weave</option>
                    <option value="top_field">Top Field</option>
                    <option value="bottom_field">Bottom Field</option>
                  </select>
                </div>

                {/* LED Mode */}
                <div>
                  <label className="text-xs font-mono font-bold text-text-secondary uppercase block mb-1">
                    {t('settings.magewell.ledModeLabel', 'Front LED Indicator:')}
                  </label>
                  <select
                    value={configLedMode}
                    onChange={(e) => setConfigLedMode(e.target.value)}
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs font-mono font-bold text-[var(--text-primary)] focus:outline-none focus:border-brand-cyan"
                  >
                    <option value="auto">Auto</option>
                    <option value="on">On (Solid)</option>
                    <option value="off">Off</option>
                    <option value="blink">Blink</option>
                    <option value="breath">Breath</option>
                  </select>
                </div>
              </div>

              {/* Low Latency Toggle */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)]">
                <div>
                  <span className="text-xs font-bold text-[var(--text-primary)] block">
                    {t('settings.magewell.lowLatencyLabel', 'Ultra Low Latency Capture Mode')}
                  </span>
                  <span className="text-[10px] text-text-secondary">
                    {t('settings.magewell.lowLatencyDesc', 'Bypasses internal frame queues for minimum latency processing')}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setConfigLowLatency(!configLowLatency)}
                  className={`w-12 h-6 rounded-full transition-all relative cursor-pointer ${
                    configLowLatency ? 'bg-brand-cyan' : 'bg-white/10'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-all absolute top-1 ${
                      configLowLatency ? 'right-1' : 'left-1'
                    }`}
                  />
                </button>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[var(--glass-border)]">
                <button
                  type="button"
                  onClick={handleCloseConfig}
                  className="px-4 py-2 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] text-text-secondary hover:text-[var(--text-primary)] font-bold text-xs cursor-pointer transition-all"
                >
                  {t('common.cancel', 'Cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isSavingConfig}
                  className="px-5 py-2 rounded-xl bg-brand-cyan text-black font-black text-xs hover:opacity-90 disabled:opacity-50 cursor-pointer shadow-lg transition-all"
                >
                  {isSavingConfig ? t('common.processing', 'Applying...') : t('settings.magewell.applyConfigBtn', 'Apply Configuration')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
