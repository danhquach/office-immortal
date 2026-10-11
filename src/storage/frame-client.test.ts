import { afterEach, describe, expect, it, vi } from 'vitest';
import { newGame } from '../core/sim.ts';
import { memory } from './cloud-fakes.ts';
import { ADOPT_KEY, CLOUD_KEY } from './cloud-meta.ts';
import {
  createClient,
  HELLO_TIMEOUT_MS,
  SYNC_REQUEST_MS,
  loadFramed,
  withFallbackCopy,
  type ClientDeps,
} from './frame-client.ts';
import { FRAME, framePair, memoryBackup, settle } from './frame-fakes.ts';
import { PROTOCOL } from './frame-protocol.ts';
import { encodeSave, SAVE_KEY } from './save.ts';

const T = 1_800_000_000_000;
const raw = (savedAt: number, seed = 1): string => encodeSave(newGame(seed, 'sword'), savedAt);

/** A client with no frame behind it: the test answers by hand. */
function alone(extra: Partial<ClientDeps> = {}) {
  const frameWindow = {};
  const sent: Record<string, unknown>[] = [];
  const adopted = vi.fn();
  const notes: string[] = [];
  const client = createClient({
    post: (m) => sent.push(m),
    origin: FRAME,
    source: () => frameWindow,
    onAdopt: adopted,
    onNote: (c) => notes.push(c),
    ...extra,
  });
  const from = (data: unknown, origin = FRAME, source: unknown = frameWindow): void =>
    client.receive({ data, origin, source });
  const hello = (items: [string, string][] = [], cloud = true) =>
    from({ p: PROTOCOL, re: 1, value: { items, cloud, status: { kind: 'off' } } });
  return { client, sent, from, hello, adopted, notes, frameWindow };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('linking to the frame', () => {
  it('gives up when the frame does not answer in time (the game then uses its own storage)', async () => {
    vi.useFakeTimers();
    const c = alone();
    const linking = c.client.connect();
    await vi.advanceTimersByTimeAsync(HELLO_TIMEOUT_MS);
    expect(await linking).toBeNull();
    // A late answer changes nothing.
    c.hello();
  });

  it("ignores an answer from another window or origin: only the frame's counts", async () => {
    vi.useFakeTimers();
    const c = alone();
    const linking = c.client.connect();
    const answer = {
      p: PROTOCOL,
      re: 1,
      value: { items: [], cloud: true, status: { kind: 'off' } },
    };
    c.from(answer, 'https://html-classic.itch.zone');
    c.from(answer, FRAME, { name: 'other window' });
    await vi.advanceTimersByTimeAsync(HELLO_TIMEOUT_MS);
    expect(await linking).toBeNull();
  });

  it('refuses a hello whose contents are off', async () => {
    const bad: unknown[] = [
      { items: [[CLOUD_KEY, '{}']], cloud: true, status: { kind: 'off' } },
      {
        items: [
          [SAVE_KEY, 'a'],
          [SAVE_KEY, 'b'],
        ],
        cloud: true,
        status: { kind: 'off' },
      },
      { items: [[SAVE_KEY, 'x'.repeat(200_001)]], cloud: true, status: { kind: 'off' } },
      { items: {}, cloud: true, status: { kind: 'off' } },
      { items: [], cloud: 'yes', status: { kind: 'off' } },
      { items: [], cloud: true, status: { kind: 'hacked' } },
      { items: [], cloud: true, status: { kind: 'off' }, token: 'x' },
    ];
    for (const value of bad) {
      vi.useFakeTimers();
      const c = alone();
      const linking = c.client.connect();
      c.from({ p: PROTOCOL, re: 1, value });
      await vi.advanceTimersByTimeAsync(HELLO_TIMEOUT_MS);
      expect(await linking).toBeNull();
      vi.useRealTimers();
    }
  });

  it('a frame without the cloud save gives no sync', async () => {
    const c = alone();
    const linking = c.client.connect();
    c.hello([], false);
    expect((await linking)?.sync).toBeNull();
  });
});

describe("the game's copy of the frame storage", () => {
  it('holds only mirrored keys', async () => {
    const c = alone();
    const linking = c.client.connect();
    c.hello([[SAVE_KEY, raw(T)]]);
    const link = await linking;
    expect(link?.storage.getItem(SAVE_KEY)).toBe(raw(T));
    expect(link?.storage.getItem(CLOUD_KEY)).toBeNull();
    expect(link?.storage.getItem('__proto__')).toBeNull();
    expect(() => link?.storage.setItem(CLOUD_KEY, 'x')).toThrow();
    expect(() => link?.storage.setItem('__proto__', 'x')).toThrow();
    link?.storage.removeItem(CLOUD_KEY);
    expect(c.sent.filter((m) => m.op === 'remove')).toEqual([]);
  });

  it('drops hostile events from the frame: wrong keys, oversize text, unknown codes, a bad conflict save', async () => {
    const c = alone();
    const linking = c.client.connect();
    c.hello([[SAVE_KEY, raw(T)]]);
    const link = await linking;
    const seen: unknown[] = [];
    link?.onStorage((k, v) => seen.push([k, v]));
    link?.sync?.subscribe((s) => seen.push(s.kind));
    const hostile: unknown[] = [
      { p: PROTOCOL, ev: 'write', key: CLOUD_KEY, value: '{}' },
      { p: PROTOCOL, ev: 'write', key: SAVE_KEY, value: 'x'.repeat(200_001) },
      { p: PROTOCOL, ev: 'storage', key: null, value: 'x' },
      { p: PROTOCOL, ev: 'storage', key: 'office-immortal.theme', value: 'x'.repeat(201) },
      { p: PROTOCOL, ev: 'note', code: '<img src=x onerror=alert(1)>' },
      { p: PROTOCOL, ev: 'note', code: 'loaded‮' },
      {
        p: PROTOCOL,
        ev: 'status',
        status: { kind: 'conflict', local: 'not a save', server: raw(T) },
      },
      { p: PROTOCOL, ev: 'status', status: { kind: 'synced', at: -1 } },
      {
        p: PROTOCOL,
        ev: 'status',
        status: { kind: 'offline', message: 'Server says: click here' },
      },
      { p: PROTOCOL, ev: 'adopt', extra: true },
      { p: 'other', ev: 'adopt' },
      JSON.parse(`{"p":"${PROTOCOL}","ev":"adopt","__proto__":{"polluted":true}}`),
    ];
    for (const data of hostile) c.from(data);
    expect(seen).toEqual([]);
    expect(c.adopted).not.toHaveBeenCalled();
    expect(c.notes).toEqual([]);
    expect(link?.storage.getItem(SAVE_KEY)).toBe(raw(T));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("applies the frame's own writes quietly, and another tab's with an event", async () => {
    const c = alone();
    const linking = c.client.connect();
    c.hello([[SAVE_KEY, raw(T)]]);
    const link = await linking;
    const seen: unknown[] = [];
    link?.onStorage((k, v) => seen.push([k, v]));
    c.from({ p: PROTOCOL, ev: 'write', key: ADOPT_KEY, value: '1-1' });
    expect(link?.storage.getItem(ADOPT_KEY)).toBe('1-1');
    expect(seen).toEqual([]);
    c.from({ p: PROTOCOL, ev: 'storage', key: SAVE_KEY, value: null });
    c.from({ p: PROTOCOL, ev: 'storage', key: null, value: null });
    expect(link?.storage.getItem(SAVE_KEY)).toBeNull();
    expect(link?.storage.getItem(ADOPT_KEY)).toBeNull();
    expect(seen).toEqual([
      [SAVE_KEY, null],
      [null, null],
    ]);
  });
});

describe('cloud actions through the frame', () => {
  it('gives up on an action the frame never answers, changing nothing', async () => {
    vi.useFakeTimers();
    const c = alone();
    const linking = c.client.connect();
    c.hello();
    const link = await linking;
    const deleting = link?.sync?.deleteCloud();
    const code = link?.sync?.linkCode();
    await vi.advanceTimersByTimeAsync(SYNC_REQUEST_MS);
    expect(await deleting).toEqual({ ok: false, message: 'offline' });
    expect(await code).toBeNull();
  });

  it('reads replies through the allow-list', async () => {
    const c = alone();
    const linking = c.client.connect();
    c.hello();
    const link = await linking;
    const code = link?.sync?.linkCode();
    const gone = link?.sync?.deleteCloud();
    c.from({ p: PROTOCOL, re: 2, value: { code: 'abc<script>', ttl: 900 } });
    c.from({ p: PROTOCOL, re: 3, value: { ok: false, message: 'raw server text' } });
    expect(await code).toBeNull();
    expect(await gone).toEqual({ ok: false, message: 'bad-response' });
  });
});

describe('fallback copy on itch.io storage', () => {
  it('writes every save to the frame and to this page, but reads only the frame', async () => {
    const frame = memoryBackup();
    const local = memory();
    const localBackup = memoryBackup();
    const b = withFallbackCopy(frame, local, localBackup);
    expect(await b.put(raw(T))).toBe(true);
    expect(frame.text).toBe(raw(T));
    expect(local.getItem(SAVE_KEY)).toBe(raw(T));
    expect(localBackup.text).toBe(raw(T));
    localBackup.text = raw(T + 99, 3);
    expect(await b.read()).toBe(raw(T));
  });

  it('clears all copies on Reset progress, and says so when one refuses', async () => {
    const frame = memoryBackup();
    const local = memory();
    const localBackup = memoryBackup();
    const b = withFallbackCopy(frame, local, localBackup);
    await b.put(raw(T));
    expect(await b.clear()).toBe(true);
    expect([frame.text, local.getItem(SAVE_KEY), localBackup.text]).toEqual([null, null, null]);
    frame.clear = async () => false;
    expect(await b.clear()).toBe(false);
  });

  it('keeps writing the frame where this page has no storage', async () => {
    const frame = memoryBackup();
    const b = withFallbackCopy(frame, null, memoryBackup());
    expect(await b.put(raw(T))).toBe(true);
    expect(frame.text).toBe(raw(T));
  });
});

describe('end to end', () => {
  it('the game sees status changes and notes from the frame sync', async () => {
    const f = framePair();
    const link = await f.client.connect();
    const kinds: string[] = [];
    link?.sync?.subscribe((s) => kinds.push(s.kind));
    link?.sync?.begin();
    link?.sync?.offer(raw(T), T);
    await link?.sync?.turnOn();
    await settle();
    expect(kinds).toContain('synced');
    expect(link?.sync?.status.kind).toBe('synced');
  });
});

describe('the run to start with the frame', () => {
  const pair = (s: string | null, b: string | null) => {
    const storage = memory();
    if (s) storage.setItem(SAVE_KEY, s);
    const backup = memoryBackup();
    backup.text = b;
    return { storage, backup };
  };

  it("takes the frame's save, even when this page's copy is newer", async () => {
    const save = await loadFramed(pair(raw(T), null), pair(raw(T + 60_000, 2), null), T + 61_000);
    expect(save?.savedAt).toBe(T);
  });

  it("takes the frame's backup when its storage copy is gone", async () => {
    const save = await loadFramed(pair(null, raw(T)), pair(raw(T + 5, 2), null), T + 10);
    expect(save?.savedAt).toBe(T);
  });

  it("takes this page's newest copy only when the frame holds no valid save", async () => {
    const own = pair(raw(T), raw(T + 5, 2));
    expect((await loadFramed(pair(null, null), own, T + 10))?.savedAt).toBe(T + 5);
    expect((await loadFramed(pair('not a save', null), own, T + 10))?.savedAt).toBe(T + 5);
  });

  it('refuses a hostile copy on this page as it would any save', async () => {
    const own = pair('{"v":7,"savedAt":1,"state":{"__proto__":{"x":1}}}', 'x'.repeat(200_001));
    expect(await loadFramed(pair(null, null), own, T)).toBeNull();
  });
});
