import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autosave, runs, runScope } from './run.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('runScope', () => {
  it('runs its timers and listeners until stopped, then none of them', () => {
    const target = new EventTarget();
    const scope = runScope();
    const ticks = vi.fn();
    const moves = vi.fn();
    scope.every(200, ticks);
    target.addEventListener('pointermove', moves, { signal: scope.signal });

    vi.advanceTimersByTime(1000);
    target.dispatchEvent(new Event('pointermove'));
    expect(ticks).toHaveBeenCalledTimes(5);
    expect(moves).toHaveBeenCalledTimes(1);

    scope.stop();
    vi.advanceTimersByTime(1000);
    target.dispatchEvent(new Event('pointermove'));
    expect(ticks).toHaveBeenCalledTimes(5);
    expect(moves).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts no timer once stopped', () => {
    const scope = runScope();
    scope.stop();
    scope.every(200, vi.fn());
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('runs', () => {
  it('stops the previous run when the next one starts', () => {
    const target = new EventTarget();
    const r = runs();
    const firstTicks = vi.fn();
    const firstUps = vi.fn();
    const first = r.next();
    first.every(200, firstTicks);
    target.addEventListener('pointerup', firstUps, { signal: first.signal });

    const secondTicks = vi.fn();
    const secondUps = vi.fn();
    const second = r.next();
    second.every(200, secondTicks);
    target.addEventListener('pointerup', secondUps, { signal: second.signal });

    vi.advanceTimersByTime(1000);
    target.dispatchEvent(new Event('pointerup'));
    expect(first.signal.aborted).toBe(true);
    expect(firstTicks).not.toHaveBeenCalled();
    expect(firstUps).not.toHaveBeenCalled();
    // One run's worth of ticks and handlers, not two.
    expect(secondTicks).toHaveBeenCalledTimes(5);
    expect(secondUps).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('stop() ends the current run', () => {
    const r = runs();
    r.next().every(200, vi.fn());
    r.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('autosave', () => {
  function page(): { doc: EventTarget & { hidden: boolean }; win: EventTarget } {
    return { doc: Object.assign(new EventTarget(), { hidden: false }), win: new EventTarget() };
  }

  it('saves at once, so a catch-up is stamped before anything else runs', () => {
    const save = vi.fn();
    autosave(runScope(), save, page(), 10_000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('saves on the interval, when hidden and when the page is left', () => {
    const save = vi.fn();
    const p = page();
    autosave(runScope(), save, p, 10_000);
    vi.advanceTimersByTime(30_000);
    expect(save).toHaveBeenCalledTimes(4);

    p.doc.dispatchEvent(new Event('visibilitychange'));
    expect(save).toHaveBeenCalledTimes(4);
    p.doc.hidden = true;
    p.doc.dispatchEvent(new Event('visibilitychange'));
    expect(save).toHaveBeenCalledTimes(5);

    p.win.dispatchEvent(new Event('pagehide'));
    expect(save).toHaveBeenCalledTimes(6);
  });

  it('stops saving when the run stops', () => {
    const save = vi.fn();
    const p = page();
    const scope = runScope();
    autosave(scope, save, p, 10_000);
    scope.stop();
    p.doc.hidden = true;
    vi.advanceTimersByTime(30_000);
    p.doc.dispatchEvent(new Event('visibilitychange'));
    p.win.dispatchEvent(new Event('pagehide'));
    expect(save).toHaveBeenCalledTimes(1);
  });
});
