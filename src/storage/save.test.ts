import { describe, expect, it } from 'vitest';
import { equip, newGame, tick, type GameState } from '../core/sim.ts';
import {
  decodeSave,
  encodeSave,
  loadSave,
  MAX_SAVE_CHARS,
  REJECTED_KEY,
  SAVE_KEY,
  writeSave,
  type SaveStorage,
} from './save.ts';

const SAVED_AT = 1_800_000_000_000;

/** A run a few hours in, with gear on and items in the bag, so every field is exercised. */
function played(): GameState {
  let s = tick(newGame(11, 'sword'), 3 * 60 * 60);
  for (let i = 0; i < 4 && s.inventory.length > 0; i++) s = equip(s, 0);
  return s;
}

const STATE = played();

function memory(): SaveStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

/** The save as plain JSON data, to be tampered with. */
function raw(): { v: number; savedAt: number; state: Record<string, unknown> } {
  return JSON.parse(encodeSave(STATE, SAVED_AT));
}

/** Applies `change` to a fresh copy of the save and decodes the result. */
function tampered(change: (save: ReturnType<typeof raw>) => void): unknown {
  const save = raw();
  change(save);
  return decodeSave(JSON.stringify(save));
}

// Typed views into the tampered JSON.
type J = Record<string, unknown>;
const cult = (s: ReturnType<typeof raw>) => s.state.cultivator as J;
const item = (s: ReturnType<typeof raw>) => (s.state.inventory as J[])[0] as J;
const enemy = (s: ReturnType<typeof raw>) => (s.state.enemies as J[])[0] as J;

describe('round trip', () => {
  it('has gear and drops to round-trip', () => {
    expect(STATE.inventory.length).toBeGreaterThan(0);
    expect(Object.keys(STATE.cultivator.equipment).length).toBeGreaterThan(0);
  });

  it('loads exactly what it saved', () => {
    expect(decodeSave(encodeSave(STATE, SAVED_AT))).toEqual({ state: STATE, savedAt: SAVED_AT });
  });

  it('round-trips a brand-new run of every Path', () => {
    for (const path of ['sword', 'body', 'talisman'] as const) {
      const s = newGame(5, path);
      expect(decodeSave(encodeSave(s, 0))?.state).toEqual(s);
    }
  });

  it('plays on from a loaded save exactly as from the original', () => {
    const loaded = decodeSave(encodeSave(STATE, SAVED_AT));
    expect(loaded && tick(loaded.state, 600)).toEqual(tick(STATE, 600));
  });

  it('round-trips every point of long runs with gear put on in any order', () => {
    for (const path of ['sword', 'body', 'talisman'] as const) {
      let s = newGame(21, path);
      for (let i = 0; i < 40; i++) {
        s = tick(s, 900);
        // Equip from the back of the bag, so positions fill out of display order.
        if (s.inventory.length > 0) s = equip(s, s.inventory.length - 1);
        expect(decodeSave(encodeSave(s, SAVED_AT))?.state).toEqual(s);
      }
    }
  });

  it('writes to and reads from storage', () => {
    const store = memory();
    expect(writeSave(store, STATE, SAVED_AT)).toBe(true);
    expect(store.data.has(SAVE_KEY)).toBe(true);
    expect(loadSave(store)).toEqual({ state: STATE, savedAt: SAVED_AT });
  });

  it('keeps a rejected save under a second key instead of losing it', () => {
    const store = memory();
    store.data.set(SAVE_KEY, '{"v":99}');
    expect(loadSave(store)).toBeNull();
    expect(store.data.get(REJECTED_KEY)).toBe('{"v":99}');
  });

  it('does not copy an oversized rejected value', () => {
    const store = memory();
    store.data.set(SAVE_KEY, 'x'.repeat(MAX_SAVE_CHARS + 1));
    expect(loadSave(store)).toBeNull();
    expect(store.data.has(REJECTED_KEY)).toBe(false);
  });

  it('has nothing to load from empty storage', () => {
    expect(loadSave(memory())).toBeNull();
  });

  it('survives storage that throws', () => {
    const broken: SaveStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(loadSave(broken)).toBeNull();
    expect(writeSave(broken, STATE, SAVED_AT)).toBe(false);
  });
});

