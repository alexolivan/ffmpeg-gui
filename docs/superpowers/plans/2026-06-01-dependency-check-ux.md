# Gestión de Dependencias y UX de FFMPEG Forge - Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a comprehensive environment dependency system that lists required/optional tools, warns before failed builds, and dynamically generates install commands based on the user's Linux distribution.

**Architecture:** 
1. Enrich the Backend API (`/builds/check` in FastAPI) to check additional packages (`libssl-dev`, `libx264-dev`, `libx265-dev`) via `pkg-config`, and return a fully detailed schema categorized into required/optional with description strings.
2. In the Frontend, display reactive warnings on the Build Creation modal if option checkboxes are clicked for which dependencies are missing.
3. Replace the compact ENV CHECK bar on the tools page with a sleek environment health panel.
4. Render a fully featured "System Environment & Dependencies" dashboard/modal with package categorizations and a dynamic copyable command-line command generator based on Linux distributions.

**Tech Stack:** FastAPI, PyPkgConfig/subprocess, React, TailwindCSS, TypeScript.

---

## Files to Create/Modify
- Create: `.agent/current_state.json` (Internal Checkpoint State)
- Create: `backend/tests/scratch_test_deps.py` (Scratch automation verification script)
- Modify: `backend/core/build_manager.py` (dependency validation backend logic)
- Modify: `frontend/src/components/BuildFormModal.tsx` (reactive warning layout)
- Modify: `frontend/src/App.tsx` (state integration, environment health panel, distro command generator modal)

---

### Task 1: Checkpoint Setup
- [ ] **Step 1: Create the checkpoint file**
  Create the `.agent/current_state.json` file in the project root.
  ```json
  {
    "current_task": "Implement system dependency check improvements and interactive copyable command helper",
    "step_active": "Task 2: Backend Check Logic Upgrade",
    "files_touching": ["backend/core/build_manager.py"],
    "status": "IN_PROGRESS"
  }
  ```

---

### Task 2: Backend Check Logic Upgrade (`build_manager.py`)

**Files:**
- Modify: `backend/core/build_manager.py:42-73`

- [ ] **Step 1: Replace check_dependencies in build_manager.py**
  Replace the dependency checking method in `backend/core/build_manager.py` to check for `libx264`, `libx265`, and `libssl` via `pkg-config`, categorizing each package into `required` or `optional` with explicit user-friendly descriptions.

```python
    def check_dependencies(self) -> dict:
        """Check that required system build tools are available."""
        self.logger.info("Starting dependency check...")
        
        # Tools validated via shutil.which
        core_deps = {
            "cmake": {"type": "required", "description": "Sistema de generación de builds (CMake)"},
            "git": {"type": "required", "description": "Control de versiones para descargar código fuente"},
            "make": {"type": "required", "description": "Herramienta de automatización de compilación"},
            "gcc": {"type": "required", "description": "Compilador de código C/C++"},
            "pkg-config": {"type": "required", "description": "Gestor de metadatos de bibliotecas de desarrollo"},
        }
        
        results = {}
        for name, info in core_deps.items():
            results[name] = {
                "installed": shutil.which(name) is not None,
                "type": info["type"],
                "description": info["description"]
            }

        # Check yasm/nasm assembler
        yasm_nasm_installed = (
            shutil.which("yasm") is not None
            or shutil.which("nasm") is not None
        )
        results["yasm/nasm"] = {
            "installed": yasm_nasm_installed,
            "type": "required",
            "description": "Ensamblador para optimizaciones de rendimiento x86 (yasm o nasm)"
        }

        # Libraries checked via pkg-config
        libs = {
            "libx264": {"pkg": "x264", "type": "required", "description": "Biblioteca para codificación H.264/AVC (libx264)"},
            "libx265": {"pkg": "x265", "type": "required", "description": "Biblioteca para codificación H.265/HEVC (libx265)"},
            "libssl": {"pkg": "openssl", "type": "optional", "description": "Biblioteca criptográfica OpenSSL (libssl-dev)"},
            "libva": {"pkg": "libva", "type": "optional", "description": "Aceleración de decodificación/codificación VAAPI"},
            "libdrm": {"pkg": "libdrm", "type": "optional", "description": "Acceso directo al subsistema de renderizado GPU (DRI)"}
        }

        has_pkg_config = results.get("pkg-config", {}).get("installed", False)

        for name, info in libs.items():
            installed = False
            if has_pkg_config:
                try:
                    cmd = ["pkg-config", "--exists", info["pkg"]]
                    subprocess.run(cmd, capture_output=True, check=True)
                    installed = True
                except Exception:
                    installed = False
            
            results[name] = {
                "installed": installed,
                "type": info["type"],
                "description": info["description"],
                "pkg_config_name": info["pkg"]
            }

        # Calculate all_required_met
        all_required_met = all(
            item["installed"]
            for item in results.values()
            if item["type"] == "required"
        )

        payload = {
            "dependencies": results,
            "all_required_met": all_required_met
        }
        self.logger.info(f"Check results payload: {payload}")
        return payload
```

