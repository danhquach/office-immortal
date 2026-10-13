import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catchUp, offlineCap, offlineSeconds } from '../core/offline.ts';
import { newGame, type GameState } from '../core/sim.ts';
import {
  CONFIG,
  SAVE_ID,
  clock,
  fakeLocks,
  fakeServer,
  memory,
  type FakeStorage,
} from './cloud-fakes.ts';
import { ADOPT_KEY, CLOUD_KEY, newMeta, readMeta, writeMeta } from './cloud-meta.ts';
import { createCloud } from './cloud.ts';
import { encodeSave, loadSave, MAX_SAVE_CHARS, SAVE_KEY, SAVE_VERSION } from './save.ts';
import { createSync, UPLOAD_EVERY_MS, type SyncStatus } from './sync.ts';

const T = 1_800_000_000_000;
const MINUTE = 60_000;

/** A valid save stamped `savedAt`; `seed` makes saves differ. */
const raw = (savedAt: number, seed = 1): string => encodeSave(newGame(seed, 'sword'), savedAt);
/** A new run holding one Mortal cap refined 7 times, on a base roll of 50%. */
function refinedRun(seed = 1): GameState {
  const s = newGame(seed, 'sword');
  s.inventory.push({
    slot: 'head',
    name: 'Hempen Scholar Cap',
    level: 1,
    grade: 'mortal',
    baseRoll: 0.5,
    affixes: [],
    refines: 7,
  });
  return s;
}

function world() {
  const server = fakeServer();
  const time = clock(T);
  const vis = { v: true };
  function device(storage: FakeStorage = memory()) {
    const notes: string[] = [];
    const adopted = vi.fn();
    const cloud = createCloud({
      config: CONFIG,
      storage,
      fetch: server.fetch,
      now: time.now,
      locks: fakeLocks(),
    });
    const sync = createSync({
      cloud,
      storage,
      now: time.now,
      visible: () => vis.v,
      onAdopt: adopted,
      onNote: (t) => notes.push(t),
    });
    return { storage, sync, notes, adopted };
  }
  return { server, time, vis, device };
}
type World = ReturnType<typeof world>;
type Device = ReturnType<World['device']>;

/** What the app does on each autosave: write the local save, then offer it. */
function play(d: Device, savedAt: number, seed = 1, text = raw(savedAt, seed)): string {
  d.storage.setItem(SAVE_KEY, text);
  d.sync.offer(text, savedAt);
  return text;
}

/** Lets pending promise chains run. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 5));
const until = (fn: () => void): Promise<void> => vi.waitFor(fn);
const kind = (d: Device): SyncStatus['kind'] => d.sync.status.kind;
const puts = (w: World) => w.server.calls.filter((c) => c.url.endsWith('/put_save'));
const serverData = (w: World): string[] => [...w.server.saves.values()].map((s) => s.data);

/** A device with cloud save on and synced at T. */
async function enabled(w: World, seed = 1): Promise<{ d: Device; text: string }> {
  const d = w.device();
  d.sync.begin();
  const text = play(d, T, seed);
  await d.sync.turnOn();
  expect(kind(d)).toBe('synced');
  return { d, text };
}

/** Two devices on one cloud save, both synced at revision 1; `a` has the T save. */
async function pair(w: World) {
  const { d: a, text } = await enabled(w);
  const code = (await a.sync.linkCode())?.code as string;
  const b0 = w.device();
  b0.sync.begin();
  play(b0, T + 5, 2);
  await b0.sync.link(code);
  expect(kind(b0)).toBe('conflict');
  b0.sync.useCloud();
  expect(b0.adopted).toHaveBeenCalledOnce();
  const b = w.device(b0.storage);
  b.sync.begin();
  await until(() => expect(kind(b)).toBe('synced'));
  return { a, b, text };
}

describe('turning on', () => {
  it('signs up, creates the save from the running game and records where it stands', async () => {
    const w = world();
    const { d, text } = await enabled(w);
    expect(serverData(w)).toEqual([text]);
    const meta = readMeta(d.storage);
    expect(meta?.baseRev).toBe(1);
    expect(meta?.syncedSavedAt).toBe(T);
    expect(meta?.saveId).not.toBeNull();
    expect(d.storage.getItem(SAVE_KEY)).toBe(text);
  });

  it('makes no network call until the player turns it on', async () => {
    const w = world();
    const d = w.device();
    d.sync.begin();
    for (let i = 0; i < 20; i++) {
      w.time.t += 10_000;
      play(d, w.time.t);
    }
    d.sync.flush('hidden');
    d.sync.flush('pagehide');
    await settle();
    expect(w.server.calls).toHaveLength(0);
    expect(kind(d)).toBe('off');
  });

  it('keeps going if the first upload fails, and finishes it later', async () => {
    const w = world();
    const d = w.device();
    d.sync.begin();
    play(d, T);
    w.server.down = true;
    await d.sync.turnOn();
    // Signing up failed: nothing was stored, so the Menu offers Turn on again.
    expect(kind(d)).toBe('off');
    expect(d.notes).toHaveLength(1);
    expect(readMeta(d.storage)).toBeNull();
    w.server.down = false;
    await d.sync.turnOn();
    expect(kind(d)).toBe('synced');
  });

  it('pauses, without crashing or touching the save, when the browser refuses the settings', async () => {
    const w = world();
    const d = w.device();
    d.sync.begin();
    const text = play(d, T);
    d.storage.failWrites = true;
    await d.sync.turnOn();
    expect(kind(d)).toBe('offline');
    w.time.t += 5 * MINUTE;
    d.sync.offer(text, T + 2);
    await settle();
    expect(serverData(w)).toEqual([]);
    expect(d.storage.getItem(SAVE_KEY)).toBe(text);
  });
});

