import React from 'react';
import BuildProfileCard from '../BuildProfileCard';
import type { BuildProfile } from '../BuildProfileCard';
import BuildFormModal from '../BuildFormModal';
import BuildTerminal from '../BuildTerminal';
import { 
  ImportIcon, 
  PlusIcon, 
  GearIcon, 
  ToolsIcon, 
  ClipboardIcon 
} from '../Icons';

interface ForgeViewProps {
  builds: BuildProfile[];
  diskInfo: any;
  buildDeps: any;
  checkStatus: string;
  showEnvModal: boolean;
  setShowEnvModal: (show: boolean) => void;
  selectedLinuxDistro: 'debian' | 'fedora' | 'arch';
  setSelectedLinuxDistro: (distro: 'debian' | 'fedora' | 'arch') => void;
  validationResult: { buildId: number; output: string } | null;
  setValidationResult: (res: { buildId: number; output: string } | null) => void;
  terminalBuild: { id: number; name: string } | null;
  setTerminalBuild: (tb: { id: number; name: string } | null) => void;
  showBuildForm: boolean;
  setShowBuildForm: (show: boolean) => void;
  editingBuild: BuildProfile | null;
  setEditingBuild: (b: BuildProfile | null) => void;
  handleCreateBuild: (data: any) => Promise<void>;
  handleUpdateBuild: (data: any) => Promise<void>;
  handleCompile: (id: number) => Promise<void>;
  handleStopBuild: (id: number) => Promise<void>;
  handleCleanSources: (id: number) => Promise<void>;
  handleValidate: (id: number) => Promise<void>;
  handleSetDefault: (id: number) => Promise<void>;
  handleDeleteBuild: (id: number) => Promise<void>;
  handleImportRecipeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleExportRecipe: (id: number) => void;
  importRecipeRef: React.RefObject<HTMLInputElement | null>;
  refreshBuilds: () => Promise<void>;
  refreshDiskInfo: () => Promise<void>;
}

