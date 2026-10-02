import React from 'react';
import { useTranslation } from 'react-i18next';

interface TasksDashboardCardProps {
  taskStats: {
    active: number;
    scheduled: number;
    inactive: number;
  };
  upcomingTasks?: any[];
}

function formatRelativeNextRun(isoString: string | null, t: any): string {
  if (!isoString) return '';
  const target = new Date(isoString);
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();

  if (diffMs <= 0) {
    return t('dashboard.nextRunImminent', 'Imminent');
  }

  const diffMins = Math.floor(diffMs / (1000 * 60));
  if (diffMins < 60) {
    return t('dashboard.nextRunInMins', 'In {{mins}} min', { mins: diffMins || 1 });
  }

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) {
    const remainingMins = diffMins % 60;
    if (remainingMins === 0) {
      return t('dashboard.nextRunInHours', 'In {{hours}}h', { hours: diffHours });
    }
    return t('dashboard.nextRunInHoursMins', 'In {{hours}}h {{mins}}m', { hours: diffHours, mins: remainingMins });
  }

  const hours = target.getHours().toString().padStart(2, '0');
  const minutes = target.getMinutes().toString().padStart(2, '0');

  const isSameDay =
    target.getDate() === now.getDate() &&
    target.getMonth() === now.getMonth() &&
    target.getFullYear() === now.getFullYear();
  if (isSameDay) {
    return t('dashboard.nextRunTodayAt', 'Today at {{time}}', { time: `${hours}:${minutes}` });
  }

  const month = (target.getMonth() + 1).toString().padStart(2, '0');
  const day = target.getDate().toString().padStart(2, '0');
  return `${day}/${month} ${hours}:${minutes}`;
}

export const TasksDashboardCard: React.FC<TasksDashboardCardProps> = ({
  taskStats,
  upcomingTasks = [],
}) => {
  const { t } = useTranslation();

  return (
    <div className="glass-card p-4 border-purple-500/10 space-y-3">
      <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2 mb-1">
        <h3 className="text-sm font-black text-[var(--text-primary)] uppercase tracking-wider flex items-center gap-2">
          <span>⏱️</span>
          <span>{t('dashboard.tasksTitle', 'TASKS')}</span>
        </h3>
        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-300">
          {taskStats.active} {t('dashboard.activeCount', 'active')}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-2 text-center">
          <div className="text-[9px] uppercase font-bold text-text-secondary mb-0.5">
            {t('dashboard.activeTasks', 'Active')}
          </div>
          <div className="font-black text-lg text-brand-blue">
            {taskStats.active}
          </div>
        </div>
        <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-2 text-center">
          <div className="text-[9px] uppercase font-bold text-text-secondary mb-0.5">
            {t('dashboard.scheduledTasks', 'Scheduled')}
          </div>
          <div className="font-black text-lg text-brand-orange">
            {taskStats.scheduled}
          </div>
        </div>
        <div className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-2 text-center">
          <div className="text-[9px] uppercase font-bold text-text-secondary mb-0.5">
            {t('dashboard.inactiveTasks', 'Inactive')}
          </div>
          <div className="font-black text-lg text-text-secondary">
            {taskStats.inactive}
          </div>
        </div>
      </div>

      {/* Upcoming Scheduled Tasks */}
      <div className="pt-1">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[10px] font-black uppercase text-text-secondary tracking-wider">
            {t('dashboard.upcomingTasksTitle', 'Upcoming Tasks')}
          </h4>
          {upcomingTasks.length > 0 && (
            <span className="text-[9px] font-mono text-text-secondary">
              {upcomingTasks.length} {t('dashboard.scheduledCount', 'scheduled')}
            </span>
          )}
        </div>

        {upcomingTasks.length === 0 ? (
          <div className="p-3 bg-purple-500/5 border border-purple-500/15 rounded-xl text-center space-y-0.5">
            <p className="text-xs text-text-secondary font-medium">
              {t('dashboard.noUpcomingTasks', 'No upcoming tasks scheduled in the near future.')}
            </p>
            <p className="text-[9px] text-text-secondary">
              {t('dashboard.noUpcomingTasksSub', 'Active recurring or one-shot tasks will be listed here.')}
            </p>
          </div>
        ) : (
          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
            {upcomingTasks.map((task: any) => (
              <div
                key={task.id}
                className="py-1.5 px-2.5 bg-purple-500/10 border border-purple-500/20 rounded-lg flex items-center justify-between gap-2 hover:border-purple-500/40 transition-all"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span
                      className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded tracking-wider ${
                        task.is_system
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                          : 'bg-brand-orange/20 text-brand-orange border border-brand-orange/30'
                      }`}
                    >
                      {task.is_system ? t('dashboard.systemTask', 'SYSTEM') : t('dashboard.userTask', 'JOB')}
                    </span>
                    <span
                      className="text-xs font-bold text-[var(--text-primary)] truncate max-w-[130px]"
                      title={task.alias || task.name}
                    >
                      {task.alias || task.name}
                    </span>
                  </div>
                  {task.schedule_cron && (
                    <span className="text-[9px] font-mono text-[var(--text-primary)] opacity-70 block">
                      cron: {task.schedule_cron}
                    </span>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <span className="text-xs font-black font-mono text-brand-lime block">
                    {formatRelativeNextRun(task.next_run, t)}
                  </span>
                  {task.next_run && (
                    <span className="text-[8px] text-text-secondary font-mono block">
                      {new Date(task.next_run).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