describe('uploading', () => {
  it('sends at most one upload a minute while playing', async () => {
    const w = world();
    const { d } = await enabled(w);
    for (let s = 10; s <= 55; s += 5) {
      w.time.t = T + s * 1000;
      play(d, w.time.t);
    }
    await settle();
    expect(puts(w)).toHaveLength(0);
    w.time.t = T + UPLOAD_EVERY_MS;
    const latest = play(d, w.time.t);
    await until(() => expect(puts(w)).toHaveLength(1));
    expect(serverData(w)).toEqual([latest]);
    // And not again until another minute has passed.
    w.time.t += 30_000;
    play(d, w.time.t);
    await settle();
    expect(puts(w)).toHaveLength(1);
  });

  it('does not upload on the timer from a hidden tab, but does when it is hidden', async () => {
    const w = world();
    const { d } = await enabled(w);
    w.vis.v = false;
    w.time.t += 5 * MINUTE;
    const latest = play(d, w.time.t);
    await settle();
    expect(puts(w)).toHaveLength(0);
    d.sync.flush('hidden');
    await until(() => expect(puts(w)).toHaveLength(1));
    expect(serverData(w)).toEqual([latest]);
  });

  it('sends the page-leaving upload with keepalive, and skips one too big for it', async () => {
    const w = world();
    const { d } = await enabled(w);
    w.time.t += 10_000;
    const small = play(d, w.time.t);
    d.sync.flush('pagehide');
    await until(() => expect(puts(w)).toHaveLength(1));
    expect(puts(w)[0]?.init.keepalive).toBe(true);
    expect(serverData(w)).toEqual([small]);

    const big = raw(w.time.t + 1) + ' '.repeat(50_000);
    expect(big.length).toBeLessThan(MAX_SAVE_CHARS);
    play(d, w.time.t + 1, 1, big);
    d.sync.flush('pagehide');
    await settle();
    expect(puts(w)).toHaveLength(1);
    // The next visible tick sends it as an ordinary upload.
    w.time.t += 2 * MINUTE;
    d.sync.offer(big, w.time.t);
    await until(() => expect(puts(w)).toHaveLength(2));
    expect(puts(w)[1]?.init.keepalive).toBe(false);
  });

  it('Sync now uploads at once, even inside the minute', async () => {
    const w = world();
    const { d } = await enabled(w);
    w.time.t += 5_000;
    const latest = play(d, w.time.t);
    await d.sync.syncNow();
    expect(serverData(w)).toEqual([latest]);
  });
});

describe('startup check', () => {
  it('sends nothing, on any trigger, before the check has answered', async () => {
    const w = world();
    const { d } = await enabled(w);
    let release = (): void => undefined;
    w.server.hold.get_save = new Promise<void>((r) => (release = r));
    const again = w.device(d.storage);
    again.sync.begin();
    w.time.t += 5 * MINUTE;
    play(again, w.time.t);
    again.sync.flush('hidden');
    again.sync.flush('pagehide');
    await again.sync.syncNow();
    await settle();
    expect(puts(w)).toHaveLength(0);
    expect(kind(again)).toBe('checking');
    release();
    await until(() => expect(kind(again)).toBe('synced'));
    expect(puts(w)).toHaveLength(0);
  });

  it('is quiet when the cloud has not moved', async () => {
    const w = world();
    const { d, text } = await enabled(w);
    const again = w.device(d.storage);
    again.sync.begin();
    await until(() => expect(kind(again)).toBe('synced'));
    expect(again.adopted).not.toHaveBeenCalled();
    expect(again.notes).toEqual([]);
    expect(again.storage.getItem(SAVE_KEY)).toBe(text);
  });

  it('loads the cloud save when this device has nothing the cloud lacks', async () => {
    const w = world();
    const { a, b } = await pair(w);
    w.time.t += 5 * MINUTE;
    const theirs = play(b, w.time.t, 3);
    await b.sync.syncNow();
    expect(serverData(w)).toEqual([theirs]);
    // a had stopped right after its last upload, so its local save is clean.
    const reopened = w.device(a.storage);
    reopened.sync.begin();
    await until(() => expect(reopened.adopted).toHaveBeenCalledOnce());
    expect(reopened.storage.getItem(SAVE_KEY)).toBe(theirs);
    expect(reopened.notes).toEqual(['loaded']);
    // The restart's own check finds nothing new: no loop.
    const restarted = w.device(a.storage);
    restarted.sync.begin();
    await until(() => expect(kind(restarted)).toBe('synced'));
    expect(restarted.adopted).not.toHaveBeenCalled();
  });

  it('loads a cloud save holding a crafted item unchanged', async () => {
    const w = world();
    const { a, b } = await pair(w);
    w.time.t += 5 * MINUTE;
    const theirs = play(b, w.time.t, 3, encodeSave(refinedRun(3), w.time.t));
    await b.sync.syncNow();
    expect(serverData(w)).toEqual([theirs]);
    const reopened = w.device(a.storage);
    reopened.sync.begin();
    await until(() => expect(reopened.adopted).toHaveBeenCalledOnce());
    expect(reopened.storage.getItem(SAVE_KEY)).toBe(theirs);
    expect(loadSave(reopened.storage)?.state).toEqual(refinedRun(3));
  });

  it('asks when both moved on, and changes neither save', async () => {
    const w = world();
    const { a, b } = await pair(w);
    w.time.t += 5 * MINUTE;
    const theirs = play(b, w.time.t, 3);
    await b.sync.syncNow();
    // a played on offline after its last upload.
    const mine = raw(T + 10 * MINUTE, 2);
    a.storage.setItem(SAVE_KEY, mine);
    const reopened = w.device(a.storage);
    reopened.sync.begin();
    await until(() => expect(kind(reopened)).toBe('conflict'));
    const status = reopened.sync.status;
    if (status.kind !== 'conflict') throw new Error('expected conflict');
    expect(status.local.savedAt).toBe(T + 10 * MINUTE);
    expect(status.server.savedAt).toBe(w.time.t);
    expect(reopened.adopted).not.toHaveBeenCalled();
    expect(a.storage.getItem(SAVE_KEY)).toBe(mine);
    expect(serverData(w)).toEqual([theirs]);
    // Nothing goes up while the choice is open.
    reopened.sync.flush('pagehide');
    reopened.sync.offer(mine, T + 10 * MINUTE);
    await settle();
    expect(puts(w)).toHaveLength(1);
  });

  it('adopts the cloud copy when the cloud holds exactly this save (a lost reply)', async () => {
    const w = world();
    const { d } = await enabled(w);
    w.time.t += 5 * MINUTE;
    w.server.loseNextPut = true;
    const text = play(d, w.time.t);
    await until(() => expect(kind(d)).toBe('offline'));
    expect(serverData(w)).toEqual([text]);
    // The page closed; the next visit finds its own save in the cloud, not a conflict.
    const reopened = w.device(d.storage);
    reopened.sync.begin();
    await until(() => expect(kind(reopened)).toBe('synced'));
    expect(reopened.adopted).not.toHaveBeenCalled();
    expect(readMeta(reopened.storage)?.baseRev).toBe(2);
  });

  it('keeps the local save and turns cloud off when the cloud save was deleted elsewhere', async () => {
    const w = world();
    const { d, text } = await enabled(w);
    w.server.saves.clear();
    w.server.members.clear();
    const again = w.device(d.storage);
    again.sync.begin();
    await until(() => expect(kind(again)).toBe('off'));
    expect(again.storage.getItem(SAVE_KEY)).toBe(text);
    expect(again.storage.getItem(CLOUD_KEY)).toBeNull();
    expect(again.notes[0]).toBe('deleted-elsewhere');
  });

  it('starts the run unchanged when the cloud is unreachable, and retries later', async () => {
    const w = world();
    const { d, text } = await enabled(w);
    w.server.down = true;
    const again = w.device(d.storage);
    again.sync.begin();
    await until(() => expect(kind(again)).toBe('offline'));
    expect(again.storage.getItem(SAVE_KEY)).toBe(text);
    w.time.t += 5 * MINUTE;
    play(again, w.time.t);
    await settle();
    expect(puts(w)).toHaveLength(0);
    w.server.down = false;
    again.sync.retry();
    await until(() => expect(kind(again)).toBe('synced'));
    w.time.t += 2 * MINUTE;
    const latest = play(again, w.time.t);
    await until(() => expect(serverData(w)).toEqual([latest]));
  });

  it('shows a malformed reply as a failed check, never as a save', async () => {
    const w = world();
    const { d, text } = await enabled(w);
    w.server.getSaveReply = { save_id: 'nope' };
    const again = w.device(d.storage);
    again.sync.begin();
    await until(() => expect(kind(again)).toBe('offline'));
    expect(again.storage.getItem(SAVE_KEY)).toBe(text);
  });
});

