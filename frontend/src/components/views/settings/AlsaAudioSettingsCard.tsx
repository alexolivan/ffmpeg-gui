import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  db_step?: number;
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
  jack_sensors?: AlsaGroup[];
  iec958_controls?: AlsaGroup[];
  pcm_capabilities?: AlsaGroup[];
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

  // Direct software processes bind EXCLUSIVELY to Virtual PCM Streams (Left Column)!
  // Physical connectors (Right Column: hardware_outputs, hardware_inputs) receive audio via internal matrix mixing,
  // so software process PIDs should not be displayed on physical line connectors.
  if (group.category === 'hardware_outputs' || group.category === 'hardware_inputs') {
    return [];
  }

  const grpName = group.name.toLowerCase();
  const numMatch = group.name.match(/\d+/);
  const grpIndex = numMatch ? parseInt(numMatch[0], 10) : null;

  const isPlayoutQuadrant = group.category === 'virtual_playout';
  const isCaptureQuadrant = group.category === 'virtual_capture';

  return activeProcesses.filter((proc) => {
    // 1. Quadrant Direction Filtering
    if (isPlayoutQuadrant && proc.direction === 'capture') return false;
    if (isCaptureQuadrant && proc.direction === 'playout') return false;

    // 2. Direct Explicit Name Match (e.g., alias/cmd contains "PCM 0", "PCM 1", etc.)
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
    } else {
      // 4. Non-digitized group names (HDA Intel / Standard cards with "PCM", "Master", "Analog", "Front")
      // If proc.pcm_index is 0 or unassigned, it maps to standard primary playout groups ("pcm", "master", "analog", "playback", "front")
      const isStandardPrimaryGroup = /pcm|master|analog|playback|front/i.test(group.name);
      if (isStandardPrimaryGroup && (proc.pcm_index === 0 || proc.pcm_index === null || proc.pcm_index === undefined)) {
        return true;
      }
    }

    // 5. Default fallback for single process without explicit subdevice on PCM 0
    if (grpIndex === 0 && activeProcesses.length === 1) {
      if (cmd.includes("default") || target.includes("default") || (cmd.includes("-f alsa") && (proc.pcm_index === null || proc.pcm_index === undefined))) {
        return true;
      }
    }

    return false;
  });
};

interface GroupedOutputNode {
  id: string;
  masterGroup: AlsaGroup;
  slaveGroups: AlsaGroup[];
  hasMatrixControls: boolean;
}

