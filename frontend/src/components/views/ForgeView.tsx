import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import BuildProfileCard from '../BuildProfileCard';
import type { BuildProfile } from '../BuildProfileCard';
import BuildFormModal from '../BuildFormModal';
import BuildTerminal from '../BuildTerminal';
import { 
  ImportIcon, 
  PlusIcon, 
  GearIcon, 
  ForgeIcon, 
  ClipboardIcon,
  RefreshIcon,
  PackageIcon,
  FfmpegLogoIcon
} from '../Icons';
import { BuildSdksModal } from '../modals/BuildSdksModal';

const packageMapping: Record<'debian' | 'fedora' | 'arch', Record<string, string>> = {
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
    "libdrm": "libdrm-dev",
    "libmp3lame": "libmp3lame-dev",
    "libvorbis": "libvorbis-dev",
    "avahi-daemon": "avahi-daemon avahi-utils",
    "libopus": "libopus-dev",
    "libvpx": "libvpx-dev",
    "libfreetype": "libfreetype-dev",
    "libharfbuzz": "libharfbuzz-dev",
    "libfontconfig": "libfontconfig1-dev",
    "libfribidi": "libfribidi-dev",
    "vainfo": "vainfo",
    "nvidia-cuda-dev": "nvidia-cuda-dev",
    "clang": "clang"
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
    "libdrm": "libdrm-devel",
    "libmp3lame": "lame-devel",
    "libvorbis": "libvorbis-devel",
    "avahi-daemon": "avahi",
    "libopus": "opus-devel",
    "libvpx": "libvpx-devel",
    "libfreetype": "freetype-devel",
    "libharfbuzz": "harfbuzz-devel",
    "libfontconfig": "fontconfig-devel",
    "libfribidi": "fribidi-devel",
    "vainfo": "vainfo",
    "nvidia-cuda-dev": "cuda-toolkit",
    "clang": "clang"
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
    "libdrm": "libdrm",
    "libmp3lame": "lame",
    "libvorbis": "libvorbis",
    "avahi-daemon": "avahi",
    "libopus": "opus",
    "libvpx": "libvpx",
    "libfreetype": "freetype2",
    "libharfbuzz": "harfbuzz",
    "libfontconfig": "fontconfig",
    "libfribidi": "fribidi",
    "vainfo": "vainfo",
    "nvidia-cuda-dev": "cuda",
    "clang": "clang"
  }
};

const getSingleInstallCommand = (depName: string, distro: 'debian' | 'fedora' | 'arch') => {
  const pkgName = packageMapping[distro]?.[depName] || depName;
  if (distro === 'debian') {
    return `sudo apt install -y ${pkgName}`;
  } else if (distro === 'fedora') {
    return `sudo dnf install -y ${pkgName}`;
  } else if (distro === 'arch') {
    return `sudo pacman -S --needed --noconfirm ${pkgName}`;
  }
  return '';
};

