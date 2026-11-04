import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

export interface ProcessItem {
  id: number;
  name: string;
  alias?: string | null;
  type: string;
  service_type: string;
  config: any;
  status: string;
  pid?: number | null;
  cpu?: number | null;
  ram?: number | null;
  bitrate?: string | null;
  fps?: number | null;
  speed?: string | null;
  ffmpeg_build_id?: number | null;
  sparkline?: number[] | null;
  has_rrd_outlier?: boolean;
  input_config?: any;
  output_config?: any;
  codec_config?: any;
  filter_config?: any;
  auto_start?: boolean;
  startup_order?: number;
  startup_delay?: number;
  watchdog_enabled?: boolean;
  watchdog_retries?: number;
  watchdog_circuit_breaker?: boolean;
  [key: string]: any;
}

export type ActionPendingState = Record<number, 'starting' | 'stopping' | 'restarting'>;

export interface TelemetryContextType {
  telemetry: ProcessItem[];
  systemTelemetry: any;
  taskExecutions: any[];
  upcomingTasks: any[];
  taskStats: any;
  resourceLocks: any[];
  actionPending: ActionPendingState;
  setActionPending: React.Dispatch<React.SetStateAction<ActionPendingState>>;
  subscribe: (topic: string, id: number | string | undefined, callback: (data: any) => void, options?: any) => () => void;
  sendSubscription: (action: 'subscribe' | 'unsubscribe', topic: string, id?: number | string, options?: any) => void;
}

const TelemetryContext = createContext<TelemetryContextType | null>(null);

