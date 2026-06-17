import React, { useState, useEffect } from 'react';
import type { BuildProfile } from '../../components/BuildProfileCard';

interface DashboardViewProps {
  telemetry: any[];
  systemTelemetry: any;
  taskStats: any;
  taskExecutions: any[];
  builds: BuildProfile[];
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  telemetry,
  systemTelemetry,
  taskStats,
  taskExecutions,
  builds,
}) => {
  const [locatorActive, setLocatorActive] = useState(false);

  useEffect(() => {
    let interval: any;
    if (systemTelemetry.lcd && systemTelemetry.lcd.connected) {
      const checkStatus = () => {
        fetch('/api/lcd/locator')
          .then(res => res.json())
          .then(data => setLocatorActive(!!data.active))
          .catch(err => console.error(err));
      };
      checkStatus();
      interval = setInterval(checkStatus, 2000);
    }
    return () => clearInterval(interval);
  }, [systemTelemetry.lcd?.connected]);

  const toggleLocator = async () => {
    try {
      const targetState = !locatorActive;
      const res = await fetch('/api/lcd/locator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: targetState }),
      });
      if (res.ok) {
        setLocatorActive(targetState);
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <>
      <header className="flex justify-between items-center mb-12">
        <div>
          <h1 className="text-4xl font-bold mb-2">DASHBOARD</h1>
          <p className="text-text-secondary">Monitoring and controlling FFMPEG nodes</p>
        </div>
        <div className="flex gap-4">
          {systemTelemetry.lcd && systemTelemetry.lcd.connected && (
            <button
              onClick={toggleLocator}
              className={`pill-button flex items-center gap-2 transition-all ${
                locatorActive 
                  ? 'bg-red-500 text-white animate-pulse shadow-lg shadow-red-500/25 border border-red-500' 
                  : 'bg-white/5 border border-white/10 text-white/60 hover:bg-white/10'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${locatorActive ? 'bg-white' : 'bg-red-500'}`}></span>
              {locatorActive ? 'LOCATOR ACTIVE' : 'FIND ME'}
            </button>
          )}
          <div className="pill-button bg-white/5 border border-white/10 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-brand-lime"></span>
            Node: Standalone
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-12">
        {/* Column 1: Process Management & load */}
        <div className="space-y-8">
          <div className="glass-card p-8 border-brand-lime/10">
            <h3 className="text-xl font-black mb-6">SYSTEM STATS</h3>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
              <div className="bg-white/5 border border-white/5 rounded-2xl p-3 text-center">
                <div className="text-[9px] uppercase font-bold text-text-secondary mb-1">Active Services</div>
                <div className="font-black text-xl text-brand-lime">
                  {telemetry.filter(p => (p.type === 'service' || !p.type) && p.status === 'running').length}
                </div>
              </div>
              <div className="bg-white/5 border border-white/5 rounded-2xl p-3 text-center">
                <div className="text-[9px] uppercase font-bold text-text-secondary mb-1">Inactive Services</div>
                <div className="font-black text-xl text-white/50">
                  {telemetry.filter(p => (p.type === 'service' || !p.type) && p.status !== 'running').length}
                </div>
              </div>
              <div className="bg-white/5 border border-white/5 rounded-2xl p-3 text-center">
                <div className="text-[9px] uppercase font-bold text-text-secondary mb-1">Active Tasks</div>
                <div className="font-black text-xl text-brand-blue">
                  {taskStats.active}
                </div>
              </div>
              <div className="bg-white/5 border border-white/5 rounded-2xl p-3 text-center">
                <div className="text-[9px] uppercase font-bold text-text-secondary mb-1">Scheduled Tasks</div>
                <div className="font-black text-xl text-brand-orange">
                  {taskStats.scheduled}
                </div>
              </div>
              <div className="bg-white/5 border border-white/5 rounded-2xl p-3 text-center col-span-2 lg:col-span-1">
                <div className="text-[9px] uppercase font-bold text-text-secondary mb-1">Inactive Tasks</div>
                <div className="font-black text-xl text-white/40">
                  {taskStats.inactive}
                </div>
              </div>
            </div>

            <h4 className="text-xs font-black uppercase text-text-secondary tracking-wider mb-4">Node Resources Load</h4>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-text-secondary">System CPU Load</span>
                  <span className="text-brand-lime font-mono font-bold">
                    {systemTelemetry.cpu}%
                  </span>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-brand-lime transition-all duration-500" 
                    style={{ width: `${Math.min(100, systemTelemetry.cpu)}%` }}
                  ></div>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-text-secondary">System Memory Usage</span>
                  <span className="text-brand-orange font-mono font-bold">
                    {systemTelemetry.ram_used} MB / {systemTelemetry.ram_total || 16384} MB
                  </span>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-brand-orange transition-all duration-500" 
                    style={{ 
                      width: `${Math.min(100, systemTelemetry.ram_total > 0 
                        ? (systemTelemetry.ram_used / systemTelemetry.ram_total) * 100 
                        : 0)}%` 
                    }}
                  ></div>
                </div>
              </div>

              {systemTelemetry.gpu && systemTelemetry.gpu.vendor && systemTelemetry.gpu.vendor !== 'none' ? (
                <>
                  <div className="pt-2 border-t border-white/5">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-text-secondary flex items-center gap-1.5">
                        GPU Load 
                        <span className="text-[9px] uppercase font-black tracking-wider px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-mono">
                          {systemTelemetry.gpu.vendor}
                        </span>
                      </span>
                      <span className="text-blue-400 font-mono font-bold">
                        {systemTelemetry.gpu.utilization}%
                      </span>
                    </div>
                    <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-blue-400 transition-all duration-500" 
                        style={{ width: `${Math.min(100, systemTelemetry.gpu.utilization)}%` }}
                      ></div>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-text-secondary">VRAM Usage</span>
                      <span className="text-blue-400 font-mono font-bold">
                        {systemTelemetry.gpu.vram_used} MB / {systemTelemetry.gpu.vram_total} MB
                      </span>
                    </div>
                    <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-blue-400 transition-all duration-500" 
                        style={{ 
                          width: `${Math.min(100, systemTelemetry.gpu.vram_total > 0 
                            ? (systemTelemetry.gpu.vram_used / systemTelemetry.gpu.vram_total) * 100 
                            : 0)}%` 
                        }}
                      ></div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="pt-3 border-t border-white/5">
                  <div className="flex flex-col items-center justify-center p-4 bg-white/2 border border-white/5 rounded-xl text-center">
                    <span className="text-[10px] font-black uppercase tracking-wider text-white/30 font-mono mb-1">GPU Telemetry</span>
                    <span className="text-xs font-bold text-white/40">Not Detected</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Column 2: Hardware Capabilities Detection */}
        <div className="glass-card p-8 border-brand-orange/10">
          <h3 className="text-xl font-black mb-6">HARDWARE & PERIPHERALS</h3>
          <p className="text-xs text-text-secondary mb-8 leading-relaxed">
            Real-time introspection of host media acceleration capabilities, sound servers, and capture hardware devices.
          </p>
          <div className="space-y-6">
            {/* LCD Status Item */}
            {systemTelemetry.lcd && (
              <div className="flex flex-col gap-1 p-3 bg-white/2 border border-white/5 rounded-xl">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs uppercase text-white font-mono">LCD PANEL</span>
                  <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded ${
                    systemTelemetry.lcd.connected
                      ? 'bg-brand-lime/25 text-brand-lime'
                      : 'bg-white/5 text-white/40'
                  }`}>
                    {systemTelemetry.lcd.connected ? 'CONNECTED' : 'OFFLINE'}
                  </span>
                </div>
                <p className="text-[10px] text-text-secondary mt-1">
                  {systemTelemetry.lcd.connected 
                    ? `Crystalfontz CFA-635 active on ${systemTelemetry.lcd.port || 'detected port'}`
                    : 'External hardware control panel is offline or disabled'
                  }
                </p>
              </div>
            )}

            {Object.entries(systemTelemetry.capabilities || {}).map(([key, value]: [string, any]) => (
              <div key={key} className="flex flex-col gap-1 p-3 bg-white/2 border border-white/5 rounded-xl">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs uppercase text-white font-mono">{key}</span>
                  <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded ${
                    value.available
                      ? 'bg-brand-lime/25 text-brand-lime'
                      : 'bg-white/5 text-white/40'
                  }`}>
                    {value.available ? 'AVAILABLE' : 'UNAVAILABLE'}
                  </span>
                </div>
                <p className="text-[10px] text-text-secondary mt-1">{value.details}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Column 3: System Info & Scheduler status */}
        <div className="space-y-8">
          {/* System Info */}
          <div className="glass-card p-8 border-white/5">
            <h3 className="text-xl font-black mb-6">SYSTEM INFO</h3>
            <div className="space-y-4">
              <div className="flex justify-between py-2 border-b border-white/5">
                <span className="text-xs text-text-secondary">Host OS & Arch</span>
                <span className="text-xs font-mono font-bold text-white">Linux x86_64</span>
              </div>
              <div className="flex justify-between py-2 border-b border-white/5">
                <span className="text-xs text-text-secondary">Active Profiles</span>
                <span className="text-xs font-mono font-bold text-brand-lime text-right">
                  {builds.filter(b => b.status === 'ready').length}
                </span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-xs text-text-secondary">Backend API Version</span>
                <span className="text-xs font-mono font-bold text-brand-lime text-right">v1.2.0-stable</span>
              </div>
            </div>
          </div>

          {/* Scheduler status banner */}
          <div className="glass-card p-8 border-purple-500/10 bg-purple-500/2">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">📅</span>
              <h3 className="text-lg font-black text-white/90">SCHEDULER STATUS</h3>
            </div>
            <div className="p-4 bg-purple-500/10 border border-purple-500/25 rounded-2xl">
              <div className="text-[10px] uppercase font-black text-purple-400 tracking-wider mb-1 flex items-center justify-between">
                <span>CRON DAEMON</span>
                <span className={`w-2 h-2 rounded-full ${taskExecutions.some(e => e.status === 'running') ? 'bg-brand-lime animate-pulse' : 'bg-purple-400'}`}></span>
              </div>
              <div className="text-xs text-white font-bold">
                {taskExecutions.some(e => e.status === 'running')
                  ? `ACTIVE / RUNNING (${taskExecutions.filter(e => e.status === 'running').length} active)`
                  : 'ONLINE / IDLE'}
              </div>
              <div className="text-[10px] text-text-secondary mt-2 leading-relaxed">
                Real-time monitor of task schedules, cron intervals, and batch processes.
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
