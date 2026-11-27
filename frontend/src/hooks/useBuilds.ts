import { useState, useEffect, useRef, useCallback } from 'react';
import type { BuildProfile } from '../components/BuildProfileCard';
import type { BuildFormData } from '../components/BuildFormModal';
import { datetimeLocalToDailyCron } from '../utils/forgeBuildHelpers';

const API = '';

export function useBuilds(activeView: string) {
  const [builds, setBuilds] = useState<BuildProfile[]>([]);
  const [diskInfo, setDiskInfo] = useState<{ free_gb: number; free_mb: number; cpu_cores?: number } | null>(null);
  const [buildDeps, setBuildDeps] = useState<any>(null);
  const [checkStatus, setCheckStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [capabilities, setCapabilities] = useState<any>(null);
  const [terminalBuild, setTerminalBuild] = useState<{ id: number; name: string } | null>(null);
  const [validationResult, setValidationResult] = useState<{
    buildId: number;
    output: string;
    hw_checks?: Array<{ engine: string; status: 'ok' | 'warning' | 'skipped'; message: string }>;
    has_warnings?: boolean;
  } | null>(null);
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

  const fetchDeps = useCallback(async (softwareType?: string) => {
    setCheckStatus('loading');
    try {
      const url = softwareType ? `${API}/builds/check?software_type=${softwareType}` : `${API}/builds/check`;
      const res = await fetch(url);
      if (!res.ok) throw new Error();
      setBuildDeps(await res.json());
      setCheckStatus('ready');
    } catch {
      setCheckStatus('error');
    }
  }, []);

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

  const handleCompile = async (
    id: number,
    opts?: { clean?: boolean; maxJobs?: number; lowPriority?: boolean }
  ) => {
    const build = builds.find(b => Number(b.id) === Number(id));
    const params = new URLSearchParams();
    if (opts?.clean) params.set('clean', 'true');
    if (opts?.maxJobs != null) params.set('max_jobs', String(opts.maxJobs));
    if (opts?.lowPriority !== undefined) params.set('low_priority', String(opts.lowPriority));
    const qs = params.toString();
    try {
      const url = qs ? `${API}/builds/${id}/compile?${qs}` : `${API}/builds/${id}/compile`;
      const res = await fetch(url, { method: 'POST' });
      if (!res.ok) {
        if (res.status === 409) {
          alert("Another compilation is already in progress.");
        } else {
          console.error("Server returned error:", res.status);
          alert("Error starting compilation. Check server logs.");
        }
      } else {
        setTerminalBuild({ id, name: build?.name || `Build #${id}` });
      }
      refreshBuilds();
    } catch (err) {
      console.error("Fetch failed:", err);
    }
  };

  const handleRollback = async (id: number) => {
    try {
      const res = await fetch(`${API}/builds/${Number(id)}/rollback`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || 'Rollback failed');
      } else {
        refreshBuilds();
        refreshDiskInfo();
      }
    } catch (err) {
      console.error("Rollback failed:", err);
    }
  };

  const handleScheduleBuild = async (
    build: BuildProfile,
    opts: {
      clean: boolean;
      maxJobs: number;
      lowPriority: boolean;
      scheduleDatetime: string;
      repeatDaily: boolean;
    }
  ) => {
    try {
      const isRecurring = Boolean(opts.repeatDaily);
      const payload = {
        name: `Forge Nightly: ${build.name}`,
        is_active: true,
        command: 'system://forge_build',
        input_config: {
          type: 'forge_build',
          target_mode: 'selected',
          build_ids: [build.id],
          only_if_pending: isRecurring,
          max_jobs: opts.maxJobs,
          low_priority: opts.lowPriority,
          clean: opts.clean,
        },
        output_config: {},
        codec_config: {},
        filter_config: null,
        ffmpeg_build_id: null,
        schedule_type: isRecurring ? 'recurring' : 'one_shot',
        schedule_cron: isRecurring ? datetimeLocalToDailyCron(opts.scheduleDatetime) : null,
        schedule_datetime:
          !isRecurring && opts.scheduleDatetime
            ? new Date(opts.scheduleDatetime).toISOString()
            : null,
        duration_type: 'input_dependent',
        duration_seconds: null,
        duration_end_time: null,
        retry_policy: null,
      };
      const res = await fetch(`${API}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || 'Failed to schedule Forge build task');
      } else {
        refreshBuilds();
      }
    } catch (err) {
      console.error('Schedule build failed:', err);
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
      setValidationResult({
        buildId: Number(id),
        output: data.output || data.error || 'Unknown',
        hw_checks: Array.isArray(data.hw_checks) ? data.hw_checks : [],
        has_warnings: Boolean(data.has_warnings),
      });
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
        const engineLabel = newBuild.software_type ? `[${newBuild.software_type}] ` : '';
        alert(`Successfully imported build recipe: ${engineLabel}${newBuild.name}`);
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
        const stype = data.software_type || data.recipe?.software_type || 'software';
        const rawName = data.recipe?.name || data.name || (builds.find(b => Number(b.id) === Number(id))?.name) || `build_${id}`;
        const safeName = rawName.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${stype}_recipe_${safeName || 'export'}.json`;
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
    handleRollback,
    handleScheduleBuild,
    handleStopBuild,
    handleCleanSources,
    handleValidate,
    handleSetDefault,
    handleDeleteBuild,
    handleImportRecipeChange,
    handleExportRecipe,
  };
}