const groupHardwareOutputs = (groups?: AlsaGroup[], cardDriver?: string): GroupedOutputNode[] => {
  if (!groups || groups.length === 0) return [];

  const isAudioScience = (cardDriver || '').toLowerCase().includes('asi') || groups.some(g => /^line\s+\d+$/i.test(g.name));

  if (isAudioScience) {
    const grouped: GroupedOutputNode[] = [];
    const processedIds = new Set<string>();

    const getChannelIndex = (name: string): number | null => {
      const m = name.match(/\d+/);
      return m ? parseInt(m[0], 10) : null;
    };

    groups.forEach((g) => {
      if (processedIds.has(g.id)) return;

      if (/^line\s+\d+$/i.test(g.name)) {
        processedIds.add(g.id);
        const chIdx = getChannelIndex(g.name);
        const slaves: AlsaGroup[] = [];

        groups.forEach((other) => {
          if (processedIds.has(other.id) || other.id === g.id) return;
          const otherIdx = getChannelIndex(other.name);

          if (chIdx !== null && otherIdx !== null && chIdx === otherIdx) {
            slaves.push(other);
            processedIds.add(other.id);
          }
        });

        const candidateControls: AlsaControl[] = [...(g.controls || [])];
        slaves.forEach(s => {
          (s.controls || []).forEach(c => {
            if (c.matrix_source || c.name.toLowerCase().includes(g.name.toLowerCase())) {
              candidateControls.push(c);
            }
          });
        });

        const matrixControls = candidateControls.filter((c) => {
          if (!c) return false;
          const nameLower = c.name.toLowerCase();
          const grpLower = g.name.toLowerCase();

          const isEnumOrRoute =
            c.ctrl_type === 'enum' ||
            c.ctrl_type === 'route' ||
            (c.items && c.items.length > 0);

          if (isEnumOrRoute) return false;

          const isMasterControl =
            nameLower === `${grpLower} playback level` ||
            nameLower === `${grpLower} playback volume` ||
            nameLower === `${grpLower} playback switch` ||
            nameLower === `${grpLower} volume` ||
            nameLower === `${grpLower} switch`;

          return !isMasterControl;
        });

        grouped.push({
          id: g.id,
          masterGroup: {
            ...g,
            matrixControls
          } as any,
          slaveGroups: slaves,
          hasMatrixControls: matrixControls.length > 0 || (g.controls || []).some(c => c.matrix_source || c.ctrl_type === 'enum' || c.ctrl_type === 'route')
        });
      }
    });

    groups.forEach((g) => {
      if (!processedIds.has(g.id)) {
        processedIds.add(g.id);
        const matrixControls = (g.controls || []).filter((c) => {
          if (!c) return false;
          const nameLower = c.name.toLowerCase();
          const grpLower = g.name.toLowerCase();
          const isEnumOrRoute = c.ctrl_type === 'enum' || c.ctrl_type === 'route' || (c.items && c.items.length > 0);
          if (isEnumOrRoute) return false;
          const isMasterControl =
            nameLower === `${grpLower} playback level` ||
            nameLower === `${grpLower} playback volume` ||
            nameLower === `${grpLower} playback switch` ||
            nameLower === `${grpLower} volume` ||
            nameLower === `${grpLower} switch`;
          return !isMasterControl;
        });

        grouped.push({
          id: g.id,
          masterGroup: {
            ...g,
            matrixControls
          } as any,
          slaveGroups: [],
          hasMatrixControls: matrixControls.length > 0 || (g.controls || []).some(c => c.matrix_source || c.ctrl_type === 'enum' || c.ctrl_type === 'route')
        });
      }
    });

    return grouped;
  }

  // Helper to determine if a control is a direct physical output endpoint level (should stay on channel strip, not in matrix modal)
  const isDirectOutputControl = (ctrl: AlsaControl, groupName: string): boolean => {
    if (!ctrl) return false;
    const nameLower = ctrl.name.toLowerCase().trim();
    const grpLower = groupName.toLowerCase().trim();

    if (ctrl.ctrl_type === 'enum' || ctrl.ctrl_type === 'route' || (ctrl.items && ctrl.items.length > 0)) {
      return true;
    }

    if (
      nameLower.includes('mic') ||
      nameLower.includes('line in') ||
      nameLower.includes('input') ||
      nameLower.includes('pcm') ||
      nameLower.includes('cd') ||
      nameLower.includes('aux')
    ) {
      return false;
    }

    const physicalNames = [
      'master',
      'line out',
      'headphone',
      'headphones',
      'speaker',
      'speakers',
      'front',
      'surround',
      'center',
      'lfe',
      'clfe',
      'side',
      grpLower
    ];

    return physicalNames.some(pName =>
      nameLower === `${pName} playback volume` ||
      nameLower === `${pName} playback switch` ||
      nameLower === `${pName} playback level` ||
      nameLower === `${pName} volume` ||
      nameLower === `${pName} switch` ||
      nameLower === `${pName} master volume` ||
      nameLower === `${pName} master switch`
    );
  };

  // Unified Single Master Mixer Node for Intel HDA / Realtek / Consumer Soundcards
  const isPhysicalOutputEndpoint = (g: AlsaGroup) => {
    const n = g.name.toLowerCase().trim();

    // Exclude input monitors (Mic, Line In / Line Playback / Rear Mic / Front Mic), master, capture, and general
    if (
      n.includes('mic') ||
      n.includes('input') ||
      n === 'master' ||
      n === 'general' ||
      n.startsWith('line playback') ||
      n === 'line' ||
      n.includes('capture')
    ) {
      return false;
    }

    // Match physical hardware output jacks
    return (
      n.includes('line out') ||
      n === 'front' ||
      n === 'front playback' ||
      n.startsWith('surround') ||
      n.startsWith('center') ||
      n.startsWith('lfe') ||
      n.startsWith('clfe') ||
      n.startsWith('side') ||
      n.includes('headphone') ||
      n.includes('speaker') ||
      n.includes('spdif') ||
      n.includes('iec958')
    );
  };

  const physicalEndpoints = groups.filter(isPhysicalOutputEndpoint);
  const validEndpoints = physicalEndpoints.length > 0 ? physicalEndpoints : groups;

  // Root Master Endpoint: 'Line Out' for 2.0 cards, 'Front' / 'Front Playback' for 4.0/5.1 cards
  const rawMasterEndpoint =
    validEndpoints.find(g => g.name.toLowerCase().trim().includes('line out')) ||
    validEndpoints.find(g => g.name.toLowerCase().trim().startsWith('front')) ||
    validEndpoints[0];

  // If ALSA reports 'Line Out' with no direct controls on 2.0 cards, merge 'Front' controls (Front Playback Volume) into Line Out
  const frontGroup = groups.find(g => g.name.toLowerCase().trim().startsWith('front'));

  let masterControls = rawMasterEndpoint.controls || [];
  if (rawMasterEndpoint.name.toLowerCase().trim().includes('line out') && frontGroup && frontGroup.id !== rawMasterEndpoint.id) {
    const hasLineOutDirect = masterControls.some(c => c && !c.name.toLowerCase().includes('mic'));
    if (!hasLineOutDirect && frontGroup.controls) {
      masterControls = [...masterControls, ...frontGroup.controls];
    }
  }

  const masterEndpoint = {
    ...rawMasterEndpoint,
    controls: masterControls
  };

  // Slave endpoints: Exclude masterEndpoint AND exclude 'Front' group if it was merged into Line Out on 2.0 cards
  const slaveEndpoints = validEndpoints.filter(g => {
    const gName = g.name.toLowerCase().trim();
    if (g.id === masterEndpoint.id) return false;
    if (gName.startsWith('front') && masterEndpoint.name.toLowerCase().trim().includes('line out')) return false;
    return true;
  });

  // Matrix controls for Intel HDA modal (Master, PCM, Front Mic, Rear Mic, Line In, CD, Aux monitor gains)
  // Direct physical output endpoint levels (Front Playback Volume, Surround Playback Volume, Center, LFE, Speaker, Headphone) stay on their channel strips
  const allCardMatrixControls: AlsaControl[] = [];
  const controlNumids = new Set<number>();

  groups.forEach(g => {
    (g.controls || []).forEach(ctrl => {
      if (!controlNumids.has(ctrl.numid)) {
        const cName = ctrl.name.toLowerCase().trim();
        const isMasterCtrl = cName.includes('master');

        // Check if control is a direct physical output level of ANY endpoint (Front, Surround, Center, LFE, Speaker, Headphone)
        const isEndpointOutputLevel = validEndpoints.some(ep => isDirectOutputControl(ctrl, ep.name));

        if (isMasterCtrl || !isEndpointOutputLevel) {
          controlNumids.add(ctrl.numid);
          allCardMatrixControls.push(ctrl);
        }
      }
    });
  });

  return [{
    id: masterEndpoint.id,
    masterGroup: {
      ...masterEndpoint,
      matrixControls: allCardMatrixControls
    } as any,
    slaveGroups: slaveEndpoints,
    hasMatrixControls: allCardMatrixControls.length > 0
  }];
};

const formatControlValue = (ctrl?: AlsaControl, rawVal?: any): string => {
  if (!ctrl || rawVal === undefined || rawVal === null) return 'N/A';

  const numVal = Number(rawVal);
  if (isNaN(numVal)) return `${rawVal}`;

  const min = ctrl.min ?? 0;
  const max = ctrl.max ?? 100;

  if (ctrl.db_min !== undefined && ctrl.db_step !== undefined && ctrl.db_step > 0) {
    const isHundredths = Math.abs(ctrl.db_step) >= 50 || Math.abs(ctrl.db_min) >= 500;
    const scale = isHundredths ? 100 : 1;
    const dbVal = (ctrl.db_min / scale) + (numVal - min) * (ctrl.db_step / scale);
    if (dbVal <= (ctrl.db_min / scale) && ctrl.db_min <= -50) {
      return '-∞ dB';
    }
    return `${dbVal > 0 ? '+' : ''}${dbVal.toFixed(0)} dB`;
  }

  const isHundredths = Math.abs(min) >= 500 || Math.abs(max) >= 500 || (ctrl.db_min !== undefined && Math.abs(ctrl.db_min) > 200);

  if (isHundredths || ctrl.db_min !== undefined) {
    const scale = isHundredths ? 100 : 1;
    const dbVal = numVal / scale;
    if (dbVal <= (min / scale) && (min <= -5000 || (ctrl.db_min !== undefined && ctrl.db_min <= -50))) {
      return '-∞ dB';
    }
    return `${dbVal > 0 ? '+' : ''}${dbVal.toFixed(0)} dB`;
  }

  if (max > min) {
    const pct = Math.round(((numVal - min) / (max - min)) * 100);
    return `${pct}%`;
  }

  return `${numVal}`;
};