export const TelemetryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [telemetry, setTelemetry] = useState<ProcessItem[]>([]);
  const [taskExecutions, setTaskExecutions] = useState<any[]>([]);
  const [upcomingTasks, setUpcomingTasks] = useState<any[]>([]);
  const [systemTelemetry, setSystemTelemetry] = useState<any>({
    cpu: 0,
    ram_used: 0,
    ram_total: 0,
    uptime_seconds: 0,
    storages: [],
    peers: [],
    lcd: { connected: false, locator_active: false }
  });
  const [taskStats, setTaskStats] = useState<any>({
    active_count: 0,
    completed_count: 0,
    failed_count: 0,
    total_count: 0
  });
  const [resourceLocks, setResourceLocks] = useState<any[]>([]);
  const [actionPending, setActionPending] = useState<ActionPendingState>({});

  const wsRef = useRef<WebSocket | null>(null);
  const subscribersRef = useRef<Map<string, Set<(data: any) => void>>>(new Map());
  const activeSubsRef = useRef<Set<string>>(new Set());
  const activeSubsOptionsRef = useRef<Map<string, any>>(new Map());

  const getSubKey = (topic: string, id?: number | string) => (id !== undefined ? `${topic}:${id}` : topic);

  const sendSubscription = useCallback((action: 'subscribe' | 'unsubscribe', topic: string, id?: number | string, options?: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        const payload: any = { action, topic, id };
        if (options) payload.options = options;
        wsRef.current.send(JSON.stringify(payload));
      } catch (e) {
        console.error('Failed to send subscription frame', e);
      }
    }
  }, []);

  const subscribe = useCallback((topic: string, id: number | string | undefined, callback: (data: any) => void, options?: any) => {
    const key = getSubKey(topic, id);
    if (!subscribersRef.current.has(key)) {
      subscribersRef.current.set(key, new Set());
    }
    subscribersRef.current.get(key)!.add(callback);

    // Always send subscribe frame to ensure fresh initial snapshot delivery to the new subscriber
    activeSubsRef.current.add(key);
    if (options) {
      activeSubsOptionsRef.current.set(key, options);
    }
    sendSubscription('subscribe', topic, id, options);

    return () => {
      const set = subscribersRef.current.get(key);
      if (set) {
        set.delete(callback);
        if (set.size === 0) {
          subscribersRef.current.delete(key);
          activeSubsRef.current.delete(key);
          activeSubsOptionsRef.current.delete(key);
          sendSubscription('unsubscribe', topic, id);
        }
      }
    };
  }, [sendSubscription]);

  // Connect WebSocket
  useEffect(() => {
    let reconnectTimer: any = null;
    let isDisposed = false;

    const connect = () => {
      if (isDisposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/telemetry`);
      wsRef.current = ws;

      ws.onopen = () => {
        // Resubscribe active subscriptions upon (re)connect
        activeSubsRef.current.forEach(key => {
          const colonIdx = key.indexOf(':');
          const opts = activeSubsOptionsRef.current.get(key);
          if (colonIdx === -1) {
            sendSubscription('subscribe', key, undefined, opts);
          } else {
            const topic = key.slice(0, colonIdx);
            const rawId = key.slice(colonIdx + 1);
            const numId = parseInt(rawId, 10);
            sendSubscription('subscribe', topic, isNaN(numId) ? rawId : numId, opts);
          }
        });
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === 'telemetry') {
            if (Array.isArray(msg.data)) {
              setTelemetry(msg.data);
              setActionPending(prev => {
                const next = { ...prev };
                let changed = false;
                msg.data.forEach((p: any) => {
                  const pending = next[p.id];
                  if (pending === 'stopping' && p.status === 'stopped') {
                    delete next[p.id];
                    changed = true;
                  } else if ((pending === 'starting' || pending === 'restarting') && p.status === 'running') {
                    delete next[p.id];
                    changed = true;
                  }
                });
                return changed ? next : prev;
              });
            }

            if (msg.task_executions) setTaskExecutions(msg.task_executions);
            if (msg.upcoming_tasks) setUpcomingTasks(msg.upcoming_tasks);
            if (msg.system) {
              setSystemTelemetry({
                ...msg.system,
                storages: msg.storages || [],
                peers: msg.peers || [],
                hardware_health: msg.hardware_health || null
              });
            } else if (msg.hardware_health) {
              setSystemTelemetry((prev: any) => ({
                ...prev,
                hardware_health: msg.hardware_health
              }));
            }
            if (msg.task_stats) setTaskStats(msg.task_stats);
            if (msg.resource_locks) setResourceLocks(msg.resource_locks);
          } else if (msg.type === 'process_logs') {
            const key = getSubKey('process_logs', msg.id);
            const callbacks = subscribersRef.current.get(key);
            if (callbacks) {
              callbacks.forEach(cb => cb(msg));
            }
          } else if (msg.type === 'sidecar_logs') {
            const key = getSubKey('sidecar_logs', msg.id);
            const callbacks = subscribersRef.current.get(key);
            if (callbacks) {
              callbacks.forEach(cb => cb(msg));
            }
          } else if (msg.type === 'task_logs') {
            const key = getSubKey('task_logs', msg.id);
            const callbacks = subscribersRef.current.get(key);
            if (callbacks) {
              callbacks.forEach(cb => cb(msg));
            }
          } else if (msg.type === 'resource_locks') {
            setResourceLocks(msg.locks || []);
            const callbacks = subscribersRef.current.get('resource_locks');
            if (callbacks) {
              callbacks.forEach(cb => cb(msg.locks || []));
            }
          } else if (msg.type === 'pipewire_graph') {
            const key = getSubKey('pipewire_graph', msg.id);
            const callbacks = subscribersRef.current.get(key) || subscribersRef.current.get('pipewire_graph');
            if (callbacks) {
              callbacks.forEach(cb => cb(msg.graph));
            }
          } else if (msg.type === 'service_metrics_rrd') {
            const serviceId = msg.service_id ?? msg.id;
            const key = getSubKey('service_metrics_rrd', serviceId);
            const callbacks = subscribersRef.current.get(key);
            if (callbacks) {
              callbacks.forEach(cb => cb(msg));
            }
          }
        } catch (e) {
          console.error('Error parsing telemetry WebSocket frame', e);
        }
      };

      ws.onclose = () => {
        if (!isDisposed) {
          reconnectTimer = setTimeout(connect, 2000);
        }
      };

      ws.onerror = () => {
        try { ws.close(); } catch {}
      };
    };

    connect();

    return () => {
      isDisposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) {
        try { wsRef.current.close(); } catch {}
      }
    };
  }, [sendSubscription]);

  return (
    <TelemetryContext.Provider
      value={{
        telemetry,
        systemTelemetry,
        taskExecutions,
        upcomingTasks,
        taskStats,
        resourceLocks,
        actionPending,
        setActionPending,
        subscribe,
        sendSubscription,
      }}
    >
      {children}
    </TelemetryContext.Provider>
  );
};

export const useTelemetry = (): TelemetryContextType => {
  const ctx = useContext(TelemetryContext);
  if (!ctx) {
    throw new Error('useTelemetry must be used within a TelemetryProvider');
  }
  return ctx;
};

export const useTelemetrySubscription = (
  topic: string,
  id: number | undefined,
  onData: (data: any) => void,
  options?: any
) => {
  const { subscribe } = useTelemetry();

  useEffect(() => {
    if (id === undefined && (topic === 'process_logs' || topic === 'service_metrics_rrd')) return;
    return subscribe(topic, id, onData, options);
  }, [topic, id, onData, subscribe, JSON.stringify(options)]);
};
