import { describe, expect, it } from 'vitest';
import { buyBagSpace, changePath, resetStats, setFilter, spendPoints } from '../core/economy.ts';
import { makeTribulation, type Enemy } from '../core/floors.ts';
import type { Item } from '../core/loot.ts';
import { xpToNext } from '../core/cultivator.ts';
import { buyPassive, noPassives } from '../core/prestige.ts';
import { ENEMY_ARRIVAL, equip, newGame, retire, tick, type GameState } from '../core/sim.ts';
import {
  clearSave,
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
    removeItem: (k) => void data.delete(k),
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

/** The save as versions before 4 wrote it: Boots were called Pants. */
function withPants(save: ReturnType<typeof raw>): ReturnType<typeof raw> {
  const st = save.state;
  for (const i of st.inventory as J[]) if (i.slot === 'boots') i.slot = 'pants';
  const eq = cult(save).equipment as J;
  if (eq.boots) {
    (eq.boots as J).slot = 'pants';
    eq.pants = eq.boots;
    delete eq.boots;
  }
  const filter = st.filter as J | undefined;
  if (filter) filter.slots = (filter.slots as string[]).map((s) => (s === 'boots' ? 'pants' : s));
  return save;
}
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

  it('clears the save and a rejected one, leaving other keys', () => {
    const storage = memory();
    writeSave(storage, STATE, SAVED_AT);
    storage.setItem(REJECTED_KEY, 'old');
    storage.setItem('other', 'kept');
    expect(clearSave(storage)).toBe(true);
    expect(loadSave(storage)).toBeNull();
    expect([...storage.data.keys()]).toEqual(['other']);
  });

  it('loads a save made in the pause between two fights', () => {
    let s = newGame(9, 'sword');
    while (s.kills === 0) s = tick(s, 0.01);
    expect(decodeSave(encodeSave(s, SAVED_AT))?.state).toEqual(s);
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
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(loadSave(broken)).toBeNull();
    expect(writeSave(broken, STATE, SAVED_AT)).toBe(false);
    expect(clearSave(broken)).toBe(false);
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
    ['an unknown version', (s: ReturnType<typeof raw>) => void (s.v = 5)],
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
      ['XP past any level', (s: ReturnType<typeof raw>) => void (cult(s).xp = 2 ** 60)],
      ['HP past max', (s: ReturnType<typeof raw>) => void (cult(s).hp = 1e9)],
      ['HP of 0', (s: ReturnType<typeof raw>) => void (cult(s).hp = 0)],
      ['a far-off attack', (s: ReturnType<typeof raw>) => void (cult(s).nextAttackAt = 1e12)],
      ['an attack in the past', (s: ReturnType<typeof raw>) => void (cult(s).nextAttackAt = -1)],
      [
        'an attack just past the longest interval and the pause',
        (s: ReturnType<typeof raw>) =>
          void (cult(s).nextAttackAt = (s.state.time as number) + 2 + ENEMY_ARRIVAL + 0.01),
      ],
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
      ['an oversized name', 'Iron Flying Sword'.repeat(10_000)],
      ['a made-up name', 'Sword of Admin'],
      ['markup', '<img src=x onerror=alert(1)>'],
      ['a bidi override', 'Iron \u202eFlying Sword'],
      ['a zero-width space', 'Iron\u200bFlying Sword'],
      ['a zero-width joiner at the end', 'Iron Flying Sword\u200d'],
      ['a Cyrillic look-alike', 'Ir\u043en Flying Sword'],
      ['padding', ' Iron Flying Sword'],
    ];

    it.each(names)('rejects %s as an item name', (_, name) => {
      expect(tampered((s) => void (item(s).name = name))).toBeNull();
    });

    it.each(names)('rejects %s as an enemy name', (_, name) => {
      expect(tampered((s) => void (enemy(s).name = name))).toBeNull();
    });

    it('rejects a real name from another slot', () => {
      const other = item(raw()).slot === 'weapon' ? 'Thinking Cap' : 'Iron Flying Sword';
      expect(tampered((s) => void (item(s).name = other))).toBeNull();
    });
  });

  describe('weapon names', () => {
    const weapon = (s: ReturnType<typeof raw>, grade: string, name: string) =>
      Object.assign(item(s), { slot: 'weapon', grade, name, affixes: [] });

    it('rejects a weapon name from another grade', () => {
      expect(tampered((s) => void weapon(s, 'mortal', 'Heaven-Crushing Seal'))).toBeNull();
      expect(tampered((s) => void weapon(s, 'mortal', 'Azure Silk Whisk'))).toBeNull();
    });

    it('rejects a retired weapon name on another type', () => {
      expect(
        tampered((s) => void Object.assign(item(s), { slot: 'head', name: 'Jade Stapler' })),
      ).toBeNull();
    });

    it.each(['Jade Stapler', 'Letter-Opener Sword', 'Spirit Ruler'])(
      'renames a retired %s to the first name of its grade',
      (old) => {
        const save = raw();
        weapon(save, 'mortal', old);
        const loaded = decodeSave(JSON.stringify(save));
        expect(loaded?.state.inventory[0]?.name).toBe('Iron Flying Sword');
      },
    );

    it.each([
      ['a zero-width joiner', 'Jade Stapler\u200d'],
      ['a bidi override', 'Jade \u202eStapler'],
      ['a Cyrillic look-alike', 'J\u0430de Stapler'],
      ['padding', ' Jade Stapler'],
      ['a prototype key', '__proto__'],
      ['an object key', 'constructor'],
      ['a method name', 'toString'],
    ])('rejects a weapon named with %s instead of renaming it', (_, name) => {
      expect(tampered((s) => void weapon(s, 'mortal', name))).toBeNull();
    });

    it.each([123, null, ['Jade Stapler'], {}])('rejects a weapon name of %j', (name) => {
      expect(
        tampered(
          (s) =>
            void Object.assign(item(s), { slot: 'weapon', grade: 'mortal', name, affixes: [] }),
        ),
      ).toBeNull();
    });

    it('checks the grade before renaming', () => {
      expect(tampered((s) => void weapon(s, '__proto__', 'Jade Stapler'))).toBeNull();
    });

    it('renames by grade', () => {
      const save = raw();
      Object.assign(weapon(save, 'heaven', 'Spirit Ruler'), {
        affixes: [
          { id: 'critChance', roll: 0.5 },
          { id: 'maxHp', roll: 0.5 },
          { id: 'defence', roll: 0.5 },
          { id: 'qiRegen', roll: 0.5 },
        ],
      });
      expect(decodeSave(JSON.stringify(save))?.state.inventory[0]?.name).toBe(
        'Golden Crow Flying Sword',
      );
    });
  });

  describe('retired blade names', () => {
    // The blades each grade rolled before weapons became magic tools.
    const BLADES: [string, string, string][] = [
      ['mortal', 'Iron Jian', 'Iron Flying Sword'],
      ['mortal', 'Bronze Longsword', 'Iron Flying Sword'],
      ['mortal', 'Tempered Steel Blade', 'Iron Flying Sword'],
      ['spirit', 'Azure Cloud Jian', 'Azure Cloud Flying Sword'],
      ['spirit', 'Sky River Blade', 'Azure Cloud Flying Sword'],
      ['spirit', 'Frost Lotus Sword', 'Azure Cloud Flying Sword'],
      ['earth', 'Jade Serpent Blade', 'Jade Serpent Flying Sword'],
      ['earth', 'Verdant Pine Sword', 'Jade Serpent Flying Sword'],
      ['earth', 'Emerald Wind Jian', 'Jade Serpent Flying Sword'],
      ['heaven', 'Golden Crow Sword', 'Golden Crow Flying Sword'],
      ['heaven', 'Sunlit Phoenix Blade', 'Golden Crow Flying Sword'],
      ['heaven', 'Imperial Gold Sabre', 'Golden Crow Flying Sword'],
      ['immortal', 'Vermilion Bird Blade', 'Phoenix Flame Flying Sword'],
      ['immortal', 'Heart Flame Jian', 'Phoenix Flame Flying Sword'],
      ['immortal', 'Nine Suns Sabre', 'Phoenix Flame Flying Sword'],
    ];
    const AFFIX_COUNT: Record<string, number> = {
      mortal: 0,
      spirit: 1,
      earth: 3,
      heaven: 4,
      immortal: 5,
    };
    const IDS = ['critChance', 'maxHp', 'defence', 'qiRegen', 'lifesteal'];

    /** A weapon of `grade` named `name` that is otherwise a legal drop. */
    function blade(grade: string, name: string): J {
      const w: J = {
        slot: 'weapon',
        name,
        level: 1,
        grade,
        baseRoll: 0.5,
        affixes: IDS.slice(0, AFFIX_COUNT[grade]).map((id) => ({ id, roll: 0.5 })),
      };
      if (grade === 'immortal') w.unique = 'synergy';
      return w;
    }
    const withBlade = (grade: string, name: string) => {
      const save = raw();
      (save.state.inventory as J[])[0] = blade(grade, name);
      return save;
    };

    it.each(BLADES)('renames a %s %s in the bag to %s', (grade, old, now) => {
      const loaded = decodeSave(JSON.stringify(withBlade(grade, old)));
      expect(loaded?.state.inventory[0]).toMatchObject({ slot: 'weapon', grade, name: now });
    });

    it.each(BLADES)('renames an equipped %s %s to %s', (grade, old, now) => {
      const save = raw();
      (cult(save).equipment as J).weapon = blade(grade, old);
      const loaded = decodeSave(JSON.stringify(save));
      expect(loaded?.state.cultivator.equipment.weapon?.name).toBe(now);
    });

    it('renames them in a save from before Boots (v3)', () => {
      const save = withPants(withBlade('earth', 'Verdant Pine Sword'));
      save.v = 3;
      expect(decodeSave(JSON.stringify(save))?.state.inventory[0]?.name).toBe(
        'Jade Serpent Flying Sword',
      );
    });

    it('keeps the stats of a renamed blade: only the name changes', () => {
      const loaded = decodeSave(JSON.stringify(withBlade('heaven', 'Imperial Gold Sabre')));
      expect(loaded?.state.inventory[0]).toEqual(blade('heaven', 'Golden Crow Flying Sword'));
    });

    it.each([
      ['a blade from another grade', 'mortal', 'Nine Suns Sabre'],
      ['a blade from a lower grade', 'immortal', 'Iron Jian'],
      ['a blade on another type', 'head', 'Iron Jian'],
      ['a Cyrillic look-alike', 'mortal', 'Ir\u043en Jian'],
      ['a Latin look-alike (l for I)', 'mortal', 'lron Jian'],
      ['a zero-width space', 'mortal', 'Iron\u200bJian'],
      ['a zero-width joiner at the end', 'mortal', 'Iron Jian\u200d'],
      ['a bidi override', 'mortal', 'Iron \u202eJian'],
      ['a bidi isolate', 'mortal', '\u2066Iron Jian\u2069'],
      ['other casing', 'mortal', 'iron jian'],
      ['padding', 'mortal', 'Iron Jian '],
      ['an oversized name', 'mortal', 'Iron Jian'.repeat(100_000)],
      ['a prototype key', 'mortal', '__proto__'],
      ['an object key', 'mortal', 'constructor'],
      ['a method name', 'mortal', 'hasOwnProperty'],
      ['a grade key', 'mortal', 'mortal'],
      ['an unknown name', 'mortal', 'Excalibur Prime'],
    ])('rejects %s', (_, grade, name) => {
      const save = withBlade(grade === 'head' ? 'mortal' : grade, name);
      if (grade === 'head') ((save.state.inventory as J[])[0] as J).slot = 'head';
      expect(decodeSave(JSON.stringify(save))).toBeNull();
    });

    it.each(['__proto__', 'constructor', 'toString'])('rejects %s as a grade', (grade) => {
      const save = withBlade('mortal', 'Iron Jian');
      ((save.state.inventory as J[])[0] as J).grade = grade;
      expect(decodeSave(JSON.stringify(save))).toBeNull();
      expect(({} as J).polluted).toBeUndefined();
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

  describe('currencies, the filter and the bag', () => {
    const filter = (s: ReturnType<typeof raw>) => s.state.filter as J;
    it.each([
      ['negative stones', (s: ReturnType<typeof raw>) => void (s.state.stones = -1)],
      ['fractional essence', (s: ReturnType<typeof raw>) => void (s.state.essence = 1.5)],
      ['unsafe stones', (s: ReturnType<typeof raw>) => void (s.state.stones = 2 ** 60)],
      ['stones as text', (s: ReturnType<typeof raw>) => void (s.state.stones = '9')],
      ['a bag below the start', (s: ReturnType<typeof raw>) => void (s.state.bagSize = 32)],
      ['a bag past the cap', (s: ReturnType<typeof raw>) => void (s.state.bagSize = 88)],
      ['a bag off the row size', (s: ReturnType<typeof raw>) => void (s.state.bagSize = 41)],
      ['negative drops sold', (s: ReturnType<typeof raw>) => void (s.state.dropsSold = -1)],
      ['a v1 drop count', (s: ReturnType<typeof raw>) => void (s.state.dropsLost = 0)],
      ['no filter', (s: ReturnType<typeof raw>) => void delete s.state.filter],
      ['an unknown filter grade', (s: ReturnType<typeof raw>) => void (filter(s).minGrade = 'x')],
      ['an unknown filter action', (s: ReturnType<typeof raw>) => void (filter(s).action = 'burn')],
      ['an unknown filter type', (s: ReturnType<typeof raw>) => void (filter(s).slots = ['cape'])],
      [
        'a repeated filter type',
        (s: ReturnType<typeof raw>) => void (filter(s).slots = ['head', 'head']),
      ],
      [
        'filter types out of order',
        (s: ReturnType<typeof raw>) => void (filter(s).slots = ['charm', 'head']),
      ],
      [
        'too many filter types',
        (s: ReturnType<typeof raw>) => void (filter(s).slots = Array(9).fill('head')),
      ],
      ['an extra filter key', (s: ReturnType<typeof raw>) => void (filter(s).keepAll = true)],
      ['a filter as an array', (s: ReturnType<typeof raw>) => void (s.state.filter = [])],
      [
        'a zero-width filter grade',
        (s: ReturnType<typeof raw>) => void (filter(s).minGrade = 'earth\u200b'),
      ],
      [
        'a bidi filter action',
        (s: ReturnType<typeof raw>) => void (filter(s).action = '\u202esell'),
      ],
      [
        'a look-alike filter type',
        (s: ReturnType<typeof raw>) => void (filter(s).slots = ['h\u0435ad']),
      ],
      ['a padded filter action', (s: ReturnType<typeof raw>) => void (filter(s).action = ' sell')],
      ['unspent points as text', (s: ReturnType<typeof raw>) => void (cult(s).unspent = '3')],
      ['unspent points from nowhere', (s: ReturnType<typeof raw>) => void (cult(s).unspent = 3)],
      [
        'a stat below the base',
        (s: ReturnType<typeof raw>) => void ((cult(s).stats as J).body = 0),
      ],
    ])('%s', (_, change) => {
      expect(tampered(change)).toBeNull();
    });

    it('a pollution key in the filter', () => {
      const text = encodeSave(STATE, SAVED_AT).replace(
        '"filter":{',
        '"filter":{"__proto__":{"polluted":true},',
      );
      expect(decodeSave(text)).toBeNull();
      expect(({} as J).polluted).toBeUndefined();
    });

    it('round-trips a set filter, a bigger bag and unspent points', () => {
      let s = { ...STATE, stones: 1e6 };
      s = setFilter(s, { minGrade: 'earth', slots: ['weapon', 'charm'], action: 'salvage' });
      s = buyBagSpace(buyBagSpace(s));
      s = resetStats(s);
      s = spendPoints(s, 'body', 2);
      expect(s.cultivator.unspent).toBeGreaterThan(0);
      expect(decodeSave(encodeSave(s, SAVED_AT))?.state).toEqual(s);
    });

    it('a bag over 40 once the bag has been upgraded', () => {
      const s = buyBagSpace({ ...STATE, stones: 1e6 });
      const bag = Array.from({ length: s.bagSize }, () => s.inventory[0] as Item);
      expect(decodeSave(encodeSave({ ...s, inventory: bag }, SAVED_AT))).not.toBeNull();
      const over = [...bag, bag[0] as Item];
      expect(decodeSave(encodeSave({ ...s, inventory: over }, SAVED_AT))).toBeNull();
    });
  });

  describe('a version 3 save: Pants became Boots', () => {
    const gear = (slot: string, name: string, grade = 'mortal', affixes: J[] = []): J => ({
      slot,
      name,
      level: 1,
      grade,
      baseRoll: 0.5,
      affixes,
    });
    const spirit = [{ id: 'maxHp', roll: 0.5 }];

    /** A v3 save with pants in the bag, on the cultivator and in the filter. */
    function v3(change: (s: ReturnType<typeof raw>) => void = () => {}): ReturnType<typeof raw> {
      const save = withPants(raw());
      save.v = 3;
      (save.state.inventory as J[])[0] = gear('pants', 'Khaki Leggings');
      const eq = cult(save).equipment as J;
      delete eq.boots;
      eq.pants = gear('pants', 'Slacks of Stillness', 'spirit', spirit);
      (save.state.filter as J).slots = ['chest', 'pants'];
      change(save);
      return save;
    }
    const load = (s: ReturnType<typeof raw>) => decodeSave(JSON.stringify(s));

    it('loads pants as boots, renamed by grade', () => {
      const st = load(v3())?.state;
      expect(st?.inventory[0]).toMatchObject({ slot: 'boots', name: 'Hempen Cloth Boots' });
      expect(st?.cultivator.equipment.boots).toMatchObject({
        slot: 'boots',
        name: 'Azure Cloud Boots',
      });
      expect(st?.filter.slots).toEqual(['chest', 'boots']);
    });

    it('renames a retired robe by grade', () => {
      const s = v3(
        (save) => void ((save.state.inventory as J[])[0] = gear('chest', 'Silk Cardigan')),
      );
      expect(load(s)?.state.inventory[0]?.name).toBe('Hempen Novice Robe');
    });

    it('saves boots as boots and loads them back', () => {
      const st = load(v3())?.state;
      expect(st && decodeSave(encodeSave(st, SAVED_AT))?.state).toEqual(st);
    });

    it.each([
      ['a boots item', (s: ReturnType<typeof raw>) => void (item(s).slot = 'boots')],
      [
        'a boots position',
        (s: ReturnType<typeof raw>) =>
          void ((cult(s).equipment as J).boots = gear('boots', 'Hempen Cloth Boots')),
      ],
      [
        'pants listed twice in the filter',
        (s: ReturnType<typeof raw>) => void ((s.state.filter as J).slots = ['pants', 'boots']),
      ],
      ['look-alike pants', (s: ReturnType<typeof raw>) => void (item(s).slot = 'Pants')],
      ['a zero-width pants', (s: ReturnType<typeof raw>) => void (item(s).slot = 'pants\u200b')],
      [
        'a bidi override on pants',
        (s: ReturnType<typeof raw>) => void (item(s).slot = '\u202epants'),
      ],
      [
        'a robe in the pants position',
        (s: ReturnType<typeof raw>) =>
          void ((cult(s).equipment as J).pants = gear('chest', 'Silk Cardigan')),
      ],
      [
        'pants in the chest position',
        (s: ReturnType<typeof raw>) =>
          void ((cult(s).equipment as J).chest = gear('pants', 'Khaki Leggings')),
      ],
      [
        'a pants item named for another grade',
        (s: ReturnType<typeof raw>) =>
          void ((s.state.inventory as J[])[0] = gear('pants', 'Azure Cloud Boots')),
      ],
      [
        'a constructor position',
        (s: ReturnType<typeof raw>) => void ((cult(s).equipment as J)['constructor'] = {}),
      ],
    ])('rejects %s in a v3 save', (_, change) => {
      expect(load(v3(change))).toBeNull();
    });

    it.each([
      [
        'a pants item',
        (s: ReturnType<typeof raw>) => void Object.assign(item(s), gear('pants', 'Khaki Leggings')),
      ],
      [
        'a pants position',
        (s: ReturnType<typeof raw>) =>
          void ((cult(s).equipment as J).pants = gear('boots', 'Hempen Cloth Boots')),
      ],
      [
        'pants in the filter',
        (s: ReturnType<typeof raw>) => void ((s.state.filter as J).slots = ['pants']),
      ],
    ])('rejects %s in a v4 save', (_, change) => {
      expect(tampered(change)).toBeNull();
    });
  });

  describe('a version 1 save', () => {
    /** The save as v1 wrote it: no currencies, filter, bag size or unspent points. */
    function v1(): string {
      const save = raw();
      const st = save.state;
      for (const k of [
        'bagSize',
        'stones',
        'essence',
        'filter',
        'dropsSold',
        'dropsSalvaged',
        'insight',
        'passives',
        'retirements',
      ]) {
        delete st[k];
      }
      st.dropsLost = 3;
      delete cult(save).unspent;
      return JSON.stringify({ ...withPants(save), v: 1 });
    }

    it('loads, with the new fields at their defaults', () => {
      const loaded = decodeSave(v1());
      expect(loaded?.state).toEqual({
        ...STATE,
        bagSize: 40,
        stones: 0,
        essence: 0,
        filter: newGame(1, 'sword').filter,
        dropsSold: 0,
        dropsSalvaged: 0,
      });
    });

    it.each([
      ['the state', '"state":{'],
      ['the cultivator', '"cultivator":{'],
    ])('rejects a pollution key in a v1 save: %s', (_, at) => {
      const text = v1().replace(at, `${at}"__proto__":{"polluted":true},`);
      expect(text).toContain('__proto__');
      expect(decodeSave(text)).toBeNull();
      expect(({} as J).polluted).toBeUndefined();
    });

    it('rejects a v1 save that carries unspent points', () => {
      const save = JSON.parse(v1());
      save.state.cultivator.unspent = 0;
      expect(decodeSave(JSON.stringify(save))).toBeNull();
    });

    it('is still checked: a v1 save with v2 fields, or tampered, is rejected', () => {
      const withStones = JSON.parse(v1());
      withStones.state.stones = 5;
      expect(decodeSave(JSON.stringify(withStones))).toBeNull();
      const noLost = JSON.parse(v1());
      delete noLost.state.dropsLost;
      expect(decodeSave(JSON.stringify(noLost))).toBeNull();
      const badLost = JSON.parse(v1());
      badLost.state.dropsLost = -1;
      expect(decodeSave(JSON.stringify(badLost))).toBeNull();
    });
  });
});

describe('Dao Insight and passives', () => {
  /** A retired run that bought passives, so every new field is set. */
  function retired(): GameState {
    let s = retire({ ...STATE, highestFloor: 20 });
    s = { ...s, insight: s.insight + 100 };
    for (const id of ['xp', 'offline', 'points', 'points'] as const) s = buyPassive(s, id);
    return tick(s, 60);
  }

  it('round-trips insight, passives and retirements', () => {
    const s = retired();
    expect(s.retirements).toBe(1);
    expect(s.passives).toEqual({ xp: 1, treasure: 0, offline: 1, points: 2 });
    expect(decodeSave(encodeSave(s, SAVED_AT))?.state).toEqual(s);
  });

  it('round-trips Head Start points through a stat reset, re-spend and Path change', () => {
    let s = { ...retired(), stones: 1e9 };
    s = resetStats(s);
    expect(s.cultivator.unspent).toBeGreaterThan(0);
    expect(decodeSave(encodeSave(s, SAVED_AT))?.state).toEqual(s);
    s = spendPoints(s, 'body', s.cultivator.unspent);
    expect(decodeSave(encodeSave(s, SAVED_AT))?.state).toEqual(s);
    s = changePath(s, 'talisman');
    expect(decodeSave(encodeSave(s, SAVED_AT))?.state).toEqual(s);
  });

  it('loads a version 2 save with no insight or passives', () => {
    const save = raw();
    for (const k of ['insight', 'passives', 'retirements']) delete save.state[k];
    const loaded = decodeSave(JSON.stringify({ ...withPants(save), v: 2 }));
    expect(loaded?.state).toEqual({ ...STATE, insight: 0, passives: noPassives(), retirements: 0 });
  });

  it.each([1, 2])('rejects boots in a version %i save', (v) => {
    const save = withPants(raw());
    for (const k of ['insight', 'passives', 'retirements']) delete save.state[k];
    if (v === 1) {
      for (const k of ['bagSize', 'stones', 'essence', 'filter', 'dropsSold', 'dropsSalvaged']) {
        delete save.state[k];
      }
      save.state.dropsLost = 0;
      delete cult(save).unspent;
    }
    expect(decodeSave(JSON.stringify({ ...save, v }))).not.toBeNull();
    item(save).slot = 'boots';
    expect(decodeSave(JSON.stringify({ ...save, v }))).toBeNull();
  });

  it('rejects a version 2 save that carries v3 fields', () => {
    const save = raw();
    expect(decodeSave(JSON.stringify({ ...save, v: 2 }))).toBeNull();
  });

  function retiredRaw(): ReturnType<typeof raw> {
    return JSON.parse(encodeSave(retired(), SAVED_AT));
  }
  const passivesOf = (x: ReturnType<typeof raw>) => x.state.passives as J;

  it.each([
    ['negative insight', (x: ReturnType<typeof raw>) => void (x.state.insight = -1)],
    ['fractional insight', (x: ReturnType<typeof raw>) => void (x.state.insight = 1.5)],
    ['insight as text', (x: ReturnType<typeof raw>) => void (x.state.insight = '9')],
    ['huge insight', (x: ReturnType<typeof raw>) => void (x.state.insight = 2 ** 53 + 2)],
    ['negative retirements', (x: ReturnType<typeof raw>) => void (x.state.retirements = -1)],
    ['fractional retirements', (x: ReturnType<typeof raw>) => void (x.state.retirements = 1.5)],
    ['retirements as text', (x: ReturnType<typeof raw>) => void (x.state.retirements = '1')],
    ['huge retirements', (x: ReturnType<typeof raw>) => void (x.state.retirements = 2 ** 53 + 2)],
    ['missing insight', (x: ReturnType<typeof raw>) => void delete x.state.insight],
    ['missing passives', (x: ReturnType<typeof raw>) => void delete x.state.passives],
    ['missing retirements', (x: ReturnType<typeof raw>) => void delete x.state.retirements],
    ['a rank as an object', (x: ReturnType<typeof raw>) => void (passivesOf(x).xp = { n: 1 })],
    ['a missing passive', (x: ReturnType<typeof raw>) => void delete passivesOf(x).xp],
    ['an unknown passive', (x: ReturnType<typeof raw>) => void (passivesOf(x).godMode = 1)],
    ['a rank past the max', (x: ReturnType<typeof raw>) => void (passivesOf(x).offline = 9)],
    ['a negative rank', (x: ReturnType<typeof raw>) => void (passivesOf(x).treasure = -1)],
    ['a fractional rank', (x: ReturnType<typeof raw>) => void (passivesOf(x).xp = 0.5)],
    ['passives as an array', (x: ReturnType<typeof raw>) => void (x.state.passives = [])],
    ['passives as null', (x: ReturnType<typeof raw>) => void (x.state.passives = null)],
    // Head Start ranks with no points behind them, or points with no ranks.
    [
      'Head Start without its points',
      (x: ReturnType<typeof raw>) => void (passivesOf(x).points = 3),
    ],
    ['points without Head Start', (x: ReturnType<typeof raw>) => void (passivesOf(x).points = 0)],
  ])('rejects %s', (_, change) => {
    const save = retiredRaw();
    change(save);
    expect(decodeSave(JSON.stringify(save))).toBeNull();
  });

  it('rejects a pollution key in the passives', () => {
    const text = encodeSave(retired(), SAVED_AT).replace(
      '"passives":{',
      '"passives":{"__proto__":{"polluted":true},',
    );
    expect(text).toContain('__proto__');
    expect(decodeSave(text)).toBeNull();
    expect(({} as J).polluted).toBeUndefined();
  });

  it('rejects look-alike passive names', () => {
    for (const name of ['xp\u200b', 'x\u0440', 'XP', ' xp']) {
      const text = encodeSave(retired(), SAVED_AT).replace('"xp":1,', `"${name}":1,`);
      expect(text).not.toContain('"xp":1,');
      expect(decodeSave(text)).toBeNull();
    }
  });
});

describe('realm caps and the Tribulation', () => {
  /**
   * A run held at level 10 that lost its Tribulation once, so it is back on a
   * full floor with the Tribulation queued at its end; `fought` enemies in.
   */
  function held(fought = 0): GameState {
    let s = newGame(7, 'sword');
    while (s.enemies[0]?.kind !== 'tribulation') s = tick(s, 1);
    (s.enemies[0] as Enemy).damage = 1e9;
    const { deaths } = s;
    while (s.deaths === deaths) s = tick(s, 1);
    s.enemies.splice(0, fought);
    return s;
  }

  function heldRaw(fought = 0): { v: number; savedAt: number; state: Record<string, unknown> } {
    return JSON.parse(encodeSave(held(fought), SAVED_AT));
  }

  function decodeChanged(
    base: ReturnType<typeof heldRaw>,
    change: (save: ReturnType<typeof heldRaw>) => void,
  ): unknown {
    change(base);
    return decodeSave(JSON.stringify(base));
  }

  it('round-trips a cultivator held at the cap with its Tribulation queued', () => {
    expect(held().enemies).toHaveLength(12);
    for (const fought of [0, 5, 10]) {
      const s = held(fought);
      expect(s.cultivator.level).toBe(10);
      expect(decodeSave(encodeSave(s, 0))?.state).toEqual(s);
    }
  });

  it('round-trips a Tribulation in progress, the only enemy left', () => {
    const s = held(11);
    expect(s.enemies.map((e) => e.kind)).toEqual(['tribulation']);
    expect(decodeSave(encodeSave(s, 0))?.state).toEqual(s);
  });

  it('accepts XP held past the cap', () => {
    const save = heldRaw();
    expect(decodeChanged(save, (x) => void (cult(x).xp = 1e9))).not.toBeNull();
  });

  it('bounds held XP at a whole number a save can store', () => {
    expect(
      decodeChanged(heldRaw(), (x) => void (cult(x).xp = Number.MAX_SAFE_INTEGER)),
    ).not.toBeNull();
    for (const xp of [2 ** 53 + 2, 1.5, -1]) {
      expect(decodeChanged(heldRaw(), (x) => void (cult(x).xp = xp))).toBeNull();
    }
  });

  it('rejects a held cultivator whose Tribulation is missing', () => {
    expect(decodeChanged(heldRaw(), (x) => void (x.state.enemies as J[]).pop())).toBeNull();
  });

  it('rejects a Tribulation on an Immortal', () => {
    const s = newGame(7, 'sword');
    s.cultivator.level = 61;
    s.cultivator.stats.agility += 3 * 60;
    expect(decodeSave(encodeSave(s, 0))).not.toBeNull();
    s.enemies.push(makeTribulation(1, 5));
    expect(decodeSave(encodeSave(s, 0))).toBeNull();
  });

  it('rejects XP past the next level below a cap', () => {
    const fresh = newGame(7, 'sword');
    fresh.cultivator.xp = xpToNext(1) - 1;
    expect(decodeSave(encodeSave(fresh, 0))).not.toBeNull();
    fresh.cultivator.xp = xpToNext(1);
    expect(decodeSave(encodeSave(fresh, 0))).toBeNull();
  });

  it('rejects a Tribulation for a cultivator not held at the cap', () => {
    // Too little XP held: not ready, so the queued Tribulation can't be there.
    expect(decodeChanged(heldRaw(), (x) => void (cult(x).xp = 0))).toBeNull();
    // A fresh run with a Tribulation pushed onto its floor.
    const fresh = newGame(7, 'sword');
    fresh.enemies.push(makeTribulation(1, 0));
    expect(decodeSave(encodeSave(fresh, 0))).toBeNull();
  });

  it('rejects a held cultivator whose Tribulation is out of place or misnamed', () => {
    const order = (x: ReturnType<typeof heldRaw>) => x.state.enemies as J[];
    expect(decodeChanged(heldRaw(), (x) => void order(x).unshift(order(x).pop() as J))).toBeNull();
    expect(decodeChanged(heldRaw(), (x) => void order(x).push(order(x).at(-1) as J))).toBeNull();
    for (const name of [
      'Annual Appraisal',
      'Probation Review\u202e',
      'Probation\u200bReview',
      'Pr\u043ebation Review',
      'Quarterly Review',
    ]) {
      expect(decodeChanged(heldRaw(), (x) => void (order(x).at(-1)!.name = name))).toBeNull();
    }
    // Numbers must be the sim's own.
    expect(decodeChanged(heldRaw(), (x) => void (order(x).at(-1)!.maxHp = 1))).toBeNull();
    expect(decodeChanged(heldRaw(), (x) => void (order(x).at(-1)!.xp = 1e6))).toBeNull();
  });

  it('rejects a Tribulation with a pollution key', () => {
    const json = encodeSave(held(11), 0).replace(
      '"kind":"tribulation"',
      '"kind":"tribulation","__proto__":{"x":1}',
    );
    expect(decodeSave(json)).toBeNull();
  });
});
