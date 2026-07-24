import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

interface StorageItem {
  id: number;
  name: string;
  path: string;
  type: string;
  is_default?: boolean;
}

interface SdkItem {
  id: number;
  target_app: string;
  sdk_type: string;
  name: string;
  version: string;
  storage_id: number | null;
  relative_path: string;
  path: string;
  size_bytes: number;
  status: string;
  used_by_builds: string[];
}

interface BuildSdksModalProps {
  isOpen: boolean;
  onClose: () => void;
  storages: StorageItem[];
  onRefresh: () => void;
  API: string;
}

export const BuildSdksModal: React.FC<BuildSdksModalProps> = ({
  isOpen,
  onClose,
  storages = [],
  onRefresh,
  API,
}) => {
  const { t } = useTranslation();

  const [sdks, setSdks] = useState<SdkItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadType, setUploadType] = useState<string>('decklink');
  const [uploadStorageId, setUploadStorageId] = useState<number | ''>('');
  const [showUploadDrawer, setShowUploadDrawer] = useState<boolean>(false);

  const [migrateSdk, setMigrateSdk] = useState<SdkItem | null>(null);
  const [targetStorageId, setTargetStorageId] = useState<number | ''>('');
  const [isMigrating, setIsMigrating] = useState<boolean>(false);

  const [deleteTarget, setDeleteTarget] = useState<SdkItem | null>(null);
  const [deleteForce, setDeleteForce] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [versionNotice, setVersionNotice] = useState<string | null>(null);
  const [reuploadExpectedVersion, setReuploadExpectedVersion] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchSdks = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${API}/sdks`);
      if (res.ok) {
        const data = await res.json();
        setSdks(data);
      } else {
        const err = await res.json().catch(() => ({}));
        setErrorMsg(err.detail || 'Failed to load SDK inventory');
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Network error loading SDK inventory');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchSdks();
    } else {
      // Reset transient state when closed
      setShowUploadDrawer(false);
      setMigrateSdk(null);
      setDeleteTarget(null);
      setDeleteForce(false);
      setSelectedFile(null);
      setErrorMsg(null);
    }
  }, [isOpen, API]);

  if (!isOpen) return null;

  const sdkStorages = (storages || []).filter((s) => s.type === 'sdk');

  const getStorageBadge = (storageId: number | null, relPath: string, fullPath: string) => {
    const storage = (storages || []).find((s) => s.id === storageId);
    const storageName = storage ? storage.name : t('sdks.defaultStorage');
    const displayPath = relPath ? relPath : fullPath;
    return `${storageName} (${displayPath})`;
  };

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      setSelectedFile(file);
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;

    setIsUploading(true);
    setErrorMsg(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('sdk_type', uploadType);
      if (uploadStorageId !== '') {
        formData.append('storage_id', String(uploadStorageId));
      }

      const res = await fetch(`${API}/sdks/upload`, {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const result = await res.json().catch(() => ({}));
        setSelectedFile(null);
        setShowUploadDrawer(false);
        if (reuploadExpectedVersion && result.version && result.version !== reuploadExpectedVersion) {
          setVersionNotice(t('sdks.versionMismatchNotice', { uploaded: result.version, expected: reuploadExpectedVersion }));
        } else {
          setVersionNotice(null);
        }
        setReuploadExpectedVersion(null);
        await fetchSdks();
        if (onRefresh) onRefresh();
      } else {
        const err = await res.json().catch(() => ({}));
        setErrorMsg(err.detail || 'SDK upload failed');
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Network error uploading SDK');
    } finally {
      setIsUploading(false);
    }
  };

  const handleMigrateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!migrateSdk || targetStorageId === '') return;

    setIsMigrating(true);
    setErrorMsg(null);

    try {
      const res = await fetch(`${API}/sdks/${migrateSdk.id}/migrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_storage_id: Number(targetStorageId) }),
      });

      if (res.ok) {
        setMigrateSdk(null);
        setTargetStorageId('');
        await fetchSdks();
        if (onRefresh) onRefresh();
      } else {
        const err = await res.json().catch(() => ({}));
        setErrorMsg(err.detail || 'SDK migration failed');
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Network error migrating SDK');
    } finally {
      setIsMigrating(false);
    }
  };

  const handleDeleteSubmit = async () => {
    if (!deleteTarget) return;

    const hasRecipes = deleteTarget.used_by_builds && deleteTarget.used_by_builds.length > 0;
    if (hasRecipes && !deleteForce) return;

    setIsDeleting(true);
    setErrorMsg(null);

    try {
      const res = await fetch(`${API}/sdks/${deleteTarget.id}?force=${hasRecipes ? true : deleteForce}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        setDeleteTarget(null);
        setDeleteForce(false);
        await fetchSdks();
        if (onRefresh) onRefresh();
      } else {
        const err = await res.json().catch(() => ({}));
        setErrorMsg(err.detail || 'SDK deletion failed');
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Network error deleting SDK');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleReuploadClick = (sdk: SdkItem) => {
    setUploadType(sdk.sdk_type);
    setUploadStorageId(sdk.storage_id !== null ? sdk.storage_id : '');
    setReuploadExpectedVersion(sdk.version);
    setShowUploadDrawer(true);
    setSelectedFile(null);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-300">
      <div className="glass-card w-full max-w-4xl p-6 border-white/10 shadow-2xl relative max-h-[90vh] flex flex-col overflow-hidden bg-[var(--bg-card)] text-[var(--text-primary)] rounded-3xl border border-[var(--glass-border)]">
        {/* Header bar */}
        <header className="flex justify-between items-center pb-4 mb-4 border-b border-white/10 flex-shrink-0">
          <div>
            <h2 className="text-xl font-black tracking-tight text-[var(--text-primary)] flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-brand-orange inline-block" />
              {t('sdks.modalTitle')}
            </h2>
          </div>
          <button
            onClick={() => {
              if (onRefresh) onRefresh();
              onClose();
            }}
            className="w-8 h-8 rounded-full bg-[var(--input-bg)] hover:bg-brand-lime/10 transition-colors flex items-center justify-center text-text-secondary hover:text-[var(--text-primary)] font-bold"
            title={t('common.close')}
          >
            ✕
          </button>
        </header>

        {/* Version Mismatch Warning Banner */}
        {versionNotice && (
          <div className="mb-4 p-3 bg-amber-500/15 border border-amber-500/40 rounded-xl text-amber-300 text-xs font-bold flex justify-between items-center animate-in slide-in-from-top-2 duration-300">
            <span>{versionNotice}</span>
            <button onClick={() => setVersionNotice(null)} className="text-amber-300 font-bold ml-2 hover:text-white">
              ✕
            </button>
          </div>
        )}

        {/* Global error banner */}
        {errorMsg && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs flex justify-between items-center">
            <span>{errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} className="text-red-400 font-bold ml-2">
              ✕
            </button>
          </div>
        )}

        {/* Toolbar */}
        <div className="flex justify-between items-center mb-4 flex-shrink-0">
          <div className="text-xs text-text-secondary">
            {sdks.length} {sdks.length === 1 ? 'SDK installed' : 'SDKs installed'}
          </div>
          <button
            onClick={() => setShowUploadDrawer(!showUploadDrawer)}
            className="pill-button bg-brand-orange text-black font-black hover:scale-105 transition-transform flex items-center gap-1.5 text-xs py-2 px-4"
          >
            {showUploadDrawer ? t('sdks.closeUploadForm') : t('sdks.uploadSdk')}
          </button>
        </div>

        {/* Upload Form Drawer */}
        {showUploadDrawer && (
          <form
            onSubmit={handleUploadSubmit}
            className="mb-6 p-4 bg-white/5 border border-white/10 rounded-2xl animate-in slide-in-from-top-2 duration-300 flex-shrink-0 space-y-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* SDK Type selector */}
              <div>
                <label className="block text-xs font-bold text-text-secondary uppercase mb-1">
                  {t('sdks.sdkType')}
                </label>
                <select
                  value={uploadType}
                  onChange={(e) => setUploadType(e.target.value)}
                  className="w-full bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none focus:border-brand-orange"
                >
                  <option value="decklink">DeckLink (Blackmagic)</option>
                  <option value="ndi">NDI (NewTek)</option>
                </select>
              </div>

              {/* Storage selector (filtered to type === 'sdk') */}
              <div>
                <label className="block text-xs font-bold text-text-secondary uppercase mb-1">
                  {t('sdks.storage')}
                </label>
                <select
                  value={uploadStorageId}
                  onChange={(e) => setUploadStorageId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none focus:border-brand-orange"
                >
                  <option value="">{t('sdks.defaultStorage')}</option>
                  {sdkStorages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.path})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* File Drag & Drop input */}
            <div>
              <label className="block text-xs font-bold text-text-secondary uppercase mb-1">
                SDK Archive (.zip, .tar.gz)
              </label>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                  isDragOver
                    ? 'border-brand-orange bg-brand-orange/10'
                    : selectedFile
                    ? 'border-brand-lime/50 bg-brand-lime/5'
                    : 'border-white/10 bg-black/40 hover:border-white/20'
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      setSelectedFile(e.target.files[0]);
                    }
                  }}
                  accept=".zip,.tar.gz,.tgz,.tar.bz2"
                  className="hidden"
                />
                {selectedFile ? (
                  <div className="text-xs font-bold text-brand-lime">
                    ✓ {selectedFile.name} ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)
                  </div>
                ) : (
                  <div className="text-xs text-text-secondary">
                    {t('sdks.dropArchive')}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowUploadDrawer(false);
                  setSelectedFile(null);
                }}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold transition-all"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={!selectedFile || isUploading}
                className="px-5 py-2 bg-brand-orange text-black font-black hover:scale-105 disabled:hover:scale-100 disabled:opacity-50 transition-all rounded-xl text-xs"
              >
                {isUploading ? t('sdks.uploading') : t('sdks.uploadSdk')}
              </button>
            </div>
          </form>
        )}

        {/* SDK List */}
        <div className="flex-1 overflow-y-auto pr-1 space-y-3">
          {isLoading ? (
            <div className="text-center py-12">
              <span className="w-8 h-8 border-2 border-brand-orange border-t-transparent rounded-full animate-spin inline-block mb-2" />
              <p className="text-xs text-text-secondary">{t('common.processing')}</p>
            </div>
          ) : sdks.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-white/10 rounded-2xl">
              <p className="text-sm text-text-secondary font-bold">{t('sdks.noSdks')}</p>
            </div>
          ) : (
            sdks.map((sdk) => {
              const isDecklink = sdk.sdk_type === 'decklink';
              const sizeMb = (sdk.size_bytes / (1024 * 1024)).toFixed(1);
              const usedRecipesCount = sdk.used_by_builds ? sdk.used_by_builds.length : 0;
              const isMissing = sdk.status === 'missing';

              return (
                <div
                  key={sdk.id}
                  className="glass-card p-4 bg-white/5 border border-white/10 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-white/20 transition-all"
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    {/* TYPE badge */}
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-mono font-black border uppercase tracking-wider ${
                        isDecklink
                          ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                          : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                      }`}
                    >
                      {sdk.sdk_type}
                    </span>

                    {/* Version pill */}
                    <span className="px-2.5 py-1 rounded-full bg-[var(--input-bg)] border border-[var(--glass-border)] font-mono text-xs font-bold text-[var(--text-primary)]">
                      v{sdk.version}
                    </span>

                    {/* Storage drive badge & relative path */}
                    <span className="text-xs text-text-secondary font-mono truncate max-w-xs" title={sdk.path}>
                      {getStorageBadge(sdk.storage_id, sdk.relative_path, sdk.path)}
                    </span>

                    {/* Size MB */}
                    <span className="text-xs text-text-secondary font-mono">
                      ({sizeMb} MB)
                    </span>

                    {/* Status badge */}
                    {isMissing ? (
                      <span className="px-2.5 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 font-bold text-xs">
                        {t('sdks.missingOnDisk')}
                      </span>
                    ) : usedRecipesCount > 0 ? (
                      <span className="px-2.5 py-0.5 rounded-full bg-brand-lime/20 text-brand-lime border border-brand-lime/30 font-bold text-xs">
                        {t('sdks.inUse', { count: usedRecipesCount })}
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-full bg-white/5 text-text-secondary border border-white/10 font-bold text-xs">
                        {t('sdks.unused')}
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => {
                        setMigrateSdk(sdk);
                        setTargetStorageId('');
                      }}
                      className="px-3 py-1.5 bg-[var(--input-bg)] border border-[var(--glass-border)] text-[var(--text-primary)] rounded-xl text-xs font-bold hover:border-brand-lime/40 transition-all flex items-center gap-1"
                    >
                      {t('sdks.migrate')}
                    </button>
                    <button
                      onClick={() => handleReuploadClick(sdk)}
                      className="px-3 py-1.5 bg-[var(--input-bg)] border border-[var(--glass-border)] text-[var(--text-primary)] rounded-xl text-xs font-bold hover:border-brand-lime/40 transition-all flex items-center gap-1"
                    >
                      {t('sdks.reupload')}
                    </button>
                    <button
                      onClick={() => {
                        setDeleteTarget(sdk);
                        setDeleteForce(false);
                      }}
                      className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-xl text-xs font-bold text-red-400 transition-all flex items-center gap-1"
                    >
                      {t('sdks.delete')}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Migrate inline modal */}
        {migrateSdk && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
            <div className="glass-card w-full max-w-md p-6 border-white/10 shadow-2xl bg-black rounded-2xl space-y-4">
              <h3 className="text-base font-black tracking-wide uppercase text-white">
                {t('sdks.migrateModalTitle')}
              </h3>
              <p className="text-xs text-text-secondary">
                {migrateSdk.name} (v{migrateSdk.version})
              </p>

              <div>
                <label className="block text-xs font-bold text-text-secondary uppercase mb-1">
                  {t('sdks.targetStorage')}
                </label>
                <select
                  value={targetStorageId}
                  onChange={(e) => setTargetStorageId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none focus:border-brand-orange"
                >
                  <option value="">{t('sdks.selectStorage')}</option>
                  {sdkStorages
                    .filter((s) => s.id !== migrateSdk.storage_id)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.path})
                      </option>
                    ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setMigrateSdk(null)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold transition-all"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleMigrateSubmit}
                  disabled={targetStorageId === '' || isMigrating}
                  className="px-4 py-2 bg-brand-orange text-black font-black hover:scale-105 disabled:hover:scale-100 disabled:opacity-50 transition-all rounded-xl text-xs"
                >
                  {isMigrating ? t('sdks.migrating') : t('sdks.confirmMigrate')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete confirmation modal */}
        {deleteTarget && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
            <div className="glass-card w-full max-w-md p-6 border-white/10 shadow-2xl bg-black rounded-2xl space-y-4">
              <h3 className="text-base font-black tracking-wide uppercase text-red-400">
                {t('sdks.deleteModalTitle')}
              </h3>
              <p className="text-xs text-white">
                {t('sdks.deleteConfirmText', { name: deleteTarget.name, version: deleteTarget.version })}
              </p>

              {/* Warning banner if used by recipes */}
              {deleteTarget.used_by_builds && deleteTarget.used_by_builds.length > 0 ? (
                <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl space-y-2">
                  <div className="text-xs font-bold text-red-400">
                    {t('sdks.warningBanner')}
                  </div>
                  <ul className="text-xs text-red-300 list-disc list-inside font-mono space-y-0.5">
                    {deleteTarget.used_by_builds.map((recipeName) => (
                      <li key={recipeName}>{recipeName}</li>
                    ))}
                  </ul>
                  <label className="flex items-start gap-2 pt-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={deleteForce}
                      onChange={(e) => setDeleteForce(e.target.checked)}
                      className="mt-0.5 rounded border-white/20 bg-black/40 text-brand-orange focus:ring-brand-orange"
                    />
                    <span className="text-xs text-text-secondary">
                      {t('sdks.forceDeleteCheckbox')}
                    </span>
                  </label>
                </div>
              ) : null}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDeleteTarget(null)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold transition-all"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleDeleteSubmit}
                  disabled={
                    isDeleting ||
                    (deleteTarget.used_by_builds && deleteTarget.used_by_builds.length > 0 && !deleteForce)
                  }
                  className="px-4 py-2 bg-red-500 text-white font-black hover:scale-105 disabled:hover:scale-100 disabled:opacity-50 transition-all rounded-xl text-xs"
                >
                  {isDeleting
                    ? t('sdks.deleting')
                    : deleteTarget.used_by_builds && deleteTarget.used_by_builds.length > 0
                    ? t('sdks.forceDelete')
                    : t('sdks.confirmDelete')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
