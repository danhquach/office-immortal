import { describe, expect, it, vi } from 'vitest';
import { MAX_PASTE_CHARS } from '../storage/transfer.ts';
import {
  createUpdater,
  holdsStart,
  IMPORT_KEY,
  isBuildId,
  readVersion,
  servedBuild,
  takeKept,
  UPDATE_KEY,
  updateStep,
  VERSION_FILE,
  type UpdaterDeps,
} from './update.ts';

const OLD = 'aaaaaaaaaaaa';
const NEW = 'bbbbbbbbbbbb';

/** A plain-object session storage; `refuse` makes every call throw (a blocked one). */
function session(refuse = false) {
  const m = new Map<string, string>();
  const guard = (): void => {
    if (refuse) throw new Error('blocked');
  };
  return {
    map: m,
    getItem: (k: string) => (guard(), m.get(k) ?? null),
    setItem: (k: string, v: string) => (guard(), void m.set(k, v)),
    removeItem: (k: string) => (guard(), void m.delete(k)),
  };
}

function updater(over: Partial<UpdaterDeps> = {}) {
  const reload = vi.fn();
  const deps: UpdaterDeps = { build: OLD, selfUpdates: true, session: session(), reload, ...over };
  return { u: createUpdater(deps), reload, deps };
}

describe('version.json', () => {
  it('reads a build id and nothing else', () => {
    expect(readVersion(JSON.stringify({ build: NEW }))).toBe(NEW);
    for (const text of [
      '',
      'null',
      '[]',
      '"bbbbbbb"',
      JSON.stringify({ build: 'dev' }),
      JSON.stringify({ build: 'BBBBBBBB' }),
      JSON.stringify({ build: 'bbbbbb' }),
      JSON.stringify({ build: 'b'.repeat(41) }),
      JSON.stringify({ build: `${NEW}\u202e` }),
      JSON.stringify({ build: `${NEW}\u200b` }),
      JSON.stringify({ build: 1234567 }),
      JSON.stringify({ build: NEW, extra: 1 }),
      `{"__proto__":{"polluted":1},"build":"${NEW}"}`,
      `<html>${NEW}</html>`,
      JSON.stringify({ build: NEW }) + ' '.repeat(200),
      null,
      42,
    ]) {
      expect(readVersion(text)).toBeNull();
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('is fetched fresh, without credentials, and anything off reads as unknown', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ build: NEW })));
    expect(await servedBuild(ok)).toBe(NEW);
    expect(ok).toHaveBeenCalledWith(
      VERSION_FILE,
      expect.objectContaining({ cache: 'no-store', credentials: 'omit' }),
    );
    expect(await servedBuild(async () => new Response('', { status: 404 }))).toBeNull();
    expect(await servedBuild(async () => Promise.reject(new TypeError('offline')))).toBeNull();
    const huge = new Response('x', { headers: { 'content-length': '5000000' } });
    expect(await servedBuild(async () => huge)).toBeNull();
    expect(await servedBuild(async () => new Response('{"build":'))).toBeNull();
  });

  it('stops reading a long reply that names no length', async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(64).fill(32));
      },
    });
    expect(await servedBuild(async () => new Response(endless))).toBeNull();
    expect(pulled).toBeLessThan(10);
    // Chunked but short: read as usual.
    const parts = ['{"build":', `"${NEW}"}`].map((p) => new TextEncoder().encode(p));
    const short = new ReadableStream<Uint8Array>({
      start(c) {
        for (const p of parts) c.enqueue(p);
        c.close();
      },
    });
    expect(await servedBuild(async () => new Response(short))).toBe(NEW);
  });

  it('build ids', () => {
    expect(isBuildId(OLD)).toBe(true);
    expect(isBuildId('dev')).toBe(false);
  });
});

