import { useState, useEffect } from 'react'
import type { BuildProfile } from './BuildProfileCard'

interface BuildFormModalProps {
  editBuild: BuildProfile | null
  onClose: () => void
  onSubmit: (data: BuildFormData) => void
  buildDeps: any
}

export interface BuildFormData {
  name: string
  ffmpeg_version: string
  srt_version: string | null
  build_options: Record<string, boolean>
  sdk_paths: Record<string, string>
}

const API_BASE = 'http://localhost:8000'

export default function BuildFormModal({ editBuild, onClose, onSubmit, buildDeps }: BuildFormModalProps) {
  const [name, setName] = useState(editBuild?.name || '')
  const [ffmpegVersion, setFfmpegVersion] = useState(editBuild?.ffmpeg_version || '')
  const [srtVersion, setSrtVersion] = useState(editBuild?.srt_version || '')
  
  const [options, setOptions] = useState(editBuild?.build_options || { 
    libsrt: true, 
    vaapi: false, 
    ndi: false,
    decklink: false,
    nvenc: false
  })
  
  const [sdkPaths, setSdkPaths] = useState(editBuild?.sdk_paths || { 
    decklink: '', 
    nvenc: '',
    ndi: ''
  })

  const [ffmpegTags, setFfmpegTags] = useState<string[]>([])
  const [srtTags, setSrtTags] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isEditing = editBuild !== null

  useEffect(() => {
    const fetchTags = async () => {
      try {
        const [ffRes, srtRes] = await Promise.all([
          fetch(`${API_BASE}/builds/tags/ffmpeg`),
          fetch(`${API_BASE}/builds/tags/srt`),
        ])
        const ffData = await ffRes.json()
        const srtData = await srtRes.json()
        setFfmpegTags(ffData.tags || [])
        setSrtTags(srtData.tags || [])

        if (!isEditing) {
          if (ffData.tags?.length > 0 && !ffmpegVersion) setFfmpegVersion(ffData.tags[0])
          if (srtData.tags?.length > 0 && !srtVersion) setSrtVersion(srtData.tags[0])
        }
      } catch (err) {
        console.error('Failed to load tags:', err)
      }
    }
    fetchTags()
  }, [])

  const handleSubmit = async () => {
    if (!name.trim() || !ffmpegVersion) return
    setIsSubmitting(true)
    await onSubmit({
      name: name.trim(),
      ffmpeg_version: ffmpegVersion,
      srt_version: options.libsrt ? srtVersion || null : null,
      build_options: options,
      sdk_paths: sdkPaths,
    })
    setIsSubmitting(false)
  }

  const isValid = name.trim().length > 0 && ffmpegVersion.length > 0

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-hidden">
      <div className="glass-card w-full max-w-2xl flex flex-col border-brand-orange/20 max-h-[90vh] shadow-2xl relative overflow-hidden">
        
        {/* Header - Sticky */}
        <div className="p-5 border-b border-white/10 flex justify-between items-center bg-white/5 shrink-0">
          <h3 className="text-xl font-bold tracking-tight">
            {isEditing ? 'EDIT PROFILE' : 'NEW BUILD PROFILE'}
          </h3>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors text-text-secondary hover:text-white">✕</button>
        </div>

        {/* Content - Scrollable */}
        <div className="p-6 overflow-y-auto custom-scrollbar space-y-6">
          
          {/* Identity & Core Version */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-1">
              <label className="text-[9px] text-text-secondary uppercase tracking-widest mb-1 block font-bold">Profile Name</label>
              <input
                type="text"
                placeholder="e.g. Production 12G"
                className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm focus:border-brand-orange outline-none"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
            <div className="col-span-1">
              <label className="text-[9px] text-text-secondary uppercase tracking-widest mb-1 block font-bold">FFmpeg Tag</label>
              <select
                className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-sm focus:border-brand-orange outline-none"
                value={ffmpegVersion}
                onChange={e => setFfmpegVersion(e.target.value)}
              >
                {ffmpegTags.map(tag => (
                  <option key={tag} value={tag}>{tag}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-[9px] text-text-secondary uppercase tracking-widest block font-bold">Hardware & Protocol Support</label>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              
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

              {/* DeckLink */}
              <div className={`p-3 bg-white/5 rounded-xl border ${options.decklink ? 'border-brand-orange/40' : 'border-white/5'} col-span-full`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold">Blackmagic DeckLink</span>
                  <input type="checkbox" className="w-4 h-4 accent-brand-orange" checked={options.decklink} onChange={e => setOptions({...options, decklink: e.target.checked})} />
                </div>
                {options.decklink && (
                  <div className="space-y-1 mt-1 animate-in slide-in-from-top-2 duration-300">
                    <input
                      type="text"
                      placeholder="DeckLink SDK Path (/include)"
                      className={`w-full bg-black/40 border ${!sdkPaths.decklink ? 'border-red-500/50' : 'border-white/10'} rounded-lg p-2 text-[10px] font-mono focus:border-brand-orange outline-none transition-all`}
                      value={sdkPaths.decklink || ''}
                      onChange={e => setSdkPaths({ ...sdkPaths, decklink: e.target.value })}
                    />
                    {!sdkPaths.decklink && <p className="text-[9px] text-red-400 pl-1 font-bold">⚠ Path required for Blackmagic support</p>}
                  </div>
                )}
              </div>

              {/* NVENC */}
              <div className={`p-3 bg-white/5 rounded-xl border ${options.nvenc ? 'border-brand-orange/40' : 'border-white/5'} col-span-full`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold">NVIDIA NVENC</span>
                  <input type="checkbox" className="w-4 h-4 accent-brand-orange" checked={options.nvenc} onChange={e => setOptions({...options, nvenc: e.target.checked})} />
                </div>
                {options.nvenc && (
                  <div className="space-y-1 mt-1 animate-in slide-in-from-top-2 duration-300">
                    <input
                      type="text"
                      placeholder="NVENC Headers Path"
                      className={`w-full bg-black/40 border ${!sdkPaths.nvenc ? 'border-red-500/50' : 'border-white/10'} rounded-lg p-2 text-[10px] font-mono focus:border-brand-orange outline-none transition-all`}
                      value={sdkPaths.nvenc || ''}
                      onChange={e => setSdkPaths({ ...sdkPaths, nvenc: e.target.value })}
                    />
                    {!sdkPaths.nvenc && <p className="text-[9px] text-red-400 pl-1 font-bold">⚠ Path required for NVIDIA encoding</p>}
                  </div>
                )}
              </div>

              {/* NDI */}
              <div className={`p-3 bg-white/5 rounded-xl border ${options.ndi ? 'border-brand-orange/40' : 'border-white/5'} col-span-full`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold">NewTek NDI®</span>
                  <input type="checkbox" className="w-4 h-4 accent-brand-orange" checked={options.ndi} onChange={e => setOptions({...options, ndi: e.target.checked})} />
                </div>
                {options.ndi && (
                  <div className="space-y-1 mt-1 animate-in slide-in-from-top-2 duration-300">
                    <input
                      type="text"
                      placeholder="NDI SDK Path"
                      className={`w-full bg-black/40 border ${!sdkPaths.ndi ? 'border-red-500/50' : 'border-white/10'} rounded-lg p-2 text-[10px] font-mono focus:border-brand-orange outline-none transition-all`}
                      value={sdkPaths.ndi || ''}
                      onChange={e => setSdkPaths({ ...sdkPaths, ndi: e.target.value })}
                    />
                    {!sdkPaths.ndi && <p className="text-[9px] text-red-400 pl-1 font-bold">⚠ Path required for NDI stream support</p>}
                  </div>
                )}
              </div>

            </div>
          </div>
        </div>

        {/* Footer - Sticky */}
        <div className="p-5 border-t border-white/10 bg-white/5 flex gap-3 shrink-0">
          <button onClick={onClose}
            className="flex-1 py-3 text-xs font-bold bg-white/5 rounded-lg border border-white/5 hover:bg-white/10">CANCEL</button>
          <button
            onClick={handleSubmit}
            disabled={!isValid || isSubmitting}
            className={`flex-1 py-3 text-xs font-black tracking-widest rounded-lg ${isValid && !isSubmitting ? 'bg-brand-orange text-black hover:scale-[1.01] shadow-lg shadow-brand-orange/10' : 'bg-white/5 text-white/20'} transition-all`}
          >
            {isSubmitting ? 'PROCESSING...' : isEditing ? 'UPDATE PROFILE' : 'CREATE PROFILE'}
          </button>
        </div>
      </div>
    </div>
  )
}