const AlsaMatrixRoutingModal: React.FC<{
  group: AlsaGroup;
  onClose: () => void;
  onControlChange: (numid: number, values: any[]) => void;
}> = React.memo(({ group, onClose, onControlChange }) => {
  const { t } = useTranslation();
  const [modalLinked, setModalLinked] = useState<Record<number, boolean>>({});
  const controlsToRender: AlsaControl[] = (group as any).matrixControls || group.controls || [];

  // Build matrixSourcesMap with useMemo for smooth 60fps UI responsiveness and clean AudioScience labels
  const { matrixSourcesMap, standaloneControls } = useMemo(() => {
    const map: Record<string, { vol?: AlsaControl; mute?: AlsaControl }> = {};
    const standalone: AlsaControl[] = [];

    controlsToRender.forEach((c) => {
      if (!c) return;

      const isVol = c.ctrl_type === 'volume' || c.ctrl_type === 'integer' || c.name.toLowerCase().includes('volume') || c.name.toLowerCase().includes('level');
      const isMute = c.ctrl_type === 'mute' || c.ctrl_type === 'switch' || c.name.toLowerCase().includes('switch') || c.name.toLowerCase().includes('mute');

      if (!isVol && !isMute) {
        standalone.push(c);
        return;
      }

      let src = c.matrix_source;
      if (!src) {
        const grpPattern = new RegExp(`\\b${group.name}\\b`, 'gi');
        let cleaned = c.name
          .replace(grpPattern, '')
          .replace(/Playback/gi, '')
          .replace(/Volume/gi, '')
          .replace(/Switch/gi, '')
          .replace(/Mute/gi, '')
          .replace(/Gain/gi, '')
          .replace(/Control/gi, '')
          .replace(/\s+/g, ' ')
          .trim();

        const isMon = c.name.toLowerCase().includes('monitor') || (c.name.toLowerCase().includes('playback') && !cleaned.toLowerCase().startsWith('pcm'));

        if (cleaned) {
          src = isMon && !cleaned.toLowerCase().includes('mon') ? `${cleaned} (Mon)` : cleaned;
        } else {
          src = isMon ? `${group.name} (Mon)` : group.name;
        }
      }

      if (!map[src]) map[src] = {};

      if (isVol) {
        map[src].vol = c;
      } else if (isMute) {
        map[src].mute = c;
      }
    });

    return { matrixSourcesMap: map, standaloneControls: standalone };
  }, [controlsToRender, group.name]);

  const matrixEntries = useMemo(() => Object.entries(matrixSourcesMap), [matrixSourcesMap]);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-5 shadow-2xl max-w-[90vw] max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2.5 mb-4 min-w-[280px]">
          <span className="text-xs font-bold text-text-primary uppercase tracking-wider flex items-center gap-2">
            <span className="text-base">🎛️</span>
            <span>{group.name} Sub-Mixer Console</span>
          </span>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary text-xs font-bold px-2 py-1 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg hover:border-brand-lime transition-all cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="overflow-y-auto space-y-4 custom-scrollbar pr-1">
          {/* Top Rack: Standalone Selectors & Switches */}
          {standaloneControls.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--text-secondary)]">
                🎚️ {t('settings.alsa.routingRack', 'MATRIX ROUTING & SWITCH RACK')}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {standaloneControls.map((ctrl: AlsaControl) => {
                  const isEnum = ctrl.ctrl_type === 'enum' || ctrl.ctrl_type === 'route' || (ctrl.items && ctrl.items.length > 0);
                  const currentVal = ctrl.values?.[0] ?? 0;

                  return (
                    <div key={ctrl.numid} className="bg-[var(--input-bg)]/60 border border-[var(--glass-border)] rounded-xl p-3 flex flex-col justify-between gap-2 shadow-sm">
                      <div className="flex items-center justify-between text-[11px] font-bold text-[var(--text-primary)]">
                        <span className="truncate">{ctrl.name}</span>
                        {ctrl.matrix_source && (
                          <span className="text-[9px] bg-brand-orange/15 text-brand-orange border border-brand-orange/30 px-1.5 py-0.5 rounded font-mono font-bold shrink-0 ml-1">
                            {ctrl.matrix_source}
                          </span>
                        )}
                      </div>

                      {isEnum && ctrl.items ? (
                        <select
                          value={currentVal}
                          onChange={(e) => onControlChange(ctrl.numid, [parseInt(e.target.value, 10)])}
                          className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] text-[var(--text-primary)] text-xs font-bold rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-brand-lime cursor-pointer"
                        >
                          {ctrl.items.map((item: string, idx: number) => (
                            <option key={idx} value={idx}>
                              {item}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <button
                          onClick={() => onControlChange(ctrl.numid, [currentVal === 1 || currentVal === true ? 0 : 1])}
                          className={`w-full py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                            currentVal === 1 || currentVal === true
                              ? 'bg-brand-lime/20 text-brand-lime border border-brand-lime/40'
                              : 'bg-red-500/20 text-red-400 border border-red-500/40'
                          }`}
                        >
                          {currentVal === 1 || currentVal === true ? 'ON / ACTIVE' : 'OFF / MUTED'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Fader Console: Vertical Channel Strips with L/R Stereo Faders, Link Buttons, and Foot Mutes */}
          {matrixEntries.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--text-secondary)] flex items-center justify-between">
                <span>🎛️ {t('settings.alsa.faderConsole', 'SUB-MIXER CHANNEL CONSOLE')}</span>
                <span className="text-[9px] opacity-75">({matrixEntries.length} CHANNELS)</span>
              </div>
              
              <div className="flex items-end justify-start gap-4 overflow-x-auto py-1 custom-scrollbar max-w-full">
                {matrixEntries.map(([srcName, ctrlPair]: [string, { vol?: AlsaControl; mute?: AlsaControl }]) => {
                  const volCtrl = ctrlPair.vol;
                  const muteCtrl = ctrlPair.mute;

                  const numChannels = volCtrl?.channels ?? (volCtrl?.values && volCtrl.values.length > 1 ? volCtrl.values.length : 1);
                  const isStereo = numChannels > 1;
                  const volValL = volCtrl?.values?.[0] ?? 0;
                  const volValR = isStereo ? (volCtrl?.values?.[1] ?? volValL) : volValL;
                  const isMuted = muteCtrl ? (muteCtrl.values?.[0] === 0 || muteCtrl.values?.[0] === false) : false;

                  const isLinked = volCtrl ? (modalLinked[volCtrl.numid] !== false) : true;
                  const toggleChannelLink = (numid: number) => {
                    setModalLinked(prev => ({ ...prev, [numid]: !isLinked }));
                  };

                  return (
                    <div
                      key={srcName}
                      className="flex flex-col items-center gap-1.5 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 min-w-[95px] shrink-0"
                    >
                      {/* Source Label */}
                      <div
                        className="h-8 flex items-center justify-center text-[10px] font-bold text-brand-lime font-mono leading-tight text-center whitespace-normal break-words w-full px-1 select-none"
                        title={srcName}
                      >
                        {srcName}
                      </div>

                      {/* Clean Formatted dB / Readout Badge */}
                      <div className="text-[10px] font-mono font-bold text-text-primary">
                        {formatControlValue(volCtrl, volValL)}
                        {isStereo && !isLinked && (
                          <span className="text-text-secondary text-[9px] ml-0.5">/{formatControlValue(volCtrl, volValR)}</span>
                        )}
                      </div>

                      {/* Vertical Stereo Fader Pair */}
                      {volCtrl ? (
                        <div className="flex flex-col items-center justify-center py-1 gap-1">
                          {isStereo ? (
                            <AlsaStereoFaderPair
                              min={volCtrl.min ?? 0}
                              max={volCtrl.max ?? 100}
                              step={volCtrl.step ?? 1}
                              volValL={volValL}
                              volValR={volValR}
                              isLinked={isLinked}
                              heightClass="h-24"
                              onChangeCommit={(vals) => {
                                onControlChange(volCtrl.numid, vals);
                              }}
                            />
                          ) : (
                            <AlsaFaderUnit
                              min={volCtrl.min ?? 0}
                              max={volCtrl.max ?? 100}
                              step={volCtrl.step ?? 1}
                              value={volValL}
                              heightClass="h-24"
                              onChangeCommit={(v) => {
                                onControlChange(volCtrl.numid, [v]);
                              }}
                            />
                          )}

                          {/* Stereo Link Button Slot - Reserved h-6 height for 100% uniform console alignment */}
                          <div className="h-6 flex items-center justify-center mt-0.5">
                            {isStereo ? (
                              <button
                                onClick={() => toggleChannelLink(volCtrl.numid)}
                                title={isLinked ? 'Unlink L/R Channels' : 'Link L/R Channels'}
                                className="text-xs hover:scale-110 transition-transform cursor-pointer px-1 py-0.5"
                              >
                                {isLinked ? '🔗' : '🔓'}
                              </button>
                            ) : (
                              <div className="h-4 w-4 opacity-0 pointer-events-none" />
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="h-28 flex items-center justify-center text-[10px] text-text-secondary/40">N/A</div>
                      )}

                      {/* Mute Toggle Button directly below Fader */}
                      {muteCtrl ? (
                        <button
                          onClick={() => onControlChange(muteCtrl.numid, [isMuted ? 1 : 0])}
                          className={`w-full py-1 rounded text-[10px] font-bold transition-all cursor-pointer border ${
                            !isMuted
                              ? 'bg-brand-lime/20 text-brand-lime border-brand-lime/40 hover:bg-brand-lime/30'
                              : 'bg-red-500/20 text-red-400 border-red-500/40 hover:bg-red-500/30'
                          }`}
                        >
                          {!isMuted ? 'ON' : 'MUTED'}
                        </button>
                      ) : (
                        <div className="h-6" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {matrixEntries.length === 0 && standaloneControls.length === 0 && (
            <div className="text-center py-12 text-xs text-[var(--text-secondary)]">
              {t('settings.alsa.noMatrixControls', 'No matrix routing controls available for this node')}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
});

export const AlsaAudioSettingsCard: React.FC = () => {
  const { t } = useTranslation();
  const [cards, setCards] = useState<AlsaCard[]>([]);
  const [selectedCardIdx, setSelectedCardIdx] = useState<number>(0);
  const [topology, setTopology] = useState<AlsaTopology | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [linkedChannels, setLinkedChannels] = useState<Record<number, boolean>>({});
  const [selectedMatrixGroup, setSelectedMatrixGroup] = useState<AlsaGroup | null>(null);

  const selectedDriver = useMemo(() => {
    return cards.find(c => c.card_index === selectedCardIdx)?.driver;
  }, [cards, selectedCardIdx]);

  const groupedHardwareNodes = useMemo(() => {
    return groupHardwareOutputs(topology?.hardware_outputs, selectedDriver);
  }, [topology?.hardware_outputs, selectedDriver]);

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

  const updateJackSensorsRealtime = (jacksMap: Record<number, boolean>) => {
    setTopology((prev) => {
      if (!prev || !prev.jack_sensors) return prev;
      let changed = false;
      const newSensors = prev.jack_sensors.map((group) => {
        const newControls = (group.controls || []).map((ctrl) => {
          if (ctrl.numid in jacksMap && ctrl.values?.[0] !== jacksMap[ctrl.numid]) {
            changed = true;
            return { ...ctrl, values: [jacksMap[ctrl.numid]] };
          }
          return ctrl;
        });
        return { ...group, controls: newControls };
      });
      return changed ? { ...prev, jack_sensors: newSensors } : prev;
    });
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
        if (payload) {
          if (payload.meters) {
            renderCanvasMeters(payload.meters);
          }
          if (payload.jacks) {
            updateJackSensorsRealtime(payload.jacks);
          }
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

  const handleControlChange = useCallback(async (numid: number, values: any[]) => {
    // Update local state optimistically
    setTopology((prevTopology) => {
      if (!prevTopology) return prevTopology;
      const updateValuesInGroups = (groups: AlsaGroup[]) =>
        groups.map((g) => ({
          ...g,
          controls: g.controls.map((c) => (c.numid === numid ? { ...c, values } : c)),
        }));

      return {
        ...prevTopology,
        virtual_playout: updateValuesInGroups(prevTopology.virtual_playout),
        hardware_outputs: updateValuesInGroups(prevTopology.hardware_outputs),
        virtual_capture: updateValuesInGroups(prevTopology.virtual_capture),
        hardware_inputs: updateValuesInGroups(prevTopology.hardware_inputs),
      };
    });

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
  }, [selectedCardIdx]);

  const toggleChannelLink = (numid: number) => {
    setLinkedChannels((prev) => ({ ...prev, [numid]: !prev[numid] }));
  };

  const getEndpointIcon = (category: string, groupName: string) => {
    const nameLower = groupName ? groupName.toLowerCase() : '';

    if (category === 'virtual_playout') return <span className="text-brand-lime font-bold">▶</span>;
    if (category === 'virtual_capture') return <span className="text-red-400 font-bold">🎙️</span>;

    if (category === 'hardware_inputs' || nameLower.includes('input') || nameLower.includes('in') || nameLower.includes('mic')) {
      if (nameLower.includes('spdif') || nameLower.includes('digital') || nameLower.includes('aes')) {
        return <span className="text-emerald-400 font-bold">⚡</span>;
      }
      return <span className="text-amber-400 font-bold">🎙️</span>;
    }

    if (nameLower.includes('speaker') || nameLower.includes('line out') || nameLower.includes('front') || nameLower.includes('rear') || nameLower.includes('surround') || nameLower.includes('clfe')) {
      return <span className="text-sky-400 font-bold">🔊</span>;
    }
    if (nameLower.includes('headphone')) return <span className="text-indigo-400 font-bold">🎧</span>;
    if (nameLower.includes('spdif') || nameLower.includes('digital') || nameLower.includes('aes')) return <span className="text-emerald-400 font-bold">⚡</span>;

    if (category === 'hardware_outputs') return <span className="text-sky-400 font-bold">🔊</span>;

    return <span className="text-amber-400 font-bold">🎙️</span>;
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
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-[var(--glass-border)] pb-3 min-w-0">
        <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider shrink-0">
          {t('settings.alsa.title', 'ALSA MIXER')}
        </h3>

        {/* Sound Card Dropdown Selector */}
        <div className="flex items-center gap-2 max-w-full min-w-0">
          <label className="text-xs font-bold text-text-secondary uppercase tracking-wider whitespace-nowrap shrink-0">
            {t('settings.alsa.selectCard', 'Sound Card:')}
          </label>
          <select
            value={selectedCardIdx}
            onChange={(e) => setSelectedCardIdx(parseInt(e.target.value, 10))}
            className="bg-[var(--input-bg)] text-text-primary border border-[var(--glass-border)] rounded-lg px-3 py-1.5 text-xs font-bold focus:outline-none focus:border-brand-lime shadow-sm min-w-0 truncate max-w-xs sm:max-w-md"
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
        <div className="bg-brand-lime/10 border border-brand-lime/30 rounded-lg px-3 py-1.5 flex items-center gap-2 text-xs text-brand-lime shadow-sm">
          <span className="font-bold text-[11px] uppercase tracking-wider whitespace-nowrap">🏷️ {t('settings.alsa.activeProcesses', 'Active Bindings:')}</span>
          <div className="flex flex-wrap items-center gap-1.5 ml-1">
            {topology.active_processes.map((proc) => (
              <span key={proc.process_id} className="bg-brand-lime/20 border border-brand-lime/40 px-2 py-0.5 rounded text-[10px] font-mono font-bold text-text-primary">
                {proc.alias}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Hardware Connection Presence (Jack Sensing) Status Banner */}
      {topology?.jack_sensors && topology.jack_sensors.length > 0 && (
        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg px-3 py-2 space-y-1.5 shadow-sm">
          <div className="flex items-center justify-between text-[11px] font-bold text-text-secondary">
            <span className="flex items-center gap-1.5">
              <span>🔌</span>
              <span className="uppercase tracking-wider">{t('settings.alsa.jackSensing', 'Jack Sensing Status:')}</span>
            </span>
            <span className="text-[10px] font-mono font-normal opacity-70">
              {topology.jack_sensors.filter(s => s.controls?.[0]?.values?.[0] === true || s.controls?.[0]?.values?.[0] === 1).length} / {topology.jack_sensors.length} Active
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-1.5">
            {topology.jack_sensors.map((sensorGroup) => {
              const ctrl = sensorGroup.controls?.[0];
              const isConnected = ctrl?.values?.[0] === true || ctrl?.values?.[0] === 1;
              return (
                <div
                  key={sensorGroup.id}
                  title={sensorGroup.name}
                  className={`px-2 py-1 rounded text-[10px] font-mono flex items-center justify-between gap-1 border transition-all truncate ${
                    isConnected
                      ? 'bg-brand-lime/10 border-brand-lime/30 text-brand-lime font-bold'
                      : 'bg-[var(--input-bg)]/60 border-[var(--glass-border)]/60 text-text-secondary/50'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0 truncate">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isConnected ? 'bg-brand-lime animate-pulse' : 'bg-text-secondary/40'}`} />
                    <span className="truncate">{sensorGroup.name.replace(/\s+Jack$/i, '')}</span>
                  </div>
                  <span className="text-[9px] uppercase font-mono opacity-80 shrink-0">
                    {isConnected ? 'ON' : 'OFF'}
                  </span>
                </div>
              );
            })}
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
                isLinked={linkedChannels[group.controls?.[0]?.numid] !== false}
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
        <div className="lg:col-span-5 space-y-3">
          <div className="space-y-3">
            {groupedHardwareNodes.map((node) => (
              <div 
                key={node.id} 
                className="bg-[var(--input-bg)]/40 border border-[var(--glass-border)] rounded-xl p-3 space-y-2.5 shadow-sm hover:border-brand-orange/30 transition-all"
              >
                {/* Shared Master Mixer Node Header Bar */}
                <div className="flex items-center justify-between border-b border-[var(--glass-border)]/50 pb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-brand-orange font-bold text-xs shrink-0">🎛️</span>
                    <span className="text-[11px] font-mono font-bold text-[var(--text-primary)] uppercase tracking-wider truncate">
                      {node.masterGroup.name} {t('settings.alsa.masterMixerNode', 'MIXER NODE')}
                    </span>
                  </div>
                  <button
                    onClick={() => setSelectedMatrixGroup(node.masterGroup)}
                    className="px-2.5 py-1 bg-brand-orange/15 hover:bg-brand-orange/25 border border-brand-orange/30 rounded-lg text-[10px] font-bold text-brand-orange transition-all flex items-center gap-1 shrink-0"
                    title={t('settings.alsa.matrixRouting', 'Matrix & Routing')}
                  >
                    <span>⚙️</span> {t('settings.alsa.matrixRouting', 'Matrix & Routing')}
                  </button>
                </div>

                {/* Parallel Branch Tree */}
                <div className="space-y-2 relative">
                  {/* Master Endpoint Strip */}
                  <div className="relative pl-3">
                    {node.slaveGroups.length > 0 && (
                      <div className="absolute left-0 top-0 h-full w-0.5 bg-brand-orange/40 pointer-events-none" />
                    )}
                    <AlsaSkewerChannelStrip
                      group={node.masterGroup}
                      activeProcesses={getGroupProcesses(node.masterGroup, topology?.active_processes)}
                      onControlChange={handleControlChange}
                      isLinked={linkedChannels[node.masterGroup.controls?.[0]?.numid] !== false}
                      onToggleLink={() => node.masterGroup.controls?.[0] && toggleChannelLink(node.masterGroup.controls[0].numid)}
                      canvasRefSetter={(numid, el) => (canvasRefs.current[numid] = el)}
                      endpointIcon={getEndpointIcon(node.masterGroup.category, node.masterGroup.name)}
                      hideInlineMixerButton={true}
                    />
                  </div>

                  {/* Slave Endpoints */}
                  {node.slaveGroups.map((slave, slaveIdx) => {
                    const isLastSlave = slaveIdx === node.slaveGroups.length - 1;
                    return (
                      <div key={slave.id} className="relative pl-3">
                        {isLastSlave ? (
                          /* Final Slave: L-corner curve bridging the gap from above and turning smoothly into the strip */
                          <div className="absolute left-0 -top-2 h-[calc(50%+0.5rem)] w-3 border-l-2 border-b-2 border-brand-orange/40 rounded-bl-md pointer-events-none" />
                        ) : (
                          /* Middle Slaves: Continuous vertical line bridging top/bottom gaps + horizontal T-branch */
                          <>
                            <div className="absolute left-0 -top-2 h-[calc(100%+0.5rem)] w-0.5 bg-brand-orange/40 pointer-events-none" />
                            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-3 h-0.5 bg-brand-orange/40 pointer-events-none" />
                          </>
                        )}
                        <AlsaSkewerChannelStrip
                          group={slave}
                          activeProcesses={getGroupProcesses(slave, topology?.active_processes)}
                          onControlChange={handleControlChange}
                          isLinked={linkedChannels[slave.controls?.[0]?.numid] !== false}
                          onToggleLink={() => slave.controls?.[0] && toggleChannelLink(slave.controls[0].numid)}
                          canvasRefSetter={(numid, el) => (canvasRefs.current[numid] = el)}
                          endpointIcon={getEndpointIcon(slave.category, slave.name)}
                          hideInlineMixerButton={true}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
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
                isLinked={linkedChannels[group.controls?.[0]?.numid] !== false}
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
                isLinked={linkedChannels[group.controls?.[0]?.numid] !== false}
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

      {/* MATRIX ROUTING MODAL */}
      {selectedMatrixGroup && (
        <AlsaMatrixRoutingModal
          group={selectedMatrixGroup}
          onClose={() => setSelectedMatrixGroup(null)}
          onControlChange={handleControlChange}
        />
      )}

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
                            {ctrl.items.map((item: string, idx: number) => {
                              let displayLabel = item;
                              const cName = (ctrl.name || '').toLowerCase();
                              if (cName.includes('auto-mute') || cName.includes('automute')) {
                                if (item.toLowerCase() === 'enabled') displayLabel = 'Enabled (Auto-Mute Rear Speakers on Headphone Insert)';
                                else if (item.toLowerCase() === 'disabled') displayLabel = 'Disabled (Simultaneous Headphone & Rear Output)';
                                else if (item.toLowerCase().includes('line out')) displayLabel = 'Line Out Only (Mute Rear Line Out Only)';
                                else if (item.toLowerCase().includes('speaker')) displayLabel = 'All Speaker Out (Mute All Rear Speakers)';
                              }
                              return (
                                <option key={idx} value={idx}>
                                  {displayLabel}
                                </option>
                              );
                            })}
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



interface ChannelStripProps {
  group: AlsaGroup;
  activeProcesses?: ActiveProcessBadge[];
  onControlChange: (numid: number, values: any[]) => void;
  isLinked: boolean;
  onToggleLink: () => void;
  canvasRefSetter: (numid: number, el: HTMLCanvasElement | null) => void;
  endpointIcon: React.ReactNode;
  hideInlineMixerButton?: boolean;
}

interface AlsaFaderUnitProps {
  min: number;
  max: number;
  step: number;
  value: number;
  onChangeCommit: (val: number) => void;
  label?: string;
  heightClass?: string;
}

const AlsaFaderUnit: React.FC<AlsaFaderUnitProps> = React.memo(({
  min,
  max,
  step,
  value,
  onChangeCommit,
  label,
  heightClass = "h-20"
}) => {
  const isHundredths = Math.abs(min) >= 500 || Math.abs(max) >= 500;
  const scale = isHundredths ? 100 : 1;

  const minDisplay = Math.round(min / scale);
  const maxDisplay = Math.round(max / scale);
  const stepDisplay = isHundredths ? 1 : Math.max(1, step);
  const initialDisplay = Math.round(value / scale);

  const [val, setVal] = useState<number>(initialDisplay);
  const [strVal, setStrVal] = useState<string>(String(initialDisplay));
  const isDraggingRef = useRef<boolean>(false);

  useEffect(() => {
    if (!isDraggingRef.current) {
      const disp = Math.round(value / scale);
      setVal(disp);
      setStrVal(String(disp));
    }
  }, [value, scale]);

  const commit = (targetDisplayVal: number) => {
    isDraggingRef.current = false;
    const clampedDisp = Math.min(maxDisplay, Math.max(minDisplay, isNaN(targetDisplayVal) ? minDisplay : targetDisplayVal));
    setVal(clampedDisp);
    setStrVal(String(clampedDisp));
    onChangeCommit(clampedDisp * scale);
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[9px] font-mono font-bold text-text-secondary select-none">
        {label || <span className="opacity-0">M</span>}
      </span>
      <input
        type="range"
        min={minDisplay}
        max={maxDisplay}
        step={stepDisplay}
        value={val}
        onPointerDown={() => { isDraggingRef.current = true; }}
        onMouseDown={() => { isDraggingRef.current = true; }}
        onTouchStart={() => { isDraggingRef.current = true; }}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          setVal(v);
          setStrVal(String(v));
        }}
        onPointerUp={() => commit(val)}
        onMouseUp={() => commit(val)}
        onTouchEnd={() => commit(val)}
        className={`w-2 ${heightClass} appearance-none bg-[var(--glass-border)] rounded cursor-pointer accent-brand-lime`}
        style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
      />
      <input
        type="number"
        min={minDisplay}
        max={maxDisplay}
        step={stepDisplay}
        value={strVal}
        onChange={(e) => setStrVal(e.target.value)}
        onBlur={() => commit(parseInt(strVal, 10))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(parseInt(strVal, 10));
        }}
        className="w-11 text-center bg-[var(--bg-card)] border border-[var(--glass-border)] rounded text-[9px] font-mono font-bold text-text-primary focus:outline-none focus:border-brand-lime py-0.5 px-0.5 mt-0.5"
      />
    </div>
  );
});

interface AlsaStereoFaderPairProps {
  min: number;
  max: number;
  step: number;
  volValL: number;
  volValR: number;
  isLinked: boolean;
  onChangeCommit: (vals: number[]) => void;
  heightClass?: string;
}

const AlsaStereoFaderPair: React.FC<AlsaStereoFaderPairProps> = React.memo(({
  min,
  max,
  step,
  volValL,
  volValR,
  isLinked,
  onChangeCommit,
  heightClass = "h-20"
}) => {
  const isHundredths = Math.abs(min) >= 500 || Math.abs(max) >= 500;
  const scale = isHundredths ? 100 : 1;

  const minDisplay = Math.round(min / scale);
  const maxDisplay = Math.round(max / scale);
  const stepDisplay = isHundredths ? 1 : Math.max(1, step);

  const initL = Math.round(volValL / scale);
  const initR = Math.round(volValR / scale);

  const [valL, setValL] = useState<number>(initL);
  const [valR, setValR] = useState<number>(initR);
  const [strL, setStrL] = useState<string>(String(initL));
  const [strR, setStrR] = useState<string>(String(initR));
  const isDraggingRef = useRef<boolean>(false);

  useEffect(() => {
    if (!isDraggingRef.current) {
      const dL = Math.round(volValL / scale);
      const dR = Math.round(volValR / scale);
      setValL(dL);
      setValR(dR);
      setStrL(String(dL));
      setStrR(String(dR));
    }
  }, [volValL, volValR, scale]);

  const commit = (dispL: number, dispR: number) => {
    isDraggingRef.current = false;
    const clampedL = Math.min(maxDisplay, Math.max(minDisplay, isNaN(dispL) ? minDisplay : dispL));
    const clampedR = Math.min(maxDisplay, Math.max(minDisplay, isNaN(dispR) ? minDisplay : dispR));
    setValL(clampedL);
    setValR(clampedR);
    setStrL(String(clampedL));
    setStrR(String(clampedR));

    const rawL = clampedL * scale;
    const rawR = clampedR * scale;
    onChangeCommit(isLinked ? [rawL, rawL] : [rawL, rawR]);
  };

  const handleDragL = (v: number) => {
    setValL(v);
    setStrL(String(v));
    if (isLinked) {
      setValR(v);
      setStrR(String(v));
    }
  };

  const handleDragR = (v: number) => {
    setValR(v);
    setStrR(String(v));
    if (isLinked) {
      setValL(v);
      setStrL(String(v));
    }
  };

  return (
    <div className="flex items-center gap-2">
      {/* LEFT CHANNEL */}
      <div className="flex flex-col items-center gap-1">
        <span className="text-[9px] font-mono font-bold text-text-secondary">L</span>
        <input
          type="range"
          min={minDisplay}
          max={maxDisplay}
          step={stepDisplay}
          value={valL}
          onPointerDown={() => { isDraggingRef.current = true; }}
          onMouseDown={() => { isDraggingRef.current = true; }}
          onTouchStart={() => { isDraggingRef.current = true; }}
          onChange={(e) => handleDragL(parseInt(e.target.value, 10))}
          onPointerUp={() => commit(valL, isLinked ? valL : valR)}
          onMouseUp={() => commit(valL, isLinked ? valL : valR)}
          onTouchEnd={() => commit(valL, isLinked ? valL : valR)}
          className={`w-2 ${heightClass} appearance-none bg-[var(--glass-border)] rounded cursor-pointer accent-brand-lime`}
          style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
        />
        <input
          type="number"
          min={minDisplay}
          max={maxDisplay}
          step={stepDisplay}
          value={strL}
          onChange={(e) => {
            const str = e.target.value;
            setStrL(str);
            if (isLinked) setStrR(str);
          }}
          onBlur={() => {
            const parsedL = parseInt(strL, 10);
            commit(parsedL, isLinked ? parsedL : parseInt(strR, 10));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const parsedL = parseInt(strL, 10);
              commit(parsedL, isLinked ? parsedL : parseInt(strR, 10));
            }
          }}
          className="w-11 text-center bg-[var(--bg-card)] border border-[var(--glass-border)] rounded text-[9px] font-mono font-bold text-text-primary focus:outline-none focus:border-brand-lime py-0.5 px-0.5 mt-0.5"
        />
      </div>

      {/* RIGHT CHANNEL */}
      <div className="flex flex-col items-center gap-1">
        <span className="text-[9px] font-mono font-bold text-text-secondary">R</span>
        <input
          type="range"
          min={minDisplay}
          max={maxDisplay}
          step={stepDisplay}
          value={valR}
          onPointerDown={() => { isDraggingRef.current = true; }}
          onMouseDown={() => { isDraggingRef.current = true; }}
          onTouchStart={() => { isDraggingRef.current = true; }}
          onChange={(e) => handleDragR(parseInt(e.target.value, 10))}
          onPointerUp={() => commit(isLinked ? valR : valL, valR)}
          onMouseUp={() => commit(isLinked ? valR : valL, valR)}
          onTouchEnd={() => commit(isLinked ? valR : valL, valR)}
          className={`w-2 ${heightClass} appearance-none bg-[var(--glass-border)] rounded cursor-pointer accent-brand-lime`}
          style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
        />
        <input
          type="number"
          min={minDisplay}
          max={maxDisplay}
          step={stepDisplay}
          value={strR}
          onChange={(e) => {
            const str = e.target.value;
            setStrR(str);
            if (isLinked) setStrL(str);
          }}
          onBlur={() => {
            const parsedR = parseInt(strR, 10);
            commit(isLinked ? parsedR : parseInt(strL, 10), parsedR);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const parsedR = parseInt(strR, 10);
              commit(isLinked ? parsedR : parseInt(strL, 10), parsedR);
            }
          }}
          className="w-11 text-center bg-[var(--bg-card)] border border-[var(--glass-border)] rounded text-[9px] font-mono font-bold text-text-primary focus:outline-none focus:border-brand-lime py-0.5 px-0.5 mt-0.5"
        />
      </div>
    </div>
  );
});

/* AudioScience Skewer (Brocheta) Channel Strip Component */
const AlsaSkewerChannelStrip: React.FC<ChannelStripProps> = React.memo(({
  group,
  activeProcesses,
  onControlChange,
  isLinked,
  onToggleLink,
  canvasRefSetter,
  endpointIcon,
  hideInlineMixerButton = false,
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

    // Check if control is an input monitor gain on hardware outputs (e.g. Front Mic, Rear Mic, Line, CD, Aux)
    const isInputMonitorGain =
      isHardwareOutputs &&
      !isMasterControl &&
      (nameLower.includes('mic') || nameLower.includes('line') || nameLower.includes('cd') || nameLower.includes('aux') || nameLower.includes('pcm'));

    const hasCrosstalkPattern =
      isInputMonitorGain ||
      ((nameLower.includes('pcm') || nameLower.includes('digital') || nameLower.includes('line') || nameLower.includes('mic') || nameLower.includes('aux')) &&
      (nameLower.includes('monitor') || !!nameLower.match(/(pcm|digital|line|mic|aux)\s+\d+.*(pcm|digital|line|mic|aux)\s+\d+/i)));

    if (isExplicitMatrix || (isHardwareOutputs && !isMasterControl && hasCrosstalkPattern)) {
      matrixControls.push(c);
    } else {
      directControls.push(c);
    }
  });

  // Sort direct controls according to physical audio signal flow
  directControls.sort((a, b) => {
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();

    const aIsBoost = aName.includes('boost') || aName.includes('preamp');
    const bIsBoost = bName.includes('boost') || bName.includes('preamp');

    if (isHardwareInputs) {
      // In hardware_inputs: signal flows Right (Connector) -> Left (Bus)
      // Boost pre-amp is nearest to Physical Connector (Rightmost)
      if (aIsBoost && !bIsBoost) return 1;
      if (!aIsBoost && bIsBoost) return -1;
    } else {
      // In hardware_outputs: signal flows Left (Bus) -> Right (Connector)
      // Boost pre-amp is nearest to Bus (Leftmost)
      if (aIsBoost && !bIsBoost) return -1;
      if (!aIsBoost && bIsBoost) return 1;
    }

    return 0;
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

  // Find active capture routing control value (strictly for capture route/source ingestion controls on capture channels)
  const routeCtrl = group.controls.find((c) => {
    if (!c) return false;
    const isEnum = c.ctrl_type === 'enum' || c.ctrl_type === 'route' || (c.items && c.items.length > 0);
    if (!isEnum) return false;
    const nameLower = c.name.toLowerCase();

    // Exclude crossover, channel swap, and digital format selectors (e.g. SPDIF, AES/EBU, Swap L/R, Mode)
    if (nameLower.includes('mode') || nameLower.includes('swap') || nameLower.includes('format') || nameLower.includes('crossover')) {
      return false;
    }

    // Explicit route or source ingestion selectors
    return c.ctrl_type === 'route' || nameLower.includes('route') || nameLower.includes('source') || nameLower.includes('input');
  });

  // Only display ROUTE badge on capture channels (Virtual Capture / Bottom-Left quadrant or Hardware Input capture routes)
  const isCaptureChannel = isVirtualCapture || isHardwareInputs;
  const activeRouteName = isCaptureChannel && routeCtrl && routeCtrl.items && routeCtrl.items[routeCtrl.values?.[0] ?? 0]
    ? routeCtrl.items[routeCtrl.values?.[0] ?? 0]
    : null;

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
          {!hideInlineMixerButton && Object.keys(matrixSourcesMap).length > 0 && (
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
                                <div className="flex flex-col items-center justify-center py-1 gap-1">
                                  {isStereo ? (
                                    <AlsaStereoFaderPair
                                      min={volCtrl.min ?? 0}
                                      max={volCtrl.max ?? 100}
                                      step={volCtrl.step ?? 1}
                                      volValL={volValL}
                                      volValR={volValR}
                                      isLinked={isLinked}
                                      heightClass="h-20"
                                      onChangeCommit={(vals) => {
                                        onControlChange(volCtrl.numid, vals);
                                      }}
                                    />
                                  ) : (
                                    <AlsaFaderUnit
                                      min={volCtrl.min ?? 0}
                                      max={volCtrl.max ?? 100}
                                      step={volCtrl.step ?? 1}
                                      value={volValL}
                                      heightClass="h-24"
                                      onChangeCommit={(v) => {
                                        onControlChange(volCtrl.numid, [v]);
                                      }}
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
              const minVal = ctrl.min ?? 0;
              const maxVal = ctrl.max ?? 100;
              const stepVal = Math.max(1, ctrl.step ?? 1);
              const totalSteps = Math.floor((maxVal - minVal) / stepVal) + 1;
              const isDiscreteStep = totalSteps > 1 && totalSteps <= 6;

              // Generate discrete step option values
              const discreteOptions: number[] = [];
              if (isDiscreteStep) {
                for (let s = minVal; s <= maxVal; s += stepVal) {
                  discreteOptions.push(s);
                }
              }

              return (
                <div key={ctrl.numid} className="w-9 flex items-center justify-center">
                  <div className="relative">
                    <button
                      onClick={() => setActivePopup(isOpen ? null : ctrl.numid)}
                      title={`${ctrl.name}: ${formatControlValue(ctrl, currentVal)}`}
                      className="p-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--glass-border)] hover:border-brand-lime text-sm text-text-primary shadow-sm cursor-pointer"
                    >
                      {isDiscreteStep ? '⚡' : '🎚️'}
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

                          {isDiscreteStep ? (
                            /* DISCRETE COARSE STEP SELECTOR MODAL (e.g. Boost Gain / Hardware Step Select) */
                            <div className="flex flex-col items-center gap-2 py-1 w-full">
                              <span className="text-[10px] font-mono text-text-secondary uppercase">Select Hardware Gain Step:</span>
                              <div className="flex flex-col gap-1.5 w-full">
                                {discreteOptions.map((optVal) => {
                                  const isSelected = currentVal === optVal;
                                  return (
                                    <button
                                      key={optVal}
                                      onClick={() => {
                                        const vals = isLinked ? new Array(ctrl.channels).fill(optVal) : [optVal, ...ctrl.values.slice(1)];
                                        onControlChange(ctrl.numid, vals);
                                      }}
                                      className={`w-full py-2 px-3 rounded-lg text-xs font-mono font-bold flex items-center justify-between transition-all cursor-pointer border ${
                                        isSelected
                                          ? 'bg-brand-lime/20 text-brand-lime border-brand-lime shadow-sm'
                                          : 'bg-[var(--input-bg)] text-text-primary border-[var(--glass-border)] hover:border-brand-lime/50'
                                      }`}
                                    >
                                      <span>{formatControlValue(ctrl, optVal)}</span>
                                      {isSelected && <span>✓</span>}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ) : (
                            /* CONTINUOUS FINE VOLUME FADER MODAL */
                            <div className="flex flex-col items-center gap-2 py-2">
                              <div className="text-[11px] font-mono font-bold text-brand-lime">
                                {formatControlValue(ctrl, currentVal)}
                              </div>
                              <div className="flex items-center justify-center py-1">
                                <AlsaFaderUnit
                                  min={ctrl.min ?? 0}
                                  max={ctrl.max ?? 100}
                                  step={ctrl.step ?? 1}
                                  value={currentVal}
                                  heightClass="h-28"
                                  onChangeCommit={(v) => {
                                    const vals = isLinked ? new Array(ctrl.channels).fill(v) : [v, ...ctrl.values.slice(1)];
                                    onControlChange(ctrl.numid, vals);
                                  }}
                                />
                              </div>
                              <div className="flex items-center justify-between w-full text-[9px] font-mono text-text-secondary gap-3">
                                <span>{formatControlValue(ctrl, ctrl.min)}</span>
                                <span>{formatControlValue(ctrl, ctrl.max)}</span>
                              </div>
                            </div>
                          )}
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

        {/* RIGHT: ROUTING SOURCE BADGE & FFMPEG ACTIVE PROCESS ALIASES */}
        <div className="flex items-center gap-2">
          {activeRouteName && (
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-amber-400 font-semibold uppercase">Route:</span>
              <span
                title={`Active Audio Route Source: ${activeRouteName}`}
                className="bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[9px] px-1.5 py-0.2 rounded font-mono font-bold truncate max-w-[140px]"
              >
                {activeRouteName}
              </span>
            </div>
          )}

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
});
