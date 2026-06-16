import { useState, useEffect, useRef } from 'react';

const API = '';

export function useProcesses() {
  const [telemetry, setTelemetry] = useState<any[]>([]);
  const [taskExecutions, setTaskExecutions] = useState<any[]>([]);
  const [systemTelemetry, setSystemTelemetry] = useState<any>({
    cpu_percent: 0,
    memory_percent: 0,
    memory_used_mb: 0,
    memory_total_mb: 0,
    net_sent_kb: 0,
    net_recv_kb: 0,
    uptime_seconds: 0
  });
  const [taskStats, setTaskStats] = useState<any>({
    active_count: 0,
    completed_count: 0,
    failed_count: 0,
    total_count: 0
  });
  const [selectedProcess, setSelectedProcess] = useState<any | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProcess, setEditingProcess] = useState<any | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);

  // ── Telemetry WebSocket ────────────────────────────────────────
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/telemetry`);
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'telemetry') {
        setTelemetry(msg.data);
        if (msg.task_executions) {
          setTaskExecutions(msg.task_executions);
        }
        if (msg.system) {
          setSystemTelemetry(msg.system);
        }
        if (msg.task_stats) {
          setTaskStats(msg.task_stats);
        }
      }
    };
    return () => ws.close();
  }, []);

  // ── Process logs polling ───────────────────────────────────────
  useEffect(() => {
    if (!selectedProcess) return;
    const fetchLogs = async () => {
      try {
        const res = await fetch(`${API}/processes/${selectedProcess.id}/logs`);
        if (res.ok) {
          setLogs(await res.json());
        }
      } catch (err) {
        console.error("Error fetching process logs:", err);
      }
    };
    fetchLogs();
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, [selectedProcess]);

  const handleDeleteProcess = async (proc: any) => {
    const isConfirmed = window.confirm(
      `⚠️ WARNING: Are you sure you want to delete the service "${proc.name}"?\n\nIf it is currently running, it will be forcefully terminated, causing an immediate signal interruption for any connected clients.`
    );
    if (!isConfirmed) return;

    try {
      await fetch(`${API}/processes/${proc.id}`, {
        method: 'DELETE',
      });
      if (selectedProcess && selectedProcess.id === proc.id) {
        setSelectedProcess(null);
      }
    } catch (err) {
      console.error("Error deleting process:", err);
    }
  };

  const handleStartService = async (procId: number) => {
    setLogs([]);
    try {
      await fetch(`${API}/processes/${procId}/start`, { method: 'POST' });
    } catch (err) {
      console.error("Error starting process:", err);
    }
  };

  const handleStopService = async (procId: number) => {
    try {
      await fetch(`${API}/processes/${procId}/stop`, { method: 'POST' });
    } catch (err) {
      console.error("Error stopping process:", err);
    }
  };

  const handleCloneProcess = async (proc: any) => {
    try {
      const res = await fetch(`${API}/processes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${proc.name} (Copy)`,
          type: 'service',
          input_config: proc.input_config,
          output_config: proc.output_config,
          codec_config: proc.codec_config,
          filter_config: proc.filter_config,
          ffmpeg_build_id: proc.ffmpeg_build_id,
          auto_start: proc.auto_start,
          watchdog_enabled: proc.watchdog_enabled,
          watchdog_retries: proc.watchdog_retries,
        })
      });
      if (!res.ok) {
        const errData = await res.json();
        alert(`Error cloning service: ${errData.detail || 'Unknown error'}`);
      }
    } catch (err) {
      console.error("Error cloning process:", err);
    }
  };

  const handleRestartService = async (procId: number, procName: string) => {
    const isConfirmed = window.confirm(
      `⚠️ live broadcast WARNING:\n\nAre you sure you want to restart "${procName}"? Any active live stream connections (SRT/UDP/RTP) will drop and experience a temporary signal loss during restart.`
    );
    if (!isConfirmed) return;

    try {
      setLogs([]);
      await fetch(`${API}/processes/${procId}/restart`, { method: 'POST' });
    } catch (err) {
      console.error("Error restarting process:", err);
    }
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const json = JSON.parse(evt.target?.result as string);
        const response = await fetch(`${API}/processes/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(json)
        });
        
        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.detail || 'Import failed');
        }
        
        const newProc = await response.json();
        alert(`Successfully imported process: ${newProc.name}`);
        e.target.value = '';
      } catch (err: any) {
        alert(`Import Error: ${err.message || err}`);
      }
    };
    reader.readAsText(file);
  };

  return {
    telemetry,
    taskExecutions,
    systemTelemetry,
    taskStats,
    selectedProcess,
    setSelectedProcess,
    logs,
    setLogs,
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
  };
}
