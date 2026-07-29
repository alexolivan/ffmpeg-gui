import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

interface AlsaControl {
  numid: number;
  name: string;
  ctrl_type: string; // 'volume', 'mute', 'switch', 'route', 'enum', 'meter'
  is_meter: boolean;
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
      {/* Card Header & Selector */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-[var(--glass-border)] pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-brand-lime/10 border border-brand-lime/30 text-brand-lime font-bold text-lg">
            🔊
          </div>
          <div>
            <h3 className="text-base font-bold text-text-primary uppercase tracking-wider">
              {t('settings.alsa.title', 'ALSA AUDIO HARDWARE MIXER')}
            </h3>
            <p className="text-xs text-text-secondary">
              {t('settings.alsa.subtitle', 'Broadcast 4-Quadrant Topological Signal Routing & Gain Control')}
            </p>
          </div>
        </div>

        {/* Sound Card Selector Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto max-w-full">
          {cards.map((c) => (
            <button
              key={c.card_index}
              onClick={() => setSelectedCardIdx(c.card_index)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                selectedCardIdx === c.card_index
                  ? 'bg-brand-lime text-black font-bold shadow-lg shadow-brand-lime/20'
                  : 'bg-[var(--input-bg)] text-text-secondary hover:text-text-primary border border-[var(--glass-border)]'
              }`}
            >
              📻 Card {c.card_index}: {c.name || c.card_id}
            </button>
          ))}
        </div>
      </div>

      {/* Active Process Badges Banner */}
      {topology?.active_processes && topology.active_processes.length > 0 && (
        <div className="bg-brand-lime/10 border border-brand-lime/30 rounded-lg p-3 flex items-center gap-2 text-xs text-brand-lime">
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

      {/* 4-QUADRANT BROADCAST GRID LAYOUT */}
      <div className="grid grid-cols-1 lg:grid-cols-11 gap-4 items-stretch">
        
        {/* TOP-LEFT: VIRTUAL PLAYOUT */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between text-xs font-bold text-text-primary border-b border-[var(--glass-border)] pb-2">
            <span className="flex items-center gap-1.5">
              <span className="text-brand-lime">▶</span>
              {t('settings.alsa.quadrant1', '1. VIRTUAL PLAYOUT (SOFTWARE INGESTION)')}
            </span>
            <span className="text-brand-lime/70 font-bold">➔</span>
          </div>
          <div className="space-y-2.5">
            {topology?.virtual_playout.map((group) => (
              <AlsaChannelStrip
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
              <div className="h-16 flex items-center justify-center border border-dashed border-[var(--glass-border)] rounded-lg text-xs text-text-secondary/50">
                {t('settings.alsa.noControls', 'No virtual playout streams detected')}
              </div>
            )}
          </div>
        </div>

        {/* CENTRAL BUS TRUNK COLUMN */}
        <div className="lg:col-span-1 hidden lg:flex flex-col items-center justify-between py-6">
          <div className="w-1.5 h-full bg-gradient-to-b from-brand-lime via-indigo-500 to-red-500 rounded-full opacity-60" />
          <div className="my-2 px-1 py-3 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded text-[10px] font-mono text-text-secondary uppercase tracking-widest text-center rotate-180 [writing-mode:vertical-lr]">
            CENTRAL SIGNAL TRUNK
          </div>
          <div className="w-1.5 h-full bg-gradient-to-b from-red-500 via-indigo-500 to-brand-lime rounded-full opacity-60" />
        </div>

        {/* TOP-RIGHT: HARDWARE OUTPUTS */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between text-xs font-bold text-text-primary border-b border-[var(--glass-border)] pb-2">
            <span className="text-sky-400/70 font-bold">➔</span>
            <span className="flex items-center gap-1.5">
              <span className="text-sky-400">🔊</span>
              {t('settings.alsa.quadrant2', '2. HARDWARE OUTPUTS (PHYSICAL EGRESS)')}
            </span>
          </div>
          <div className="space-y-2.5">
            {topology?.hardware_outputs.map((group) => (
              <AlsaChannelStrip
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
              <div className="h-16 flex items-center justify-center border border-dashed border-[var(--glass-border)] rounded-lg text-xs text-text-secondary/50">
                {t('settings.alsa.noControls', 'No hardware outputs detected')}
              </div>
            )}
          </div>
        </div>

        {/* ROW SEPARATOR GAP */}
        <div className="lg:col-span-11 h-2 my-2 border-b border-[var(--glass-border)]/40" />

        {/* BOTTOM-LEFT: VIRTUAL CAPTURE */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between text-xs font-bold text-text-primary border-b border-[var(--glass-border)] pb-2">
            <span className="flex items-center gap-1.5">
              <span className="text-red-400">🔴</span>
              {t('settings.alsa.quadrant3', '3. VIRTUAL CAPTURE (FFMPEG INGESTION)')}
            </span>
            <span className="text-red-400/70 font-bold">⬅</span>
          </div>
          <div className="space-y-2.5">
            {topology?.virtual_capture.map((group) => (
              <AlsaChannelStrip
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
              <div className="h-16 flex items-center justify-center border border-dashed border-[var(--glass-border)] rounded-lg text-xs text-text-secondary/50">
                {t('settings.alsa.noControls', 'No virtual capture streams detected')}
              </div>
            )}
          </div>
        </div>

        {/* BOTTOM-RIGHT: HARDWARE INPUTS */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between text-xs font-bold text-text-primary border-b border-[var(--glass-border)] pb-2">
            <span className="text-amber-400/70 font-bold">⬅</span>
            <span className="flex items-center gap-1.5">
              <span className="text-amber-400">🎤</span>
              {t('settings.alsa.quadrant4', '4. HARDWARE INPUTS (PHYSICAL INGESTION)')}
            </span>
          </div>
          <div className="space-y-2.5">
            {topology?.hardware_inputs.map((group) => (
              <AlsaChannelStrip
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
              <div className="h-16 flex items-center justify-center border border-dashed border-[var(--glass-border)] rounded-lg text-xs text-text-secondary/50">
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

const AlsaChannelStrip: React.FC<ChannelStripProps> = ({
  group,
  onControlChange,
  isLinked,
  onToggleLink,
  canvasRefSetter,
  endpointIcon,
}) => {
  const volCtrl = group.controls.find((c) => c.ctrl_type === 'volume');
  const muteCtrl = group.controls.find((c) => c.ctrl_type === 'mute' || c.ctrl_type === 'switch');
  const routeCtrl = group.controls.find((c) => c.ctrl_type === 'route' || c.ctrl_type === 'enum');
  const meterCtrl = group.meters[0];

  const currentVol = volCtrl ? volCtrl.values[0] ?? 0 : 0;
  const isMuted = muteCtrl ? !muteCtrl.values[0] : false;

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!volCtrl) return;
    const newVal = parseInt(e.target.value, 10);
    const newVals = isLinked ? new Array(volCtrl.channels).fill(newVal) : [newVal, ...volCtrl.values.slice(1)];
    onControlChange(volCtrl.numid, newVals);
  };

  const handleMuteToggle = () => {
    if (!muteCtrl) return;
    const newMuteState = !muteCtrl.values[0];
    onControlChange(muteCtrl.numid, [newMuteState]);
  };

  const handleRouteSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!routeCtrl) return;
    const newIdx = parseInt(e.target.value, 10);
    onControlChange(routeCtrl.numid, [newIdx]);
  };

  return (
    <div className="h-16 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 flex items-center justify-between gap-3 hover:border-brand-lime/40 transition-all duration-200">
      
      {/* Group Name & Endpoint Icon */}
      <div className="flex items-center gap-2 min-w-[130px] max-w-[160px] truncate">
        <div className="p-1.5 rounded bg-[var(--glass-border)]/30 text-text-primary">
          {endpointIcon}
        </div>
        <span className="text-xs font-bold text-text-primary truncate" title={group.name}>
          {group.name}
        </span>
      </div>

      {/* Route / Mode Selector */}
      {routeCtrl && routeCtrl.items && (
        <select
          value={routeCtrl.values[0] ?? 0}
          onChange={handleRouteSelect}
          className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded px-2 py-1 text-[11px] text-text-primary focus:outline-none focus:border-brand-lime max-w-[110px]"
        >
          {routeCtrl.items.map((item, idx) => (
            <option key={idx} value={idx}>
              {item}
            </option>
          ))}
        </select>
      )}

      {/* Multi-channel Link Toggle */}
      {volCtrl && volCtrl.channels > 1 && (
        <button
          onClick={onToggleLink}
          title={isLinked ? 'Unlink channels' : 'Link channels'}
          className={`p-1 rounded text-xs transition-colors cursor-pointer ${
            isLinked ? 'bg-brand-lime/20 text-brand-lime' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          {isLinked ? '🔗' : '🔓'}
        </button>
      )}

      {/* Volume Slider & dB readout */}
      {volCtrl ? (
        <div className="flex-1 flex items-center gap-2">
          <input
            type="range"
            min={volCtrl.min ?? 0}
            max={volCtrl.max ?? 100}
            step={volCtrl.step ?? 1}
            value={currentVol}
            onChange={handleSliderChange}
            className="w-full h-1.5 bg-[var(--glass-border)]/50 rounded-lg appearance-none cursor-pointer accent-brand-lime"
          />
          <span className="text-[10px] font-mono font-bold text-text-secondary w-12 text-right">
            {volCtrl.db_min !== undefined ? `${currentVol} dB` : currentVol}
          </span>
        </div>
      ) : (
        <div className="flex-1 text-[11px] text-text-secondary/40 text-center">N/A</div>
      )}

      {/* Mute Button */}
      {muteCtrl && (
        <button
          onClick={handleMuteToggle}
          className={`px-2 py-1 rounded text-[11px] font-bold transition-all cursor-pointer ${
            isMuted ? 'bg-red-500/20 text-red-400 border border-red-500/40' : 'bg-[var(--glass-border)]/40 text-text-secondary hover:text-text-primary'
          }`}
        >
          {isMuted ? 'MUTED' : 'ON'}
        </button>
      )}

      {/* Canvas LED Vumeter (renders only if native meter node exists) */}
      {meterCtrl ? (
        <canvas
          ref={(el) => canvasRefSetter(meterCtrl.numid, el)}
          width={60}
          height={32}
          className="rounded bg-black/40 border border-[var(--glass-border)]/40"
        />
      ) : null}

    </div>
  );
};