describe('updater', () => {
  it('sees a new release only when it knows its own build and the served one differs', () => {
    expect(updater().u.isNew(NEW)).toBe(true);
    expect(updater().u.isNew(OLD)).toBe(false);
    expect(updater().u.isNew(null)).toBe(false);
    expect(updater({ build: 'dev' }).u.isNew(NEW)).toBe(false);
  });

  it('reloads once, remembering the build it left', () => {
    const { u, reload, deps } = updater();
    expect(u.canReload).toBe(true);
    expect(u.reload()).toBe(true);
    expect(u.reload()).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
    expect(deps.session?.getItem(UPDATE_KEY)).toBe(OLD);
  });

  it('does not reload again when the reload brought back the same build (no loop)', () => {
    const s = session();
    s.setItem(UPDATE_KEY, OLD);
    const { u, reload } = updater({ session: s });
    expect(u.canReload).toBe(false);
    expect(u.reload()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('clears the guard once a reload reached another build', () => {
    const s = session();
    s.setItem(UPDATE_KEY, OLD);
    const { u } = updater({ session: s, build: NEW });
    expect(u.canReload).toBe(true);
    expect(s.map.has(UPDATE_KEY)).toBe(false);
  });

  it('never reloads where a reload brings back the same build (itch.io)', () => {
    const { u, reload } = updater({ selfUpdates: false });
    expect(u.canReload).toBe(false);
    expect(u.reload()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('fails closed when the guard cannot be kept', () => {
    for (const s of [null, session(true)]) {
      const { u, reload } = updater({ session: s });
      expect(u.canReload).toBe(false);
      expect(u.reload()).toBe(false);
      expect(reload).not.toHaveBeenCalled();
    }
    // Storage that takes the write but doesn't keep it.
    const leaky = { ...session(), getItem: () => null };
    const { u, reload } = updater({ session: leaky });
    expect(u.canReload).toBe(false);
    expect(u.reload()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('when an update happens', () => {
  const at = (o: Partial<Parameters<typeof updateStep>[0]>) =>
    updateStep({ wanted: true, canReload: true, playing: true, choosing: false, ...o });

  it('saves the run first, waits out an open choice, and goes at once with no run', () => {
    expect(at({})).toBe('save');
    expect(at({ choosing: true })).toBe('wait');
    expect(at({ playing: false })).toBe('reload');
    expect(at({ playing: false, choosing: true })).toBe('reload');
  });

  it('does nothing when no update is wanted or the page cannot reload', () => {
    expect(at({ wanted: false })).toBe('none');
    expect(at({ canReload: false })).toBe('none');
    expect(at({ canReload: false, playing: false })).toBe('none');
  });
});

describe('a newer save at start', () => {
  it('holds the start, except over a readable save on itch.io shared storage', () => {
    expect(holdsStart({ newer: true, readable: false, shared: false })).toBe(true);
    expect(holdsStart({ newer: true, readable: true, shared: false })).toBe(true);
    expect(holdsStart({ newer: true, readable: false, shared: true })).toBe(true);
    // Another itch.io game can plant a "newer" save there: it can't lock the game out.
    expect(holdsStart({ newer: true, readable: true, shared: true })).toBe(false);
    expect(holdsStart({ newer: false, readable: true, shared: true })).toBe(false);
  });

  it('stops a running run when another tab saves a newer release, except on shared storage', () => {
    // A running run is readable; the storage event's value is the only new input.
    const stops = (shared: boolean) => holdsStart({ newer: true, readable: true, shared });
    expect(stops(false)).toBe(true);
    expect(stops(true)).toBe(false);
  });
});

describe('the import kept across a reload', () => {
  it('is read once and removed', () => {
    const s = session();
    s.setItem(IMPORT_KEY, 'OI1:abcd');
    expect(takeKept(s, true)).toBe('OI1:abcd');
    expect(s.map.has(IMPORT_KEY)).toBe(false);
    expect(takeKept(s, true)).toBeNull();
  });

  it('is never read or removed on shared storage (itch.io), where another game could plant it', () => {
    const s = session();
    s.setItem(IMPORT_KEY, 'OI1:planted');
    expect(takeKept(s, false)).toBeNull();
    expect(s.map.get(IMPORT_KEY)).toBe('OI1:planted');
  });

  it('drops an oversized value and survives blocked storage', () => {
    const s = session();
    s.setItem(IMPORT_KEY, 'x'.repeat(MAX_PASTE_CHARS + 1));
    expect(takeKept(s, true)).toBeNull();
    expect(s.map.has(IMPORT_KEY)).toBe(false);
    expect(takeKept(session(true), true)).toBeNull();
    expect(takeKept(null, true)).toBeNull();
  });
});
