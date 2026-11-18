export type CapabilityLevel = 'none' | 'monitor' | 'operate' | 'manage' | 'admin';

export interface EdgePermissionsSummary {
  is_owner?: boolean;
  channel?: string;
  username?: string;
  scopes?: {
    dashboard?: CapabilityLevel;
    hardware?: CapabilityLevel;
    media?: CapabilityLevel;
    settings?: CapabilityLevel;
    forge?: CapabilityLevel;
    processes?: {
      default?: CapabilityLevel;
      by_type?: Record<string, CapabilityLevel>;
      services?: Record<string, CapabilityLevel>;
      tasks?: Record<string, CapabilityLevel>;
    };
  };
  service_levels?: Record<string, CapabilityLevel>;
  task_levels?: Record<string, CapabilityLevel>;
}

export const LEVEL_RANK: Record<CapabilityLevel, number> = {
  none: 0,
  monitor: 1,
  operate: 2,
  manage: 3,
  admin: 4,
};

export function normalizeLevel(level: string | undefined | null, fallback: CapabilityLevel = 'none'): CapabilityLevel {
  if (!level) return fallback;
  const low = level.toLowerCase().trim() as CapabilityLevel;
  return low in LEVEL_RANK ? low : fallback;
}

export function hasMinLevel(actual: string | undefined | null, minLevel: CapabilityLevel): boolean {
  return LEVEL_RANK[normalizeLevel(actual)] >= LEVEL_RANK[minLevel];
}

export function getDomainLevel(
  permissions: EdgePermissionsSummary | undefined | null,
  domain: 'dashboard' | 'hardware' | 'media' | 'settings' | 'forge' | 'processes'
): CapabilityLevel {
  if (!permissions || permissions.is_owner !== false) return 'admin';
  const scopes = permissions.scopes || {};
  if (domain === 'processes') {
    return normalizeLevel(scopes.processes?.default, 'none');
  }
  return normalizeLevel(scopes[domain], 'none');
}

export function canAccessDomain(
  permissions: EdgePermissionsSummary | undefined | null,
  domain: 'dashboard' | 'hardware' | 'media' | 'settings' | 'forge' | 'processes',
  minLevel: CapabilityLevel = 'monitor'
): boolean {
  return hasMinLevel(getDomainLevel(permissions, domain), minLevel);
}

export function hasAnyProcessAccess(
  permissions: EdgePermissionsSummary | undefined | null,
  minLevel: CapabilityLevel = 'monitor'
): boolean {
  if (!permissions || permissions.is_owner !== false) return true;
  const procs = permissions.scopes?.processes;
  if (hasMinLevel(procs?.default, minLevel)) return true;
  const svcLvls = Object.values(permissions.service_levels || {});
  if (svcLvls.some((l) => hasMinLevel(l, minLevel))) return true;
  const taskLvls = Object.values(permissions.task_levels || {});
  if (taskLvls.some((l) => hasMinLevel(l, minLevel))) return true;
  const byType = Object.values(procs?.by_type || {});
  return byType.some((l) => hasMinLevel(l, minLevel));
}

export function hasAnyServiceAccess(
  permissions: EdgePermissionsSummary | undefined | null,
  minLevel: CapabilityLevel = 'monitor'
): boolean {
  if (!permissions || permissions.is_owner !== false) return true;
  const procs = permissions.scopes?.processes;
  if (hasMinLevel(procs?.default, minLevel)) return true;
  if (Object.values(permissions.service_levels || {}).some((l) => hasMinLevel(l, minLevel))) return true;
  return Object.entries(procs?.by_type || {}).some(
    ([k, v]) => k !== 'task' && hasMinLevel(v, minLevel)
  );
}

export function hasAnyTaskAccess(
  permissions: EdgePermissionsSummary | undefined | null,
  minLevel: CapabilityLevel = 'monitor'
): boolean {
  if (!permissions || permissions.is_owner !== false) return true;
  const procs = permissions.scopes?.processes;
  if (hasMinLevel(procs?.default, minLevel)) return true;
  if (hasMinLevel(procs?.by_type?.task, minLevel)) return true;
  return Object.values(permissions.task_levels || {}).some((l) => hasMinLevel(l, minLevel));
}

export function getServiceLevel(
  permissions: EdgePermissionsSummary | undefined | null,
  proc: any
): CapabilityLevel {
  if (!permissions || permissions.is_owner !== false) return 'admin';
  if (proc?.effective_level) return normalizeLevel(proc.effective_level, 'none');
  const sid = proc?.id !== undefined && proc?.id !== null ? String(proc.id) : null;
  if (sid && permissions.service_levels && sid in permissions.service_levels) {
    return normalizeLevel(permissions.service_levels[sid], 'none');
  }
  const stype = proc?.service_type;
  const procs = permissions.scopes?.processes || {};
  if (sid && procs.services && sid in procs.services) {
    return normalizeLevel(procs.services[sid], 'none');
  }
  if (stype && procs.by_type && stype in procs.by_type) {
    return normalizeLevel(procs.by_type[stype], 'none');
  }
  return normalizeLevel(procs.default, 'none');
}

export function getTaskLevel(
  permissions: EdgePermissionsSummary | undefined | null,
  task: any
): CapabilityLevel {
  if (!permissions || permissions.is_owner !== false) return 'admin';
  if (task?.effective_level) return normalizeLevel(task.effective_level, 'none');
  const tid = task?.id !== undefined && task?.id !== null ? String(task.id) : null;
  if (tid && permissions.task_levels && tid in permissions.task_levels) {
    return normalizeLevel(permissions.task_levels[tid], 'none');
  }
  const procs = permissions.scopes?.processes || {};
  if (tid && procs.tasks && tid in procs.tasks) {
    return normalizeLevel(procs.tasks[tid], 'none');
  }
  if (procs.by_type && 'task' in procs.by_type) {
    return normalizeLevel(procs.by_type.task, 'none');
  }
  return normalizeLevel(procs.default, 'none');
}

export function canCreateService(
  permissions: EdgePermissionsSummary | undefined | null,
  serviceType?: string
): boolean {
  if (!permissions || permissions.is_owner !== false) return true;
  const procs = permissions.scopes?.processes || {};
  if (serviceType) {
    if (procs.by_type && serviceType in procs.by_type) {
      return hasMinLevel(procs.by_type[serviceType], 'manage');
    }
    return hasMinLevel(procs.default, 'manage');
  }
  if (hasMinLevel(procs.default, 'manage')) return true;
  return Object.entries(procs.by_type || {}).some(
    ([k, lvl]) => k !== 'task' && hasMinLevel(lvl, 'manage')
  );
}

export function canCreateTask(permissions: EdgePermissionsSummary | undefined | null): boolean {
  if (!permissions || permissions.is_owner !== false) return true;
  const procs = permissions.scopes?.processes || {};
  if (procs.by_type && 'task' in procs.by_type) {
    return hasMinLevel(procs.by_type.task, 'manage');
  }
  return hasMinLevel(procs.default, 'manage');
}
