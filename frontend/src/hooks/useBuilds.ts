import { useState, useEffect, useRef } from 'react';
import type { BuildProfile } from '../components/BuildProfileCard';
import type { BuildFormData } from '../components/BuildFormModal';

const API = '';

export function useBuilds(activeView: string) {
  const [builds, setBuilds] = useState<BuildProfile[]>([]);
  const [diskInfo, setDiskInfo] = useState<{ free_gb: number; free_mb: number } | null>(null);
  const [buildDeps, setBuildDeps] = useState<any>(null);
  const [checkStatus, setCheckStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [capabilities, setCapabilities] = useState<any>(null);
  const [terminalBuild, setTerminalBuild] = useState<{ id: number; name: string } | null>(null);
  const [validationResult, setValidationResult] = useState<{ buildId: number; output: string } | null>(null);
  const [showBuildForm, setShowBuildForm] = useState(false);
  const [editingBuild, setEditingBuild] = useState<BuildProfile | null>(null);
  const importRecipeRef = useRef<HTMLInputElement | null>(null);

  const refreshBuilds = async () => {
    try {
      const res = await fetch(`${API}/builds`);
      if (res.ok) setBuilds(await res.json());
    } catch (err) {
      console.error("Failed to refresh builds:", err);
    }
  };

  const refreshDiskInfo = async () => {
    try {
      const res = await fetch(`${API}/builds/disk-info`);
      if (res.ok) setDiskInfo(await res.json());
    } catch (err) {
      console.error("Failed to refresh disk info:", err);
    }
  };

  const fetchDeps = async () => {
    setCheckStatus('loading');
    try {
      const res = await fetch(`${API}/builds/check`);
      if (!res.ok) throw new Error();
      setBuildDeps(await res.json());
      setCheckStatus('ready');
    } catch {
      setCheckStatus('error');
    }
  };

  const fetchCapabilities = async () => {
    try {
      const res = await fetch(`${API}/system/capabilities`);
      if (res.ok) setCapabilities(await res.json());
    } catch (err) {
      console.error("Failed to fetch capabilities:", err);
    }
  };

  const handleCreateBuild = async (data: BuildFormData) => {
    const res = await fetch(`${API}/builds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      setShowBuildForm(false);
      refreshBuilds();
    } else {
      const err = await res.json();
      alert(err.detail || 'Failed to create build');
    }
  };

  const handleUpdateBuild = async (data: BuildFormData) => {
    if (!editingBuild) return;
    const res = await fetch(`${API}/builds/${editingBuild.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      setEditingBuild(null);
      setShowBuildForm(false);
      refreshBuilds();
    } else {
      const err = await res.json();
      alert(err.detail || 'Failed to update build');
    }
  };

  const handleCompile = async (id: number) => {
    const build = builds.find(b => Number(b.id) === Number(id));
    setTerminalBuild({ id, name: build?.name || `Build #${id}` });
    try {
      const res = await fetch(`${API}/builds/${id}/compile`, { method: 'POST' });
      if (!res.ok) console.error("Server returned error:", res.status);
      refreshBuilds();
    } catch (err) {
      console.error("Fetch failed:", err);
    }
  };

  const handleStopBuild = async (id: number) => {
    await fetch(`${API}/builds/${Number(id)}/stop`, { method: 'POST' });
    refreshBuilds();
  };

  const handleCleanSources = async (id: number) => {
    try {
      const res = await fetch(`${API}/builds/${Number(id)}/clean-sources`, { method: 'POST' });
      if (res.ok) {
        refreshBuilds();
        refreshDiskInfo();
      }
    } catch (err) {
      console.error("Clean sources failed:", err);
    }
  };

  const handleValidate = async (id: number) => {
    try {
      const res = await fetch(`${API}/builds/${Number(id)}/validate`);
      const data = await res.json();
      setValidationResult({ buildId: Number(id), output: data.output || data.error || 'Unknown' });
    } catch (err) {
      console.error("Validation failed:", err);
    }
  };

  const handleSetDefault = async (id: number) => {
    try {
      const res = await fetch(`${API}/builds/${Number(id)}/set-default`, { method: 'POST' });
      if (res.ok) {
        refreshBuilds();
      }
    } catch (err) {
      console.error("Set default failed:", err);
    }
  };

  const handleDeleteBuild = async (id: number) => {
    const build = builds.find(b => Number(b.id) === Number(id));
    if (!window.confirm(`Delete "${build?.name}" permanently? This removes all files from disk.`)) return;
    try {
      const res = await fetch(`${API}/builds/${id}`, { method: 'DELETE' });
      if (res.ok) {
        refreshBuilds();
        refreshDiskInfo();
      }
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const handleImportRecipeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const json = JSON.parse(evt.target?.result as string);
        const response = await fetch(`${API}/builds/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(json)
        });
        
        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.detail || 'Recipe import failed');
        }
        
        const newBuild = await response.json();
        alert(`Successfully imported build recipe: ${newBuild.name}`);
        e.target.value = '';
        refreshBuilds();
      } catch (err: any) {
        alert(`Recipe Import Error: ${err.message || err}`);
      }
    };
    reader.readAsText(file);
  };

  const handleExportRecipe = (id: number) => {
    fetch(`${API}/builds/${id}/export`)
      .then(r => {
        if (!r.ok) throw new Error("Could not export recipe");
        return r.json();
      })
      .then(data => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `ffmpeg_recipe_${data.name}.json`;
        a.click();
      })
      .catch(err => alert(err.message || err));
  };

  useEffect(() => {
    refreshBuilds();
    refreshDiskInfo();
    fetchCapabilities();
  }, []);

  useEffect(() => {
    if (activeView === 'tools') {
      fetchDeps();
    }
  }, [activeView]);

  useEffect(() => {
    if (activeView !== 'tools') return;
    const hasBuilding = builds.some(b => b.status === 'building');
    if (!hasBuilding) return;
    const interval = setInterval(refreshBuilds, 3000);
    return () => clearInterval(interval);
  }, [activeView, builds]);

  return {
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
    fetchDeps,
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
  };
}