describe('conflicts while playing', () => {
  async function diverged() {
    const w = world();
    const { a, b } = await pair(w);
    w.time.t += 2 * MINUTE;
    const theirs = play(b, w.time.t, 3);
    await until(() => expect(serverData(w)).toEqual([theirs]));
    w.time.t += 2 * MINUTE;
    const mine = play(a, w.time.t, 2);
    await until(() => expect(kind(a)).toBe('conflict'));
    return { w, a, b, mine, theirs };
  }

  it('asks, with a summary of each save, and overwrites nothing', async () => {
    const { w, a, mine, theirs } = await diverged();
    const status = a.sync.status;
    if (status.kind !== 'conflict') throw new Error('expected conflict');
    expect(status.local.state.cultivator.level).toBe(1);
    expect(status.local.savedAt).toBe(w.time.t);
    expect(a.storage.getItem(SAVE_KEY)).toBe(mine);
    expect(serverData(w)).toEqual([theirs]);
    a.sync.offer(mine, w.time.t + MINUTE);
    await settle();
    expect(puts(w).filter((c) => c.body.p_data === mine)).toHaveLength(1);
  });

  it("Keep this device's: replaces the cloud save with the one the player saw", async () => {
    const { w, a, mine } = await diverged();
    await a.sync.keepLocal();
    expect(kind(a)).toBe('synced');
    expect(serverData(w)).toEqual([mine]);
    expect(readMeta(a.storage)?.baseRev).toBe(3);
  });

  it('asks again when the cloud moved once more while the player was choosing', async () => {
    const { w, a, b } = await diverged();
    w.time.t += 2 * MINUTE;
    const newest = play(b, w.time.t, 4);
    await until(() => expect(serverData(w)).toEqual([newest]));
    await a.sync.keepLocal();
    const status = a.sync.status;
    if (status.kind !== 'conflict') throw new Error('expected conflict');
    expect(status.server.savedAt).toBe(w.time.t);
    expect(serverData(w)).toEqual([newest]);
  });

  it('Use cloud save: this device takes it and restarts the run', async () => {
    const { a, theirs } = await diverged();
    a.sync.useCloud();
    expect(a.adopted).toHaveBeenCalledOnce();
    expect(a.storage.getItem(SAVE_KEY)).toBe(theirs);
    expect(readMeta(a.storage)?.baseRev).toBe(2);
  });

  it('keeps the choice open when the connection drops mid Keep', async () => {
    const { w, a } = await diverged();
    w.server.down = true;
    await a.sync.keepLocal();
    expect(kind(a)).toBe('conflict');
    expect(a.notes.length).toBeGreaterThan(0);
  });
});

describe('failures and retries', () => {
  it('backs off 1, 2, then up to 5 minutes, and retries at once when back online', async () => {
    const w = world();
    const { d } = await enabled(w);
    w.server.down = true;
    const at = async (ms: number): Promise<void> => {
      w.time.t = T + ms;
      play(d, w.time.t);
      await settle();
    };
    await at(MINUTE);
    expect(puts(w)).toHaveLength(1);
    await at(MINUTE + 59_000);
    expect(puts(w)).toHaveLength(1);
    await at(2 * MINUTE + 59_000);
    expect(puts(w)).toHaveLength(2);
    await at(2 * MINUTE + 59_000 + 119_000);
    expect(puts(w)).toHaveLength(2);
    expect(kind(d)).toBe('offline');
    w.server.down = false;
    d.sync.retry();
    await until(() => expect(kind(d)).toBe('synced'));
    expect(puts(w)).toHaveLength(3);
  });

  it('survives a lost reply during play: no false conflict', async () => {
    const w = world();
    const { d } = await enabled(w);
    w.time.t += MINUTE;
    w.server.loseNextPut = true;
    play(d, w.time.t);
    await until(() => expect(kind(d)).toBe('offline'));
    w.time.t += 5 * MINUTE;
    const latest = play(d, w.time.t, 2);
    await until(() => expect(kind(d)).toBe('synced'));
    expect(serverData(w)).toEqual([latest]);
  });

  it('two tabs: one uploading while the other waits does not make a conflict', async () => {
    const w = world();
    const { d: one } = await enabled(w);
    const two = w.device(one.storage);
    two.sync.begin();
    await until(() => expect(kind(two)).toBe('synced'));
    let release = (): void => undefined;
    w.server.hold.put_save = new Promise<void>((r) => (release = r));
    w.time.t += 2 * MINUTE;
    const second = play(two, w.time.t, 2);
    await settle();
    w.server.hold.put_save = undefined;
    w.time.t += 1000;
    play(one, w.time.t, 3);
    await until(() => expect(readMeta(one.storage)?.baseRev).toBe(2));
    release();
    await until(() => expect(kind(two)).toBe('synced'));
    expect(readMeta(one.storage)?.baseRev).toBe(3);
    expect(serverData(w)).toEqual([second]);
  });

  it('a second tab starting up finds what the first just uploaded: nothing to do', async () => {
    const w = world();
    const { d: one } = await enabled(w);
    w.time.t += 2 * MINUTE;
    play(one, w.time.t, 2);
    await until(() => expect(readMeta(one.storage)?.baseRev).toBe(2));
    const two = w.device(one.storage);
    two.sync.begin();
    await until(() => expect(kind(two)).toBe('synced'));
    expect(two.adopted).not.toHaveBeenCalled();
  });

  it('stops for good and offers to link again when the sign-in cannot be renewed', async () => {
    const w = world();
    const { d, text } = await enabled(w);
    w.server.revokeRefresh = true;
    w.time.t += 3 * 60 * MINUTE;
    play(d, w.time.t, 2);
    await until(() => expect(kind(d)).toBe('relink'));
    expect(readMeta(d.storage)?.relink).toBe(true);
    const signups = w.server.calls.filter((c) => c.url.endsWith('/signup')).length;
    play(d, w.time.t + MINUTE, 2);
    d.sync.flush('hidden');
    await settle();
    expect(w.server.calls.filter((c) => c.url.endsWith('/signup')).length).toBe(signups);
    // The next visit knows too, with no network at all.
    const calls = w.server.calls.length;
    const again = w.device(d.storage);
    again.sync.begin();
    expect(kind(again)).toBe('relink');
    expect(w.server.calls.length).toBe(calls);
    expect(d.storage.getItem(SAVE_KEY)).not.toBeNull();
    expect(text).toBeTruthy();
    // Start a new cloud save from here.
    w.server.revokeRefresh = false;
    play(again, w.time.t + 2 * MINUTE, 5);
    await again.sync.turnOn();
    expect(kind(again)).toBe('synced');
    expect(w.server.saves.size).toBe(2);
    expect(readMeta(again.storage)?.relink).toBe(false);
  });
});

