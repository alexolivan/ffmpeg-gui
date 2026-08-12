import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import ProcessConfigForm from './ProcessConfigForm';
import { formatInputDesc, formatOutputDesc } from '../utils/formatters';
import { 
  ImportIcon, 
  PlusIcon, 
  ClipboardIcon, 
  ExportIcon, 
  PencilIcon, 
  TrashIcon, 
  SourceIcon, 
  StopIcon,
  PlayIcon,
  ServerIcon
} from './Icons';

interface ScheduledTasksProps {
  API: string;
  taskExecutions: any[]; // Active executions from websocket telemetry
}

export const ScheduledTasks: React.FC<ScheduledTasksProps> = ({ API, taskExecutions }) => {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingTask, setEditingTask] = useState<any | null>(null);
  const [selectedTaskDetails, setSelectedTaskDetails] = useState<any | null>(null);
  const [viewingLogsExecutionId, setViewingLogsExecutionId] = useState<number | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [taskTriggerPending, setTaskTriggerPending] = useState<Record<number, boolean>>({});
  const [execStopPending, setExecStopPending] = useState<Record<number, boolean>>({});

  // Logs autoscroll reference
  const logsContainerRef = useRef<HTMLDivElement>(null);

  // File import reference
  const importFileRef = useRef<HTMLInputElement>(null);

  const hasVideoTask = (task: any) => {
    const isAudioOnlyCodec = task.codec_config?.vcodec === 'none';
    const hasVideoInput = task.input_config?.has_video !== false;
    return hasVideoInput && !isAudioOnlyCodec;
  };

  const fetchTasks = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const r = await fetch(`${API}/tasks`);
      if (!r.ok) throw new Error('Failed to load tasks');
      setTasks(await r.json());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(() => {
      fetchTasks(true);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Poll logs when viewing logs modal
  useEffect(() => {
    if (viewingLogsExecutionId === null) return;
    const fetchLogs = async () => {
      try {
        const r = await fetch(`${API}/tasks/executions/${viewingLogsExecutionId}/logs`);
        if (r.ok) {
          setLogs(await r.json());
        }
      } catch {}
    };
    fetchLogs();
    const timer = setInterval(fetchLogs, 2000);
    return () => clearInterval(timer);
  }, [viewingLogsExecutionId]);

  // Autoscroll logs
  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Load task details when selected
  const viewTaskDetails = async (taskId: number) => {
    try {
      const r = await fetch(`${API}/tasks/${taskId}`);
      if (r.ok) {
        setSelectedTaskDetails(await r.json());
      }
    } catch {}
  };

  const handleClearTaskHistory = async (taskId: number) => {
    if (!window.confirm(t('tasks.clearHistoryConfirm', 'Are you sure you want to delete all execution history and logs for this task?'))) {
      return;
    }
    try {
      const r = await fetch(`${API}/tasks/${taskId}/executions`, { method: 'DELETE' });
      if (r.ok) {
        viewTaskDetails(taskId);
        fetchTasks();
      }
    } catch {}
  };

  // Poll task details if open (to get updated execution list)
  useEffect(() => {
    if (!selectedTaskDetails) return;
    const timer = setInterval(() => {
      viewTaskDetails(selectedTaskDetails.task.id);
    }, 3000);
    return () => clearInterval(timer);
  }, [selectedTaskDetails]);

  // Handle Save (Create / Update)
  const handleSaveTask = async (payload: any) => {
    const finalPayload = {
      ...payload,
      is_active: payload.is_active !== undefined ? payload.is_active : (editingTask ? editingTask.is_active : true)
    };
    try {
      const url = editingTask ? `${API}/tasks/${editingTask.id}` : `${API}/tasks`;
      const method = editingTask ? 'PUT' : 'POST';
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalPayload)
      });
      if (!r.ok) {
        const errData = await r.json();
        throw new Error(errData.detail || 'Failed to save task');
      }
      setShowAddModal(false);
      setEditingTask(null);
      fetchTasks();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleEditClick = (task: any) => {
    setEditingTask(task);
    setShowAddModal(true);
  };

  const handleDeleteTask = async (taskId: number) => {
    if (!confirm('Are you sure you want to delete this task? All execution logs will be lost.')) return;
    try {
      const r = await fetch(`${API}/tasks/${taskId}`, { method: 'DELETE' });
      if (r.ok) {
        fetchTasks();
        if (selectedTaskDetails?.task.id === taskId) {
          setSelectedTaskDetails(null);
        }
      }
    } catch {}
  };

  const handleTriggerTask = async (taskId: number) => {
    setTaskTriggerPending(prev => ({ ...prev, [taskId]: true }));
    try {
      const r = await fetch(`${API}/tasks/${taskId}/trigger`, { method: 'POST' });
      if (r.ok) {
        fetchTasks();
        alert('Execution triggered successfully!');
      }
    } catch {} finally {
      setTaskTriggerPending(prev => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
    }
  };

  const handleStopExecution = async (execId: number) => {
    setExecStopPending(prev => ({ ...prev, [execId]: true }));
    try {
      const r = await fetch(`${API}/tasks/executions/${execId}/stop`, { method: 'POST' });
      if (r.ok) {
        alert('Task execution stop signal sent.');
        fetchTasks();
      }
    } catch {} finally {
      setExecStopPending(prev => {
        const next = { ...prev };
        delete next[execId];
        return next;
      });
    }
  };

  const handleExportTask = async (task: any) => {
    try {
      const r = await fetch(`${API}/tasks/${task.id}/export`);
      if (r.ok) {
        const data = await r.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ffmpeg_scheduled_task_${task.name.replace(/\s+/g, '_')}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        alert('Failed to export task.');
      }
    } catch (err) {
      console.error("Error exporting task:", err);
    }
  };

  const handleCloneTask = async (task: any) => {
    try {
      const res = await fetch(`${API}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${task.name} (Copy)`,
          alias: task.alias ? `${task.alias.slice(0, 7)}_copy`.slice(0, 12) : null,
          is_active: false,
          input_config: task.input_config,
          output_config: task.output_config,
          codec_config: task.codec_config,
          filter_config: task.filter_config,
          ffmpeg_build_id: task.ffmpeg_build_id,
          schedule_type: task.schedule_type,
          schedule_cron: task.schedule_cron,
          schedule_datetime: task.schedule_datetime,
          duration_type: task.duration_type,
          duration_seconds: task.duration_seconds,
          duration_end_time: task.duration_end_time,
          retry_policy: task.retry_policy,
        })
      });
      if (res.ok) {
        fetchTasks();
        alert('Task cloned successfully!');
      } else {
        const errData = await res.json();
        alert(`Error cloning task: ${errData.detail || 'Unknown error'}`);
      }
    } catch (err) {
      console.error("Error cloning task:", err);
    }
  };

  const handleToggleTaskActive = async (taskId: number, currentActive: boolean) => {
    try {
      const res = await fetch(`${API}/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !currentActive })
      });
      if (res.ok) {
        fetchTasks();
      }
    } catch (err) {
      console.error("Error toggling task active state:", err);
    }
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const json = JSON.parse(evt.target?.result as string);
        const response = await fetch(`${API}/tasks/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(json)
        });
        
        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.detail || 'Import failed');
        }
        
        alert(`Successfully imported task(s).`);
        e.target.value = '';
        fetchTasks();
      } catch (err: any) {
        alert(`Import Error: ${err.message || err}`);
      }
    };
    reader.readAsText(file);
  };


  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'running': return 'bg-brand-lime text-black animate-pulse';
      case 'finished': return 'bg-green-500/20 text-green-400 border border-green-500/30';
      case 'error': return 'bg-red-500/20 text-red-400 border border-red-500/30';
      case 'stopped': return 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30';
      case 'interrupted': return 'bg-gray-500/20 text-gray-400 border border-gray-500/30';
      default: return 'bg-white/10 text-white/60';
    }
  };

  // Metrics
  const totalTasks = tasks.length;
  const activeTasks = tasks.filter(t => t.is_active).length;
  const recurringTasks = tasks.filter(t => t.schedule_type === 'recurring').length;
  const runningExecutions = taskExecutions.length;

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* HEADER */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-[var(--text-primary)] uppercase mb-0.5">
            {t('tasks.title', 'Task Scheduling')}
          </h1>
          <p className="text-xs text-text-secondary">{t('tasks.subtitle', 'Automate batch jobs, recurring feeds and cron conversions.')}</p>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={() => importFileRef.current?.click()} 
            className="pill-button bg-[var(--input-bg)] border border-[var(--glass-border)] text-[var(--text-primary)] hover:border-brand-lime/40 text-sm py-2.5 px-6 flex items-center gap-1.5"
          >
            <ImportIcon size={14} /> {t('tasks.importTask', 'IMPORT TASK')}
          </button>
          <input 
            type="file" 
            ref={importFileRef} 
            className="hidden" 
            accept=".json" 
            onChange={handleImportFileChange} 
          />
          <button 
            onClick={() => {
              setEditingTask(null);
              setShowAddModal(true);
            }}
            className="pill-button bg-brand-lime text-black font-black text-sm py-2.5 px-6 shadow-lg shadow-brand-lime/20 flex items-center gap-1.5"
          >
            <PlusIcon size={14} /> {t('tasks.newTask', 'CREATE TASK')}
          </button>
        </div>
      </header>

      {/* METRIC CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <div className="glass-card py-3 px-4 bg-white/5 border-white/5 flex flex-col justify-between">
          <span className="text-xs uppercase font-bold tracking-wider text-text-secondary">Total Tasks</span>
          <span className="text-2xl font-black text-[var(--text-primary)] mt-1">{totalTasks}</span>
        </div>
        <div className="glass-card py-3 px-4 bg-white/5 border-white/5 flex flex-col justify-between">
          <span className="text-xs uppercase font-bold tracking-wider text-text-secondary">Active Timers</span>
          <span className="text-2xl font-black text-brand-orange mt-1">{activeTasks}</span>
        </div>
        <div className="glass-card py-3 px-4 bg-white/5 border-white/5 flex flex-col justify-between">
          <span className="text-xs uppercase font-bold tracking-wider text-text-secondary">Recurring Cron</span>
          <span className="text-2xl font-black text-brand-blue mt-1">{recurringTasks}</span>
        </div>
        <div className="glass-card py-3 px-4 bg-white/5 border-white/5 flex flex-col justify-between">
          <span className="text-xs uppercase font-bold tracking-wider text-text-secondary">Active Executions</span>
          <span className="text-2xl font-black text-brand-lime mt-1 flex items-center gap-3">
            {runningExecutions}
            {runningExecutions > 0 && <span className="w-2.5 h-2.5 rounded-full bg-brand-lime animate-pulse"></span>}
          </span>
        </div>
      </div>

      {/* TASKS LIST - TWO STACKS (ACTIVE VS DISABLED) */}
      <div className="space-y-6">
        {/* Active & Scheduled Tasks */}
        <div className="glass-card p-4 md:p-5 bg-white/5 border-white/5">
          <h2 className="text-xl font-bold mb-3 text-[var(--text-primary)]">{t('tasks.activeScheduledTasks', 'Active & Scheduled Tasks')}</h2>
          
          {loading ? (
            <div className="py-12 text-center text-text-secondary animate-pulse">{t('common.loading', 'Loading task configurations...')}</div>
          ) : error ? (
            <div className="py-8 text-center text-red-400 font-bold border border-red-500/20 rounded-2xl bg-red-500/5">{error}</div>
          ) : tasks.filter(t => t.is_active).length === 0 ? (
            <div className="py-12 text-center text-white/20 italic border border-dashed border-white/5 rounded-2xl">
              {t('tasks.noActiveTasks', 'No active scheduled tasks.')}
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {tasks.filter(t => t.is_active).map(task => {
                const liveExec = taskExecutions.find((e: any) => e.task_id === task.id && (e.status === 'running' || e.status === 'retrying'));
                const exec = liveExec || task.last_execution;
                const isRunning = exec && (exec.status === 'running' || exec.status === 'retrying');
                return (
                  <div 
                    key={task.id} 
                    className={`py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all px-2 ${
                      isRunning
                        ? 'border border-brand-lime/30 rounded-xl bg-brand-lime/[0.02] px-3 my-1 shadow-sm shadow-brand-lime/5'
                        : task.is_system 
                          ? 'border border-brand-orange/30 rounded-xl bg-brand-orange/[0.02] px-3 my-1 shadow-sm shadow-brand-orange/5' 
                          : 'hover:bg-white/[0.01]'
                    }`}
                  >
                    <div className="flex-1 space-y-0.5 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="font-bold text-lg truncate text-[var(--text-primary)]">
                          {task.is_system && (task.name === 'System Log Rotation and Retention Cleanup' || task.command === 'system://log_rotate')
                            ? t('tasks.systemLogTaskName', 'System Log Rotation and Retention Cleanup')
                            : task.is_system && (task.name === 'System SSL/TLS Certificate Auto-Renewal Routine' || task.command === 'system://ssl_renew')
                            ? t('tasks.systemSslTaskName', 'System SSL/TLS Certificate Auto-Renewal Routine')
                            : task.name}
                          {task.alias && (
                            <span className="text-xs font-semibold text-text-secondary ml-1.5 opacity-80" title={`LCD Alias: ${task.alias}`}>
                              [{task.alias}]
                            </span>
                          )}
                        </h3>
                        {task.is_system && (
                          <span className="text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-wider bg-brand-orange/15 text-brand-orange border border-brand-orange/30">
                            {t('tasks.systemBadge', 'SYSTEM')}
                          </span>
                        )}
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-wider ${
                          task.schedule_type === 'recurring' ? 'bg-brand-blue/10 text-brand-blue border border-brand-blue/20' :
                          task.schedule_type === 'one_shot' ? 'bg-brand-orange/10 text-brand-orange border border-brand-orange/20' :
                          'bg-[var(--input-bg)] text-text-secondary border border-[var(--glass-border)]'
                        }`}>
                          {task.schedule_type === 'recurring' ? t('tasks.scheduleTypes.recurring', 'recurring') :
                           task.schedule_type === 'one_shot' ? t('tasks.scheduleTypes.oneShot', 'one-shot') :
                           task.schedule_type}
                        </span>
                        {exec?.retry_count > 0 && (
                          <span className="text-[9px] bg-brand-orange/20 text-brand-orange px-2 py-0.5 rounded font-black animate-pulse flex items-center gap-1">
                            ⚠️ RESCUED {exec.retry_count}/{task.retry_policy?.max_retries || '∞'}
                          </span>
                        )}
                        {task.retry_policy?.max_retries > 0 && (!exec || exec.retry_count === 0 || exec.status !== 'running') && (
                          <span className="text-[9px] bg-brand-blue/20 text-brand-blue border border-brand-blue/30 px-2 py-0.5 rounded font-black flex items-center gap-1" title={`Watchdog active (${task.retry_policy.max_retries} max retries)`}>
                            🛡️ WATCHDOG ({task.retry_policy.max_retries})
                          </span>
                        )}
                        {task.is_system ? (
                          <span 
                            title="Managed via Settings > General > Logging"
                            className="text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-wider border flex items-center gap-1.5 opacity-80 cursor-help bg-green-500/10 text-green-400 border-green-500/20"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>
                            {t('common.enabled', 'Active')}
                          </span>
                        ) : (
                          <button 
                            onClick={() => handleToggleTaskActive(task.id, task.is_active)}
                            className="text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-wider transition-all border flex items-center gap-1.5 bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/20"
                            title={t('tasks.disableTask', 'Disable Task')}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>
                            {t('common.enabled', 'Active')}
                          </button>
                        )}
                      </div>

                      <div className="text-xs text-text-secondary space-y-1">
                        {task.is_system ? (
                          <p className="truncate">
                            {t('tasks.systemActionLabel', 'System Action:')} <strong className="text-brand-orange font-medium">{t('tasks.systemLogTaskRoutine', 'Log Retention & Cleanup Routine')}</strong>
                          </p>
                        ) : (
                          <>
                            <p className="truncate">
                              {t('tasks.inputLabel', 'Input:')} <code className="text-[var(--text-primary)] font-mono">{formatInputDesc(task.input_config)}</code>
                            </p>
                            <p className="truncate">
                              {t('tasks.outputLabel', 'Output:')} <code className="text-[var(--text-primary)] font-mono">{formatOutputDesc(task.output_config)}</code>
                            </p>
                          </>
                        )}
                        {isRunning ? (
                          <div className="flex gap-x-3 gap-y-1 mt-1 text-xs text-text-secondary flex-wrap items-center font-mono tabular-nums">
                            <span>PID: <strong className="text-[var(--text-primary)] inline-block min-w-[5ch]">{exec.pid || 'N/A'}</strong></span>
                            <span className="opacity-20 select-none">|</span>
                            <span>CPU: <strong className="text-[var(--text-primary)] inline-block min-w-[4ch] text-right">{exec.cpu || 0}%</strong></span>
                            <span className="opacity-20 select-none">|</span>
                            <span>RAM: <strong className="text-[var(--text-primary)] inline-block min-w-[6ch] text-right">{exec.ram || 0} MB</strong></span>
                            {hasVideoTask(task) && exec.fps && exec.fps !== '0' && exec.fps !== '0.0' && exec.fps !== 'N/A' && (
                              <>
                                <span className="opacity-20 select-none">|</span>
                                <span>FPS: <strong className="text-[var(--text-primary)] inline-block min-w-[4ch] text-right">{exec.fps}</strong></span>
                              </>
                            )}
                            {exec.bitrate && exec.bitrate !== 'N/A' && exec.bitrate !== '0 kb/s' && exec.bitrate !== '0.0kbits/s' && (
                              <>
                                <span className="opacity-20 select-none">|</span>
                                <span>Bitrate: <strong className="text-[var(--text-primary)] inline-block min-w-[9ch] text-right">{exec.bitrate}</strong></span>
                              </>
                            )}
                            {exec.speed && exec.speed !== '0x' && exec.speed !== '0.00x' && exec.speed !== 'N/A' && (
                              <>
                                <span className="opacity-20 select-none">|</span>
                                <span>Speed: <strong className="text-[var(--text-primary)] inline-block min-w-[5ch] text-right">{exec.speed}</strong></span>
                              </>
                            )}
                          </div>
                        ) : (
                          <>
                            {task.schedule_type === 'recurring' && (
                              <p>
                                {t('tasks.cronExpressionLabel', 'Cron Expression:')} <code className="text-brand-lime font-mono">{task.schedule_cron}</code>
                              </p>
                            )}
                            {task.schedule_type === 'one_shot' && (
                              <p>
                                {t('tasks.targetDateLabel', 'Target Date:')} <strong className="text-[var(--text-primary)]">{new Date(task.schedule_datetime).toLocaleString()}</strong>
                              </p>
                            )}
                            {task.next_run && (
                              <p>
                                {t('tasks.nextExecutionLabel', 'Next execution:')} <strong className="text-brand-orange">{new Date(task.next_run).toLocaleString()}</strong>
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      {exec && !isRunning ? (
                        <div className="text-right hidden lg:block mr-2">
                          <div className="text-[10px] uppercase font-bold text-text-secondary tracking-widest">{t('tasks.lastExecutionLabel', 'Last Execution')}</div>
                          <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md mt-1 ${getStatusBadgeClass(exec.status)}`}>
                            {exec.status}
                          </span>
                        </div>
                      ) : null}

                      <button 
                        disabled={taskTriggerPending[task.id]}
                        onClick={() => viewTaskDetails(task.id)}
                        className="w-9 h-9 rounded-xl bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white border border-[var(--glass-border)] transition-all flex items-center justify-center disabled:opacity-50"
                        title={t('tasks.runHistory', 'View Run History')}
                      >
                        📜
                      </button>
                      
                      {isRunning ? (
                        <button 
                          disabled={execStopPending[exec.id]}
                          onClick={() => handleStopExecution(exec.id)}
                          className="w-9 h-9 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 flex items-center justify-center transition-all disabled:opacity-50"
                          title="Abort Execution"
                        >
                          {execStopPending[exec.id] ? (
                            <span className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <StopIcon size={16} />
                          )}
                        </button>
                      ) : (
                        <button 
                          disabled={taskTriggerPending[task.id]}
                          onClick={() => handleTriggerTask(task.id)}
                          className="w-9 h-9 rounded-xl bg-brand-lime/10 text-brand-lime hover:bg-brand-lime/20 border border-brand-lime/30 flex items-center justify-center transition-all disabled:opacity-50"
                          title="Run Now"
                        >
                          {taskTriggerPending[task.id] ? (
                            <span className="w-4 h-4 border-2 border-brand-lime border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <PlayIcon size={16} />
                          )}
                        </button>
                      )}

                      {!task.is_system && (
                        <>
                          <button 
                            disabled={taskTriggerPending[task.id]}
                            onClick={() => handleCloneTask(task)}
                            className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 transition-all hover:scale-105 disabled:opacity-50 disabled:pointer-events-none"
                            title="Clone Task"
                          >
                            <ClipboardIcon size={16} />
                          </button>

                          <button 
                            disabled={taskTriggerPending[task.id]}
                            onClick={async () => {
                              try {
                                const res = await fetch(`${API}/tasks/${task.id}/clone-as-service`, { method: 'POST' });
                                if (!res.ok) throw new Error('Failed to clone task as service');
                                alert(t('common.clonedSuccess', 'Cloned successfully!'));
                                fetchTasks();
                              } catch (err: any) {
                                alert(err.message || 'Error cloning task as service');
                              }
                            }}
                            className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 transition-all hover:scale-105 text-brand-orange disabled:opacity-50 disabled:pointer-events-none"
                            title={t('tasks.cloneAsService', 'Copy as Service')}
                          >
                            <ServerIcon size={16} />
                          </button>

                          <button 
                            disabled={taskTriggerPending[task.id]}
                            onClick={() => handleExportTask(task)}
                            className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 transition-all hover:scale-105 disabled:opacity-50 disabled:pointer-events-none"
                            title="Export Task"
                          >
                            <ExportIcon size={16} />
                          </button>

                          <button 
                            disabled={taskTriggerPending[task.id]}
                            onClick={() => handleEditClick(task)}
                            className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 transition-all hover:scale-105 disabled:opacity-50 disabled:pointer-events-none"
                            title="Edit Task"
                          >
                            <PencilIcon size={16} />
                          </button>

                          <button 
                            disabled={taskTriggerPending[task.id]}
                            onClick={() => handleDeleteTask(task.id)}
                            className="w-9 h-9 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 flex items-center justify-center border border-red-500/20 transition-all hover:scale-105 disabled:opacity-50 disabled:pointer-events-none"
                            title="Delete Task"
                          >
                            <TrashIcon size={16} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Configured Tasks (Disabled / Standby) */}
        <div className="glass-card p-4 md:p-5 bg-white/5 border-white/5">
          <h2 className="text-xl font-bold mb-3 text-text-secondary">{t('tasks.configuredTasksDisabled', 'Configured Tasks (Disabled / Standby)')}</h2>
          
          {loading ? (
            <div className="py-12 text-center text-text-secondary animate-pulse">{t('common.loading', 'Loading task configurations...')}</div>
          ) : tasks.filter(t => !t.is_active).length === 0 ? (
            <div className="py-12 text-center text-white/20 italic border border-dashed border-white/5 rounded-2xl">
              {t('tasks.noDisabledTasks', 'No disabled tasks.')}
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {tasks.filter(t => !t.is_active).map(task => {
                const isRunning = task.last_execution && (task.last_execution.status === 'running' || task.last_execution.status === 'retrying');
                const exec = task.last_execution;
                return (
                  <div 
                    key={task.id} 
                    className={`py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all px-2 opacity-75 hover:opacity-100 ${
                      isRunning
                        ? 'border border-brand-lime/30 rounded-xl bg-brand-lime/[0.02] px-3 my-1 shadow-sm shadow-brand-lime/5'
                        : task.is_system 
                          ? 'border border-white/10 rounded-xl bg-white/[0.01] px-3 my-1'
                          : 'hover:bg-white/[0.01]'
                    }`}
                  >
                    <div className="flex-1 space-y-0.5 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="font-bold text-lg truncate text-text-secondary">
                          {task.is_system && (task.name === 'System Log Rotation and Retention Cleanup' || task.command === 'system://log_rotate')
                            ? t('tasks.systemLogTaskName', 'System Log Rotation and Retention Cleanup')
                            : task.is_system && (task.name === 'System SSL/TLS Certificate Auto-Renewal Routine' || task.command === 'system://ssl_renew')
                            ? t('tasks.systemSslTaskName', 'System SSL/TLS Certificate Auto-Renewal Routine')
                            : task.name}
                          {task.alias && (
                            <span className="text-xs font-semibold text-text-secondary ml-1.5 opacity-80" title={`LCD Alias: ${task.alias}`}>
                              [{task.alias}]
                            </span>
                          )}
                        </h3>
                        {task.is_system && (
                          <span className="text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-wider bg-[var(--input-bg)] text-text-secondary border border-[var(--glass-border)]">
                            {t('tasks.systemBadge', 'SYSTEM')}
                          </span>
                        )}
                        <span className="text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-wider bg-[var(--input-bg)] text-text-secondary border border-[var(--glass-border)]">
                          {task.schedule_type === 'recurring' ? t('tasks.scheduleTypes.recurring', 'recurring') :
                           task.schedule_type === 'one_shot' ? t('tasks.scheduleTypes.oneShot', 'one-shot') :
                           task.schedule_type}
                        </span>
                        {exec?.retry_count > 0 && (
                          <span className="text-[9px] bg-brand-orange/20 text-brand-orange px-2 py-0.5 rounded font-black animate-pulse flex items-center gap-1">
                            ⚠️ RESCUED {exec.retry_count}/{task.retry_policy?.max_retries || '∞'}
                          </span>
                        )}
                        {task.retry_policy?.max_retries > 0 && (!exec || exec.retry_count === 0 || exec.status !== 'running') && (
                          <span className="text-[9px] bg-brand-blue/20 text-brand-blue border border-brand-blue/30 px-2 py-0.5 rounded font-black flex items-center gap-1" title={`Watchdog active (${task.retry_policy.max_retries} max retries)`}>
                            🛡️ WATCHDOG ({task.retry_policy.max_retries})
                          </span>
                        )}
                        {task.is_system ? (
                          <span 
                            title="Managed via Settings > General > Logging"
                            className="text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-wider border flex items-center gap-1.5 opacity-80 cursor-help bg-[var(--input-bg)] text-text-secondary border border-[var(--glass-border)]"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-white/20"></span>
                            {t('common.disabled', 'Disabled')}
                          </span>
                        ) : (
                          <button 
                            onClick={() => handleToggleTaskActive(task.id, task.is_active)}
                            className="text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-wider transition-all border flex items-center gap-1.5 bg-[var(--input-bg)] text-text-secondary border border-[var(--glass-border)] hover:bg-white/10"
                            title={t('tasks.enableTask', 'Enable Task')}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-white/20"></span>
                            {t('common.disabled', 'Disabled')}
                          </button>
                        )}
                      </div>

                      <div className="text-xs text-text-secondary space-y-1">
                        {task.is_system ? (
                          <p className="truncate">
                            {t('tasks.systemActionLabel', 'System Action:')} <strong className="text-text-secondary font-medium">{t('tasks.systemLogTaskRoutine', 'Log Retention & Cleanup Routine')}</strong>
                          </p>
                        ) : (
                          <>
                            <p className="truncate">
                              {t('tasks.inputLabel', 'Input:')} <code className="text-text-secondary font-mono">{formatInputDesc(task.input_config)}</code>
                            </p>
                            <p className="truncate">
                              {t('tasks.outputLabel', 'Output:')} <code className="text-text-secondary font-mono">{formatOutputDesc(task.output_config)}</code>
                            </p>
                          </>
                        )}
                        {isRunning ? (
                          <div className="flex gap-x-3 gap-y-1 mt-1 text-xs text-text-secondary flex-wrap items-center font-mono tabular-nums">
                            <span>PID: <strong className="text-[var(--text-primary)] inline-block min-w-[5ch]">{exec.pid || 'N/A'}</strong></span>
                            <span className="opacity-20 select-none">|</span>
                            <span>CPU: <strong className="text-[var(--text-primary)] inline-block min-w-[4ch] text-right">{exec.cpu || 0}%</strong></span>
                            <span className="opacity-20 select-none">|</span>
                            <span>RAM: <strong className="text-[var(--text-primary)] inline-block min-w-[6ch] text-right">{exec.ram || 0} MB</strong></span>
                            {hasVideoTask(task) && exec.fps && exec.fps !== '0' && exec.fps !== '0.0' && exec.fps !== 'N/A' && (
                              <>
                                <span className="opacity-20 select-none">|</span>
                                <span>FPS: <strong className="text-[var(--text-primary)] inline-block min-w-[4ch] text-right">{exec.fps}</strong></span>
                              </>
                            )}
                            {exec.bitrate && exec.bitrate !== 'N/A' && exec.bitrate !== '0 kb/s' && exec.bitrate !== '0.0kbits/s' && (
                              <>
                                <span className="opacity-20 select-none">|</span>
                                <span>Bitrate: <strong className="text-[var(--text-primary)] inline-block min-w-[9ch] text-right">{exec.bitrate}</strong></span>
                              </>
                            )}
                            {exec.speed && exec.speed !== '0x' && exec.speed !== '0.00x' && exec.speed !== 'N/A' && (
                              <>
                                <span className="opacity-20 select-none">|</span>
                                <span>Speed: <strong className="text-[var(--text-primary)] inline-block min-w-[5ch] text-right">{exec.speed}</strong></span>
                              </>
                            )}
                          </div>
                        ) : (
                          <>
                            {task.schedule_type === 'recurring' && (
                              <p>
                                {t('tasks.cronExpressionLabel', 'Cron Expression:')} <code className="text-text-secondary font-mono">{task.schedule_cron}</code>
                              </p>
                            )}
                            {task.schedule_type === 'one_shot' && (
                              <p>
                                {t('tasks.targetDateLabel', 'Target Date:')} <strong className="text-text-secondary">{new Date(task.schedule_datetime).toLocaleString()}</strong>
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      {exec && !isRunning ? (
                        <div className="text-right hidden lg:block mr-2">
                          <div className="text-[10px] uppercase font-bold text-text-secondary tracking-widest">{t('tasks.lastExecutionLabel', 'Last Execution')}</div>
                          <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md mt-1 ${getStatusBadgeClass(exec.status)}`}>
                            {exec.status}
                          </span>
                        </div>
                      ) : null}

                      <button 
                        disabled={taskTriggerPending[task.id]}
                        onClick={() => viewTaskDetails(task.id)}
                        className="w-9 h-9 rounded-xl bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white border border-[var(--glass-border)] transition-all flex items-center justify-center disabled:opacity-50"
                        title={t('tasks.runHistory', 'View Run History')}
                      >
                        📜
                      </button>
                      
                      {isRunning ? (
                        <button 
                          disabled={execStopPending[exec.id]}
                          onClick={() => handleStopExecution(exec.id)}
                          className="w-9 h-9 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 flex items-center justify-center transition-all disabled:opacity-50"
                          title="Abort Execution"
                        >
                          {execStopPending[exec.id] ? (
                            <span className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <StopIcon size={16} />
                          )}
                        </button>
                      ) : (
                        <button 
                          disabled={taskTriggerPending[task.id]}
                          onClick={() => handleTriggerTask(task.id)}
                          className="w-9 h-9 rounded-xl bg-brand-lime/10 text-brand-lime hover:bg-brand-lime/20 border border-brand-lime/30 flex items-center justify-center transition-all disabled:opacity-50"
                          title="Run Now"
                        >
                          {taskTriggerPending[task.id] ? (
                            <span className="w-4 h-4 border-2 border-brand-lime border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <PlayIcon size={16} />
                          )}
                        </button>
                      )}

                      {!task.is_system && (
                        <>
                          <button 
                            disabled={taskTriggerPending[task.id]}
                            onClick={() => handleCloneTask(task)}
                            className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 transition-all hover:scale-105 disabled:opacity-50 disabled:pointer-events-none"
                            title="Clone Task"
                          >
                            <ClipboardIcon size={16} />
                          </button>

                          <button 
                            disabled={taskTriggerPending[task.id]}
                            onClick={async () => {
                              try {
                                const res = await fetch(`${API}/tasks/${task.id}/clone-as-service`, { method: 'POST' });
                                if (!res.ok) throw new Error('Failed to clone task as service');
                                alert(t('common.clonedSuccess', 'Cloned successfully!'));
                                fetchTasks();
                              } catch (err: any) {
                                alert(err.message || 'Error cloning task as service');
                              }
                            }}
                            className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 transition-all hover:scale-105 text-brand-orange disabled:opacity-50 disabled:pointer-events-none"
                            title={t('tasks.cloneAsService', 'Copy as Service')}
                          >
                            <ServerIcon size={16} />
                          </button>

                          <button 
                            disabled={taskTriggerPending[task.id]}
                            onClick={() => handleExportTask(task)}
                            className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 transition-all hover:scale-105 disabled:opacity-50 disabled:pointer-events-none"
                            title="Export Task"
                          >
                            <ExportIcon size={16} />
                          </button>

                          <button 
                            disabled={taskTriggerPending[task.id]}
                            onClick={() => handleEditClick(task)}
                            className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 transition-all hover:scale-105 disabled:opacity-50 disabled:pointer-events-none"
                            title="Edit Task"
                          >
                            <PencilIcon size={16} />
                          </button>

                          <button 
                            disabled={taskTriggerPending[task.id]}
                            onClick={() => handleDeleteTask(task.id)}
                            className="w-9 h-9 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 flex items-center justify-center border border-red-500/20 transition-all hover:scale-105 disabled:opacity-50 disabled:pointer-events-none"
                            title="Delete Task"
                          >
                            <TrashIcon size={16} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* TASK DETAIL / HISTORY SIDE/MODAL WINDOW */}
      {selectedTaskDetails && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-6 z-40">
          <div className="glass-card w-full max-w-4xl p-8 relative max-h-[85vh] overflow-y-auto">
            <button 
              onClick={() => setSelectedTaskDetails(null)}
              className="absolute top-6 right-6 text-text-secondary hover:text-white text-xl"
            >
              ✕
            </button>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pr-8">
              <div>
                <h3 className="text-2xl font-black mb-1">
                  {selectedTaskDetails.task.name}
                  {selectedTaskDetails.task.alias && (
                    <span className="text-sm font-semibold text-text-secondary ml-2 opacity-80" title={`LCD Alias: ${selectedTaskDetails.task.alias}`}>
                      [{selectedTaskDetails.task.alias}]
                    </span>
                  )}
                </h3>
                <p className="text-text-secondary text-sm">Execution History & Diagnostics</p>
              </div>

              {selectedTaskDetails.executions.length > 0 && (
                <button
                  onClick={() => handleClearTaskHistory(selectedTaskDetails.task.id)}
                  className="px-3.5 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold border border-red-500/20 flex items-center gap-2 transition-all self-start sm:self-auto"
                  title={t('tasks.clearHistory', 'Clear History')}
                >
                  <TrashIcon size={14} />
                  {t('tasks.clearHistory', 'CLEAR HISTORY')}
                </button>
              )}
            </div>

            <div className="space-y-4">
              {selectedTaskDetails.executions.length === 0 ? (
                <div className="py-12 text-center text-text-secondary italic">This task has not been executed yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-white/5 text-text-secondary font-bold">
                        <th className="pb-3">ID</th>
                        <th className="pb-3">Status</th>
                        <th className="pb-3">Started</th>
                        <th className="pb-3">Stopped</th>
                        <th className="pb-3">Exit Code</th>
                        <th className="pb-3">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {selectedTaskDetails.executions.map((exec: any) => (
                        <tr key={exec.id} className="hover:bg-white/[0.01]">
                          <td className="py-3 font-mono text-white/50">#{exec.id}</td>
                          <td className="py-3">
                            <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md ${getStatusBadgeClass(exec.status)}`}>
                              {exec.status}
                            </span>
                          </td>
                          <td className="py-3 text-xs">{exec.started_at ? new Date(exec.started_at).toLocaleString() : 'N/A'}</td>
                          <td className="py-3 text-xs">{exec.stopped_at ? new Date(exec.stopped_at).toLocaleString() : 'N/A'}</td>
                          <td className="py-3 font-mono text-xs">{exec.exit_code !== null ? exec.exit_code : '-'}</td>
                          <td className="py-3">
                            <div className="flex gap-2">
                              <button 
                                onClick={() => setViewingLogsExecutionId(exec.id)}
                                className="text-brand-lime text-xs font-bold hover:underline"
                              >
                                View Logs
                              </button>
                              {exec.error_message && (
                                <span className="text-red-400 text-xs italic block truncate max-w-[200px]" title={exec.error_message}>
                                  — {exec.error_message}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* LIVE LOGGER CLI MODAL */}
      {viewingLogsExecutionId !== null && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 md:p-8 z-50">
          <div 
            className="glass-card w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden relative border border-white/10"
          >
            {(() => {
              const activeExec = taskExecutions.find(e => e.id === viewingLogsExecutionId);
              const taskConfig = tasks.find(t => t.id === activeExec?.task_id);
              const hasVideo = taskConfig ? taskConfig.input_config?.has_video !== false : true;
              const isRunning = activeExec?.status === 'running';
              const showPreview = isRunning && hasVideo;
              
              const title = taskConfig ? taskConfig.name : `Task Execution #${viewingLogsExecutionId}`;
              const status = activeExec ? activeExec.status : 'finished';

              return (
                <>
                  {/* Header */}
                  <div className="p-6 border-b border-white/5 flex justify-between items-center flex-shrink-0 bg-white/2">
                    <div>
                      <h3 className="text-2xl font-black uppercase tracking-tight">{title}</h3>
                      <p className="text-text-secondary text-xs uppercase tracking-wider mt-0.5">
                        {showPreview ? 'Live Task Preview (MJPEG)' : 'Task Execution Status & Logs'}
                      </p>
                    </div>
                    <button 
                      onClick={() => { setViewingLogsExecutionId(null); setLogs([]); }}
                      className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center text-text-secondary hover:text-white transition-colors"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Scrollable Body */}
                  <div className="flex-1 overflow-y-auto p-6 space-y-6 min-h-0 custom-scrollbar">
                    {showPreview ? (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                        {/* Col 1: System Telemetry Stats */}
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div className="bg-white/5 border border-white/5 rounded-2xl p-4 text-center">
                              <div className="text-[10px] uppercase font-bold text-text-secondary mb-1">Status</div>
                              <div className="font-black text-sm tracking-tight text-brand-lime">
                                RUNNING
                              </div>
                            </div>
                            <div className="bg-white/5 border border-white/5 rounded-2xl p-4 text-center">
                              <div className="text-[10px] uppercase font-bold text-text-secondary mb-1">Bitrate</div>
                              <div className="font-bold font-mono text-sm">{activeExec?.bitrate || '0 kb/s'}</div>
                            </div>
                            <div className="bg-white/5 border border-white/5 rounded-2xl p-4 text-center">
                              <div className="text-[10px] uppercase font-bold text-text-secondary mb-1">FPS</div>
                              <div className="font-bold font-mono text-sm">{activeExec?.fps || '0'}</div>
                            </div>
                            <div className="bg-white/5 border border-white/5 rounded-2xl p-4 text-center">
                              <div className="text-[10px] uppercase font-bold text-text-secondary mb-1">Speed</div>
                              <div className="font-bold font-mono text-sm">{activeExec?.speed || '0x'}</div>
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-4">
                            <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex justify-between items-center">
                              <span className="text-[10px] uppercase font-black text-text-secondary">PID</span>
                              <span className="font-mono font-bold text-[var(--text-primary)]">{activeExec?.pid || 'N/A'}</span>
                            </div>
                            <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex justify-between items-center">
                              <span className="text-[10px] uppercase font-black text-text-secondary">CPU</span>
                              <span className="font-mono font-bold text-brand-lime">{activeExec?.cpu || 0}%</span>
                            </div>
                            <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex justify-between items-center">
                              <span className="text-[10px] uppercase font-black text-text-secondary">RAM</span>
                              <span className="font-mono font-bold text-brand-orange">{activeExec?.ram || 0} MB</span>
                            </div>
                          </div>
                        </div>

                        {/* Col 2: Live Video Preview */}
                        <div className="flex flex-col justify-center">
                          <div className="aspect-video bg-black rounded-2xl overflow-hidden border border-white/5 flex items-center justify-center relative shadow-2xl">
                            <img 
                              src={`${API}/tasks/executions/${viewingLogsExecutionId}/preview`} 
                              alt="Live Preview" 
                              className="max-h-full max-w-full object-contain" 
                            />
                            <div className="absolute top-3 left-3 px-2.5 py-1 bg-brand-lime text-black text-[9px] font-black rounded-md tracking-wider uppercase animate-pulse">
                              LIVE
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="max-w-3xl mx-auto space-y-4">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                          <div className="bg-white/5 border border-white/5 rounded-2xl p-4 text-center">
                            <div className="text-[10px] uppercase font-bold text-text-secondary mb-1">Status</div>
                            <div className={`font-black text-sm tracking-tight ${status === 'finished' ? 'text-blue-400' : status === 'error' ? 'text-red-400' : 'text-white/60'}`}>
                              {status.toUpperCase()}
                            </div>
                          </div>
                          <div className="bg-white/5 border border-white/5 rounded-2xl p-4 text-center">
                            <div className="text-[10px] uppercase font-bold text-text-secondary mb-1">Bitrate</div>
                            <div className="font-bold font-mono text-sm">{activeExec?.bitrate || '0 kb/s'}</div>
                          </div>
                          <div className="bg-white/5 border border-white/5 rounded-2xl p-4 text-center">
                            <div className="text-[10px] uppercase font-bold text-text-secondary mb-1">FPS</div>
                            <div className="font-bold font-mono text-sm">{activeExec?.fps || '0'}</div>
                          </div>
                          <div className="bg-white/5 border border-white/5 rounded-2xl p-4 text-center">
                            <div className="text-[10px] uppercase font-bold text-text-secondary mb-1">Speed</div>
                            <div className="font-bold font-mono text-sm">{activeExec?.speed || '0x'}</div>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                          <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex justify-between items-center">
                            <span className="text-[10px] uppercase font-black text-text-secondary">PID</span>
                            <span className="font-mono font-bold text-[var(--text-primary)]">{activeExec?.pid || 'N/A'}</span>
                          </div>
                          <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex justify-between items-center">
                            <span className="text-[10px] uppercase font-black text-text-secondary">CPU</span>
                            <span className="font-mono font-bold text-brand-lime">{activeExec?.cpu || 0}%</span>
                          </div>
                          <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex justify-between items-center">
                            <span className="text-[10px] uppercase font-black text-text-secondary">RAM</span>
                            <span className="font-mono font-bold text-brand-orange">{activeExec?.ram || 0} MB</span>
                          </div>
                        </div>

                        {!hasVideo && isRunning && (
                          <div className="p-5 bg-brand-blue/10 border border-brand-blue/20 rounded-2xl flex items-center gap-4 animate-in fade-in duration-300">
                            <span className="text-brand-blue flex-shrink-0">
                              <SourceIcon size={24} />
                            </span>
                            <div>
                              <div className="font-bold text-brand-blue uppercase text-xs tracking-wider">Audio-Only Task Active</div>
                              <div className="text-xs text-text-secondary mt-0.5">This execution does not produce video outputs. Audio signals are processing normally.</div>
                            </div>
                          </div>
                        )}
 
                        {!isRunning && (
                          <div className="p-5 bg-white/2 border border-white/5 rounded-2xl flex items-center gap-4 text-text-secondary">
                            <span className="text-text-secondary flex-shrink-0">
                              <StopIcon size={24} />
                            </span>
                            <div>
                              <div className="font-bold uppercase text-xs tracking-wider">Execution Inactive</div>
                              <div className="text-xs mt-0.5">This task execution has finished running or has been stopped.</div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Terminal logs */}
                    <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-2xl p-4 font-mono text-xs max-w-5xl mx-auto w-full">
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-brand-lime font-bold uppercase tracking-wider text-[10px]">Execution Logs</span>
                        <span className="text-text-secondary text-[10px] font-bold">{logs.length} lines buffered</span>
                      </div>
                      <div 
                        ref={logsContainerRef}
                        className="h-44 space-y-1 custom-scrollbar pr-2 select-text overflow-y-auto"
                      >
                        {logs.length === 0 ? (
                          <div className="text-text-secondary opacity-40 italic text-center py-10 select-none">No logs available for this task execution</div>
                        ) : (
                          logs.map((log) => (
                            <div key={log.id} className="leading-relaxed whitespace-pre-wrap flex gap-4">
                              <span className="text-text-secondary select-none">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                              <span className={log.level === 'error' ? 'text-red-400 font-bold' : log.level === 'warning' ? 'text-brand-orange' : 'text-[var(--text-primary)]'}>
                                {log.message}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="p-6 border-t border-white/5 flex-shrink-0 bg-white/2 flex justify-end items-center gap-3">
                    {isRunning && (
                      <button 
                        onClick={() => handleStopExecution(viewingLogsExecutionId)}
                        className="pill-button bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs font-bold py-2 px-6 border border-red-500/25"
                      >
                        ABORT TASK
                      </button>
                    )}
                    <button 
                      onClick={() => { setViewingLogsExecutionId(null); setLogs([]); }}
                      className="pill-button bg-white/5 hover:bg-white/10 text-xs border border-white/10 py-2 px-6"
                    >
                      CLOSE
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* CREATE / EDIT TASK MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="glass-card w-full max-w-4xl p-5 border-brand-orange/20 shadow-2xl relative max-h-[95vh] flex flex-col overflow-hidden">
            <button 
              onClick={() => {
                setShowAddModal(false);
                setEditingTask(null);
              }}
              className="absolute top-4 right-4 w-6 h-6 bg-white/10 rounded-full flex items-center justify-center text-text-secondary hover:text-white hover:bg-white/20 transition-all z-10 text-xs"
            >
              ✕
            </button>
            
            <h3 className="text-base font-bold mb-3 flex-shrink-0 tracking-wide uppercase text-brand-lime">
              {editingTask ? 'Edit Scheduled Task' : 'New Scheduled Task'}
            </h3>

            <ProcessConfigForm
              isTask={true}
              initialConfig={editingTask}
              onCancel={() => {
                setShowAddModal(false);
                setEditingTask(null);
              }}
              onSubmit={handleSaveTask}
            />
          </div>
        </div>
      )}

    </div>
  );
};
