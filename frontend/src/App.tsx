import { useState, useEffect } from 'react';
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
import { ProcessPreviewModal } from './components/modals/ProcessPreviewModal';

const API = '';

function App() {
  const [activeView, setActiveView] = useState('dashboard');
  const [showEnvModal, setShowEnvModal] = useState(false);
  const [selectedLinuxDistro, setSelectedLinuxDistro] = useState<'debian' | 'fedora' | 'arch'>('debian');

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
  } = useBuilds(activeView);

  const {
    telemetry,
    taskExecutions,
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
      <div className="flex h-screen items-center justify-center bg-black text-white p-4">
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
              <span className="text-black font-black text-3xl">{settings.logo_text}</span>
            )}
          </div>
          <h1 className="text-2xl font-bold text-center mb-2 uppercase tracking-tighter">{settings.node_name}</h1>
          <p className="text-text-secondary text-center text-sm mb-10">Access restricted. Enter node password.</p>
          
          <div className="space-y-6">
            <input 
              type="password" 
              className={`w-full bg-white/5 border ${isLoginError ? 'border-red-500' : 'border-white/10'} rounded-2xl p-4 text-center text-2xl tracking-[0.5em] outline-none transition-all`}
              value={loginPass}
              onChange={e => setLoginPass(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              autoFocus
            />
            {isLoginError && <p className="text-red-500 text-center text-xs font-bold animate-shake">INVALID PASSWORD</p>}
            <button 
              onClick={handleLogin}
              className="w-full py-4 text-black font-black rounded-2xl hover:scale-[1.02] transition-all uppercase tracking-widest"
              style={{ backgroundColor: accent, boxShadow: `0 10px 20px ${accent}33` }}
            >
              Unlock Node
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Render Application ──────────────────────────────────────────
  return (
    <div className="flex h-screen overflow-hidden bg-black text-white">
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
            taskExecutions={taskExecutions}
            builds={builds}
            settings={settings}
          />
        )}

        {/* ════ SERVICES VIEW ════ */}
        {activeView === 'services' && (
          <ServicesView
            telemetry={telemetry}
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
          />
        )}
      </main>

      {/* ── Add Service Modal ── */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="glass-card w-full max-w-3xl p-8 relative max-h-[90vh] flex flex-col overflow-hidden">
            <button onClick={() => setShowAddModal(false)}
              className="absolute top-6 right-6 w-8 h-8 bg-white/10 rounded-full flex items-center justify-center text-text-secondary hover:text-white hover:bg-white/20 transition-all z-10">✕</button>
            <h3 className="text-2xl font-bold mb-4 flex-shrink-0">ADD NEW SERVICE</h3>
            <ProcessConfigForm
              onCancel={() => setShowAddModal(false)}
              onSubmit={async (config) => {
                try {
                  const res = await fetch(`${API}/processes`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      name: config.name, type: 'service',
                      alias: config.alias,
                      input_config: config.input_config, output_config: config.output_config,
                      codec_config: config.codec_config, filter_config: config.filter_config,
                      ffmpeg_build_id: config.ffmpeg_build_id,
                      auto_start: config.auto_start,
                      watchdog_enabled: config.watchdog_enabled,
                      watchdog_retries: config.watchdog_retries,
                    })
                  });
                  if (res.ok) {
                    setShowAddModal(false);
                  } else {
                    const errData = await res.json();
                    alert(`Error creating service: ${errData.detail || 'Unknown error'}`);
                  }
                } catch (err: any) {
                  alert(`Network error creating service: ${err.message || err}`);
                }
              }}
            />
          </div>
        </div>
      )}

      {/* ── Edit Service Modal ── */}
      {editingProcess && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="glass-card w-full max-w-3xl p-8 relative max-h-[90vh] flex flex-col overflow-hidden">
            <button onClick={() => setEditingProcess(null)}
              className="absolute top-6 right-6 w-8 h-8 bg-white/10 rounded-full flex items-center justify-center text-text-secondary hover:text-white hover:bg-white/20 transition-all z-10">✕</button>
            <h3 className="text-2xl font-bold mb-4 flex-shrink-0">EDIT SERVICE: {editingProcess.name.toUpperCase()}</h3>
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
                      alias: config.alias,
                      input_config: config.input_config, output_config: config.output_config,
                      codec_config: config.codec_config, filter_config: config.filter_config,
                      ffmpeg_build_id: config.ffmpeg_build_id,
                      auto_start: config.auto_start,
                      watchdog_enabled: config.watchdog_enabled,
                      watchdog_retries: config.watchdog_retries,
                    })
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
                    body: JSON.stringify(config)
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
          </div>
        </div>
      )}

      {/* ── Preview Modal ── */}
      {selectedProcess && (
        <ProcessPreviewModal
          selectedProcess={selectedProcess}
          telemetry={telemetry}
          logs={logs}
          onClose={() => setSelectedProcess(null)}
          onEditProcess={setEditingProcess}
          onCloneProcess={handleCloneProcess}
          onStartService={handleStartService}
          onStopService={handleStopService}
          onRestartService={handleRestartService}
          API={API}
        />
      )}
    </div>
  );
}

export default App;
