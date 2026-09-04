import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Sidebar from './components/Sidebar';
import ProcessConfigForm from './components/ProcessConfigForm';
import { ScheduledTasks } from './components/ScheduledTasks';
import { useAuth } from './hooks/useAuth';
import { useBuilds } from './hooks/useBuilds';
import { useProcesses } from './hooks/useProcesses';
import { DashboardView } from './components/views/DashboardView';
import { ServicesView } from './components/views/ServicesView';
import { SettingsView } from './components/views/SettingsView';
import { ForgeView } from './components/views/ForgeView';
import { FfmpegPreviewModal } from './components/modals/FfmpegPreviewModal';
import { MediaMtxPreviewModal } from './components/modals/MediaMtxPreviewModal';
import { IcecastPreviewModal } from './components/modals/IcecastPreviewModal';
import { ServiceTypePickerModal } from './components/modals/ServiceTypePickerModal';
import { MediaMtxConfigForm } from './components/forms/MediaMtxConfigForm';
import { IcecastConfigForm } from './components/forms/IcecastConfigForm';

const API = '';

function App() {
  const { t } = useTranslation();
  const [activeView, setActiveView] = useState('dashboard');
  const [showEnvModal, setShowEnvModal] = useState(false);
  const [selectedLinuxDistro, setSelectedLinuxDistro] = useState<'debian' | 'fedora' | 'arch'>('debian');
  const [creationServiceType, setCreationServiceType] = useState<'ffmpeg_stream' | 'mediamtx_hub' | 'icecast_server'>('ffmpeg_stream');
  const [creationStep, setCreationStep] = useState<'picker' | 'form'>('picker');

  // Custom Hooks
  const {
    settings,
    isAuthenticated,
    setIsAuthenticated,
    loginPass,
    setLoginPass,
    isLoginError,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    passwordError,
    setPasswordError,
    passwordSuccess,
    setPasswordSuccess,
    handleUpdateSettings,
    handleLogoUpload,
    handleLogin,
  } = useAuth();

  const {
    builds,
    diskInfo,
    buildDeps,
    checkStatus,
    capabilities,
    terminalBuild,
    setTerminalBuild,
    validationResult,
    setValidationResult,
    showBuildForm,
    setShowBuildForm,
    editingBuild,
    setEditingBuild,
    importRecipeRef,
    refreshBuilds,
    refreshDiskInfo,
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
    fetchDeps,
  } = useBuilds(activeView);

  const {
    telemetry,
    taskExecutions,
    upcomingTasks,
    systemTelemetry,
    taskStats,
    selectedProcess,
    setSelectedProcess,
    logs,
    showAddModal,
    setShowAddModal,
    editingProcess,
    setEditingProcess,
    importFileRef,
    handleDeleteProcess,
    handleStartService,
    handleStopService,
    handleCloneProcess,
    handleRestartService,
    handleImportFileChange,
    actionPending,
  } = useProcesses();

  useEffect(() => {
    // 1. Update document title
    document.title = settings.lcd_alias || settings.node_name || 'FFMPEG-GUI';

    // 2. Update favicon
    let link: HTMLLinkElement | null = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    
    if (settings.logo_path) {
      link.href = `${API}${settings.logo_path}`;
    } else {
      const accent = settings.accent_color || '#FF6B00';
      const text = (settings.logo_text || 'FF').toUpperCase().slice(0, 3);
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
          <rect width="32" height="32" rx="8" fill="${accent}" />
          <text x="50%" y="55%" dominant-baseline="central" text-anchor="middle" fill="#000000" font-family="sans-serif" font-size="12" font-weight="900">
            ${text}
          </text>
        </svg>
      `.trim();
      link.href = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }
  }, [settings.lcd_alias, settings.node_name, settings.logo_path, settings.logo_text, settings.accent_color]);

  // ── Render Auth Screen ──────────────────────────────────────────
  if (!isAuthenticated) {
    const logoUrl = settings.logo_path ? `${API}${settings.logo_path}` : null;
    const accent = settings.accent_color || '#FF6B00';
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg-dark)] text-[var(--text-primary)] p-4 transition-colors duration-300">
        <div 
          className="glass-card w-full max-w-md p-10 animate-in zoom-in duration-500"
          style={{ borderColor: `${accent}4d` }}
        >
          <div 
            className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-2xl overflow-hidden"
            style={!logoUrl ? { backgroundColor: accent, boxShadow: `0 10px 20px ${accent}33` } : undefined}
          >
            {logoUrl ? (
              <img src={logoUrl} alt="Logo" className="w-full h-full object-contain" />
            ) : (
              <span className="text-black font-black text-3xl">{settings.logo_text || 'FF'}</span>
            )}
          </div>
          <h1 className="text-2xl font-bold text-center mb-2 uppercase tracking-tighter">{settings.node_name || 'FFMPEG-GUI'}</h1>
          <p className="text-text-secondary text-center text-sm mb-10">{t('auth.accessRestricted')}</p>
          
          <div className="space-y-6">
            <input 
              type="password" 
              className={`w-full bg-white/5 border ${isLoginError ? 'border-red-500' : 'border-white/10'} rounded-2xl p-4 text-center text-2xl tracking-[0.5em] outline-none transition-all`}
              value={loginPass}
              onChange={e => setLoginPass(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              autoFocus
            />
            {isLoginError && <p className="text-red-500 text-center text-xs font-bold animate-shake">{t('auth.invalidPassword')}</p>}
            <button 
              onClick={handleLogin}
              className="w-full py-4 text-black font-black rounded-2xl hover:scale-[1.02] transition-all uppercase tracking-widest"
              style={{ backgroundColor: accent, boxShadow: `0 10px 20px ${accent}33` }}
            >
              {t('auth.unlockNode')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Render Application ──────────────────────────────────────────
  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-dark)] text-[var(--text-primary)] transition-colors duration-300">
      <Sidebar 
        activeView={activeView} 
        onViewChange={setActiveView} 
        logoText={settings.logo_text}
        logoPath={settings.logo_path ? `${API}${settings.logo_path}` : undefined}
        accentColor={settings.accent_color}
        onLogout={settings.gui_password ? () => {
          setLoginPass('');
          setIsAuthenticated(false);
        } : undefined}
      />

      <main className="flex-1 overflow-y-auto p-8 lg:p-12">
        {/* ════ DASHBOARD VIEW ════ */}
        {activeView === 'dashboard' && (
          <DashboardView
            telemetry={telemetry}
            systemTelemetry={{
              ...systemTelemetry,
              capabilities,
            }}
            taskStats={taskStats}
            upcomingTasks={upcomingTasks}
            builds={builds}
            settings={settings}
          />
        )}

        {/* ════ SERVICES VIEW ════ */}
        {activeView === 'services' && (
          <ServicesView
            telemetry={telemetry}
            actionPending={actionPending}
            onEditProcess={setEditingProcess}
            onCloneProcess={handleCloneProcess}
            onStartService={handleStartService}
            onStopService={handleStopService}
            onRestartService={handleRestartService}
            onDeleteProcess={handleDeleteProcess}
            onSelectedProcess={setSelectedProcess}
            importFileRef={importFileRef}
            handleImportFileChange={handleImportFileChange}
            setShowAddModal={setShowAddModal}
            API={API}
          />
        )}

        {/* ════ SCHEDULED TASKS VIEW ════ */}
        {activeView === 'batch' && (
          <ScheduledTasks API={API} taskExecutions={taskExecutions} />
        )}

        {/* ════ SETTINGS VIEW ════ */}
        {activeView === 'settings' && (
          <SettingsView
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            handleLogoUpload={handleLogoUpload}
            newPassword={newPassword}
            setNewPassword={setNewPassword}
            confirmPassword={confirmPassword}
            setConfirmPassword={setConfirmPassword}
            passwordError={passwordError}
            setPasswordError={setPasswordError}
            passwordSuccess={passwordSuccess}
            setPasswordSuccess={setPasswordSuccess}
            capabilities={capabilities}
            systemTelemetry={systemTelemetry}
            API={API}
          />
        )}

        {/* ════ FFMPEG FORGE VIEW ════ */}
        {activeView === 'tools' && (
          <ForgeView
            builds={builds}
            diskInfo={diskInfo}
            buildDeps={buildDeps}
            checkStatus={checkStatus}
            showEnvModal={showEnvModal}
            setShowEnvModal={setShowEnvModal}
            selectedLinuxDistro={selectedLinuxDistro}
            setSelectedLinuxDistro={setSelectedLinuxDistro}
            systemTelemetry={systemTelemetry}
            validationResult={validationResult}
            setValidationResult={setValidationResult}
            terminalBuild={terminalBuild}
            setTerminalBuild={setTerminalBuild}
            showBuildForm={showBuildForm}
            setShowBuildForm={setShowBuildForm}
            editingBuild={editingBuild}
            setEditingBuild={setEditingBuild}
            handleCreateBuild={handleCreateBuild}
            handleUpdateBuild={handleUpdateBuild}
            handleCompile={handleCompile}
            handleStopBuild={handleStopBuild}
            handleCleanSources={handleCleanSources}
            handleValidate={handleValidate}
            handleSetDefault={handleSetDefault}
            handleDeleteBuild={handleDeleteBuild}
            handleImportRecipeChange={handleImportRecipeChange}
            handleExportRecipe={handleExportRecipe}
            importRecipeRef={importRecipeRef}
            refreshBuilds={refreshBuilds}
            refreshDiskInfo={refreshDiskInfo}
            refreshDeps={fetchDeps}
          />
        )}
      </main>

      {/* ── Add Service Modal (Step 1: Engine Picker, Step 2: Dedicated Form) ── */}
      {showAddModal && creationStep === 'picker' && (
        <ServiceTypePickerModal
          API={API}
          onClose={() => {
            setShowAddModal(false);
          }}
          onSelectServiceType={(serviceType) => {
            setCreationServiceType(serviceType as any);
            setCreationStep('form');
          }}
        />
      )}

      {showAddModal && creationStep === 'form' && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="glass-card w-full max-w-4xl p-5 border-brand-orange/20 shadow-2xl relative max-h-[95vh] flex flex-col overflow-hidden">
            <button
              onClick={() => {
                setShowAddModal(false);
                setCreationStep('picker');
              }}
              className="absolute top-4 right-4 w-6 h-6 bg-white/10 rounded-full flex items-center justify-center text-text-secondary hover:text-white hover:bg-white/20 transition-all z-10 text-xs cursor-pointer"
            >
              ✕
            </button>
            <div className="flex items-center justify-between gap-4 mb-3 flex-shrink-0">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCreationStep('picker')}
                  className="text-xs text-[var(--text-secondary)] hover:text-brand-lime font-bold uppercase tracking-wider flex items-center gap-1 cursor-pointer"
                  title="Volver al selector"
                >
                  ← {t('common.back', 'Back')}
                </button>
                <span className="text-[var(--glass-border)]">|</span>
                <h3 className="text-base font-bold tracking-wide uppercase">
                  {t('services.addNewService')}: {creationServiceType === 'mediamtx_hub' ? 'MediaMTX Hub' : creationServiceType === 'icecast_server' ? 'Icecast2 Server' : 'FFmpeg Stream'}
                </h3>
              </div>
            </div>

            {creationServiceType === 'mediamtx_hub' ? (
              <MediaMtxConfigForm
                API={API}
                onCancel={() => {
                  setShowAddModal(false);
                  setCreationStep('picker');
                }}
                onSubmit={async (payload) => {
                  try {
                    const res = await fetch(`${API}/processes`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(payload),
                    });
                    if (res.ok) {
                      setShowAddModal(false);
                      setCreationStep('picker');
                    } else {
                      const errData = await res.json();
                      alert(`Error creating MediaMTX service: ${errData.detail || 'Unknown error'}`);
                    }
                  } catch (err: any) {
                    alert(`Network error: ${err.message || err}`);
                  }
                }}
              />
            ) : creationServiceType === 'icecast_server' ? (
              <IcecastConfigForm
                API={API}
                onCancel={() => {
                  setShowAddModal(false);
                  setCreationStep('picker');
                }}
                onSubmit={async (payload) => {
                  try {
                    const res = await fetch(`${API}/processes`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(payload),
                    });
                    if (res.ok) {
                      setShowAddModal(false);
                      setCreationStep('picker');
                    } else {
                      const errData = await res.json();
                      alert(`Error creating Icecast service: ${errData.detail || 'Unknown error'}`);
                    }
                  } catch (err: any) {
                    alert(`Network error: ${err.message || err}`);
                  }
                }}
              />
            ) : (
              <ProcessConfigForm
                onCancel={() => {
                  setShowAddModal(false);
                  setCreationStep('picker');
                }}
                onSubmit={async (config) => {
                  try {
                    const res = await fetch(`${API}/processes`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        name: config.name,
                        type: 'service',
                        service_type: 'ffmpeg_stream',
                        alias: config.alias,
                        input_config: config.input_config,
                        output_config: config.output_config,
                        codec_config: config.codec_config,
                        filter_config: config.filter_config,
                        ffmpeg_build_id: config.ffmpeg_build_id,
                        auto_start: config.auto_start,
                        startup_order: config.startup_order,
                        startup_delay: config.startup_delay,
                        watchdog_enabled: config.watchdog_enabled,
                        watchdog_retries: config.watchdog_retries,
                        watchdog_min_speed: config.watchdog_min_speed,
                        watchdog_min_speed_duration: config.watchdog_min_speed_duration,
                        network_timeout: config.network_timeout,
                        debug_mode: config.debug_mode,
                        log_storage_id: config.log_storage_id,
                      }),
                    });
                    if (res.ok) {
                      setShowAddModal(false);
                      setCreationStep('picker');
                    } else {
                      const errData = await res.json();
                      alert(`Error creating service: ${errData.detail || 'Unknown error'}`);
                    }
                  } catch (err: any) {
                    alert(`Network error creating service: ${err.message || err}`);
                  }
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Edit Service Modal ── */}
      {editingProcess && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="glass-card w-full max-w-4xl p-5 border-brand-orange/20 shadow-2xl relative max-h-[95vh] flex flex-col overflow-hidden">
            <button
              onClick={() => setEditingProcess(null)}
              className="absolute top-4 right-4 w-6 h-6 bg-white/10 rounded-full flex items-center justify-center text-text-secondary hover:text-white hover:bg-white/20 transition-all z-10 text-xs cursor-pointer"
            >
              ✕
            </button>
            <h3 className="text-base font-bold mb-3 flex-shrink-0 tracking-wide uppercase">
              {t('services.editService')}: {editingProcess.name.toUpperCase()}
            </h3>

            {editingProcess.service_type === 'mediamtx_hub' ? (
              <MediaMtxConfigForm
                API={API}
                initialConfig={editingProcess}
                onCancel={() => setEditingProcess(null)}
                onSubmit={async (payload) => {
                  try {
                    const res = await fetch(`${API}/processes/${editingProcess.id}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(payload),
                    });
                    if (res.ok) {
                      setEditingProcess(null);
                    } else {
                      const errData = await res.json();
                      alert(`Error updating MediaMTX service: ${errData.detail || 'Unknown error'}`);
                    }
                  } catch (err: any) {
                    alert(`Network error updating service: ${err.message || err}`);
                  }
                }}
              />
            ) : editingProcess.service_type === 'icecast_server' ? (
              <IcecastConfigForm
                API={API}
                initialConfig={editingProcess}
                onCancel={() => setEditingProcess(null)}
                onSubmit={async (payload) => {
                  try {
                    const res = await fetch(`${API}/processes/${editingProcess.id}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(payload),
                    });
                    if (res.ok) {
                      setEditingProcess(null);
                    } else {
                      const errData = await res.json();
                      alert(`Error updating Icecast service: ${errData.detail || 'Unknown error'}`);
                    }
                  } catch (err: any) {
                    alert(`Network error updating service: ${err.message || err}`);
                  }
                }}
              />
            ) : (
              <ProcessConfigForm
                initialConfig={editingProcess}
                onCancel={() => setEditingProcess(null)}
                onSubmit={async (config) => {
                  try {
                    const res = await fetch(`${API}/processes/${editingProcess.id}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        name: config.name,
                        service_type: 'ffmpeg_stream',
                        alias: config.alias,
                        input_config: config.input_config,
                        output_config: config.output_config,
                        codec_config: config.codec_config,
                        filter_config: config.filter_config,
                        ffmpeg_build_id: config.ffmpeg_build_id,
                        auto_start: config.auto_start,
                        startup_order: config.startup_order,
                        startup_delay: config.startup_delay,
                        watchdog_enabled: config.watchdog_enabled,
                        watchdog_retries: config.watchdog_retries,
                        watchdog_min_speed: config.watchdog_min_speed,
                        watchdog_min_speed_duration: config.watchdog_min_speed_duration,
                        network_timeout: config.network_timeout,
                        debug_mode: config.debug_mode,
                        log_storage_id: config.log_storage_id,
                      }),
                    });
                    if (res.ok) {
                      setEditingProcess(null);
                    } else {
                      const errData = await res.json();
                      alert(`Error updating service: ${errData.detail || 'Unknown error'}`);
                    }
                  } catch (err: any) {
                    alert(`Network error updating service: ${err.message || err}`);
                  }
                }}
                onSaveAs={async (config) => {
                  try {
                    const res = await fetch(`${API}/processes`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(config),
                    });
                    if (res.ok) {
                      setEditingProcess(null);
                    } else {
                      const errData = await res.json();
                      alert(`Error saving service as copy: ${errData.detail || 'Unknown error'}`);
                    }
                  } catch (err: any) {
                    alert(`Network error saving service copy: ${err.message || err}`);
                  }
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Preview / Monitor Modals ── */}
      {selectedProcess && (
        selectedProcess.service_type === 'mediamtx_hub' ? (
          <MediaMtxPreviewModal
            selectedProcess={selectedProcess}
            telemetry={telemetry}
            actionPending={actionPending}
            logs={logs}
            onClose={() => setSelectedProcess(null)}
            onEditProcess={setEditingProcess}
            onCloneProcess={handleCloneProcess}
            onStartService={handleStartService}
            onStopService={handleStopService}
            onRestartService={handleRestartService}
            API={API}
          />
        ) : selectedProcess.service_type === 'icecast_server' ? (
          <IcecastPreviewModal
            selectedProcess={selectedProcess}
            telemetry={telemetry}
            actionPending={actionPending}
            logs={logs}
            onClose={() => setSelectedProcess(null)}
            onEditProcess={setEditingProcess}
            onCloneProcess={handleCloneProcess}
            onStartService={handleStartService}
            onStopService={handleStopService}
            onRestartService={handleRestartService}
            API={API}
          />
        ) : (
          <FfmpegPreviewModal
            selectedProcess={selectedProcess}
            telemetry={telemetry}
            actionPending={actionPending}
            logs={logs}
            onClose={() => setSelectedProcess(null)}
            onEditProcess={setEditingProcess}
            onCloneProcess={handleCloneProcess}
            onStartService={handleStartService}
            onStopService={handleStopService}
            onRestartService={handleRestartService}
            API={API}
          />
        )
      )}
    </div>
  );
}

export default App;