interface ForgeViewProps {
  builds: BuildProfile[];
  diskInfo: any;
  buildDeps: any;
  checkStatus: string;
  showEnvModal: boolean;
  setShowEnvModal: (show: boolean) => void;
  selectedLinuxDistro: 'debian' | 'fedora' | 'arch';
  setSelectedLinuxDistro: (distro: 'debian' | 'fedora' | 'arch') => void;
  systemTelemetry: any;
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
  refreshDeps: () => Promise<void>;
  storages?: any[];
  API?: string;
  initialSoftwareType?: 'ffmpeg' | 'decklink_tools' | 'icecast2' | 'mediamtx' | 'kiosk_cog';
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
  systemTelemetry,
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
  refreshDeps,
  storages: initialStorages = [],
  API = '',
  initialSoftwareType = 'ffmpeg',
}) => {
  const { t } = useTranslation();
  const [showSdksModal, setShowSdksModal] = React.useState(false);
  const [storages, setStorages] = React.useState<any[]>(initialStorages);
  const [installedSdks, setInstalledSdks] = React.useState<any[]>([]);
  const [activeEngineTab, setActiveEngineTab] = React.useState<'ffmpeg' | 'decklink_tools' | 'icecast2' | 'mediamtx' | 'kiosk_cog'>(initialSoftwareType);

  const fetchSdks = React.useCallback(() => {
    fetch(`${API}/sdks`)
      .then(res => res.ok ? res.json() : [])
      .then(data => {
        if (Array.isArray(data)) setInstalledSdks(data);
      })
      .catch(err => console.error("Failed to fetch SDKs in ForgeView:", err));
  }, [API]);

  useEffect(() => {
    fetchSdks();
  }, [fetchSdks]);

  useEffect(() => {
    if (initialStorages.length > 0) {
      setStorages(initialStorages);
    }
  }, [initialStorages]);

  useEffect(() => {
    if ((showSdksModal || storages.length === 0) && API !== undefined) {
      fetch(`${API}/settings/storages`)
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setStorages(data);
        })
        .catch(err => console.error("Failed to fetch storages in ForgeView:", err));
    }
  }, [showSdksModal, API, storages.length]);

  useEffect(() => {
    if (showEnvModal) {
      refreshDeps();
    }
  }, [showEnvModal, refreshDeps]);

  const fallbackCopy = (text: string) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
    } catch (err) {
      console.error(err);
    }
    document.body.removeChild(textArea);
  };

  const filteredBuilds = builds.filter(b => (b.software_type || 'ffmpeg') === activeEngineTab);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-[var(--text-primary)] mb-0.5">
            {t('forge.mainTitle', 'FORGE')}
          </h1>
          <p className="text-xs text-text-secondary">{t('forge.subtitle', 'Build and manage custom compilation profiles')}</p>
        </div>
        <div className="flex items-center gap-4">
          {diskInfo && (
            <div className="pill-button bg-[var(--input-bg)] border border-[var(--glass-border)] flex items-center gap-2 text-xs">
              <span className="text-text-secondary">{t('forge.disk', 'DISK')}:</span>
              <span className={`font-mono font-bold ${diskInfo.free_gb < 10 ? 'text-red-400' : diskInfo.free_gb < 50 ? 'text-brand-orange' : 'text-brand-lime'}`}>
                {diskInfo.free_gb} {t('dashboard.freeGb', 'GB Free')}
              </span>
            </div>
          )}
        </div>
      </header>

      <div className="flex items-center gap-2 border-b border-[var(--glass-border)] mb-6 pb-2 w-full overflow-x-auto">
        <button
          onClick={() => setActiveEngineTab('ffmpeg')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all shrink-0 ${
            activeEngineTab === 'ffmpeg'
              ? 'bg-brand-orange/20 text-brand-orange border border-brand-orange/30 shadow-sm'
              : 'text-text-secondary hover:bg-[var(--input-bg)] hover:text-[var(--text-primary)] border border-transparent'
          }`}
        >
          <FfmpegLogoIcon size={16} /> FFmpeg
        </button>

        <button
          onClick={() => setActiveEngineTab('decklink_tools')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all shrink-0 ${
            activeEngineTab === 'decklink_tools'
              ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30 shadow-sm'
              : 'text-text-secondary hover:bg-[var(--input-bg)] hover:text-[var(--text-primary)] border border-transparent'
          }`}
        >
          <span>🎛️</span> DeckLink Tools
        </button>

        <button
          onClick={() => setActiveEngineTab('icecast2')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all shrink-0 ${
            activeEngineTab === 'icecast2'
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 shadow-sm'
              : 'text-text-secondary hover:bg-[var(--input-bg)] hover:text-[var(--text-primary)] border border-transparent'
          }`}
        >
          <span>📻</span> Icecast2
        </button>

        <button
          onClick={() => setActiveEngineTab('mediamtx')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all shrink-0 ${
            activeEngineTab === 'mediamtx'
              ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30 shadow-sm'
              : 'text-text-secondary hover:bg-[var(--input-bg)] hover:text-[var(--text-primary)] border border-transparent'
          }`}
        >
          <span>🔄</span> MediaMTX
        </button>

        <button
          onClick={() => setActiveEngineTab('kiosk_cog')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all shrink-0 ${
            activeEngineTab === 'kiosk_cog'
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-sm'
              : 'text-text-secondary hover:bg-[var(--input-bg)] hover:text-[var(--text-primary)] border border-transparent'
          }`}
        >
          <span>🌐</span> Kiosk Cog
        </button>
      </div>

      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xs font-bold uppercase tracking-wider text-text-secondary">
          {t('forge.activeProfilesFor', 'PROFILES')} — <span className="text-[var(--text-primary)]">{activeEngineTab.replace('_', ' ').toUpperCase()}</span>
        </h3>
        <div className="flex items-center gap-3">
          {(activeEngineTab === 'ffmpeg' || activeEngineTab === 'decklink_tools') && (
            <button
              onClick={() => setShowSdksModal(true)}
              className="pill-button bg-[var(--input-bg)] border border-[var(--glass-border)] text-[var(--text-primary)] font-bold hover:border-brand-orange/40 hover:scale-105 transition-transform flex items-center gap-1.5 text-xs"
            >
              <span>📦</span> {t('sdks.manageSdks', 'MANAGE SDKS')}
            </button>
          )}
          <button onClick={() => importRecipeRef.current?.click()}
            className="pill-button bg-[var(--input-bg)] border border-[var(--glass-border)] text-[var(--text-primary)] font-bold hover:border-brand-lime/40 hover:scale-105 transition-transform flex items-center gap-1.5 text-xs">
            <ImportIcon size={14} /> {t('forge.importRecipe', 'IMPORT RECIPE')}
          </button>
          <input 
            type="file" 
            ref={importRecipeRef} 
            className="hidden" 
            accept=".json" 
            onChange={handleImportRecipeChange} 
          />
          <button onClick={() => { setEditingBuild(null); setShowBuildForm(true) }}
            className="pill-button bg-brand-orange text-black font-black hover:scale-105 transition-transform flex items-center gap-1.5 text-xs">
            <PlusIcon size={14} /> {t('forge.newBuildProfile', 'NEW BUILD PROFILE')}
          </button>
        </div>
      </div>

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
            <h4 className="text-sm font-black uppercase tracking-wider">{t('forge.envStatusTitle', 'ENVIRONMENT DEPENDENCIES')}</h4>
            <p className="text-xs text-text-secondary mt-0.5">
              {checkStatus === 'loading' ? (
                <span className="text-brand-orange animate-pulse">{t('forge.analyzingDeps', 'Analyzing dependencies...')}</span>
              ) : checkStatus === 'error' ? (
                <span className="text-red-400 font-bold">{t('forge.backendError', 'Backend connection error')}</span>
              ) : buildDeps?.all_required_met ? (
                <span className="text-brand-lime">{t('forge.allDepsInstalled', 'All required build tools and libraries installed')}</span>
              ) : (
                <span className="text-brand-orange font-bold">{t('forge.missingDeps', 'Some required build tools are missing')}</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSdksModal(true)}
            className="px-5 py-2.5 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl text-xs font-bold transition-all hover:border-brand-lime/40 flex items-center gap-2 text-[var(--text-primary)]"
          >
            <PackageIcon size={14} /> {t('sdks.manageSdks', 'MANAGE SDKs')}
          </button>
          <button
            onClick={() => setShowEnvModal(true)}
            className="px-5 py-2.5 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl text-xs font-bold transition-all hover:border-brand-lime/40 flex items-center gap-2 text-[var(--text-primary)]"
          >
            <GearIcon size={14} /> {t('forge.manageDeps', 'MANAGE DEPS')}
          </button>
        </div>
      </div>

      {/* Build Profiles List */}
      <div className="space-y-4">
        {filteredBuilds.length === 0 ? (
          <div className="text-center py-20 border-2 border-dashed border-white/5 rounded-3xl">
            <div className="text-white/10 mb-6 flex justify-center">
              <ForgeIcon size={48} />
            </div>
            <div className="text-text-secondary text-lg mb-2">{t('forge.noProfilesYet', 'No build profiles yet')}</div>
            <div className="text-text-secondary text-sm">{t('forge.createFirstProfile', 'Create your first build profile to get started')}</div>
          </div>
        ) : (
          (() => {
            const isAnyBuilding = builds.some(b => b.status === 'building');
            return filteredBuilds.map(build => (
              <BuildProfileCard
                key={build.id}
                build={build}
                installedSdks={installedSdks}
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
          onOpenSdksModal={() => { setShowBuildForm(false); setShowSdksModal(true); }}
          initialSoftwareType={activeEngineTab}
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

      {/* SDKs Management Modal */}
      <BuildSdksModal
        isOpen={showSdksModal}
        onClose={() => {
          setShowSdksModal(false);
          fetchSdks();
        }}
        storages={storages}
        onRefresh={() => {
          fetchSdks();
          if (typeof checkStatus === 'function') {
            (checkStatus as any)();
          }
          refreshBuilds();
        }}
        API={API}
        filterSdkTypes={activeEngineTab === 'decklink_tools' ? ['decklink'] : undefined}
      />

      {/* Validation Result Modal */}
      {validationResult && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-8 z-50">
          <div className="glass-card w-full max-w-2xl p-8 relative">
            <button onClick={() => setValidationResult(null)}
              className="absolute top-6 right-6 text-text-secondary hover:text-white">✕</button>
            <h3 className="text-xl font-bold mb-4 text-brand-lime">{t('forge.buildValidation')}</h3>
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
            
            {/* Refresh button */}
            <button 
              onClick={refreshDeps}
              disabled={checkStatus === 'loading'}
              className="absolute top-5 right-15 w-8 h-8 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center text-text-secondary hover:text-white transition-colors disabled:opacity-50"
              title="Recargar dependencias"
            >
              <RefreshIcon size={14} className={checkStatus === 'loading' ? 'animate-spin text-brand-orange' : ''} />
            </button>

            {/* Close button */}
            <button 
              onClick={() => setShowEnvModal(false)}
              className="absolute top-5 right-5 w-8 h-8 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center text-text-secondary hover:text-white transition-colors"
            >
              ✕
            </button>

            <h3 className="text-lg font-black tracking-tight mb-1 flex items-center gap-2">
              <ForgeIcon size={16} /> {t('forge.compilationEnvState')}
            </h3>
            <p className="text-xs text-text-secondary mb-6 leading-relaxed">
              {t('forge.envDescription')}
            </p>

            <div className="flex items-center justify-between pb-4 border-b border-white/5 mb-6">
              <span className="text-xs font-bold text-white/70 uppercase tracking-wider">{t('forge.linuxDistro')}</span>
              <div className="flex gap-2">
                {(['debian', 'fedora', 'arch'] as const).map(distro => (
                  <button
                    key={distro}
                    onClick={() => setSelectedLinuxDistro(distro)}
                    className={`px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase transition-all ${selectedLinuxDistro === distro ? 'bg-brand-orange text-black font-black' : 'bg-white/5 text-text-secondary hover:text-white'}`}
                  >
                    {distro === 'debian' ? 'Debian/Ubuntu' : distro === 'fedora' ? 'Fedora/RedHat' : 'Arch Linux'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-6 pr-1 custom-scrollbar min-h-0">
              
              {/* Required Deps Section */}
              <div>
                <h4 className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-3">{t('forge.requiredTools')}</h4>
                <div className="space-y-2">
                  {Object.entries(buildDeps?.dependencies || {})
                    .filter(([, info]: any) => info.type === 'required')
                    .map(([name, info]: any) => (
                      <div key={name} className="flex flex-col p-3 bg-white/2 border border-white/5 rounded-xl gap-2">
                        <div className="flex items-center justify-between">
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-white/95">{name}</span>
                            <span className="text-[10px] text-text-secondary mt-0.5">{info.description}</span>
                          </div>
                          <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black ${info.installed ? 'bg-brand-lime/10 text-brand-lime' : 'bg-red-500/10 text-red-400'}`}>
                            {info.installed ? t('forge.installed') : t('forge.absent')}
                          </span>
                        </div>
                        {!info.installed && (
                          <div className="flex items-center justify-between bg-black/40 border border-white/5 rounded-lg p-1.5 pl-2.5 gap-2 mt-1">
                            <code className="font-mono text-[9px] text-white/80 select-all break-all">
                              {getSingleInstallCommand(name, selectedLinuxDistro)}
                            </code>
                            <button
                              onClick={() => {
                                const cmd = getSingleInstallCommand(name, selectedLinuxDistro);
                                if (navigator.clipboard && navigator.clipboard.writeText) {
                                  navigator.clipboard.writeText(cmd).catch(() => fallbackCopy(cmd));
                                } else {
                                  fallbackCopy(cmd);
                                }
                              }}
                              className="p-1 bg-white/5 hover:bg-white/10 rounded text-text-secondary hover:text-white transition-all shrink-0 flex items-center justify-center"
                              title={t('forge.copyInstallCommand')}
                            >
                              <ClipboardIcon size={10} />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              </div>

              {/* Optional Deps Section */}
              <div>
                <h4 className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-3">{t('forge.optionalLibs')}</h4>
                <div className="space-y-2">
                  {Object.entries(buildDeps?.dependencies || {})
                    .filter(([, info]: any) => info.type === 'optional')
                    .map(([name, info]: any) => (
                      <div key={name} className="flex flex-col p-3 bg-white/2 border border-white/5 rounded-xl gap-2">
                        <div className="flex items-center justify-between">
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-white/95">{name}</span>
                            <span className="text-[10px] text-text-secondary mt-0.5">{info.description}</span>
                          </div>
                          <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black ${info.installed ? 'bg-brand-lime/10 text-brand-lime' : 'bg-brand-orange/10 text-brand-orange'}`}>
                            {info.installed ? t('forge.installed') : t('forge.notInstalled')}
                          </span>
                        </div>
                        {!info.installed && (
                          <div className="flex items-center justify-between bg-black/40 border border-white/5 rounded-lg p-1.5 pl-2.5 gap-2 mt-1">
                            <code className="font-mono text-[9px] text-white/80 select-all break-all">
                              {getSingleInstallCommand(name, selectedLinuxDistro)}
                            </code>
                            <button
                              onClick={() => {
                                const cmd = getSingleInstallCommand(name, selectedLinuxDistro);
                                if (navigator.clipboard && navigator.clipboard.writeText) {
                                  navigator.clipboard.writeText(cmd).catch(() => fallbackCopy(cmd));
                                } else {
                                  fallbackCopy(cmd);
                                }
                              }}
                              className="p-1 bg-white/5 hover:bg-white/10 rounded text-text-secondary hover:text-white transition-all shrink-0 flex items-center justify-center"
                              title={t('forge.copyInstallCommand')}
                            >
                              <ClipboardIcon size={10} />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              </div>

              {/* Command Generator */}
              {(() => {
                const hasNvidia = !!(systemTelemetry?.capabilities?.nvenc?.available || (systemTelemetry?.gpu?.vendor && systemTelemetry.gpu.vendor.toLowerCase().includes('nvidia')));

                const missingRequired = Object.entries(buildDeps?.dependencies || {})
                  .filter(([, info]: any) => info.type === 'required' && !info.installed)
                  .map(([name]) => name);

                const missingOptional = Object.entries(buildDeps?.dependencies || {})
                  .filter(([, info]: any) => info.type === 'optional' && !info.installed)
                  .map(([name]) => name);

                let allMissing = [...missingRequired, ...missingOptional];

                if (!hasNvidia) {
                  allMissing = allMissing.filter(dep => dep !== 'clang' && dep !== 'nvidia-cuda-dev');
                }

                if (allMissing.length === 0) {
                  return (
                    <div className="bg-brand-lime/5 border border-brand-lime/20 p-4 rounded-2xl text-center">
                      <span className="text-brand-lime font-bold text-xs">{t('forge.allSet')}</span>
                    </div>
                  );
                }

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
                        <ForgeIcon size={12} /> {t('forge.suggestedInstallCommand')}
                      </span>
                    </div>
                    
                    <div className="relative bg-black/60 border border-white/10 rounded-xl p-3 flex items-center justify-between gap-3">
                      <code className="font-mono text-[10px] text-white/95 break-all select-all pr-8">
                        {cmdStr}
                      </code>
                      <button
                        onClick={() => {
                          if (navigator.clipboard && navigator.clipboard.writeText) {
                            navigator.clipboard.writeText(cmdStr).catch(() => fallbackCopy(cmdStr));
                          } else {
                            fallbackCopy(cmdStr);
                          }
                        }}
                        className="shrink-0 p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs hover:scale-105 transition-all active:scale-95 flex items-center justify-center text-text-secondary hover:text-white"
                        title={t('forge.copyInstallCommand')}
                      >
                        <ClipboardIcon size={14} />
                      </button>
                    </div>
                    {!hasNvidia && (
                      <p className="text-[9px] text-brand-orange mt-2">
                        {t('forge.nvidiaExcludedNote')}
                      </p>
                    )}
                    <p className="text-[9px] text-text-secondary leading-tight">
                      {t('forge.commandWillInstall')} ({allMissing.join(', ')}).
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
                {t('forge.closePanel')}
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
};