export const ForgeView: React.FC<ForgeViewProps> = ({
  builds,
  diskInfo,
  buildDeps,
  checkStatus,
  showEnvModal,
  setShowEnvModal,
  selectedLinuxDistro,
  setSelectedLinuxDistro,
  validationResult,
  setValidationResult,
  terminalBuild,
  setTerminalBuild,
  showBuildForm,
  setShowBuildForm,
  editingBuild,
  setEditingBuild,
  handleCreateBuild,
  handleUpdateBuild,
  handleCompile,
  handleStopBuild,
  handleCleanSources,
  handleValidate,
  handleSetDefault,
  handleDeleteBuild,
  handleImportRecipeChange,
  handleExportRecipe,
  importRecipeRef,
  refreshBuilds,
  refreshDiskInfo,
}) => {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex justify-between items-center mb-10">
        <div>
          <h1 className="text-4xl font-bold mb-2 tracking-tighter">
            FFMPEG <span className="text-brand-orange">FORGE</span>
          </h1>
          <p className="text-text-secondary italic">Build Profiles Manager</p>
        </div>
        <div className="flex items-center gap-4">
          {diskInfo && (
            <div className="pill-button bg-white/5 border border-white/10 flex items-center gap-2 text-xs">
              <span className="text-text-secondary">Disk:</span>
              <span className={`font-mono font-bold ${diskInfo.free_gb < 10 ? 'text-red-400' : diskInfo.free_gb < 50 ? 'text-brand-orange' : 'text-brand-lime'}`}>
                {diskInfo.free_gb} GB free
              </span>
            </div>
          )}
          <button onClick={() => importRecipeRef.current?.click()}
            className="pill-button bg-white/10 hover:bg-white/15 border border-white/10 text-white font-bold hover:scale-105 transition-transform flex items-center gap-1.5">
            <ImportIcon size={14} /> IMPORT RECIPE
          </button>
          <input 
            type="file" 
            ref={importRecipeRef} 
            className="hidden" 
            accept=".json" 
            onChange={handleImportRecipeChange} 
          />
          <button onClick={() => { setEditingBuild(null); setShowBuildForm(true) }}
            className="pill-button bg-brand-orange text-black font-black hover:scale-105 transition-transform flex items-center gap-1.5">
            <PlusIcon size={14} /> NEW BUILD PROFILE
          </button>
        </div>
      </header>

      {/* Health environment badge & detail control */}
      <div className="glass-card p-6 mb-8 bg-white/2 border border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-xl">
            {checkStatus === 'loading' ? (
              <span className="w-5 h-5 border-2 border-brand-orange border-t-transparent rounded-full animate-spin inline-block" />
            ) : buildDeps?.all_required_met ? (
              <span className="text-brand-lime font-black">✓</span>
            ) : (
              <span className="text-brand-orange font-black">!</span>
            )}
          </div>
          <div>
            <h4 className="text-sm font-black uppercase tracking-wider">Estado del Entorno FFMPEG Forge</h4>
            <p className="text-xs text-text-secondary mt-0.5">
              {checkStatus === 'loading' ? (
                <span className="text-brand-orange animate-pulse">Analizando dependencias del sistema...</span>
              ) : checkStatus === 'error' ? (
                <span className="text-red-400 font-bold">Error de comunicación con el backend</span>
              ) : buildDeps?.all_required_met ? (
                <span className="text-brand-lime">Todas las dependencias críticas obligatorias están instaladas.</span>
              ) : (
                <span className="text-brand-orange font-bold">Faltan herramientas esenciales requeridas para compilar FFmpeg.</span>
              )}
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowEnvModal(true)}
          className="px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold transition-all hover:scale-102 flex items-center gap-2"
        >
          <GearIcon size={14} /> Gestionar Dependencias
        </button>
      </div>

      {/* Build Profiles List */}
      <div className="space-y-4">
        {builds.length === 0 ? (
          <div className="text-center py-20 border-2 border-dashed border-white/5 rounded-3xl">
            <div className="text-white/10 mb-6 flex justify-center">
              <ToolsIcon size={48} />
            </div>
            <div className="text-text-secondary text-lg mb-2">No build profiles yet</div>
            <div className="text-text-secondary text-sm">Create your first FFmpeg build profile to get started</div>
          </div>
        ) : (
          (() => {
            const isAnyBuilding = builds.some(b => b.status === 'building');
            return builds.map(build => (
              <BuildProfileCard
                key={build.id}
                build={build}
                isAnyBuilding={isAnyBuilding}
                onCompile={handleCompile}
                onStop={handleStopBuild}
                onValidate={handleValidate}
                onCleanSources={handleCleanSources}
                onDelete={handleDeleteBuild}
                onSetDefault={handleSetDefault}
                onEdit={(b) => { setEditingBuild(b); setShowBuildForm(true) }}
                onViewLogs={(id) => {
                  const b = builds.find(x => x.id === id)
                  if (b) setTerminalBuild({ id, name: b.name })
                }}
                onExport={handleExportRecipe}
              />
            ));
          })()
        )}
      </div>

      {/* Build Form Modal */}
      {showBuildForm && (
        <BuildFormModal
          editBuild={editingBuild}
          onClose={() => { setShowBuildForm(false); setEditingBuild(null) }}
          onSubmit={editingBuild ? handleUpdateBuild : handleCreateBuild}
          buildDeps={buildDeps}
        />
      )}

      {/* Build Terminal Overlay */}
      {terminalBuild && (
        <BuildTerminal
          buildId={terminalBuild.id}
          buildName={terminalBuild.name}
          onClose={() => { setTerminalBuild(null); refreshBuilds(); refreshDiskInfo() }}
        />
      )}

      {/* Validation Result Modal */}
      {validationResult && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-8 z-50">
          <div className="glass-card w-full max-w-2xl p-8 relative">
            <button onClick={() => setValidationResult(null)}
              className="absolute top-6 right-6 text-text-secondary hover:text-white">✕</button>
            <h3 className="text-xl font-bold mb-4 text-brand-lime">BUILD VALIDATION</h3>
            <pre className="bg-black/60 p-6 rounded-2xl font-mono text-xs text-white/80 overflow-auto max-h-96 whitespace-pre-wrap">
              {validationResult.output}
            </pre>
          </div>
        </div>
      )}

      {/* System Environment Detail Modal with Command Generator */}
      {showEnvModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-300">
          <div className="glass-card w-full max-w-2xl p-6 relative border border-white/10 flex flex-col max-h-[85vh] overflow-hidden">
            
            {/* Close button */}
            <button 
              onClick={() => setShowEnvModal(false)}
              className="absolute top-5 right-5 w-8 h-8 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center text-text-secondary hover:text-white transition-colors"
            >
              ✕
            </button>

            <h3 className="text-lg font-black tracking-tight mb-1 flex items-center gap-2">
              <ToolsIcon size={16} /> ESTADO DEL ENTORNO DE COMPILACIÓN
            </h3>
            <p className="text-xs text-text-secondary mb-6 leading-relaxed">
              FFmpeg Forge necesita compiladores de bajo nivel y bibliotecas externas de codecs para generar un binario robusto optimizado.
            </p>

            <div className="flex-1 overflow-y-auto space-y-6 pr-1 custom-scrollbar min-h-0">
              
              {/* Required Deps Section */}
              <div>
                <h4 className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-3">Herramientas Requeridas (Obligatorias)</h4>
                <div className="space-y-2">
                  {Object.entries(buildDeps?.dependencies || {})
                    .filter(([, info]: any) => info.type === 'required')
                    .map(([name, info]: any) => (
                      <div key={name} className="flex items-center justify-between p-3 bg-white/2 border border-white/5 rounded-xl">
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-white/95">{name}</span>
                          <span className="text-[10px] text-text-secondary mt-0.5">{info.description}</span>
                        </div>
                        <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black ${info.installed ? 'bg-brand-lime/10 text-brand-lime' : 'bg-red-500/10 text-red-400'}`}>
                          {info.installed ? 'INSTALADO' : 'AUSENTE'}
                        </span>
                      </div>
                    ))}
                </div>
              </div>

              {/* Optional Deps Section */}
              <div>
                <h4 className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-3">Bibliotecas Adicionales (Opcionales)</h4>
                <div className="space-y-2">
                  {Object.entries(buildDeps?.dependencies || {})
                    .filter(([, info]: any) => info.type === 'optional')
                    .map(([name, info]: any) => (
                      <div key={name} className="flex items-center justify-between p-3 bg-white/2 border border-white/5 rounded-xl">
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-white/95">{name}</span>
                          <span className="text-[10px] text-text-secondary mt-0.5">{info.description}</span>
                        </div>
                        <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black ${info.installed ? 'bg-brand-lime/10 text-brand-lime' : 'bg-brand-orange/10 text-brand-orange'}`}>
                          {info.installed ? 'INSTALADO' : 'NO INSTALADO'}
                        </span>
                      </div>
                    ))}
                </div>
              </div>

              {/* Command Generator */}
              {(() => {
                // Gather names of missing dependencies
                const missingRequired = Object.entries(buildDeps?.dependencies || {})
                  .filter(([, info]: any) => info.type === 'required' && !info.installed)
                  .map(([name]) => name);

                const missingOptional = Object.entries(buildDeps?.dependencies || {})
                  .filter(([, info]: any) => info.type === 'optional' && !info.installed)
                  .map(([name]) => name);

                const allMissing = [...missingRequired, ...missingOptional];

                if (allMissing.length === 0) {
                  return (
                    <div className="bg-brand-lime/5 border border-brand-lime/20 p-4 rounded-2xl text-center">
                      <span className="text-brand-lime font-bold text-xs">🎉 ¡Todo listo! Tu sistema tiene todas las dependencias instaladas.</span>
                    </div>
                  );
                }

                // Dynamic command mapping
                const packageMapping: Record<string, Record<string, string>> = {
                  debian: {
                    "cmake": "cmake",
                    "git": "git",
                    "make": "make",
                    "gcc": "gcc build-essential",
                    "pkg-config": "pkg-config",
                    "yasm/nasm": "yasm nasm",
                    "libx264": "libx264-dev",
                    "libx265": "libx265-dev",
                    "libssl": "libssl-dev",
                    "libva": "libva-dev",
                    "libdrm": "libdrm-dev"
                  },
                  fedora: {
                    "cmake": "cmake",
                    "git": "git",
                    "make": "make",
                    "gcc": "gcc gcc-c++",
                    "pkg-config": "pkgconfig",
                    "yasm/nasm": "yasm nasm",
                    "libx264": "x264-devel",
                    "libx265": "x265-devel",
                    "libssl": "openssl-devel",
                    "libva": "libva-devel",
                    "libdrm": "libdrm-devel"
                  },
                  arch: {
                    "cmake": "cmake",
                    "git": "git",
                    "make": "make",
                    "gcc": "gcc",
                    "pkg-config": "pkgconf",
                    "yasm/nasm": "yasm nasm",
                    "libx264": "x264",
                    "libx265": "x265",
                    "libssl": "openssl",
                    "libva": "libva",
                    "libdrm": "libdrm"
                  }
                };

                const distroPkgs = packageMapping[selectedLinuxDistro] || {};
                const targetPkgs = allMissing.map(dep => distroPkgs[dep] || dep).join(' ');

                let cmdStr = '';
                if (selectedLinuxDistro === 'debian') {
                  cmdStr = `sudo apt-get update && sudo apt-get install -y ${targetPkgs}`;
                } else if (selectedLinuxDistro === 'fedora') {
                  cmdStr = `sudo dnf install -y ${targetPkgs}`;
                } else if (selectedLinuxDistro === 'arch') {
                  cmdStr = `sudo pacman -S --needed --noconfirm ${targetPkgs}`;
                }

                return (
                  <div className="bg-white/5 border border-white/5 p-4 rounded-2xl space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase text-brand-orange tracking-wider flex items-center gap-1">
                        <ToolsIcon size={12} /> Comando de Instalación Sugerido
                      </span>
                      <div className="flex gap-2">
                        {(['debian', 'fedora', 'arch'] as const).map(distro => (
                          <button
                            key={distro}
                            onClick={() => setSelectedLinuxDistro(distro)}
                            className={`px-2 py-1 rounded text-[10px] font-bold uppercase transition-all ${selectedLinuxDistro === distro ? 'bg-brand-orange text-black font-black' : 'bg-white/5 text-text-secondary hover:text-white'}`}
                          >
                            {distro === 'debian' ? 'Debian/Ubuntu' : distro === 'fedora' ? 'Fedora/RedHat' : 'Arch Linux'}
                          </button>
                        ))}
                      </div>
                    </div>
                    
                    <div className="relative bg-black/60 border border-white/10 rounded-xl p-3 flex items-center justify-between gap-3">
                      <code className="font-mono text-[10px] text-white/95 break-all select-all pr-8">
                        {cmdStr}
                      </code>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(cmdStr);
                          alert("Comando copiado al portapapeles con éxito.");
                        }}
                        className="shrink-0 p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs hover:scale-105 transition-all active:scale-95 flex items-center justify-center text-text-secondary hover:text-white"
                        title="Copiar Comando"
                      >
                        <ClipboardIcon size={14} />
                      </button>
                    </div>
                    <p className="text-[9px] text-text-secondary leading-tight">
                      Este comando instalará exactamente las dependencias del sistema que se detectan ausentes ({allMissing.join(', ')}).
                    </p>
                  </div>
                );
              })()}

            </div>

            {/* Footer */}
            <div className="p-4 border-t border-white/10 bg-white/5 shrink-0 -mx-6 -mb-6 mt-6 flex justify-end">
              <button 
                onClick={() => setShowEnvModal(false)}
                className="px-6 py-2.5 bg-brand-orange text-black font-black text-xs rounded-xl hover:scale-102 transition-all uppercase tracking-wider"
              >
                Cerrar Panel
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
};
