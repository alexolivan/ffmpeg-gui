export type RestartVisualPhase = 'restarting' | 'pending' | 'idle';
export type ReloadVisualPhase = 'reloading' | 'reloaded' | 'pending' | 'idle';

export interface RestartButtonVisualState {
  phase: RestartVisualPhase;
  className: string;
  spinIcon: boolean;
}

export interface ReloadButtonVisualState {
  phase: ReloadVisualPhase;
  className: string;
  spinIcon: boolean;
  showCheck: boolean;
}

/**
 * Compute consistent Restart button classes and icon state matching FfmpegServiceCard:
 * active restarting takes strict precedence over pending reboot pulse so clicking
 * immediately clears the orange alert pulse and renders a spinning blue indicator.
 */
export function getRestartButtonState(opts: {
  isRestarting: boolean;
  isPendingRestart: boolean;
}): RestartButtonVisualState {
  if (opts.isRestarting) {
    return {
      phase: 'restarting',
      className: 'bg-blue-500/20 border border-blue-500 text-blue-400',
      spinIcon: true,
    };
  }
  if (opts.isPendingRestart) {
    return {
      phase: 'pending',
      className: 'bg-brand-orange/20 hover:bg-brand-orange/30 border border-brand-orange text-brand-orange animate-pulse',
      spinIcon: false,
    };
  }
  return {
    phase: 'idle',
    className: 'bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400',
    spinIcon: false,
  };
}

/**
 * Compute consistent Live Reload button classes and icon state:
 * active reloading > post-reload ACK checkmark > pending reload pulse > idle.
 */
export function getReloadButtonState(opts: {
  isReloading: boolean;
  isReloadAck?: boolean;
  isPendingReload: boolean;
}): ReloadButtonVisualState {
  if (opts.isReloading) {
    return {
      phase: 'reloading',
      className: 'bg-brand-lime/20 border border-brand-lime text-brand-lime',
      spinIcon: true,
      showCheck: false,
    };
  }
  if (opts.isReloadAck) {
    return {
      phase: 'reloaded',
      className: 'bg-emerald-500/20 border border-emerald-500 text-emerald-400',
      spinIcon: false,
      showCheck: true,
    };
  }
  if (opts.isPendingReload) {
    return {
      phase: 'pending',
      className: 'bg-brand-lime/20 hover:bg-brand-lime/30 border border-brand-lime text-brand-lime animate-pulse',
      spinIcon: false,
      showCheck: false,
    };
  }
  return {
    phase: 'idle',
    className: 'bg-brand-lime/10 hover:bg-brand-lime/20 border border-brand-lime/20 text-brand-lime',
    spinIcon: false,
    showCheck: false,
  };
}
