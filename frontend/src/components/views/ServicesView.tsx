import React from 'react';
import { formatInputDesc, formatOutputDesc } from '../../utils/formatters';
import { 
  ImportIcon, 
  ExportIcon, 
  PlusIcon, 
  PencilIcon, 
  ClipboardIcon, 
  StopIcon, 
  PlayIcon, 
  TrashIcon, 
  LightningIcon, 
  ShieldIcon,
  RefreshIcon
} from '../Icons';

interface ServicesViewProps {
  telemetry: any[];
  onEditProcess: (proc: any) => void;
  onCloneProcess: (proc: any) => void;
  onStartService: (procId: number) => void;
  onStopService: (procId: number) => void;
  onRestartService: (procId: number, name: string) => void;
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
  onRestartService,
  onDeleteProcess,
  onSelectedProcess,
  importFileRef,
  handleImportFileChange,
  setShowAddModal,
  API,
}) => {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white mb-0.5">SERVICES</h1>
          <p className="text-xs text-text-secondary">Continuous media streaming and processing node instances</p>
        </div>
        <div className="flex gap-4">
          <button onClick={() => importFileRef.current?.click()}
            className="pill-button bg-white/10 hover:bg-white/15 border border-white/10 text-white font-bold transition-all flex items-center gap-1.5">
            <ImportIcon size={14} /> IMPORT PROFILE
          </button>
          <input 
            type="file" 
            ref={importFileRef} 
            className="hidden" 
            accept=".json" 
            onChange={handleImportFileChange} 
          />
          <button onClick={() => setShowAddModal(true)}
            className="pill-button bg-brand-lime text-black font-black transition-all flex items-center gap-1.5">
            <PlusIcon size={14} /> NEW SERVICE
          </button>
        </div>
      </header>

      <div className="space-y-4">
        {/* Active Running Services */}
        <div className="glass-card p-4 md:p-5">
          <h3 className="text-xl font-black mb-3">ACTIVE SERVICES (RUNNING)</h3>
          <div className="space-y-2.5">
            {telemetry.filter(p => (p.type === 'service' || !p.type) && p.status === 'running').length === 0 ? (
              <div className="text-text-secondary py-8 text-center border border-dashed border-white/5 rounded-2xl">
                No running services
              </div>
            ) : (
              telemetry.filter(p => (p.type === 'service' || !p.type) && p.status === 'running').map(proc => (
                <div key={proc.id} onClick={() => onSelectedProcess(proc)}
                  className="flex items-center justify-between p-3 bg-brand-lime/5 rounded-xl border border-brand-lime/10 cursor-pointer hover:bg-brand-lime/10 transition-colors">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-brand-lime animate-pulse"></span>
                      <span className="font-bold text-white">
                        {proc.name}
                        {proc.alias && (
                          <span className="text-xs font-semibold text-text-secondary ml-1.5 opacity-80" title={`LCD Alias: ${proc.alias}`}>
                            [{proc.alias}]
                          </span>
                        )}
                      </span>
                      {proc.pending_changes && (
                        <span className="text-[10px] bg-brand-orange/20 text-brand-orange px-2 py-0.5 rounded font-black animate-pulse" title="Requires reboot to apply new configuration">
                          PENDING REBOOT
                        </span>
                      )}
                      {proc.auto_start && (
                        <span className="text-[9px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded font-bold flex items-center gap-1" title="Auto-starts on system boot">
                          <LightningIcon size={10} /> BOOT
                        </span>
                      )}
                      {proc.watchdog_enabled && (
                        <span className="text-[9px] bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded font-bold flex items-center gap-1" title="Monitored by system watchdog">
                          <ShieldIcon size={10} /> WATCHDOG
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-text-secondary space-y-0.5">
                      <p className="truncate">
                        Input: <code className="text-white font-mono">{formatInputDesc(proc.input_config)}</code>
                      </p>
                      <p className="truncate">
                        Output: <code className="text-white font-mono">{formatOutputDesc(proc.output_config)}</code>
                      </p>
                    </div>
                    <div className="flex gap-4 mt-1 text-xs text-text-secondary flex-wrap items-center">
                      <span>PID: <strong className="text-white font-mono">{proc.pid || 'N/A'}</strong></span>
                      <span className="text-white/10 select-none">|</span>
                      <span>CPU: <strong className="text-white">{proc.cpu || 0}%</strong></span>
                      <span>RAM: <strong className="text-white">{proc.ram || 0} MB</strong></span>
                      {proc.fps && <span>FPS: <strong className="text-white">{proc.fps}</strong></span>}
                      {proc.bitrate && <span>Bitrate: <strong className="text-white">{proc.bitrate}</strong></span>}
                      {proc.speed && <span>Speed: <strong className="text-white">{proc.speed}</strong></span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditProcess(proc);
                        }}
                        className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 transition-all hover:scale-105"
                        title="Edit Service Settings"
                      >
                        <PencilIcon size={16} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onCloneProcess(proc);
                        }}
                        className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 transition-all hover:scale-105"
                        title="Clone Service"
                      >
                        <ClipboardIcon size={16} />
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
                        className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 transition-all hover:scale-105"
                        title="Export Service"
                      >
                        <ExportIcon size={16} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRestartService(proc.id, proc.name);
                        }}
                        className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-105 ${
                          proc.pending_changes
                            ? "bg-brand-orange/20 hover:bg-brand-orange/30 border border-brand-orange text-brand-orange animate-pulse"
                            : "bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400"
                        }`}
                        title={proc.pending_changes ? "Restart service to apply new configuration" : "Restart Service"}
                      >
                        <RefreshIcon size={16} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onStopService(proc.id);
                        }}
                        className="w-9 h-9 rounded-xl bg-red-500/10 hover:bg-red-500/20 flex items-center justify-center border border-red-500/20 text-red-400 transition-all hover:scale-105"
                        title="Stop Service"
                      >
                        <StopIcon size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Inactive Configured Services */}
        <div className="glass-card p-4 md:p-5">
          <h3 className="text-xl font-black mb-3 text-white/50">CONFIGURED SERVICES (INACTIVE)</h3>
          <div className="space-y-2.5">
            {telemetry.filter(p => (p.type === 'service' || !p.type) && p.status !== 'running').length === 0 ? (
              <div className="text-text-secondary py-8 text-center border border-dashed border-white/5 rounded-2xl">
                No inactive services
              </div>
            ) : (
              telemetry.filter(p => (p.type === 'service' || !p.type) && p.status !== 'running').map(proc => {
                return (
                  <div key={proc.id} onClick={() => onSelectedProcess(proc)}
                    className="flex items-center justify-between p-3 bg-white/2 opacity-75 hover:opacity-100 rounded-xl border border-white/5 cursor-pointer hover:bg-white/5 transition-all">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-white/20"></span>
                        <span className="font-bold text-white/80">
                          {proc.name}
                          {proc.alias && (
                            <span className="text-xs font-semibold text-text-secondary ml-1.5 opacity-75" title={`LCD Alias: ${proc.alias}`}>
                              [{proc.alias}]
                            </span>
                          )}
                        </span>
                        {proc.auto_start && (
                          <span className="text-[9px] bg-blue-500/20 text-blue-400/80 px-2 py-0.5 rounded font-bold flex items-center gap-1" title="Auto-starts on system boot">
                            <LightningIcon size={10} /> BOOT
                          </span>
                        )}
                        {proc.watchdog_enabled && (
                          <span className="text-[9px] bg-purple-500/20 text-purple-400/80 px-2 py-0.5 rounded font-bold flex items-center gap-1" title="Monitored by system watchdog">
                            <ShieldIcon size={10} /> WATCHDOG
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-text-secondary space-y-0.5 mt-0.5">
                        <p className="truncate">
                          Input: <code className="text-white font-mono">{formatInputDesc(proc.input_config)}</code>
                        </p>
                        <p className="truncate">
                          Output: <code className="text-white font-mono">{formatOutputDesc(proc.output_config)}</code>
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-4 items-center">
                      <div className="flex gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onStartService(proc.id);
                          }}
                          className="w-9 h-9 rounded-xl bg-brand-lime/10 hover:bg-brand-lime/20 flex items-center justify-center border border-brand-lime/20 text-brand-lime transition-all hover:scale-105"
                          title="Start Service"
                        >
                          <PlayIcon size={16} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditProcess(proc);
                          }}
                          className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 transition-all hover:scale-105"
                          title="Edit Service Settings"
                        >
                          <PencilIcon size={16} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onCloneProcess(proc);
                          }}
                          className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 transition-all hover:scale-105"
                          title="Clone Service"
                        >
                          <ClipboardIcon size={16} />
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
                          className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 transition-all hover:scale-105"
                          title="Export Service"
                        >
                          <ExportIcon size={16} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteProcess(proc);
                          }}
                          className="w-9 h-9 rounded-xl bg-red-500/10 hover:bg-red-500/20 flex items-center justify-center border border-red-500/20 text-red-400 transition-all hover:scale-105"
                          title="Delete Service"
                        >
                          <TrashIcon size={16} />
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