describe('a cloud save that cannot be read', () => {
  const good = raw(T + 5 * MINUTE, 3);
  interface Doc {
    v: unknown;
    savedAt: unknown;
    extra?: unknown;
    state: {
      floor: unknown;
      stones: unknown;
      cultivator: { level: unknown };
      enemies: { name: unknown }[];
    };
  }
  const edit = (f: (o: Doc) => void): string => {
    const o = JSON.parse(good) as Doc;
    f(o);
    return JSON.stringify(o);
  };
  const hostile: [string, string][] = [
    ['__proto__ key', good.replace('{"v":', '{"__proto__":{"admin":true},"v":')],
    ['constructor key', good.replace('{"v":', '{"constructor":{"prototype":{}},"v":')],
    ['extra key', edit((o) => (o.extra = 1))],
    ['out-of-range level', edit((o) => (o.state.cultivator.level = 9_999_999))],
    ['out-of-range floor', edit((o) => (o.state.floor = -4))],
    ['fractional gold', edit((o) => (o.state.stones = 1.5))],
    [
      'bidi override in a name',
      edit((o) => ((o.state.enemies[0] as { name: unknown }).name = 'Demon‮evil')),
    ],
    [
      'zero-width space in a name',
      edit((o) => ((o.state.enemies[0] as { name: unknown }).name = 'Dem​on')),
    ],
    ['an unknown older version', edit((o) => (o.v = 0))],
    ['a version past any release', edit((o) => (o.v = 1001))],
    ['a newer version that is not a whole number', edit((o) => (o.v = SAVE_VERSION + 0.5))],
    ['savedAt as text', edit((o) => (o.savedAt = '1'))],
    ['oversized', good + ' '.repeat(MAX_SAVE_CHARS)],
    ['not JSON', 'definitely not json'],
    ['an array', '[]'],
    // A crafted item's refine level: only a whole number up to its base roll points.
    ...(
      [
        ['negative', '-1'],
        ['above 100', '101'],
        ['fractional', '2.5'],
        ['a numeric string', '"5"'],
        ['written as 1e999', '1e999'],
        ['above its base roll points', '51'],
        ['beside a pollution key', '7,"__proto__":{"polluted":true}'],
      ] as const
    ).map(([what, text]): [string, string] => [
      `a refine level ${what}`,
      encodeSave(refinedRun(3), T + 5 * MINUTE).replace('"refines":7', `"refines":${text}`),
    ]),
  ];

  it.each(hostile)('rejects %s and leaves the local save byte for byte', async (_name, payload) => {
    const w = world();
    const { d, text } = await enabled(w);
    const id = [...w.server.saves.keys()][0] as string;
    w.server.saves.set(id, { data: payload, rev: 2 });
    const again = w.device(d.storage);
    again.sync.begin();
    await until(() => expect(kind(again)).toBe('unreadable'));
    expect(again.storage.getItem(SAVE_KEY)).toBe(text);
    expect(again.adopted).not.toHaveBeenCalled();
    // Nothing goes up over it.
    w.time.t += 10 * MINUTE;
    play(again, w.time.t);
    again.sync.flush('pagehide');
    await again.sync.syncNow();
    await settle();
    expect(puts(w)).toHaveLength(0);
    expect(w.server.saves.get(id)?.data).toBe(payload);
    expect(again.notes).toHaveLength(1);
    // Told once: the next start shows the state without repeating the message.
    const third = w.device(d.storage);
    third.sync.begin();
    await until(() => expect(kind(third)).toBe('unreadable'));
    expect(third.notes).toEqual([]);
    expect(readMeta(third.storage)?.rejectedRev).toBe(2);
  });

  it('overwrites the cloud only when the player says so', async () => {
    const w = world();
    const { d } = await enabled(w);
    const id = [...w.server.saves.keys()][0] as string;
    w.server.saves.set(id, { data: 'garbage', rev: 2 });
    const again = w.device(d.storage);
    again.sync.begin();
    await until(() => expect(kind(again)).toBe('unreadable'));
    w.time.t += MINUTE;
    const mine = play(again, w.time.t, 2);
    await again.sync.keepLocal();
    expect(kind(again)).toBe('synced');
    expect(w.server.saves.get(id)?.data).toBe(mine);
    expect(readMeta(again.storage)?.rejectedRev).toBeNull();
  });

  it('applies to a save reached through a link code too', async () => {
    const w = world();
    const { d: a } = await enabled(w);
    const id = [...w.server.saves.keys()][0] as string;
    w.server.saves.set(id, { data: '{"__proto__":{}}', rev: 2 });
    const code = (await a.sync.linkCode())?.code as string;
    const b = w.device();
    b.sync.begin();
    const mine = play(b, T + 1, 2);
    await b.sync.link(code);
    expect(kind(b)).toBe('unreadable');
    expect(b.storage.getItem(SAVE_KEY)).toBe(mine);
    expect(b.notes[0]).toBe('unreadable-kept');
  });
});

