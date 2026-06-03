import React, { useState, useEffect, useRef } from 'react';

interface ScheduledTasksProps {
  API: string;
  taskExecutions: any[]; // Active executions from websocket telemetry
}

export const ScheduledTasks: React.FC<ScheduledTasksProps> = ({ API, taskExecutions }) => {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingTask, setEditingTask] = useState<any | null>(null);
  const [selectedTaskDetails, setSelectedTaskDetails] = useState<any | null>(null);
  const [viewingLogsExecutionId, setViewingLogsExecutionId] = useState<number | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  // Available builds
  const [availableBuilds, setAvailableBuilds] = useState<any[]>([]);

  // Logs autoscroll reference
  const logsContainerRef = useRef<HTMLDivElement>(null);

  // Task form state
  const [taskForm, setTaskForm] = useState({
    name: '',
    is_active: true,
    input_path: '',
    has_video: true,
    has_audio: false,
    output_path: '',
    vcodec: 'libx264',
    acodec: 'aac',
    vbitrate: '4000k',
    ffmpeg_build_id: '' as string | number,
    threads: 0,
    schedule_type: 'manual', // manual, one_shot, recurring
    schedule_cron: '*/30 * * * *',
    schedule_datetime: '',
    duration_type: 'input_dependent', // input_dependent, timer
    duration_seconds: 60,
    retry_max: 3,
    retry_delay: 10
  });

  const fetchTasks = async () => {
    try {
      setLoading(true);
      const r = await fetch(`${API}/tasks`);
      if (!r.ok) throw new Error('Failed to load tasks');
      setTasks(await r.json());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchBuilds = async () => {
    try {
      const r = await fetch(`${API}/builds`);
      if (r.ok) {
        const data = await r.json();
        const ready = data.filter((b: any) => b.status === 'ready');
        setAvailableBuilds(ready);
        const def = ready.find((b: any) => b.is_default);
        if (def && !taskForm.ffmpeg_build_id) {
          setTaskForm(prev => ({ ...prev, ffmpeg_build_id: def.id }));
        }
      }
    } catch {}
  };

  useEffect(() => {
    fetchTasks();
    fetchBuilds();
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

  // Poll task details if open (to get updated execution list)
  useEffect(() => {
    if (!selectedTaskDetails) return;
    const timer = setInterval(() => {
      viewTaskDetails(selectedTaskDetails.task.id);
    }, 3000);
    return () => clearInterval(timer);
  }, [selectedTaskDetails]);

  // Handle Save (Create / Update)
  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      name: taskForm.name,
      is_active: taskForm.is_active,
      input_config: {
        input1: {
          type: (taskForm.input_path.startsWith('testsrc') || taskForm.input_path.startsWith('sine')) ? 'lavfi' : 'file',
          path: taskForm.input_path
        },
        has_video: taskForm.has_video,
        has_audio: taskForm.has_audio
      },
      output_config: {
        type: 'file',
        path: taskForm.output_path
      },
      codec_config: {
        vcodec: taskForm.vcodec,
        acodec: taskForm.acodec,
        bitrate: taskForm.vbitrate
      },
      filter_config: taskForm.threads ? { advanced: { threads: taskForm.threads } } : null,
      ffmpeg_build_id: taskForm.ffmpeg_build_id ? Number(taskForm.ffmpeg_build_id) : null,
      schedule_type: taskForm.schedule_type,
      schedule_cron: taskForm.schedule_type === 'recurring' ? taskForm.schedule_cron : null,
      schedule_datetime: taskForm.schedule_type === 'one_shot' && taskForm.schedule_datetime ? new Date(taskForm.schedule_datetime).toISOString() : null,
      duration_type: taskForm.duration_type,
      duration_seconds: taskForm.duration_type === 'timer' ? Number(taskForm.duration_seconds) : null,
      retry_policy: {
        max_retries: Number(taskForm.retry_max),
        retry_delay: Number(taskForm.retry_delay)
      }
    };

    try {
      const url = editingTask ? `${API}/tasks/${editingTask.id}` : `${API}/tasks`;
      const method = editingTask ? 'PUT' : 'POST';
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
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
    setTaskForm({
      name: task.name,
      is_active: task.is_active,
      input_path: task.input_config?.input1?.path || '',
      has_video: task.input_config?.has_video !== false,
      has_audio: !!task.input_config?.has_audio,
      output_path: task.output_config?.path || '',
      vcodec: task.codec_config?.vcodec || 'libx264',
      acodec: task.codec_config?.acodec || 'aac',
      vbitrate: task.codec_config?.bitrate || '4000k',
      ffmpeg_build_id: task.ffmpeg_build_id || '',
      threads: task.filter_config?.advanced?.threads || 0,
      schedule_type: task.schedule_type,
      schedule_cron: task.schedule_cron || '*/30 * * * *',
      schedule_datetime: task.schedule_datetime ? task.schedule_datetime.substring(0, 16) : '',
      duration_type: task.duration_type || 'input_dependent',
      duration_seconds: task.duration_seconds || 60,
      retry_max: task.retry_policy?.max_retries || 3,
      retry_delay: task.retry_policy?.retry_delay || 10
    });
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
    try {
      const r = await fetch(`${API}/tasks/${taskId}/trigger`, { method: 'POST' });
      if (r.ok) {
        fetchTasks();
        alert('Execution triggered successfully!');
      }
    } catch {}
  };

  const handleStopExecution = async (execId: number) => {
    try {
      const r = await fetch(`${API}/tasks/executions/${execId}/stop`, { method: 'POST' });
      if (r.ok) {
        alert('Task execution stop signal sent.');
      }
    } catch {}
  };

  const handleExportTasks = async () => {
    try {
      const r = await fetch(`${API}/tasks/export`);
      if (r.ok) {
        const blob = await r.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ffmpeg_scheduled_tasks_${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch {}
  };

  const handleImportTasks = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const parsed = JSON.parse(importJson);
      const r = await fetch(`${API}/tasks/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed)
      });
      if (!r.ok) {
        throw new Error('Failed to import tasks config.');
      }
      setIsImportOpen(false);
      setImportJson('');
      setImportError(null);
      fetchTasks();
      alert('Tasks imported successfully!');
    } catch (err: any) {
      setImportError(err.message);
    }
  };

  const handleToggleActive = async (task: any) => {
    try {
      const r = await fetch(`${API}/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !task.is_active })
      });
      if (r.ok) {
        fetchTasks();
      }
    } catch {}
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
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* HEADER */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h1 className="text-4xl font-black tracking-tight text-white uppercase bg-gradient-to-r from-white via-white to-white/40 bg-clip-text text-transparent">
            Task Scheduling
          </h1>
          <p className="text-text-secondary mt-1">Automate batch jobs, recurring feeds and cron conversions.</p>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={handleExportTasks} 
            className="pill-button bg-white/5 border border-white/10 text-white hover:bg-white/10 text-sm py-2.5 px-6"
          >
            📥 EXPORT
          </button>
          <button 
            onClick={() => { setIsImportOpen(true); setImportError(null); }} 
            className="pill-button bg-white/5 border border-white/10 text-white hover:bg-white/10 text-sm py-2.5 px-6"
          >
            📤 IMPORT
          </button>
          <button 
            onClick={() => {
              setEditingTask(null);
              setTaskForm({
                name: '',
                is_active: true,
                input_path: '',
                has_video: true,
                has_audio: false,
                output_path: '',
                vcodec: 'libx264',
                acodec: 'aac',
                vbitrate: '4000k',
                ffmpeg_build_id: availableBuilds.find(b => b.is_default)?.id || '',
                threads: 0,
                schedule_type: 'manual',
                schedule_cron: '*/30 * * * *',
                schedule_datetime: '',
                duration_type: 'input_dependent',
                duration_seconds: 60,
                retry_max: 3,
                retry_delay: 10
              });
              setShowAddModal(true);
            }}
            className="pill-button bg-brand-lime text-black font-black text-sm py-2.5 px-6 shadow-lg shadow-brand-lime/20"
          >
            + CREATE TASK
          </button>
        </div>
      </header>

      {/* METRIC CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <div className="glass-card p-6 bg-white/5 border-white/5 flex flex-col justify-between">
          <span className="text-xs uppercase font-bold tracking-wider text-text-secondary">Total Tasks</span>
          <span className="text-4xl font-black text-white mt-4">{totalTasks}</span>
        </div>
        <div className="glass-card p-6 bg-white/5 border-white/5 flex flex-col justify-between">
          <span className="text-xs uppercase font-bold tracking-wider text-text-secondary">Active Timers</span>
          <span className="text-4xl font-black text-brand-orange mt-4">{activeTasks}</span>
        </div>
        <div className="glass-card p-6 bg-white/5 border-white/5 flex flex-col justify-between">
          <span className="text-xs uppercase font-bold tracking-wider text-text-secondary">Recurring Cron</span>
          <span className="text-4xl font-black text-brand-blue mt-4">{recurringTasks}</span>
        </div>
        <div className="glass-card p-6 bg-white/5 border-white/5 flex flex-col justify-between">
          <span className="text-xs uppercase font-bold tracking-wider text-text-secondary">Active Executions</span>
          <span className="text-4xl font-black text-brand-lime mt-4 flex items-center gap-3">
            {runningExecutions}
            {runningExecutions > 0 && <span className="w-2.5 h-2.5 rounded-full bg-brand-lime animate-pulse"></span>}
          </span>
        </div>
      </div>

      {/* ACTIVE RUNNING EXECUTIONS ROW */}
      {taskExecutions.length > 0 && (
        <div className="glass-card p-6 bg-brand-lime/5 border-brand-lime/20 animate-in fade-in slide-in-from-top-2 duration-300">
          <h3 className="text-sm font-black uppercase text-brand-lime tracking-widest mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-brand-lime animate-ping"></span>
            Realtime Execution Monitor
          </h3>
          <div className="space-y-4">
            {taskExecutions.map(exec => (
              <div key={exec.id} className="flex flex-col md:flex-row md:items-center justify-between p-4 bg-white/5 rounded-xl border border-white/5 gap-4">
                <div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-white">{exec.task_name}</span>
                    <span className="text-xs font-mono text-white/40">#run-{exec.id}</span>
                  </div>
                  <div className="flex gap-4 mt-2 text-xs text-text-secondary">
                    <span>CPU: <strong className="text-white">{exec.cpu}%</strong></span>
                    <span>RAM: <strong className="text-white">{exec.ram} MB</strong></span>
                    {exec.fps && <span>FPS: <strong className="text-white">{exec.fps}</strong></span>}
                    {exec.bitrate && <span>Bitrate: <strong className="text-white">{exec.bitrate}</strong></span>}
                    {exec.speed && <span>Speed: <strong className="text-white">{exec.speed}</strong></span>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => setViewingLogsExecutionId(exec.id)}
                    className="pill-button bg-white/10 hover:bg-white/15 text-xs py-1.5 px-4"
                  >
                    CLI LOGS
                  </button>
                  <button 
                    onClick={() => handleStopExecution(exec.id)}
                    className="pill-button bg-red-500 text-white font-bold hover:bg-red-600 text-xs py-1.5 px-4"
                  >
                    ABORT
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TASKS LIST */}
      <div className="glass-card p-6 md:p-8 bg-white/5 border-white/5">
        <h2 className="text-xl font-bold mb-6">Task Job Configurations</h2>
        
        {loading ? (
          <div className="py-20 text-center text-text-secondary animate-pulse">Loading task configurations...</div>
        ) : error ? (
          <div className="py-12 text-center text-red-400 font-bold border border-red-500/20 rounded-2xl bg-red-500/5">{error}</div>
        ) : tasks.length === 0 ? (
          <div className="py-20 text-center text-white/20 italic border border-dashed border-white/5 rounded-2xl">
            No scheduled tasks defined. Click "Create Task" to configure your first automated FFmpeg run.
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {tasks.map(task => (
              <div key={task.id} className="py-6 flex flex-col md:flex-row md:items-center justify-between gap-6 hover:bg-white/[0.01] transition-all px-2">
                <div className="flex-1 space-y-1.5 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="font-bold text-lg text-white truncate">{task.name}</h3>
                    <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider ${
                      task.schedule_type === 'recurring' ? 'bg-brand-blue/10 text-brand-blue border border-brand-blue/20' :
                      task.schedule_type === 'one_shot' ? 'bg-brand-orange/10 text-brand-orange border border-brand-orange/20' :
                      'bg-white/5 text-white/40 border border-white/10'
                    }`}>
                      {task.schedule_type}
                    </span>
                    <button 
                      onClick={() => handleToggleActive(task)}
                      className={`text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider transition-all border ${
                        task.is_active 
                          ? 'bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/20' 
                          : 'bg-white/5 text-white/30 border-white/10 hover:bg-white/10'
                      }`}
                    >
                      {task.is_active ? '● Active' : '○ Disabled'}
                    </button>
                  </div>

                  <div className="text-xs text-text-secondary space-y-1">
                    <p className="truncate">
                      Input: <code className="text-white font-mono">{task.input_config?.input1?.path || 'N/A'}</code>
                    </p>
                    <p className="truncate">
                      Output: <code className="text-white font-mono">{task.output_config?.path || 'N/A'}</code>
                    </p>
                    {task.schedule_type === 'recurring' && (
                      <p>
                        Cron Expression: <code className="text-brand-lime font-mono">{task.schedule_cron}</code>
                      </p>
                    )}
                    {task.schedule_type === 'one_shot' && (
                      <p>
                        Target Date: <strong className="text-white">{new Date(task.schedule_datetime).toLocaleString()}</strong>
                      </p>
                    )}
                    {task.is_active && task.next_run && (
                      <p>
                        Next execution: <strong className="text-brand-orange">{new Date(task.next_run).toLocaleString()}</strong>
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {task.last_execution ? (
                    <div className="text-right hidden lg:block mr-2">
                      <div className="text-[10px] uppercase font-bold text-text-secondary tracking-widest">Last Execution</div>
                      <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md mt-1 ${getStatusBadgeClass(task.last_execution.status)}`}>
                        {task.last_execution.status}
                      </span>
                    </div>
                  ) : null}

                  <button 
                    onClick={() => viewTaskDetails(task.id)}
                    className="pill-button bg-white/5 hover:bg-white/10 text-white text-xs py-2 px-4 border border-white/5"
                  >
                    RUN HISTORY
                  </button>
                  
                  <button 
                    onClick={() => handleTriggerTask(task.id)}
                    className="pill-button bg-brand-lime/10 hover:bg-brand-lime text-brand-lime hover:text-black text-xs py-2 px-4 border border-brand-lime/20"
                  >
                    ⚡ RUN NOW
                  </button>
                  
                  <button 
                    onClick={() => handleEditClick(task)}
                    className="pill-button bg-white/5 hover:bg-white/10 text-xs p-2 rounded-xl"
                    title="Edit Task"
                  >
                    ✏️
                  </button>

                  <button 
                    onClick={() => handleDeleteTask(task.id)}
                    className="pill-button bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs p-2 rounded-xl"
                    title="Delete Task"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
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
            <h3 className="text-2xl font-black mb-1">{selectedTaskDetails.task.name}</h3>
            <p className="text-text-secondary text-sm mb-6">Execution History & Diagnostics</p>

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
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center p-6 z-50">
          <div className="glass-card w-full max-w-4xl p-8 relative flex flex-col h-[80vh]">
            <button 
              onClick={() => { setViewingLogsExecutionId(null); setLogs([]); }}
              className="absolute top-6 right-6 text-text-secondary hover:text-white text-xl"
            >
              ✕
            </button>
            <h3 className="text-xl font-black mb-1">Execution Terminal</h3>
            <p className="text-text-secondary text-xs mb-4">Realtime logs for task execution #{viewingLogsExecutionId}</p>

            <div 
              ref={logsContainerRef}
              className="flex-1 bg-black/50 border border-white/5 rounded-2xl p-6 overflow-y-auto font-mono text-xs text-brand-lime space-y-1.5 scrollbar-thin"
            >
              {logs.length === 0 ? (
                <div className="text-white/20 italic">Awaiting telemetry logs...</div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="flex gap-4">
                    <span className="text-white/30 select-none">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                    <span className={log.level === 'error' ? 'text-red-400' : log.level === 'warning' ? 'text-brand-orange' : 'text-green-400'}>
                      {log.message}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* CREATE / EDIT TASK MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-6 z-40">
          <div className="glass-card w-full max-w-3xl p-8 relative max-h-[90vh] overflow-y-auto">
            <button 
              onClick={() => setShowAddModal(false)}
              className="absolute top-6 right-6 text-text-secondary hover:text-white text-xl"
            >
              ✕
            </button>
            
            <h3 className="text-2xl font-black text-brand-lime uppercase tracking-wide mb-6">
              {editingTask ? 'Edit Scheduled Task' : 'New Scheduled Task'}
            </h3>

            <form onSubmit={handleSaveTask} className="space-y-6">
              
              {/* Task Name */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-text-secondary uppercase tracking-widest">Task Job Name</label>
                <input 
                  type="text" required
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none focus:border-brand-lime transition-all"
                  placeholder="e.g. Transcode Security Stream Hourly"
                  value={taskForm.name}
                  onChange={e => setTaskForm({...taskForm, name: e.target.value})}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Schedule Type */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-secondary uppercase tracking-widest">Trigger Mechanism</label>
                  <select
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none"
                    value={taskForm.schedule_type}
                    onChange={e => setTaskForm({...taskForm, schedule_type: e.target.value})}
                  >
                    <option value="manual">Manual Trigger Only</option>
                    <option value="one_shot">One-shot (Target DateTime)</option>
                    <option value="recurring">Recurring (Cron Schedule)</option>
                  </select>
                </div>

                {/* Schedule details based on selection */}
                {taskForm.schedule_type === 'recurring' && (
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-brand-lime uppercase tracking-widest">Cron Expression</label>
                    <input 
                      type="text" required
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none focus:border-brand-lime transition-all text-brand-lime font-mono"
                      placeholder="e.g. */15 * * * *"
                      value={taskForm.schedule_cron}
                      onChange={e => setTaskForm({...taskForm, schedule_cron: e.target.value})}
                    />
                    <span className="text-[10px] text-text-secondary">Minute, Hour, Day, Month, Weekday format.</span>
                  </div>
                )}

                {taskForm.schedule_type === 'one_shot' && (
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-brand-orange uppercase tracking-widest">Target Date & Time</label>
                    <input 
                      type="datetime-local" required
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none focus:border-brand-orange transition-all text-white"
                      value={taskForm.schedule_datetime}
                      onChange={e => setTaskForm({...taskForm, schedule_datetime: e.target.value})}
                    />
                  </div>
                )}
              </div>

              {/* Input Config */}
              <div className="glass-card p-6 bg-white/5 border-white/5 space-y-4">
                <h4 className="text-sm font-black uppercase text-white tracking-widest">Input Stream / File</h4>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-secondary uppercase">Source Stream Path or lavfi Pattern</label>
                  <input 
                    type="text" required
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none focus:border-brand-lime transition-all font-mono"
                    placeholder="e.g. /media/storage/video.mkv OR testsrc=duration=5"
                    value={taskForm.input_path}
                    onChange={e => setTaskForm({...taskForm, input_path: e.target.value})}
                  />
                </div>
                <div className="flex gap-6">
                  <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
                    <input 
                      type="checkbox"
                      className="accent-brand-lime"
                      checked={taskForm.has_video}
                      onChange={e => setTaskForm({...taskForm, has_video: e.target.checked})}
                    />
                    Includes Video
                  </label>
                  <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
                    <input 
                      type="checkbox"
                      className="accent-brand-lime"
                      checked={taskForm.has_audio}
                      onChange={e => setTaskForm({...taskForm, has_audio: e.target.checked})}
                    />
                    Includes Audio
                  </label>
                </div>
              </div>

              {/* Codecs & Output */}
              <div className="glass-card p-6 bg-white/5 border-white/5 space-y-4">
                <h4 className="text-sm font-black uppercase text-white tracking-widest">Transcoding & Target</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-secondary uppercase">Video Codec</label>
                    <select
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none"
                      value={taskForm.vcodec}
                      onChange={e => setTaskForm({...taskForm, vcodec: e.target.value})}
                    >
                      <option value="libx264">H.264 (libx264)</option>
                      <option value="libx265">H.265 (libx265)</option>
                      <option value="copy">Copy Video Stream</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-secondary uppercase">Audio Codec</label>
                    <select
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none"
                      value={taskForm.acodec}
                      onChange={e => setTaskForm({...taskForm, acodec: e.target.value})}
                    >
                      <option value="aac">AAC</option>
                      <option value="mp3">MP3</option>
                      <option value="copy">Copy Audio Stream</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-secondary uppercase">Video Bitrate</label>
                    <input 
                      type="text" required
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none focus:border-brand-lime transition-all"
                      placeholder="e.g. 4000k or 6M"
                      value={taskForm.vbitrate}
                      onChange={e => setTaskForm({...taskForm, vbitrate: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-secondary uppercase">Destination File Path</label>
                    <input 
                      type="text" required
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none focus:border-brand-lime transition-all font-mono"
                      placeholder="e.g. /media/storage/output.mp4"
                      value={taskForm.output_path}
                      onChange={e => setTaskForm({...taskForm, output_path: e.target.value})}
                    />
                  </div>
                </div>
              </div>

              {/* Extra Limits / Watchdog */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-secondary uppercase">FFmpeg Build</label>
                  <select
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none"
                    value={taskForm.ffmpeg_build_id}
                    onChange={e => setTaskForm({...taskForm, ffmpeg_build_id: e.target.value})}
                  >
                    <option value="">Default Build</option>
                    {availableBuilds.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-secondary uppercase">CPU Threads (0=all)</label>
                  <input 
                    type="number" min="0" max="64"
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none focus:border-brand-lime transition-all"
                    value={taskForm.threads || ''}
                    onChange={e => setTaskForm({...taskForm, threads: parseInt(e.target.value) || 0})}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-secondary uppercase">Watchdog Timeout</label>
                  <select
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none"
                    value={taskForm.duration_type}
                    onChange={e => setTaskForm({...taskForm, duration_type: e.target.value})}
                  >
                    <option value="input_dependent">Stream End / Input Dependent</option>
                    <option value="timer">Fixed Timer (Seconds)</option>
                  </select>
                </div>
              </div>

              {taskForm.duration_type === 'timer' && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-brand-orange uppercase">Execution Timer (Seconds)</label>
                  <input 
                    type="number" min="1" required
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none focus:border-brand-orange transition-all"
                    value={taskForm.duration_seconds}
                    onChange={e => setTaskForm({...taskForm, duration_seconds: parseInt(e.target.value) || 60})}
                  />
                </div>
              )}

              {/* Retry Policy */}
              <div className="glass-card p-6 bg-white/5 border-white/5 space-y-4">
                <h4 className="text-sm font-black uppercase text-white tracking-widest">Retry Policy</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-secondary uppercase">Max Retries</label>
                    <input 
                      type="number" min="0" max="10"
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none focus:border-brand-lime transition-all"
                      value={taskForm.retry_max}
                      onChange={e => setTaskForm({...taskForm, retry_max: parseInt(e.target.value) || 0})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-secondary uppercase">Retry Delay (Seconds)</label>
                    <input 
                      type="number" min="1" max="300"
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none focus:border-brand-lime transition-all"
                      value={taskForm.retry_delay}
                      onChange={e => setTaskForm({...taskForm, retry_delay: parseInt(e.target.value) || 5})}
                    />
                  </div>
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="flex gap-4 pt-4">
                <button 
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-3 bg-white/5 border border-white/10 rounded-xl font-bold hover:bg-white/10 transition-all text-sm"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="flex-1 py-3 bg-brand-lime text-black rounded-xl font-black shadow-lg shadow-brand-lime/20 text-sm"
                >
                  Save Task
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* IMPORT DIALOG */}
      {isImportOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-6 z-40">
          <div className="glass-card w-full max-w-2xl p-8 relative">
            <button 
              onClick={() => setIsImportOpen(false)}
              className="absolute top-6 right-6 text-text-secondary hover:text-white text-xl"
            >
              ✕
            </button>
            <h3 className="text-2xl font-black mb-2">Import Tasks Configuration</h3>
            <p className="text-text-secondary text-sm mb-6">Paste the exported JSON task structure below to import them.</p>

            <form onSubmit={handleImportTasks} className="space-y-6">
              <div className="space-y-2">
                <textarea 
                  required
                  rows={10}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 outline-none focus:border-brand-lime font-mono text-xs text-brand-lime"
                  placeholder='{ "version": 2, "tasks": [...] }'
                  value={importJson}
                  onChange={e => setImportJson(e.target.value)}
                />
              </div>

              {importError && (
                <div className="text-red-400 font-bold text-xs p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                  {importError}
                </div>
              )}

              <div className="flex gap-4">
                <button 
                  type="button"
                  onClick={() => setIsImportOpen(false)}
                  className="flex-1 py-3 bg-white/5 border border-white/10 rounded-xl font-bold hover:bg-white/10 transition-all text-sm"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="flex-1 py-3 bg-brand-lime text-black rounded-xl font-black shadow-lg shadow-brand-lime/20 text-sm"
                >
                  Import Configuration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
