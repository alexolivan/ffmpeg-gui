import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  category: 'virtual_playout' | 'hardware_outputs' | 'virtual_capture' | 'hardware_inputs' | 'system_clock';
  controls: AlsaControl[];
  meters: AlsaControl[];
}

interface ActiveProcessBadge {
  process_id: number;
  alias: string;
  status: string;
  type?: string;
  direction?: 'capture' | 'playout' | 'both';
  device_target?: string;
  pcm_index?: number | null;
  subdevice_index?: number | null;
  cmd?: string;
}

interface AlsaTopology {
  card_index: number;
  virtual_playout: AlsaGroup[];
  hardware_outputs: AlsaGroup[];
  virtual_capture: AlsaGroup[];
  hardware_inputs: AlsaGroup[];
  system_clock?: AlsaGroup[];
  global_controls: AlsaGroup[];
  active_processes?: ActiveProcessBadge[];
}

interface AlsaCard {
  card_index: number;
  card_id: string;
  name: string;
  driver: string;
}

const getGroupProcesses = (group: AlsaGroup, activeProcesses?: ActiveProcessBadge[]) => {
  if (!activeProcesses || activeProcesses.length === 0) return [];
  const grpName = group.name.toLowerCase();
  const numMatch = group.name.match(/\d+/);
  const grpIndex = numMatch ? parseInt(numMatch[0], 10) : null;

  const isPlayoutQuadrant = group.category === 'virtual_playout' || group.category === 'hardware_outputs';
  const isCaptureQuadrant = group.category === 'virtual_capture' || group.category === 'hardware_inputs';

  return activeProcesses.filter((proc) => {
    // 1. Quadrant Direction Filtering
    if (isPlayoutQuadrant && proc.direction === 'capture') return false;
    if (isCaptureQuadrant && proc.direction === 'playout') return false;

    // 2. Direct Explicit Name Match (e.g., alias/cmd contains "PCM 0", "Line 1", etc.)
    const target = (proc.device_target || '').toLowerCase();
    const cmd = (proc.cmd || '').toLowerCase();
    const alias = (proc.alias || '').toLowerCase();

    if (target.includes(grpName) || cmd.includes(grpName) || alias.includes(grpName)) {
      return true;
    }

    // 3. Channel Index Matching (Handling AudioScience hw:0,0,N stream hierarchy)
    if (grpIndex !== null) {
      // In AudioScience hw:card,device,stream (e.g. hw:0,0,1 or hw:0,0,2), subdevice_index (1 or 2) is the stream/channel index!
      let effectiveChanIdx: number | null = null;
      if (proc.subdevice_index !== null && proc.subdevice_index !== undefined && proc.subdevice_index > 0) {
        effectiveChanIdx = proc.subdevice_index;
      } else if (proc.pcm_index !== null && proc.pcm_index !== undefined) {
        effectiveChanIdx = proc.pcm_index;
      } else if (proc.subdevice_index === 0) {
        effectiveChanIdx = 0;
      }

      if (effectiveChanIdx !== null) {
        return effectiveChanIdx === grpIndex;
      }

      // Regex fallback matching hw:0,0,grpIndex or hw:0,grpIndex
      const subdevRegex = new RegExp(`(?:hw|plughw|dsnoop|dmix):\\d+,(?:\\d+,)?${grpIndex}\\b`, 'i');
      if (subdevRegex.test(target) || subdevRegex.test(cmd)) {
        return true;
      }
    }

    // 4. Default fallback for single process without explicit subdevice on PCM 0 / Line 0
    if (grpIndex === 0 && activeProcesses.length === 1) {
      if (cmd.includes("default") || target.includes("default") || (cmd.includes("-f alsa") && (proc.pcm_index === null || proc.pcm_index === undefined))) {
        return true;
      }
    }

    return false;
  });
};

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

  // Render LED bars directly onto HTML5 <canvas> for 0 React DOM re-renders (supports both horizontal & vertical orientations)
  const renderCanvasMeters = (metersMap: Record<number, number[]>) => {
    Object.entries(metersMap).forEach(([numidStr, vals]) => {
      const numid = parseInt(numidStr, 10);
      const canvasEntry = canvasRefs.current[numid];
      if (!canvasEntry) return;

      const canvases = Array.isArray(canvasEntry) ? canvasEntry : [canvasEntry];

      canvases.forEach((canvas) => {
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;
        ctx.clearRect(0, 0, width, height);

        const isVertical = height > width;
        const chCount = vals.length || 1;

        if (isVertical) {
          const barWidth = Math.max(2, Math.floor(width / chCount) - 1);
          vals.forEach((rawVal, chIdx) => {
            const norm = Math.min(1.0, Math.max(0.0, rawVal / 2147483647));
            const fillHeight = Math.floor(height * norm);
            const x = chIdx * (barWidth + 1);
            const y = height - fillHeight;

            // Vertical LED Gradient (Green at bottom -> Yellow -> Red at top)
            const grad = ctx.createLinearGradient(0, height, 0, 0);
            grad.addColorStop(0, '#22c55e');
            grad.addColorStop(0.7, '#eab308');
            grad.addColorStop(1, '#ef4444');

            ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.fillRect(x, 0, barWidth, height);

            ctx.fillStyle = grad;
            ctx.fillRect(x, y, barWidth, fillHeight);
          });
        } else {
          const barHeight = Math.floor(height / chCount) - 2;
          vals.forEach((rawVal, chIdx) => {
            const norm = Math.min(1.0, Math.max(0.0, rawVal / 2147483647));
            const fillWidth = Math.floor(width * norm);
            const y = chIdx * (barHeight + 2);

            const grad = ctx.createLinearGradient(0, 0, width, 0);
            grad.addColorStop(0, '#22c55e');
            grad.addColorStop(0.7, '#eab308');
            grad.addColorStop(1, '#ef4444');

            ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.fillRect(0, y, width, barHeight);

            ctx.fillStyle = grad;
            ctx.fillRect(0, y, fillWidth, barHeight);
          });
        }
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

    if (nameLower.includes('mic')) return <span className="text-amber-400 font-bold">🎙️</span>;
    if (nameLower.includes('speaker')) return <span className="text-sky-400 font-bold">🔊</span>;
    if (nameLower.includes('headphone')) return <span className="text-indigo-400 font-bold">🎧</span>;
    if (nameLower.includes('spdif') || nameLower.includes('digital') || nameLower.includes('aes')) return <span className="text-emerald-400 font-bold">⚡</span>;

    return <span className="text-sky-400 font-bold">🔊</span>;
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
            {topology?.virtual_playout?.map((group) => (
              <AlsaSkewerChannelStrip
                key={group.id}
                group={group}
                activeProcesses={getGroupProcesses(group, topology?.active_processes)}
                onControlChange={handleControlChange}
                isLinked={linkedChannels[group.controls?.[0]?.numid] || false}
                onToggleLink={() => group.controls?.[0] && toggleChannelLink(group.controls[0].numid)}
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
            {topology?.hardware_outputs?.map((group) => (
              <AlsaSkewerChannelStrip
                key={group.id}
                group={group}
                activeProcesses={getGroupProcesses(group, topology?.active_processes)}
                onControlChange={handleControlChange}
                isLinked={linkedChannels[group.controls?.[0]?.numid] || false}
                onToggleLink={() => group.controls?.[0] && toggleChannelLink(group.controls[0].numid)}
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
            {topology?.virtual_capture?.map((group) => (
              <AlsaSkewerChannelStrip
                key={group.id}
                group={group}
                activeProcesses={getGroupProcesses(group, topology?.active_processes)}
                onControlChange={handleControlChange}
                isLinked={linkedChannels[group.controls?.[0]?.numid] || false}
                onToggleLink={() => group.controls?.[0] && toggleChannelLink(group.controls[0].numid)}
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
            {topology?.hardware_inputs?.map((group) => (
              <AlsaSkewerChannelStrip
                key={group.id}
                group={group}
                activeProcesses={getGroupProcesses(group, topology?.active_processes)}
                onControlChange={handleControlChange}
                isLinked={linkedChannels[group.controls?.[0]?.numid] || false}
                onToggleLink={() => group.controls?.[0] && toggleChannelLink(group.controls[0].numid)}
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

      {/* BASE ZONE: SYSTEM & CLOCK COMMON CONTROLS */}
      {((topology?.system_clock && topology.system_clock.length > 0) || (topology?.global_controls && topology.global_controls.length > 0)) && (
        <div className="mt-6 border-t border-[var(--glass-border)]/60 pt-4">
          <div className="text-[11px] font-bold text-text-secondary uppercase tracking-widest mb-3 flex items-center gap-2">
            <span>⏱️</span>
            <span>{t('settings.alsa.systemClockTitle', 'SYSTEM & CLOCK HARDWARE CONTROLS')}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[...(topology.system_clock || []), ...(topology.global_controls || [])].map((group: AlsaGroup) => (
              <div
                key={group.id}
                className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 flex flex-col gap-2 shadow-sm hover:border-brand-lime/40 transition-all"
              >
                <div className="flex items-center justify-between text-xs font-bold text-brand-lime font-mono border-b border-[var(--glass-border)]/50 pb-1">
                  <span>⏱️ {group.name}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {(group?.controls || []).map((ctrl: AlsaControl) => {
                    const isEnum = ctrl.ctrl_type === 'enum' || ctrl.ctrl_type === 'route' || (ctrl.items && ctrl.items.length > 0);
                    const currentVal = ctrl.values?.[0] ?? 0;

                    if (isEnum && ctrl.items) {
                      return (
                        <div key={ctrl.numid} className="flex flex-col gap-1 w-full text-[10px]">
                          <span className="text-text-secondary font-bold truncate">{ctrl.name}</span>
                          <select
                            value={currentVal}
                            onChange={(e) => handleControlChange(ctrl.numid, [parseInt(e.target.value, 10)])}
                            className="bg-[var(--bg-card)] border border-[var(--glass-border)] text-text-primary text-[11px] font-bold rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-lime cursor-pointer w-full"
                          >
                            {ctrl.items.map((item: string, idx: number) => (
                              <option key={idx} value={idx}>
                                {item}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    }

                    return (
                      <div key={ctrl.numid} className="flex items-center justify-between w-full text-[11px] bg-[var(--bg-card)] p-2 rounded-lg border border-[var(--glass-border)]">
                        <span className="text-text-secondary font-bold truncate">{ctrl.name}:</span>
                        <span className="font-mono font-bold text-brand-lime ml-2">{currentVal}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const formatControlValue = (ctrl?: AlsaControl, rawVal?: any): string => {
  if (!ctrl || rawVal === undefined || rawVal === null) return 'N/A';

  const numVal = Number(rawVal);
  if (isNaN(numVal)) return `${rawVal}`;

  if (ctrl.db_min !== undefined) {
    if (numVal <= (ctrl.min ?? 0) && ctrl.db_min <= -50) {
      return '-∞ dB';
    }
    const isHundredths = Math.abs(ctrl.db_min) > 200;
    const dbVal = isHundredths ? numVal / 100 : numVal;
    return `${dbVal > 0 ? '+' : ''}${dbVal.toFixed(1)} dB`;
  }

  const min = ctrl.min ?? 0;
  const max = ctrl.max ?? 100;
  if (max > min) {
    const pct = Math.round(((numVal - min) / (max - min)) * 100);
    return `${pct}%`;
  }

  return `${numVal}`;
};

interface ChannelStripProps {
  group: AlsaGroup;
  activeProcesses?: ActiveProcessBadge[];
  onControlChange: (numid: number, values: any[]) => void;
  isLinked: boolean;
  onToggleLink: () => void;
  canvasRefSetter: (numid: number, el: HTMLCanvasElement | null) => void;
  endpointIcon: React.ReactNode;
}

/* AudioScience Skewer (Brocheta) Channel Strip Component */
const AlsaSkewerChannelStrip: React.FC<ChannelStripProps> = ({
  group,
  activeProcesses,
  onControlChange,
  isLinked,
  onToggleLink,
  canvasRefSetter,
  endpointIcon,
}) => {
  const [activePopup, setActivePopup] = useState<string | number | null>(null);

  const isVirtualPlayout = group.category === 'virtual_playout';
  const isHardwareOutputs = group.category === 'hardware_outputs';
  const isVirtualCapture = group.category === 'virtual_capture';
  const isHardwareInputs = group.category === 'hardware_inputs';

  const controls = group?.controls || [];
  const meters = group?.meters || [];

  // Separate matrix crosspoint controls (controls with explicit matrix_source or crosstalk patterns) from direct controls
  const matrixControls: AlsaControl[] = [];
  const directControls: AlsaControl[] = [];

  controls.forEach((c) => {
    if (!c) return;
    const nameLower = c.name.toLowerCase();
    const grpLower = group.name.toLowerCase();

    // ENUM/ROUTE selector controls (e.g., Digital 0 Playback Format) are ALWAYS direct controls, never matrix crosspoints
    const isEnumOrRoute =
      c.ctrl_type === 'enum' ||
      c.ctrl_type === 'route' ||
      (c.items && c.items.length > 0);

    if (isEnumOrRoute) {
      directControls.push(c);
      return;
    }

    const isMasterControl =
      nameLower === `${grpLower} playback level` ||
      nameLower === `${grpLower} playback volume` ||
      nameLower === `${grpLower} playback switch` ||
      nameLower === `${grpLower} master volume` ||
      nameLower === `${grpLower} master level` ||
      nameLower === `${grpLower} master switch` ||
      nameLower === `master playback volume` ||
      nameLower === `master playback switch` ||
      nameLower === `master volume`;

    const isExplicitMatrix = !!c.matrix_source;

    // Check if control has explicit double-entity crosstalk pattern (e.g., "Digital 0 Line 0 Monitor Playback Volume")
    const hasCrosstalkPattern =
      (nameLower.includes('pcm') || nameLower.includes('digital') || nameLower.includes('line') || nameLower.includes('mic') || nameLower.includes('aux')) &&
      (nameLower.includes('monitor') || !!nameLower.match(/(pcm|digital|line|mic|aux)\s+\d+.*(pcm|digital|line|mic|aux)\s+\d+/i));

    if (isExplicitMatrix || (isHardwareOutputs && !isMasterControl && hasCrosstalkPattern)) {
      matrixControls.push(c);
    } else {
      directControls.push(c);
    }
  });

  // Group matrix controls by source name
  const matrixSourcesMap: Record<string, { vol?: AlsaControl; mute?: AlsaControl }> = {};
  matrixControls.forEach((c) => {
    let src = c.matrix_source;
    if (!src) {
      let cleaned = c.name;
      const isMon = /monitor/i.test(cleaned);

      // Strip control type noise words
      cleaned = cleaned.replace(/playback|capture|volume|switch|level|monitor|master/gi, '').trim();

      // Remove EXACTLY ONE instance of destination group.name (regardless of whether it's first or second in c.name)
      const escapedGrpName = group.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      cleaned = cleaned.replace(new RegExp('\\b' + escapedGrpName + '\\b', 'i'), '').trim();

      // What remains in 'cleaned' IS the pure source name!
      if (cleaned) {
        src = isMon ? `${cleaned} (Mon)` : cleaned;
      } else {
        src = isMon ? `${group.name} (Mon)` : group.name;
      }
    }

    if (!matrixSourcesMap[src]) matrixSourcesMap[src] = {};

    const nameLower = c.name.toLowerCase();
    if (c.ctrl_type === 'volume' || c.ctrl_type === 'integer' || nameLower.includes('volume') || nameLower.includes('level')) {
      matrixSourcesMap[src].vol = c;
    } else if (c.ctrl_type === 'mute' || c.ctrl_type === 'switch' || nameLower.includes('switch') || nameLower.includes('mute')) {
      matrixSourcesMap[src].mute = c;
    }
  });

  const isMixerOpen = activePopup === 'mixer';

  return (
    <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl flex flex-col overflow-visible hover:border-brand-lime/40 transition-all shadow-sm">
      {/* TOP TIER: SKEWER AXIS & ICONS (PURE GRAPHICS / NO TEXT) */}
      <div className="h-10 px-3 flex items-center justify-start relative overflow-visible">
        {/* Skewer Horizontal Axis Line */}
        <div className="absolute left-4 right-4 top-1/2 -translate-y-1/2 h-[2px] bg-[var(--glass-border)] opacity-70 pointer-events-none z-0" />

        {/* LEFT ENDPOINT (FIXED OFFSET FOR PERFECT ABACUS ALIGNMENT) */}
        <div className="z-10 flex items-center justify-center gap-1.5 bg-[var(--input-bg)] px-1 w-9 shrink-0">
          {/* Virtual Capture Destination: REC badge + Left arrow pointing into REC badge */}
          {isVirtualCapture && (
            <span className="text-red-400 font-bold text-xs flex items-center gap-1" title="Virtual Capture Destination">
              <span className="text-xs">🔴</span>
              <span className="text-xs">◄</span>
            </span>
          )}

          {/* Hardware Inputs Destination: Left arrow pointing into Audio Bus */}
          {isHardwareInputs && (
            <span className="text-amber-400 font-bold text-xs" title="Into Audio Bus">
              ◄
            </span>
          )}
        </div>

        {/* SKEWER CONTROL NODES (MIDDLE BODY) - UNCONDITIONAL SEQUENTIAL ABACUS ALIGNMENT */}
        <div className="z-10 flex items-center justify-start gap-1.5 bg-[var(--input-bg)] px-1">
          {/* 1. MIXER MATRIX NODE (🎛️) */}
          {Object.keys(matrixSourcesMap).length > 0 && (
            <div className="w-9 flex items-center justify-center">
              <div className="relative">
                <button
                  onClick={() => setActivePopup(isMixerOpen ? null : 'mixer')}
                  title={`Hardware Sub-Mixer Matrix (${Object.keys(matrixSourcesMap).length} Sources)`}
                  className={`p-1.5 rounded-lg border text-sm transition-all cursor-pointer shadow-sm ${
                    isMixerOpen
                      ? 'bg-brand-lime/30 border-brand-lime text-brand-lime scale-110'
                      : 'bg-[var(--bg-card)] border-[var(--glass-border)] hover:border-brand-lime text-text-primary'
                  }`}
                >
                  🎛️
                </button>

                {/* VERTICAL MIXING CONSOLE FIXED CENTERED BACKDROP MODAL (PORTAL TO ROOT BODY) */}
                {isMixerOpen && createPortal(
                  <div
                    className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
                    onClick={() => setActivePopup(null)}
                  >
                    <div
                      className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-5 shadow-2xl max-w-[90vw] max-h-[85vh] overflow-auto"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2.5 mb-4 min-w-[280px]">
                        <span className="text-xs font-bold text-text-primary uppercase tracking-wider flex items-center gap-2">
                          <span className="text-base">🎛️</span>
                          <span>{group.name} Sub-Mixer Console</span>
                        </span>
                        <button
                          onClick={() => setActivePopup(null)}
                          className="text-text-secondary hover:text-text-primary text-xs font-bold px-2 py-1 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg hover:border-brand-lime transition-all cursor-pointer"
                        >
                          ✕
                        </button>
                      </div>

                      {/* Vertical Side-by-Side Channel Fader Strips */}
                      <div className="flex items-end justify-center gap-4 overflow-x-auto py-1">
                        {Object.entries(matrixSourcesMap).map(([srcName, ctrlPair]) => {
                          const volCtrl = ctrlPair.vol;
                          const muteCtrl = ctrlPair.mute;

                          const volValL = volCtrl?.values?.[0] ?? 0;
                          const volValR = volCtrl?.channels && volCtrl.channels > 1 ? (volCtrl.values?.[1] ?? volValL) : volValL;
                          const isMuted = muteCtrl ? !muteCtrl.values?.[0] : false;
                          const isStereo = (volCtrl?.channels ?? 1) > 1;

                          return (
                            <div
                              key={srcName}
                              className="flex flex-col items-center gap-1.5 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 min-w-[95px]"
                            >
                              {/* Source Label (Multi-line wrap support with uniform h-8 height) */}
                              <div
                                className="h-8 flex items-center justify-center text-[10px] font-bold text-brand-lime font-mono leading-tight text-center whitespace-normal break-words w-full px-1 select-none"
                                title={srcName}
                              >
                                {srcName}
                              </div>

                              {/* Clean Formatted dB / Readout */}
                              <div className="text-[10px] font-mono font-bold text-text-primary">
                                {formatControlValue(volCtrl, volValL)}
                                {isStereo && !isLinked && (
                                  <span className="text-text-secondary text-[9px] ml-0.5">/{formatControlValue(volCtrl, volValR)}</span>
                                )}
                              </div>

                              {/* Vertical Range Sliders */}
                              {volCtrl ? (
                                <div className="h-28 flex flex-col items-center justify-center py-1 gap-1">
                                  {isStereo ? (
                                    <div className="flex items-center gap-2">
                                      <div className="flex flex-col items-center gap-1">
                                        <span className="text-[9px] font-mono font-bold text-text-secondary">L</span>
                                        <input
                                          type="range"
                                          min={volCtrl.min ?? 0}
                                          max={volCtrl.max ?? 100}
                                          step={volCtrl.step ?? 1}
                                          value={volValL}
                                          onChange={(e) => {
                                            const vL = parseInt(e.target.value, 10);
                                            const newVals = isLinked ? new Array(volCtrl.channels).fill(vL) : [vL, volValR];
                                            onControlChange(volCtrl.numid, newVals);
                                          }}
                                          className="w-2 h-20 [writing-mode:vertical-lr] [direction:rtl] appearance-none bg-[var(--glass-border)] rounded cursor-pointer accent-brand-lime"
                                        />
                                      </div>
                                      <div className="flex flex-col items-center gap-1">
                                        <span className="text-[9px] font-mono font-bold text-text-secondary">R</span>
                                        <input
                                          type="range"
                                          min={volCtrl.min ?? 0}
                                          max={volCtrl.max ?? 100}
                                          step={volCtrl.step ?? 1}
                                          value={volValR}
                                          onChange={(e) => {
                                            const vR = parseInt(e.target.value, 10);
                                            const newVals = isLinked ? new Array(volCtrl.channels).fill(vR) : [volValL, vR];
                                            onControlChange(volCtrl.numid, newVals);
                                          }}
                                          className="w-2 h-20 [writing-mode:vertical-lr] [direction:rtl] appearance-none bg-[var(--glass-border)] rounded cursor-pointer accent-brand-lime"
                                        />
                                      </div>
                                    </div>
                                  ) : (
                                    <input
                                      type="range"
                                      min={volCtrl.min ?? 0}
                                      max={volCtrl.max ?? 100}
                                      step={volCtrl.step ?? 1}
                                      value={volValL}
                                      onChange={(e) => {
                                        const v = parseInt(e.target.value, 10);
                                        onControlChange(volCtrl.numid, [v]);
                                      }}
                                      className="w-2.5 h-24 [writing-mode:vertical-lr] [direction:rtl] appearance-none bg-[var(--glass-border)] rounded-lg cursor-pointer accent-brand-lime"
                                    />
                                  )}

                                  {/* Stereo Link Button */}
                                  {isStereo && (
                                    <button
                                      onClick={onToggleLink}
                                      title={isLinked ? 'Unlink L/R Channels' : 'Link L/R Channels'}
                                      className="text-xs hover:scale-110 transition-transform cursor-pointer mt-0.5"
                                    >
                                      {isLinked ? '🔗' : '🔓'}
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <div className="h-28 flex items-center justify-center text-[10px] text-text-secondary/40">N/A</div>
                              )}

                              {/* Mute Toggle Button directly below Fader */}
                              {muteCtrl ? (
                                <button
                                  onClick={() => onControlChange(muteCtrl.numid, [!muteCtrl.values[0]])}
                                  className={`w-full py-1 rounded text-[10px] font-bold transition-all cursor-pointer border ${
                                    isMuted
                                      ? 'bg-red-500/20 text-red-400 border-red-500/40'
                                      : 'bg-brand-lime/20 text-brand-lime border-brand-lime/40'
                                  }`}
                                >
                                  {isMuted ? 'MUTE' : 'ON'}
                                </button>
                              ) : (
                                <div className="h-6 flex items-center justify-center text-[9px] text-text-secondary/30">-</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>,
                  document.body
                )}
              </div>
            </div>
          )}

          {/* 2. DIRECT (NON-MATRIX) CONTROLS SEQUENTIALLY PACKED */}
          {directControls.map((ctrl) => {
            const nameLower = ctrl.name.toLowerCase();
            const isEnum = ctrl.ctrl_type === 'enum' || ctrl.ctrl_type === 'route' || (ctrl.items && ctrl.items.length > 0);
            const isStatus = nameLower.includes('status') || nameLower.includes('lock') || nameLower.includes('sync');
            const isMute = !isEnum && !isStatus && (ctrl.ctrl_type === 'mute' || ctrl.ctrl_type === 'switch' || typeof ctrl.values?.[0] === 'boolean');
            const isVol = !isEnum && !isStatus && !isMute && (ctrl.ctrl_type === 'volume' || ctrl.ctrl_type === 'integer' || (ctrl.min !== undefined && ctrl.max !== undefined && ctrl.max > ctrl.min));

            const isOpen = activePopup === ctrl.numid;
            const currentVal = ctrl.values?.[0] ?? 0;
            const isMutedState = isMute ? !currentVal : false;

            // DIGITAL RECEIVER STATUS / LOCK INDICATOR NODE (e.g. Digital 0 Capture Status)
            if (isStatus) {
              const isLocked = (currentVal & 1) !== 0;
              const hasParityErr = (currentVal & 4) !== 0;
              const hasValErr = (currentVal & 8) !== 0;
              const hasRateErr = (currentVal & 16) !== 0;

              return (
                <div key={ctrl.numid} className="w-9 flex items-center justify-center">
                  <div className="relative">
                    <button
                      onClick={() => setActivePopup(isOpen ? null : ctrl.numid)}
                      title={`${ctrl.name}: ${isLocked ? 'LOCKED (Signal OK)' : 'NO LOCK (Signal Loss)'}`}
                      className={`p-1.5 rounded-lg border text-sm shadow-sm transition-all cursor-pointer ${
                        isLocked
                          ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 hover:border-emerald-300'
                          : 'bg-red-500/20 text-red-400 border-red-500/40 hover:border-red-300'
                      }`}
                    >
                      {isLocked ? '🔒' : '🔓'}
                    </button>

                    {isOpen && createPortal(
                      <div
                        className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
                        onClick={() => setActivePopup(null)}
                      >
                        <div
                          className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-5 shadow-2xl min-w-[270px] max-w-[90vw] flex flex-col items-center gap-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-between w-full border-b border-[var(--glass-border)] pb-2.5 gap-4">
                            <span className="text-xs font-bold text-text-primary uppercase tracking-wider flex items-center gap-1.5">
                              <span className="text-sm">{isLocked ? '🔒' : '🔓'}</span>
                              <span>{ctrl.name}</span>
                            </span>
                            <button
                              onClick={() => setActivePopup(null)}
                              className="text-text-secondary hover:text-text-primary text-xs font-bold px-2 py-0.5 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-md hover:border-brand-lime transition-all cursor-pointer"
                            >
                              ✕
                            </button>
                          </div>

                          {/* Status Bitmask Breakdown Table */}
                          <div className="w-full flex flex-col gap-2 font-mono text-[11px]">
                            <div className="flex items-center justify-between p-2 rounded-lg bg-[var(--input-bg)] border border-[var(--glass-border)]">
                              <span className="text-text-secondary">Receiver Lock (Bit 0):</span>
                              <span className={`font-bold ${isLocked ? 'text-emerald-400' : 'text-red-400'}`}>
                                {isLocked ? '🟢 LOCKED' : '🔴 NO SIGNAL'}
                              </span>
                            </div>

                            <div className="flex items-center justify-between p-2 rounded-lg bg-[var(--input-bg)] border border-[var(--glass-border)]">
                              <span className="text-text-secondary">Parity Status (Bit 2):</span>
                              <span className={`font-bold ${hasParityErr ? 'text-red-400' : 'text-emerald-400'}`}>
                                {hasParityErr ? '❌ ERROR' : '✅ OK'}
                              </span>
                            </div>

                            <div className="flex items-center justify-between p-2 rounded-lg bg-[var(--input-bg)] border border-[var(--glass-border)]">
                              <span className="text-text-secondary">Frame Validity (Bit 3):</span>
                              <span className={`font-bold ${hasValErr ? 'text-amber-400' : 'text-emerald-400'}`}>
                                {hasValErr ? '⚠️ INVALID' : '✅ VALID'}
                              </span>
                            </div>

                            <div className="flex items-center justify-between p-2 rounded-lg bg-[var(--input-bg)] border border-[var(--glass-border)]">
                              <span className="text-text-secondary">Sample Rate Sync (Bit 4):</span>
                              <span className={`font-bold ${hasRateErr ? 'text-amber-400' : 'text-emerald-400'}`}>
                                {hasRateErr ? '⚠️ MISMATCH' : '✅ OK'}
                              </span>
                            </div>

                            <div className="flex items-center justify-between px-2 pt-1 text-[10px] text-text-secondary">
                              <span>Raw Bitmask:</span>
                              <span className="font-mono">{currentVal} (0x{currentVal.toString(16).padStart(2, '0')})</span>
                            </div>
                          </div>
                        </div>
                      </div>,
                      document.body
                    )}
                  </div>
                </div>
              );
            }

            if (isEnum && ctrl.items && ctrl.items.length > 0) {
              const isModeCrossover = nameLower.includes('mode') || nameLower.includes('swap') || nameLower.includes('channel');
              const isCaptureRoute = nameLower.includes('route') || nameLower.includes('source') || nameLower.includes('input');

              const selectorIcon = isModeCrossover ? '🔀' : isCaptureRoute ? '📥' : '⚙️';
              const selectorTitle = isModeCrossover
                ? `Channel Mode / Crossover (${ctrl.name}): ${ctrl.items[currentVal] || currentVal}`
                : isCaptureRoute
                ? `Capture Ingestion Source (${ctrl.name}): ${ctrl.items[currentVal] || currentVal}`
                : `${ctrl.name}: ${ctrl.items[currentVal] || currentVal}`;

              return (
                <div key={ctrl.numid} className="w-9 flex items-center justify-center">
                  <div className="relative">
                    <button
                      onClick={() => setActivePopup(isOpen ? null : ctrl.numid)}
                      title={selectorTitle}
                      className={`p-1.5 rounded-lg border text-sm shadow-sm transition-all cursor-pointer ${
                        isModeCrossover
                          ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 hover:border-indigo-400'
                          : isCaptureRoute
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:border-amber-400'
                          : 'bg-[var(--bg-card)] border-[var(--glass-border)] text-text-primary hover:border-brand-lime'
                      }`}
                    >
                      {selectorIcon}
                    </button>

                    {isOpen && createPortal(
                      <div
                        className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
                        onClick={() => setActivePopup(null)}
                      >
                        <div
                          className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-4 shadow-2xl min-w-[200px] max-w-[90vw] flex flex-col items-center gap-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-between w-full border-b border-[var(--glass-border)] pb-2 gap-4">
                            <span className="text-xs font-bold text-text-primary uppercase tracking-wider truncate">
                              {ctrl.name}
                            </span>
                            <button
                              onClick={() => setActivePopup(null)}
                              className="text-text-secondary hover:text-text-primary text-xs font-bold px-2 py-0.5 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-md hover:border-brand-lime transition-all cursor-pointer"
                            >
                              ✕
                            </button>
                          </div>
                          <select
                            value={currentVal}
                            onChange={(e) => onControlChange(ctrl.numid, [parseInt(e.target.value, 10)])}
                            className="bg-[var(--input-bg)] border border-[var(--glass-border)] text-text-primary text-[11px] font-bold rounded-lg px-3 py-2 focus:outline-none focus:border-brand-lime w-full cursor-pointer"
                          >
                            {ctrl.items.map((item, idx) => (
                              <option key={idx} value={idx}>
                                {item}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>,
                      document.body
                    )}
                  </div>
                </div>
              );
            }

            if (isMute) {
              return (
                <div key={ctrl.numid} className="w-9 flex items-center justify-center">
                  <button
                    onClick={() => onControlChange(ctrl.numid, [!currentVal])}
                    title={`${ctrl.name}: ${isMutedState ? 'MUTED' : 'ACTIVE'}`}
                    className={`p-1.5 rounded-lg border text-sm transition-all cursor-pointer shadow-sm ${
                      isMutedState
                        ? 'bg-red-500/20 text-red-400 border-red-500/40'
                        : 'bg-brand-lime/20 text-brand-lime border-brand-lime/40'
                    }`}
                  >
                    {isMutedState ? '🔇' : '🔊'}
                  </button>
                </div>
              );
            }

            if (isVol) {
              return (
                <div key={ctrl.numid} className="w-9 flex items-center justify-center">
                  <div className="relative">
                    <button
                      onClick={() => setActivePopup(isOpen ? null : ctrl.numid)}
                      title={`${ctrl.name}: ${formatControlValue(ctrl, currentVal)}`}
                      className="p-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--glass-border)] hover:border-brand-lime text-sm text-text-primary shadow-sm cursor-pointer"
                    >
                      🎚️
                    </button>

                    {isOpen && createPortal(
                      <div
                        className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
                        onClick={() => setActivePopup(null)}
                      >
                        <div
                          className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-4 shadow-2xl min-w-[150px] max-w-[90vw] flex flex-col items-center gap-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-between w-full border-b border-[var(--glass-border)] pb-2 gap-4">
                            <span className="text-xs font-bold text-text-primary uppercase tracking-wider truncate">
                              {ctrl.name}
                            </span>
                            <button
                              onClick={() => setActivePopup(null)}
                              className="text-text-secondary hover:text-text-primary text-xs font-bold px-2 py-0.5 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-md hover:border-brand-lime transition-all cursor-pointer"
                            >
                              ✕
                            </button>
                          </div>

                          {/* 100% STRICT VERTICAL FADER MODAL */}
                          <div className="flex flex-col items-center gap-2 py-2">
                            <div className="text-[11px] font-mono font-bold text-brand-lime">
                              {formatControlValue(ctrl, currentVal)}
                            </div>
                            <div className="h-32 flex items-center justify-center py-1">
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
                                className="w-2.5 h-28 [writing-mode:vertical-lr] [direction:rtl] appearance-none bg-[var(--glass-border)] rounded-lg cursor-pointer accent-brand-lime"
                              />
                            </div>
                            <div className="flex items-center justify-between w-full text-[9px] font-mono text-text-secondary gap-3">
                              <span>{formatControlValue(ctrl, ctrl.min)}</span>
                              <span>{formatControlValue(ctrl, ctrl.max)}</span>
                            </div>
                          </div>
                        </div>
                      </div>,
                      document.body
                    )}
                  </div>
                </div>
              );
            }

            return null;
          })}

          {/* 3. CLICKABLE STANDARD SQUARE VUMETER NODE (w-9 h-8 Slot with Vertical LED Preview & Full-Height Vertical Modal) */}
          {meters.length > 0 && meters[0] && (() => {
            const meterCtrl = meters[0];
            const isMeterOpen = activePopup === meterCtrl.numid;

            return (
              <div key={meterCtrl.numid} className="w-9 flex items-center justify-center">
                <div className="relative">
                  <button
                    onClick={() => setActivePopup(isMeterOpen ? null : meterCtrl.numid)}
                    title={`${meterCtrl.name || 'Peak Meter'} (Click for Vertical Meter Console)`}
                    className={`w-9 h-8 rounded-lg border p-1 flex items-center justify-center transition-all cursor-pointer shadow-sm ${
                      isMeterOpen
                        ? 'bg-brand-lime/30 border-brand-lime scale-105'
                        : 'bg-[var(--bg-card)] border-[var(--glass-border)] hover:border-brand-lime'
                    }`}
                  >
                    <canvas
                      ref={(el) => canvasRefSetter(meterCtrl.numid, el)}
                      width={16}
                      height={22}
                      className="w-4 h-5 rounded bg-black/90"
                    />
                  </button>

                  {/* FULL-SIZE VERTICAL PEAK METER CONSOLE PORTAL MODAL */}
                  {isMeterOpen && createPortal(
                    <div
                      className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
                      onClick={() => setActivePopup(null)}
                    >
                      <div
                        className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-5 shadow-2xl min-w-[220px] max-w-[90vw] flex flex-col items-center gap-4"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-between w-full border-b border-[var(--glass-border)] pb-2.5 gap-4">
                          <span className="text-xs font-bold text-text-primary uppercase tracking-wider flex items-center gap-2">
                            <span className="text-base">📊</span>
                            <span>{meterCtrl.name || group.name + ' Peak Meter'}</span>
                          </span>
                          <button
                            onClick={() => setActivePopup(null)}
                            className="text-text-secondary hover:text-text-primary text-xs font-bold px-2 py-0.5 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-md hover:border-brand-lime transition-all cursor-pointer"
                          >
                            ✕
                          </button>
                        </div>

                        {/* Full-Height Vertical Stereo/Mono Peak Meter Bars */}
                        <div className="flex items-center justify-center gap-4 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-4 min-w-[150px]">
                          <div className="h-44 flex flex-col items-center justify-between font-mono text-[9px] text-text-secondary py-1 select-none">
                            <span className="text-red-400 font-bold">0dB</span>
                            <span>-6dB</span>
                            <span>-12dB</span>
                            <span className="text-amber-400 font-bold">-20dB</span>
                            <span>-30dB</span>
                            <span className="text-emerald-400 font-bold">-60dB</span>
                          </div>
                          <div className="h-44 bg-black/90 border border-[var(--glass-border)] rounded-lg p-1.5 flex items-center justify-center shadow-inner">
                            <canvas
                              ref={(el) => canvasRefSetter(meterCtrl.numid, el)}
                              width={36}
                              height={160}
                              className="w-9 h-40 rounded"
                            />
                          </div>
                        </div>
                      </div>
                    </div>,
                    document.body
                  )}
                </div>
              </div>
            );
          })()}
        </div>

        {/* RIGHT ENDPOINT (DESTINATION FOR VIRTUAL PLAYOUT & HARDWARE OUTPUTS) */}
        <div className="z-10 flex items-center justify-center gap-1.5 bg-[var(--input-bg)] px-1 ml-auto min-w-[36px] shrink-0">
          {/* Virtual Playout Destination: Right arrow pointing into Audio Bus */}
          {isVirtualPlayout && (
            <span className="text-brand-lime font-bold text-xs" title="Into Audio Bus">
              ►
            </span>
          )}

          {/* Hardware Outputs Destination: Right arrow + physical output device icon */}
          {isHardwareOutputs && (
            <span className="text-sky-400 font-bold text-sm flex items-center gap-1" title="Into Hardware Output Device">
              <span className="text-xs">►</span>
              <span>{endpointIcon}</span>
            </span>
          )}

          {/* Hardware Inputs Origin: Physical input device icon (no arrow) */}
          {isHardwareInputs && (
            <span className="text-amber-400 font-bold text-sm" title="From Hardware Input Device">
              {endpointIcon}
            </span>
          )}
        </div>
      </div>

      {/* BOTTOM TIER: SUBTEXT INFORMATION BAR (PURE TEXT ONLY) */}
      <div className="h-5 px-3 bg-[var(--bg-card)]/70 border-t border-[var(--glass-border)]/40 rounded-b-xl flex items-center justify-between text-[10px] font-mono text-text-secondary select-none">
        {/* LEFT: CHANNEL / CONTROL GROUP NAME */}
        <span className="font-bold text-text-primary uppercase tracking-wider flex items-center gap-1">
          <span>{group.name}</span>
        </span>

        {/* RIGHT: FFMPEG ACTIVE PROCESS ALIASES (ONLY WHEN RUNNING) */}
        <div className="flex items-center gap-2">
          {activeProcesses && activeProcesses.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-brand-lime font-semibold uppercase">FFmpeg:</span>
              {activeProcesses.map((proc) => (
                <span
                  key={proc.process_id}
                  title={`Process #${proc.process_id} (${proc.status})`}
                  className="bg-brand-lime/10 border border-brand-lime/30 text-brand-lime text-[9px] px-1.5 py-0.2 rounded font-mono font-bold"
                >
                  {proc.alias}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