- [ ] **Step 2: Create a scratch verification script**
  Create `backend/tests/scratch_test_deps.py` to programmatically verify that the API returns the correct dependency dictionary format.
  
```python
import sys
import os

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.build_manager import BuildManager

def test_check():
    bm = BuildManager(builds_root="./ffmpeg_builds")
    res = bm.check_dependencies()
    print("KEYS:", res.keys())
    assert "dependencies" in res
    assert "all_required_met" in res
    assert "libx264" in res["dependencies"]
    assert "libssl" in res["dependencies"]
    assert "type" in res["dependencies"]["libx264"]
    print("SUCCESS: check_dependencies matches the requested payload specs!")

if __name__ == "__main__":
    test_check()
```

- [ ] **Step 3: Run the scratch verification script**
  Run the test script in the virtual environment.
  Run: `venv/bin/python backend/tests/scratch_test_deps.py`
  Expected: Prints "SUCCESS: check_dependencies matches the requested payload specs!" and exits with code 0.

- [ ] **Step 4: Commit the backend changes**
  Update the checkpoint to `Task 3: BuildFormModal UI Integration` and run:
  ```bash
  git add backend/core/build_manager.py
  git commit -m "feat(backend): upgrade check_dependencies endpoint to return rich metadata for optional/required libs"
  ```

---

### Task 3: Reactive Warnings in BuildFormModal (`BuildFormModal.tsx`)

**Files:**
- Modify: `frontend/src/components/BuildFormModal.tsx:4-93`
- Modify: `frontend/src/components/BuildFormModal.tsx:128-158`

- [ ] **Step 1: Update BuildFormModalProps interface**
  Extend `BuildFormModalProps` to accept the `buildDeps` object:
```typescript
interface BuildFormModalProps {
  editBuild: BuildProfile | null
  onClose: () => void
  onSubmit: (data: BuildFormData) => void
  buildDeps: any // <-- Added prop
}
```

- [ ] **Step 2: Update BuildFormModal definition and render warnings**
  Update the function parameter destructuring to include `buildDeps`, then insert high-visibility warn banners in the options grids for LibSRT and VAAPI options.

For LibSRT box:
```typescript
              {/* LibSRT - Combined */}
              <div className={`p-3 bg-white/5 rounded-xl border ${options.libsrt ? 'border-brand-orange/40' : 'border-white/5'} transition-all`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold">LibSRT Support</span>
                  <input type="checkbox" className="w-4 h-4 accent-brand-orange" checked={options.libsrt} onChange={e => setOptions({...options, libsrt: e.target.checked})} />
                </div>
                {options.libsrt && (
                  <div className="space-y-2">
                    <select
                      className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-xs focus:border-brand-orange outline-none animate-in fade-in duration-300"
                      value={srtVersion}
                      onChange={e => setSrtVersion(e.target.value)}
                    >
                      {srtTags.map(tag => (
                        <option key={tag} value={tag}>{tag}</option>
                      ))}
                    </select>
                    {buildDeps?.dependencies?.libssl?.installed === false && (
                      <div className="bg-brand-orange/10 border border-brand-orange/20 text-brand-orange text-[9px] p-2 rounded-lg leading-snug font-bold">
                        ⚠️ Falta libssl (OpenSSL). Habilita el paquete de desarrollo en el sistema para evitar fallos en la compilación de LibSRT.
                      </div>
                    )}
                  </div>
                )}
              </div>
```

