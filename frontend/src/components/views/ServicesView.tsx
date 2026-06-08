import React from 'react';
import { formatInputDesc, formatOutputDesc } from '../../utils/formatters';

interface ServicesViewProps {
  telemetry: any[];
  onEditProcess: (proc: any) => void;
  onCloneProcess: (proc: any) => void;
  onStartService: (procId: number) => void;
  onStopService: (procId: number) => void;
  onDeleteProcess: (proc: any) => void;
  onSelectedProcess: (proc: any) => void;
  importFileRef: React.RefObject<HTMLInputElement | null>;
  handleImportFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  setShowAddModal: (show: boolean) => void;
  API: string;
}

export const ServicesView: React.FC<ServicesViewProps> = ({
  telemetry,
  onEditProcess,
  onCloneProcess,
  onStartService,
  onStopService,
  onDeleteProcess,
  onSelectedProcess,
  importFileRef,
  handleImportFileChange,
  setShowAddModal,
  API,
}) => {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex justify-between items-center mb-12">
        <div>
          <h1 className="text-4xl font-bold mb-2">SERVICES</h1>
          <p className="text-text-secondary">Continuous media streaming and processing node instances</p>
        </div>
        <div className="flex gap-4">
          <button onClick={() => importFileRef.current?.click()}
            className="pill-button bg-white/10 hover:bg-white/15 border border-white/10 text-white font-bold transition-all">
            📥 IMPORT PROFILE
          </button>
          <input 
            type="file" 
            ref={importFileRef} 
            className="hidden" 
            accept=".json" 
            onChange={handleImportFileChange} 
          />
          <button onClick={() => setShowAddModal(true)}
            className="pill-button bg-brand-lime text-black font-bold transition-all">
            + NEW SERVICE
          </button>
        </div>
      </header>

      <div className="space-y-8">
        {/* Active Running Services */}
        <div className="glass-card p-8">
          <h3 className="text-xl font-black mb-6">ACTIVE SERVICES (RUNNING)</h3>
          <div className="space-y-6">
            {telemetry.filter(p => (p.type === 'service' || !p.type) && p.status === 'running').length === 0 ? (
              <div className="text-text-secondary py-8 text-center border border-dashed border-white/5 rounded-2xl">
                No running services
              </div>
            ) : (
              telemetry.filter(p => (p.type === 'service' || !p.type) && p.status === 'running').map(proc => (
                <div key={proc.id} onClick={() => onSelectedProcess(proc)}
                  className="flex items-center justify-between p-4 bg-brand-lime/5 rounded-2xl border border-brand-lime/10 cursor-pointer hover:bg-brand-lime/10 transition-colors">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-brand-lime animate-pulse"></span>
                      <span className="font-bold text-white">{proc.name}</span>
                      {proc.pending_changes && (
                        <span className="text-[10px] bg-brand-orange/20 text-brand-orange px-2 py-0.5 rounded font-black animate-pulse" title="Requires reboot to apply new configuration">
                          PENDING REBOOT
                        </span>
                      )}
                      {proc.auto_start && (
                        <span className="text-[9px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded font-bold" title="Auto-starts on system boot">
                          ⚡ BOOT
                        </span>
                      )}
                      {proc.watchdog_enabled && (
                        <span className="text-[9px] bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded font-bold" title="Monitored by system watchdog">
                          🛡️ WATCHDOG
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-text-secondary flex gap-4 items-center flex-wrap">
                      <span>PID: <strong className="text-white font-mono">{proc.pid || 'N/A'}</strong></span>
                      <span className="text-white/10 select-none">|</span>
                      <span className="font-mono">{formatInputDesc(proc.input_config)} ➔ {formatOutputDesc(proc.output_config)}</span>
                    </div>
                  </div>
                  <div className="flex gap-8">
                    <div className="text-center">
                      <div className="text-brand-lime font-mono font-bold">{proc.cpu || 0}%</div>
                      <div className="text-[10px] uppercase text-text-secondary">CPU</div>
                    </div>
                    <div className="text-center">
                      <div className="text-brand-orange font-mono font-bold">{proc.ram || 0}MB</div>
                      <div className="text-[10px] uppercase text-text-secondary">RAM</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditProcess(proc);
                        }}
                        className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-sm border border-white/10 transition-all hover:scale-105"
                        title="Edit Service Settings"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onCloneProcess(proc);
                        }}
                        className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-sm border border-white/10 transition-all hover:scale-105"
                        title="Clone Service"
                      >
                        📋
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          fetch(`${API}/processes/${proc.id}/export`)
                            .then(r => r.json())
                            .then(data => {
                              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                              const a = document.createElement('a')
                              a.href = URL.createObjectURL(blob)
                              a.download = `${proc.name}_profile.json`
                              a.click()
                            })
                        }}
                        className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-sm border border-white/10 transition-all hover:scale-105"
                        title="Export Service"
                      >
                        📤
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onStopService(proc.id);
                        }}
                        className="w-8 h-8 rounded-xl bg-red-500/10 hover:bg-red-500/20 flex items-center justify-center text-sm border border-red-500/20 text-red-400 transition-all hover:scale-105"
                        title="Stop Service"
                      >
                        ⏹️
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Inactive Configured Services */}
        <div className="glass-card p-8">
          <h3 className="text-xl font-black mb-6 text-white/50">CONFIGURED SERVICES (INACTIVE)</h3>
          <div className="space-y-6">
            {telemetry.filter(p => (p.type === 'service' || !p.type) && p.status !== 'running').length === 0 ? (
              <div className="text-text-secondary py-8 text-center border border-dashed border-white/5 rounded-2xl">
                No inactive services
              </div>
            ) : (
              telemetry.filter(p => (p.type === 'service' || !p.type) && p.status !== 'running').map(proc => {
                return (
                  <div key={proc.id} onClick={() => onSelectedProcess(proc)}
                    className="flex items-center justify-between p-4 bg-white/2 opacity-75 hover:opacity-100 rounded-2xl border border-white/5 cursor-pointer hover:bg-white/5 transition-all">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-white/20"></span>
                        <span className="font-bold text-white/80">{proc.name}</span>
                        {proc.auto_start && (
                          <span className="text-[9px] bg-blue-500/20 text-blue-400/80 px-2 py-0.5 rounded font-bold" title="Auto-starts on system boot">
                            ⚡ BOOT
                          </span>
                        )}
                        {proc.watchdog_enabled && (
                          <span className="text-[9px] bg-purple-500/20 text-purple-400/80 px-2 py-0.5 rounded font-bold" title="Monitored by system watchdog">
                            🛡️ WATCHDOG
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-text-secondary font-mono">
                        {formatInputDesc(proc.input_config)} ➔ {formatOutputDesc(proc.output_config)}
                      </div>
                    </div>
                    <div className="flex gap-4 items-center">
                      <div className="flex gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onStartService(proc.id);
                          }}
                          className="w-8 h-8 rounded-xl bg-brand-lime/10 hover:bg-brand-lime/20 flex items-center justify-center text-sm border border-brand-lime/20 text-brand-lime transition-all hover:scale-105"
                          title="Start Service"
                        >
                          ▶️
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditProcess(proc);
                          }}
                          className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-sm border border-white/10 transition-all hover:scale-105"
                          title="Edit Service Settings"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onCloneProcess(proc);
                          }}
                          className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-sm border border-white/10 transition-all hover:scale-105"
                          title="Clone Service"
                        >
                          📋
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            fetch(`${API}/processes/${proc.id}/export`)
                              .then(r => r.json())
                              .then(data => {
                                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                                const a = document.createElement('a')
                                a.href = URL.createObjectURL(blob)
                                a.download = `${proc.name}_profile.json`
                                a.click()
                              })
                          }}
                          className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-sm border border-white/10 transition-all hover:scale-105"
                          title="Export Service"
                        >
                          📤
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteProcess(proc);
                          }}
                          className="w-8 h-8 rounded-xl bg-red-500/10 hover:bg-red-500/20 flex items-center justify-center text-sm border border-red-500/20 text-red-400 transition-all hover:scale-105"
                          title="Delete Service"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
