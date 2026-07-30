import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

interface AlsaControl {
  numid: number;
  name: string;
  ctrl_type: string; // 'volume', 'mute', 'switch', 'route', 'enum', 'meter'
  is_meter: boolean;
  matrix_source?: string;
  min?: number;
  max?: number;
  step?: number;
  db_min?: number;
  db_max?: number;
  channels: number;
  items?: string[];
  values: any[];
}

interface AlsaGroup {
  id: string;
  name: string;
  category: 'virtual_playout' | 'hardware_outputs' | 'virtual_capture' | 'hardware_inputs';
  controls: AlsaControl[];
  meters: AlsaControl[];
}

interface ActiveProcessBadge {
  process_id: number;
  alias: string;
  status: string;
}

interface AlsaTopology {
  card_index: number;
  virtual_playout: AlsaGroup[];
  hardware_outputs: AlsaGroup[];
  virtual_capture: AlsaGroup[];
  hardware_inputs: AlsaGroup[];
  global_controls: AlsaGroup[];
  active_processes?: ActiveProcessBadge[];
}

interface AlsaCard {
  card_index: number;
  card_id: string;
  name: string;
  driver: string;
}

export const AlsaAudioSettingsCard: React.FC = () => {
  const { t } = useTranslation();
  const [cards, setCards] = useState<AlsaCard[]>([]);
  const [selectedCardIdx, setSelectedCardIdx] = useState<number>(0);
  const [topology, setTopology] = useState<AlsaTopology | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [linkedChannels, setLinkedChannels] = useState<Record<number, boolean>>({});

  const wsRef = useRef<WebSocket | null>(null);
  const canvasRefs = useRef<Record<number, HTMLCanvasElement | null>>({});

  // Fetch available ALSA cards
  useEffect(() => {
    fetchCards();
  }, []);

  const fetchCards = async () => {
    try {
      const res = await fetch('/api/settings/alsa/cards');
      if (res.ok) {
        const data = await res.json();
        setCards(data);
        if (data.length > 0) {
          setSelectedCardIdx(data[0].card_index);
        }
      }
    } catch (err) {
      console.error('Failed to fetch ALSA cards:', err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch topology when card changes
  useEffect(() => {
    if (cards.length === 0) return;
    fetchTopology(selectedCardIdx);
    connectMeterWebSocket(selectedCardIdx);

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [selectedCardIdx, cards]);

  const fetchTopology = async (cardIdx: number) => {
    try {
      const res = await fetch(`/api/settings/alsa/card/${cardIdx}/topology`);
      if (res.ok) {
        const data: AlsaTopology = await res.json();
        setTopology(data);
      }
    } catch (err) {
      console.error(`Failed to fetch topology for card ${cardIdx}:`, err);
    }
  };

  const connectMeterWebSocket = (cardIdx: number) => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/alsa/meters/${cardIdx}`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload && payload.meters) {
          renderCanvasMeters(payload.meters);
        }
      } catch (e) {
        console.error('Error parsing meter WS message:', e);
      }
    };

    wsRef.current = ws;
  };

  // Render LED bars directly onto HTML5 <canvas> for 0 React DOM re-renders
  const renderCanvasMeters = (metersMap: Record<number, number[]>) => {
    Object.entries(metersMap).forEach(([numidStr, vals]) => {
      const numid = parseInt(numidStr, 10);
      const canvas = canvasRefs.current[numid];
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const chCount = vals.length || 1;
      const barHeight = Math.floor(height / chCount) - 2;

      vals.forEach((rawVal, chIdx) => {
        // Normalize raw meter value (0 to 2147483647) to 0.0 -> 1.0
        const norm = Math.min(1.0, Math.max(0.0, rawVal / 2147483647));
        const fillWidth = Math.floor(width * norm);

        const y = chIdx * (barHeight + 2);

        // LED Gradient (Green -> Yellow -> Red)
        const grad = ctx.createLinearGradient(0, 0, width, 0);
        grad.addColorStop(0, '#22c55e');
        grad.addColorStop(0.7, '#eab308');
        grad.addColorStop(1, '#ef4444');

        // Background slot
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.fillRect(0, y, width, barHeight);

        // Active LED level
        ctx.fillStyle = grad;
        ctx.fillRect(0, y, fillWidth, barHeight);
      });
    });
  };

  const handleControlChange = async (numid: number, values: any[]) => {
    // Update local state optimistically
    if (topology) {
      const updateValuesInGroups = (groups: AlsaGroup[]) =>
        groups.map((g) => ({
          ...g,
          controls: g.controls.map((c) => (c.numid === numid ? { ...c, values } : c)),
        }));

      setTopology({
        ...topology,
        virtual_playout: updateValuesInGroups(topology.virtual_playout),
        hardware_outputs: updateValuesInGroups(topology.hardware_outputs),
        virtual_capture: updateValuesInGroups(topology.virtual_capture),
        hardware_inputs: updateValuesInGroups(topology.hardware_inputs),
      });
    }

    try {
      await fetch('/api/settings/alsa/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_index: selectedCardIdx,
          numid,
          values,
        }),
      });
    } catch (err) {
      console.error('Failed to write control:', err);
    }
  };

  const toggleChannelLink = (numid: number) => {
    setLinkedChannels((prev) => ({ ...prev, [numid]: !prev[numid] }));
  };

  const getEndpointIcon = (category: string, groupName: string) => {
    const nameLower = groupName ? groupName.toLowerCase() : '';

    if (category === 'virtual_playout') return <span className="text-brand-lime font-bold">▶</span>;
    if (category === 'virtual_capture') return <span className="text-red-400 font-bold">🔴</span>;

    if (nameLower.includes('mic')) return <span className="text-amber-400 font-bold">🎤</span>;
    if (nameLower.includes('speaker')) return <span className="text-sky-400 font-bold">🔊</span>;
    if (nameLower.includes('headphone')) return <span className="text-indigo-400 font-bold">🎧</span>;

    return <span className="text-emerald-400 font-bold">📻</span>;
  };

  if (loading) {
    return (
      <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-6 text-center text-text-secondary">
        <p>{t('common.loading', 'Loading ALSA sound devices...')}</p>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-6 text-center text-text-secondary">
        <h3 className="text-base font-semibold text-text-primary mb-1">
          {t('settings.alsa.noCardsTitle', 'No Physical Sound Cards Detected')}
        </h3>
        <p className="text-xs">
          {t('settings.alsa.noCardsDesc', 'No hardware or virtual ALSA sound cards were found on this system.')}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-6 space-y-6">
      {/* Compact Card Header & Selector */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-[var(--glass-border)] pb-3">
        <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider">
          {t('settings.alsa.title', 'HARDWARE MIXER')}
        </h3>

        {/* Sound Card Dropdown Selector */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-bold text-text-secondary uppercase tracking-wider whitespace-nowrap">
            {t('settings.alsa.selectCard', 'Sound Card:')}
          </label>
          <select
            value={selectedCardIdx}
            onChange={(e) => setSelectedCardIdx(parseInt(e.target.value, 10))}
            className="bg-[var(--input-bg)] text-text-primary border border-[var(--glass-border)] rounded-lg px-3 py-1.5 text-xs font-bold focus:outline-none focus:border-brand-lime shadow-sm min-w-[200px]"
          >
            {cards.map((c) => (
              <option key={c.card_index} value={c.card_index}>
                Card {c.card_index}: {c.name || c.card_id} ({c.driver || 'ALSA'})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Active Process Badges Banner */}
      {topology?.active_processes && topology.active_processes.length > 0 && (
        <div className="bg-brand-lime/10 border border-brand-lime/30 rounded-lg p-2.5 flex items-center gap-2 text-xs text-brand-lime">
          <span className="font-semibold">{t('settings.alsa.activeProcesses', 'Active FFmpeg Bindings:')}</span>
          <div className="flex flex-wrap items-center gap-2 ml-1">
            {topology.active_processes.map((proc) => (
              <span key={proc.process_id} className="bg-brand-lime/20 border border-brand-lime/40 px-2 py-0.5 rounded text-[11px] font-mono font-bold text-text-primary">
                🏷️ {proc.alias}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 4-QUADRANT BROADCAST GRID LAYOUT WITH CONTINUOUS AUDIO BUS */}
      <div className="grid grid-cols-1 lg:grid-cols-11 gap-4 items-stretch relative">
        
        {/* TOP-LEFT: VIRTUAL PLAYOUT */}
        <div className="lg:col-span-5 space-y-2">
          <div className="space-y-2">
            {topology?.virtual_playout.map((group) => (
              <AlsaSkewerChannelStrip
                key={group.id}
                group={group}
                onControlChange={handleControlChange}
                isLinked={linkedChannels[group.controls[0]?.numid] || false}
                onToggleLink={() => group.controls[0] && toggleChannelLink(group.controls[0].numid)}
                canvasRefSetter={(numid, el) => (canvasRefs.current[numid] = el)}
                endpointIcon={getEndpointIcon(group.category, group.name)}
              />
            ))}
            {(!topology?.virtual_playout || topology.virtual_playout.length === 0) && (
              <div className="h-12 flex items-center justify-center border border-dashed border-[var(--glass-border)] rounded-lg text-xs text-text-secondary/50">
                {t('settings.alsa.noControls', 'No virtual playout streams detected')}
              </div>
            )}
          </div>
        </div>

        {/* CENTRAL AUDIO BUS COLUMN */}
        <div className="lg:col-span-1 lg:row-span-3 hidden lg:flex flex-col items-center justify-between py-2 self-stretch">
          <div className="w-1.5 h-full bg-gradient-to-b from-brand-lime via-indigo-500 to-red-500 rounded-full opacity-60" />
          <div className="my-3 px-1 py-4 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded text-[10px] font-mono font-bold text-text-secondary uppercase tracking-widest text-center rotate-180 [writing-mode:vertical-lr]">
            AUDIO BUS
          </div>
          <div className="w-1.5 h-full bg-gradient-to-b from-red-500 via-indigo-500 to-brand-lime rounded-full opacity-60" />
        </div>

        {/* TOP-RIGHT: HARDWARE OUTPUTS */}
        <div className="lg:col-span-5 space-y-2">
          <div className="space-y-2">
            {topology?.hardware_outputs.map((group) => (
              <AlsaSkewerChannelStrip
                key={group.id}
                group={group}
                onControlChange={handleControlChange}
                isLinked={linkedChannels[group.controls[0]?.numid] || false}
                onToggleLink={() => group.controls[0] && toggleChannelLink(group.controls[0].numid)}
                canvasRefSetter={(numid, el) => (canvasRefs.current[numid] = el)}
                endpointIcon={getEndpointIcon(group.category, group.name)}
              />
            ))}
            {(!topology?.hardware_outputs || topology.hardware_outputs.length === 0) && (
              <div className="h-12 flex items-center justify-center border border-dashed border-[var(--glass-border)] rounded-lg text-xs text-text-secondary/50">
                {t('settings.alsa.noControls', 'No hardware outputs detected')}
              </div>
            )}
          </div>
        </div>

        {/* ROW SEPARATOR HORIZONTAL GAP */}
        <div className="lg:col-span-5 h-1 my-0.5 border-b border-[var(--glass-border)]/40" />
        <div className="lg:col-span-5 h-1 my-0.5 border-b border-[var(--glass-border)]/40 lg:col-start-7" />

        {/* BOTTOM-LEFT: VIRTUAL CAPTURE */}
        <div className="lg:col-span-5 space-y-2">
          <div className="space-y-2">
            {topology?.virtual_capture.map((group) => (
              <AlsaSkewerChannelStrip
                key={group.id}
                group={group}
                onControlChange={handleControlChange}
                isLinked={linkedChannels[group.controls[0]?.numid] || false}
                onToggleLink={() => group.controls[0] && toggleChannelLink(group.controls[0].numid)}
                canvasRefSetter={(numid, el) => (canvasRefs.current[numid] = el)}
                endpointIcon={getEndpointIcon(group.category, group.name)}
              />
            ))}
            {(!topology?.virtual_capture || topology.virtual_capture.length === 0) && (
              <div className="h-12 flex items-center justify-center border border-dashed border-[var(--glass-border)] rounded-lg text-xs text-text-secondary/50">
                {t('settings.alsa.noControls', 'No virtual capture streams detected')}
              </div>
            )}
          </div>
        </div>

        {/* BOTTOM-RIGHT: HARDWARE INPUTS */}
        <div className="lg:col-span-5 space-y-2 lg:col-start-7">
          <div className="space-y-2">
            {topology?.hardware_inputs.map((group) => (
              <AlsaSkewerChannelStrip
                key={group.id}
                group={group}
                onControlChange={handleControlChange}
                isLinked={linkedChannels[group.controls[0]?.numid] || false}
                onToggleLink={() => group.controls[0] && toggleChannelLink(group.controls[0].numid)}
                canvasRefSetter={(numid, el) => (canvasRefs.current[numid] = el)}
                endpointIcon={getEndpointIcon(group.category, group.name)}
              />
            ))}
            {(!topology?.hardware_inputs || topology.hardware_inputs.length === 0) && (
              <div className="h-12 flex items-center justify-center border border-dashed border-[var(--glass-border)] rounded-lg text-xs text-text-secondary/50">
                {t('settings.alsa.noControls', 'No hardware inputs detected')}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

interface ChannelStripProps {
  group: AlsaGroup;
  onControlChange: (numid: number, values: any[]) => void;
  isLinked: boolean;
  onToggleLink: () => void;
  canvasRefSetter: (numid: number, el: HTMLCanvasElement | null) => void;
  endpointIcon: React.ReactNode;
}

/* AudioScience Skewer (Brocheta) Channel Strip Component */
const AlsaSkewerChannelStrip: React.FC<ChannelStripProps> = ({
  group,
  onControlChange,
  isLinked,
  onToggleLink,
  canvasRefSetter,
  endpointIcon,
}) => {
  const [activePopup, setActivePopup] = useState<number | null>(null);

  const isVirtualPlayout = group.category === 'virtual_playout';
  const isHardwareOutputs = group.category === 'hardware_outputs';
  const isVirtualCapture = group.category === 'virtual_capture';
  const isHardwareInputs = group.category === 'hardware_inputs';

  return (
    <div className="h-12 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 flex items-center justify-between relative overflow-visible hover:border-brand-lime/40 transition-all">
      {/* Skewer Horizontal Axis Line */}
      <div className="absolute left-4 right-4 top-1/2 -translate-y-1/2 h-[2px] bg-[var(--glass-border)] opacity-70 pointer-events-none z-0" />

      {/* LEFT ENDPOINT */}
      <div className="z-10 flex items-center gap-1.5 bg-[var(--input-bg)] px-1">
        {isVirtualPlayout && (
          <span className="flex items-center gap-1 text-[11px] font-bold text-brand-lime bg-brand-lime/10 border border-brand-lime/30 px-1.5 py-0.5 rounded-full shadow-sm">
            ▶ <span className="font-mono text-[10px] text-text-primary">{group.name}</span>
          </span>
        )}

        {isHardwareOutputs && (
          <span className="text-sky-400 font-bold text-xs" title="From Audio Bus">
            ➔
          </span>
        )}

        {isVirtualCapture && (
          <span className="flex items-center gap-1 text-[11px] font-bold text-red-400 bg-red-500/10 border border-red-500/30 px-1.5 py-0.5 rounded-full shadow-sm">
            🔴 <span className="font-mono text-[10px] text-text-primary">{group.name}</span>
          </span>
        )}

        {isHardwareInputs && (
          <span className="text-amber-400 font-bold text-xs" title="Into Audio Bus">
            ◄
          </span>
        )}
      </div>

      {/* SKEWER CONTROL NODES (MIDDLE BODY) */}
      <div className="z-10 flex items-center gap-2 bg-[var(--input-bg)] px-2">
        {group.controls.map((ctrl) => {
          const isVol = ctrl.ctrl_type === 'volume' || ctrl.ctrl_type === 'integer' || (ctrl.min !== undefined && ctrl.max !== undefined && ctrl.max > ctrl.min);
          const isMute = ctrl.ctrl_type === 'mute' || ctrl.ctrl_type === 'switch' || typeof ctrl.values?.[0] === 'boolean';
          const isEnum = ctrl.ctrl_type === 'enum' || ctrl.ctrl_type === 'route' || (ctrl.items && ctrl.items.length > 0);

          const isOpen = activePopup === ctrl.numid;
          const currentVal = ctrl.values?.[0] ?? 0;
          const isMutedState = isMute ? !currentVal : false;

          if (isMute) {
            return (
              <button
                key={ctrl.numid}
                onClick={() => onControlChange(ctrl.numid, [!currentVal])}
                title={`${ctrl.name}: ${isMutedState ? 'MUTED' : 'ACTIVE'}`}
                className={`px-1.5 py-0.5 rounded text-[11px] font-bold transition-all cursor-pointer shadow-sm ${
                  isMutedState ? 'bg-red-500/20 text-red-400 border border-red-500/40' : 'bg-brand-lime/20 text-brand-lime border border-brand-lime/40'
                }`}
              >
                {isMutedState ? '🔇' : '🔊'}
              </button>
            );
          }

          if (isVol) {
            return (
              <div key={ctrl.numid} className="relative">
                <button
                  onClick={() => setActivePopup(isOpen ? null : ctrl.numid)}
                  title={`${ctrl.name}: ${currentVal} ${ctrl.db_min !== undefined ? 'dB' : ''}`}
                  className="flex items-center gap-1 bg-[var(--bg-card)] border border-[var(--glass-border)] hover:border-brand-lime px-2 py-0.5 rounded text-[10px] font-bold text-text-primary shadow-sm cursor-pointer"
                >
                  <span>🎚️</span>
                  {ctrl.matrix_source && (
                    <span className="text-[9px] text-text-secondary uppercase font-semibold">{ctrl.matrix_source}:</span>
                  )}
                  <span className="font-mono text-brand-lime">
                    {ctrl.db_min !== undefined ? `${currentVal}dB` : currentVal}
                  </span>
                </button>

                {/* Inline Slider Popover */}
                {isOpen && (
                  <div className="absolute bottom-7 left-1/2 -translate-x-1/2 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg p-2 shadow-2xl z-30 flex flex-col items-center gap-1.5 min-w-[140px]">
                    <div className="flex items-center justify-between w-full text-[10px] font-bold text-text-secondary truncate px-1">
                      <span className="truncate">{ctrl.name}</span>
                      {ctrl.channels > 1 && (
                        <button
                          onClick={onToggleLink}
                          title={isLinked ? 'Unlink channels' : 'Link channels'}
                          className="text-[11px] hover:scale-110 transition-transform cursor-pointer"
                        >
                          {isLinked ? '🔗' : '🔓'}
                        </button>
                      )}
                    </div>
                    <input
                      type="range"
                      min={ctrl.min ?? 0}
                      max={ctrl.max ?? 100}
                      step={ctrl.step ?? 1}
                      value={currentVal}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        const vals = isLinked ? new Array(ctrl.channels).fill(v) : [v, ...ctrl.values.slice(1)];
                        onControlChange(ctrl.numid, vals);
                      }}
                      className="w-28 h-1.5 bg-[var(--glass-border)] rounded-lg appearance-none cursor-pointer accent-brand-lime"
                    />
                    <div className="flex items-center justify-between w-full text-[10px] font-mono text-text-secondary">
                      <span>{ctrl.min ?? 0}</span>
                      <span className="font-bold text-brand-lime">{currentVal}</span>
                      <span>{ctrl.max ?? 100}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          }

          if (isEnum && ctrl.items) {
            return (
              <div key={ctrl.numid} className="relative">
                <select
                  value={currentVal}
                  onChange={(e) => onControlChange(ctrl.numid, [parseInt(e.target.value, 10)])}
                  title={ctrl.name}
                  className="bg-[var(--bg-card)] border border-[var(--glass-border)] text-text-primary text-[10px] font-bold rounded px-1.5 py-0.5 focus:outline-none focus:border-brand-lime max-w-[90px] truncate"
                >
                  {ctrl.items.map((item, idx) => (
                    <option key={idx} value={idx}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
            );
          }

          return (
            <span key={ctrl.numid} className="text-[10px] font-mono bg-[var(--glass-border)]/40 px-1 py-0.5 rounded text-text-secondary" title={ctrl.name}>
              ⚙️ {ctrl.name}
            </span>
          );
        })}

        {/* Meters Node */}
        {group.meters.map((meter) => (
          <div key={meter.numid} className="flex items-center gap-1">
            <canvas
              ref={(el) => canvasRefSetter(meter.numid, el)}
              width={36}
              height={16}
              className="rounded bg-black/50 border border-[var(--glass-border)]/50"
            />
          </div>
        ))}
      </div>

      {/* RIGHT ENDPOINT */}
      <div className="z-10 flex items-center gap-1.5 bg-[var(--input-bg)] px-1">
        {isVirtualPlayout && (
          <span className="text-brand-lime font-bold text-xs" title="Into Audio Bus">
            ►
          </span>
        )}

        {isHardwareOutputs && (
          <span className="flex items-center gap-1 text-[11px] font-bold text-sky-400 bg-sky-500/10 border border-sky-500/30 px-1.5 py-0.5 rounded-full shadow-sm">
            ► <span className="font-mono text-[10px] text-text-primary">{group.name}</span>
            <span>{endpointIcon}</span>
          </span>
        )}

        {isVirtualCapture && (
          <span className="text-red-400 font-bold text-xs" title="From Audio Bus">
            ◄
          </span>
        )}

        {isHardwareInputs && (
          <span className="flex items-center gap-1 text-[11px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded-full shadow-sm">
            <span className="font-mono text-[10px] text-text-primary">{group.name}</span>
            <span>{endpointIcon}</span>
          </span>
        )}
      </div>

    </div>
  );
};
