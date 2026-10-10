import { describe, expect, it } from 'vitest';
import { buyBagSpace, changePath, resetStats, setFilter, spendPoints } from '../core/economy.ts';
import { makeTribulation, type Enemy } from '../core/floors.ts';
import { charmLine, type Item } from '../core/loot.ts';
import { derive, xpToNext } from '../core/cultivator.ts';
import { buyPassive, noPassives } from '../core/prestige.ts';
import {
  ARRAY_TICK,
  ENEMY_ARRIVAL,
  equip,
  newGame,
  retire,
  tick,
  type GameState,
} from '../core/sim.ts';
import {
  clearSave,
  decodeSave,
  encodeSave,
  loadSave,
  MAX_SAVE_CHARS,
  REJECTED_KEY,
  SAVE_KEY,
  SAVE_VERSION,
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

/** The save as versions before 5 wrote it: no Killing Array timer. */
function beforeDiscs(save: ReturnType<typeof raw>): ReturnType<typeof raw> {
  delete save.state.arrayNextAt;
  return save;
}

/** The save as versions before 4 wrote it: Boots were called Pants. */
function withPants(save: ReturnType<typeof raw>): ReturnType<typeof raw> {
  beforeDiscs(save);
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
  it('keeps a weapon equipped below its realm (a save from before the gate)', () => {
    const s = newGame(1, 'sword');
    s.cultivator.equipment.weapon = {
      slot: 'weapon',
      name: 'Heaven-Crushing Seal',
      level: 1,
      grade: 'immortal',
      baseRoll: 0,
      affixes: (['critChance', 'critDamage', 'attackSpeed', 'lifesteal', 'maxHp'] as const).map(
        (id) => ({ id, roll: 0 }),
      ),
      unique: 'synergy',
    };
    const loaded = decodeSave(encodeSave(s, SAVED_AT));
    expect(loaded?.state.cultivator.equipment.weapon).toEqual(s.cultivator.equipment.weapon);
  });

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
    ['an unknown version', (s: ReturnType<typeof raw>) => void (s.v = SAVE_VERSION + 1)],
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
      const other = item(raw()).slot === 'weapon' ? 'Hempen Scholar Cap' : 'Iron Flying Sword';
      expect(tampered((s) => void (item(s).name = other))).toBeNull();
    });
  });

  describe('weapon names', () => {
    const weapon = (s: ReturnType<typeof raw>, grade: string, name: string) => {
      // The bag's first item may be a disc; a weapon carries no array.
      delete item(s).array;
      return Object.assign(item(s), { slot: 'weapon', grade, name, affixes: [] });
    };

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

  describe('retired office names', () => {
    // The names Head, Side arm (now Hidden Weapon), Attachment, Accessory and
    // Charm rolled on any grade before they were named by grade.
    const OFFICE: [string, string][] = [
      ['head', 'Headset of Clarity'],
      ['head', 'Thinking Cap'],
      ['head', 'Jade Hair Crown'],
      ['sideArm', 'Stapler Dagger'],
      ['sideArm', 'Laser-Pointer Wand'],
      ['sideArm', 'Hole-Punch Knuckle'],
      ['attachment', 'Coffee Gourd'],
      ['attachment', 'Thermos of Elixirs'],
      ['attachment', 'Break-Room Calabash'],
      ['accessory', 'Lanyard Pendant'],
      ['accessory', 'Badge of the Dao'],
      ['accessory', 'Key-Card Amulet'],
      ['charm', 'Sticky-Note Talisman'],
      ['charm', 'Laminated Seal'],
      ['charm', 'Post-Meeting Charm'],
    ];
    /** The first name of each type and grade, as docs/design.md lists them. */
    const FIRST: Record<string, Record<string, string>> = {
      head: {
        mortal: 'Hempen Scholar Cap',
        spirit: 'Azure Cloud Circlet',
        earth: 'Jade Lotus Crown',
        heaven: 'Golden Sun Crown',
        immortal: 'Phoenix Flame Crown',
      },
      sideArm: {
        mortal: 'Iron Throwing Darts',
        spirit: 'Azure Frost Darts',
        earth: 'Jade Viper Darts',
        heaven: 'Golden Crow Flying Knives',
        immortal: 'Phoenix Flame Darts',
      },
      attachment: {
        mortal: 'Clay Wine Gourd',
        spirit: 'Azure Spirit Gourd',
        earth: 'Jade Elixir Gourd',
        heaven: 'Golden Nectar Gourd',
        immortal: 'Phoenix Flame Gourd',
      },
      accessory: {
        mortal: 'Bone Bead Pendant',
        spirit: 'Azure Spirit Pendant',
        earth: 'Jade Dragon Pendant',
        heaven: 'Golden Sun Amulet',
        immortal: 'Phoenix Flame Amulet',
      },
      charm: {
        mortal: 'Paper Ward Talisman',
        spirit: 'Azure Thunder Talisman',
        earth: 'Jade Seal Talisman',
        heaven: 'Golden Heaven Seal',
        immortal: 'Phoenix Flame Talisman',
      },
    };
    const GRADES = ['mortal', 'spirit', 'earth', 'heaven', 'immortal'];
    const AFFIX_COUNT: Record<string, number> = {
      mortal: 0,
      spirit: 1,
      earth: 3,
      heaven: 4,
      immortal: 5,
    };
    const IDS = ['critChance', 'maxHp', 'defence', 'qiRegen', 'lifesteal'];

    /** An item of `slot` and `grade` named `name` that is otherwise a legal drop. */
    function gear(slot: string, grade: string, name: string): J {
      const g: J = {
        slot,
        name,
        level: 1,
        grade,
        baseRoll: 0.5,
        affixes: IDS.slice(0, AFFIX_COUNT[grade]).map((id) => ({ id, roll: 0.5 })),
      };
      if (grade === 'immortal') g.unique = 'synergy';
      return g;
    }
    const inBag = (g: J) => {
      const save = raw();
      (save.state.inventory as J[])[0] = g;
      return save;
    };
    const load = (s: ReturnType<typeof raw>) => decodeSave(JSON.stringify(s));
    const CASES = OFFICE.flatMap(([slot, old]) =>
      GRADES.map((g) => [slot, old, g, FIRST[slot]?.[g] as string] as const),
    );

    it.each(CASES)('renames a %s %s of %s grade in the bag to %s', (slot, old, grade, now) => {
      const loaded = load(inBag(gear(slot, grade, old)));
      expect(loaded?.state.inventory[0]).toEqual(gear(slot, grade, now));
    });

    it.each([
      ['head', 'head'],
      ['sideArm', 'sideArm'],
      ['attachment', 'attachment'],
      ['accessory2', 'accessory'],
      ['charm1', 'charm'],
    ])('renames an equipped office item in the %s position', (at, slot) => {
      const old = OFFICE.find(([s]) => s === slot)?.[1] as string;
      const save = raw();
      (cult(save).equipment as J)[at] = gear(slot, 'earth', old);
      const eq = load(save)?.state.cultivator.equipment as Record<string, Item>;
      expect(eq[at]).toEqual(gear(slot, 'earth', FIRST[slot]?.earth as string));
    });

    // The Bell, Mirror (Accessory) and Binding Rope (Hidden Weapon) families (#45):
    // each name loads on its own type and grade only.
    const FAMILIES: [string, string, string][] = [
      ['accessory', 'mortal', 'Bronze Clapper Bell'],
      ['accessory', 'mortal', 'Bronze Hand Mirror'],
      ['accessory', 'spirit', 'Azure Soul-Scattering Bell'],
      ['accessory', 'spirit', 'Azure Bagua Mirror'],
      ['accessory', 'earth', 'Jade Wind Chime'],
      ['accessory', 'earth', 'Jade Demon-Revealing Mirror'],
      ['accessory', 'heaven', 'Golden Sun Bell'],
      ['accessory', 'heaven', 'Golden Sun Mirror'],
      ['accessory', 'immortal', 'Phoenix Flame Bell'],
      ['accessory', 'immortal', 'Phoenix Flame Mirror'],
      ['sideArm', 'mortal', 'Hempen Binding Cord'],
      ['sideArm', 'spirit', 'Azure Silk Sash'],
      ['sideArm', 'earth', 'Jade Dragon-Binding Chain'],
      ['sideArm', 'heaven', 'Golden Heaven-Wrapping Sash'],
      ['sideArm', 'immortal', 'Phoenix Flame Binding Rope'],
      // The Defend, Utility and Jade Charm lines (#50).
      ['charm', 'mortal', 'Paper Body-Guard Talisman'],
      ['charm', 'mortal', 'Paper Fortune Talisman'],
      ['charm', 'mortal', 'Cloudy Jade Slip'],
      ['charm', 'spirit', 'Azure Barrier Talisman'],
      ['charm', 'spirit', 'Azure Clear-Mind Talisman'],
      ['charm', 'spirit', 'Azure Spirit Jade Slip'],
      ['charm', 'earth', 'Jade Vajra Talisman'],
      ['charm', 'earth', 'Jade Wealth Talisman'],
      ['charm', 'earth', 'Emerald Jade Token'],
      ['charm', 'heaven', 'Golden Bell Guard Talisman'],
      ['charm', 'heaven', 'Golden Treasure-Seeking Talisman'],
      ['charm', 'heaven', 'Golden Sun Jade Token'],
      ['charm', 'immortal', 'Phoenix Rebirth Talisman'],
      ['charm', 'immortal', 'Phoenix Heaven-Luck Talisman'],
      ['charm', 'immortal', 'Phoenix Blood Jade'],
    ];

    it('loads a Charm from before the lines unchanged, as an Attack Talisman with its rolls', () => {
      const old = {
        ...gear('charm', 'heaven', 'Golden Heaven Seal'),
        affixes: [
          { id: 'qiRegen', roll: 0.37 },
          { id: 'treasureFind', roll: 1 },
          { id: 'critDamage', roll: 0.91 },
          { id: 'maxHp', roll: 0 },
        ],
      };
      const save = inBag(old);
      (cult(save).equipment as J).charm2 = gear('charm', 'mortal', 'Paper Ward Talisman');
      const st = load(save)?.state;
      expect(st?.inventory[0]).toEqual(old);
      expect(st?.cultivator.equipment.charm2).toEqual(
        gear('charm', 'mortal', 'Paper Ward Talisman'),
      );
      expect(charmLine(st?.inventory[0] as Item)).toBe('attack');
    });

    it.each(FAMILIES)('loads a %s of %s grade named %s unchanged', (slot, grade, name) => {
      const loaded = load(inBag(gear(slot, grade, name)));
      expect(loaded?.state.inventory[0]).toEqual(gear(slot, grade, name));
    });

    it.each(FAMILIES)('rejects a %s from another grade than %s named %s', (slot, grade, name) => {
      const other = grade === 'mortal' ? 'spirit' : 'mortal';
      expect(load(inBag(gear(slot, other, name)))).toBeNull();
    });

    it.each(FAMILIES)(
      'rejects a %s of %s grade named %s on any other type',
      (slot, grade, name) => {
        // Charm covers a rope saved where it first stood in this change.
        for (const wrong of ['accessory', 'sideArm', 'charm', 'attachment'].filter(
          (t) => t !== slot,
        )) {
          expect(load(inBag(gear(wrong, grade, name))), wrong).toBeNull();
        }
      },
    );

    it.each([
      ['a missing hyphen', 'accessory', 'spirit', 'Azure Soul Scattering Bell'],
      ['a Latin look-alike (I for l)', 'accessory', 'mortal', 'Bronze Clapper BeIl'],
      ['a Cyrillic look-alike', 'accessory', 'earth', 'J\u0430de Wind Chime'],
      ['a zero-width space', 'sideArm', 'earth', 'Jade Dragon-Binding\u200bChain'],
      ['a bidi override', 'accessory', 'heaven', 'Golden Sun \u202eMirror'],
      ['other casing', 'sideArm', 'immortal', 'phoenix flame binding rope'],
      ['padding', 'sideArm', 'mortal', 'Hempen Binding Cord '],
      ['a family with no such grade name', 'sideArm', 'mortal', 'Bronze Binding Rope'],
      ['a line with no such grade name', 'charm', 'mortal', 'Paper Jade Slip'],
      ['a line name, not an item name', 'charm', 'earth', 'Defend Talisman'],
      ['a zero-width joiner', 'charm', 'spirit', 'Azure\u200d Spirit Jade Slip'],
      ['a Greek look-alike', 'charm', 'immortal', 'Phoenix Bl\u03bfod Jade'],
      ['a bidi isolate', 'charm', 'heaven', '\u2066Golden Sun Jade Token\u2069'],
      ['other casing', 'charm', 'earth', 'emerald jade token'],
      ['a prototype key', 'charm', 'mortal', '__proto__'],
      ['a constructor key', 'charm', 'spirit', 'constructor'],
      ['a toString key', 'charm', 'earth', 'toString'],
      ['a bidi override', 'charm', 'immortal', 'Phoenix \u202eBlood Jade'],
      ['an oversized name', 'charm', 'mortal', 'Cloudy Jade Slip'.repeat(5000)],
    ])('rejects a family name with %s', (_, slot, grade, name) => {
      expect(load(inBag(gear(slot, grade, name)))).toBeNull();
    });

    it('loads a side arm item, an equipped side arm and a side arm filter unchanged', () => {
      const save = inBag(gear('sideArm', 'mortal', 'Iron Throwing Darts'));
      (cult(save).equipment as J).sideArm = gear('sideArm', 'spirit', 'Azure Frost Darts');
      (save.state.filter as J).slots = ['weapon', 'sideArm'];
      const st = load(save)?.state;
      expect(st?.inventory[0]).toEqual(gear('sideArm', 'mortal', 'Iron Throwing Darts'));
      expect(st?.cultivator.equipment.sideArm).toEqual(
        gear('sideArm', 'spirit', 'Azure Frost Darts'),
      );
      expect(st?.filter.slots).toEqual(['weapon', 'sideArm']);
      expect(st && decodeSave(encodeSave(st, SAVED_AT))?.state).toEqual(st);
    });

    it('renames them in a save from before Boots (v3)', () => {
      const save = withPants(inBag(gear('charm', 'heaven', 'Laminated Seal')));
      save.v = 3;
      expect(load(save)?.state.inventory[0]?.name).toBe('Golden Heaven Seal');
    });

    it.each([
      ['an office name on another type', 'head', 'mortal', 'Stapler Dagger'],
      ['a new name on another type', 'charm', 'mortal', 'Iron Throwing Darts'],
      ['a new name from another grade', 'sideArm', 'mortal', 'Phoenix Flame Darts'],
      ['a new name from a lower grade', 'accessory', 'immortal', 'Bone Bead Pendant'],
      ['a Cyrillic look-alike', 'sideArm', 'mortal', 'St\u0430pler Dagger'],
      ['a Latin look-alike (I for l)', 'accessory', 'mortal', 'Ianyard Pendant'],
      ['a zero-width space', 'charm', 'mortal', 'Sticky-Note\u200bTalisman'],
      ['a zero-width joiner at the end', 'head', 'mortal', 'Thinking Cap\u200d'],
      ['a bidi override', 'attachment', 'mortal', 'Coffee \u202eGourd'],
      ['a bidi isolate', 'head', 'mortal', '\u2066Thinking Cap\u2069'],
      ['other casing', 'attachment', 'mortal', 'coffee gourd'],
      ['padding', 'charm', 'mortal', ' Laminated Seal'],
      ['an oversized name', 'head', 'mortal', 'Thinking Cap'.repeat(12_000)],
      ['markup', 'accessory', 'mortal', '<img src=x onerror=alert(1)>'],
      ['a prototype key', 'sideArm', 'mortal', '__proto__'],
      ['an object key', 'charm', 'mortal', 'constructor'],
      ['a method name', 'head', 'mortal', 'hasOwnProperty'],
      ['a grade key', 'attachment', 'mortal', 'mortal'],
      ['the old label as a name', 'sideArm', 'mortal', 'Side arm'],
    ])('rejects %s', (_, slot, grade, name) => {
      expect(load(inBag(gear(slot, grade, name)))).toBeNull();
    });

    it.each([
      ['a label as the type', 'Hidden Weapon'],
      ['the old label as the type', 'Side arm'],
      ['a look-alike type', 'sideArm\u200b'],
    ])('rejects %s', (_, slot) => {
      expect(load(inBag(gear(slot, 'mortal', 'Stapler Dagger')))).toBeNull();
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

  describe('Formation Discs', () => {
    /** A Mortal Attachment named `name`, with `extra` fields, first in the bag. */
    function withAttachment(name: string, extra: J = {}): ReturnType<typeof raw> {
      const save = raw();
      (save.state.inventory as J[])[0] = {
        slot: 'attachment',
        name,
        level: 1,
        grade: 'mortal',
        baseRoll: 0.5,
        affixes: [],
        ...extra,
      };
      return save;
    }
    const load = (s: ReturnType<typeof raw>) => decodeSave(JSON.stringify(s));

    it.each(['binding', 'illusion', 'killing'])('loads a disc with a %s array', (array) => {
      const st = load(withAttachment('Bronze Formation Disc', { array }))?.state;
      expect(st?.inventory[0]).toMatchObject({ name: 'Bronze Formation Disc', array });
      expect(st && decodeSave(encodeSave(st, SAVED_AT))?.state).toEqual(st);
    });

    it('round-trips an equipped disc and the Killing Array timer', () => {
      const s = structuredClone(STATE);
      s.cultivator.equipment.attachment = {
        slot: 'attachment',
        name: 'Golden Star Disc',
        level: 1,
        grade: 'heaven',
        baseRoll: 0.3,
        affixes: [
          { id: 'critChance', roll: 0.5 },
          { id: 'maxHp', roll: 0.5 },
          { id: 'defence', roll: 0.5 },
          { id: 'qiRegen', roll: 0.5 },
        ],
        array: 'killing',
      };
      s.cultivator.hp = Math.min(s.cultivator.hp, derive(s.cultivator).maxHp);
      expect(decodeSave(encodeSave(s, SAVED_AT))?.state).toEqual(s);
    });

    it('loads a gourd with no array', () => {
      expect(load(withAttachment('Clay Wine Gourd'))?.state.inventory[0]?.array).toBeUndefined();
    });

    it.each<[string, string, J]>([
      ['a disc with no array', 'Bronze Formation Disc', {}],
      ['an unknown array', 'Bronze Formation Disc', { array: 'fire' }],
      ['an array in other case', 'Bronze Formation Disc', { array: 'Binding' }],
      ['an array name as shown', 'Bronze Formation Disc', { array: 'Binding Array' }],
      ['an array with a zero-width space', 'Bronze Formation Disc', { array: 'kill\u200bing' }],
      ['an array with a bidi override', 'Bronze Formation Disc', { array: '\u202ekilling' }],
      ['an array with a Cyrillic look-alike', 'Bronze Formation Disc', { array: 'k\u0456lling' }],
      ['an array as a number', 'Bronze Formation Disc', { array: 1 }],
      ['an array as a list', 'Bronze Formation Disc', { array: ['killing'] }],
      ['an array as an object', 'Bronze Formation Disc', { array: { id: 'killing' } }],
      ['an array as null', 'Bronze Formation Disc', { array: null }],
      ['an oversized array', 'Bronze Formation Disc', { array: 'k'.repeat(100_000) }],
      ['an inherited key as the array', 'Bronze Formation Disc', { array: '__proto__' }],
      ['an array on a gourd', 'Clay Wine Gourd', { array: 'killing' }],
      ['a disc name from another grade', 'Phoenix Flame Formation Disc', { array: 'killing' }],
    ])('rejects %s', (_, name, extra) => {
      expect(load(withAttachment(name, extra))).toBeNull();
    });

    it('rejects an array on any other type', () => {
      const save = raw();
      Object.assign((save.state.inventory as J[])[0] as J, {
        slot: 'head',
        name: 'Hempen Scholar Cap',
        grade: 'mortal',
        affixes: [],
        array: 'binding',
      });
      delete ((save.state.inventory as J[])[0] as J).unique;
      expect(load(save)).toBeNull();
      delete ((save.state.inventory as J[])[0] as J).array;
      expect(load(save)).not.toBeNull();
    });

    it('rejects a disc name as another type', () => {
      const save = withAttachment('Bronze Formation Disc', { array: 'binding' });
      ((save.state.inventory as J[])[0] as J).slot = 'charm';
      expect(load(save)).toBeNull();
    });

    it('rejects a pollution key on a disc', () => {
      const text = JSON.stringify(
        withAttachment('Bronze Formation Disc', { array: 'binding' }),
      ).replace('"array":', '"__proto__":{"polluted":true},"array":');
      expect(decodeSave(text)).toBeNull();
      expect(({} as J).polluted).toBeUndefined();
    });

    it.each([
      ['a far-off array hit', (t: number) => t + 1e12],
      [
        'an array hit past the pause and one tick',
        (t: number) => t + ENEMY_ARRIVAL + ARRAY_TICK + 0.01,
      ],
      ['a negative array time', () => -1],
      ['an array time as text', () => '5'],
    ])('rejects %s', (_, at) => {
      const save = raw();
      save.state.arrayNextAt = at(save.state.time as number);
      expect(load(save)).toBeNull();
    });

    it('accepts an array time left in the past while no Killing Array is worn', () => {
      const save = raw();
      save.state.arrayNextAt = 0;
      expect(load(save)?.state.arrayNextAt).toBe(0);
    });

    it('accepts an enemy attack held back by the longest Binding Array, and rejects one past it', () => {
      const at = (extra: number) => {
        const save = raw();
        save.state.enemyNextAttackAt = (save.state.time as number) + 2 + ENEMY_ARRIVAL + 3 + extra;
        return load(save);
      };
      expect(at(0)).not.toBeNull();
      expect(at(0.01)).toBeNull();
    });

    it('rejects the array timer in a save from before discs (v4)', () => {
      const save = raw();
      save.v = 4;
      expect(load(save)).toBeNull();
      expect(load(beforeDiscs(save))?.state.arrayNextAt).toBe(STATE.time + ARRAY_TICK);
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
        arrayNextAt: STATE.time + ARRAY_TICK,
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
    expect(loaded?.state).toEqual({
      ...STATE,
      insight: 0,
      passives: noPassives(),
      retirements: 0,
      arrayNextAt: STATE.time + ARRAY_TICK,
    });
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
