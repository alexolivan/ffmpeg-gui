import { useState, useEffect, useRef } from 'react'
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
  auto_clean: boolean
}

const API_BASE = '';

export default function BuildFormModal({ editBuild, onClose, onSubmit, buildDeps }: BuildFormModalProps) {
  const [name, setName] = useState(editBuild?.name || '')
  const [ffmpegVersion, setFfmpegVersion] = useState(editBuild?.ffmpeg_version || '')
  const [srtVersion, setSrtVersion] = useState(editBuild?.srt_version || '')
  const [autoClean, setAutoClean] = useState(editBuild?.auto_clean || false)
  const [activeTab, setActiveTab] = useState<'general' | 'gpu' | 'sdks'>('general')

  const [options, setOptions] = useState(editBuild?.build_options || { 
    libsrt: true, 
    vaapi: false, 
    ndi: false,
    decklink: false,
    nvenc: false,
    cuda_filters: false,
    whip: false
  })
  
  const [sdkPaths, setSdkPaths] = useState<Record<string, string>>(editBuild?.sdk_paths || { 
    decklink: '', 
    ndi: '',
    ndi_patch_file: '',
    nvenc_headers: 'auto'
  })

  const [ffmpegTags, setFfmpegTags] = useState<string[]>([])
  const [srtTags, setSrtTags] = useState<string[]>([])
  const [nvencTags, setNvencTags] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Dynamic SDK lists
  const [decklinkSdks, setDecklinkSdks] = useState<{ version: string; path: string }[]>([])
  const [ndiSdks, setNdiSdks] = useState<{ version: string; path: string }[]>([])

  // Dynamic Patch list
  interface PatchItem {
    filename: string;
    display_name: string;
    ffmpeg_version_major: string;
    source: string;
  }
  const [patches, setPatches] = useState<PatchItem[]>([])
  const [uploadingPatch, setUploadingPatch] = useState(false)
  const [uploadPatchError, setUploadPatchError] = useState('')
  const [showAddPatchForm, setShowAddPatchForm] = useState(false)
  const [newPatchDisplayName, setNewPatchDisplayName] = useState('')
  const [newPatchFfmpegVersion, setNewPatchFfmpegVersion] = useState('7')
  const [selectedPatchFile, setSelectedPatchFile] = useState<File | null>(null)

  // Upload UIs states
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({})
  const [uploadingSdk, setUploadingSdk] = useState<Record<string, boolean>>({})
  const [uploadError, setUploadError] = useState<Record<string, string>>({})

  // Refs for file inputs
  const decklinkInputRef = useRef<HTMLInputElement>(null)
  const ndiInputRef = useRef<HTMLInputElement>(null)
  const patchInputRef = useRef<HTMLInputElement>(null)

  const isEditing = editBuild !== null

  const fetchPatches = async () => {
    try {
      const res = await fetch(`${API_BASE}/system/patches`)
      const data = await res.json()
      setPatches(data)
    } catch (err) {
      console.error('Failed to fetch patches:', err)
    }
  }

  // Fetch Tags and SDKs
  const fetchSdks = async (sdkType: 'decklink' | 'ndi') => {
    try {
      const res = await fetch(`${API_BASE}/sdks/${sdkType}`)
      const data = await res.json()
      if (sdkType === 'decklink') {
        setDecklinkSdks(data)
        // If not editing and we have SDKs available, default to the latest one
        if (!isEditing && data.length > 0 && !sdkPaths.decklink) {
          setSdkPaths(prev => ({ ...prev, decklink: data[0].version }))
        }
      } else {
        setNdiSdks(data)
        if (!isEditing && data.length > 0 && !sdkPaths.ndi) {
          setSdkPaths(prev => ({ ...prev, ndi: data[0].version }))
        }
      }
    } catch (err) {
      console.error(`Failed to fetch ${sdkType} SDKs:`, err)
    }
  }

  useEffect(() => {
    const fetchTags = async () => {
      try {
        const [ffRes, srtRes, nvencRes] = await Promise.all([
          fetch(`${API_BASE}/builds/tags/ffmpeg`),
          fetch(`${API_BASE}/builds/tags/srt`),
          fetch(`${API_BASE}/builds/tags/nvenc`),
        ])
        const ffData = await ffRes.json()
        const srtData = await srtRes.json()
        const nvencData = await nvencRes.json()
        setFfmpegTags(ffData.tags || [])
        setSrtTags(srtData.tags || [])
        setNvencTags(nvencData.tags || [])

        if (!isEditing) {
          if (ffData.tags?.length > 0 && !ffmpegVersion) setFfmpegVersion(ffData.tags[0])
          if (srtData.tags?.length > 0 && !srtVersion) setSrtVersion(srtData.tags[0])
        }

        if (nvencData.tags?.length > 0) {
          setSdkPaths(prev => {
            const currentVal = prev.nvenc_headers
            if (!currentVal || currentVal === 'auto') {
              return { ...prev, nvenc_headers: nvencData.tags[0] }
            }
            return prev
          })
        }
      } catch (err) {
        console.error('Failed to load tags:', err)
      }
    }
    fetchTags()
    fetchSdks('decklink')
    fetchSdks('ndi')
    fetchPatches()
  }, [])

  // File Upload logic using raw XMLHttpRequest for progress tracking
  const handleSdkUpload = (file: File, sdkType: 'decklink' | 'ndi') => {
    setUploadingSdk(prev => ({ ...prev, [sdkType]: true }))
    setUploadProgress(prev => ({ ...prev, [sdkType]: 0 }))
    setUploadError(prev => ({ ...prev, [sdkType]: '' }))

    const formData = new FormData()
    formData.append('file', file)
    formData.append('sdk_type', sdkType)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE}/sdks/upload`)

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentage = Math.round((event.loaded / event.total) * 100)
        setUploadProgress(prev => ({ ...prev, [sdkType]: percentage }))
      }
    }

    xhr.onload = () => {
      setUploadingSdk(prev => ({ ...prev, [sdkType]: false }))
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText)
          if (response.success) {
            // Update selected SDK path to the version returned from backend
            setSdkPaths(prev => ({ ...prev, [sdkType]: response.version }))
            fetchSdks(sdkType)
          } else {
            setUploadError(prev => ({ ...prev, [sdkType]: response.error || 'Upload failed' }))
          }
        } catch (e) {
          setUploadError(prev => ({ ...prev, [sdkType]: 'Failed to parse server response' }))
        }
      } else {
        try {
          const response = JSON.parse(xhr.responseText)
          setUploadError(prev => ({ ...prev, [sdkType]: response.detail || 'Internal server error' }))
        } catch (e) {
          setUploadError(prev => ({ ...prev, [sdkType]: `Server returned code ${xhr.status}` }))
        }
      }
    }

    xhr.onerror = () => {
      setUploadingSdk(prev => ({ ...prev, [sdkType]: false }))
      setUploadError(prev => ({ ...prev, [sdkType]: 'Network connection error' }))
    }

    xhr.send(formData)
  }

  const handlePatchUpload = async () => {
    if (!selectedPatchFile) return
    setUploadingPatch(true)
    setUploadPatchError('')
    
    const formData = new FormData()
    formData.append('file', selectedPatchFile)
    formData.append('display_name', newPatchDisplayName || selectedPatchFile.name)
    formData.append('ffmpeg_version_major', newPatchFfmpegVersion)
    
    try {
      const res = await fetch(`${API_BASE}/system/patches/upload`, {
        method: 'POST',
        body: formData
      })
      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.detail || 'Upload failed')
      }
      const data = await res.json()
      await fetchPatches()
      setSdkPaths(prev => ({ ...prev, ndi_patch_file: data.patch.filename }))
      setSelectedPatchFile(null)
      setNewPatchDisplayName('')
      setShowAddPatchForm(false)
    } catch (err: any) {
      console.error('Failed to upload patch:', err)
      setUploadPatchError(err.message || 'Upload failed')
    } finally {
      setUploadingPatch(false)
    }
  }

  const handleSubmit = async () => {
    if (!name.trim() || !ffmpegVersion) return
    setIsSubmitting(true)
    
    // Clean paths object based on enabled options
    const finalSdkPaths: Record<string, string> = {}
    if (options.decklink && sdkPaths.decklink) {
      finalSdkPaths.decklink = sdkPaths.decklink
    }
    if (options.ndi && sdkPaths.ndi) {
      finalSdkPaths.ndi = sdkPaths.ndi
      if (sdkPaths.ndi_patch_file) {
        finalSdkPaths.ndi_patch_file = sdkPaths.ndi_patch_file
      }
    }
    if (options.nvenc && sdkPaths.nvenc_headers) {
      finalSdkPaths.nvenc_headers = sdkPaths.nvenc_headers
    }
    if (options.vaapi && sdkPaths.vaapi) {
      finalSdkPaths.vaapi = sdkPaths.vaapi
    }

    await onSubmit({
      name: name.trim(),
      ffmpeg_version: ffmpegVersion,
      srt_version: options.libsrt ? srtVersion || null : null,
      build_options: options,
      sdk_paths: finalSdkPaths,
      auto_clean: autoClean,
    })
    setIsSubmitting(false)
  }

  const isValid = name.trim().length > 0 && 
                  ffmpegVersion.length > 0 && 
                  (!options.decklink || !!sdkPaths.decklink) && 
                  (!options.ndi || !!sdkPaths.ndi) &&
                  (!options.nvenc || !!sdkPaths.nvenc_headers) &&
                  (!options.cuda_filters || (buildDeps?.dependencies?.clang?.installed !== false && buildDeps?.dependencies?.['nvidia-cuda-dev']?.installed !== false))

  // Drag and Drop events
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = (e: React.DragEvent, sdkType: 'decklink' | 'ndi') => {
    e.preventDefault()
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0]
      if (file.name.endsWith('.zip') || file.name.endsWith('.tar.gz') || file.name.endsWith('.tgz') || file.name.endsWith('.tar')) {
        handleSdkUpload(file, sdkType)
      } else {
        setUploadError(prev => ({ ...prev, [sdkType]: 'Formato de archivo inválido. Usa (.zip, .tar.gz)' }))
      }
    }
  }
  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-hidden">
      <div className="glass-card w-full max-w-2xl flex flex-col border-brand-orange/20 max-h-[95vh] shadow-2xl relative overflow-hidden">
        
        {/* Header - Sticky */}
        <div className="p-3.5 border-b border-white/10 flex justify-between items-center bg-white/5 shrink-0">
          <h3 className="text-sm font-bold tracking-wide">
            {isEditing ? 'EDIT PROFILE' : 'NEW BUILD PROFILE'}
          </h3>
          <button onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors text-text-secondary hover:text-white text-xs">✕</button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex gap-1 px-4 py-2 border-b border-white/10 bg-white/5 shrink-0">
          {[
            { id: 'general', label: 'General' },
            { id: 'gpu', label: 'Aceleración GPU' },
            { id: 'sdks', label: 'SDKs & Protocolos' },
          ].map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id as any)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                activeTab === t.id
                  ? 'bg-white/10 text-white'
                  : 'text-text-secondary hover:bg-white/5 hover:text-white/70'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content - Scrollable */}
        <div className="p-4 overflow-y-auto custom-scrollbar space-y-4 max-h-[60vh]">
          
          {activeTab === 'general' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              {/* Identity & Core Version */}
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-1">
                  <label className="text-[9px] text-text-secondary uppercase tracking-widest mb-1 block font-bold">Profile Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Production 12G"
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs focus:border-brand-orange outline-none"
                    value={name}
                    onChange={e => setName(e.target.value)}
                  />
                </div>
                <div className="col-span-1">
                  <label className="text-[9px] text-text-secondary uppercase tracking-widest mb-1 block font-bold">FFmpeg Tag</label>
                  <select
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs focus:border-brand-orange outline-none"
                    value={ffmpegVersion}
                    onChange={e => setFfmpegVersion(e.target.value)}
                  >
                    {ffmpegTags.map(tag => (
                      <option key={tag} value={tag}>{tag}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Auto Clean Option */}
              <div className="p-2 bg-white/5 rounded-lg border border-white/5">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-brand-orange">Limpieza Automática Post-compilación</span>
                    <span className="text-[9px] text-text-secondary leading-tight mt-0.5">
                      Borra el directorio de código fuente (src/) tras compilar, conservando los binarios listos.
                    </span>
                  </div>
                  <input type="checkbox" className="w-3.5 h-3.5 accent-brand-orange" checked={autoClean} onChange={e => setAutoClean(e.target.checked)} />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'gpu' && (
            <div className="space-y-3 animate-in fade-in duration-200">
              <label className="text-[9px] text-text-secondary uppercase tracking-widest block font-bold">Aceleración por Hardware (GPU)</label>
              
              <div className="grid grid-cols-1 gap-2.5">
                {/* VAAPI */}
                <div className={`p-2.5 bg-white/5 rounded-lg border ${options.vaapi ? 'border-brand-orange/40' : 'border-white/5'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold">VAAPI HW Accel</span>
                    <input type="checkbox" className="w-3.5 h-3.5 accent-brand-orange" checked={options.vaapi} onChange={e => setOptions({...options, vaapi: e.target.checked})} />
                  </div>
                  <p className="text-[9px] text-text-secondary leading-tight mb-1.5">Intel/AMD GPU encoding.</p>
                  {options.vaapi && (buildDeps?.dependencies?.libva?.installed === false || buildDeps?.dependencies?.libdrm?.installed === false) && (
                    <div className="bg-brand-orange/10 border border-brand-orange/20 text-brand-orange text-[9px] p-1.5 rounded-lg leading-snug font-bold">
                      ⚠️ Faltan dependencias de VAAPI (libva/libdrm).
                    </div>
                  )}
                </div>

                {/* NVENC */}
                <div className={`p-2.5 bg-white/5 rounded-lg border ${options.nvenc ? 'border-brand-orange/40' : 'border-white/5'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex flex-col">
                      <span className="text-xs font-bold">NVIDIA NVENC (Aceleración GPU)</span>
                      <span className="text-[9px] text-text-secondary leading-tight mt-0.5">
                        Descarga y registro automático de ffnvcodec headers desde GitHub.
                      </span>
                    </div>
                    <input 
                      type="checkbox" 
                      className="w-3.5 h-3.5 accent-brand-orange" 
                      checked={options.nvenc} 
                      onChange={e => {
                        const checked = e.target.checked;
                        setOptions({
                          ...options,
                          nvenc: checked,
                          cuda_filters: checked ? options.cuda_filters : false
                        });
                      }} 
                    />
                  </div>
                  {options.nvenc && (
                    <div className="space-y-1.5 mt-1.5 pt-1.5 border-t border-white/5 animate-in slide-in-from-top-2 duration-300">
                      <label className="text-[8px] text-text-secondary uppercase tracking-widest block font-bold">Cabeceras ffnvcodec (Versión del SDK)</label>
                      <select
                        className="w-full bg-black/40 border border-white/10 rounded-lg p-1.5 text-xs focus:border-brand-orange outline-none"
                        value={sdkPaths.nvenc_headers || ''}
                        onChange={e => setSdkPaths({ ...sdkPaths, nvenc_headers: e.target.value })}
                      >
                        {nvencTags.map(tag => (
                          <option key={tag} value={tag}>{tag}</option>
                        ))}
                      </select>

                      {/* Indented NVIDIA CUDA Filters Checkbox */}
                      <div className="pt-1.5 mt-1.5 border-t border-white/5 space-y-1.5 pl-3">
                        <div className="flex items-center justify-between">
                          <div className="flex flex-col">
                            <span className="text-xs font-semibold">NVIDIA CUDA Filters (yadif_cuda, scale_npp)</span>
                            <span className="text-[9px] text-text-secondary leading-tight mt-0.5">
                              Habilita procesamiento de filtros acelerados por hardware en VRAM.
                            </span>
                          </div>
                          <input 
                            type="checkbox" 
                            className="w-3.5 h-3.5 accent-brand-orange" 
                            checked={options.cuda_filters} 
                            onChange={e => setOptions({...options, cuda_filters: e.target.checked})} 
                          />
                        </div>
                        {options.cuda_filters && (buildDeps?.dependencies?.clang?.installed === false || buildDeps?.dependencies?.['nvidia-cuda-dev']?.installed === false) && (
                          <div className="bg-brand-orange/10 border border-brand-orange/20 text-brand-orange text-[9px] p-1.5 rounded-lg leading-snug font-bold">
                            ⚠️ Faltan dependencias de CUDA Filters:
                            {buildDeps?.dependencies?.clang?.installed === false && ' [clang]'}
                            {buildDeps?.dependencies?.['nvidia-cuda-dev']?.installed === false && ' [nvidia-cuda-dev (npp.h)]'}.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'sdks' && (
            <div className="space-y-3 animate-in fade-in duration-200">
              <label className="text-[9px] text-text-secondary uppercase tracking-widest block font-bold">SDKs & Protocolos de Terceros</label>
              
              <div className="space-y-3">
                {/* LibSRT - Combined */}
                <div className={`p-2.5 bg-white/5 rounded-lg border ${options.libsrt ? 'border-brand-orange/40' : 'border-white/5'} transition-all`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold">LibSRT Support</span>
                    <input type="checkbox" className="w-3.5 h-3.5 accent-brand-orange" checked={options.libsrt} onChange={e => setOptions({...options, libsrt: e.target.checked})} />
                  </div>
                  {options.libsrt && (
                    <div className="space-y-1.5">
                      <select
                        className="w-full bg-black/40 border border-white/10 rounded-lg p-1.5 text-xs focus:border-brand-orange outline-none animate-in fade-in duration-300"
                        value={srtVersion || ''}
                        onChange={e => setSrtVersion(e.target.value)}
                      >
                        {srtTags.map(tag => (
                          <option key={tag} value={tag}>{tag}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* WebRTC WHIP */}
                <div className={`p-2.5 bg-white/5 rounded-lg border ${options.whip ? 'border-brand-orange/40' : 'border-white/5'} transition-all`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold">WebRTC WHIP Support</span>
                    <input type="checkbox" className="w-3.5 h-3.5 accent-brand-orange" checked={options.whip} onChange={e => setOptions({...options, whip: e.target.checked})} />
                  </div>
                  {options.whip && (
                    <div className="space-y-1.5 mt-1 animate-in slide-in-from-top-2 duration-300">
                      <p className="text-[10px] text-text-secondary leading-snug">
                        Habilita el muxer nativo de WHIP para streaming en tiempo real.
                      </p>
                    </div>
                  )}
                </div>

                {/* DeckLink */}
                <div className={`p-2.5 bg-white/5 rounded-lg border ${options.decklink ? 'border-brand-orange/40' : 'border-white/5'}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold">Blackmagic DeckLink SDK</span>
                    <input type="checkbox" className="w-3.5 h-3.5 accent-brand-orange" checked={options.decklink} onChange={e => setOptions({...options, decklink: e.target.checked})} />
                  </div>
                  {options.decklink && (
                    <div className="space-y-2 mt-1 animate-in slide-in-from-top-2 duration-300">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-2">
                          <label className="text-[8px] text-text-secondary uppercase tracking-widest block mb-0.5 font-bold">Elegir Versión del SDK</label>
                          <select
                            className="w-full bg-black/40 border border-white/10 rounded-lg p-1.5 text-xs focus:border-brand-orange outline-none"
                            value={sdkPaths.decklink || ''}
                            onChange={e => setSdkPaths({ ...sdkPaths, decklink: e.target.value })}
                          >
                            <option value="">-- Seleccionar SDK instalado --</option>
                            {decklinkSdks.map(sdk => (
                              <option key={sdk.version} value={sdk.version}>Versión {sdk.version}</option>
                            ))}
                          </select>
                        </div>
                        <div className="col-span-1 flex items-end">
                          <button
                            type="button"
                            onClick={() => decklinkInputRef.current?.click()}
                            className="w-full py-1.5 bg-white/5 border border-white/10 text-[9px] font-bold rounded-lg hover:bg-white/10 text-center uppercase tracking-wider"
                          >
                            + Subir SDK
                          </button>
                        </div>
                      </div>

                      {/* Hidden input */}
                      <input
                        type="file"
                        ref={decklinkInputRef}
                        className="hidden"
                        accept=".zip,.tar.gz,.tgz,.tar"
                        onChange={e => {
                          if (e.target.files && e.target.files.length > 0) {
                            handleSdkUpload(e.target.files[0], 'decklink')
                          }
                        }}
                      />

                      {/* Drag and drop panel */}
                      <div
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, 'decklink')}
                        className="border border-dashed border-white/10 rounded-lg p-2.5 flex flex-col items-center justify-center bg-black/20 hover:border-brand-orange/40 transition-colors cursor-pointer"
                        onClick={() => decklinkInputRef.current?.click()}
                      >
                        {uploadingSdk.decklink ? (
                          <div className="w-full space-y-1.5 text-center">
                            <span className="text-[9px] uppercase tracking-wider font-bold text-brand-orange animate-pulse">Subiendo y sanitizando SDK...</span>
                            <div className="w-full bg-white/5 rounded-full h-1 overflow-hidden">
                              <div className="bg-brand-orange h-1 rounded-full transition-all duration-100" style={{ width: `${uploadProgress.decklink || 0}%` }}></div>
                            </div>
                            <span className="text-[9px] text-text-secondary font-mono">{uploadProgress.decklink || 0}%</span>
                          </div>
                        ) : (
                          <div className="text-center">
                            <span className="text-[9px] font-bold text-white/70 block">Arrastra el archivo SDK oficial de DeckLink aquí</span>
                            <span className="text-[8px] text-text-secondary block">Formatos: .zip, .tar.gz (&lt;100MB se reducirá automáticamente a ~250KB)</span>
                          </div>
                        )}
                      </div>

                      {uploadError.decklink && (
                        <div className="text-[9px] text-red-400 font-bold bg-red-500/10 border border-red-500/20 p-1.5 rounded-lg">
                          ⚠️ Error: {uploadError.decklink}
                        </div>
                      )}
                      {!sdkPaths.decklink && <p className="text-[9px] text-red-400 pl-1 font-bold">⚠ Se requiere seleccionar o subir un SDK de DeckLink</p>}
                    </div>
                  )}
                </div>

                {/* NDI */}
                <div className={`p-2.5 bg-white/5 rounded-lg border ${options.ndi ? 'border-brand-orange/40' : 'border-white/5'}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold">NewTek NDI® SDK</span>
                    <input type="checkbox" className="w-3.5 h-3.5 accent-brand-orange" checked={options.ndi} onChange={e => setOptions({...options, ndi: e.target.checked})} />
                  </div>
                  {options.ndi && (
                    <div className="space-y-2 mt-1 animate-in slide-in-from-top-2 duration-300">
                      
                      {/* Legal Warning */}
                      <div className="bg-brand-orange/10 border border-brand-orange/30 text-brand-orange text-[9px] p-2 rounded-lg leading-snug font-bold">
                        ⚠️ ADVERTENCIA LEGAL: El SDK de NewTek NDI es propietario. Binario resultante bajo licencia GPL con --enable-nonfree.
                      </div>

                      {buildDeps?.dependencies?.['avahi-daemon']?.installed === false && (
                        <div className="bg-brand-orange/10 border border-brand-orange/20 text-brand-orange text-[9px] p-2 rounded-lg leading-snug font-bold">
                          ⚠️ Runtime de NDI requiere Avahi. Instala 'avahi-daemon' y 'avahi-utils' en el sistema host para que funcione.
                        </div>
                      )}

                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-2">
                          <label className="text-[8px] text-text-secondary uppercase tracking-widest block mb-0.5 font-bold">Elegir Versión del SDK</label>
                          <select
                            className="w-full bg-black/40 border border-white/10 rounded-lg p-1.5 text-xs focus:border-brand-orange outline-none"
                            value={sdkPaths.ndi || ''}
                            onChange={e => setSdkPaths({ ...sdkPaths, ndi: e.target.value })}
                          >
                            <option value="">-- Seleccionar SDK instalado --</option>
                            {ndiSdks.map(sdk => (
                              <option key={sdk.version} value={sdk.version}>Versión {sdk.version}</option>
                            ))}
                          </select>
                        </div>
                        <div className="col-span-1 flex items-end">
                          <button
                            type="button"
                            onClick={() => ndiInputRef.current?.click()}
                            className="w-full py-1.5 bg-white/5 border border-white/10 text-[9px] font-bold rounded-lg hover:bg-white/10 text-center uppercase tracking-wider"
                          >
                            + Subir SDK
                          </button>
                        </div>
                      </div>

                      {/* Hidden input */}
                      <input
                        type="file"
                        ref={ndiInputRef}
                        className="hidden"
                        accept=".zip,.tar.gz,.tgz,.tar"
                        onChange={e => {
                          if (e.target.files && e.target.files.length > 0) {
                            handleSdkUpload(e.target.files[0], 'ndi')
                          }
                        }}
                      />

                      {/* Drag and drop panel */}
                      <div
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, 'ndi')}
                        className="border border-dashed border-white/10 rounded-lg p-2.5 flex flex-col items-center justify-center bg-black/20 hover:border-brand-orange/40 transition-colors cursor-pointer"
                        onClick={() => ndiInputRef.current?.click()}
                      >
                        {uploadingSdk.ndi ? (
                          <div className="w-full space-y-1.5 text-center">
                            <span className="text-[9px] uppercase tracking-wider font-bold text-brand-orange animate-pulse">Subiendo y sanitizando SDK...</span>
                            <div className="w-full bg-white/5 rounded-full h-1 overflow-hidden">
                              <div className="bg-brand-orange h-1 rounded-full transition-all duration-100" style={{ width: `${uploadProgress.ndi || 0}%` }}></div>
                            </div>
                            <span className="text-[9px] text-text-secondary font-mono">{uploadProgress.ndi || 0}%</span>
                          </div>
                        ) : (
                          <div className="text-center">
                            <span className="text-[9px] font-bold text-white/70 block">Arrastra el archivo SDK oficial de NDI aquí</span>
                            <span className="text-[8px] text-text-secondary block">Formatos: .zip, .tar.gz (Se saneará reduciendo su espacio)</span>
                          </div>
                        )}
                      </div>

                      {uploadError.ndi && (
                        <div className="text-[9px] text-red-400 font-bold bg-red-500/10 border border-red-500/20 p-1.5 rounded-lg">
                          ⚠️ Error: {uploadError.ndi}
                        </div>
                      )}

                      {/* Parche NDI local */}
                      <div className="space-y-2 pt-1 border-t border-white/5">
                        <div className="flex items-center justify-between">
                          <label className="text-[8px] text-text-secondary uppercase tracking-widest block font-bold">Parche de Compilación NDI</label>
                          <button
                            type="button"
                            onClick={() => setShowAddPatchForm(!showAddPatchForm)}
                            className="text-[9px] font-bold text-brand-orange hover:underline cursor-pointer"
                          >
                            {showAddPatchForm ? "✕ Cancelar subida" : "+ Subir Parche Personalizado"}
                          </button>
                        </div>

                        {showAddPatchForm ? (
                          <div className="p-2.5 bg-black/40 border border-white/10 rounded-lg space-y-2 animate-in slide-in-from-top-1 duration-200">
                            <span className="text-[9px] font-bold text-white block uppercase tracking-wider">Subir Parche Personalizado (.patch / .diff)</span>
                            
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-[8px] text-text-secondary uppercase tracking-widest block mb-0.5 font-bold">Alias descriptivo</label>
                                <input
                                  type="text"
                                  placeholder="e.g. Parche NDI v7.1.3"
                                  className="w-full bg-black/50 border border-white/5 rounded p-1 text-[9px] outline-none focus:border-brand-orange text-white"
                                  value={newPatchDisplayName}
                                  onChange={e => setNewPatchDisplayName(e.target.value)}
                                />
                              </div>
                              <div>
                                <label className="text-[8px] text-text-secondary uppercase tracking-widest block mb-0.5 font-bold">Versión FFmpeg</label>
                                <select
                                  className="w-full bg-black/50 border border-white/5 rounded p-1 text-[9px] outline-none focus:border-brand-orange text-white"
                                  value={newPatchFfmpegVersion}
                                  onChange={e => setNewPatchFfmpegVersion(e.target.value)}
                                >
                                  <option value="7">FFmpeg 7.x</option>
                                  <option value="6">FFmpeg 6.x</option>
                                  <option value="5">FFmpeg 5.x</option>
                                  <option value="any">Cualquiera / Otro</option>
                                </select>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => patchInputRef.current?.click()}
                                className="px-3 py-1 bg-white/10 text-white text-[9px] font-bold rounded hover:bg-white/15 tracking-wider uppercase"
                              >
                                Seleccionar Archivo
                              </button>
                              <input
                                type="file"
                                ref={patchInputRef}
                                className="hidden"
                                accept=".patch,.diff"
                                onChange={e => {
                                  if (e.target.files && e.target.files.length > 0) {
                                    setSelectedPatchFile(e.target.files[0])
                                    if (!newPatchDisplayName) {
                                      setNewPatchDisplayName(e.target.files[0].name)
                                    }
                                  }
                                }}
                              />
                              <span className="text-[9px] font-mono text-text-secondary truncate max-w-[150px]">
                                {selectedPatchFile ? selectedPatchFile.name : "Ninguno seleccionado"}
                              </span>
                            </div>

                            {uploadPatchError && (
                              <div className="text-[8px] text-red-400 font-bold bg-red-500/10 border border-red-500/20 p-1 rounded">
                                ⚠️ {uploadPatchError}
                              </div>
                            )}

                            <button
                              type="button"
                              disabled={uploadingPatch || !selectedPatchFile}
                              onClick={handlePatchUpload}
                              className={`w-full py-1 text-center font-black rounded text-[9px] uppercase tracking-widest ${
                                selectedPatchFile && !uploadingPatch
                                  ? "bg-brand-orange hover:bg-brand-orange/90 text-black cursor-pointer"
                                  : "bg-white/5 text-white/30 cursor-not-allowed"
                              }`}
                            >
                              {uploadingPatch ? "Subiendo..." : "Confirmar y Subir Parche"}
                            </button>
                          </div>
                        ) : (
                          <select
                            className="w-full bg-black/40 border border-white/10 rounded-lg p-1.5 text-xs focus:border-brand-orange outline-none"
                            value={sdkPaths.ndi_patch_file || ''}
                            onChange={e => setSdkPaths({ ...sdkPaths, ndi_patch_file: e.target.value })}
                          >
                            <option value="">-- Autodetectar parche recomendado (Sistema) --</option>
                            
                            {/* Recomendados */}
                            <optgroup label={`Recomendados para FFmpeg ${ffmpegVersion.replace(/^n/, '').split('.')[0]}.x`}>
                              {patches
                                .filter(p => p.ffmpeg_version_major === ffmpegVersion.replace(/^n/, '').split('.')[0])
                                .map(p => (
                                  <option key={p.filename} value={p.filename}>
                                    {p.display_name} {p.source === 'system' ? '(Sistema)' : '(Usuario)'}
                                  </option>
                                ))}
                            </optgroup>

                            {/* Otros */}
                            <optgroup label="Otros parches disponibles">
                              {patches
                                .filter(p => p.ffmpeg_version_major !== ffmpegVersion.replace(/^n/, '').split('.')[0])
                                .map(p => (
                                  <option key={p.filename} value={p.filename}>
                                    {p.display_name} ({p.ffmpeg_version_major === 'any' ? 'Universal' : `v${p.ffmpeg_version_major}.x`})
                                  </option>
                                ))}
                            </optgroup>
                          </select>
                        )}
                      </div>

                      {!sdkPaths.ndi && <p className="text-[9px] text-red-400 pl-1 font-bold">⚠ Se requiere seleccionar o subir un SDK de NDI</p>}
                    </div>
                  )}
                </div>
              </div>

            </div>
          )}
        </div>

        {/* Footer - Sticky */}
        <div className="p-3 border-t border-white/10 bg-white/5 flex gap-3 shrink-0">
          <button onClick={onClose}
            className="flex-1 py-2 text-xs font-bold bg-white/5 rounded-lg border border-white/5 hover:bg-white/10">CANCEL</button>
          <button
            onClick={handleSubmit}
            disabled={!isValid || isSubmitting}
            className={`flex-1 py-2 text-xs font-black tracking-widest rounded-lg ${isValid && !isSubmitting ? 'bg-brand-orange text-black hover:scale-[1.01] shadow-lg shadow-brand-orange/10' : 'bg-white/5 text-white/20'} transition-all`}
          >
            {isSubmitting ? 'PROCESSING...' : isEditing ? 'UPDATE PROFILE' : 'CREATE PROFILE'}
          </button>
        </div>
      </div>
    </div>
  )
}
