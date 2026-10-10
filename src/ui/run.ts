// A run's timers and window listeners, owned in one place so that starting or
// loading a run stops the old one first: no doubled ticks, saves or drag
// handlers left behind.

export interface RunScope {
  /** Pass to addEventListener; stop() removes every listener added with it. */
  readonly signal: AbortSignal;
  /** Calls `fn` every `ms` until stop(). */
  every(ms: number, fn: () => void): void;
  stop(): void;
}

export function runScope(): RunScope {
  const controller = new AbortController();
  const timers: ReturnType<typeof setInterval>[] = [];
  return {
    signal: controller.signal,
    every(ms, fn) {
      if (!controller.signal.aborted) timers.push(setInterval(fn, ms));
    },
    stop() {
      controller.abort();
      for (const t of timers.splice(0)) clearInterval(t);
    },
  };
}

/** Hands out one scope at a time: asking for the next stops the current one. */
export function runs(): { next(): RunScope; stop(): void } {
  let current: RunScope | null = null;
  return {
    next() {
      current?.stop();
      current = runScope();
      return current;
    },
    stop() {
      current?.stop();
      current = null;
    },
  };
}

/** The page events autosave listens to; the real document and window in the app. */
export interface SavePage {
  doc: EventTarget & { readonly hidden: boolean };
  win: EventTarget;
}

/**
 * Saves now (the stamp right after a catch-up or a new run), then every
 * `everyMs`, when the page is hidden and when it is left, until `scope` stops.
 */
export function autosave(scope: RunScope, save: () => void, page: SavePage, everyMs: number): void {
  const { signal } = scope;
  save();
  scope.every(everyMs, save);
  const onHide = (): void => {
    if (page.doc.hidden) save();
  };
  page.doc.addEventListener('visibilitychange', onHide, { signal });
  page.win.addEventListener('pagehide', () => save(), { signal });
}
