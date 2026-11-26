import { describe, it, expect } from 'vitest';
import { getReloadButtonState, getRestartButtonState } from '../serviceActionStyles';

describe('serviceActionStyles', () => {
  it('prioritizes restarting state over pending_changes so pulse stops immediately on click', () => {
    const active = getRestartButtonState({ isRestarting: true, isPendingRestart: true });
    expect(active.phase).toBe('restarting');
    expect(active.spinIcon).toBe(true);
    expect(active.className).not.toContain('animate-pulse');
    expect(active.className).toContain('text-blue-400');

    const pending = getRestartButtonState({ isRestarting: false, isPendingRestart: true });
    expect(pending.phase).toBe('pending');
    expect(pending.spinIcon).toBe(false);
    expect(pending.className).toContain('animate-pulse');
    expect(pending.className).toContain('text-brand-orange');

    const idle = getRestartButtonState({ isRestarting: false, isPendingRestart: false });
    expect(idle.phase).toBe('idle');
    expect(idle.spinIcon).toBe(false);
    expect(idle.className).toContain('bg-blue-500/10');
  });

  it('orders reload states strictly as reloading > reloaded ACK > pending > idle', () => {
    const reloading = getReloadButtonState({
      isReloading: true,
      isReloadAck: true,
      isPendingReload: true,
    });
    expect(reloading.phase).toBe('reloading');
    expect(reloading.spinIcon).toBe(true);
    expect(reloading.showCheck).toBe(false);
    expect(reloading.className).not.toContain('animate-pulse');

    const ack = getReloadButtonState({
      isReloading: false,
      isReloadAck: true,
      isPendingReload: true,
    });
    expect(ack.phase).toBe('reloaded');
    expect(ack.showCheck).toBe(true);
    expect(ack.spinIcon).toBe(false);
    expect(ack.className).not.toContain('animate-pulse');
    expect(ack.className).toContain('text-emerald-400');

    const pending = getReloadButtonState({
      isReloading: false,
      isReloadAck: false,
      isPendingReload: true,
    });
    expect(pending.phase).toBe('pending');
    expect(pending.className).toContain('animate-pulse');
    expect(pending.className).toContain('text-brand-lime');

    const idle = getReloadButtonState({
      isReloading: false,
      isReloadAck: false,
      isPendingReload: false,
    });
    expect(idle.phase).toBe('idle');
    expect(idle.className).toContain('bg-brand-lime/10');
  });
});