describe('rejects', () => {
  it.each([
    ['nothing', null],
    ['a number', 42],
    ['empty text', ''],
    ['broken JSON', '{"v":1,'],
    ['JSON null', 'null'],
    ['a JSON array', '[]'],
    ['a JSON string', '"save"'],
  ])('%s', (_, input) => {
    expect(decodeSave(input)).toBeNull();
  });

  it('an oversized save without parsing it', () => {
    const big = encodeSave(STATE, SAVED_AT).replace('}', `,"pad":"${'x'.repeat(MAX_SAVE_CHARS)}"}`);
    expect(decodeSave(big)).toBeNull();
  });

  it('deeply nested JSON', () => {
    expect(decodeSave('['.repeat(100_000) + ']'.repeat(100_000))).toBeNull();
  });

  it.each([
    ['an unknown version', (s: ReturnType<typeof raw>) => void (s.v = 2)],
    ['a version as text', (s: ReturnType<typeof raw>) => void ((s as J).v = '1')],
    ['a missing state', (s: ReturnType<typeof raw>) => void delete (s as J).state],
    ['an extra top-level key', (s: ReturnType<typeof raw>) => void ((s as J).admin = true)],
    ['a stamp as text', (s: ReturnType<typeof raw>) => void ((s as J).savedAt = '1800000000000')],
    ['a negative stamp', (s: ReturnType<typeof raw>) => void (s.savedAt = -1)],
  ])('%s', (_, change) => {
    expect(tampered(change)).toBeNull();
  });

  describe('wrong types', () => {
    it.each([
      ['floor as text', (s: ReturnType<typeof raw>) => void (s.state.floor = '3')],
      ['floor as an array', (s: ReturnType<typeof raw>) => void (s.state.floor = [3])],
      ['kills as a boolean', (s: ReturnType<typeof raw>) => void (s.state.kills = true)],
      ['inventory as an object', (s: ReturnType<typeof raw>) => void (s.state.inventory = {})],
      ['enemies as null', (s: ReturnType<typeof raw>) => void (s.state.enemies = null)],
      ['rng as a number', (s: ReturnType<typeof raw>) => void (s.state.rng = 5)],
      ['cultivator as an array', (s: ReturnType<typeof raw>) => void (s.state.cultivator = [])],
      ['stats as text', (s: ReturnType<typeof raw>) => void (cult(s).stats = 'max')],
      ['level as a fraction', (s: ReturnType<typeof raw>) => void (cult(s).level = 2.5)],
      ['an item roll as text', (s: ReturnType<typeof raw>) => void (item(s).baseRoll = '1')],
      ['affixes as an object', (s: ReturnType<typeof raw>) => void (item(s).affixes = {})],
    ])('%s', (_, change) => {
      expect(tampered(change)).toBeNull();
    });
  });

  describe('unknown enums', () => {
    it.each([
      ['an unknown Path', (s: ReturnType<typeof raw>) => void (cult(s).path = 'ninja')],
      ['an unknown grade', (s: ReturnType<typeof raw>) => void (item(s).grade = 'legendary')],
      ['an unknown slot', (s: ReturnType<typeof raw>) => void (item(s).slot = 'cape')],
      ['an unknown enemy kind', (s: ReturnType<typeof raw>) => void (enemy(s).kind = 'god')],
      [
        'an inherited key as a Path',
        (s: ReturnType<typeof raw>) => void (cult(s).path = 'toString'),
      ],
      [
        'an unknown equipment position',
        (s: ReturnType<typeof raw>) => void ((cult(s).equipment as J).wings = item(s)),
      ],
    ])('%s', (_, change) => {
      expect(tampered(change)).toBeNull();
    });
  });

  describe('huge and out-of-range numbers', () => {
    it.each([
      ['a huge floor', (s: ReturnType<typeof raw>) => void (s.state.floor = 1e308)],
      ['a huge best floor', (s: ReturnType<typeof raw>) => void (s.state.highestFloor = 1e9)],
      ['floor above the best floor', (s: ReturnType<typeof raw>) => void (s.state.floor = 999)],
      ['floor 0', (s: ReturnType<typeof raw>) => void (s.state.floor = 0)],
      ['unsafe kills', (s: ReturnType<typeof raw>) => void (s.state.kills = 2 ** 60)],
      ['negative deaths', (s: ReturnType<typeof raw>) => void (s.state.deaths = -1)],
      ['a huge level', (s: ReturnType<typeof raw>) => void (cult(s).level = 1e6)],
      ['XP past the level', (s: ReturnType<typeof raw>) => void (cult(s).xp = 1e15)],
      ['HP past max', (s: ReturnType<typeof raw>) => void (cult(s).hp = 1e9)],
      ['HP of 0', (s: ReturnType<typeof raw>) => void (cult(s).hp = 0)],
      ['a far-off attack', (s: ReturnType<typeof raw>) => void (cult(s).nextAttackAt = 1e12)],
      ['an attack in the past', (s: ReturnType<typeof raw>) => void (cult(s).nextAttackAt = -1)],
      [
        'a far-off enemy attack',
        (s: ReturnType<typeof raw>) => void (s.state.enemyNextAttackAt = 1e300),
      ],
      ['an rng past 32 bits', (s: ReturnType<typeof raw>) => void ((s.state.rng as J).s = 2 ** 33)],
      ['a roll above 1', (s: ReturnType<typeof raw>) => void (item(s).baseRoll = 5)],
      ['a roll between steps', (s: ReturnType<typeof raw>) => void (item(s).baseRoll = 0.505)],
      ['an item past the best floor', (s: ReturnType<typeof raw>) => void (item(s).level = 1e5)],
      ['enemy HP past its max', (s: ReturnType<typeof raw>) => void (enemy(s).hp = 1e9)],
      ['a weakened enemy', (s: ReturnType<typeof raw>) => void (enemy(s).damage = 0)],
      ['a huge sim clock', (s: ReturnType<typeof raw>) => void (s.state.time = 1e300)],
    ])('%s', (_, change) => {
      expect(tampered(change)).toBeNull();
    });

    it('stat points that no level-up gave', () => {
      expect(tampered((s) => void ((cult(s).stats as J).agility = 9999))).toBeNull();
    });

    it('non-finite numbers written as 1e999', () => {
      const text = encodeSave(STATE, SAVED_AT).replace(/"kills":\d+/, '"kills":1e999');
      expect(decodeSave(text)).toBeNull();
    });
  });

  describe('prototype pollution', () => {
    it.each([
      ['the top level', '{"__proto__":{"polluted":true},'],
      ['the state', '"state":{"__proto__":{"polluted":true},'],
      ['the cultivator', '"cultivator":{"__proto__":{"polluted":true},'],
      ['an item', '"affixes":[{"__proto__":{"polluted":true},'],
    ])('a __proto__ key in %s', (_, at) => {
      const text = encodeSave(STATE, SAVED_AT);
      const [head] = at.split('{"__proto__"') as [string];
      const hostile = text.replace(`${head}{`, at);
      expect(hostile).not.toBe(text);
      expect(decodeSave(hostile)).toBeNull();
      expect(({} as J).polluted).toBeUndefined();
    });

    it('a constructor key in the equipment', () => {
      expect(
        tampered((s) => void ((cult(s).equipment as J)['constructor'] = { prototype: {} })),
      ).toBeNull();
    });
  });

  describe('text', () => {
    const names: [string, string][] = [
      ['an oversized name', 'Jade Stapler'.repeat(10_000)],
      ['a made-up name', 'Sword of Admin'],
      ['markup', '<img src=x onerror=alert(1)>'],
      ['a bidi override', 'Jade \u202eStapler'],
      ['a zero-width space', 'Jade\u200bStapler'],
      ['a zero-width joiner at the end', 'Jade Stapler\u200d'],
      ['a Cyrillic look-alike', 'J\u0430de Stapler'],
      ['padding', ' Jade Stapler'],
    ];

    it.each(names)('rejects %s as an item name', (_, name) => {
      expect(tampered((s) => void (item(s).name = name))).toBeNull();
    });

    it.each(names)('rejects %s as an enemy name', (_, name) => {
      expect(tampered((s) => void (enemy(s).name = name))).toBeNull();
    });

    it('rejects a real name from another slot', () => {
      const other = item(raw()).slot === 'weapon' ? 'Thinking Cap' : 'Jade Stapler';
      expect(tampered((s) => void (item(s).name = other))).toBeNull();
    });
  });

  describe('impossible items and fights', () => {
    it('a Mortal item with affixes', () => {
      expect(
        tampered((s) => {
          Object.assign(item(s), { grade: 'mortal', affixes: [{ id: 'lifesteal', roll: 1 }] });
          delete item(s).unique;
        }),
      ).toBeNull();
    });

    it('the same affix twice', () => {
      expect(
        tampered((s) =>
          Object.assign(item(s), {
            grade: 'spirit',
            affixes: [
              { id: 'lifesteal', roll: 1 },
              { id: 'lifesteal', roll: 1 },
            ],
          }),
        ),
      ).toBeNull();
    });

    it('a unique effect below Immortal grade', () => {
      expect(
        tampered((s) =>
          Object.assign(item(s), { grade: 'mortal', affixes: [], unique: 'synergy' }),
        ),
      ).toBeNull();
    });

    it('an item worn in a slot it does not fit', () => {
      expect(
        tampered((s) => {
          const eq = cult(s).equipment as J;
          const [at, worn] = Object.entries(eq)[0] as [string, J];
          eq[at] = { ...worn, slot: worn.slot === 'head' ? 'chest' : 'head', name: 'x' };
        }),
      ).toBeNull();
    });

    it('a bag past its size', () => {
      expect(
        tampered((s) => {
          const bag = s.state.inventory as J[];
          s.state.inventory = Array.from({ length: 41 }, () => bag[0]);
        }),
      ).toBeNull();
    });

    it('a floor with no enemies', () => {
      expect(tampered((s) => void (s.state.enemies = []))).toBeNull();
    });

    it('two bosses', () => {
      expect(
        tampered((s) => {
          const list = s.state.enemies as J[];
          s.state.enemies = [list[list.length - 1], list[list.length - 1]];
        }),
      ).toBeNull();
    });
  });
});
