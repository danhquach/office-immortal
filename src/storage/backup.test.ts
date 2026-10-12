import { afterEach, describe, expect, it } from 'vitest';
import { newGame, type GameState } from '../core/sim.ts';
import {
  clearBoth,
  FUTURE_SLACK_MS,
  idbBackup,
  loadNewest,
  newest,
  writeBoth,
  type Backup,
} from './backup.ts';
import { memory } from './cloud-fakes.ts';
import { decodeSave, encodeSave, MAX_SAVE_CHARS, REJECTED_KEY, SAVE_KEY } from './save.ts';

const raw = (savedAt: number, seed = 1): string => encodeSave(newGame(seed, 'sword'), savedAt);
/** A new run holding one Mortal cap refined 7 times, on a base roll of 50%. */
function refinedRun(): GameState {
  const s = newGame(1, 'sword');
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
/** The refined run saved at `savedAt`, its refine level written as `refines` (raw JSON). */
const refinedRaw = (savedAt: number, refines = '7'): string =>
  encodeSave(refinedRun(), savedAt).replace('"refines":7', `"refines":${refines}`);
/** The clock at load: after every stamp below. */
const NOW = 10_000;

interface FakeIdb {
  factory: IDBFactory;
  data: Map<string, unknown>;
  /** Every later write or delete aborts, as a full or broken database does. */
  failWrites: boolean;
}

/**
 * Just enough of IndexedDB for the backup: one database, one store, requests
 * that answer on a later microtask as the real ones do.
 */
function fakeIdb(mode: 'ok' | 'error' | 'errorOnce' | 'hang' | 'throw' = 'ok'): FakeIdb {
  const data = new Map<string, unknown>();
  const fake: FakeIdb = { factory: null as unknown as IDBFactory, data, failWrites: false };
  let created = false;
  let failedOnce = false;
  const later = (fn: () => void): void => void Promise.resolve().then(fn);
  const db = {
    onversionchange: null,
    close: () => {},
    createObjectStore: () => void (created = true),
    transaction: () => {
      const tx: Record<string, (() => void) | null> & { objectStore?: () => unknown } = {
        oncomplete: null,
        onerror: null,
        onabort: null,
      };
      const finish = (ok: boolean): void => later(() => (ok ? tx.oncomplete?.() : tx.onabort?.()));
      const store = {
        transaction: tx,
        get: (k: string) => {
          const req: { result?: unknown; onsuccess: (() => void) | null } = { onsuccess: null };
          later(() => {
            req.result = data.get(k);
            req.onsuccess?.();
            finish(true);
          });
          return req;
        },
        put: (v: unknown, k: string) => {
          if (!fake.failWrites) data.set(k, v);
          finish(!fake.failWrites);
        },
        delete: (k: string) => {
          if (!fake.failWrites) data.delete(k);
          finish(!fake.failWrites);
        },
      };
      tx.objectStore = () => store;
      return tx;
    },
  };
  fake.factory = {
    open: () => {
      if (mode === 'throw') throw new Error('SecurityError');
      const req: Record<string, unknown> & {
        onsuccess?: () => void;
        onerror?: () => void;
        onupgradeneeded?: () => void;
      } = {};
      later(() => {
        if (mode === 'hang') return;
        if (mode === 'error') return req.onerror?.();
        if (mode === 'errorOnce' && !failedOnce) {
          failedOnce = true;
          return req.onerror?.();
        }
        req.result = db;
        if (!created) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  } as unknown as IDBFactory;
  return fake;
}

/** A backup whose stored value is `value` as is (what another script on the origin could put there). */
async function holding(value: unknown): Promise<Backup> {
  const idb = fakeIdb();
  const backup = idbBackup(idb.factory, 50);
  await backup.put('x');
  idb.data.set('save', value);
  return backup;
}

afterEach(() => {
  // No hostile payload may reach the shared prototype.
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});

describe('IndexedDB backup', () => {
  it('stores the save text and reads it back', async () => {
    const backup = idbBackup(fakeIdb().factory);
    expect(await backup.read()).toBeNull();
    expect(await backup.put(raw(5))).toBe(true);
    expect(await backup.read()).toBe(raw(5));
    expect(await backup.put(raw(9))).toBe(true);
    expect(await backup.read()).toBe(raw(9));
  });

  it('clears the copy', async () => {
    const backup = idbBackup(fakeIdb().factory);
    await backup.put(raw(5));
    expect(await backup.clear()).toBe(true);
    expect(await backup.read()).toBeNull();
  });

  it('reports a refused write or delete, without throwing', async () => {
    const idb = fakeIdb();
    const backup = idbBackup(idb.factory);
    await backup.put(raw(5));
    idb.failWrites = true;
    expect(await backup.put(raw(9))).toBe(false);
    expect(await backup.clear()).toBe(false);
    expect(await backup.read()).toBe(raw(5));
  });

  for (const mode of ['error', 'throw'] as const) {
    it(`holds nothing where IndexedDB fails to open (${mode})`, async () => {
      const backup = idbBackup(fakeIdb(mode).factory);
      expect(await backup.put(raw(5))).toBe(false);
      expect(await backup.read()).toBeNull();
      // Nothing could be stored, so nothing is left to delete.
      expect(await backup.clear()).toBe(true);
    });
  }

  it('tries to open again after a refused open', async () => {
    const backup = idbBackup(fakeIdb('errorOnce').factory);
    expect(await backup.put(raw(5))).toBe(false);
    expect(await backup.put(raw(6))).toBe(true);
    expect(await backup.read()).toBe(raw(6));
  });

  it('holds nothing without IndexedDB', async () => {
    const backup = idbBackup(null);
    expect(await backup.put(raw(5))).toBe(false);
    expect(await backup.read()).toBeNull();
    expect(await backup.clear()).toBe(true);
  });

  it('gives up on a database that never answers', async () => {
    const backup = idbBackup(fakeIdb('hang').factory, 10);
    expect(await backup.read()).toBeNull();
    expect(await backup.put(raw(5))).toBe(false);
    expect(await backup.clear()).toBe(false);
  });

  it('reads only text of a save size', async () => {
    for (const value of [
      42,
      null,
      { v: 7 },
      ['x'],
      JSON.parse('{"__proto__":{"polluted":1}}'),
      new Uint8Array(3),
      'x'.repeat(MAX_SAVE_CHARS + 1),
    ]) {
      expect(await (await holding(value)).read()).toBeNull();
    }
  });
});

describe('newest', () => {
  const a = decodeSave(raw(100));
  const b = decodeSave(raw(200, 2));
  it('takes the later stamp, the local copy on a tie, and whichever exists', () => {
    expect(newest(a, b, NOW)).toBe(b);
    expect(newest(b, a, NOW)).toBe(b);
    expect(newest(a, decodeSave(raw(100, 2)), NOW)).toBe(a);
    expect(newest(null, a, NOW)).toBe(a);
    expect(newest(a, null, NOW)).toBe(a);
    expect(newest(null, null, NOW)).toBeNull();
  });

  it('never prefers a backup stamped in the future over a local save', () => {
    const planted = decodeSave(raw(NOW + FUTURE_SLACK_MS + 1, 2));
    expect(newest(a, planted, NOW)).toBe(a);
    expect(newest(a, decodeSave(raw(NOW + FUTURE_SLACK_MS, 2)), NOW)?.savedAt).toBe(
      NOW + FUTURE_SLACK_MS,
    );
    // With nothing else, it still beats losing the run.
    expect(newest(null, planted, NOW)).toBe(planted);
  });
});

describe('loadNewest', () => {
  async function load(local: string | null, backupValue: unknown, idb = fakeIdb()) {
    const storage = memory();
    if (local !== null) storage.setItem(SAVE_KEY, local);
    const backup = idbBackup(idb.factory, 20);
    if (backupValue !== undefined) {
      await backup.put('x');
      idb.data.set('save', backupValue);
    }
    return { save: await loadNewest(storage, backup, NOW), storage };
  }

  it('loads the newer of the two copies', async () => {
    expect((await load(raw(100), raw(200))).save?.savedAt).toBe(200);
    expect((await load(raw(300), raw(200))).save?.savedAt).toBe(300);
  });

  it('loads the backup after browser storage was cleared', async () => {
    expect((await load(null, raw(200))).save?.savedAt).toBe(200);
  });

  it('loads the backup where browser storage is blocked', async () => {
    const idb = fakeIdb();
    const backup = idbBackup(idb.factory);
    await backup.put(raw(200));
    expect((await loadNewest(null, backup, NOW))?.savedAt).toBe(200);
  });

  it('loads browser storage alone, as before, without a working IndexedDB', async () => {
    for (const mode of ['error', 'throw', 'hang'] as const) {
      expect((await load(raw(100), undefined, fakeIdb(mode))).save?.savedAt).toBe(100);
      expect((await load(null, undefined, fakeIdb(mode))).save).toBeNull();
    }
    const storage = memory();
    storage.setItem(SAVE_KEY, raw(100));
    expect((await loadNewest(storage, idbBackup(null), NOW))?.savedAt).toBe(100);
  });

  it('never lets a broken backup replace a good save', async () => {
    const good = raw(100);
    const later = JSON.parse(raw(9_999)) as { state: { kills: unknown } };
    const tampered = { ...later, state: { ...later.state, kills: -1 } };
    for (const bad of [
      'not json',
      '{"v":7,"savedAt":9999,"state":{}}',
      JSON.stringify(tampered),
      // Prototype pollution, at the top and deep in the state.
      `{"v":7,"savedAt":9999,"state":{},"__proto__":{"polluted":1}}`,
      raw(9_999).replace('"state":{', '"state":{"__proto__":{"polluted":1},'),
      raw(9_999).replace('"state":{', '"state":{"constructor":{"prototype":{"polluted":1}},'),
      // Unicode tricks in a name: a bidi override, a zero-width space, a Cyrillic look-alike.
      ...['‮sword', 'sw​ord', 'swоrd'].map((path) => {
        const text = raw(9_999).replace('"path":"sword"', `"path":${JSON.stringify(path)}`);
        expect(text).not.toBe(raw(9_999));
        return text;
      }),
      // Oversized.
      'x'.repeat(MAX_SAVE_CHARS + 1),
      { savedAt: 9_999 },
    ]) {
      const { save, storage } = await load(good, bad);
      expect(save?.savedAt).toBe(100);
      // The good local save is still there; a bad backup isn't copied over it.
      expect(storage.getItem(SAVE_KEY)).toBe(good);
    }
  });

  it('round-trips a crafted item through the backup', async () => {
    const { save } = await load(null, refinedRaw(200));
    expect(save?.state).toEqual(refinedRun());
    expect(save?.state.inventory[0]?.refines).toBe(7);
  });

  it('never lets a backup with a bad refine level replace a good save', async () => {
    const good = raw(100);
    for (const bad of ['-1', '101', '2.5', '"5"', '1e999', '51', 'null', '7,"__proto__":{"x":1}']) {
      const text = refinedRaw(9_999, bad);
      expect(text, bad).toContain(`"refines":${bad}`);
      const { save, storage } = await load(good, text);
      expect(save?.savedAt, bad).toBe(100);
      expect(storage.getItem(SAVE_KEY)).toBe(good);
    }
  });

  it('uses a good backup over a broken local save, and keeps the broken one aside', async () => {
    const { save, storage } = await load('{"broken"', raw(50));
    expect(save?.savedAt).toBe(50);
    expect(storage.getItem(REJECTED_KEY)).toBe('{"broken"');
  });

  it('loads nothing when both copies are broken', async () => {
    expect((await load('nope', '{"v":1}')).save).toBeNull();
  });
});

describe('writeBoth', () => {
  it('writes both copies', async () => {
    const storage = memory();
    const idb = fakeIdb();
    const backup = idbBackup(idb.factory);
    expect(writeBoth(storage, backup, raw(5))).toBe(true);
    expect(storage.getItem(SAVE_KEY)).toBe(raw(5));
    expect(await backup.read()).toBe(raw(5));
  });

  it('still writes the backup when browser storage is full or blocked', async () => {
    const storage = memory();
    storage.failWrites = true;
    const backup = idbBackup(fakeIdb().factory);
    expect(writeBoth(storage, backup, raw(5))).toBe(false);
    expect(await backup.read()).toBe(raw(5));
    const blocked = idbBackup(fakeIdb().factory);
    expect(writeBoth(null, blocked, raw(6))).toBe(false);
    expect(await blocked.read()).toBe(raw(6));
  });

  it('still writes browser storage when the backup refuses', async () => {
    const storage = memory();
    const idb = fakeIdb();
    idb.failWrites = true;
    expect(writeBoth(storage, idbBackup(idb.factory), raw(5))).toBe(true);
    expect(storage.getItem(SAVE_KEY)).toBe(raw(5));
    expect(writeBoth(storage, idbBackup(fakeIdb('throw').factory), raw(6))).toBe(true);
    expect(storage.getItem(SAVE_KEY)).toBe(raw(6));
  });
});

describe('clearBoth', () => {
  async function both() {
    const storage = memory();
    const idb = fakeIdb();
    const backup = idbBackup(idb.factory);
    writeBoth(storage, backup, raw(5));
    storage.setItem(REJECTED_KEY, 'old');
    expect(await backup.read()).toBe(raw(5));
    return { storage, idb, backup };
  }

  it('deletes both copies and the rejected one', async () => {
    const { storage, backup } = await both();
    expect(await clearBoth(storage, backup)).toBe(true);
    expect(storage.getItem(SAVE_KEY)).toBeNull();
    expect(storage.getItem(REJECTED_KEY)).toBeNull();
    expect(await backup.read()).toBeNull();
    expect(await loadNewest(storage, backup, NOW)).toBeNull();
  });

  it('keeps browser storage when the backup refuses, so nothing is half reset', async () => {
    const { storage, idb, backup } = await both();
    idb.failWrites = true;
    expect(await clearBoth(storage, backup)).toBe(false);
    expect(storage.getItem(SAVE_KEY)).toBe(raw(5));
  });

  it('reports browser storage refusing', async () => {
    const { storage, backup } = await both();
    storage.removeItem = () => {
      throw new Error('blocked');
    };
    expect(await clearBoth(storage, backup)).toBe(false);
  });

  it('works on either copy alone', async () => {
    const backup = idbBackup(fakeIdb().factory);
    await backup.put(raw(5));
    expect(await clearBoth(null, backup)).toBe(true);
    expect(await backup.read()).toBeNull();
    const storage = memory();
    storage.setItem(SAVE_KEY, raw(5));
    expect(await clearBoth(storage, idbBackup(null))).toBe(true);
    expect(storage.getItem(SAVE_KEY)).toBeNull();
  });
});