describe('linking', () => {
  it('a new device joins with a code and chooses between its own run and the cloud', async () => {
    const w = world();
    const { a, b, text } = await pair(w);
    expect(b.storage.getItem(SAVE_KEY)).toBe(text);
    expect(readMeta(b.storage)?.pendingLink).toBe(false);
    expect(w.server.saves.size).toBe(1);
    expect(a.sync.status.kind).toBe('synced');
  });

  it("Keep this device's on a link replaces the cloud save with this run", async () => {
    const w = world();
    const { d: a } = await enabled(w);
    const code = (await a.sync.linkCode())?.code as string;
    const b = w.device();
    b.sync.begin();
    const mine = play(b, T + 1, 2);
    await b.sync.link(code);
    expect(kind(b)).toBe('conflict');
    expect(readMeta(b.storage)?.pendingLink).toBe(true);
    await b.sync.keepLocal();
    expect(kind(b)).toBe('synced');
    expect(serverData(w)).toEqual([mine]);
    expect(readMeta(b.storage)?.pendingLink).toBe(false);
  });

  it('asks again after a restart in the middle of the choice, and uploads nothing meanwhile', async () => {
    const w = world();
    const { d: a } = await enabled(w);
    const code = (await a.sync.linkCode())?.code as string;
    const b = w.device();
    b.sync.begin();
    const mine = play(b, T + 1, 2);
    await b.sync.link(code);
    const reopened = w.device(b.storage);
    reopened.sync.begin();
    play(reopened, T + 2, 2, mine);
    await until(() => expect(kind(reopened)).toBe('conflict'));
    reopened.sync.flush('pagehide');
    await settle();
    expect(puts(w)).toHaveLength(0);
  });

  it('says what is wrong with a bad code and changes nothing', async () => {
    const w = world();
    await enabled(w);
    const b = w.device();
    b.sync.begin();
    const mine = play(b, T + 1, 2);
    await b.sync.link('ZZZZZZZZZZ');
    expect(kind(b)).toBe('off');
    expect(b.notes).toEqual(['link_code_invalid']);
    expect(b.storage.getItem(CLOUD_KEY)).toBeNull();
    expect(b.storage.getItem(SAVE_KEY)).toBe(mine);
  });

  it('sends the code as typed and lets the server read look-alikes and case', async () => {
    const w = world();
    const { d: a } = await enabled(w);
    const code = (await a.sync.linkCode())?.code as string;
    expect(code).toBe('ABCDEFGH10');
    const b = w.device();
    b.sync.begin();
    play(b, T + 1, 2);
    await b.sync.link('abcd-efgh lo');
    expect(kind(b)).toBe('conflict');
    expect(w.server.calls.at(-1)?.body.p_code).toBe('abcd-efgh lo');
  });

  it('a used code is refused the second time', async () => {
    const w = world();
    const { d: a } = await enabled(w);
    const code = (await a.sync.linkCode())?.code as string;
    const b = w.device();
    b.sync.begin();
    play(b, T + 1, 2);
    await b.sync.link(code);
    const c = w.device();
    c.sync.begin();
    play(c, T + 1, 3);
    await c.sync.link(code);
    expect(kind(c)).toBe('off');
    expect(c.notes[0]).toBe('link_code_invalid');
  });

  it('a failed link while on keeps the cloud save as it was', async () => {
    const w = world();
    const { d } = await enabled(w);
    const before = d.storage.getItem(CLOUD_KEY);
    await d.sync.link('ZZZZZZZZZZ');
    expect(d.storage.getItem(CLOUD_KEY)).toBe(before);
    expect(kind(d)).toBe('synced');
  });
});

describe('turning off and resetting', () => {
  it('Turn off forgets the cloud here and leaves the server save for other devices', async () => {
    const w = world();
    const { d, text } = await enabled(w);
    d.sync.turnOff();
    expect(kind(d)).toBe('off');
    expect(d.storage.getItem(CLOUD_KEY)).toBeNull();
    expect(d.storage.getItem(SAVE_KEY)).toBe(text);
    expect(serverData(w)).toEqual([text]);
    w.time.t += 5 * MINUTE;
    play(d, w.time.t);
    await settle();
    expect(puts(w)).toHaveLength(0);
  });

  it('Reset deletes the cloud save first, then forgets it', async () => {
    const w = world();
    const { d } = await enabled(w);
    expect(await d.sync.deleteCloud()).toEqual({ ok: true });
    expect(w.server.saves.size).toBe(0);
    expect(d.storage.getItem(CLOUD_KEY)).toBeNull();
  });

  it('Reset is refused, and nothing changes, when the cloud cannot be reached', async () => {
    const w = world();
    const { d, text } = await enabled(w);
    w.server.down = true;
    const result = await d.sync.deleteCloud();
    expect(result.ok).toBe(false);
    expect(d.storage.getItem(CLOUD_KEY)).not.toBeNull();
    expect(d.storage.getItem(SAVE_KEY)).toBe(text);
    expect(w.server.saves.size).toBe(1);
  });

  it('Reset with nothing on is a no-op, and with a stale sign-in is refused', async () => {
    const w = world();
    const off = w.device();
    off.sync.begin();
    expect(await off.sync.deleteCloud()).toEqual({ ok: true });
    const { d } = await enabled(w);
    w.server.revokeRefresh = true;
    w.time.t += 3 * 60 * MINUTE;
    play(d, w.time.t);
    await until(() => expect(kind(d)).toBe('relink'));
    const result = await d.sync.deleteCloud();
    expect(result.ok).toBe(false);
  });

  it('a tampered settings entry reads as off and the local save is untouched', async () => {
    const w = world();
    const { d, text } = await enabled(w);
    d.storage.setItem(CLOUD_KEY, '{"__proto__":{"saveId":"x"}}');
    const again = w.device(d.storage);
    again.sync.begin();
    expect(kind(again)).toBe('off');
    expect(again.storage.getItem(SAVE_KEY)).toBe(text);
  });
});

