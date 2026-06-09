import { useState } from 'react';
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

  // ── Render Auth Screen ──────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-white p-4">
        <div className="glass-card w-full max-w-md p-10 border-brand-orange/30 animate-in zoom-in duration-500">
          <div className="w-20 h-20 bg-brand-orange rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-brand-orange/20">
            <span className="text-black font-black text-3xl">{settings.logo_text}</span>
          </div>
          <h1 className="text-2xl font-bold text-center mb-2 uppercase tracking-tighter">{settings.node_name}</h1>
          <p className="text-text-secondary text-center text-sm mb-10">Access restricted. Enter node password.</p>
          
          <div className="space-y-6">
            <input 
              type="password" 
              className={`w-full bg-white/5 border ${isLoginError ? 'border-red-500' : 'border-white/10'} rounded-2xl p-4 text-center text-2xl tracking-[0.5em] outline-none focus:border-brand-orange transition-all`}
              value={loginPass}
              onChange={e => setLoginPass(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              autoFocus
            />
            {isLoginError && <p className="text-red-500 text-center text-xs font-bold animate-shake">INVALID PASSWORD</p>}
            <button 
              onClick={handleLogin}
              className="w-full py-4 bg-brand-orange text-black font-black rounded-2xl hover:scale-[1.02] transition-all uppercase tracking-widest"
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
                await fetch(`${API}/processes`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name: config.name, type: 'service',
                    input_config: config.input_config, output_config: config.output_config,
                    codec_config: config.codec_config, filter_config: config.filter_config,
                    ffmpeg_build_id: config.ffmpeg_build_id,
                    auto_start: config.auto_start,
                    watchdog_enabled: config.watchdog_enabled,
                    watchdog_retries: config.watchdog_retries,
                  })
                });
                setShowAddModal(false);
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
                await fetch(`${API}/processes/${editingProcess.id}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name: config.name,
                    input_config: config.input_config, output_config: config.output_config,
                    codec_config: config.codec_config, filter_config: config.filter_config,
                    ffmpeg_build_id: config.ffmpeg_build_id,
                    auto_start: config.auto_start,
                    watchdog_enabled: config.watchdog_enabled,
                    watchdog_retries: config.watchdog_retries,
                  })
                });
                setEditingProcess(null);
              }}
              onSaveAs={async (config) => {
                await fetch(`${API}/processes`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(config)
                });
                setEditingProcess(null);
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
