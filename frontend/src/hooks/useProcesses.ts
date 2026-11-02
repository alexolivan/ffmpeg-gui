import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useTelemetry } from '../context/TelemetryContext';

const API = '';

export function useProcesses() {
  const { t } = useTranslation();
  const {
    telemetry,
    systemTelemetry,
    taskExecutions,
    upcomingTasks,
    taskStats,
    actionPending,
    setActionPending,
    subscribe,
  } = useTelemetry();

  const [selectedProcess, setSelectedProcess] = useState<any | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProcess, setEditingProcess] = useState<any | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);

  // ── Process logs: On-Demand WebSocket Subscription (Zero HTTP Polling) ──
  useEffect(() => {
    if (!selectedProcess) {
      setLogs([]);
      return;
    }

    const unsub = subscribe('process_logs', selectedProcess.id, (msg: any) => {
      if (msg.reset) {
        setLogs(msg.lines || []);
      } else if (Array.isArray(msg.lines) && msg.lines.length > 0) {
        setLogs(prev => [...prev, ...msg.lines]);
      }
    });

    return () => unsub();
  }, [selectedProcess?.id, subscribe]);

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
    if (actionPending[procId]) return;
    const proc = telemetry.find(p => p.id === procId);
    if (proc && proc.debug_mode) {
      try {
        const checkRes = await fetch(`${API}/api/processes/${procId}/log-exists`);
        if (checkRes.ok) {
          const { exists } = await checkRes.json();
          if (exists) {
            const proceed = window.confirm(
              `⚠️ ATENCIÓN: Existe una bitácora (log) de consola de una ejecución anterior de "${proc.name}".\n\nSi continúas, la bitácora anterior se eliminará permanentemente para evitar consumo innecesario de espacio.\n\n¿Deseas iniciar el proceso y borrar el log anterior?`
            );
            if (!proceed) return;
          }
        }
      } catch (err) {
        console.error("Error checking log existence:", err);
      }
    }

    setLogs([]);
    setActionPending(prev => ({ ...prev, [procId]: 'starting' }));
    try {
      await fetch(`${API}/processes/${procId}/start`, { method: 'POST' });
    } catch (err) {
      console.error("Error starting process:", err);
    } finally {
      setTimeout(() => {
        setActionPending(prev => {
          const next = { ...prev };
          delete next[procId];
          return next;
        });
      }, 3500);
    }
  };

  const handleStopService = async (procId: number, procName?: string) => {
    if (actionPending[procId]) return;
    const name = procName || telemetry.find(p => p.id === procId)?.name || 'Service';
    const isConfirmed = window.confirm(
      t('services.stopConfirm', `⚠️ LIVE BROADCAST WARNING:\n\nAre you sure you want to stop "${name}"? Any active live stream connections (SRT/UDP/RTP/Icecast) will experience an immediate signal interruption.`, { name })
    );
    if (!isConfirmed) return;

    setActionPending(prev => ({ ...prev, [procId]: 'stopping' }));
    try {
      await fetch(`${API}/processes/${procId}/stop`, { method: 'POST' });
    } catch (err) {
      console.error("Error stopping process:", err);
    } finally {
      setTimeout(() => {
        setActionPending(prev => {
          const next = { ...prev };
          delete next[procId];
          return next;
        });
      }, 2000);
    }
  };

  const handleCloneProcess = async (proc: any) => {
    try {
      const res = await fetch(`${API}/processes/${proc.id}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        alert(`Error cloning service: ${errData.detail || 'Unknown error'}`);
        return;
      }
      alert(t('common.clonedSuccess', 'Cloned successfully!'));
    } catch (err: any) {
      console.error("Error cloning process:", err);
      alert(err.message || 'Error cloning service');
    }
  };

  const handleRestartService = async (procId: number, procName?: string) => {
    if (actionPending[procId]) return;
    const name = procName || telemetry.find(p => p.id === procId)?.name || 'Service';
    const isConfirmed = window.confirm(
      t('services.restartConfirm', `⚠️ LIVE BROADCAST WARNING:\n\nAre you sure you want to restart "${name}"? Any active live stream connections (SRT/UDP/RTP/Icecast) will drop and experience a temporary signal loss during restart.`, { name })
    );
    if (!isConfirmed) return;

    setActionPending(prev => ({ ...prev, [procId]: 'restarting' }));
    try {
      setLogs([]);
      await fetch(`${API}/processes/${procId}/restart`, { method: 'POST' });
    } catch (err) {
      console.error("Error restarting process:", err);
    } finally {
      setTimeout(() => {
        setActionPending(prev => {
          const next = { ...prev };
          delete next[procId];
          return next;
        });
      }, 3500);
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
    upcomingTasks,
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
    actionPending,
  };
}