describe('what leaves the browser', () => {
  let spies: ReturnType<typeof vi.spyOn>[];
  beforeEach(() => {
    spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('puts no token, code or save data in any URL, and logs nothing', async () => {
    const w = world();
    const { a, b } = await pair(w);
    w.time.t += 5 * MINUTE;
    play(b, w.time.t, 3);
    await b.sync.syncNow();
    w.time.t += 5 * MINUTE;
    play(a, w.time.t, 2);
    await settle();
    a.sync.useCloud();
    await a.sync.deleteCloud();
    expect(w.server.calls.length).toBeGreaterThan(8);
    for (const c of w.server.calls) {
      expect(c.url).toMatch(
        /^https:\/\/abcdefghij\.supabase\.co\/(auth\/v1\/(signup|token\?grant_type=refresh_token)|rest\/v1\/rpc\/[a-z_]+)$/,
      );
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe('a cloud save with a wild timestamp', () => {
  it.each([
    ['far in the future', Number.MAX_SAFE_INTEGER],
    ['at the epoch', 0],
  ])('is adopted, and the catch-up it drives stays bounded: %s', async (_name, savedAt) => {
    const w = world();
    const { d } = await enabled(w);
    const id = [...w.server.saves.keys()][0] as string;
    w.server.saves.set(id, { data: raw(savedAt, 3), rev: 2 });
    const again = w.device(d.storage);
    again.sync.begin();
    await until(() => expect(again.adopted).toHaveBeenCalledOnce());
    // What the app does next on start().
    const loaded = loadSave(again.storage);
    expect(loaded?.savedAt).toBe(savedAt);
    const away = offlineSeconds(loaded?.savedAt as number, T);
    const { summary } = catchUp((loaded as NonNullable<typeof loaded>).state, away);
    expect(summary.seconds).toBeLessThanOrEqual(offlineCap(loaded?.state.passives as never));
    expect(summary.seconds).toBe(savedAt === 0 ? 8 * 60 * 60 : 0);
  });
});

describe('races and edge cases', () => {
  it('Turn off while an upload is out is not undone by its reply', async () => {
    const w = world();
    const { d } = await enabled(w);
    let release = (): void => undefined;
    w.server.hold.put_save = new Promise<void>((r) => (release = r));
    w.time.t += 2 * MINUTE;
    const text = play(d, w.time.t, 2);
    await until(() => expect(kind(d)).toBe('syncing'));
    d.sync.turnOff();
    release();
    await settle();
    expect(d.storage.getItem(CLOUD_KEY)).toBeNull();
    expect(kind(d)).toBe('off');
    expect(d.storage.getItem(SAVE_KEY)).toBe(text);
  });

  it('linking while an upload is out keeps the link choice and its meta', async () => {
    const w = world();
    const { d: a } = await enabled(w);
    const other = w.device();
    other.sync.begin();
    play(other, T + 1, 4);
    await other.sync.turnOn();
    const code = (await other.sync.linkCode())?.code as string;
    let release = (): void => undefined;
    w.server.hold.put_save = new Promise<void>((r) => (release = r));
    w.time.t += 2 * MINUTE;
    play(a, w.time.t, 2);
    await until(() => expect(kind(a)).toBe('syncing'));
    await a.sync.link(code);
    expect(kind(a)).toBe('conflict');
    release();
    await settle();
    expect(kind(a)).toBe('conflict');
    const meta = readMeta(a.storage);
    expect(meta?.pendingLink).toBe(true);
    expect(meta?.saveId).toBe(readMeta(other.storage)?.saveId);
  });

  it('a pagehide while an upload is out sends nothing extra', async () => {
    const w = world();
    const { d } = await enabled(w);
    let release = (): void => undefined;
    w.server.hold.put_save = new Promise<void>((r) => (release = r));
    w.time.t += 2 * MINUTE;
    play(d, w.time.t, 2);
    await until(() => expect(puts(w)).toHaveLength(1));
    play(d, w.time.t + 5000, 3);
    d.sync.flush('pagehide');
    await settle();
    expect(puts(w)).toHaveLength(1);
    release();
    await until(() => expect(kind(d)).toBe('synced'));
    expect(puts(w)).toHaveLength(1);
  });

  it("never overwrites another device's save when a pagehide meets a put that loses", async () => {
    const w = world();
    const { a, b } = await pair(w);
    let release = (): void => undefined;
    w.server.hold.put_save = new Promise<void>((r) => (release = r));
    w.time.t += 2 * MINUTE;
    play(a, w.time.t, 2);
    await until(() => expect(puts(w)).toHaveLength(1));
    play(a, w.time.t + 5000, 3);
    a.sync.flush('pagehide');
    // Device X (b) lands its put at the same base revision first.
    w.server.hold.put_save = undefined;
    w.time.t += 1000;
    const theirs = play(b, w.time.t, 4);
    await until(() => expect(serverData(w)).toEqual([theirs]));
    release();
    await settle();
    expect(serverData(w)).toEqual([theirs]);
    expect(puts(w)).toHaveLength(2);
    expect(kind(a)).toBe('conflict');
  });

  it('Turn off while the first create is out is not undone by its reply', async () => {
    const w = world();
    const d = w.device();
    d.sync.begin();
    play(d, T);
    let release = (): void => undefined;
    w.server.hold.create_save = new Promise<void>((r) => (release = r));
    const on = d.sync.turnOn();
    await until(() =>
      expect(w.server.calls.some((c) => c.url.endsWith('/create_save'))).toBe(true),
    );
    d.sync.turnOff();
    release();
    await on;
    await settle();
    expect(d.storage.getItem(CLOUD_KEY)).toBeNull();
    expect(kind(d)).toBe('off');
  });

  it('linking while the first create is out keeps the link choice', async () => {
    const w = world();
    const { d: host } = await enabled(w);
    const code = (await host.sync.linkCode())?.code as string;
    const d = w.device();
    d.sync.begin();
    play(d, T + 1, 2);
    let release = (): void => undefined;
    w.server.hold.create_save = new Promise<void>((r) => (release = r));
    const on = d.sync.turnOn();
    await until(() =>
      expect(w.server.calls.some((c) => c.url.endsWith('/create_save'))).toBe(true),
    );
    await d.sync.link(code);
    expect(kind(d)).toBe('conflict');
    release();
    await on;
    await settle();
    expect(kind(d)).toBe('conflict');
    const meta = readMeta(d.storage);
    expect(meta?.pendingLink).toBe(true);
    expect(meta?.saveId).toBe(readMeta(host.storage)?.saveId);
  });

  it('a refused adopt signal leaves the old run in place', async () => {
    const w = world();
    const { a, b } = await pair(w);
    w.time.t += 2 * MINUTE;
    play(b, w.time.t, 3);
    await until(() => expect(readMeta(b.storage)?.baseRev).toBe(2));
    const mine = raw(w.time.t + 1000, 2);
    a.storage.setItem(SAVE_KEY, mine);
    const reopened = w.device(a.storage);
    reopened.sync.begin();
    await until(() => expect(kind(reopened)).toBe('conflict'));
    const metaBefore = a.storage.getItem(CLOUD_KEY);
    const set = a.storage.setItem;
    a.storage.setItem = (k, v) => {
      if (k === ADOPT_KEY) throw new Error('quota');
      set(k, v);
    };
    reopened.sync.useCloud();
    a.storage.setItem = set;
    expect(a.storage.getItem(SAVE_KEY)).toBe(mine);
    expect(a.storage.getItem(CLOUD_KEY)).toBe(metaBefore);
    expect(reopened.adopted).not.toHaveBeenCalled();
  });

  it('a hidden upload renews a near-expiry token so the pagehide upload can use keepalive', async () => {
    const w = world();
    const { d } = await enabled(w);
    w.time.t += 3_600_000 - 30_000;
    const first = play(d, w.time.t, 2);
    d.sync.flush('hidden');
    await until(() => expect(serverData(w)).toEqual([first]));
    await until(() => expect(kind(d)).toBe('synced'));
    expect(w.server.calls.filter((c) => c.url.includes('refresh_token'))).toHaveLength(1);
    const second = play(d, w.time.t + 1000, 3);
    d.sync.flush('pagehide');
    await until(() => expect(serverData(w)).toEqual([second]));
    expect(puts(w).at(-1)?.init.keepalive).toBe(true);
  });

  it('taking the cloud save writes the settings first, and a refusal leaves the run as it was', async () => {
    const w = world();
    const { a, b } = await pair(w);
    w.time.t += 2 * MINUTE;
    play(b, w.time.t, 3);
    await until(() => expect(readMeta(b.storage)?.baseRev).toBe(2));
    const mine = play(a, w.time.t + 1000, 2);
    a.storage.setItem(SAVE_KEY, mine);
    const reopened = w.device(a.storage);
    reopened.sync.begin();
    await until(() => expect(kind(reopened)).toBe('conflict'));
    const metaBefore = a.storage.getItem(CLOUD_KEY);
    // The settings write is refused: nothing changes.
    a.storage.failWrites = true;
    reopened.sync.useCloud();
    a.storage.failWrites = false;
    expect(a.storage.getItem(SAVE_KEY)).toBe(mine);
    expect(reopened.adopted).not.toHaveBeenCalled();
    expect(a.storage.getItem(CLOUD_KEY)).toBe(metaBefore);
  });

  it('rolls the settings back when only the save write is refused', async () => {
    const w = world();
    const { a, b } = await pair(w);
    w.time.t += 2 * MINUTE;
    play(b, w.time.t, 3);
    await until(() => expect(readMeta(b.storage)?.baseRev).toBe(2));
    const mine = raw(w.time.t + 1000, 2);
    a.storage.setItem(SAVE_KEY, mine);
    const reopened = w.device(a.storage);
    reopened.sync.begin();
    await until(() => expect(kind(reopened)).toBe('conflict'));
    const metaBefore = a.storage.getItem(CLOUD_KEY);
    const set = a.storage.setItem;
    a.storage.setItem = (k, v) => {
      if (k === SAVE_KEY) throw new Error('quota');
      set(k, v);
    };
    reopened.sync.useCloud();
    a.storage.setItem = set;
    expect(a.storage.getItem(SAVE_KEY)).toBe(mine);
    expect(a.storage.getItem(CLOUD_KEY)).toBe(metaBefore);
    expect(reopened.adopted).not.toHaveBeenCalled();
    expect(reopened.notes.at(-1)).toBe('refused-save');
  });

  it('only taking the cloud save signals the other tabs, not uploads or autosaves', async () => {
    const w = world();
    const { a, b } = await pair(w);
    expect(b.storage.getItem(ADOPT_KEY)).not.toBeNull();
    const signal = a.storage.getItem(ADOPT_KEY);
    for (let i = 1; i <= 3; i++) {
      w.time.t += 2 * MINUTE;
      play(a, w.time.t, 2);
      await settle();
    }
    expect(a.storage.getItem(ADOPT_KEY)).toBe(signal);
    // A restarted tab finds the cloud as it left it: no second adoption, no loop.
    const again = w.device(a.storage);
    again.sync.begin();
    await until(() => expect(kind(again)).toBe('synced'));
    expect(a.storage.getItem(ADOPT_KEY)).toBe(signal);
    expect(again.adopted).not.toHaveBeenCalled();
  });
});

describe('linking from the Path choice (no run yet)', () => {
  it('loads the cloud save with no conflict', async () => {
    const w = world();
    const { d: host, text } = await enabled(w);
    const code = (await host.sync.linkCode())?.code as string;
    const d = w.device();
    d.sync.begin();
    await d.sync.link(code.toLowerCase());
    expect(d.adopted).toHaveBeenCalledOnce();
    expect(d.storage.getItem(SAVE_KEY)).toBe(text);
    expect(readMeta(d.storage)?.pendingLink).toBe(false);
    expect(readMeta(d.storage)?.baseRev).toBe(1);
    expect(d.notes).toEqual(['loaded']);
    const restarted = w.device(d.storage);
    restarted.sync.begin();
    await until(() => expect(kind(restarted)).toBe('synced'));
  });

  it('leaves no settings behind after a bad code or no connection', async () => {
    const w = world();
    const { d: host } = await enabled(w);
    const code = (await host.sync.linkCode())?.code as string;
    const d = w.device();
    d.sync.begin();
    await d.sync.link('ZZZZZZZZZZ');
    expect(d.storage.getItem(CLOUD_KEY)).toBeNull();
    expect(d.notes[0]).toBe('link_code_invalid');
    w.server.down = true;
    await d.sync.link(code);
    expect(d.storage.getItem(CLOUD_KEY)).toBeNull();
    expect(d.storage.getItem(SAVE_KEY)).toBeNull();
    expect(kind(d)).toBe('off');
    expect(d.adopted).not.toHaveBeenCalled();
  });

  it('refuses an unreadable cloud save and stays off', async () => {
    const w = world();
    const { d: host } = await enabled(w);
    const id = [...w.server.saves.keys()][0] as string;
    w.server.saves.set(id, { data: '{"__proto__":{}}', rev: 2 });
    const code = (await host.sync.linkCode())?.code as string;
    const d = w.device();
    d.sync.begin();
    await d.sync.link(code);
    expect(d.storage.getItem(CLOUD_KEY)).toBeNull();
    expect(d.storage.getItem(SAVE_KEY)).toBeNull();
    expect(kind(d)).toBe('off');
    expect(d.notes[0]).toBe('cant-read');
  });
});

describe('link robustness', () => {
  it('two link calls at once sign up and redeem once, and the meta survives', async () => {
    const w = world();
    const { d: host } = await enabled(w);
    const code = (await host.sync.linkCode())?.code as string;
    const d = w.device();
    d.sync.begin();
    play(d, T + 1, 2);
    await Promise.all([d.sync.link(code), d.sync.link(code)]);
    expect(w.server.calls.filter((c) => c.url.endsWith('/signup'))).toHaveLength(2);
    expect(w.server.calls.filter((c) => c.url.endsWith('/redeem_link_code'))).toHaveLength(1);
    expect(kind(d)).toBe('conflict');
    expect(readMeta(d.storage)?.pendingLink).toBe(true);
  });

  it('a refused save write during a link leaves a sane status, not syncing', async () => {
    const w = world();
    const { d: host } = await enabled(w);
    const code = (await host.sync.linkCode())?.code as string;
    const d = w.device();
    d.sync.begin();
    const set = d.storage.setItem;
    d.storage.setItem = (k, v) => {
      if (k === SAVE_KEY) throw new Error('quota');
      set(k, v);
    };
    await d.sync.link(code);
    expect(d.adopted).not.toHaveBeenCalled();
    expect(kind(d)).toBe('offline');
    expect(d.notes.at(-1)).toBe('refused-save');
    expect(d.storage.getItem(SAVE_KEY)).toBeNull();
  });

  it("a failing link leaves another tab's settings alone", async () => {
    const w = world();
    const d = w.device();
    d.sync.begin();
    play(d, T + 1, 2);
    let release = (): void => undefined;
    w.server.hold.redeem_link_code = new Promise<void>((r) => (release = r));
    const linking = d.sync.link('ZZZZZZZZZZ');
    await until(() =>
      expect(w.server.calls.some((c) => c.url.endsWith('/redeem_link_code'))).toBe(true),
    );
    const other = {
      ...newMeta({ access: 'access-token-other1', refresh: 'refresh-token-other1', expiresAt: T }),
      saveId: SAVE_ID,
    };
    writeMeta(d.storage, other);
    release();
    await linking;
    expect(readMeta(d.storage)).toEqual(other);
  });
});

/** A save from a later release: its state holds fields this build doesn't know. */
const newer = (savedAt: number): string =>
  JSON.stringify({ v: SAVE_VERSION + 1, savedAt, state: { fromTheFuture: true } });

describe('a cloud save from a newer release', () => {
  it('pauses for an update at startup: no note, no rejection, nothing uploaded or loaded', async () => {
    const w = world();
    const { d, text } = await enabled(w);
    const id = [...w.server.saves.keys()][0] as string;
    const theirs = newer(T + MINUTE);
    w.server.saves.set(id, { data: theirs, rev: 2 });
    const again = w.device(d.storage);
    again.sync.begin();
    await until(() => expect(kind(again)).toBe('update'));
    expect(again.notes).toEqual([]);
    expect(readMeta(again.storage)?.rejectedRev).toBeNull();
    expect(again.storage.getItem(SAVE_KEY)).toBe(text);
    expect(again.adopted).not.toHaveBeenCalled();
    w.time.t += 10 * MINUTE;
    play(again, w.time.t, 2);
    again.sync.flush('hidden');
    again.sync.flush('pagehide');
    again.sync.retry();
    await again.sync.syncNow();
    await again.sync.keepLocal();
    again.sync.useCloud();
    await settle();
    expect(puts(w)).toHaveLength(0);
    expect(w.server.saves.get(id)?.data).toBe(theirs);
    expect(kind(again)).toBe('update');
  });

  it('pauses when an upload is refused over a newer save, and writes nothing over it', async () => {
    const w = world();
    const { a, b } = await pair(w);
    const theirs = newer(w.time.t + MINUTE);
    const id = [...w.server.saves.keys()][0] as string;
    w.server.saves.set(id, { data: theirs, rev: (w.server.saves.get(id)?.rev ?? 0) + 1 });
    w.time.t += 2 * MINUTE;
    play(a, w.time.t, 4);
    await until(() => expect(kind(a)).toBe('update'));
    w.time.t += 2 * MINUTE;
    play(a, w.time.t, 5);
    await a.sync.syncNow();
    await settle();
    expect(w.server.saves.get(id)?.data).toBe(theirs);
    expect(kind(b)).not.toBe('update');
  });

  it('never settles against a newer local save, even with an older cloud save to load', async () => {
    const w = world();
    const { a, b } = await pair(w);
    // The cloud moved on (so a restart would normally load it) and the local save is newer.
    w.time.t += MINUTE;
    play(a, w.time.t, 3);
    await until(() => expect(serverData(w)).toHaveLength(1));
    await a.sync.syncNow();
    const mine = newer(w.time.t + MINUTE);
    b.storage.setItem(SAVE_KEY, mine);
    const reopened = w.device(b.storage);
    const before = w.server.calls.length;
    reopened.sync.begin();
    await settle();
    expect(kind(reopened)).toBe('update');
    expect(reopened.adopted).not.toHaveBeenCalled();
    expect(reopened.storage.getItem(SAVE_KEY)).toBe(mine);
    expect(w.server.calls.length).toBe(before);
  });

  it('linking from the Path choice keeps the link, so the newer release completes it without a new code', async () => {
    const w = world();
    const { d: host } = await enabled(w);
    const id = [...w.server.saves.keys()][0] as string;
    w.server.saves.set(id, { data: newer(T + MINUTE), rev: 2 });
    const code = (await host.sync.linkCode())?.code as string;
    const d = w.device();
    d.sync.begin();
    await d.sync.link(code);
    expect(kind(d)).toBe('update');
    expect(d.notes).toEqual([]);
    expect(d.storage.getItem(SAVE_KEY)).toBeNull();
    const meta = readMeta(d.storage);
    expect(meta?.saveId).toBe(id);
    expect(meta?.pendingLink).toBe(true);
    // The reload: the newer release reads the save (stood in for here by a readable one).
    const readable = raw(T + MINUTE, 7);
    w.server.saves.set(id, { data: readable, rev: 2 });
    const updated = w.device(d.storage);
    updated.sync.begin();
    await until(() => expect(updated.adopted).toHaveBeenCalledOnce());
    expect(updated.storage.getItem(SAVE_KEY)).toBe(readable);
    expect(readMeta(updated.storage)?.pendingLink).toBe(false);
    expect(w.server.calls.filter((c) => c.url.endsWith('/redeem_link_code'))).toHaveLength(1);
  });

  it('linking with a run keeps the run and asks which to keep after the update', async () => {
    const w = world();
    const { d: host } = await enabled(w);
    const id = [...w.server.saves.keys()][0] as string;
    w.server.saves.set(id, { data: newer(T + MINUTE), rev: 2 });
    const code = (await host.sync.linkCode())?.code as string;
    const d = w.device();
    d.sync.begin();
    const mine = play(d, T + 2, 2);
    await d.sync.link(code);
    expect(kind(d)).toBe('update');
    expect(d.storage.getItem(SAVE_KEY)).toBe(mine);
    expect(puts(w)).toHaveLength(0);
    w.server.saves.set(id, { data: raw(T + MINUTE, 7), rev: 2 });
    const updated = w.device(d.storage);
    updated.sync.begin();
    await until(() => expect(kind(updated)).toBe('conflict'));
    expect(updated.storage.getItem(SAVE_KEY)).toBe(mine);
  });
});