For VAAPI box:
```typescript
              {/* VAAPI */}
              <div className={`p-3 bg-white/5 rounded-xl border ${options.vaapi ? 'border-brand-orange/40' : 'border-white/5'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold">VAAPI HW Accel</span>
                  <input type="checkbox" className="w-4 h-4 accent-brand-orange" checked={options.vaapi} onChange={e => setOptions({...options, vaapi: e.target.checked})} />
                </div>
                <p className="text-[9px] text-text-secondary leading-tight mb-2">Intel/AMD GPU encoding.</p>
                {options.vaapi && (buildDeps?.dependencies?.libva?.installed === false || buildDeps?.dependencies?.libdrm?.installed === false) && (
                  <div className="bg-brand-orange/10 border border-brand-orange/20 text-brand-orange text-[9px] p-2 rounded-lg leading-snug font-bold">
                    ⚠️ Faltan dependencias de VAAPI (libva/libdrm). Instala las cabeceras de desarrollo para usar aceleración por GPU Intel/AMD.
                  </div>
                )}
              </div>
```

- [ ] **Step 3: Update App.tsx usage of BuildFormModal**
  Update line 1253 in `frontend/src/App.tsx` where `<BuildFormModal>` is rendered to pass `buildDeps`:
```typescript
            {/* Build Form Modal */}
            {showBuildForm && (
              <BuildFormModal
                editBuild={editingBuild}
                onClose={() => { setShowBuildForm(false); setEditingBuild(null) }}
                onSubmit={editingBuild ? handleUpdateBuild : handleCreateBuild}
                buildDeps={buildDeps}
              />
            )}
```

- [ ] **Step 4: Commit BuildFormModal changes**
  Update the checkpoint to `Task 4: Interactive Dashboard and Command Generator Modal in App.tsx` and run:
  ```bash
  git add frontend/src/components/BuildFormModal.tsx
  git commit -m "feat(frontend): render high-visibility dynamic dependency warnings inside BuildFormModal based on selected options"
  ```

---

### Task 4: Environment Health Panel & Interactive Command Generator (`App.tsx`)

**Files:**
- Modify: `frontend/src/App.tsx:1202-1221` (Environment check layout replacement)
- Modify: `frontend/src/App.tsx` (Add environment status detail modal)

- [ ] **Step 1: Declare state variables for Environment Modal**
  Add state variables at the beginning of the `App` component in `frontend/src/App.tsx` (near line 48):
```typescript
  const [showEnvModal, setShowEnvModal] = useState(false)
  const [selectedLinuxDistro, setSelectedLinuxDistro] = useState<'debian' | 'fedora' | 'arch'>('debian')
```

- [ ] **Step 2: Replace ENV CHECK block in App.tsx**
  Replace lines 1202-1221 in `frontend/src/App.tsx` with a premium, responsive health status card that toggles `showEnvModal`:

```typescript
            {/* Health environment badge & detail control */}
            <div className="glass-card p-6 mb-8 bg-white/2 border border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-xl">
                  {checkStatus === 'loading' ? '⏳' : buildDeps?.all_required_met ? '✓' : '⚠️'}
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
                ⚙️ Gestionar Dependencias
              </button>
            </div>
```

- [ ] **Step 3: Append the Interactive Environment Status Modal**
  Add the modal code near the bottom of `frontend/src/App.tsx`, right before the closing main `div` (e.g. before the final validation result modal or line 1283):

```typescript
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
                    🛠️ ESTADO DEL ENTORNO DE COMPILACIÓN
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
                        .filter(([name, info]: any) => info.type === 'required' && !info.installed)
                        .map(([name]) => name);

                      const missingOptional = Object.entries(buildDeps?.dependencies || {})
                        .filter(([name, info]: any) => info.type === 'optional' && !info.installed)
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
                            <span className="text-[10px] font-black uppercase text-brand-orange tracking-wider">🛠️ Comando de Instalación Sugerido</span>
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
                              className="shrink-0 p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs hover:scale-105 transition-all active:scale-95"
                              title="Copiar Comando"
                            >
                              📋
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
```

- [ ] **Step 4: Verify the page builds correctly**
  Run the frontend developer build command to check for any lint/build errors.
  Run: `npm run build` in the `frontend` subdirectory.
  Expected: Production bundle compiles cleanly without any TypeScript errors.

- [ ] **Step 5: Commit the frontend improvements**
  Set checkpoint state as `COMPLETED` and commit the UI changes:
  ```bash
  git add frontend/src/App.tsx
  git commit -m "feat(frontend): implement premium Environment Health status panel, details modal and distribution command-line installer generator"
  ```

---

## Plan Verification

- **Automatic backend test:** Running `venv/bin/python backend/tests/scratch_test_deps.py` will guarantee the payload schema matches spec requirements.
- **Frontend TS compiler:** `npm run build` inside `frontend` validates the integrity of typescript code.
